import { useCallback, useEffect, useState } from 'react'

// JL-163 — recently viewed issues, persisted in localStorage.
const STORAGE_KEY = 'recentIssues'
const MAX_RECENT = 8
// Custom event lets separate hook instances (Topbar vs IssueDetailPage) stay in sync.
const UPDATE_EVENT = 'recent-issues:updated'

function readRecent() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && item.id != null).slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

/**
 * Tracks the last {MAX_RECENT} viewed issues (de-duplicated, most-recent-first).
 * Returns `{ recentIssues, addRecent }`.
 */
export function useRecentIssues() {
  const [recentIssues, setRecentIssues] = useState(readRecent)

  // Re-read when another hook instance (or another tab) updates the list.
  useEffect(() => {
    const sync = () => setRecentIssues(readRecent())
    window.addEventListener(UPDATE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(UPDATE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const addRecent = useCallback((issue) => {
    if (!issue || issue.id == null) return
    const entry = { id: issue.id, key: issue.key, title: issue.title }
    const next = [
      entry,
      ...readRecent().filter((item) => String(item.id) !== String(issue.id)),
    ].slice(0, MAX_RECENT)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* storage may be unavailable (private mode / quota) — keep in-memory state */
    }
    setRecentIssues(next)
    window.dispatchEvent(new Event(UPDATE_EVENT))
  }, [])

  return { recentIssues, addRecent }
}
