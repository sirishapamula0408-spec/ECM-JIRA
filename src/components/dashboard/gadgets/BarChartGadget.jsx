import { groupIssuesBy, getColor, getGroupByField } from './gadgetChartUtils'

export function BarChartGadget({ issues, config }) {
  const field = getGroupByField(config.groupBy || 'priority')
  const segments = groupIssuesBy(issues, field).map((s, i) => ({
    ...s,
    color: getColor(config.groupBy || 'priority', s.label, i),
  }))
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
