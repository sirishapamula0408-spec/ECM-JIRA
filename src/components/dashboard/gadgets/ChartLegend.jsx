import { Link } from 'react-router-dom'
import { ISSUE_STATUSES } from '../../../constants'

/*
 * Shared legend for the pie / donut dashboard gadgets (JL-336).
 *
 * ── Toggle vs. navigate ──────────────────────────────────────────────────────
 * The legend row previously had a single job: clicking it hid/showed that
 * slice. JL-336 asks it to also open the issue list filtered to that value, so
 * the row now carries ONE affordance PER behaviour instead of overloading a
 * single click handler:
 *
 *   • the colour DOT is a toggle <button> — show/hide the slice (unchanged
 *     behaviour, it just moved onto its own control). The dot is already the
 *     visual stand-in for the slice, so "click the dot to blank the slice"
 *     reads naturally, and aria-pressed makes the state audible.
 *   • the LABEL is a <Link> into the issue list, filtered to that value.
 *
 * The alternative (keep click = toggle, add a separate "open" icon) was
 * rejected: the label is what a user actually aims at when they want to see
 * those issues, and a real <Link> there gets focusability, Enter activation,
 * middle-click and open-in-new-tab for free — none of which the old
 * onClick-on-<li> had.
 *
 * ── Which groupings link ─────────────────────────────────────────────────────
 * Only `status`. IssueListPage can filter by status and nothing else, so an
 * assignee/priority/type legend link would navigate to a list that silently
 * ignored the filter — a worse lie than not linking at all. Those groupings
 * keep the dot toggle and render the label as plain text.
 *
 * ── Where the dot colour comes from ──────────────────────────────────────────
 * JL-345: `segments` must arrive with `color` already resolved (see
 * resolveSegmentColors in gadgetChartUtils). The legend deliberately does NOT
 * call getColor itself: it used to, indexing the unfiltered list, while the
 * gadget indexed its filtered one — so hiding a slice desynced the two. Reading
 * the colour the gadget already put on the segment removes the second source of
 * truth entirely, rather than trying to keep two index schemes in step.
 */

// groupIssuesBy() buckets missing values under 'Unassigned', which is not a real
// status — linking it would produce a filter the list page can't apply either.
const LINKABLE_STATUSES = new Set(ISSUE_STATUSES)

export function ChartLegend({
  segments,
  hiddenLabels,
  onToggle,
  groupBy,
  projectId = null,
  showCounts = true,
  grandTotal = 0,
}) {
  // The dashboard's project filter can be 'All', in which case DashboardPage
  // passes no projectId and we link to the unscoped list — which spans every
  // project, exactly what 'All' means.
  const listPath = projectId ? `/projects/${projectId}/list` : '/list'

  return (
    <ul className="pie-gadget-legend">
      {segments.map((s) => {
        const hidden = hiddenLabels.has(s.label)
        const to = groupBy === 'status' && LINKABLE_STATUSES.has(s.label)
          ? `${listPath}?status=${encodeURIComponent(s.label)}`
          : null
        return (
          <li key={s.label} className={hidden ? 'legend-hidden' : ''}>
            <button
              type="button"
              className="legend-dot-btn"
              aria-pressed={!hidden}
              aria-label={`${hidden ? 'Show' : 'Hide'} ${s.label} slice`}
              onClick={() => onToggle(s.label)}
            >
              <i
                className="legend-dot"
                style={{ background: hidden ? '#dfe1e6' : s.color }}
              />
            </button>
            {to ? (
              <Link className="legend-label legend-label-link" to={to} title={`View ${s.label} issues`}>
                {s.label}
              </Link>
            ) : (
              <span className="legend-label">{s.label}</span>
            )}
            {showCounts && (
              <strong>{s.count} ({grandTotal > 0 ? Math.round((s.count / grandTotal) * 100) : 0}%)</strong>
            )}
          </li>
        )
      })}
    </ul>
  )
}
