import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

const VALID_STATUSES = ['sent', 'failed', 'skipped']
const MAX_LIMIT = 200

/**
 * JL-323 — Outbound email delivery log (Admin only).
 *
 * Before this, the app kept no record of outbound mail: a send that Gmail
 * rejected looked exactly like one that succeeded, because sendMail() returns
 * `{ ok: false }` rather than throwing and every caller discarded the result.
 * These endpoints make "did the invite actually go out?" answerable.
 */

// --- List delivery attempts, newest first ---
router.get('/email-log', requireRole('Admin'), asyncHandler(async (req, res) => {
  const status = String(req.query?.status || '').trim()
  const recipient = String(req.query?.recipient || '').trim()
  const type = String(req.query?.type || '').trim()

  const limitRaw = Number(req.query?.limit)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), MAX_LIMIT) : 50
  const offsetRaw = Number(req.query?.offset)
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0

  if (status && !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` })
    return
  }

  const where = []
  const params = []
  if (status) {
    where.push('status = ?')
    params.push(status)
  }
  if (recipient) {
    where.push('LOWER(recipient) LIKE ?')
    params.push(`%${recipient.toLowerCase()}%`)
  }
  if (type) {
    where.push('email_type = ?')
    params.push(type)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const rows = await all(
    `SELECT id, recipient, subject, email_type, related_entity, status, message_id, error, created_at
       FROM email_log
       ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )

  const totalRow = await get(`SELECT COUNT(*)::int AS count FROM email_log ${whereSql}`, params)

  res.json({ rows, total: totalRow?.count ?? 0, limit, offset })
}))

// --- Aggregate counts, for an at-a-glance "are invites landing?" check ---
router.get('/email-log/summary', requireRole('Admin'), asyncHandler(async (req, res) => {
  const rows = await all('SELECT status, COUNT(*)::int AS count FROM email_log GROUP BY status')
  const summary = { sent: 0, failed: 0, skipped: 0 }
  for (const r of rows) {
    if (r.status in summary) summary[r.status] = r.count
  }
  summary.total = summary.sent + summary.failed + summary.skipped

  const recentFailures = await all(
    `SELECT id, recipient, subject, error, created_at
       FROM email_log
      WHERE status IN ('failed', 'skipped')
      ORDER BY created_at DESC, id DESC
      LIMIT 10`,
  )

  res.json({ ...summary, recentFailures })
}))

export default router
