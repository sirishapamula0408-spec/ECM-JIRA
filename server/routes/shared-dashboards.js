import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// GET /api/shared-dashboards — list dashboards visible to current user
router.get('/', asyncHandler(async (req, res) => {
  const email = req.user.email
  const rows = await all(
    "SELECT id, name, description, owner_email, project_id, visibility, layout, created_at, updated_at FROM shared_dashboards WHERE owner_email = ? OR visibility = 'public' ORDER BY updated_at DESC",
    [email],
  )
  res.json(rows)
}))

// GET /api/shared-dashboards/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM shared_dashboards WHERE id = ?', [Number(req.params.id)])
  if (!row) {
    res.status(404).json({ error: 'Dashboard not found' })
    return
  }
  res.json(row)
}))

// POST /api/shared-dashboards — create dashboard
router.post('/', asyncHandler(async (req, res) => {
  const { name, description = '', projectId = null, visibility = 'private', layout = [] } = req.body
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const result = await run(
    'INSERT INTO shared_dashboards (name, description, owner_email, project_id, visibility, layout) VALUES (?, ?, ?, ?, ?, ?::jsonb)',
    [name.trim(), description, req.user.email, projectId, visibility, JSON.stringify(layout)],
  )
  const row = await get('SELECT * FROM shared_dashboards WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// PATCH /api/shared-dashboards/:id — update dashboard
router.patch('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM shared_dashboards WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Dashboard not found' })
    return
  }

  const { name, description, visibility, layout } = req.body
  const sets = []
  const params = []

  if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()) }
  if (description !== undefined) { sets.push('description = ?'); params.push(description) }
  if (visibility !== undefined) { sets.push('visibility = ?'); params.push(visibility) }
  if (layout !== undefined) { sets.push('layout = ?::jsonb'); params.push(JSON.stringify(layout)) }

  if (sets.length === 0) {
    res.json(existing)
    return
  }

  sets.push('updated_at = NOW()')
  params.push(id)
  await run(`UPDATE shared_dashboards SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM shared_dashboards WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/shared-dashboards/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  await run('DELETE FROM shared_dashboards WHERE id = ? AND owner_email = ?', [Number(req.params.id), req.user.email])
  res.json({ success: true })
}))

// POST /api/shared-dashboards/:id/clone — clone a dashboard
router.post('/:id/clone', asyncHandler(async (req, res) => {
  const original = await get('SELECT * FROM shared_dashboards WHERE id = ?', [Number(req.params.id)])
  if (!original) {
    res.status(404).json({ error: 'Dashboard not found' })
    return
  }
  const result = await run(
    'INSERT INTO shared_dashboards (name, description, owner_email, project_id, visibility, layout) VALUES (?, ?, ?, ?, ?, ?::jsonb)',
    [`${original.name} (Copy)`, original.description, req.user.email, original.project_id, 'private', JSON.stringify(original.layout)],
  )
  const row = await get('SELECT * FROM shared_dashboards WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

export default router
