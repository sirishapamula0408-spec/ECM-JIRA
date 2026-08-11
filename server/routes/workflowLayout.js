import { Router } from 'express'
import { get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

// JL-330: Workflow Editor node layout, persisted server-side.
//
// Node coordinates used to live only in the browser (localStorage key
// `wfEditor:positions:<projectId>`), which made a workflow's layout per-device,
// lost on a cache clear, and invisible to teammates looking at the same
// workflow. The layout is one JSONB map per project: status name -> { x, y }.
//
// Permissions mirror the rest of the workflow config exactly: reading is open to
// any authenticated caller (the whole canvas is readable — statuses and
// transitions already are), and writing requires workspace Admin, which is what
// `requireRole('Admin')` enforces on workflow-transition writes and what the
// frontend's `canEditWorkflows` / `isAdmin` gate resolves to.

const router = Router()

// A hard ceiling on stored nodes. A workflow with more statuses than this is
// not a real workflow, and the cap keeps a malformed client from writing an
// unbounded JSONB blob.
const MAX_LAYOUT_NODES = 500

function mapLayout(projectId, row) {
  const positions = row?.positions
  return {
    projectId,
    positions: positions && typeof positions === 'object' && !Array.isArray(positions) ? positions : {},
    updatedAt: row?.updated_at ?? null,
  }
}

/**
 * Validate + normalise an incoming positions map.
 * Returns { positions } on success or { error } with a message for a 400.
 * Coordinates are clamped at 0 (the canvas has no negative space) and rounded
 * to whole pixels so float noise from a drag never reaches the DB.
 */
export function sanitizePositions(raw) {
  if (raw === undefined || raw === null) return { error: 'positions is required' }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'positions must be an object' }

  const names = Object.keys(raw)
  if (names.length > MAX_LAYOUT_NODES) {
    return { error: `positions may contain at most ${MAX_LAYOUT_NODES} nodes` }
  }

  const positions = {}
  for (const name of names) {
    const value = raw[name]
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: `position for "${name}" must be an object with x and y` }
    }
    const x = Number(value.x)
    const y = Number(value.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { error: `position for "${name}" must have numeric x and y` }
    }
    positions[name] = { x: Math.round(Math.max(0, x)), y: Math.round(Math.max(0, y)) }
  }
  return { positions }
}

// GET /api/projects/:projectId/workflow-layout — the saved node layout.
// Never 404s: a project without a stored layout simply has no saved
// coordinates yet, and the client falls back to its auto-layout.
router.get('/projects/:projectId/workflow-layout', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const row = await get('SELECT positions, updated_at FROM workflow_layouts WHERE project_id = ?', [projectId])
  res.json(mapLayout(projectId, row))
}))

// PUT /api/projects/:projectId/workflow-layout (Admin) — replace the layout.
// A full replace (not a merge) so removing a status also removes its coordinate,
// and so "Reset layout" is just a PUT of an empty map.
router.put('/projects/:projectId/workflow-layout', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const { positions, error } = sanitizePositions(req.body?.positions)
  if (error) { res.status(400).json({ error }); return }

  await run(
    `INSERT INTO workflow_layouts (project_id, positions, updated_at)
     VALUES (?, ?::jsonb, NOW())
     ON CONFLICT (project_id) DO UPDATE SET positions = EXCLUDED.positions, updated_at = NOW()`,
    [projectId, JSON.stringify(positions)],
  )

  const row = await get('SELECT positions, updated_at FROM workflow_layouts WHERE project_id = ?', [projectId])
  res.json(mapLayout(projectId, row))
}))

export default router
