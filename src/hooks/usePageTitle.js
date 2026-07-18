import { useEffect } from 'react'

// Base app name — keep in sync with the <title> in index.html
export const APP_NAME = 'ECM Project Tracker'

// JL-221: unread-notification prefix, e.g. "(3) Dashboard · ECM Project Tracker".
// Display caps at "(9+)". The count lives at module level so the page-title
// hook and the notification context cooperate on a single document.title
// write path instead of fighting each other: every write composes
// `prefix + base`, and the base is always derived by stripping any existing
// prefix from the current title.
const UNREAD_PREFIX_RE = /^\(\d+\+?\) /
let unreadTitleCount = 0

function formatUnreadPrefix() {
  if (unreadTitleCount <= 0) return ''
  return unreadTitleCount > 9 ? '(9+) ' : `(${unreadTitleCount}) `
}

function stripUnreadPrefix(title) {
  return title.replace(UNREAD_PREFIX_RE, '')
}

/**
 * Sets the unread-notification count shown as a "(N) " prefix in the browser
 * tab title. Passing 0 (or a falsy value) removes the prefix. Called by
 * NotificationContext whenever its unread count changes.
 */
export function setUnreadTitleCount(count) {
  unreadTitleCount = Number(count) || 0
  document.title = formatUnreadPrefix() + stripUnreadPrefix(document.title)
}

/**
 * Sets the browser tab title to "<title> · ECM Project Tracker" while the
 * page is mounted, and restores the previous title on unmount. Any unread
 * "(N) " prefix is preserved across page changes (JL-221).
 */
export function usePageTitle(title) {
  useEffect(() => {
    if (!title) return undefined
    const previousBase = stripUnreadPrefix(document.title)
    document.title = `${formatUnreadPrefix()}${title} · ${APP_NAME}`
    return () => {
      document.title = formatUnreadPrefix() + previousBase
    }
  }, [title])
}

export default usePageTitle
