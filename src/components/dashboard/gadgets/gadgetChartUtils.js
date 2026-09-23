import { priorityTokenName } from '../../../utils/statusCategory'

/*
 * JL-457 — priority segments read the shared tokens.
 *
 * These used to be hardcoded per-name hex maps, and they were the worst
 * offenders in the app: `In Progress` was GREEN (#7fb239) here while it was
 * blue in the lozenge, the board and the workflow editor; `To Do` was PURPLE
 * (#a95be7) while it was grey everywhere else; and `Low` priority was the same
 * #00875a green that means Done. A pie chart of statuses and the board behind
 * it were painting the same data in different colours.
 *
 * Priority values are `var(--token)` strings rather than resolved hexes on
 * purpose. The consumers put them straight into inline `background` /
 * `conic-gradient()`, where a custom property resolves normally — so the theme
 * still controls them, and switching to dark mode repaints the chart without
 * JS. STATUS no longer does this; see the JL-470 note below for why a chart
 * segment needs a finer palette than the four category tokens can express.
 *
 * `issueType` is NOT a status or priority and keeps its own hues; it is a
 * different axis and sharing the status palette would imply a meaning it
 * doesn't have.
 */
/*
 * ── JL-470 — one colour per STATUS, not one colour per category ─────────────
 *
 * JL-457 routed a status through resolveStatusCategory() and painted the
 * category's accent token. That is right for a LOZENGE, where the text already
 * names the status and the colour only has to say "which category" — but it is
 * wrong for a CHART SEGMENT, where colour is the entire identity of a slice.
 * Five statuses collapse onto three categories, so the donut drew Backlog and
 * To Do in the same grey and In Progress and Code Review in the same blue: four
 * slices, two colours, nothing to tell them apart by.
 *
 * This map is the single source of truth for that colour. getColor() reads it,
 * resolveSegmentColors() stamps the result onto each segment, and ChartLegend
 * reads the stamped value — so the disc and its legend swatch are literally the
 * same string and cannot disagree (the JL-345 invariant, unchanged).
 *
 * The map covers ALL of ISSUE_STATUSES, not just the five workflow statuses
 * JL-470 was raised against. ISSUE_STATUSES has nine — In Testing, In Rework,
 * In UAT and Cancelled as well — and mapping only five would have sent the
 * other four to the single fallback below, which is the same defect the ticket
 * exists to remove, just moved down the list. StatusChartColours.JL470 asserts
 * the map stays exhaustive, so adding a status to ISSUE_STATUSES without
 * choosing a colour for it fails the suite rather than silently greying it out.
 *
 * Hex, not var(--token), deliberately. The category tokens these replace are
 * theme-swapped in dark mode, but there are only three of them; a per-status
 * palette has no token to borrow, and inventing five more light/dark token
 * pairs to express a decision this file owns would spread it across two files
 * again. The values are Atlassian's own palette and hold contrast on both the
 * light and the dark canvas.
 */
export const STATUS_COLORS = {
  'Backlog': '#8993A4',      // N200 — neutral grey, nothing started
  'To Do': '#6554C0',        // P400 — purple, queued and committed
  'In Progress': '#0052CC',  // B400 — blue, the "active work" colour app-wide
  'Code Review': '#FF991F',  // Y400 — orange, active but waiting on someone
  'In Testing': '#00B8D9',   // T300 — teal
  'In Rework': '#FFC400',    // Y300 — yellow, went backwards
  'In UAT': '#E774BB',       // M300 — magenta
  'Done': '#36B37E',         // G300 — green
  'Cancelled': '#DE350B',    // R400 — red, terminal but not a success
}

/*
 * Any status not in the map above — a project-defined workflow status like
 * "UAT" or "Awaiting Sign-off", or groupIssuesBy()'s 'Unassigned' bucket.
 *
 * It is a deliberate SIXTH colour rather than a fall-through to the status's
 * category accent, which is what the pre-JL-470 code effectively did: routing
 * "UAT" to the inprogress accent would paint it #0052CC, i.e. hand it In
 * Progress's exact slice colour, and the reader has no way to know the two
 * slices are different statuses. An unmapped status is better off reading as
 * "not one of the five" than as a convincing impostor of one of them.
 *
 * N500. Distinct from all five above, including from Backlog's lighter grey.
 * Two unmapped statuses do share it — that is the known cost, and the fix is to
 * add them to STATUS_COLORS, not to index into an arbitrary palette.
 */
export const STATUS_FALLBACK_COLOR = '#42526E'

export const COLOR_PALETTES = {
  // Resolved per label at lookup time (see getColor) against STATUS_COLORS.
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
  // JL-470: an exact per-status lookup, with a documented sixth colour for
  // anything unmapped. Never index-based for statuses — the index depends on
  // which slices are currently visible, which is the JL-345 bug.
  if (groupBy === 'status') {
    const name = typeof key === 'string' ? key.trim() : ''
    return STATUS_COLORS[name] || STATUS_FALLBACK_COLOR
  }
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
