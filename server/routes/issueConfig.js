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

/**
 * JL-332 — copy the global defaults into a project before it takes its first
 * project-scoped row.
 *
 * The fallback above is all-or-nothing: a project sees the globals only while it
 * owns ZERO rows. So adding a single status used to flip the whole set off —
 * five statuses became one, every transition stopped rendering (both endpoints
 * must resolve to a node), and the damage persisted in the database.
 *
 * Materialising first makes the fallback a one-way door taken deliberately, not
 * a side effect of the first edit. Idempotent: a no-op once the project owns
 * rows. Returns the number of rows copied.
 */
export async function materializeProjectStatuses(projectId) {
  const own = await all('SELECT id FROM issue_statuses WHERE project_id = ?', [projectId])
  if (own.length > 0) return 0

  const globals = await all(
    'SELECT name, position, color, category FROM issue_statuses WHERE project_id IS NULL ORDER BY position ASC, name ASC',
    [],
  )
  for (const g of globals) {
    await run(
      'INSERT INTO issue_statuses (project_id, name, position, color, category) VALUES (?, ?, ?, ?, ?)',
      [projectId, g.name, g.position, g.color, g.category],
    )
  }
  return globals.length
}

/** Same one-way-door problem for priorities. */
export async function materializeProjectPriorities(projectId) {
  const own = await all('SELECT id FROM issue_priorities WHERE project_id = ?', [projectId])
  if (own.length > 0) return 0

  const globals = await all(
    'SELECT name, position, color FROM issue_priorities WHERE project_id IS NULL ORDER BY position ASC, name ASC',
    [],
  )
  for (const g of globals) {
    await run(
      'INSERT INTO issue_priorities (project_id, name, position, color) VALUES (?, ?, ?, ?)',
      [projectId, g.name, g.position, g.color],
    )
  }
  return globals.length
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
  // JL-332: copy the globals down BEFORE inserting, so adding one status no
  // longer hides every other status the project was displaying.
  await materializeProjectStatuses(projectId)

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
  const status = await get('SELECT id, project_id, name FROM issue_statuses WHERE id = ?', [id])
  if (!status) {
    res.status(404).json({ error: 'Status not found' })
    return
  }

  // JL-332: a status shown via the global fallback carries a GLOBAL id, so the
  // old unconditional DELETE removed it for every project at once. Refuse, and
  // point the caller at the per-project route instead.
  if (status.project_id === null) {
    res.status(400).json({
      error:
        'That status is a global default shared by every project. Add a project-level status set before removing it.',
    })
    return
  }

  // Refuse to delete a status that still holds issues — silently orphaning them
  // is how issues ended up in statuses their project no longer lists.
  const inUse = await get(
    'SELECT COUNT(*)::int AS count FROM issues WHERE project_id = ? AND LOWER(status) = LOWER(?)',
    [status.project_id, status.name],
  )
  if (Number(inUse?.count || 0) > 0) {
    res.status(409).json({
      error: `Cannot delete "${status.name}" — ${inUse.count} issue(s) are still in it. Move them first.`,
    })
    return
  }

  // JL-332: cascade to transitions. A bare status DELETE left orphaned
  // workflow_transitions rows that stayed in the rules table and stayed enforced
  // by the engine, while drawing nothing on the canvas.
  await run(
    'DELETE FROM workflow_transitions WHERE project_id = ? AND (LOWER(from_status) = LOWER(?) OR LOWER(to_status) = LOWER(?))',
    [status.project_id, status.name, status.name],
  )
  await run('DELETE FROM issue_statuses WHERE id = ?', [id])
  res.json({ success: true })
}))

export default router
