import { useState } from 'react'

/**
 * SvgBarChart — self-contained SVG bar chart (no external chart library).
 *
 * Reusable charting foundation for analytics tickets (JL-49/50/51).
 *
 * Props:
 *   data:   Array<{ label: string, [key]: number }>
 *   series: Array<{ key: string, name?: string, color?: string }>
 *   width, height: chart dimensions in px
 *   grouped: when true (default) bars for each series render side-by-side per group
 *   ariaLabel: accessible label for the <svg>
 */
export function SvgBarChart({
  data = [],
  series = [{ key: 'value', name: 'Value', color: '#4c9aff' }],
  width = 480,
  height = 260,
  grouped = true,
  ariaLabel = 'Bar chart',
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

  // Y axis ticks (0, mid, max)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    value: Math.round(maxValue * t),
    y: padding.top + innerH - innerH * t,
  }))

  const groupWidth = rows.length ? innerW / rows.length : innerW
  const barGap = 4
  const barCount = grouped ? Math.max(1, seriesList.length) : 1
  const usableGroupWidth = groupWidth * 0.7
  const barWidth = Math.max(2, (usableGroupWidth - barGap * (barCount - 1)) / barCount)

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

        {/* Bars */}
        {rows.map((row, gi) => {
          const groupX = padding.left + gi * groupWidth
          const groupInnerStart = groupX + (groupWidth - usableGroupWidth) / 2
          return (
            <g key={`group-${row.label ?? gi}`}>
              {seriesList.map((s, si) => {
                const value = Number(row[s.key]) || 0
                const barH = (value / maxValue) * innerH
                const x = grouped
                  ? groupInnerStart + si * (barWidth + barGap)
                  : groupInnerStart
                const y = padding.top + innerH - barH
                const color = s.color || defaultColors[si % defaultColors.length]
                const isHover = hover && hover.gi === gi && hover.si === si
                return (
                  <rect
                    key={`bar-${gi}-${si}`}
                    className="svg-bar"
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(0, barH)}
                    rx="3"
                    fill={color}
                    opacity={isHover ? 0.8 : 1}
                    onMouseEnter={() =>
                      setHover({ gi, si, value, label: row.label, name: s.name || s.key, x: x + barWidth / 2, y })
                    }
                    onMouseLeave={() => setHover(null)}
                  >
                    <title>{`${row.label} — ${s.name || s.key}: ${value}`}</title>
                  </rect>
                )
              })}
              {/* X axis label */}
              <text
                x={groupX + groupWidth / 2}
                y={height - padding.bottom + 16}
                textAnchor="middle"
                fontSize="10"
                fill="var(--jira-text-muted, #6b778c)"
              >
                {String(row.label ?? '').length > 12
                  ? `${String(row.label).slice(0, 11)}…`
                  : row.label}
              </text>
            </g>
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

export default SvgBarChart
