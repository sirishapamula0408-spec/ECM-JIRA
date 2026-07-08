import { Router } from 'express'
import { all, get } from '../db.js'
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

// JL-87: a sprint_scope row carries its own committed `points` snapshot.
// Prefer that; otherwise fall back to the live story_points / type heuristic.
const scopePoints = (row) => {
  if (row.points !== null && row.points !== undefined && row.points !== '') {
    const parsed = Number(row.points)
    if (Number.isFinite(parsed)) return parsed
  }
  return toPoints(row)
}

const MS_PER_DAY = 86400000
// UTC calendar-day key (YYYY-MM-DD) for a timestamp value; null if unparseable.
const dayKey = (value) => {
  if (value === null || value === undefined) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

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

/* ================================================================
   JL-87: Sprint Report
   Classifies the sprint's issues as COMPLETED (Done), NOT COMPLETED
   (still in the sprint, not Done) and REMOVED (was in the committed
   snapshot but no longer part of the sprint). Reports committed vs
   completed points plus the scope change after start.
   ================================================================ */
router.get('/sprint/:id', asyncHandler(async (req, res) => {
  const sprintId = Number(req.params.id)
  if (!Number.isInteger(sprintId) || sprintId <= 0) {
    return res.status(400).json({ error: 'Invalid sprint id' })
  }

  const sprint = await get(
    'SELECT id, name, date_range, is_started, start_date, end_date, completed_at FROM sprints WHERE id = ?',
    [sprintId],
  )
  if (!sprint) return res.status(404).json({ error: 'Sprint not found' })

  const currentIssues = await all(
    'SELECT id, issue_key, title, status, issue_type, story_points FROM issues WHERE sprint_id = ?',
    [sprintId],
  )
  const scopeRows = await all(
    `SELECT s.issue_id, s.points, s.added_at, s.removed_at,
            i.issue_key, i.title, i.status, i.issue_type, i.story_points, i.sprint_id
     FROM sprint_scope s
     LEFT JOIN issues i ON i.id = s.issue_id
     WHERE s.sprint_id = ?`,
    [sprintId],
  )

  const startTime = sprint.start_date ? new Date(sprint.start_date).getTime() : null
  const currentIds = new Set(currentIssues.map((r) => r.id))

  // Classify the issues that are still in the sprint.
  const completed = []
  const notCompleted = []
  for (const r of currentIssues) {
    const entry = {
      id: r.id,
      key: r.issue_key,
      title: r.title,
      status: r.status,
      points: toPoints(r),
    }
    if (r.status === 'Done') completed.push(entry)
    else notCompleted.push(entry)
  }

  // Walk the committed snapshot to compute committed points + scope change,
  // and to surface issues that were removed from the sprint.
  const removed = []
  let committedIssues = 0
  let committedPoints = 0
  let addedIssues = 0
  let addedPoints = 0
  let scopeRemovedIssues = 0
  let scopeRemovedPoints = 0

  for (const s of scopeRows) {
    const pts = scopePoints(s)
    const addedTime = s.added_at ? new Date(s.added_at).getTime() : null
    const isAddedAfterStart = startTime !== null && addedTime !== null && addedTime > startTime
    const isRemoved = s.removed_at !== null && s.removed_at !== undefined

    if (isAddedAfterStart) {
      addedIssues += 1
      addedPoints += pts
    } else {
      // Present at (or before) sprint start = part of the committed scope.
      committedIssues += 1
      committedPoints += pts
    }

    if (isRemoved) {
      scopeRemovedIssues += 1
      scopeRemovedPoints += pts
    }

    // "Removed" list: was committed but is no longer in the live sprint.
    if (isRemoved || !currentIds.has(s.issue_id)) {
      removed.push({
        id: s.issue_id,
        key: s.issue_key,
        title: s.title,
        status: s.status,
        points: pts,
        removedAt: s.removed_at || null,
      })
    }
  }

  const completedPoints = completed.reduce((sum, e) => sum + e.points, 0)
  const notCompletedPoints = notCompleted.reduce((sum, e) => sum + e.points, 0)
  const removedPoints = removed.reduce((sum, e) => sum + e.points, 0)

  res.json({
    sprint: {
      id: sprint.id,
      name: sprint.name,
      dateRange: sprint.date_range,
      isStarted: sprint.is_started,
      startDate: sprint.start_date,
      endDate: sprint.end_date,
      completedAt: sprint.completed_at,
    },
    summary: {
      committedIssues,
      committedPoints,
      completedIssues: completed.length,
      completedPoints,
      notCompletedIssues: notCompleted.length,
      notCompletedPoints,
      removedIssues: removed.length,
      removedPoints,
      scopeChange: {
        addedIssues,
        addedPoints,
        removedIssues: scopeRemovedIssues,
        removedPoints: scopeRemovedPoints,
      },
    },
    issues: { completed, notCompleted, removed },
  })
}))

/* ================================================================
   JL-87: Created vs Resolved report
   Per-day counts of issues created (created_at) vs first resolved
   (first transition to 'Done' in issue_history), over the last N
   days, plus running cumulative totals.
   ================================================================ */
router.get('/created-resolved', asyncHandler(async (req, res) => {
  const rawProjectId = req.query.projectId
  const projectId = rawProjectId && Number.isFinite(Number(rawProjectId)) ? Number(rawProjectId) : null

  let days = Number.parseInt(req.query.days, 10)
  if (!Number.isFinite(days) || days < 1) days = 30
  if (days > 365) days = 365

  // Window = the last `days` calendar days (UTC), inclusive of today.
  const now = new Date()
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const cutoffMs = todayMs - (days - 1) * MS_PER_DAY
  const cutoffISO = new Date(cutoffMs).toISOString()

  const createdRows = await all(
    projectId
      ? 'SELECT created_at FROM issues WHERE created_at IS NOT NULL AND created_at >= ? AND project_id = ?'
      : 'SELECT created_at FROM issues WHERE created_at IS NOT NULL AND created_at >= ?',
    projectId ? [cutoffISO, projectId] : [cutoffISO],
  )

  // First-Done timestamp per issue: MIN(changed_at) over status→Done rows.
  const resolvedRows = await all(
    projectId
      ? `SELECT MIN(h.changed_at) AS done_at
         FROM issue_history h
         JOIN issues i ON i.id = h.issue_id
         WHERE h.field = ? AND h.new_value = ? AND i.project_id = ?
         GROUP BY h.issue_id
         HAVING MIN(h.changed_at) >= ?`
      : `SELECT MIN(h.changed_at) AS done_at
         FROM issue_history h
         WHERE h.field = ? AND h.new_value = ?
         GROUP BY h.issue_id
         HAVING MIN(h.changed_at) >= ?`,
    projectId ? ['status', 'Done', projectId, cutoffISO] : ['status', 'Done', cutoffISO],
  )

  const createdByDay = new Map()
  for (const r of createdRows) {
    const key = dayKey(r.created_at)
    if (key) createdByDay.set(key, (createdByDay.get(key) || 0) + 1)
  }
  const resolvedByDay = new Map()
  for (const r of resolvedRows) {
    const key = dayKey(r.done_at)
    if (key) resolvedByDay.set(key, (resolvedByDay.get(key) || 0) + 1)
  }

  const series = []
  let cumulativeCreated = 0
  let cumulativeResolved = 0
  for (let i = 0; i < days; i += 1) {
    const date = new Date(cutoffMs + i * MS_PER_DAY).toISOString().slice(0, 10)
    const created = createdByDay.get(date) || 0
    const resolved = resolvedByDay.get(date) || 0
    cumulativeCreated += created
    cumulativeResolved += resolved
    series.push({ date, created, resolved, cumulativeCreated, cumulativeResolved })
  }

  res.json({
    projectId,
    days,
    series,
    totals: { created: cumulativeCreated, resolved: cumulativeResolved },
  })
}))

export default router
