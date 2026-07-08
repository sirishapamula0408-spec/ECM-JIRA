import { Router } from 'express'
import { all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// JL-50: canonical status order for the Cumulative Flow Diagram bands.
const CFD_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done']

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
   JL-50: Cumulative Flow Diagram (CFD)
   GET /api/reports/cfd?projectId=&days=30&granularity=daily|weekly

   For each sampled day in the range we reconstruct how many issues sat
   in each status *as of end-of-day*, derived from issue_history:
     - an issue's status on day D = the latest status change with
       changed_at <= end-of-day-D; else its creation (initial) status.
     - issues created after end-of-day-D are not yet counted.
   ================================================================ */

const DAY_MS = 24 * 60 * 60 * 1000

// End-of-day (last millisecond) for the given Date, in UTC.
const endOfDayUTC = (date) => {
  const d = new Date(date)
  d.setUTCHours(23, 59, 59, 999)
  return d
}

// YYYY-MM-DD label for a Date, in UTC.
const isoDate = (date) => new Date(date).toISOString().slice(0, 10)

router.get('/cfd', asyncHandler(async (req, res) => {
  const rawProjectId = req.query.projectId
  const projectId = rawProjectId && Number.isFinite(Number(rawProjectId)) ? Number(rawProjectId) : null

  const daysParam = Number(req.query.days)
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 365) : 30

  const granularity = req.query.granularity === 'weekly' ? 'weekly' : 'daily'
  const step = granularity === 'weekly' ? 7 : 1

  // Fetch issues (current status + creation time) and their status history.
  const issueQuery = projectId
    ? 'SELECT id, status, created_at FROM issues WHERE project_id = ?'
    : 'SELECT id, status, created_at FROM issues'
  const historyQuery = projectId
    ? `SELECT h.issue_id, h.old_value, h.new_value, h.changed_at
         FROM issue_history h
         JOIN issues i ON i.id = h.issue_id
        WHERE h.field = 'status' AND i.project_id = ?
        ORDER BY h.changed_at ASC, h.id ASC`
    : `SELECT issue_id, old_value, new_value, changed_at
         FROM issue_history
        WHERE field = 'status'
        ORDER BY changed_at ASC, id ASC`
  const params = projectId ? [projectId] : []

  const [issues, history] = await Promise.all([
    all(issueQuery, params),
    all(historyQuery, params),
  ])

  // Group ordered status changes per issue.
  const historyByIssue = new Map()
  for (const h of history) {
    if (!historyByIssue.has(h.issue_id)) historyByIssue.set(h.issue_id, [])
    historyByIssue.get(h.issue_id).push({
      oldValue: h.old_value,
      newValue: h.new_value,
      changedAt: new Date(h.changed_at).getTime(),
    })
  }

  // Precompute per-issue: creation time, initial status, sorted changes,
  // and (if applicable) the moment it first reached Done — for lead time.
  const models = issues.map((issue) => {
    const changes = historyByIssue.get(issue.id) || []
    const createdAt = new Date(issue.created_at).getTime()
    // Initial status = the old_value of the earliest change; else the
    // issue's current status when it never changed.
    const initialStatus = changes.length ? changes[0].oldValue : issue.status
    const doneChange = changes.find((c) => c.newValue === 'Done')
    const doneAt = doneChange ? doneChange.changedAt
      : (issue.status === 'Done' && changes.length === 0 ? createdAt : null)
    return { createdAt, initialStatus, changes, currentStatus: issue.status, doneAt }
  })

  // Build the sampled day range: end = today (end-of-day), going back `days`.
  const today = endOfDayUTC(new Date())
  const startMs = today.getTime() - (days - 1) * DAY_MS
  const sampleDays = []
  for (let ms = startMs; ms <= today.getTime(); ms += step * DAY_MS) {
    sampleDays.push(endOfDayUTC(new Date(ms)))
  }
  // Always include the final day even when step doesn't divide the range.
  if (sampleDays.length && sampleDays[sampleDays.length - 1].getTime() < today.getTime()) {
    sampleDays.push(today)
  }

  const statusOf = (model, cutoffMs) => {
    // Latest change at or before cutoff wins; else the initial status.
    let status = model.initialStatus
    for (const change of model.changes) {
      if (change.changedAt <= cutoffMs) status = change.newValue
      else break
    }
    return status
  }

  const daysOut = sampleDays.map((day) => {
    const cutoff = day.getTime()
    const counts = {}
    for (const status of CFD_STATUSES) counts[status] = 0
    for (const model of models) {
      if (model.createdAt > cutoff) continue // not created yet
      const status = statusOf(model, cutoff)
      if (counts[status] === undefined) counts[status] = 0
      counts[status] += 1
    }
    return { date: isoDate(day), counts }
  })

  // Metrics: current WIP (non-Done, non-Backlog) + average lead time (days).
  const currentWip = models.filter(
    (m) => m.currentStatus !== 'Done' && m.currentStatus !== 'Backlog',
  ).length

  const leadTimes = models
    .filter((m) => m.doneAt !== null)
    .map((m) => Math.max(0, (m.doneAt - m.createdAt) / DAY_MS))
  const averageLeadTime = leadTimes.length
    ? Number((leadTimes.reduce((sum, v) => sum + v, 0) / leadTimes.length).toFixed(1))
    : 0

  res.json({
    statuses: CFD_STATUSES,
    granularity,
    rangeDays: days,
    days: daysOut,
    metrics: { currentWip, averageLeadTime },
  })
}))

export default router
