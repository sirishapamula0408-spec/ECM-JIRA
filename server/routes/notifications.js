import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { sendMail, verifyMailer, isSmtpConfigured, buildNotificationEmail } from '../utils/mailer.js'

const router = Router()

// POST /api/notifications/mail-test — JL-304: Admin-only SMTP connectivity check
// plus a test email to the requesting admin's own address. Verifies the SMTP
// transport, then attempts delivery. Never throws — reports structured status so
// the admin can distinguish "configured + ok + sent" from a verify/send failure
// or the console-fallback mode (SMTP env unset).
router.post('/mail-test', requireRole('Admin'), asyncHandler(async (req, res) => {
  const to = req.user.email
  const verification = await verifyMailer()

  const subject = 'ECM-JIRA — SMTP test email'
  const text = `This is a test email from ECM-JIRA.\n\nIf you received this, your outbound SMTP configuration is working. Requested by ${to}.`
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#172b4d;">`
    + `<h3 style="color:#0052cc;margin:0 0 8px;">SMTP test email</h3>`
    + `<p style="font-size:14px;line-height:1.6;">This is a test email from ECM-JIRA. If you received this, your outbound SMTP configuration is working.</p>`
    + `<p style="font-size:12px;color:#6b778c;">Requested by ${to}.</p>`
    + `</div>`

  const result = await sendMail({ to, subject, text, html, type: 'smtp_test' })
  const consoleFallback = Boolean(result.skipped) || !isSmtpConfigured()

  res.json({
    configured: verification.configured,
    ok: verification.ok,
    sent: Boolean(result.ok),
    consoleFallback,
    to,
    error: verification.error || result.error || null,
  })
}))

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
// JL-364: same discarded-`changes` shape as DELETE /:id below — the old query
// filtered by recipient_email and reported { success: true } even when it
// touched no row (foreign id or non-existent id). Load-then-write like the
// JL-342 shared-dashboards fix, with the same 404-for-both choice as DELETE /:id
// (see the comment there for why we return 404, not 403, on a foreign id).
router.patch('/:id/read', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT id, recipient_email FROM notifications WHERE id = ?', [id])
  if (!existing || existing.recipient_email !== req.user.email) {
    res.status(404).json({ error: 'Notification not found' })
    return
  }
  await run('UPDATE notifications SET is_read = TRUE WHERE id = ?', [id])
  res.json({ success: true })
}))

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', asyncHandler(async (req, res) => {
  await run('UPDATE notifications SET is_read = TRUE WHERE recipient_email = ? AND is_read = FALSE', [req.user.email])
  res.json({ success: true })
}))

// DELETE /api/notifications/read — bulk-clear the current user's read notifications
// NOTE: must be registered before DELETE /:id so 'read' isn't captured as an id.
router.delete('/read', asyncHandler(async (req, res) => {
  const result = await run('DELETE FROM notifications WHERE recipient_email = ? AND is_read = TRUE', [req.user.email])
  res.json({ success: true, deleted: result.changes })
}))

// DELETE /api/notifications/:id — delete a notification
// JL-364: the old query filtered by recipient_email and discarded the `changes`
// count, so deleting someone else's notification (or a non-existent id) both
// reported { success: true }. Mirror the JL-342 shared-dashboards fix: load the
// row first, then delete only when it is really the caller's.
//
// Deliberate divergence from JL-342's 403: shared dashboards are discoverable
// objects (listed publicly when visibility = 'public'), so a 403 there reveals
// nothing new. Notifications are strictly per-user and private — every read
// endpoint scopes to recipient_email — so answering 403 for a foreign id would
// confirm to a probing caller that the id exists in someone else's inbox.
// We return 404 for both "missing" and "not yours" to keep foreign ids
// indistinguishable from non-existent ones.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT id, recipient_email FROM notifications WHERE id = ?', [id])
  if (!existing || existing.recipient_email !== req.user.email) {
    res.status(404).json({ error: 'Notification not found' })
    return
  }
  await run('DELETE FROM notifications WHERE id = ?', [id])
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

  // Best-effort email delivery — fire-and-forget so it never blocks or breaks
  // the caller. Send only when the recipient opts in (see maybeSendNotificationEmail).
  maybeSendNotificationEmail({ recipientEmail, type, title, message, actorEmail }).catch((err) => {
    console.error(`[notifications] email delivery failed: ${err.message}`)
  })

  return result.lastID
}

/**
 * Send an immediate notification email if the recipient's preferences opt in.
 * Gated on: email_enabled = TRUE, the notification type is NOT muted, and the
 * digest mode is 'off' (or absent). Daily/weekly digests are batched separately
 * (JL-303), so we never send an immediate email for those. If the user has no
 * preferences row, email is treated as OFF (the schema default).
 *
 * Never throws — resolves quietly on any error or when email is disabled/muted.
 */
async function maybeSendNotificationEmail({ recipientEmail, type, title, message, actorEmail = null }) {
  const prefs = await get(
    'SELECT email_enabled, email_digest, muted_types FROM notification_preferences WHERE user_email = ?',
    [recipientEmail],
  )
  // No prefs row → default OFF. Also require email to be enabled.
  if (!prefs || !prefs.email_enabled) return

  // Immediate email only when digest is 'off' (or unset). Daily/weekly are
  // handled by the digest job (JL-303) — do not send an immediate email.
  const digest = prefs.email_digest || 'off'
  if (digest !== 'off') return

  let muted = prefs.muted_types
  if (typeof muted === 'string') {
    try { muted = JSON.parse(muted) } catch { muted = [] }
  }
  if (Array.isArray(muted) && muted.includes(type)) return

  const { subject, html, text } = buildNotificationEmail({ title, message, type, actorEmail })
  await sendMail({ to: recipientEmail, subject, html, text, type: 'notification' })
}
