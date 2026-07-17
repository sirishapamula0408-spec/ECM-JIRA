import { Router } from 'express'
import { get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

/**
 * Canonical universe of issue types (mirrors ISSUE_TYPES in src/constants.js).
 * A scheme's allowed_types is validated against this set.
 */
export const ALL_ISSUE_TYPES = ['Epic', 'Story', 'Bug', 'Task', 'Sub-task']

/**
 * `pg` returns JSONB columns as native JS values, but guard for a string/other
 * shape so the route stays robust regardless of driver behaviour.
 */
function normalizeTypes(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Resolve the effective scheme for a project: its own row wins, otherwise fall
 * back to the global default (project_id IS NULL). Returns null if neither.
 */
async function resolveScheme(projectId) {
  let row = await get(
    'SELECT id, project_id, allowed_types, default_type FROM issue_type_schemes WHERE project_id = ?',
    [projectId],
  )
  if (!row) {
    row = await get(
      'SELECT id, project_id, allowed_types, default_type FROM issue_type_schemes WHERE project_id IS NULL LIMIT 1',
    )
  }
  return row
}

// GET /api/projects/:projectId/issue-types — effective allowed types for the
// project (project scheme else global default). Not role-gated (read-only).
router.get('/projects/:projectId/issue-types', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const scheme = await resolveScheme(projectId)
  if (!scheme) {
    // No scheme configured at all — safest default is the full universe.
    res.json({ projectId, allowedTypes: ALL_ISSUE_TYPES, defaultType: 'Task', scoped: false, fallback: true })
    return
  }
  const allowedTypes = normalizeTypes(scheme.allowed_types)
  const effective = allowedTypes.length ? allowedTypes : ALL_ISSUE_TYPES
  let defaultType = scheme.default_type || 'Task'
  if (!effective.includes(defaultType)) defaultType = effective[0]
  res.json({
    projectId,
    allowedTypes: effective,
    defaultType,
    scoped: scheme.project_id != null,
  })
}))

// PUT /api/projects/:projectId/issue-types — set the project's allowed types +
// default (Admin only). Upserts a project-level scheme row.
router.put('/projects/:projectId/issue-types', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const allowedTypes = req.body?.allowedTypes
  let defaultType = req.body?.defaultType

  if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) {
    res.status(400).json({ error: 'allowedTypes must be a non-empty array of issue type names' })
    return
  }
  const invalid = allowedTypes.filter((t) => !ALL_ISSUE_TYPES.includes(t))
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown issue type(s): ${invalid.join(', ')}` })
    return
  }
  // Dedupe while preserving order.
  const unique = [...new Set(allowedTypes)]
  // The default must be one of the allowed types; otherwise pick the first.
  if (!defaultType || !unique.includes(defaultType)) {
    defaultType = unique[0]
  }

  const existing = await get('SELECT id FROM issue_type_schemes WHERE project_id = ?', [projectId])
  if (existing) {
    await run(
      'UPDATE issue_type_schemes SET allowed_types = ?::jsonb, default_type = ? WHERE project_id = ?',
      [JSON.stringify(unique), defaultType, projectId],
    )
  } else {
    await run(
      'INSERT INTO issue_type_schemes (project_id, allowed_types, default_type) VALUES (?, ?::jsonb, ?)',
      [projectId, JSON.stringify(unique), defaultType],
    )
  }
  res.json({ projectId, allowedTypes: unique, defaultType, scoped: true })
}))

export default router
