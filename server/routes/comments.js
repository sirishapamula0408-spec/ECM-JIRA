import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireProjectRead, requireProjectWrite } from '../middleware/authorize.js'
import { createNotification } from './notifications.js'
import { extractMentions, processMentions } from '../services/mentions.js'
import { runCommentAutomations } from '../services/automation.js'
import { emitEvent } from '../services/events.js'
import { publish } from '../services/realtime.js'

const router = Router()

// JL-226: resolve the project id a comment mutation acts on, from the issue id
// path param, for the project-access write guard. Returns null (→ legacy
// workspace Member+ gate) for a bad id or a project-less/absent issue.
const commentIssueProject = async (req) => {
  const issueId = Number(req.params.issueId)
  if (!Number.isInteger(issueId)) return null
  const row = await get('SELECT project_id FROM issues WHERE id = ?', [issueId])
  return row?.project_id ?? null
}

// JL-286: resolve the project a reaction acts on, from the comment id, via
// comment → issue → project_id, for the project-access write guard.
const reactionCommentProject = async (req) => {
  const commentId = Number(req.params.id)
  if (!Number.isInteger(commentId)) return null
  const row = await get(
    `SELECT i.project_id FROM comments c JOIN issues i ON i.id = c.issue_id WHERE c.id = ?`,
    [commentId],
  )
  return row?.project_id ?? null
}

// JL-139: fixed allow-list of emoji usable as comment reactions.
export const REACTION_EMOJIS = ['👍', '👎', '❤️', '🎉', '😄', '👀', '🚀', '😕']

/**
 * Build the aggregated reaction summary for a set of comment ids.
 * Returns a Map<commentId, [{ emoji, count, reactedByMe }]> aggregated by emoji.
 */
async function loadReactions(commentIds, userEmail) {
  const summary = new Map()
  if (!commentIds.length) return summary
  const placeholders = commentIds.map(() => '?').join(', ')
  const rows = await all(
    `SELECT comment_id, emoji,
            COUNT(*) AS count,
            SUM(CASE WHEN user_email = ? THEN 1 ELSE 0 END) AS mine
       FROM comment_reactions
      WHERE comment_id IN (${placeholders})
      GROUP BY comment_id, emoji
      ORDER BY emoji`,
    [userEmail, ...commentIds],
  )
  for (const r of rows) {
    if (!summary.has(r.comment_id)) summary.set(r.comment_id, [])
    summary.get(r.comment_id).push({
      emoji: r.emoji,
      count: Number(r.count),
      reactedByMe: Number(r.mine) > 0,
    })
  }
  return summary
}

/**
 * JL-99: Resolve a stored comment author string to a friendly display name.
 * Historically the author column may hold an email (or a blank that was
 * persisted as the literal 'Unknown'). If it matches a known member's email,
 * return that member's name; otherwise return the original value unchanged.
 */
async function resolveAuthorDisplay(author) {
  const value = String(author || '').trim()
  if (!value || value === 'Unknown') {
    return value || 'Unknown'
  }
  // Only attempt a member lookup when the stored value looks like an email.
  if (value.includes('@')) {
    const member = await get('SELECT name FROM members WHERE email = ? LIMIT 1', [value])
    if (member?.name) return member.name
  }
  return value
}

// GET /api/issues/:issueId/comments
router.get('/:issueId/comments', requireProjectRead(commentIssueProject), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    'SELECT id, issue_id, author, text, created_at, edited_at FROM comments WHERE issue_id = ? ORDER BY created_at DESC',
    [issueId],
  )
  // JL-99: upgrade email-based authors to member display names so the UI
  // never shows a raw email (or a stale 'Unknown') for a known member.
  const resolved = await Promise.all(
    rows.map(async (row) => ({ ...row, author: await resolveAuthorDisplay(row.author) })),
  )
  // JL-139: attach aggregated emoji reactions for the requesting user
  const reactions = await loadReactions(rows.map((r) => r.id), req.user.email)
  res.json(resolved.map((r) => ({ ...r, reactions: reactions.get(r.id) || [] })))
}))

