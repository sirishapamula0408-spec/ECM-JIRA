import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

const HEX = /^#[0-9a-fA-F]{6}$/
const CATEGORIES = ['todo', 'inprogress', 'done']

/**
 * Compute the effective list for a project: project-level overrides take
 * precedence; if a project has NO rows of its own, fall back to the global
 * defaults (project_id IS NULL). Rows ordered by position then name.
 */
async function effectiveList(table, projectId, extraCols = '') {
  const cols = `id, project_id, name, position, color${extraCols}`
  const own = await all(
    `SELECT ${cols} FROM ${table} WHERE project_id = ? ORDER BY position ASC, name ASC`,
    [projectId],
  )
  if (own.length > 0) return own
  return all(
    `SELECT ${cols} FROM ${table} WHERE project_id IS NULL ORDER BY position ASC, name ASC`,
    [],
  )
}

/* ================= Priorities ================= */

// GET effective priorities for a project (project overrides or global defaults)
router.get('/projects/:projectId/priorities', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  res.json(await effectiveList('issue_priorities', projectId))
}))

// POST create a project-level priority (Admin only)
router.post('/projects/:projectId/priorities', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const name = String(req.body?.name || '').trim()
  const color = String(req.body?.color || '#42526E').trim()
  const position = Number.isFinite(Number(req.body?.position)) ? Number(req.body.position) : 0
  if (!name) {
    res.status(400).json({ error: 'Priority name is required' })
    return
  }
  if (!HEX.test(color)) {
    res.status(400).json({ error: 'color must be a hex value like #FF5630' })
    return
  }
  const existing = await get(
    'SELECT id FROM issue_priorities WHERE project_id = ? AND LOWER(name) = LOWER(?)',
    [projectId, name],
  )
  if (existing) {
    res.status(409).json({ error: 'A priority with that name already exists for this project' })
    return
  }
  const created = await run(
    'INSERT INTO issue_priorities (project_id, name, position, color) VALUES (?, ?, ?, ?)',
    [projectId, name, position, color],
  )
  const row = await get('SELECT id, project_id, name, position, color FROM issue_priorities WHERE id = ?', [created.lastID])
  res.status(201).json(row)
}))

// PUT update a priority (Admin only)
router.put('/priorities/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM issue_priorities WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Priority not found' })
    return
  }
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name
  const color = req.body?.color !== undefined ? String(req.body.color).trim() : existing.color
  const position = req.body?.position !== undefined ? Number(req.body.position) : existing.position
  if (!name) {
    res.status(400).json({ error: 'Priority name is required' })
    return
  }
  if (!HEX.test(color)) {
    res.status(400).json({ error: 'color must be a hex value like #FF5630' })
    return
  }
  await run(
    'UPDATE issue_priorities SET name = ?, color = ?, position = ? WHERE id = ?',
    [name, color, position, id],
  )
  const row = await get('SELECT id, project_id, name, position, color FROM issue_priorities WHERE id = ?', [id])
  res.json(row)
}))

// DELETE a priority (Admin only)
router.delete('/priorities/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  await run('DELETE FROM issue_priorities WHERE id = ?', [id])
  res.json({ success: true })
}))

/* ================= Statuses ================= */

// GET effective statuses for a project (project overrides or global defaults)
router.get('/projects/:projectId/statuses', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  res.json(await effectiveList('issue_statuses', projectId, ', category'))
}))

// POST create a project-level status (Admin only)
router.post('/projects/:projectId/statuses', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const name = String(req.body?.name || '').trim()
  const color = String(req.body?.color || '#42526E').trim()
  const category = String(req.body?.category || 'todo').trim()
  const position = Number.isFinite(Number(req.body?.position)) ? Number(req.body.position) : 0
  if (!name) {
    res.status(400).json({ error: 'Status name is required' })
    return
  }
  if (!HEX.test(color)) {
    res.status(400).json({ error: 'color must be a hex value like #FF5630' })
    return
  }
  if (!CATEGORIES.includes(category)) {
    res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` })
    return
  }
  const existing = await get(
    'SELECT id FROM issue_statuses WHERE project_id = ? AND LOWER(name) = LOWER(?)',
    [projectId, name],
  )
  if (existing) {
    res.status(409).json({ error: 'A status with that name already exists for this project' })
    return
  }
  const created = await run(
    'INSERT INTO issue_statuses (project_id, name, position, color, category) VALUES (?, ?, ?, ?, ?)',
    [projectId, name, position, color, category],
  )
  const row = await get('SELECT id, project_id, name, position, color, category FROM issue_statuses WHERE id = ?', [created.lastID])
  res.status(201).json(row)
}))

// PUT update a status (Admin only)
router.put('/statuses/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM issue_statuses WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Status not found' })
    return
  }
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name
  const color = req.body?.color !== undefined ? String(req.body.color).trim() : existing.color
  const category = req.body?.category !== undefined ? String(req.body.category).trim() : existing.category
  const position = req.body?.position !== undefined ? Number(req.body.position) : existing.position
  if (!name) {
    res.status(400).json({ error: 'Status name is required' })
    return
  }
  if (!HEX.test(color)) {
    res.status(400).json({ error: 'color must be a hex value like #FF5630' })
    return
  }
  if (!CATEGORIES.includes(category)) {
    res.status(400).json({ error: `category must be one of ${CATEGORIES.join(', ')}` })
    return
  }
  await run(
    'UPDATE issue_statuses SET name = ?, color = ?, position = ?, category = ? WHERE id = ?',
    [name, color, position, category, id],
  )
  const row = await get('SELECT id, project_id, name, position, color, category FROM issue_statuses WHERE id = ?', [id])
  res.json(row)
}))

// DELETE a status (Admin only)
router.delete('/statuses/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  await run('DELETE FROM issue_statuses WHERE id = ?', [id])
  res.json({ success: true })
}))

export default router
