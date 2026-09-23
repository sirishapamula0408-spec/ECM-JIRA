/*
 * JL-473 — the invite-delivery lozenge, extracted so two pages can share it.
 *
 * It was defined inside TeamsPage.jsx and exported from there (JL-323). The
 * User Management page needed exactly the same badge, and the choice was to
 * import a component out of a sibling *page* module — which drags that page's
 * whole import graph into anything that touches it — or to copy fourteen lines
 * and let the two drift. Neither, so it moved here.
 *
 * `status` is the `email_status` field the API attaches to member and
 * invitation rows from the newest matching `email_log` entry:
 *
 *   sent     the provider accepted it
 *   failed   the provider rejected it; `error` carries the reason
 *   skipped  SMTP is not configured, so nothing was attempted
 *   unknown  no delivery attempt is on record for this address at all
 *
 * 'unknown' is a real state, not a fallback for bad input: a member created
 * with a temporary password never had an invite sent, and neither did anyone
 * added before JL-323 started logging. It reads "Unknown" rather than "Not
 * sent" because those are different claims and only one of them is defensible.
 */
const DELIVERY_STYLES = {
  sent: { label: 'Sent', className: 'pill-green' },
  failed: { label: 'Failed', className: 'pill-red' },
  skipped: { label: 'Not sent', className: 'pill-yellow' },
  unknown: { label: 'Unknown', className: 'pill-gray' },
}

export function InviteDeliveryBadge({ status, error, sentAt }) {
  const key = DELIVERY_STYLES[status] ? status : 'unknown'
  const { label, className } = DELIVERY_STYLES[key]

  // The reason lives in the tooltip rather than the badge: a badge has to stay
  // one word to be scannable down a column, and an SMTP rejection string is a
  // sentence. Without it a "Failed" badge would tell an admin that something is
  // wrong and nothing about what.
  const title = key === 'unknown'
    ? 'No delivery attempt recorded for this address'
    : error
      ? `${label}: ${error}`
      : sentAt
        ? `${label} ${new Date(sentAt).toLocaleString()}`
        : label

  return (
    <span className={`pill pill--lozenge ${className}`} title={title}>
      {label}
    </span>
  )
}

export default InviteDeliveryBadge
