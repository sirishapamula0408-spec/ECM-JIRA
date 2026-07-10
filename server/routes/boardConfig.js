import { Router } from 'express'
import { get, run, all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import {
  ESTIMATION_STATISTICS,
  DEFAULT_ESTIMATION_STATISTIC,
  isValidEstimationStatistic,
  computeEstimationTotal,
} from '../services/estimation.js'

const router = Router()

// Allowed swimlane grouping modes.
const SWIMLANE_MODES = ['none', 'assignee', 'epic', 'priority']

// Default board configuration returned when a project has no saved row yet.
function defaultConfig(projectId) {
  return {
    projectId,
    swimlaneBy: 'none',
    wipLimits: {},
    quickFilters: [],
    estimationStatistic: DEFAULT_ESTIMATION_STATISTIC,
  }
}

// JSONB columns come back as parsed objects from pg, but be defensive in case
// a driver hands back a raw string.
function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return fallback }
  }
  return value
}

function serialize(row) {
  return {
    projectId: row.project_id,
    swimlaneBy: row.swimlane_by,
    wipLimits: parseJson(row.wip_limits, {}),
    quickFilters: parseJson(row.quick_filters, []),
    estimationStatistic: row.estimation_statistic || DEFAULT_ESTIMATION_STATISTIC,
  }
}

const CONFIG_COLUMNS =
  'project_id, swimlane_by, wip_limits, quick_filters, estimation_statistic'

// GET the board config for a project (returns defaults when none saved).
router.get('/projects/:projectId/board-config', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const row = await get(
    `SELECT ${CONFIG_COLUMNS} FROM board_configs WHERE project_id = ?`,
    [projectId],
  )
  res.json(row ? serialize(row) : defaultConfig(projectId))
}))

// PUT (upsert) the board config for a project (Admin only).
router.put('/projects/:projectId/board-config', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)

  const swimlaneBy = String(req.body?.swimlaneBy ?? 'none').trim()
  if (!SWIMLANE_MODES.includes(swimlaneBy)) {
    res.status(400).json({ error: `swimlaneBy must be one of ${SWIMLANE_MODES.join(', ')}` })
    return
  }

  const wipLimits = req.body?.wipLimits ?? {}
  if (typeof wipLimits !== 'object' || Array.isArray(wipLimits) || wipLimits === null) {
    res.status(400).json({ error: 'wipLimits must be an object mapping status -> limit' })
    return
  }
  // Validate each WIP limit is a non-negative integer.
  for (const [status, limit] of Object.entries(wipLimits)) {
    const n = Number(limit)
    if (!Number.isInteger(n) || n < 0) {
      res.status(400).json({ error: `wipLimits.${status} must be a non-negative integer` })
      return
    }
  }

  const quickFilters = req.body?.quickFilters ?? []
  if (!Array.isArray(quickFilters)) {
    res.status(400).json({ error: 'quickFilters must be an array' })
    return
  }

  const estimationStatistic = String(
    req.body?.estimationStatistic ?? DEFAULT_ESTIMATION_STATISTIC,
  ).trim()
  if (!isValidEstimationStatistic(estimationStatistic)) {
    res.status(400).json({
      error: `estimationStatistic must be one of ${ESTIMATION_STATISTICS.join(', ')}`,
    })
    return
  }

  await run(
    `INSERT INTO board_configs (project_id, swimlane_by, wip_limits, quick_filters, estimation_statistic, updated_at)
     VALUES (?, ?, ?::jsonb, ?::jsonb, ?, NOW())
     ON CONFLICT (project_id) DO UPDATE SET
       swimlane_by = EXCLUDED.swimlane_by,
       wip_limits = EXCLUDED.wip_limits,
       quick_filters = EXCLUDED.quick_filters,
       estimation_statistic = EXCLUDED.estimation_statistic,
       updated_at = NOW()`,
    [projectId, swimlaneBy, JSON.stringify(wipLimits), JSON.stringify(quickFilters), estimationStatistic],
  )

  const row = await get(
    `SELECT ${CONFIG_COLUMNS} FROM board_configs WHERE project_id = ?`,
    [projectId],
  )
  res.json(serialize(row))
}))

// GET estimation totals for a project, grouped by sprint plus the backlog,
// computed with the board's configured estimation statistic (JL-126).
router.get('/projects/:projectId/estimation-summary', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)

  const cfg = await get(
    'SELECT estimation_statistic FROM board_configs WHERE project_id = ?',
    [projectId],
  )
  const statistic = cfg?.estimation_statistic || DEFAULT_ESTIMATION_STATISTIC

  const issues = await all(
    'SELECT id, sprint_id, story_points, original_estimate_minutes FROM issues WHERE project_id = ?',
    [projectId],
  )

  // Group by sprint_id (null → backlog).
  const groups = new Map()
  for (const issue of issues) {
    const key = issue.sprint_id ?? 'backlog'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(issue)
  }

  const sprints = []
  let backlog = 0
  for (const [key, rows] of groups.entries()) {
    const total = computeEstimationTotal(rows, statistic)
    if (key === 'backlog') {
      backlog = total
    } else {
      sprints.push({ sprintId: key, total, issueCount: rows.length })
    }
  }
  sprints.sort((a, b) => a.sprintId - b.sprintId)

  res.json({
    projectId,
    statistic,
    backlogTotal: backlog,
    total: computeEstimationTotal(issues, statistic),
    sprints,
  })
}))

export default router
