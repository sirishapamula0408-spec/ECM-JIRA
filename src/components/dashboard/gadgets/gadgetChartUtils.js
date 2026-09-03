import { resolveStatusCategory, priorityTokenName } from '../../../utils/statusCategory'

/*
 * JL-457 — status and priority segments read the shared tokens.
 *
 * These used to be hardcoded per-name hex maps, and they were the worst
 * offenders in the app: `In Progress` was GREEN (#7fb239) here while it was
 * blue in the lozenge, the board and the workflow editor; `To Do` was PURPLE
 * (#a95be7) while it was grey everywhere else; and `Low` priority was the same
 * #00875a green that means Done. A pie chart of statuses and the board behind
 * it were painting the same data in different colours.
 *
 * Values are `var(--token)` strings rather than resolved hexes on purpose. The
 * consumers put them straight into inline `background` / `conic-gradient()`,
 * where a custom property resolves normally — so the theme still controls
 * them, and switching to dark mode repaints the chart without JS.
 *
 * `issueType` is NOT a status or priority and keeps its own hues; it is a
 * different axis and sharing the status palette would imply a meaning it
 * doesn't have.
 */
const statusVar = (category) => `var(--status-${category}-accent)`

export const COLOR_PALETTES = {
  // Resolved per label at lookup time (see getColor) — a project can define
  // statuses this map has never heard of, and they must still get the colour of
  // their category rather than falling through to an arbitrary index.
  status: null,
  priority: {
    'Highest': 'var(--priority-highest-accent)',
    'High': 'var(--priority-high-accent)',
    'Medium': 'var(--priority-medium-accent)',
    'Low': 'var(--priority-low-accent)',
  },
  issueType: {
    'Story': '#36b37e',
    'Bug': '#ff5630',
    'Task': '#4c9aff',
  },
  assignee: {},
}

const FALLBACK_COLORS = [
  '#0052cc', '#00875a', '#ff991f', '#de350b', '#6554c0',
  '#00b8d9', '#ff5630', '#36b37e', '#4c9aff', '#8993a4',
]

export function getColor(groupBy, key, index) {
  // JL-457: status resolves through the shared category resolver rather than a
  // name lookup, so a project-defined status ("In Rework", "UAT") gets its
  // category's colour instead of an arbitrary fallback hue. This is the whole
  // point of colouring by category — a new status needs no new colour.
  if (groupBy === 'status') return statusVar(resolveStatusCategory(key))
  if (groupBy === 'priority') {
    return COLOR_PALETTES.priority[key] || `var(--priority-${priorityTokenName(key)}-accent)`
  }
  const palette = COLOR_PALETTES[groupBy]
  if (palette && palette[key]) return palette[key]
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

/*
 * JL-345: resolve every segment's colour ONCE, up front, and carry it on the
 * segment.
 *
 * getColor() falls back to FALLBACK_COLORS[index % n] for any grouping without
 * a named palette entry — and `assignee`'s palette is literally {}, so there
 * *every* colour comes from that index. Callers used to colour a list they had
 * already filtered (hidden slices removed), while the legend coloured the
 * unfiltered list. Hiding one slice therefore shifted every later index by one:
 * the disc repainted in colours the legend no longer matched, and slices the
 * user had not touched changed colour.
 *
 * The invariant: a label's colour is a function of its position in the
 * UNFILTERED grouping and nothing else. Call this on the full segment list
 * before any filtering, then filter the *result* — so the disc and the legend
 * are literally reading the same value and cannot disagree.
 */
export function resolveSegmentColors(segments, groupBy) {
  return segments.map((s, i) => ({ ...s, color: getColor(groupBy, s.label, i) }))
}

export function groupIssuesBy(issues, field) {
  const groups = {}
  for (const issue of issues) {
    const key = issue[field] || 'Unassigned'
    groups[key] = (groups[key] || 0) + 1
  }
  return Object.entries(groups).map(([label, count]) => ({ label, count }))
}

export function buildConicGradient(segments, total) {
  if (total === 0) return 'conic-gradient(#dfe1e6 0 100%)'
  const stops = []
  let angle = 0
  for (const seg of segments) {
    const pct = (seg.count / total) * 100
    stops.push(`${seg.color} ${angle}% ${angle + pct}%`)
    angle += pct
  }
  return `conic-gradient(${stops.join(', ')})`
}

export function sectorPath(cx, cy, r, startAngle, endAngle) {
  const toRad = (deg) => (deg - 90) * (Math.PI / 180)
  const x1 = cx + r * Math.cos(toRad(startAngle))
  const y1 = cy + r * Math.sin(toRad(startAngle))
  const x2 = cx + r * Math.cos(toRad(endAngle))
  const y2 = cy + r * Math.sin(toRad(endAngle))
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`
}

export function getGroupByField(groupBy) {
  switch (groupBy) {
    case 'status': return 'status'
    case 'priority': return 'priority'
    case 'issueType': return 'issueType'
    case 'assignee': return 'assignee'
    default: return 'status'
  }
}
