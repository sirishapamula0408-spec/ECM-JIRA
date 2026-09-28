import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { pageVisibilityFilter } from '../utils/wikiVisibility.js'

/*
 * JL-115→119 — comments on a Confluence Lite page.
 *
 * ── Mounted beside the wiki router, not inside it ───────────────────────────
 *
 * Same /api/wiki mount point, separate file. wiki.js is already the page
 * lifecycle, versions and issue links; comments are a fourth concern that
 * shares only the page id.
 *
 * ── Visibility is inherited, never re-derived ───────────────────────────────
 *
 * Every route here loads the page through the SAME pageVisibilityFilter the
 * rest of Confluence Lite uses. Comments on a page you cannot read are as much
 * a disclosure as the page itself — arguably more, since a comment quotes the
 * part someone thought worth arguing about. The version endpoints shipped
 * without this check and had to be fixed in Phase 5; this one starts with it.
 */

const router = Router()

const BODY_MAX = 5000

/** Columns every comment response carries. Never SELECT *. */
const COMMENT_COLUMNS =
  'id, page_id, parent_id, author, body, edited_at, resolved_at, resolved_by, created_at'

/** The page, if this caller may see it. Null means 404, never 403. */
async function visiblePage(pageId, user) {
  if (!Number.isInteger(pageId) || pageId <= 0) return null
  const vis = await pageVisibilityFilter(user, 'w')
  return get(
    `SELECT w.id FROM wiki_pages w WHERE w.id = ? AND ${vis.clause}`,
    [pageId, ...vis.params],
  )
}

/** True when this user may moderate anyone's comment (JL-118). */
function isModerator(user) {
  const role = String(user?.workspaceRole || '')
  return role === 'Admin' || role === 'Owner' || user?.isOwner === true
}

const sameUser = (a, b) =>
  String(a || '').toLowerCase() === String(b || '').toLowerCase()

/* ---------------------------------------------------------------- *
 * JL-115/116/117 — read a page's comments, as threads
 * ---------------------------------------------------------------- */
router.get('/:id/comments', asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await visiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const rows = await all(
    `SELECT ${COMMENT_COLUMNS} FROM wiki_page_comments WHERE page_id = ? ORDER BY created_at ASC`,
    [pageId],
  )

  /*
   * Nested in one pass over a map rather than a query per thread: a busy page
   * would otherwise cost a round trip per root, and the panel exists to load
   * at once.
   *
   * A reply whose parent is missing is surfaced as a ROOT rather than dropped.
   * The FK cascade means that should not happen, but losing a comment because
   * of a data anomaly is worse than showing it one level up — the same call
   * the JL-91 page tree makes.
   */
  const byId = new Map(rows.map((r) => [r.id, { ...r, replies: [] }]))
  const threads = []
  for (const node of byId.values()) {
    const parent = node.parent_id != null ? byId.get(node.parent_id) : null
    if (parent) parent.replies.push(node)
    else threads.push(node)
  }

  res.json({ threads, total: rows.length })
}))

/* ---------------------------------------------------------------- *
 * JL-115/117 — add a comment, or a reply
 * ---------------------------------------------------------------- */
router.post('/:id/comments', requireRole('Member'), asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await visiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const body = String(req.body?.body ?? '').trim()
  if (!body) {
    res.status(400).json({ error: 'A comment cannot be empty' })
    return
  }
  if (body.length > BODY_MAX) {
    res.status(400).json({ error: `A comment cannot be longer than ${BODY_MAX} characters` })
    return
  }

  let parentId = req.body?.parentId ?? null
  if (parentId != null) {
    const parent = await get(
      'SELECT id, parent_id, page_id FROM wiki_page_comments WHERE id = ?',
      [Number(parentId)],
    )
    // A parent on another page would let a reply be smuggled onto a page the
    // author never opened.
    if (!parent || parent.page_id !== pageId) {
      res.status(404).json({ error: 'That comment does not exist on this page' })
      return
    }
    /*
     * JL-117: threads are ONE level deep. Replying to a reply attaches to the
     * same root instead of nesting further — an unbounded tree is unreadable
     * at width, and every product that allows it ends up capping the display
     * depth anyway, which means the extra depth was never real.
     */
    parentId = parent.parent_id != null ? parent.parent_id : parent.id
  }

  const created = await run(
    'INSERT INTO wiki_page_comments (page_id, parent_id, author, body) VALUES (?, ?, ?, ?)',
    [pageId, parentId, req.user.email, body],
  )
  const row = await get(
    `SELECT ${COMMENT_COLUMNS} FROM wiki_page_comments WHERE id = ?`,
    [created.lastID],
  )
  res.status(201).json(row)
}))

