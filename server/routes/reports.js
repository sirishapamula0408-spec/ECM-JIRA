import { Router } from 'express'
import { all, get } from '../db.js'
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

/* ============================================================
   JL-49: Burndown / Burnup chart data
   ============================================================ */

// Millis in one day — used to walk the sprint's calendar day-by-day.
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DAYS = 366 // guard against runaway ranges

const parseDate = (value) => {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// Truncate an instant to the start of its UTC calendar day.
const startOfUtcDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
// The final instant of a UTC calendar day (inclusive upper bound for that day).
const endOfUtcDay = (d) => new Date(startOfUtcDay(d).getTime() + DAY_MS - 1)
const isoDay = (d) => startOfUtcDay(d).toISOString().slice(0, 10)

// Build an inclusive list of UTC calendar days between two instants.
const buildDayRange = (start, end) => {
  const days = []
  let cursor = startOfUtcDay(start).getTime()
  const last = startOfUtcDay(end).getTime()
  while (cursor <= last && days.length < MAX_DAYS) {
    days.push(new Date(cursor))
    cursor += DAY_MS
  }
  return days
}

// Value of a scope row given the requested unit. In `count` mode every issue
// weighs 1; in `points` mode we prefer the snapshotted points, then the real
// story_points, then the per-type heuristic.
const scopeValue = (row, unit) => {
  if (unit === 'count') return 1
  if (row.points !== null && row.points !== undefined && row.points !== '') {
    const parsed = Number(row.points)
    if (Number.isFinite(parsed)) return parsed
  }
  return toPoints(row)
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

// True when a scope row was in the sprint at instant `t`.
const inScopeAt = (row, addedAt, removedAt, t) => {
  if (addedAt && addedAt.getTime() > t) return false
  if (removedAt && removedAt.getTime() <= t) return false
  return true
}

// Shared loader: validates the sprint id, loads the sprint, its scope rows and
// the first time each in-scope issue reached 'Done'. Returns null (after
// sending an error response) when the request is invalid or the sprint is
// missing.
async function loadSprintSeries(req, res) {
  const rawId = req.query.sprintId
  const sprintId = rawId !== undefined && Number.isInteger(Number(rawId)) ? Number(rawId) : null
  if (sprintId === null) {
    res.status(400).json({ error: 'sprintId is required' })
    return null
  }

  const sprint = await get(
    'SELECT id, name, start_date, end_date, completed_at FROM sprints WHERE id = ?',
    [sprintId],
  )
  if (!sprint) {
    res.status(404).json({ error: 'Sprint not found' })
    return null
  }

  const unit = req.query.unit === 'count' ? 'count' : 'points'

  const scopeRows = await all(
    `SELECT s.issue_id, s.points, s.added_at, s.removed_at, i.issue_type, i.story_points
       FROM sprint_scope s
       JOIN issues i ON i.id = s.issue_id
      WHERE s.sprint_id = ?`,
    [sprintId],
  )

  const doneRows = await all(
    `SELECT h.issue_id, MIN(h.changed_at) AS done_at
       FROM issue_history h
       JOIN sprint_scope s ON s.issue_id = h.issue_id AND s.sprint_id = ?
      WHERE h.field = 'status' AND h.new_value = 'Done'
      GROUP BY h.issue_id`,
    [sprintId],
  )

  const doneAt = new Map()
  for (const r of doneRows || []) {
    const d = parseDate(r.done_at)
    if (d) doneAt.set(r.issue_id, d)
  }

  const rows = (scopeRows || []).map((r) => ({
    issueId: r.issue_id,
    value: scopeValue(r, unit),
    addedAt: parseDate(r.added_at),
    removedAt: parseDate(r.removed_at),
    doneAt: doneAt.get(r.issue_id) ?? null,
  }))

  const start = parseDate(sprint.start_date)
  const end = parseDate(sprint.end_date) || parseDate(sprint.completed_at) || start

  return { sprint, unit, rows, start, end }
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

// GET /api/reports/burndown?sprintId=&unit=points|count
// Per-day REMAINING = committed baseline (scope at sprint start) minus the
// points/issues completed (reached 'Done') by the end of that day. The ideal
// line is a straight descent from the committed total to zero.
router.get('/burndown', asyncHandler(async (req, res) => {
  const loaded = await loadSprintSeries(req, res)
  if (!loaded) return
  const { sprint, unit, rows, start, end } = loaded

  if (!start || !end) {
    res.json({ sprintId: sprint.id, unit, committedPoints: 0, days: [] })
    return
  }

  const startInstant = start.getTime()
  const committedRows = rows.filter((r) => inScopeAt(r, r.addedAt, r.removedAt, startInstant))
  const committedPoints = committedRows.reduce((sum, r) => sum + r.value, 0)

  const dayList = buildDayRange(start, end)
  const lastIdx = dayList.length - 1

  const days = dayList.map((day, i) => {
    const cutoff = endOfUtcDay(day).getTime()
    const completed = committedRows
      .filter((r) => r.doneAt && r.doneAt.getTime() <= cutoff)
      .reduce((sum, r) => sum + r.value, 0)
    const remaining = committedPoints - completed
    const ideal = lastIdx <= 0
      ? committedPoints
      : Number((committedPoints * (1 - i / lastIdx)).toFixed(2))
    return { date: isoDay(day), ideal, remaining }
  })

  res.json({ sprintId: sprint.id, unit, committedPoints, days })
}))

// GET /api/reports/burnup?sprintId=&unit=points|count
// Per-day SCOPE = committed points/issues in the sprint at that day (honouring
// sprint_scope adds/removes) and COMPLETED = points/issues Done by that day.
router.get('/burnup', asyncHandler(async (req, res) => {
  const loaded = await loadSprintSeries(req, res)
  if (!loaded) return
  const { sprint, unit, rows, start, end } = loaded

  if (!start || !end) {
    res.json({ sprintId: sprint.id, unit, days: [] })
    return
  }

  const dayList = buildDayRange(start, end)

  const days = dayList.map((day) => {
    const cutoff = endOfUtcDay(day).getTime()
    const scope = rows
      .filter((r) => inScopeAt(r, r.addedAt, r.removedAt, cutoff))
      .reduce((sum, r) => sum + r.value, 0)
    const completed = rows
      .filter((r) => r.doneAt && r.doneAt.getTime() <= cutoff)
      .reduce((sum, r) => sum + r.value, 0)
    return { date: isoDay(day), scope, completed }
  })

  res.json({ sprintId: sprint.id, unit, days })
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
