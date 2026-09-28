import { Router } from 'express'
/*
 * JL-140 — administrative actions go to the EXISTING JIRA Lite audit log.
 *
 * safeAppendAudit swallows its own failures by design: an audit write must
 * never be the reason a user's action fails. These calls are deliberately not
 * awaited, so the response does not wait on the log either.
 *
 * Only ADMINISTRATIVE actions are recorded — create, delete, restore.
 * Ordinary edits are NOT, because wiki_page_versions already records every one
 * with an author and a timestamp; duplicating that here would double the
 * volume while adding nothing a reader could not already see.
 */
import { safeAppendAudit } from '../services/auditLog.js'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { maxLengthError, WIKI_TITLE_MAX, WIKI_CONTENT_MAX } from '../utils/validation.js'
// JL-109: comparing two revisions.
import { diffLines, contentToLines, summarise } from '../utils/textDiff.js'
// JL-135: the reverse lookup is gated by the same page rule as every read.
import { pageVisibilityFilter } from '../utils/wikiVisibility.js'

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

/**
 * JL-103 — the page's current version number.
 *
 * MAX(version_number) is already how a new version's number is chosen on write
 * (see POST and PATCH below), so reusing it as the concurrency token means
 * there is ONE notion of "which revision is this" rather than a second counter
 * that could disagree with the history the user is shown.
 *
 * Returns 0 for a page with no versions, which cannot happen for a page
 * created through POST but keeps a hand-inserted row from throwing.
 */
async function currentVersion(pageId) {
  const row = await get(
    'SELECT COALESCE(MAX(version_number), 0) AS v FROM wiki_page_versions WHERE page_id = ?',
    [pageId],
  )
  return Number(row?.v || 0)
}

/**
 * JL-108/JL-109 — load a page only if this caller may see it.
 *
 * The version endpoints below had NO visibility check: they read
 * wiki_page_versions by page_id directly, so another author's unpublished
 * draft, or a page sitting in the trash, had its full content readable
 * through its own history. Gating the page while leaving its history open
 * protects nothing — the history IS the content, one revision per row.
 *
 * Same shape as the fix applied to GET /:id: 404 rather than 403, because
 * that a draft exists is itself private.
 */
async function loadVisiblePage(id, user) {
  const page = await get(`SELECT ${PAGE_COLUMNS} FROM wiki_pages WHERE id = ?`, [id])
  if (!page || page.deleted_at != null || !canSeePage(page, user)) return null
  return page
}

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
  safeAppendAudit({
    actor: req.user?.email || 'unknown',
    action: 'wikipage.restored',
    target: `wikipage:${id}`,
    metadata: { title: page.title },
  })

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

/* ---------------------------------------------------------------- *
 * JL-135 — the pages linked to an ISSUE
 *
 * The reverse of the list above, for the Jira side of the link.
 * JL-136 made linking bidirectional in the data; this makes it
 * bidirectional in the product, which is the half a reader notices.
 *
 * Declared before /:id/link-issue so "by-issue" is not read as a page
 * id — the same ordering trap the JL-109 compare route hit.
 * ---------------------------------------------------------------- */
