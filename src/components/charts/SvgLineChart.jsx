import { useState } from 'react'

/**
 * SvgLineChart — self-contained SVG line chart (no external chart library).
 *
 * Reusable charting foundation for analytics tickets (JL-49/50/51).
 *
 * Props:
 *   data:   Array<{ label: string, [key]: number }>
 *   series: Array<{ key: string, name?: string, color?: string }>
 *   width, height: chart dimensions in px
 *   ariaLabel: accessible label for the <svg>
 */
export function SvgLineChart({
  data = [],
  series = [{ key: 'value', name: 'Value', color: '#4c9aff' }],
  width = 480,
  height = 260,
  ariaLabel = 'Line chart',
}) {
  const [hover, setHover] = useState(null)

  const padding = { top: 16, right: 16, bottom: 36, left: 40 }
  const innerW = Math.max(0, width - padding.left - padding.right)
  const innerH = Math.max(0, height - padding.top - padding.bottom)

  const seriesList = Array.isArray(series) && series.length ? series : []
  const rows = Array.isArray(data) ? data : []

  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => seriesList.map((s) => Number(row[s.key]) || 0)),
  )

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    value: Math.round(maxValue * t),
    y: padding.top + innerH - innerH * t,
  }))

  const xFor = (i) =>
    rows.length <= 1
      ? padding.left + innerW / 2
      : padding.left + (i / (rows.length - 1)) * innerW
  const yFor = (value) => padding.top + innerH - ((Number(value) || 0) / maxValue) * innerH

  const defaultColors = ['#4c9aff', '#36b37e', '#ff991f', '#de350b', '#6554c0']

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

        {/* Lines + points per series */}
        {seriesList.map((s, si) => {
          const color = s.color || defaultColors[si % defaultColors.length]
          const points = rows.map((row, i) => ({ x: xFor(i), y: yFor(row[s.key]), row, value: Number(row[s.key]) || 0 }))
          const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
          return (
            <g key={`series-${s.key}`}>
              {points.length > 1 && (
                <path d={path} fill="none" stroke={color} strokeWidth="2" className="svg-line" />
              )}
              {points.map((p, i) => (
                <circle
                  key={`pt-${si}-${i}`}
                  className="svg-line-point"
                  cx={p.x}
                  cy={p.y}
                  r={hover && hover.si === si && hover.i === i ? 5 : 3}
                  fill={color}
                  onMouseEnter={() =>
                    setHover({ si, i, value: p.value, label: p.row.label, name: s.name || s.key, x: p.x, y: p.y })
                  }
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{`${p.row.label} — ${s.name || s.key}: ${p.value}`}</title>
                </circle>
              ))}
            </g>
          )
        })}

        {/* X axis labels */}
        {rows.map((row, i) => (
          <text
            key={`xlabel-${i}`}
            x={xFor(i)}
            y={height - padding.bottom + 16}
            textAnchor="middle"
            fontSize="10"
            fill="var(--jira-text-muted, #6b778c)"
          >
            {String(row.label ?? '').length > 12
              ? `${String(row.label).slice(0, 11)}…`
              : row.label}
          </text>
        ))}

        {/* X axis baseline */}
        <line
          x1={padding.left}
          y1={padding.top + innerH}
          x2={padding.left + innerW}
          y2={padding.top + innerH}
          stroke="var(--jira-border-strong, #c1c7d0)"
          strokeWidth="1"
        />
      </svg>

      {hover && (
        <div
          className="svg-chart-tooltip"
          style={{
            position: 'absolute',
            left: `${(hover.x / width) * 100}%`,
            top: hover.y - 8,
            transform: 'translate(-50%, -100%)',
            background: 'var(--jira-surface, #fff)',
            border: '1px solid var(--jira-border-strong, #c1c7d0)',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 12,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(9,30,66,0.25)',
            zIndex: 2,
          }}
        >
          <strong>{hover.label}</strong> — {hover.name}: {hover.value}
        </div>
      )}
    </div>
  )
}

export default SvgLineChart
