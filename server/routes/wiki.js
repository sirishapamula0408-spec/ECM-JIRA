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

// GET /api/wiki/search?projectId=X&q=term — full-text search across wiki pages
router.get('/search', asyncHandler(async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  const query = String(req.query.q || '').trim()
  if (!query) {
    res.json([])
    return
  }
  const searchTerm = `%${query}%`
  let sql = 'SELECT id, project_id, title, created_by, updated_at FROM wiki_pages WHERE (title ILIKE ? OR content ILIKE ?)'
  const params = [searchTerm, searchTerm]
  if (projectId) {
    sql += ' AND project_id = ?'
    params.push(projectId)
  }
  sql += ' ORDER BY updated_at DESC LIMIT 50'
  const rows = await all(sql, params)
  res.json(rows)
}))

// GET /api/wiki/:id — get a single wiki page with content
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM wiki_pages WHERE id = ?', [Number(req.params.id)])
  if (!row) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }
  const children = await all(
    'SELECT id, title, created_at FROM wiki_pages WHERE parent_id = ? ORDER BY title ASC',
    [row.id],
  )
  // Get linked issues
  const linkedIssues = await all(
    'SELECT iwl.id AS link_id, iwl.issue_id, i.issue_key, i.title AS issue_title FROM issue_wiki_links iwl JOIN issues i ON i.id = iwl.issue_id WHERE iwl.wiki_page_id = ? ORDER BY iwl.created_at DESC',
    [row.id],
  )
  res.json({ ...row, children, linkedIssues })
}))

// GET /api/wiki/:id/versions — get version history
router.get('/:id/versions', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT id, page_id, version_number, title, edited_by, created_at FROM wiki_page_versions WHERE page_id = ? ORDER BY version_number DESC',
    [Number(req.params.id)],
  )
  res.json(rows)
}))

// GET /api/wiki/:id/versions/:versionId — get a specific version
router.get('/:id/versions/:versionId', asyncHandler(async (req, res) => {
  const row = await get(
    'SELECT * FROM wiki_page_versions WHERE id = ? AND page_id = ?',
    [Number(req.params.versionId), Number(req.params.id)],
  )
  if (!row) {
    res.status(404).json({ error: 'Version not found' })
    return
  }
  res.json(row)
}))

// POST /api/wiki — create a wiki page (saves initial version)
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
  // Save initial version
  await run(
    'INSERT INTO wiki_page_versions (page_id, version_number, title, content, edited_by) VALUES (?, ?, ?, ?, ?)',
    [result.lastID, 1, title.trim(), content, email],
  )
  const row = await get('SELECT * FROM wiki_pages WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// PATCH /api/wiki/:id — update a wiki page (creates new version)
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

  // Create new version if title or content changed
  if (title !== undefined || content !== undefined) {
    const lastVersion = await get(
      'SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM wiki_page_versions WHERE page_id = ?',
      [id],
    )
    await run(
      'INSERT INTO wiki_page_versions (page_id, version_number, title, content, edited_by) VALUES (?, ?, ?, ?, ?)',
      [id, (lastVersion?.max_ver || 0) + 1, title ?? existing.title, content ?? existing.content, req.user.email],
    )
  }

  const row = await get('SELECT * FROM wiki_pages WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/wiki/:id — delete a wiki page
router.delete('/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  await run('DELETE FROM wiki_pages WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

// POST /api/wiki/:id/link-issue — link an issue to a wiki page
router.post('/:id/link-issue', requireRole('Member'), asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  const { issueId } = req.body
  if (!issueId) {
    res.status(400).json({ error: 'issueId is required' })
    return
  }
  await run(
    'INSERT INTO issue_wiki_links (issue_id, wiki_page_id, created_by) VALUES (?, ?, ?) ON CONFLICT (issue_id, wiki_page_id) DO NOTHING',
    [Number(issueId), pageId, req.user.email],
  )
  res.status(201).json({ success: true })
}))

// DELETE /api/wiki/:id/link-issue/:issueId — unlink an issue
router.delete('/:id/link-issue/:issueId', requireRole('Member'), asyncHandler(async (req, res) => {
  await run(
    'DELETE FROM issue_wiki_links WHERE wiki_page_id = ? AND issue_id = ?',
    [Number(req.params.id), Number(req.params.issueId)],
  )
  res.json({ success: true })
}))

export default router
