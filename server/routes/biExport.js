import { Router } from 'express'
import { all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { parsePagination } from '../utils/pagination.js'

const router = Router()

/* ================================================================
   JL-156: Data warehouse / BI export connector
   A normalized, star-schema-style dataset for BI tools:
     - issues FACT table (flattened analytical rows)
     - dimension lookups (projects, users, statuses, priorities, types)
   Supports INCREMENTAL pulls (updated_at >= since cursor) and
   multiple wire formats (json | csv | ndjson).
   This is a read-only analytics export; Admin-gated.
   ================================================================ */

// Ordered column list for the issues FACT table. Order is stable so CSV/NDJSON
// consumers (and downstream schemas) can rely on it.
export const FACT_COLUMNS = [
  'id',
  'key',
  'project_id',
  'project_key',
  'status',
  'priority',
  'issue_type',
  'assignee',
  'reporter',
  'story_points',
  'created_at',
  'updated_at',
  'resolved_at',
]

// Static dimension catalogs (small, enum-like lookups).
const DIM_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done']
const DIM_PRIORITIES = ['Low', 'Medium', 'High']
const DIM_TYPES = ['Story', 'Bug', 'Task', 'Sub-task']

const DIMENSION_NAMES = ['projects', 'users', 'statuses', 'priorities', 'types']

/* ---------------- PURE HELPERS (unit-testable) ---------------- */

/**
 * Flatten a raw joined issue row into a BI fact record.
 * Tolerant of missing/aliased columns so it can be reused across queries.
 */
export function toFactRow(issueRow) {
  const r = issueRow || {}
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
  return {
    id: r.id ?? null,
    key: r.key ?? r.issue_key ?? null,
    project_id: r.project_id ?? null,
    project_key: r.project_key ?? null,
    status: r.status ?? null,
    priority: r.priority ?? null,
    issue_type: r.issue_type ?? null,
    assignee: r.assignee ?? null,
    reporter: r.reporter ?? null,
    story_points: num(r.story_points),
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    // resolved_at is derived where a dedicated column is absent.
    resolved_at: r.resolved_at ?? null,
  }
}

/** Escape a single CSV cell (quotes, commas, newlines, carriage returns). */
export function csvCell(val) {
  const s = val === null || val === undefined ? '' : String(val)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Serialize rows to a CSV string with a header row.
 * @param {object[]} rows
 * @param {string[]} columns column order / header names
 */
export function toCsv(rows, columns) {
  const cols = columns && columns.length ? columns : (rows[0] ? Object.keys(rows[0]) : [])
  const header = cols.map(csvCell).join(',')
  const body = (rows || []).map((row) => cols.map((c) => csvCell(row[c])).join(','))
  return [header, ...body].join('\n')
}

/** Serialize rows to newline-delimited JSON (one JSON object per line). */
export function toNdjson(rows) {
  return (rows || []).map((r) => JSON.stringify(r)).join('\n')
}

/**
 * Parse the incremental cursor. Returns a normalized ISO string for a valid
 * date, or null for missing/garbage input (null = full, non-incremental export).
 */
export function parseSince(sinceParam) {
  if (sinceParam === null || sinceParam === undefined) return null
  const s = String(sinceParam).trim()
  if (!s) return null
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString()
}

/* ---------------- Schema / metadata endpoint ---------------- */

const SCHEMA_DOC = {
  version: 1,
  generatedFor: 'BI / data-warehouse connector',
  incremental: {
    param: 'since',
    field: 'updated_at',
    description: 'Pass an ISO timestamp; rows with updated_at >= since are returned. Omit for a full export.',
  },
  formats: ['json', 'csv', 'ndjson'],
  datasets: [
    {
      name: 'issues',
      type: 'fact',
      endpoint: '/api/bi/export/issues',
      grain: 'one row per issue',
      columns: [
        { name: 'id', type: 'integer', description: 'Surrogate issue id (primary key)' },
        { name: 'key', type: 'string', description: 'Human-readable issue key, e.g. TP-12' },
        { name: 'project_id', type: 'integer', description: 'FK -> projects dimension' },
        { name: 'project_key', type: 'string', description: 'Project key, e.g. TP' },
        { name: 'status', type: 'string', description: 'FK -> statuses dimension' },
        { name: 'priority', type: 'string', description: 'FK -> priorities dimension' },
        { name: 'issue_type', type: 'string', description: 'FK -> types dimension' },
        { name: 'assignee', type: 'string', description: 'FK -> users dimension (email/name)' },
        { name: 'reporter', type: 'string', description: 'FK -> users dimension (email/name)' },
        { name: 'story_points', type: 'number', description: 'Estimation measure (nullable)' },
        { name: 'created_at', type: 'timestamp', description: 'Row creation time' },
        { name: 'updated_at', type: 'timestamp', description: 'Last update time (incremental cursor)' },
        { name: 'resolved_at', type: 'timestamp', description: 'Resolution time if available (nullable)' },
      ],
    },
    {
      name: 'projects',
      type: 'dimension',
      endpoint: '/api/bi/export/dimensions/projects',
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'key', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'lead', type: 'string' },
      ],
    },
    {
      name: 'users',
      type: 'dimension',
      endpoint: '/api/bi/export/dimensions/users',
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'role', type: 'string' },
      ],
    },
    {
      name: 'statuses',
      type: 'dimension',
      endpoint: '/api/bi/export/dimensions/statuses',
      columns: [{ name: 'value', type: 'string' }],
    },
    {
      name: 'priorities',
      type: 'dimension',
      endpoint: '/api/bi/export/dimensions/priorities',
      columns: [{ name: 'value', type: 'string' }],
    },
    {
      name: 'types',
      type: 'dimension',
      endpoint: '/api/bi/export/dimensions/types',
      columns: [{ name: 'value', type: 'string' }],
    },
  ],
}

