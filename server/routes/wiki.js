import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { maxLengthError, WIKI_TITLE_MAX, WIKI_CONTENT_MAX } from '../utils/validation.js'

const router = Router()

/*
 * JL-66 — pages gained Spaces, hierarchy, a trash and a draft state.
 *
 * Deliberately an EXTENSION of this router rather than a second one. Pages are
 * one table (wiki_pages) with one versioning story, one search and one set of
 * issue links; a parallel "space pages" API would have duplicated all of it and
 * then drifted, which is the failure this repo has already paid for twice
 * (JL-359's two sanitisers, JL-425's two member directories).
 *
 * A page may belong to a project, a Space, or both. space_id is nullable
 * alongside project_id, so every page written before Spaces existed keeps
 * working untouched.
 */

/** JL-89: the columns every page response carries. Never SELECT *. */
const PAGE_COLUMNS =
  'id, project_id, space_id, title, parent_id, status, archived, deleted_at, deleted_by, created_by, updated_by, created_at, updated_at'

/** JL-95: a page is a draft until published. Existing rows are published. */
const PAGE_STATUSES = ['draft', 'published']

/*
 * JL-93/94: every listing reads LIVE pages only.
 *
 * Soft delete is what makes Trash and restore possible at all, but it means a
 * deleted row is still physically present — so anything that forgets this
 * clause shows deleted pages as though nothing happened. Stated once and
 * concatenated, rather than retyped per query.
 */
const LIVE = 'deleted_at IS NULL'

/**
 * JL-92: would re-parenting `pageId` under `nextParentId` create a cycle?
 *
 * A page made its own ancestor disappears from every tree at once: the tree
 * builder walks parents, finds no root, and the whole branch stops rendering.
 * Nothing else in the system would report it, because the rows are all still
 * there and individually valid.
 *
 * Walks upward from the proposed parent. Bounded by a hop limit as well as the
 * cycle check itself, so an already-corrupt chain in the database cannot spin
 * here forever.
 */
async function wouldCycle(pageId, nextParentId) {
  if (nextParentId == null) return false
  if (Number(nextParentId) === Number(pageId)) return true
  let cursor = Number(nextParentId)
  for (let hops = 0; hops < 64 && cursor != null; hops += 1) {
    // Sequential by nature: each step depends on the row before it.
    const row = await get('SELECT parent_id FROM wiki_pages WHERE id = ?', [cursor])
    if (!row) return false
    if (Number(row.parent_id) === Number(pageId)) return true
    cursor = row.parent_id
  }
  return false
}

/**
 * JL-95: can this caller see this page?
 *
 * A draft is visible only to the person writing it. Published pages follow the
 * ordinary rules. Returning false is rendered as 404 rather than 403 — the
 * existence of someone else's unpublished draft is not public information.
 */
function canSeePage(page, user) {
  if (!page) return false
  if (page.status !== 'draft') return true
  const email = String(user?.email || '').toLowerCase()
  return email && String(page.created_by || '').toLowerCase() === email
}

// GET /api/wiki?projectId=X | ?spaceId=Y — list live pages
router.get('/', asyncHandler(async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  const spaceId = req.query.spaceId ? Number(req.query.spaceId) : null
  if (!projectId && !spaceId) {
    res.status(400).json({ error: 'projectId or spaceId is required' })
    return
  }
  const column = spaceId ? 'space_id' : 'project_id'
  const rows = await all(
    `SELECT ${PAGE_COLUMNS} FROM wiki_pages WHERE ${column} = ? AND ${LIVE} ORDER BY title ASC`,
    [spaceId || projectId],
  )
  // A draft belongs to its author until published; everyone else sees the
  // Space as though it does not exist yet.
  res.json(rows.filter((row) => canSeePage(row, req.user)))
}))

/* ---------------------------------------------------------------- *
 * JL-91 — the page tree for a Space
 * ---------------------------------------------------------------- */
