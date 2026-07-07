import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

const FIELD_TYPES = ['text', 'number', 'date', 'dropdown']

function mapField(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    fieldType: row.field_type,
    options: row.options || [],
  }
}

// GET /api/projects/:projectId/custom-fields — list definitions
router.get('/projects/:projectId/custom-fields', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT * FROM custom_fields WHERE project_id = ? ORDER BY id ASC',
    [Number(req.params.projectId)],
  )
  res.json(rows.map(mapField))
}))

// POST /api/projects/:projectId/custom-fields (Admin) — create a definition
router.post('/projects/:projectId/custom-fields', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const name = String(req.body?.name || '').trim()
  const fieldType = String(req.body?.fieldType || '').trim()
  const options = Array.isArray(req.body?.options) ? req.body.options.map((o) => String(o).trim()).filter(Boolean) : []

  if (!name) { res.status(400).json({ error: 'Field name is required' }); return }
  if (!FIELD_TYPES.includes(fieldType)) { res.status(400).json({ error: `fieldType must be one of: ${FIELD_TYPES.join(', ')}` }); return }
  if (fieldType === 'dropdown' && options.length === 0) { res.status(400).json({ error: 'Dropdown fields need at least one option' }); return }

  const created = await run(
    'INSERT INTO custom_fields (project_id, name, field_type, options) VALUES (?, ?, ?, ?::jsonb)',
    [projectId, name, fieldType, JSON.stringify(options)],
  )
  const row = await get('SELECT * FROM custom_fields WHERE id = ?', [created.lastID])
  res.status(201).json(mapField(row))
}))

// DELETE /api/custom-fields/:id (Admin)
router.delete('/custom-fields/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM custom_fields WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

// GET /api/issues/:issueId/custom-fields — every project field def + this issue's value
router.get('/issues/:issueId/custom-fields', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const issue = await get('SELECT project_id FROM issues WHERE id = ?', [issueId])
  if (!issue) { res.status(404).json({ error: 'Issue not found' }); return }
  const rows = await all(
    `SELECT cf.*, v.value AS field_value
     FROM custom_fields cf
     LEFT JOIN issue_custom_field_values v ON v.field_id = cf.id AND v.issue_id = ?
     WHERE cf.project_id = ?
     ORDER BY cf.id ASC`,
    [issueId, issue.project_id],
  )
  res.json(rows.map((r) => ({ ...mapField(r), value: r.field_value ?? '' })))
}))

// PUT /api/issues/:issueId/custom-fields/:fieldId — set a value (empty clears)
router.put('/issues/:issueId/custom-fields/:fieldId', requireRole('Member'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const fieldId = Number(req.params.fieldId)
  const value = req.body?.value === null || req.body?.value === undefined ? '' : String(req.body.value)

  const field = await get('SELECT id FROM custom_fields WHERE id = ?', [fieldId])
  if (!field) { res.status(404).json({ error: 'Custom field not found' }); return }

  if (value === '') {
    await run('DELETE FROM issue_custom_field_values WHERE issue_id = ? AND field_id = ?', [issueId, fieldId])
  } else {
    await run(
      `INSERT INTO issue_custom_field_values (issue_id, field_id, value) VALUES (?, ?, ?)
       ON CONFLICT (issue_id, field_id) DO UPDATE SET value = EXCLUDED.value RETURNING id`,
      [issueId, fieldId, value],
    )
  }
  res.json({ fieldId, value })
}))

export default router
