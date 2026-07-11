import { Router } from 'express'
import { all, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { verifyChain, entriesToPurge } from '../services/auditLog.js'
import { AUDIT_RETENTION_DAYS } from '../config.js'
import { parsePagination } from '../utils/pagination.js'
import { toCsv } from '../utils/tabular.js'

const router = Router()

// All audit-log endpoints are Admin (or Owner) only.
router.use(requireRole('Admin'))

const EXPORT_FIELDS = ['seq', 'actor', 'action', 'target', 'metadata', 'prev_hash', 'hash', 'created_at']

// JL-187: hard upper bound on how many audit rows a single export/verify request
// may pull into memory. Without this, `/export` and `/verify` load the entire
// audit_log table at once, which is unbounded and can exhaust memory on large,
// long-lived installs.
//   * /export streams at most MAX_AUDIT_EXPORT_ROWS rows (oldest first). Consumers
//     that need the full history should page via GET /api/audit-log?limit=&offset=.
//   * /verify recomputes the hash chain over at most MAX_AUDIT_EXPORT_ROWS rows.
//     NOTE: on chains longer than the cap this verifies only the oldest prefix;
//     `count` in the response reflects how many rows were actually checked.
const MAX_AUDIT_EXPORT_ROWS = 50000

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
  const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 500 })

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
  // JL-187: verify the chain in ascending seq order, but bound the number of
  // rows loaded so this endpoint cannot exhaust memory on a huge audit_log.
  // On chains longer than the cap only the oldest prefix is verified; `count`
  // reflects how many rows were checked.
  const rows = await all(
    `SELECT seq, actor, action, target, metadata, prev_hash, hash, created_at
     FROM audit_log ORDER BY seq ASC LIMIT ${MAX_AUDIT_EXPORT_ROWS}`,
    [],
  )
  const result = verifyChain(rows)
  res.json({ ok: result.ok, brokenAt: result.brokenAt, count: rows.length })
}))

/* ---------- GET /api/audit-log/export?format=csv|json ---------- */
router.get('/audit-log/export', asyncHandler(async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase()
  const { where, params } = buildFilters(req.query)
  // JL-187: cap the export so an unbounded table cannot be pulled into memory in
  // one shot. Oldest-first, at most MAX_AUDIT_EXPORT_ROWS rows.
  const rows = await all(
    `SELECT seq, actor, action, target, metadata, prev_hash, hash, created_at
     FROM audit_log ${where} ORDER BY seq ASC LIMIT ${MAX_AUDIT_EXPORT_ROWS}`,
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
