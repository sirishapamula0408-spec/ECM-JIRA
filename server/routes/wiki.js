import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

// GET /api/wiki?projectId=X — list wiki pages for a project
router.get('/', asyncHandler(async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required' })
    return
  }
  const rows = await all(
    'SELECT id, project_id, title, parent_id, created_by, updated_by, created_at, updated_at FROM wiki_pages WHERE project_id = ? ORDER BY title ASC',
    [projectId],
  )
  res.json(rows)
}))

// GET /api/wiki/:id — get a single wiki page with content
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM wiki_pages WHERE id = ?', [Number(req.params.id)])
  if (!row) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }
  // Get children
  const children = await all(
    'SELECT id, title, created_at FROM wiki_pages WHERE parent_id = ? ORDER BY title ASC',
    [row.id],
  )
  res.json({ ...row, children })
}))

// POST /api/wiki — create a wiki page
router.post('/', requireRole('Member'), asyncHandler(async (req, res) => {
  const { projectId, title, content = '', parentId = null } = req.body
  if (!projectId || !title?.trim()) {
    res.status(400).json({ error: 'projectId and title are required' })
    return
  }
  const email = req.user.email
  const result = await run(
    'INSERT INTO wiki_pages (project_id, title, content, parent_id, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, title.trim(), content, parentId, email, email],
  )
  const row = await get('SELECT * FROM wiki_pages WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// PATCH /api/wiki/:id — update a wiki page
router.patch('/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM wiki_pages WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const { title, content, parentId } = req.body
  const sets = []
  const params = []

  if (title !== undefined) { sets.push('title = ?'); params.push(title.trim()) }
  if (content !== undefined) { sets.push('content = ?'); params.push(content) }
  if (parentId !== undefined) { sets.push('parent_id = ?'); params.push(parentId) }

  if (sets.length === 0) {
    res.json(existing)
    return
  }

  sets.push('updated_by = ?')
  params.push(req.user.email)
  sets.push('updated_at = NOW()')
  params.push(id)

  await run(`UPDATE wiki_pages SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM wiki_pages WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/wiki/:id — delete a wiki page
router.delete('/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  await run('DELETE FROM wiki_pages WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

export default router