/* ---------------------------------------------------------------- *
 * JL-118 — edit and delete, with role rules
 * ---------------------------------------------------------------- */
router.patch('/:id/comments/:commentId', requireRole('Member'), asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await visiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const comment = await get(
    `SELECT ${COMMENT_COLUMNS} FROM wiki_page_comments WHERE id = ? AND page_id = ?`,
    [Number(req.params.commentId), pageId],
  )
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' })
    return
  }

  /*
   * Editing is the AUTHOR's alone — not an admin's. An admin editing someone
   * else's words while the byline still says that person is a
   * misattribution, and the audit value of a comment is that it is what its
   * author wrote. Admins may DELETE (below), which removes without
   * misrepresenting.
   */
  if (!sameUser(comment.author, req.user.email)) {
    res.status(403).json({ error: 'Only the author can edit a comment' })
    return
  }

  const body = String(req.body?.body ?? '').trim()
  if (!body) {
    res.status(400).json({ error: 'A comment cannot be empty' })
    return
  }
  if (body.length > BODY_MAX) {
    res.status(400).json({ error: `A comment cannot be longer than ${BODY_MAX} characters` })
    return
  }

  // edited_at is set so the UI can disclose the edit. A silently rewritten
  // comment changes what a thread appears to have said.
  await run(
    'UPDATE wiki_page_comments SET body = ?, edited_at = NOW() WHERE id = ?',
    [body, comment.id],
  )
  const row = await get(
    `SELECT ${COMMENT_COLUMNS} FROM wiki_page_comments WHERE id = ?`,
    [comment.id],
  )
  res.json(row)
}))

router.delete('/:id/comments/:commentId', requireRole('Member'), asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await visiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const comment = await get(
    'SELECT id, author, parent_id FROM wiki_page_comments WHERE id = ? AND page_id = ?',
    [Number(req.params.commentId), pageId],
  )
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' })
    return
  }

  // JL-118: the author, or a workspace Admin/Owner moderating.
  if (!sameUser(comment.author, req.user.email) && !isModerator(req.user)) {
    res.status(403).json({ error: 'Only the author or an admin can delete a comment' })
    return
  }

  /*
   * Replies go with their root, via the FK cascade rather than a second
   * DELETE here — leaving the database to enforce it means a future code path
   * that deletes a comment cannot forget.
   */
  await run('DELETE FROM wiki_page_comments WHERE id = ?', [comment.id])
  res.json({ success: true, deletedReplies: comment.parent_id == null })
}))

/* ---------------------------------------------------------------- *
 * JL-119 — resolve a thread
 * ---------------------------------------------------------------- */
router.post('/:id/comments/:commentId/resolve', requireRole('Member'), asyncHandler(async (req, res) => {
  const pageId = Number(req.params.id)
  if (!await visiblePage(pageId, req.user)) {
    res.status(404).json({ error: 'Wiki page not found' })
    return
  }

  const comment = await get(
    `SELECT ${COMMENT_COLUMNS} FROM wiki_page_comments WHERE id = ? AND page_id = ?`,
    [Number(req.params.commentId), pageId],
  )
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' })
    return
  }
  /*
   * Resolution is a property of the THREAD, so only a root can carry it.
   * Resolving a reply would let one message claim a state different from the
   * conversation it belongs to.
   */
  if (comment.parent_id != null) {
    res.status(400).json({ error: 'Resolve the thread, not an individual reply' })
    return
  }

  const resolved = req.body?.resolved !== false
  await run(
    'UPDATE wiki_page_comments SET resolved_at = ?, resolved_by = ? WHERE id = ?',
    // Reopening clears both, so a reopened thread is indistinguishable from
    // one that was never resolved — which is what it is.
    resolved ? [new Date().toISOString(), req.user.email, comment.id] : [null, null, comment.id],
  )
  const row = await get(
    `SELECT ${COMMENT_COLUMNS} FROM wiki_page_comments WHERE id = ?`,
    [comment.id],
  )
  res.json(row)
}))

export default router
