import { useState } from 'react'
import { groupIssuesBy, buildConicGradient, sectorPath, resolveSegmentColors, getGroupByField } from './gadgetChartUtils'
import { ChartLegend } from './ChartLegend'

// JL-335: where the on-slice "%" labels sit, in viewBox user units.
//
// The disc renders 140x140px against viewBox 0 0 160 160, so 1 user unit =
// 0.875px, and the ring's outer edge (70px) is 80 units. `.donut-hole` is
// inset 30px, so the hole radius is 40px => 45.7 units, and the visible band
// runs 45.7 -> 80 with its midpoint at 62.9.
//
// Two things were wrong before. The radius was hard-coded to 60, only 7.4 units
// clear of the then-46px hole; and near 3 and 9 o'clock a label's WIDTH (26.4
// units for "25%") points radially rather than tangentially, so its inner edge
// reached ~47 — inside the hole. The hole is opaque and stacked above the SVG,
// so it painted over the digits. Centring on the band fixes the placement, and
// the wider band (see the JL-335 note on .donut-hole) gives the label room to
// sit there without touching either edge.
//
// HOLE_RADIUS mirrors the CSS `inset` on .donut-hole; DonutLabelClipping.JL335
// asserts the two stay in sync.
const HOLE_RADIUS = 45.7
const RING_OUTER_RADIUS = 80
const LABEL_RADIUS = (HOLE_RADIUS + RING_OUTER_RADIUS) / 2

// JL-336: `projectId` is the dashboard's currently selected project (null when the
// project filter is 'All'). The legend uses it to link into that project's issue list.
export function DonutChartGadget({ issues, config, projectId = null }) {
  const [hiddenLabels, setHiddenLabels] = useState(new Set())
  const [hoveredLabel, setHoveredLabel] = useState(null)

  const groupBy = config.groupBy || 'status'
  const field = getGroupByField(groupBy)
  // JL-345: colour first, filter second. Colouring the filtered list re-indexed
  // every slice after a hidden one, so the disc and the legend (which colours
  // the unfiltered list) drifted apart. Resolving on `allSegments` and carrying
  // `color` through the filter means both render the same value by construction.
  const allSegments = resolveSegmentColors(groupIssuesBy(issues, field), groupBy)
  const segments = allSegments.filter((s) => !hiddenLabels.has(s.label))
  const total = segments.reduce((sum, s) => sum + s.count, 0)
  const grandTotal = allSegments.reduce((sum, s) => sum + s.count, 0)

  // JL-345: with no issues at all this used to render a blank grey ring with a
  // "0 Total" hole and an empty legend, explaining nothing. Every sibling gadget
  // states it (BarChartGadget, FilterResultsGadget, ActivityStreamGadget), so
  // match BarChartGadget's branch and wording verbatim. Safe to return early —
  // the hooks above have already run.
  if (allSegments.length === 0) {
    return <div className="pie-gadget-empty">No data available</div>
  }

  const toggleLabel = (label) => {
    setHiddenLabels((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const sectorPaths = []
  let angle = 0
  for (const seg of segments) {
    const sweep = total > 0 ? (seg.count / total) * 360 : 0
    if (sweep > 0) {
      sectorPaths.push({ ...seg, path: sectorPath(80, 80, 78, angle, angle + sweep), startAngle: angle, endAngle: angle + sweep })
    }
    angle += sweep
  }

  return (
    <div className="pie-gadget">
      <div className="pie-gadget-chart">
        <div className="pie-gadget-disc donut-disc" style={{ background: buildConicGradient(segments, total) }}>
          {/* JL-318: the hole overlays the SVG hover paths (z-index:1). Without
              pointer-events:none, crossing the ring/hole boundary makes the SVG
              fire mouseleave, clearing hoveredLabel and flickering the tooltip.
              Letting hover pass through to the sector paths keeps the tooltip
              stable across the whole disc (the centre included). */}
          <div className="donut-hole" style={{ pointerEvents: 'none' }}>
            <strong>{grandTotal}</strong>
            <span>Total</span>
          </div>
          {/* onMouseLeave lives on the <svg>, not each slice: clearing the
              hovered label per-slice made the tooltip flicker as the pointer
              crossed sector seams (JL-299). */}
          <svg viewBox="0 0 160 160" className="pie-gadget-svg" onMouseLeave={() => setHoveredLabel(null)}>
            {sectorPaths.map((s) => (
              <path
                key={s.label}
                d={s.path}
                fill="transparent"
                onMouseEnter={() => setHoveredLabel(s.label)}
              />
            ))}
            {config.showLabels !== false && sectorPaths.map((s) => {
              if (s.endAngle - s.startAngle < 18) return null
              const mid = (s.startAngle + s.endAngle) / 2
              const rad = (mid - 90) * (Math.PI / 180)
              const x = 80 + LABEL_RADIUS * Math.cos(rad)
              const y = 80 + LABEL_RADIUS * Math.sin(rad)
              return (
                <text
                  key={`label-${s.label}`}
                  x={x}
                  y={y}
                  className="pie-gadget-slice-label"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {Math.round((s.count / total) * 100)}%
                </text>
              )
            })}
          </svg>
        </div>
        {hoveredLabel && (
          <div className="pie-gadget-tooltip">
            {hoveredLabel}: {segments.find((s) => s.label === hoveredLabel)?.count || 0}
          </div>
        )}
        {/* JL-345: "the user hid everything" is NOT the same as "there is no
            data", so it must not borrow the empty state. There IS data — the
            hole still reads the real grand total — and the legend is the only
            way back, so keep both and caption what happened instead. */}
        {total === 0 && <div className="pie-gadget-all-hidden">All slices hidden</div>}
      </div>
      {(config.showLegend !== false) && (
        <ChartLegend
          segments={allSegments}
          hiddenLabels={hiddenLabels}
          onToggle={toggleLabel}
          groupBy={groupBy}
          projectId={projectId}
          showCounts={config.showLabels !== false}
        />
      )}
    </div>
  )
}
