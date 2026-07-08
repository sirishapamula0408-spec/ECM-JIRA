import { Router } from 'express'
import { get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

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
  }
}

// GET the board config for a project (returns defaults when none saved).
router.get('/projects/:projectId/board-config', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const row = await get(
    'SELECT project_id, swimlane_by, wip_limits, quick_filters FROM board_configs WHERE project_id = ?',
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

  await run(
    `INSERT INTO board_configs (project_id, swimlane_by, wip_limits, quick_filters, updated_at)
     VALUES (?, ?, ?::jsonb, ?::jsonb, NOW())
     ON CONFLICT (project_id) DO UPDATE SET
       swimlane_by = EXCLUDED.swimlane_by,
       wip_limits = EXCLUDED.wip_limits,
       quick_filters = EXCLUDED.quick_filters,
       updated_at = NOW()`,
    [projectId, swimlaneBy, JSON.stringify(wipLimits), JSON.stringify(quickFilters)],
  )

  const row = await get(
    'SELECT project_id, swimlane_by, wip_limits, quick_filters FROM board_configs WHERE project_id = ?',
    [projectId],
  )
  res.json(serialize(row))
}))

export default router
