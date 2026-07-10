import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { createNotification } from './notifications.js'
import { runCommentAutomations } from '../services/automation.js'
import { emitEvent } from '../services/events.js'

const router = Router()

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
    'SELECT id, issue_id, author, text, created_at FROM comments WHERE issue_id = ? ORDER BY created_at DESC',
    [issueId],
  )
  // JL-139: attach aggregated emoji reactions for the requesting user
  const reactions = await loadReactions(rows.map((r) => r.id), req.user.email)
  res.json(rows.map((r) => ({ ...r, reactions: reactions.get(r.id) || [] })))
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
  const row = await get('SELECT id, issue_id, author, text, created_at FROM comments WHERE id = ?', [created.lastID])

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

// POST /api/comments/:id/reactions — toggle an emoji reaction (JL-139).
// Mounted at /api/comments in index.js, so the router path is /:id/reactions.
router.post('/:id/reactions', asyncHandler(async (req, res) => {
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

export default router
