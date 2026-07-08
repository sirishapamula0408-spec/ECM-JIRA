import { useState } from 'react'

/**
 * SvgAreaChart — self-contained stacked-area chart (no external chart library).
 *
 * Built for the JL-50 Cumulative Flow Diagram: renders one filled band per
 * series, stacked so the top edge is the cumulative total across all series.
 *
 * Props:
 *   data:   Array<{ label: string, [key]: number }>
 *   series: Array<{ key: string, name?: string, color?: string }>  (bottom → top)
 *   width, height: chart dimensions in px
 *   ariaLabel: accessible label for the <svg>
 */
export function SvgAreaChart({
  data = [],
  series = [],
  width = 640,
  height = 300,
  ariaLabel = 'Stacked area chart',
}) {
  const [hover, setHover] = useState(null)

  const padding = { top: 16, right: 16, bottom: 40, left: 44 }
  const innerW = Math.max(0, width - padding.left - padding.right)
  const innerH = Math.max(0, height - padding.top - padding.bottom)

  const seriesList = Array.isArray(series) && series.length ? series : []
  const rows = Array.isArray(data) ? data : []

  // Max stack height = the largest cumulative total across all rows.
  const maxValue = Math.max(
    1,
    ...rows.map((row) => seriesList.reduce((sum, s) => sum + (Number(row[s.key]) || 0), 0)),
  )

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    value: Math.round(maxValue * t),
    y: padding.top + innerH - innerH * t,
  }))

  const xFor = (i) =>
    rows.length <= 1
      ? padding.left + innerW / 2
      : padding.left + (i / (rows.length - 1)) * innerW
  const yFor = (value) => padding.top + innerH - (value / maxValue) * innerH

  const defaultColors = ['#c1c7d0', '#4c9aff', '#ff991f', '#6554c0', '#36b37e']

  // Precompute cumulative lower/upper edges per series per row.
  const cumulativeBelow = rows.map(() => 0)
  const bands = seriesList.map((s, si) => {
    const points = rows.map((row, i) => {
      const value = Number(row[s.key]) || 0
      const lower = cumulativeBelow[i]
      const upper = lower + value
      cumulativeBelow[i] = upper
      return { i, x: xFor(i), yLower: yFor(lower), yUpper: yFor(upper), value }
    })
    // Path: top edge left→right, then bottom edge right→left.
    const top = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yUpper}`).join(' ')
    const bottom = points.slice().reverse().map((p) => `L ${p.x} ${p.yLower}`).join(' ')
    const d = `${top} ${bottom} Z`
    const color = s.color || defaultColors[si % defaultColors.length]
    return { s, si, color, d, points }
  })

  return (
    <div className="svg-chart" style={{ position: 'relative', width: '100%', maxWidth: width }}>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y axis grid + labels */}
        {ticks.map((tick, i) => (
          <g key={`tick-${i}`}>
            <line
              x1={padding.left}
              y1={tick.y}
              x2={padding.left + innerW}
              y2={tick.y}
              stroke="var(--jira-border, #dfe1e6)"
              strokeWidth="1"
              strokeDasharray={i === 0 ? '0' : '3 3'}
            />
            <text
              x={padding.left - 6}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--jira-text-muted, #6b778c)"
            >
              {tick.value}
            </text>
          </g>
        ))}

        {/* Stacked bands (bottom series first) */}
        {bands.map((band) => (
          <path
            key={`band-${band.s.key}`}
            d={band.d}
            fill={band.color}
            fillOpacity={hover && hover.si !== band.si ? 0.45 : 0.85}
            stroke={band.color}
            strokeWidth="1"
          />
        ))}

        {/* Hover hit-areas (one vertical strip per row) */}
        {rows.map((row, i) => {
          const stripW = rows.length > 1 ? innerW / (rows.length - 1) : innerW
          return (
            <rect
              key={`hit-${i}`}
              x={xFor(i) - stripW / 2}
              y={padding.top}
              width={stripW}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover({ i, x: xFor(i), label: row.label, row })}
              onMouseLeave={() => setHover(null)}
            />
          )
        })}

        {/* X axis labels (thinned to avoid overlap) */}
        {rows.map((row, i) => {
          const everyN = Math.max(1, Math.ceil(rows.length / 8))
          if (i % everyN !== 0 && i !== rows.length - 1) return null
          return (
            <text
              key={`xlabel-${i}`}
              x={xFor(i)}
              y={height - padding.bottom + 16}
              textAnchor="middle"
              fontSize="9"
              fill="var(--jira-text-muted, #6b778c)"
            >
              {String(row.label ?? '').slice(5)}
            </text>
          )
        })}

        {/* X axis baseline */}
        <line
          x1={padding.left}
          y1={padding.top + innerH}
          x2={padding.left + innerW}
          y2={padding.top + innerH}
          stroke="var(--jira-border-strong, #c1c7d0)"
          strokeWidth="1"
        />

        {/* Hover guide line */}
        {hover && (
          <line
            x1={hover.x}
            y1={padding.top}
            x2={hover.x}
            y2={padding.top + innerH}
            stroke="var(--jira-border-strong, #c1c7d0)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {hover && (
        <div
          className="svg-chart-tooltip"
          style={{
            position: 'absolute',
            left: `${(hover.x / width) * 100}%`,
            top: padding.top,
            transform: 'translate(-50%, 0)',
            background: 'var(--jira-surface, #fff)',
            border: '1px solid var(--jira-border-strong, #c1c7d0)',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 12,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(9,30,66,0.25)',
            zIndex: 2,
          }}
        >
          <strong>{hover.label}</strong>
          {seriesList.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: s.color || '#4c9aff',
                }}
              />
              {s.name || s.key}: {Number(hover.row[s.key]) || 0}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default SvgAreaChart