// GET /api/bi/schema — describes the exported datasets/columns.
router.get('/bi/schema', asyncHandler(async (_req, res) => {
  res.json(SCHEMA_DOC)
}))

/* ---------------- Issues FACT export ---------------- */

// Send `rows` in the requested format with proper download headers.
// Follows JL-40's raw-response pattern (no forced JSON parsing on the client).
function sendFormatted(res, format, rows, columns, filenameBase) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`)
    res.send(toCsv(rows, columns))
    return
  }
  if (format === 'ndjson') {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.ndjson"`)
    res.send(toNdjson(rows))
    return
  }
  // default: json
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.json"`)
  res.json(rows)
}

// GET /api/bi/export/issues?since=<ISO>&format=json|csv|ndjson&limit=&offset=
router.get('/bi/export/issues', requireRole('Admin'), asyncHandler(async (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase()
  const since = parseSince(req.query.since)
  const { limit, offset } = parsePagination(req.query, { defaultLimit: 10000, maxLimit: 50000 })

  // Scope to the resolved workspace's projects. Legacy NULL-workspace rows stay
  // visible so single-tenant installs are unaffected (mirrors projects.js).
  const workspaceId = req.workspaceId ?? null

  const where = []
  const params = []
  if (since) {
    where.push('i.updated_at >= ?')
    params.push(since)
  }
  if (workspaceId != null) {
    where.push('(p.workspace_id = ? OR p.workspace_id IS NULL)')
    params.push(workspaceId)
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  params.push(limit, offset)

  const raw = await all(
    `SELECT i.id, i.issue_key AS key, i.project_id, p.key AS project_key,
            i.status, i.priority, i.issue_type, i.assignee, i.reporter,
            i.story_points, i.created_at, i.updated_at
       FROM issues i
       LEFT JOIN projects p ON p.id = i.project_id
       ${whereClause}
       ORDER BY i.updated_at ASC NULLS LAST, i.id ASC
       LIMIT ? OFFSET ?`,
    params,
  )

  const rows = (raw || []).map(toFactRow)
  sendFormatted(res, format, rows, FACT_COLUMNS, 'bi-issues')
}))

/* ---------------- Dimension exports ---------------- */

async function loadDimension(name) {
  switch (name) {
    case 'projects':
      return all('SELECT id, key, name, lead FROM projects ORDER BY id ASC')
    case 'users':
      return all('SELECT id, name, email, role FROM members ORDER BY id ASC')
    case 'statuses':
      return DIM_STATUSES.map((value) => ({ value }))
    case 'priorities':
      return DIM_PRIORITIES.map((value) => ({ value }))
    case 'types':
      return DIM_TYPES.map((value) => ({ value }))
    default:
      return null
  }
}

// GET /api/bi/export/dimensions/:name?format=json|csv|ndjson
router.get('/bi/export/dimensions/:name', requireRole('Admin'), asyncHandler(async (req, res) => {
  const name = String(req.params.name || '').toLowerCase()
  if (!DIMENSION_NAMES.includes(name)) {
    res.status(400).json({ error: `Unknown dimension "${name}". Valid: ${DIMENSION_NAMES.join(', ')}` })
    return
  }
  const format = String(req.query.format || 'json').toLowerCase()
  const rows = (await loadDimension(name)) || []
  const columns = rows[0] ? Object.keys(rows[0]) : []
  sendFormatted(res, format, rows, columns, `bi-dim-${name}`)
}))

export default router
