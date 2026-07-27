import { timeAgo } from '../../utils/timeAgo'

/**
 * RelativeTime (JL-241) — renders a recency timestamp as relative text
 * ("5m ago", "2d ago" via the shared timeAgo util from JL-168) inside a
 * semantic <time> element, with the full absolute date exposed as a native
 * tooltip (title attribute) and machine-readable dateTime attribute.
 *
 * Intended for recency-oriented timestamps (created/updated/last-activity).
 * Calendrical dates (due dates, release dates, sprint ranges) should stay
 * absolute — do not use this component for those.
 *
 * Props:
 *   value    (Date|string|number) The timestamp. Renders the fallback when
 *                                 missing or unparseable.
 *   fallback (optional node)      What to render for null/invalid input
 *                                 (default '—').
 *   ...rest                       Forwarded to the <time> element
 *                                 (e.g. className).
 */
export function RelativeTime({ value, fallback = '—', ...rest }) {
  if (value === null || value === undefined || value === '') return fallback

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return fallback

  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()} {...rest}>
      {timeAgo(date)}
    </time>
  )
}

export default RelativeTime
