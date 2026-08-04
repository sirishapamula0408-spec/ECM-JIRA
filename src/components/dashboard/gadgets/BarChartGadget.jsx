import { groupIssuesBy, resolveSegmentColors, getGroupByField } from './gadgetChartUtils'

export function BarChartGadget({ issues, config }) {
  const groupBy = config.groupBy || 'priority'
  const field = getGroupByField(groupBy)
  // JL-345: same helper as the pie/donut so segment colours are decided in one
  // place. The bar chart has no hide-a-series affordance, so it never had the
  // re-indexing bug — this is purely to keep one source of truth.
  const segments = resolveSegmentColors(groupIssuesBy(issues, field), groupBy)
  const max = Math.max(1, ...segments.map((s) => s.count))
  const isVertical = config.orientation === 'vertical'

  if (segments.length === 0) {
    return <div className="bar-gadget-empty">No data available</div>
  }

  if (isVertical) {
    return (
      <div className="bar-gadget bar-gadget--vertical">
        <div className="bar-gadget-v-chart">
          {segments.map((s) => (
            <div key={s.label} className="bar-gadget-v-col">
              <div className="bar-gadget-v-bar-wrap">
                <div
                  className="bar-gadget-v-bar"
                  style={{ height: `${(s.count / max) * 100}%`, background: s.color }}
                  title={`${s.label}: ${s.count}`}
                />
              </div>
              <span className="bar-gadget-v-label">{s.label}</span>
              {config.showLabels !== false && <span className="bar-gadget-v-count">{s.count}</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bar-gadget bar-gadget--horizontal">
      {segments.map((s) => (
        <div key={s.label} className="bar-gadget-row">
          <span className="bar-gadget-label">{s.label}</span>
          <div className="bar-gadget-track">
            <div
              className="bar-gadget-bar"
              style={{ width: `${Math.max(4, (s.count / max) * 100)}%`, background: s.color }}
              title={`${s.label}: ${s.count}`}
            />
          </div>
          {config.showLabels !== false && <strong className="bar-gadget-count">{s.count}</strong>}
        </div>
      ))}
    </div>
  )
}
