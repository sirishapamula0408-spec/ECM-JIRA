import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'

/*
 * JL-152 — the Confluence Lite sidebar's persisted section state.
 *
 * JL-153 REMOVED collapse from here. There is exactly one sidebar-collapse
 * control in the product, it lives in the top bar, and it acts on whichever
 * product sidebar is mounted — so a second, wiki-only collapse flag would be a
 * second source of truth for the same thing, and the two would disagree the
 * first time someone collapsed from the bar.
 *
 * What persists now is which of the expandable sections (Recent / Starred /
 * Spaces) are open, PER USER — a shared machine is normal here, so the key
 * carries the account and signing in as someone else does not inherit their
 * panel.
 *
 * localStorage rather than the server: this is a per-device display preference,
 * and a round trip to learn how wide to draw a panel would make the sidebar
 * flash at every navigation. It follows the same shape as useRecentIssues
 * (JL-163) and useDashboardLayout.
 *
 * Every read and write is wrapped: localStorage throws outright in some
 * contexts (private windows, blocked site data), and a sidebar that cannot
 * remember its width must still render.
 */

const PREFIX = 'confluenceLite.sidebar'

/** Sections that expand in place. Order is the render order. */
export const EXPANDABLE = ['recent', 'starred', 'spaces']

const DEFAULT_STATE = { expanded: { recent: true, starred: false, spaces: false } }

function storageKey(email) {
  // An anonymous key still works; it just isn't shared with a signed-in user.
  return `${PREFIX}:${String(email || 'anon').toLowerCase()}`
}

function read(email) {
  try {
    const raw = window.localStorage.getItem(storageKey(email))
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE
    const expanded = {}
    for (const key of EXPANDABLE) {
      expanded[key] = typeof parsed.expanded?.[key] === 'boolean'
        ? parsed.expanded[key]
        : DEFAULT_STATE.expanded[key]
    }
    return { expanded }
  } catch {
    return DEFAULT_STATE
  }
}

function write(email, state) {
  try {
    window.localStorage.setItem(storageKey(email), JSON.stringify(state))
  } catch {
    // A preference that cannot be saved is not an error worth surfacing.
  }
}

/**
 * @returns {{
 *   isExpanded: (section: string) => boolean,
 *   toggleSection: (section: string) => void,
 * }}
 */
export function useWikiSidebarState() {
  // AuthContext exposes `authUser`, not `user` — reading the wrong key here
  // would key every account to the same "anon" bucket and quietly defeat the
  // per-user requirement, with nothing failing to show for it.
  const { authUser } = useAuth()
  const email = authUser?.email || ''

  // Keyed by email so a sign-in swap re-reads rather than carrying state over.
  const [state, setState] = useState(() => read(email))
  const [keyedTo, setKeyedTo] = useState(email)
  if (keyedTo !== email) {
    // Render-phase resync, the documented React pattern for "state derived
    // from props changed" — cheaper and flicker-free next to an effect.
    setKeyedTo(email)
    setState(read(email))
  }

  const toggleSection = useCallback((section) => {
    setState((current) => {
      const next = {
        ...current,
        expanded: { ...current.expanded, [section]: !current.expanded[section] },
      }
      write(email, next)
      return next
    })
  }, [email])

  const isExpanded = useCallback((section) => state.expanded[section] === true, [state])

  return useMemo(
    () => ({ isExpanded, toggleSection }),
    [isExpanded, toggleSection],
  )
}
