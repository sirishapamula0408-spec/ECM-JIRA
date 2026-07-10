import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { createNotification } from './notifications.js'
import { runCommentAutomations } from '../services/automation.js'
import { emitEvent } from '../services/events.js'

const router = Router()

/**
 * Extract @mentions from comment text.
 * Matches @email or @"display name" patterns.
 */
function extractMentions(text) {
  const mentions = []
  const regex = /@([\w.+-]+@[\w.-]+\.\w+)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1])
  }
  return [...new Set(mentions)]
}

// GET /api/issues/:issueId/comments
router.get('/:issueId/comments', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    'SELECT id, issue_id, author, text, created_at, edited_at FROM comments WHERE issue_id = ? ORDER BY created_at DESC',
    [issueId],
  )
  res.json(rows)
}))

// POST /api/issues/:issueId/comments
router.post('/:issueId/comments', requireRole('Member'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const { author, text } = req.body
  const normalizedAuthor = String(author || '').trim()
  const normalizedText = String(text || '').trim()

  if (!normalizedText) {
    res.status(400).json({ error: 'Comment text is required' })
    return
  }

  const created = await run(
    'INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)',
    [issueId, normalizedAuthor || 'Unknown', normalizedText],
  )
  const row = await get('SELECT id, issue_id, author, text, created_at, edited_at FROM comments WHERE id = ?', [created.lastID])

  // Process @mentions
  const mentionedEmails = extractMentions(normalizedText)
  for (const email of mentionedEmails) {
    await run('INSERT INTO mentions (comment_id, mentioned_email) VALUES (?, ?)', [created.lastID, email])

    // Get issue info for notification
    const issue = await get('SELECT issue_key, project_id FROM issues WHERE id = ?', [issueId])
    await createNotification({
      recipientEmail: email,
      type: 'mention',
      title: `Mentioned in ${issue?.issue_key || 'a comment'}`,
      message: `${normalizedAuthor} mentioned you: "${normalizedText.slice(0, 100)}"`,
      issueId,
      projectId: issue?.project_id || null,
      actorEmail: req.user.email,
    })
  }

  // Notify issue watchers
  const watchers = await all('SELECT user_email FROM watchers WHERE issue_id = ? AND user_email != ?', [issueId, req.user.email])
  const issue = await get('SELECT issue_key, project_id FROM issues WHERE id = ?', [issueId])
  for (const watcher of watchers) {
    if (!mentionedEmails.includes(watcher.user_email)) {
      await createNotification({
        recipientEmail: watcher.user_email,
        type: 'comment',
        title: `New comment on ${issue?.issue_key || 'an issue'}`,
        message: `${normalizedAuthor}: "${normalizedText.slice(0, 100)}"`,
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

  res.status(201).json(row)
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
router.patch('/:issueId/comments/:commentId', requireRole('Member'), asyncHandler(async (req, res) => {
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
router.delete('/:issueId/comments/:commentId', requireRole('Member'), asyncHandler(async (req, res) => {
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
