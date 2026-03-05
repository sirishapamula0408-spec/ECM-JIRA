export function SprintHealthGadget({ issues }) {
  // Build burndown data: simulate a 2-week sprint
  const totalIssues = issues.length
  const doneCount = issues.filter((i) => i.status === 'Done').length
  const sprintDays = 10
  const dailyIdeal = totalIssues / sprintDays

  // Generate ideal line points
  const idealPoints = []
  for (let d = 0; d <= sprintDays; d++) {
    idealPoints.push({ day: d, remaining: totalIssues - dailyIdeal * d })
  }

  // Simulate actual burndown: done items burned down gradually
  const actualPoints = []
  const burnPerDay = doneCount / sprintDays
  for (let d = 0; d <= sprintDays; d++) {
    const burned = Math.min(doneCount, Math.round(burnPerDay * d * (0.6 + Math.random() * 0.8)))
    actualPoints.push({ day: d, remaining: Math.max(0, totalIssues - burned) })
  }
  // Ensure last point matches actual remaining
  actualPoints[sprintDays] = { day: sprintDays, remaining: totalIssues - doneCount }

  const viewW = 300
  const viewH = 200
  const padL = 35
  const padR = 10
  const padT = 10
  const padB = 30
  const chartW = viewW - padL - padR
  const chartH = viewH - padT - padB
  const maxY = Math.max(totalIssues, 1)

  const toX = (day) => padL + (day / sprintDays) * chartW
  const toY = (val) => padT + (1 - val / maxY) * chartH

  const idealPolyline = idealPoints.map((p) => `${toX(p.day)},${toY(p.remaining)}`).join(' ')
  const actualPolyline = actualPoints.map((p) => `${toX(p.day)},${toY(p.remaining)}`).join(' ')

  // Y-axis ticks
  const yTicks = [0, Math.round(maxY / 2), maxY]

  return (
    <div className="sprint-health-gadget">
      <svg viewBox={`0 0 ${viewW} ${viewH}`} className="sprint-health-svg">
        {/* Grid lines */}
        {yTicks.map((val) => (
          <g key={val}>
            <line x1={padL} y1={toY(val)} x2={viewW - padR} y2={toY(val)} stroke="#dfe1e6" strokeWidth="0.5" />
            <text x={padL - 6} y={toY(val) + 3} textAnchor="end" fontSize="8" fill="#6b778c">{val}</text>
          </g>
        ))}

        {/* X-axis labels */}
        {[0, 2, 4, 6, 8, 10].map((d) => (
          <text key={d} x={toX(d)} y={viewH - 8} textAnchor="middle" fontSize="8" fill="#6b778c">D{d}</text>
        ))}

        {/* Ideal line (dashed) */}
        <polyline points={idealPolyline} fill="none" stroke="#8993a4" strokeWidth="1.5" strokeDasharray="4 3" />

        {/* Actual line */}
        <polyline points={actualPolyline} fill="none" stroke="#0052cc" strokeWidth="2" />

        {/* Data point circles */}
        {actualPoints.map((p) => (
          <circle key={p.day} cx={toX(p.day)} cy={toY(p.remaining)} r="3" fill="#0052cc" stroke="#fff" strokeWidth="1" />
        ))}

        {/* Axis labels */}
        <text x={viewW / 2} y={viewH - 0} textAnchor="middle" fontSize="8" fill="#6b778c">Sprint Day</text>
        <text x="4" y={viewH / 2} textAnchor="middle" fontSize="8" fill="#6b778c" transform={`rotate(-90, 8, ${viewH / 2})`}>Issues</text>
      </svg>
      <div className="sprint-health-legend">
        <span><i className="legend-line legend-line--dashed" /> Ideal</span>
        <span><i className="legend-line legend-line--solid" /> Actual</span>
        <span className="sprint-health-stat">{doneCount}/{totalIssues} completed</span>
      </div>
    </div>
  )
}
