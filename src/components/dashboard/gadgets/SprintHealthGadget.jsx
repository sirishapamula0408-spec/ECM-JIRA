import { useEffect, useMemo, useState } from 'react'
import { fetchBurndown } from '../../../api/dashboardApi'

// JL-346: this gadget used to *invent* its "Actual" line —
//   Math.min(doneCount, Math.round(burnPerDay * d * (0.6 + Math.random() * 0.8)))
// evaluated in the component body, with no memo and no seed. Two problems:
//   1. the chart redrew to a different shape on every re-render (hovering a
//      sibling gadget, resizing, any parent state change silently rewrote it);
//   2. more importantly, it presented fabricated numbers as a burndown while
//      being advertised in the Add Gadget catalog as a real sprint burndown.
// Stabilising the random walk would only have made the lie consistent, so the
// series now comes from the real endpoint (GET /api/reports/burndown), the same
// one the Reports page uses. Everything rendered is derived from that response
// inside a useMemo, so identical inputs always produce an identical chart.

const VIEW_W = 300
const VIEW_H = 200
const PAD_L = 35
const PAD_R = 10
const PAD_T = 10
const PAD_B = 30
const CHART_W = VIEW_W - PAD_L - PAD_R
const CHART_H = VIEW_H - PAD_T - PAD_B

// At most this many x-axis labels, evenly spaced across the sprint.
const MAX_X_LABELS = 6

function pickLabelIndices(count) {
  if (count <= MAX_X_LABELS) return Array.from({ length: count }, (_, i) => i)
  const step = (count - 1) / (MAX_X_LABELS - 1)
  const seen = new Set()
  for (let i = 0; i < MAX_X_LABELS; i++) seen.add(Math.round(i * step))
  return Array.from(seen).sort((a, b) => a - b)
}

// 'YYYY-MM-DD' -> 'MM-DD'; anything unexpected passes through untouched.
function shortDate(date) {
  return typeof date === 'string' && date.length === 10 ? date.slice(5) : String(date ?? '')
}

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)