router.get('/tree', asyncHandler(async (req, res) => {
  const spaceId = req.query.spaceId ? Number(req.query.spaceId) : null
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  if (!spaceId && !projectId) {
    res.status(400).json({ error: 'projectId or spaceId is required' })
    return
  }
  const column = spaceId ? 'space_id' : 'project_id'
  const rows = await all(
    `SELECT ${PAGE_COLUMNS} FROM wiki_pages WHERE ${column} = ? AND ${LIVE} ORDER BY title ASC`,
    [spaceId || projectId],
  )
  const visible = rows.filter((row) => canSeePage(row, req.user))

  /*
   * Built in one pass over a map rather than by recursing with a query per
   * node: a deep tree would otherwise cost a round trip per level, and the
   * whole point of the sidebar is that it loads at once.
   *
   * A node whose parent is missing from this set — because the parent is
   * deleted, in another Space, or someone else's draft — is surfaced at the
   * ROOT rather than dropped. Hiding a page because its parent is invisible
   * loses it entirely, which is worse than showing it one level up.
   */
  const byId = new Map(visible.map((row) => [row.id, { ...row, children: [] }]))
  const roots = []
  for (const node of byId.values()) {
    const parent = node.parent_id != null ? byId.get(node.parent_id) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  res.json(roots)
}))

/* ---------------------------------------------------------------- *
 * JL-94 — Trash
 * ---------------------------------------------------------------- */
router.get('/trash', asyncHandler(async (req, res) => {
  const spaceId = req.query.spaceId ? Number(req.query.spaceId) : null
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  if (!spaceId && !projectId) {
    res.status(400).json({ error: 'projectId or spaceId is required' })
    return
  }
  const column = spaceId ? 'space_id' : 'project_id'
  const rows = await all(
    `SELECT ${PAGE_COLUMNS} FROM wiki_pages WHERE ${column} = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    [spaceId || projectId],
  )
  // Deleting a draft does not publish it: it stays the author's alone, so the
  // same visibility rule applies in the trash as in the tree.
  res.json(rows.filter((row) => canSeePage(row, req.user)))
}))

router.post('/:id/restore', requireRole('Member'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const page = await get(`SELECT ${PAGE_COLUMNS} FROM wiki_pages WHERE id = ?`, [id])
  if (!page) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }
  if (page.deleted_at == null) {
    res.status(409).json({ error: 'That page is not in the trash' })
    return
  }
  /*
   * Restore returns the page, not its old position. Its parent may itself have
   * been deleted since, and re-parenting under a deleted page would put the
   * restored page straight back out of sight. It comes back at the root of its
   * Space and can be moved (JL-92).
   */
  const orphaned = page.parent_id != null
    ? await get(`SELECT id FROM wiki_pages WHERE id = ? AND ${LIVE}`, [page.parent_id])
    : null
  await run(
    'UPDATE wiki_pages SET deleted_at = NULL, deleted_by = NULL, parent_id = ?, updated_at = NOW() WHERE id = ?',
    [page.parent_id != null && orphaned ? page.parent_id : null, id],
  )
  const row = await get(`SELECT ${PAGE_COLUMNS} FROM wiki_pages WHERE id = ?`, [id])
  res.json(row)
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
  /*
   * JL-93/95: the list endpoints filter deleted rows and other people's
   * drafts, so this one has to as well — a rule enforced on the listing but
   * not on the detail fetch is not enforced at all, since the id is guessable.
   * Both cases are 404, not 403: that a draft exists is itself private.
   */
  if (!row || row.deleted_at != null || !canSeePage(row, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }
  const children = await all(
    `SELECT id, title, created_at FROM wiki_pages WHERE parent_id = ? AND ${LIVE} ORDER BY title ASC`,
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
  // JL-88/JL-95: a page belongs to a project, a Space, or both, and may start
  // life as a draft.
  const { projectId = null, spaceId = null, title, content = '', parentId = null, status } = req.body
  if ((!projectId && !spaceId) || !title?.trim()) {
    res.status(400).json({ error: 'projectId or spaceId, and title, are required' })
    return
  }
  const pageStatus = status === undefined ? 'published' : String(status)
  if (!PAGE_STATUSES.includes(pageStatus)) {
    res.status(400).json({ error: `status must be one of: ${PAGE_STATUSES.join(', ')}` })
    return
  }
  const trimmedTitle = String(title).trim()
  const trimmedContent = String(content ?? '').trim()

  // JL-237: server-side length caps (checked after trim)
  const lengthErr =
    maxLengthError('title', trimmedTitle, WIKI_TITLE_MAX) ||
    maxLengthError('content', trimmedContent, WIKI_CONTENT_MAX)
  if (lengthErr) {
    res.status(400).json({ error: lengthErr })
    return
  }

  const email = req.user.email
  const result = await run(
    'INSERT INTO wiki_pages (project_id, space_id, title, content, parent_id, status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [projectId, spaceId, trimmedTitle, trimmedContent, parentId, pageStatus, email, email],
  )
  // Save initial version
  await run(
    'INSERT INTO wiki_page_versions (page_id, version_number, title, content, edited_by) VALUES (?, ?, ?, ?, ?)',
    [result.lastID, 1, trimmedTitle, trimmedContent, email],
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

  // JL-92: a move changes parent_id, space_id, or both.
  const { title, content, parentId, spaceId, status } = req.body
  const nextTitle = title !== undefined ? String(title).trim() : undefined
  const nextContent = content !== undefined ? String(content ?? '').trim() : undefined

  // JL-237: length caps — only validate the fields the caller actually sent
  const lengthErr =
    (nextTitle !== undefined ? maxLengthError('title', nextTitle, WIKI_TITLE_MAX) : null) ||
    (nextContent !== undefined ? maxLengthError('content', nextContent, WIKI_CONTENT_MAX) : null)
  if (lengthErr) {
    res.status(400).json({ error: lengthErr })
    return
  }

  // JL-95: publishing a draft, or sending one back to draft.
  if (status !== undefined && !PAGE_STATUSES.includes(String(status))) {
    res.status(400).json({ error: `status must be one of: ${PAGE_STATUSES.join(', ')}` })
    return
  }

  /*
   * JL-92: refuse a move that would make the page its own ancestor. Checked
   * BEFORE anything is written — a half-applied move is how a tree ends up
   * with a branch nobody can reach.
   */
  if (parentId !== undefined && await wouldCycle(id, parentId)) {
    res.status(409).json({ error: 'That move would make the page its own ancestor' })
    return
  }

  const sets = []
  const params = []

  if (title !== undefined) { sets.push('title = ?'); params.push(nextTitle) }
  if (content !== undefined) { sets.push('content = ?'); params.push(nextContent) }
  if (parentId !== undefined) { sets.push('parent_id = ?'); params.push(parentId) }
  if (status !== undefined) { sets.push('status = ?'); params.push(String(status)) }
  if (spaceId !== undefined) {
    sets.push('space_id = ?')
    params.push(spaceId == null ? null : Number(spaceId))
    /*
     * Moving between Spaces detaches the page from its parent unless the
     * parent is coming too. A parent in the old Space would leave the page
     * rooted somewhere it no longer belongs, and invisible in both trees.
     */
    if (parentId === undefined) { sets.push('parent_id = ?'); params.push(null) }
  }

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
      [id, (lastVersion?.max_ver || 0) + 1, nextTitle ?? existing.title, nextContent ?? existing.content, req.user.email],
    )
  }

  const row = await get('SELECT * FROM wiki_pages WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/wiki/:id — delete a wiki page
/* ---------------------------------------------------------------- *
 * JL-93 — delete is SOFT, and does not take the subtree with it
 * ---------------------------------------------------------------- */
router.delete('/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const page = await get(`SELECT ${PAGE_COLUMNS} FROM wiki_pages WHERE id = ?`, [id])
  if (!page) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  /*
   * This used to be a hard DELETE, which made Trash impossible and destroyed
   * the row's version history with it — wiki_page_versions.page_id is
   * ON DELETE CASCADE.
   *
   * Children are PROMOTED to the root rather than cascaded. Losing a whole
   * branch because someone removed its root is the worst outcome available
   * here, and it is silent: the pages simply stop appearing. Per JL-81.
   */
  await run('UPDATE wiki_pages SET parent_id = NULL WHERE parent_id = ?', [id])
  await run(
    'UPDATE wiki_pages SET deleted_at = NOW(), deleted_by = ?, updated_at = NOW() WHERE id = ?',
    [req.user?.email || 'unknown', id],
  )
  res.json({ success: true, softDeleted: true, promotedChildren: true })
}))

// POST /api/wiki/:id/link-issue — link an issue to a wiki page
// Accepts { issueId } (numeric id) or { issueKey } (e.g. "ECM-12"); the issue
// must exist — a non-existent reference returns 404 instead of silently linking nothing (JL-301).
router.post('/:id/link-issue', requireRole('Member'), asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  const { issueId, issueKey } = req.body
  if (!issueId && !issueKey) {
    res.status(400).json({ error: 'issueId or issueKey is required' })
    return
  }

  let issue
  if (issueKey !== undefined && issueKey !== null && issueKey !== '') {
    const key = String(issueKey).trim()
    if (!key) {
      res.status(400).json({ error: 'issueKey cannot be empty' })
      return
    }
    issue = await get('SELECT id, issue_key FROM issues WHERE UPPER(issue_key) = UPPER(?)', [key])
    if (!issue) {
      res.status(404).json({ error: `Issue ${key} not found` })
      return
    }
  } else {
    const numericId = Number(issueId)
    if (!Number.isInteger(numericId) || numericId <= 0) {
      res.status(400).json({ error: 'issueId must be a valid issue id' })
      return
    }
    issue = await get('SELECT id, issue_key FROM issues WHERE id = ?', [numericId])
    if (!issue) {
      res.status(404).json({ error: `Issue ${numericId} not found` })
      return
    }
  }

  await run(
    'INSERT INTO issue_wiki_links (issue_id, wiki_page_id, created_by) VALUES (?, ?, ?) ON CONFLICT (issue_id, wiki_page_id) DO NOTHING',
    [issue.id, pageId, req.user.email],
  )
  res.status(201).json({ success: true, issueId: issue.id, issueKey: issue.issue_key })
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
