import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { createNotification } from './notifications.js'
import { runCommentAutomations } from '../services/automation.js'

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
    'SELECT id, issue_id, author, text, created_at FROM comments WHERE issue_id = ? ORDER BY created_at DESC',
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

  res.status(201).json(row)
}))

export default router
