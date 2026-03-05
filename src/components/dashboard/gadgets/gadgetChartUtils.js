export const COLOR_PALETTES = {
  status: {
    'Backlog': '#8993a4',
    'To Do': '#a95be7',
    'In Progress': '#7fb239',
    'Code Review': '#4c9aff',
    'Done': '#00875a',
  },
  priority: {
    'High': '#de350b',
    'Medium': '#ff991f',
    'Low': '#00875a',
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
  const palette = COLOR_PALETTES[groupBy]
  if (palette && palette[key]) return palette[key]
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length]
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