router.get('/by-issue/:issueId', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  if (!Number.isInteger(issueId) || issueId <= 0) {
    res.status(400).json({ error: 'A numeric issue id is required' })
    return
  }

  /*
   * Filtered by the SAME page-visibility rule as everything else. Reaching a
   * page through an issue must not be a way around the page's permissions —
   * otherwise the link table becomes a side door, and an issue is a much more
   * widely-readable object than a Space.
   */
  const vis = await pageVisibilityFilter(req.user, 'w')
  const rows = await all(
    `SELECT iwl.id AS link_id, w.id, w.title, w.space_id, s.name AS space_name,
            s.key AS space_key, w.updated_at
       FROM issue_wiki_links iwl
       JOIN wiki_pages w ON w.id = iwl.wiki_page_id
       LEFT JOIN spaces s ON s.id = w.space_id
      WHERE iwl.issue_id = ? AND ${vis.clause}
      ORDER BY iwl.created_at DESC`,
    [issueId, ...vis.params],
  )
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
  // JL-103: the client holds on to this and sends it back on save, so a
  // PATCH built from stale content can be refused rather than silently
  // overwriting whatever was written in between.
  const version = await currentVersion(row.id)

  // Get linked issues
  /*
   * JL-132/133 — key, summary and STATUS for each linked issue.
   *
   * The status is JOINed from `issues` on every read rather than copied into
   * issue_wiki_links at link time. That is the whole of JL-133: a status
   * stored alongside the link would be correct at the moment it was written
   * and wrong from the next transition onwards, and documentation that
   * confidently shows a stale status is worse than documentation that shows
   * none — a reader has no way to tell the difference.
   *
   * The cost is one join on a page read, against a primary key. That is the
   * right trade for a value whose entire purpose is to be current.
   */
  const linkedIssues = await all(
    `SELECT iwl.id AS link_id, iwl.issue_id, i.issue_key,
            i.title AS issue_title, i.status AS issue_status,
            i.priority AS issue_priority, i.issue_type
       FROM issue_wiki_links iwl
       JOIN issues i ON i.id = iwl.issue_id
      WHERE iwl.wiki_page_id = ?
      ORDER BY iwl.created_at DESC`,
    [row.id],
  )
  res.json({ ...row, children, linkedIssues, version })
}))

// GET /api/wiki/:id/versions — get version history
router.get('/:id/versions', asyncHandler(async (req, res) => {
  // JL-108: the history is the content, so it is gated like the content.
  if (!await loadVisiblePage(Number(req.params.id), req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }
  const rows = await all(
    'SELECT id, page_id, version_number, title, edited_by, created_at FROM wiki_page_versions WHERE page_id = ? ORDER BY version_number DESC',
    [Number(req.params.id)],
  )
  res.json(rows)
}))

/* ---------------------------------------------------------------- *
 * JL-109 — compare two versions
 *
 * Declared BEFORE /:id/versions/:versionId so "compare" is not read
 * as a version id. Express matches in declaration order, and
 * Number('compare') is NaN, which would have queried for a version
 * that cannot exist and returned a 404 for a working feature.
 * ---------------------------------------------------------------- */
router.get('/:id/versions/compare', asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await loadVisiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const fromNo = Number(req.query.from)
  const toNo = Number(req.query.to)
  if (!Number.isInteger(fromNo) || !Number.isInteger(toNo)) {
    res.status(400).json({ error: 'from and to version numbers are required' })
    return
  }

  const [from, to] = await Promise.all([
    get('SELECT * FROM wiki_page_versions WHERE page_id = ? AND version_number = ?', [pageId, fromNo]),
    get('SELECT * FROM wiki_page_versions WHERE page_id = ? AND version_number = ?', [pageId, toNo]),
  ])
  if (!from || !to) {
    res.status(404).json({ error: 'Version not found' })
    return
  }

  const diff = diffLines(contentToLines(from.content), contentToLines(to.content))
  res.json({
    from: { versionNumber: from.version_number, title: from.title, editedBy: from.edited_by, createdAt: from.created_at },
    to: { versionNumber: to.version_number, title: to.title, editedBy: to.edited_by, createdAt: to.created_at },
    // A rename is a change a line diff over the body would never show.
    titleChanged: from.title !== to.title,
    diff,
    summary: summarise(diff),
  })
}))