// POST /api/issues/:issueId/comments
router.post('/:issueId/comments', requireProjectWrite(commentIssueProject), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const { author, text } = req.body
  const normalizedAuthor = String(author || '').trim()
  const normalizedText = String(text || '').trim()

  if (!normalizedText) {
    res.status(400).json({ error: 'Comment text is required' })
    return
  }

  // JL-99: never persist the literal 'Unknown'. When the client omits an
  // author, derive one from the authenticated user — their member name, or
  // failing that their email — so comments always show a real author.
  let resolvedAuthor = normalizedAuthor
  if (!resolvedAuthor) {
    const member = req.user?.email
      ? await get('SELECT name FROM members WHERE email = ? LIMIT 1', [req.user.email])
      : null
    resolvedAuthor = member?.name || req.user?.email || 'Unknown'
  }

  const created = await run(
    'INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)',
    [issueId, resolvedAuthor, normalizedText],
  )
  const row = await get('SELECT id, issue_id, author, text, created_at, edited_at FROM comments WHERE id = ?', [created.lastID])

  // Process @mentions (shared with issue descriptions — see services/mentions.js)
  const mentionedEmails = extractMentions(normalizedText)
  await processMentions({
    text: normalizedText,
    issueId,
    actorEmail: req.user.email,
    actorLabel: resolvedAuthor,
    commentId: created.lastID,
  })

  // Notify issue watchers
  const watchers = await all('SELECT user_email FROM watchers WHERE issue_id = ? AND user_email != ?', [issueId, req.user.email])
  const issue = await get('SELECT issue_key, project_id FROM issues WHERE id = ?', [issueId])
  for (const watcher of watchers) {
    if (!mentionedEmails.includes(watcher.user_email)) {
      await createNotification({
        recipientEmail: watcher.user_email,
        type: 'comment',
        title: `New comment on ${issue?.issue_key || 'an issue'}`,
        message: `${resolvedAuthor}: "${normalizedText.slice(0, 100)}"`,
        issueId,
        projectId: issue?.project_id || null,
        actorEmail: req.user.email,
      })
    }
  }

  // JL-43: Auto-watch on comment for the commenter
  await run(
    'INSERT INTO watchers (issue_id, user_email) VALUES (?, ?) ON CONFLICT (issue_id, user_email) DO NOTHING',
    [issueId, req.user.email],
  )

  // Theme-1 #8: fire comment-added automation rules (non-fatal)
  const fullIssue = await get('SELECT id, issue_key, project_id, assignee FROM issues WHERE id = ?', [issueId])
  await runCommentAutomations(fullIssue, normalizedText).catch(() => {})

  // JL-59: emit comment.created event to subscribed webhooks (fire-and-forget)
  emitEvent(
    'comment.created',
    { comment: row, issueId, issueKey: fullIssue?.issue_key || null },
    fullIssue?.project_id ?? null,
  ).catch(() => {})

  // JL-136: push a live update to everyone viewing this issue (no-op if realtime
  // isn't initialized, so route tests are unaffected).
  publish(`issue:${issueId}`, { type: 'update', room: `issue:${issueId}`, entity: 'comment', id: created.lastID, action: 'created' })

  res.status(201).json(row)
}))

// POST /api/comments/:id/reactions — toggle an emoji reaction (JL-139).
// Mounted at /api/comments in index.js, so the router path is /:id/reactions.
router.post('/:id/reactions', requireProjectWrite(reactionCommentProject), asyncHandler(async (req, res) => {
  const commentId = Number(req.params.id)
  const emoji = String(req.body?.emoji || '').trim()

  if (!REACTION_EMOJIS.includes(emoji)) {
    res.status(400).json({ error: 'Invalid emoji', allowed: REACTION_EMOJIS })
    return
  }

  const comment = await get('SELECT id FROM comments WHERE id = ?', [commentId])
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' })
    return
  }

  const existing = await get(
    'SELECT id FROM comment_reactions WHERE comment_id = ? AND emoji = ? AND user_email = ?',
    [commentId, emoji, req.user.email],
  )

  if (existing) {
    await run('DELETE FROM comment_reactions WHERE id = ?', [existing.id])
  } else {
    await run(
      'INSERT INTO comment_reactions (comment_id, emoji, user_email) VALUES (?, ?, ?) ON CONFLICT (comment_id, emoji, user_email) DO NOTHING',
      [commentId, emoji, req.user.email],
    )
  }

  const summary = await loadReactions([commentId], req.user.email)
  res.json({ commentId, reactions: summary.get(commentId) || [] })
}))

/**
 * JL-160: Determine whether the current user may edit/delete a comment.
 * Admins (workspace Admin or Owner) always may. Otherwise the user must be
 * the comment's author, resolved against the same identity the POST path uses
 * (req.user): match the stored display-name `author` against the caller's
 * member display name or their email (case-insensitive).
 */
async function canModifyComment(req, comment) {
  if (req.user.isOwner || req.user.workspaceRole === 'Admin') return true
  const author = String(comment.author || '').trim().toLowerCase()
  if (!author) return false
  if (author === String(req.user.email || '').trim().toLowerCase()) return true
  const me = await get('SELECT name FROM members WHERE LOWER(email) = LOWER(?)', [req.user.email])
  const myName = String(me?.name || '').trim().toLowerCase()
  return Boolean(myName) && author === myName
}

// PATCH /api/issues/:issueId/comments/:commentId — edit comment (author or Admin)
router.patch('/:issueId/comments/:commentId', requireProjectWrite(commentIssueProject), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const commentId = Number(req.params.commentId)
  const normalizedText = String(req.body?.text ?? '').trim()

  if (!normalizedText) {
    res.status(400).json({ error: 'Comment text is required' })
    return
  }

  const comment = await get(
    'SELECT id, issue_id, author, text, created_at, edited_at FROM comments WHERE id = ? AND issue_id = ?',
    [commentId, issueId],
  )
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' })
    return
  }

  if (!(await canModifyComment(req, comment))) {
    res.status(403).json({ error: 'You can only edit your own comments' })
    return
  }

  await run('UPDATE comments SET text = ?, edited_at = NOW() WHERE id = ?', [normalizedText, commentId])
  const row = await get('SELECT id, issue_id, author, text, created_at, edited_at FROM comments WHERE id = ?', [commentId])
  res.json(row)
}))

// DELETE /api/issues/:issueId/comments/:commentId — delete comment (author or Admin)
router.delete('/:issueId/comments/:commentId', requireProjectWrite(commentIssueProject), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const commentId = Number(req.params.commentId)

  const comment = await get(
    'SELECT id, issue_id, author, text, created_at, edited_at FROM comments WHERE id = ? AND issue_id = ?',
    [commentId, issueId],
  )
  if (!comment) {
    res.status(404).json({ error: 'Comment not found' })
    return
  }

  if (!(await canModifyComment(req, comment))) {
    res.status(403).json({ error: 'You can only delete your own comments' })
    return
  }

  await run('DELETE FROM comments WHERE id = ?', [commentId])
  res.json({ success: true, id: commentId })
}))

export default router
