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

export default router

/**
 * Helper to create a notification (used by other routes).
 */
export async function createNotification({ recipientEmail, type, title, message = '', issueId = null, projectId = null, actorEmail = null }) {
  if (recipientEmail === actorEmail) return null
  const result = await run(
    'INSERT INTO notifications (recipient_email, type, title, message, issue_id, project_id, actor_email) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [recipientEmail, type, title, message, issueId, projectId, actorEmail],
  )
  return result.lastID
}
