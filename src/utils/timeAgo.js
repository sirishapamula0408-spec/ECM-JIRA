/**
 * Shared relative-timestamp formatter (JL-168).
 *
 * Converts a Date or ISO-8601 string into a short relative label such as
 * "Just now", "45s ago", "5m ago", "3h ago", "2d ago", "1w ago",
 * "4mo ago" or "2y ago".
 *
 * @param {Date|string|number} input - Date instance, ISO string, or epoch ms.
 * @returns {string} Relative label, or '' when input is missing/invalid.
 */
export function timeAgo(input) {
  if (input === null || input === undefined || input === '') return ''

  const date = input instanceof Date ? input : new Date(input)
  const time = date.getTime()
  if (Number.isNaN(time)) return ''

  const diffSeconds = Math.floor((Date.now() - time) / 1000)

  // Future or sub-10-second timestamps read as "Just now".
  if (diffSeconds < 10) return 'Just now'
  if (diffSeconds < 60) return `${diffSeconds}s ago`

  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`

  return `${Math.floor(days / 365)}y ago`
}

/**
 * Shared date-only formatter (JL-338).
 *
 * Renders a timestamp as a human-readable calendar date with no time
 * component, e.g. "Jul 7, 2026" — matching the en-US short-month style
 * already used across the app (IssueDetailPage dates, DueDateBadge).
 *
 * Timezone behaviour: server timestamps (created_at etc.) are stored in
 * UTC, so we deliberately format the **UTC** calendar day. This keeps the
 * displayed date identical to the date embedded in the stored ISO string
 * for every user — a viewer west of UTC never sees "Jul 6" for a row the
 * server (and CSV exports, API payloads) says was created on Jul 7.
 *
 * @param {Date|string|number} input - Date instance, ISO string, or epoch ms.
 * @returns {string} e.g. "Jul 7, 2026", or '' when input is missing/invalid.
 */
export function formatDateOnly(input) {
  if (input === null || input === undefined || input === '') return ''

  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
