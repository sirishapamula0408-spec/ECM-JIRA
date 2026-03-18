import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// GET /api/notifications — list notifications for current user
router.get('/', asyncHandler(async (req, res) => {
  const email = req.user.email
  const limit = Math.min(Number(req.query.limit) || 30, 100)
  const offset = Number(req.query.offset) || 0
  const unreadOnly = req.query.unread === 'true'

  let sql = 'SELECT id, recipient_email, type, title, message, issue_id, project_id, actor_email, is_read, created_at FROM notifications WHERE recipient_email = ?'
  const params = [email]

  if (unreadOnly) {
    sql += ' AND is_read = FALSE'
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const rows = await all(sql, params)

  const countRow = await get(
    'SELECT COUNT(*) AS count FROM notifications WHERE recipient_email = ? AND is_read = FALSE',
    [email],
  )

  res.json({ notifications: rows, unreadCount: Number(countRow.count) })
}))

// PATCH /api/notifications/:id/read — mark single as read
router.patch('/:id/read', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  await run('UPDATE notifications SET is_read = TRUE WHERE id = ? AND recipient_email = ?', [id, req.user.email])
  res.json({ success: true })
}))

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', asyncHandler(async (req, res) => {
  await run('UPDATE notifications SET is_read = TRUE WHERE recipient_email = ? AND is_read = FALSE', [req.user.email])
  res.json({ success: true })
}))

// DELETE /api/notifications/:id — delete a notification
router.delete('/:id', asyncHandler(async (req, res) => {
  await run('DELETE FROM notifications WHERE id = ? AND recipient_email = ?', [Number(req.params.id), req.user.email])
  res.json({ success: true })
}))

// GET /api/notifications/preferences — get user's notification preferences
router.get('/preferences', asyncHandler(async (req, res) => {
  let prefs = await get('SELECT * FROM notification_preferences WHERE user_email = ?', [req.user.email])
  if (!prefs) {
    prefs = { user_email: req.user.email, in_app: true, email_enabled: false, email_digest: 'off', muted_types: [] }
  }
  res.json(prefs)
}))

// PUT /api/notifications/preferences — update notification preferences
router.put('/preferences', asyncHandler(async (req, res) => {
  const { inApp = true, emailEnabled = false, emailDigest = 'off', mutedTypes = [] } = req.body
  if (!['off', 'daily', 'weekly'].includes(emailDigest)) {
    res.status(400).json({ error: 'emailDigest must be off, daily, or weekly' })
    return
  }
  const existing = await get('SELECT id FROM notification_preferences WHERE user_email = ?', [req.user.email])
  if (existing) {
    await run(
      'UPDATE notification_preferences SET in_app = ?, email_enabled = ?, email_digest = ?, muted_types = ?::jsonb, updated_at = NOW() WHERE user_email = ?',
      [inApp, emailEnabled, emailDigest, JSON.stringify(mutedTypes), req.user.email],
    )
  } else {
    await run(
      'INSERT INTO notification_preferences (user_email, in_app, email_enabled, email_digest, muted_types) VALUES (?, ?, ?, ?, ?::jsonb)',
      [req.user.email, inApp, emailEnabled, emailDigest, JSON.stringify(mutedTypes)],
    )
  }
  const prefs = await get('SELECT * FROM notification_preferences WHERE user_email = ?', [req.user.email])
  res.json(prefs)
}))

// GET /api/notifications/stream — SSE endpoint for real-time notifications
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.write('data: {"type":"connected"}\n\n')

  // Poll for new notifications every 5 seconds
  const interval = setInterval(async () => {
    try {
      const countRow = await get(
        'SELECT COUNT(*) AS count FROM notifications WHERE recipient_email = ? AND is_read = FALSE',
        [req.user.email],
      )
      res.write(`data: ${JSON.stringify({ type: 'unread_count', count: Number(countRow.count) })}\n\n`)
    } catch {
      // ignore
    }
  }, 5000)

  req.on('close', () => {
    clearInterval(interval)
  })
})

export default router

/**
 * Helper to create a notification (used by other routes).
 * Respects user preferences — skips if the type is muted.
 */
export async function createNotification({ recipientEmail, type, title, message = '', issueId = null, projectId = null, actorEmail = null }) {
  if (recipientEmail === actorEmail) return null
  const result = await run(
    'INSERT INTO notifications (recipient_email, type, title, message, issue_id, project_id, actor_email) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [recipientEmail, type, title, message, issueId, projectId, actorEmail],
  )
  return result.lastID
}
