import { Router } from 'express'
import { all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

const POINTS_BY_TYPE = { Story: 8, Bug: 5, Task: 3 }
// JL-86: prefer the real story_points when present; else fall back to the
// legacy per-type heuristic so existing (un-pointed) issues still report.
const toPoints = (row) => {
  if (row.story_points !== null && row.story_points !== undefined && row.story_points !== '') {
    const parsed = Number(row.story_points)
    if (Number.isFinite(parsed)) return parsed
  }
  return POINTS_BY_TYPE[row.issue_type] ?? 3
}

// JL-51: nearest-rank percentile. Filters out non-finite values, sorts
// ascending, and returns the value at rank ceil(p/100 * n). Returns null for
// an empty set. Exported for unit testing.
export function percentile(values, p) {
  const arr = (Array.isArray(values) ? values : [])
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b)
  if (arr.length === 0) return null
  const rank = Math.ceil((p / 100) * arr.length)
  const idx = Math.min(arr.length - 1, Math.max(0, rank - 1))
  return arr[idx]
}

// JL-51: arithmetic mean rounded to 2 decimals; null for an empty set.
export function average(values) {
  const arr = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v))
  if (arr.length === 0) return null
  return Number((arr.reduce((sum, v) => sum + v, 0) / arr.length).toFixed(2))
}

const MS_PER_DAY = 1000 * 60 * 60 * 24

function summarize(values) {
  return {
    p50: percentile(values, 50),
    p85: percentile(values, 85),
    p95: percentile(values, 95),
    average: average(values),
  }
}

// JL-51: Cycle Time Analytics.
//   CYCLE time = first entering 'In Progress' → reaching 'Done' (per issue_history)
//   LEAD  time = issue created_at → reaching 'Done'
// Only issues that reached 'Done' (via issue_history) are counted. Optional
// filters: issueType, priority, assignee. All SQL is parameterized.
router.get('/cycle-time', asyncHandler(async (req, res) => {
  const rawProjectId = req.query.projectId
  const projectId = rawProjectId && Number.isFinite(Number(rawProjectId)) ? Number(rawProjectId) : null
  const { issueType, priority, assignee } = req.query

  const conditions = ["status = 'Done'"]
  const params = []
  if (projectId) {
    conditions.push('project_id = ?')
    params.push(projectId)
  }
  if (issueType) {
    conditions.push('issue_type = ?')
    params.push(issueType)
  }
  if (priority) {
    conditions.push('priority = ?')
    params.push(priority)
  }
  if (assignee) {
    conditions.push('assignee = ?')
    params.push(assignee)
  }

  const issues = await all(
    `SELECT id, issue_key, issue_type, priority, assignee, created_at FROM issues WHERE ${conditions.join(' AND ')}`,
    params,
  )

  const emptyResponse = { issues: [], summary: { count: 0, cycle: summarize([]), lead: summarize([]) } }
  if (!issues.length) {
    res.json(emptyResponse)
    return
  }

  const ids = issues.map((i) => i.id)
  const placeholders = ids.map(() => '?').join(', ')
  const history = await all(
    `SELECT issue_id, new_value, changed_at FROM issue_history
     WHERE field = 'status' AND issue_id IN (${placeholders})
     ORDER BY changed_at ASC, id ASC`,
    ids,
  )

  // Earliest 'In Progress' and earliest 'Done' per issue (history is ASC-sorted).
  const byIssue = new Map()
  for (const row of history) {
    if (!byIssue.has(row.issue_id)) byIssue.set(row.issue_id, { inProgress: null, done: null })
    const rec = byIssue.get(row.issue_id)
    const t = new Date(row.changed_at).getTime()
    if (!Number.isFinite(t)) continue
    if (row.new_value === 'In Progress' && rec.inProgress === null) rec.inProgress = t
    if (row.new_value === 'Done' && rec.done === null) rec.done = t
  }

  const perIssue = []
  for (const issue of issues) {
    const rec = byIssue.get(issue.id)
    // Excluded: no recorded 'Done' transition → cannot be a completed data point.
    if (!rec || rec.done === null) continue
    const createdMs = new Date(issue.created_at).getTime()
    const leadDays = Number.isFinite(createdMs)
      ? Number(((rec.done - createdMs) / MS_PER_DAY).toFixed(2))
      : null
    const cycleDays = rec.inProgress !== null
      ? Number(((rec.done - rec.inProgress) / MS_PER_DAY).toFixed(2))
      : null
    perIssue.push({
      key: issue.issue_key,
      cycleDays,
      leadDays,
      issueType: issue.issue_type,
      priority: issue.priority,
      assignee: issue.assignee,
      doneAt: new Date(rec.done).toISOString(),
    })
  }

  perIssue.sort((a, b) => new Date(a.doneAt) - new Date(b.doneAt))

  const cycleValues = perIssue.map((i) => i.cycleDays).filter((v) => v !== null)
  const leadValues = perIssue.map((i) => i.leadDays).filter((v) => v !== null)

  res.json({
    issues: perIssue,
    summary: {
      count: perIssue.length,
      cycle: summarize(cycleValues),
      lead: summarize(leadValues),
    },
  })
}))

