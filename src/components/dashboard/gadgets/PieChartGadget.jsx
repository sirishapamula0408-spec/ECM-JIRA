import { useState } from 'react'
import { groupIssuesBy, buildConicGradient, sectorPath, resolveSegmentColors, getGroupByField } from './gadgetChartUtils'
import { ChartLegend } from './ChartLegend'

// JL-336: `projectId` is the dashboard's currently selected project (null when the
// project filter is 'All'). The legend uses it to link into that project's issue list.
export function PieChartGadget({ issues, config, projectId = null }) {
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
  // Legend percentages are always "share of everything", hidden slices included,
  // so they don't jump around as slices are toggled off (JL-336: this used to be
  // an inline expression that reconstructed the same grand total the long way).
  const grandTotal = allSegments.reduce((sum, s) => sum + s.count, 0)

  // JL-345: with no issues at all this used to render a blank grey disc above an
  // empty legend, with nothing to say why. Every sibling gadget states it
  // (BarChartGadget, FilterResultsGadget, ActivityStreamGadget), so match
  // BarChartGadget's branch and wording verbatim. Safe to return early — the
  // hooks above have already run.
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

  // Build SVG sector paths for click targets
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
        <div className="pie-gadget-disc" style={{ background: buildConicGradient(segments, total) }}>
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
              const x = 80 + 50 * Math.cos(rad)
              const y = 80 + 50 * Math.sin(rad)
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
            data", so it must not borrow the empty state. There IS data, and the
            legend is the only way back — replacing the gadget with "No data
            available" would both lie and strand the user. Keep the disc (blank
            grey) and the legend, and caption what happened. */}
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
          grandTotal={grandTotal}
        />
      )}
    </div>
  )
}
