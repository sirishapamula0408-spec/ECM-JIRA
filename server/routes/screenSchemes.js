import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

/** Issue types a screen scheme may be defined for (mirrors validIssueTypes). */
export const SCREEN_ISSUE_TYPES = ['Epic', 'Story', 'Bug', 'Task', 'Sub-task']

/**
 * The built-in (non-custom) field keys an admin can place on a screen. These map
 * to columns already stored on the issues model. `custom:<id>` keys reference a
 * row in `custom_fields` and are validated dynamically against the project.
 */
export const BUILTIN_FIELD_KEYS = [
  'summary',
  'description',
  'status',
  'priority',
  'assignee',
  'reporter',
  'issue_type',
  'labels',
  'story_points',
  'due_date',
  'original_estimate',
  'parent',
]

/**
 * Validate a single field entry from a PUT payload. Returns a normalized entry or
 * throws an Error with a `.status` for the caller to surface.
 *
 * @param {*} entry
 * @param {Set<string>} customFieldKeys — allowed `custom:<id>` keys for the project
 */
export function normalizeFieldEntry(entry, customFieldKeys) {
  const fieldKey = String(entry?.fieldKey ?? entry?.field_key ?? '').trim()
  if (!fieldKey) {
    const err = new Error('Each field entry needs a fieldKey')
    err.status = 400
    throw err
  }
  const isBuiltin = BUILTIN_FIELD_KEYS.includes(fieldKey)
  const isCustom = fieldKey.startsWith('custom:')
  if (!isBuiltin && !isCustom) {
    const err = new Error(`Unknown field key: ${fieldKey}`)
    err.status = 400
    throw err
  }
  if (isCustom && !customFieldKeys.has(fieldKey)) {
    const err = new Error(`Custom field not found for this project: ${fieldKey}`)
    err.status = 400
    throw err
  }
  // Booleans default to TRUE (a field placed on a screen shows unless disabled).
  const showOnCreate = entry?.showOnCreate ?? entry?.show_on_create
  const showOnEdit = entry?.showOnEdit ?? entry?.show_on_edit
  return {
    fieldKey,
    showOnCreate: showOnCreate === undefined ? true : Boolean(showOnCreate),
    showOnEdit: showOnEdit === undefined ? true : Boolean(showOnEdit),
  }
}

function mapFieldRow(row) {
  return {
    id: row.id,
    schemeId: row.scheme_id,
    fieldKey: row.field_key,
    position: row.position,
    showOnCreate: Boolean(row.show_on_create),
    showOnEdit: Boolean(row.show_on_edit),
  }
}

/** Default resolved layout: all built-in fields + every project custom field. */
async function defaultResolvedFields(projectId) {
  const builtins = BUILTIN_FIELD_KEYS.map((fieldKey, i) => ({
    fieldKey,
    position: i,
    showOnCreate: true,
    showOnEdit: true,
  }))
  const customs = await all(
    'SELECT id FROM custom_fields WHERE project_id = ? ORDER BY id ASC',
    [projectId],
  )
  const customFields = customs.map((c, i) => ({
    fieldKey: `custom:${c.id}`,
    position: builtins.length + i,
    showOnCreate: true,
    showOnEdit: true,
  }))
  return [...builtins, ...customFields]
}

// GET /api/projects/:projectId/screen-schemes — all schemes for a project,
// grouped by issue type (Admin only).
router.get('/projects/:projectId/screen-schemes', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const schemes = await all(
    'SELECT id, project_id, issue_type, created_at FROM screen_schemes WHERE project_id = ? ORDER BY issue_type ASC',
    [projectId],
  )
  const byType = {}
  for (const scheme of schemes) {
    const fields = await all(
      'SELECT id, scheme_id, field_key, position, show_on_create, show_on_edit FROM screen_scheme_fields WHERE scheme_id = ? ORDER BY position ASC, id ASC',
      [scheme.id],
    )
    byType[scheme.issue_type] = {
      id: scheme.id,
      projectId: scheme.project_id,
      issueType: scheme.issue_type,
      createdAt: scheme.created_at,
      fields: fields.map(mapFieldRow),
    }
  }
  res.json({ projectId, schemes: byType })
}))

