import { Router } from 'express'
import { all, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { verifyChain, entriesToPurge } from '../services/auditLog.js'
import { AUDIT_RETENTION_DAYS } from '../config.js'
import { toCsv } from '../utils/tabular.js'

const router = Router()

// All audit-log endpoints are Admin (or Owner) only.
router.use(requireRole('Admin'))

const EXPORT_FIELDS = ['seq', 'actor', 'action', 'target', 'metadata', 'prev_hash', 'hash', 'created_at']

/** Build a WHERE clause + params from the shared filter query params. */
function buildFilters(query) {
  const clauses = []
  const params = []
  if (query.actor) { clauses.push('actor = ?'); params.push(String(query.actor)) }
  if (query.action) { clauses.push('action = ?'); params.push(String(query.action)) }
  if (query.dateFrom) { clauses.push('created_at >= ?'); params.push(String(query.dateFrom)) }
  if (query.dateTo) { clauses.push('created_at <= ?'); params.push(String(query.dateTo)) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return { where, params }
}

/* ---------- GET /api/audit-log — list + filters + pagination ---------- */
router.get('/audit-log', asyncHandler(async (req, res) => {
  const { where, params } = buildFilters(req.query)
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500)
  const offset = Math.max(Number(req.query.offset) || 0, 0)

  const rows = await all(
    `SELECT id, seq, actor, action, target, metadata, prev_hash, hash, created_at
     FROM audit_log ${where} ORDER BY seq DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  const totalRow = await all(`SELECT COUNT(*)::int AS count FROM audit_log ${where}`, params)
  const total = totalRow[0]?.count ?? 0

  res.json({ entries: rows, total, limit, offset })
}))

/* ---------- GET /api/audit-log/verify — recompute the hash chain ---------- */
router.get('/audit-log/verify', asyncHandler(async (_req, res) => {
  // Verify over the full chain in ascending seq order.
  const rows = await all(
    `SELECT seq, actor, action, target, metadata, prev_hash, hash, created_at
     FROM audit_log ORDER BY seq ASC`,
    [],
  )
  const result = verifyChain(rows)
  res.json({ ok: result.ok, brokenAt: result.brokenAt, count: rows.length })
}))

/* ---------- GET /api/audit-log/export?format=csv|json ---------- */
router.get('/audit-log/export', asyncHandler(async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase()
  const { where, params } = buildFilters(req.query)
  const rows = await all(
    `SELECT seq, actor, action, target, metadata, prev_hash, hash, created_at
     FROM audit_log ${where} ORDER BY seq ASC`,
    params,
  )

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.json"')
    res.send(JSON.stringify({ entries: rows, count: rows.length }, null, 2))
    return
  }

  const csvRows = rows.map((r) => ({
    ...r,
    metadata: r.metadata === null || r.metadata === undefined
      ? ''
      : (typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata)),
  }))
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"')
  res.send(toCsv(csvRows, EXPORT_FIELDS))
}))

/* ---------- POST /api/audit-log/retention — purge old entries ---------- */
router.post('/audit-log/retention', asyncHandler(async (req, res) => {
  const retentionDays = Number(req.body?.retentionDays) || AUDIT_RETENTION_DAYS
  if (!retentionDays || retentionDays <= 0) {
    res.status(400).json({ error: 'retentionDays must be a positive number' })
    return
  }
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  const result = await run('DELETE FROM audit_log WHERE created_at < ?', [cutoff])
  res.json({ purged: result?.changes ?? 0, retentionDays, cutoff })
}))

export { entriesToPurge }
export default router
