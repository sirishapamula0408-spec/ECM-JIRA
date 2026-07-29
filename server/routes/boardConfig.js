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
    columns: [],
  }
}

// Validate + normalise the Atlassian-style column configuration (JL-308).
// Returns { columns } on success or { error } on failure. Each column is
// { id, name, statuses[] }; a status may belong to at most one column.
function validateColumns(input) {
  if (input === undefined || input === null) return { columns: [] }
  if (!Array.isArray(input)) return { error: 'columns must be an array' }
  const seenStatuses = new Set()
  const columns = []
  input.forEach((col, index) => {
    if (columns.error) return
    if (typeof col !== 'object' || col === null || Array.isArray(col)) {
      columns.error = `columns[${index}] must be an object`
      return
    }
    const name = String(col.name ?? '').trim()
    if (!name) {
      columns.error = `columns[${index}].name is required`
      return
    }
    const rawStatuses = col.statuses ?? []
    if (!Array.isArray(rawStatuses)) {
      columns.error = `columns[${index}].statuses must be an array`
      return
    }
    const statuses = []
    for (const s of rawStatuses) {
      const status = String(s ?? '').trim()
      if (!status) continue
      if (seenStatuses.has(status)) {
        columns.error = `status "${status}" is mapped to more than one column`
        return
      }
      seenStatuses.add(status)
      statuses.push(status)
    }
    const id = String(col.id ?? '').trim() || `col_${index}_${Math.random().toString(36).slice(2, 8)}`
    columns.push({ id, name, statuses })
  })
  if (columns.error) return { error: columns.error }
  return { columns }
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
    columns: parseJson(row.columns, []),
  }
}

const CONFIG_COLUMNS =
  'project_id, swimlane_by, wip_limits, quick_filters, estimation_statistic, columns'

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

  const columnsResult = validateColumns(req.body?.columns)
  if (columnsResult.error) {
    res.status(400).json({ error: columnsResult.error })
    return
  }
  const columns = columnsResult.columns

  await run(
    `INSERT INTO board_configs (project_id, swimlane_by, wip_limits, quick_filters, estimation_statistic, columns, updated_at)
     VALUES (?, ?, ?::jsonb, ?::jsonb, ?, ?::jsonb, NOW())
     ON CONFLICT (project_id) DO UPDATE SET
       swimlane_by = EXCLUDED.swimlane_by,
       wip_limits = EXCLUDED.wip_limits,
       quick_filters = EXCLUDED.quick_filters,
       estimation_statistic = EXCLUDED.estimation_statistic,
       columns = EXCLUDED.columns,
       updated_at = NOW()`,
    [projectId, swimlaneBy, JSON.stringify(wipLimits), JSON.stringify(quickFilters), estimationStatistic, JSON.stringify(columns)],
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
