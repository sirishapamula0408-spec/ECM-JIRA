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
router.get('/:issueId/comments', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    'SELECT id, issue_id, author, text, created_at FROM comments WHERE issue_id = ? ORDER BY created_at DESC',
    [issueId],
  )
  // JL-99: upgrade email-based authors to member display names so the UI
  // never shows a raw email (or a stale 'Unknown') for a known member.
  const resolved = await Promise.all(
    rows.map(async (row) => ({ ...row, author: await resolveAuthorDisplay(row.author) })),
  )
  res.json(resolved)
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
      message: `${resolvedAuthor} mentioned you: "${normalizedText.slice(0, 100)}"`,
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

  res.status(201).json(row)
}))

export default router