router.get('/', asyncHandler(async (req, res) => {
  const rawProjectId = req.query.projectId
  const projectId = rawProjectId && Number.isFinite(Number(rawProjectId)) ? Number(rawProjectId) : null
  const baseQuery = projectId
    ? 'SELECT priority, status, issue_type, sprint_id, story_points FROM issues WHERE project_id = ?'
    : 'SELECT priority, status, issue_type, sprint_id, story_points FROM issues'
  const params = projectId ? [projectId] : []
  const rows = await all(baseQuery, params)

  const total = rows.length || 1
  const doneCount = rows.filter((r) => r.status === 'Done').length
  const totalPoints = rows.reduce((sum, r) => sum + toPoints(r), 0)

  const high = rows.filter((r) => r.priority === 'High').length
  const medium = rows.filter((r) => r.priority === 'Medium').length
  const low = rows.filter((r) => r.priority === 'Low').length

  const sprints = await all('SELECT id, name, is_started FROM sprints')
  const sprintIssueIds = new Set(rows.map((r) => r.sprint_id).filter(Boolean))
  const relevantSprints = sprints.filter((s) => sprintIssueIds.has(s.id))

  const velocityTrend = relevantSprints.map((sprint) => {
    const sprintIssues = rows.filter((r) => r.sprint_id === sprint.id)
    const committedPoints = sprintIssues.reduce((sum, r) => sum + toPoints(r), 0)
    const completedPoints = sprintIssues.filter((r) => r.status === 'Done').reduce((sum, r) => sum + toPoints(r), 0)
    return { id: sprint.id, name: sprint.name, committedPoints, completedPoints }
  })

  const withPoints = velocityTrend.filter((v) => v.committedPoints > 0)
  const velocityAverage = withPoints.length
    ? Number((withPoints.reduce((sum, v) => sum + v.completedPoints, 0) / withPoints.length).toFixed(1))
    : 0

  const activeSprint = relevantSprints.find((s) => s.is_started) || relevantSprints[0] || null
  const activeSprintIssues = activeSprint ? rows.filter((r) => r.sprint_id === activeSprint.id) : []
  const activeTotal = activeSprintIssues.length || 1
  const activeDone = activeSprintIssues.filter((r) => r.status === 'Done').length

  res.json({
    totalPoints,
    velocityAverage,
    completionRate: Math.round((doneCount / total) * 100),
    sprintProgress: Math.round((activeDone / activeTotal) * 100),
    priorityDistribution: {
      critical: Math.round((high / total) * 100),
      medium: Math.round((medium / total) * 100),
      low: Math.round((low / total) * 100),
    },
    velocityTrend,
  })
}))

export default router