// GET /api/wiki/:id/versions/:versionId — get a specific version
router.get('/:id/versions/:versionId', asyncHandler(async (req, res) => {
  if (!await loadVisiblePage(Number(req.params.id), req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }
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

/* ---------------------------------------------------------------- *
 * JL-108 — restore a previous version
 * ---------------------------------------------------------------- */
router.post('/:id/versions/:versionId/restore', requireRole('Member'), asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  const page = await loadVisiblePage(pageId, req.user)
  if (!page) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const source = await get(
    'SELECT * FROM wiki_page_versions WHERE id = ? AND page_id = ?',
    [Number(req.params.versionId), pageId],
  )
  if (!source) {
    res.status(404).json({ error: 'Version not found' })
    return
  }

  /*
   * A restore APPENDS a new version carrying the old content. It does not
   * rewind the page to an earlier row and it never edits or deletes one.
   *
   * That is what JL-141 (immutability of version history) requires, and it is
   * also the only behaviour that makes a restore itself undoable: the edits
   * being stepped back over remain in the history, so restoring the wrong
   * version is recoverable rather than destructive.
   */
  const last = await get(
    'SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM wiki_page_versions WHERE page_id = ?',
    [pageId],
  )
  const nextNumber = (last?.max_ver || 0) + 1

  await run(
    'INSERT INTO wiki_page_versions (page_id, version_number, title, content, edited_by) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [pageId, nextNumber, source.title, source.content, req.user.email],
  )
  await run(
    'UPDATE wiki_pages SET title = ?, content = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
    [source.title, source.content, req.user.email, pageId],
  )

  const updated = await get('SELECT * FROM wiki_pages WHERE id = ?', [pageId])
  res.json({
    ...updated,
    version: nextNumber,
    restoredFrom: source.version_number,
  })
}))

// POST /api/wiki — create a wiki page (saves initial version)
router.post('/', requireRole('Member'), asyncHandler(async (req, res) => {
  // JL-88/JL-95: a page belongs to a project, a Space, or both, and may start
  // life as a draft.
  // JL-125: templateId supplies the starting body when no content is given.
  const { projectId = null, spaceId = null, title, content = '', parentId = null, status, templateId } = req.body
  if ((!projectId && !spaceId) || !title?.trim()) {
    res.status(400).json({ error: 'projectId or spaceId, and title, are required' })
    return
  }
  const pageStatus = status === undefined ? 'published' : String(status)
  if (!PAGE_STATUSES.includes(pageStatus)) {
    res.status(400).json({ error: `status must be one of: ${PAGE_STATUSES.join(', ')}` })
    return
  }
  /*
   * JL-125 — a template supplies the STARTING body, and only when the caller
   * has not written one. Explicit content wins: a client that sends both has
   * already made its choice, and silently discarding what someone typed in
   * favour of a template is the worse failure of the two.
   *
   * Resolved server-side rather than by the client fetching a template and
   * posting its body: that would let any caller claim any body came from a
   * template, and would mean the template text travelled twice over the wire
   * for no reason.
   */
  let startingContent = content
  if (templateId != null && !String(content).trim()) {
    const template = await get('SELECT body FROM wiki_templates WHERE id = ?', [Number(templateId)])
    if (!template) {
      res.status(404).json({ error: 'Template not found' })
      return
    }
    startingContent = template.body || ''
  }

  const trimmedTitle = String(title).trim()
  const trimmedContent = String(startingContent ?? '').trim()

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
  safeAppendAudit({
    actor: email,
    action: 'wikipage.created',
    target: `wikipage:${result.lastID}`,
    metadata: { title: trimmedTitle, spaceId, projectId },
  })

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
  // JL-103: expectedVersion is what the editor loaded.
  const { title, content, parentId, spaceId, status, expectedVersion } = req.body

  /*
   * JL-103 — refuse an edit written against a version that is no longer
   * current, rather than letting the later save silently discard the earlier
   * one. Checked BEFORE anything is written.
   *
   * Opt-in: a request that sends no expectedVersion behaves exactly as before.
   * A move (re-parenting from the tree) legitimately carries no version, and
   * so do the existing callers; only the page editor has a base revision to
   * compare against.
   *
   * 409 carries the current version and who wrote it, because "someone else
   * changed this" is only actionable if the client can say who and offer to
   * reload.
   */
  if (expectedVersion !== undefined && (title !== undefined || content !== undefined)) {
    const version = await currentVersion(id)
    if (Number(expectedVersion) !== version) {
      const latest = await get(
        'SELECT edited_by, created_at FROM wiki_page_versions WHERE page_id = ? ORDER BY version_number DESC LIMIT 1',
        [id],
      )
      res.status(409).json({
        error: 'That page was changed by someone else while you were editing it',
        currentVersion: version,
        yourVersion: Number(expectedVersion),
        editedBy: latest?.edited_by || null,
        editedAt: latest?.created_at || null,
      })
      return
    }
  }
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
  safeAppendAudit({
    actor: req.user?.email || 'unknown',
    action: 'wikipage.deleted',
    target: `wikipage:${id}`,
    // Recorded as soft so an audit reader knows it is recoverable without
    // having to know the implementation.
    metadata: { title: page.title, soft: true },
  })

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
