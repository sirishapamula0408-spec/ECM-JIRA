import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

function mapComponent(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description || '',
    lead: row.lead || '',
    issueCount: row.issueCount ?? 0,
  }
}

// GET /api/projects/:projectId/components — list components (with issue counts)
router.get('/projects/:projectId/components', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const rows = await all(
    `SELECT c.id, c.project_id, c.name, c.description, c.lead,
            COUNT(ic.issue_id)::int AS "issueCount"
     FROM components c
     LEFT JOIN issue_components ic ON ic.component_id = c.id
     WHERE c.project_id = ?
     GROUP BY c.id
     ORDER BY c.name ASC`,
    [projectId],
  )
  res.json(rows.map(mapComponent))
}))

// POST /api/projects/:projectId/components (Admin) — create a component
router.post('/projects/:projectId/components', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const name = String(req.body?.name || '').trim()
  const description = String(req.body?.description || '').trim()
  const lead = String(req.body?.lead || '').trim()
  if (!name) {
    res.status(400).json({ error: 'Component name is required' })
    return
  }
  const existing = await get(
    'SELECT id FROM components WHERE project_id = ? AND LOWER(name) = LOWER(?)',
    [projectId, name],
  )
  if (existing) {
    res.status(409).json({ error: 'A component with that name already exists' })
    return
  }
  const created = await run(
    'INSERT INTO components (project_id, name, description, lead) VALUES (?, ?, ?, ?)',
    [projectId, name, description, lead],
  )
  const row = await get('SELECT id, project_id, name, description, lead FROM components WHERE id = ?', [created.lastID])
  res.status(201).json({ ...mapComponent(row), issueCount: 0 })
}))

// PATCH /api/projects/:projectId/components/:componentId (Admin) — update name/description/lead
router.patch('/projects/:projectId/components/:componentId', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const componentId = Number(req.params.componentId)
  const existing = await get(
    'SELECT id, project_id, name, description, lead FROM components WHERE id = ? AND project_id = ?',
    [componentId, projectId],
  )
  if (!existing) {
    res.status(404).json({ error: 'Component not found' })
    return
  }
  // Partial update: only fields present in the body change; others keep current values.
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name
  const description = req.body?.description !== undefined ? String(req.body.description).trim() : (existing.description || '')
  const lead = req.body?.lead !== undefined ? String(req.body.lead).trim() : (existing.lead || '')
  if (!name) {
    res.status(400).json({ error: 'Component name is required' })
    return
  }
  const duplicate = await get(
    'SELECT id FROM components WHERE project_id = ? AND LOWER(name) = LOWER(?) AND id <> ?',
    [projectId, name, componentId],
  )
  if (duplicate) {
    res.status(409).json({ error: 'A component with that name already exists' })
    return
  }
  await run(
    'UPDATE components SET name = ?, description = ?, lead = ? WHERE id = ? AND project_id = ?',
    [name, description, lead, componentId, projectId],
  )
  const row = await get(
    `SELECT c.id, c.project_id, c.name, c.description, c.lead,
            COUNT(ic.issue_id)::int AS "issueCount"
     FROM components c
     LEFT JOIN issue_components ic ON ic.component_id = c.id
     WHERE c.id = ?
     GROUP BY c.id`,
    [componentId],
  )
  res.json(mapComponent(row))
}))

// DELETE /api/projects/:projectId/components/:componentId (Admin) — cascades issue_components
router.delete('/projects/:projectId/components/:componentId', requireRole('Admin'), asyncHandler(async (req, res) => {
  const componentId = Number(req.params.componentId)
  await run('DELETE FROM components WHERE id = ? AND project_id = ?', [componentId, Number(req.params.projectId)])
  res.json({ success: true })
}))

// GET /api/issues/:issueId/components — components assigned to an issue
router.get('/issues/:issueId/components', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    `SELECT c.id, c.project_id, c.name, c.description, c.lead
     FROM issue_components ic JOIN components c ON c.id = ic.component_id
     WHERE ic.issue_id = ? ORDER BY c.name ASC`,
    [issueId],
  )
  res.json(rows.map(mapComponent))
}))

// PUT /api/issues/:issueId/components — replace-all set. Body: { componentIds: [] }
router.put('/issues/:issueId/components', requireRole('Member'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const componentIds = Array.isArray(req.body?.componentIds)
    ? req.body.componentIds.map(Number).filter(Number.isInteger)
    : []
  await run('DELETE FROM issue_components WHERE issue_id = ?', [issueId])
  for (const componentId of componentIds) {
    await run(
      // Explicit RETURNING so the run() wrapper doesn't auto-append "RETURNING id"
      // (issue_components has a composite PK and no id column).
      'INSERT INTO issue_components (issue_id, component_id) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING component_id',
      [issueId, componentId],
    )
  }
  const rows = await all(
    `SELECT c.id, c.project_id, c.name, c.description, c.lead
     FROM issue_components ic JOIN components c ON c.id = ic.component_id
     WHERE ic.issue_id = ? ORDER BY c.name ASC`,
    [issueId],
  )
  res.json(rows.map(mapComponent))
}))

export default router