export function SprintHealthGadget({ sprintId = null, config = {} }) {
  // The gadget counts issues by default; a configured gadget may ask for story
  // points instead. Both are supported by /api/reports/burndown.
  const unit = config?.unit === 'points' ? 'points' : 'count'
  const resolvedSprintId = Number.isFinite(Number(sprintId)) && Number(sprintId) > 0 ? Number(sprintId) : null

  // The request identity. Results are stored tagged with the request they came
  // from, so "is this still loading?" is derived rather than tracked with an
  // extra synchronous setState inside the effect.
  const requestKey = resolvedSprintId ? `${resolvedSprintId}:${unit}` : ''
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!resolvedSprintId) return undefined
    let cancelled = false
    fetchBurndown(resolvedSprintId, unit)
      .then((res) => {
        if (!cancelled) setResult({ key: `${resolvedSprintId}:${unit}`, data: res || null, error: '' })
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({ key: `${resolvedSprintId}:${unit}`, data: null, error: err?.message || 'Failed to load burndown data' })
        }
      })
    return () => { cancelled = true }
  }, [resolvedSprintId, unit])

  const fresh = result && result.key === requestKey ? result : null
  const state = {
    status: !resolvedSprintId ? 'no-sprint' : !fresh ? 'loading' : fresh.error ? 'error' : 'ready',
    data: fresh?.data ?? null,
    error: fresh?.error || '',
  }

  // All chart geometry is a pure function of the fetched days — memoised so a
  // parent re-render can never change the rendered series (JL-346).
  const chart = useMemo(() => {
    const days = Array.isArray(state.data?.days) ? state.data.days : []
    if (days.length === 0) return null

    const committed = num(state.data?.committedPoints)
    const maxY = Math.max(
      committed,
      ...days.map((d) => Math.max(num(d.remaining), num(d.ideal))),
      1,
    )
    const lastIdx = days.length - 1
    const toX = (i) => PAD_L + (lastIdx === 0 ? CHART_W / 2 : (i / lastIdx) * CHART_W)
    const toY = (val) => PAD_T + (1 - num(val) / maxY) * CHART_H

    const actualPoints = days.map((d, i) => ({
      date: d.date,
      remaining: num(d.remaining),
      x: toX(i),
      y: toY(d.remaining),
    }))

    return {
      maxY,
      actualPoints,
      idealPolyline: days.map((d, i) => `${toX(i)},${toY(d.ideal)}`).join(' '),
      actualPolyline: actualPoints.map((p) => `${p.x},${p.y}`).join(' '),
      xLabels: pickLabelIndices(days.length).map((i) => ({ i, x: toX(i), label: shortDate(days[i].date) })),
      yTicks: Array.from(new Set([0, Math.round(maxY / 2), Math.round(maxY)])).sort((a, b) => a - b),
      committed,
      completed: Math.max(0, committed - num(days[lastIdx].remaining)),
    }
  }, [state.data])

  if (state.status === 'no-sprint') {
    return (
      <div className="sprint-health-gadget sprint-health-gadget--empty">
        <p className="sprint-health-empty">No active sprint.</p>
        <p className="sprint-health-empty-hint">Start a sprint, or pick one in this gadget&apos;s settings.</p>
      </div>
    )
  }

  if (state.status === 'loading') {
    return (
      <div className="sprint-health-gadget sprint-health-gadget--empty">
        <p className="sprint-health-empty" role="status">Loading burndown…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="sprint-health-gadget sprint-health-gadget--empty">
        <p className="sprint-health-empty sprint-health-error" role="alert">{state.error}</p>
      </div>
    )
  }

  if (!chart) {
    return (
      <div className="sprint-health-gadget sprint-health-gadget--empty">
        <p className="sprint-health-empty">No burndown data for this sprint.</p>
      </div>
    )
  }

  const unitLabel = unit === 'points' ? 'Points' : 'Issues'

  return (
    <div className="sprint-health-gadget">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="sprint-health-svg"
        role="img"
        aria-label={`Sprint burndown: ideal versus remaining ${unitLabel.toLowerCase()}`}
      >
        {/* Grid lines */}
        {chart.yTicks.map((val) => {
          const y = PAD_T + (1 - val / chart.maxY) * CHART_H
          return (
            <g key={val}>
              <line x1={PAD_L} y1={y} x2={VIEW_W - PAD_R} y2={y} stroke="#dfe1e6" strokeWidth="0.5" />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize="8" fill="#6b778c">{val}</text>
            </g>
          )
        })}

        {/* X-axis labels */}
        {chart.xLabels.map((t) => (
          <text key={t.i} x={t.x} y={VIEW_H - 8} textAnchor="middle" fontSize="8" fill="#6b778c">{t.label}</text>
        ))}

        {/* Ideal line (dashed) */}
        <polyline
          data-testid="sprint-health-ideal"
          points={chart.idealPolyline}
          fill="none"
          stroke="#8993a4"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />

        {/* Actual (measured) line */}
        <polyline
          data-testid="sprint-health-actual"
          points={chart.actualPolyline}
          fill="none"
          stroke="#0052cc"
          strokeWidth="2"
        />

        {/* Data point circles */}
        {chart.actualPoints.map((p) => (
          <circle key={p.date} cx={p.x} cy={p.y} r="3" fill="#0052cc" stroke="#fff" strokeWidth="1">
            <title>{`${p.date}: ${p.remaining} remaining`}</title>
          </circle>
        ))}

        {/* Axis labels */}
        <text x={VIEW_W / 2} y={VIEW_H} textAnchor="middle" fontSize="8" fill="#6b778c">Sprint Day</text>
        <text x="4" y={VIEW_H / 2} textAnchor="middle" fontSize="8" fill="#6b778c" transform={`rotate(-90, 8, ${VIEW_H / 2})`}>{unitLabel}</text>
      </svg>
      <div className="sprint-health-legend">
        <span><i className="legend-line legend-line--dashed" /> Ideal</span>
        <span><i className="legend-line legend-line--solid" /> Actual</span>
        <span className="sprint-health-stat">{chart.completed}/{chart.committed} completed</span>
      </div>
    </div>
  )
}