// PUT /api/projects/:projectId/screen-schemes/:issueType — replace the ordered
// field list for one issue type (Admin only). Creates the scheme on first save.
router.put('/projects/:projectId/screen-schemes/:issueType', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const issueType = String(req.params.issueType || '').trim()

  if (!SCREEN_ISSUE_TYPES.includes(issueType)) {
    res.status(400).json({ error: `issueType must be one of: ${SCREEN_ISSUE_TYPES.join(', ')}` })
    return
  }

  const rawFields = req.body?.fields
  if (!Array.isArray(rawFields)) {
    res.status(400).json({ error: 'fields must be an array' })
    return
  }

  // Build the set of allowed custom:<id> keys for this project.
  const customs = await all('SELECT id FROM custom_fields WHERE project_id = ?', [projectId])
  const customFieldKeys = new Set(customs.map((c) => `custom:${c.id}`))

  // Validate + normalize every entry before touching the DB. Reject duplicates.
  let normalized
  try {
    normalized = rawFields.map((f) => normalizeFieldEntry(f, customFieldKeys))
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message })
    return
  }
  const seen = new Set()
  for (const f of normalized) {
    if (seen.has(f.fieldKey)) {
      res.status(400).json({ error: `Duplicate field key: ${f.fieldKey}` })
      return
    }
    seen.add(f.fieldKey)
  }

  // Upsert the scheme (one per project+issue_type).
  let scheme = await get(
    'SELECT id FROM screen_schemes WHERE project_id = ? AND issue_type = ?',
    [projectId, issueType],
  )
  if (!scheme) {
    const created = await run(
      'INSERT INTO screen_schemes (project_id, issue_type) VALUES (?, ?)',
      [projectId, issueType],
    )
    scheme = { id: created.lastID }
  }

  // Replace the ordered field list: delete all, then insert in order.
  await run('DELETE FROM screen_scheme_fields WHERE scheme_id = ?', [scheme.id])
  for (let i = 0; i < normalized.length; i++) {
    const f = normalized[i]
    await run(
      'INSERT INTO screen_scheme_fields (scheme_id, field_key, position, show_on_create, show_on_edit) VALUES (?, ?, ?, ?, ?)',
      [scheme.id, f.fieldKey, i, f.showOnCreate, f.showOnEdit],
    )
  }

  const fields = await all(
    'SELECT id, scheme_id, field_key, position, show_on_create, show_on_edit FROM screen_scheme_fields WHERE scheme_id = ? ORDER BY position ASC, id ASC',
    [scheme.id],
  )
  res.json({
    id: scheme.id,
    projectId,
    issueType,
    fields: fields.map(mapFieldRow),
  })
}))

// GET /api/projects/:projectId/screen-schemes/:issueType/resolved — the effective
// ordered field list for an issue type. Falls back to the "all fields" default
// when no scheme is configured, so existing projects behave exactly as today.
router.get('/projects/:projectId/screen-schemes/:issueType/resolved', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const issueType = String(req.params.issueType || '').trim()

  if (!SCREEN_ISSUE_TYPES.includes(issueType)) {
    res.status(400).json({ error: `issueType must be one of: ${SCREEN_ISSUE_TYPES.join(', ')}` })
    return
  }

  const scheme = await get(
    'SELECT id FROM screen_schemes WHERE project_id = ? AND issue_type = ?',
    [projectId, issueType],
  )

  if (!scheme) {
    const fields = await defaultResolvedFields(projectId)
    res.json({ projectId, issueType, configured: false, fields })
    return
  }

  const rows = await all(
    'SELECT field_key, position, show_on_create, show_on_edit FROM screen_scheme_fields WHERE scheme_id = ? ORDER BY position ASC, id ASC',
    [scheme.id],
  )
  const fields = rows.map((r) => ({
    fieldKey: r.field_key,
    position: r.position,
    showOnCreate: Boolean(r.show_on_create),
    showOnEdit: Boolean(r.show_on_edit),
  }))
  res.json({ projectId, issueType, configured: true, fields })
}))

export default router
