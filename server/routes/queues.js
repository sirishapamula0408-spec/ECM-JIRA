import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { slaStatus, elapsedHoursBetween } from './sla.js'

const router = Router()

// Columns a queue may be ordered by. Whitelisted to keep order_by out of SQL
// injection range (it is interpolated, not parameterized).
const ORDER_COLUMNS = new Set([
  'created_at',
  'updated_at',
  'due_date',
  'priority',
  'status',
  'issue_key',
])

/* ============================================================
   Pure, unit-testable helpers
   ============================================================ */

// Translate a queue filter object into a parameterized SQL WHERE fragment over
// the `issues` table. Returns { clause, params } where `clause` is a bare
// boolean expression (no leading WHERE) — empty string when the filter imposes
// no constraints. Supported criteria:
//   statuses[]   -> status IN (?, ?, ...)
//   priorities[] -> priority IN (?, ?, ...)
//   assignee     -> assignee = ?
//   labels[]     -> EXISTS (issue_labels join) ANY-of match
export function buildQueueWhere(filter) {
  const f = filter && typeof filter === 'object' ? filter : {}
  const conditions = []
  const params = []

  const statuses = Array.isArray(f.statuses) ? f.statuses.filter(Boolean) : []
  if (statuses.length) {
    conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`)
    params.push(...statuses)
  }

  const priorities = Array.isArray(f.priorities) ? f.priorities.filter(Boolean) : []
  if (priorities.length) {
    conditions.push(`priority IN (${priorities.map(() => '?').join(', ')})`)
    params.push(...priorities)
  }

  if (f.assignee !== undefined && f.assignee !== null && String(f.assignee).trim() !== '') {
    conditions.push('assignee = ?')
    params.push(f.assignee)
  }

  const labels = Array.isArray(f.labels) ? f.labels.filter(Boolean) : []
  if (labels.length) {
    conditions.push(
      `EXISTS (SELECT 1 FROM issue_labels il JOIN labels l ON l.id = il.label_id
               WHERE il.issue_id = issues.id AND l.name IN (${labels.map(() => '?').join(', ')}))`,
    )
    params.push(...labels)
  }

  return { clause: conditions.join(' AND '), params }
}

// Pure predicate mirroring buildQueueWhere for in-memory matching (tests /
// fallback). An empty criterion matches everything. `issue.labels` (if present)
// is expected to be an array of label names.
export function matchesQueue(issue, filter) {
  if (!issue) return false
  const f = filter && typeof filter === 'object' ? filter : {}

  const statuses = Array.isArray(f.statuses) ? f.statuses.filter(Boolean) : []
  if (statuses.length && !statuses.includes(issue.status)) return false

  const priorities = Array.isArray(f.priorities) ? f.priorities.filter(Boolean) : []
  if (priorities.length && !priorities.includes(issue.priority)) return false

  if (f.assignee !== undefined && f.assignee !== null && String(f.assignee).trim() !== '') {
    if (issue.assignee !== f.assignee) return false
  }

  const labels = Array.isArray(f.labels) ? f.labels.filter(Boolean) : []
  if (labels.length) {
    const issueLabels = Array.isArray(issue.labels) ? issue.labels : []
    if (!labels.some((l) => issueLabels.includes(l))) return false
  }

  return true
}

// Coerce a stored filter (JSONB may arrive as string or object) to an object.
function parseFilter(raw) {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }
  return typeof raw === 'object' ? raw : {}
}

/* ============================================================
   Write authorization: workspace Admin/Owner OR project lead
   ============================================================ */

async function canManageQueue(req, projectId) {
  if (req.user?.isOwner || req.user?.workspaceRole === 'Admin') return true
  if (!projectId || !req.user?.memberId) return false
  const row = await get(
    'SELECT role FROM project_members WHERE project_id = ? AND member_id = ?',
    [projectId, req.user.memberId],
  )
  return row?.role === 'Lead' || row?.role === 'Admin'
}

/* ============================================================
   CRUD
   ============================================================ */

// GET /api/queues?project=X — list queues, optionally scoped to a project.
router.get('/queues', asyncHandler(async (req, res) => {
  const projectId = req.query.project ? Number(req.query.project) : null
  let sql = 'SELECT id, project_id, name, description, filter, order_by, position, created_at FROM queues'
  const params = []
  if (projectId) {
    sql += ' WHERE project_id = ?'
    params.push(projectId)
  }
  sql += ' ORDER BY position ASC, id ASC'
  const rows = await all(sql, params)
  res.json(rows.map((r) => ({ ...r, filter: parseFilter(r.filter) })))
}))

// GET /api/queues/:id — single queue.
router.get('/queues/:id', asyncHandler(async (req, res) => {
  const row = await get(
    'SELECT id, project_id, name, description, filter, order_by, position, created_at FROM queues WHERE id = ?',
    [Number(req.params.id)],
  )
  if (!row) {
    res.status(404).json({ error: 'Queue not found' })
    return
  }
  res.json({ ...row, filter: parseFilter(row.filter) })
}))

// POST /api/queues — create (Admin or project lead).
router.post('/queues', asyncHandler(async (req, res) => {
  const { name, description = null, projectId = null, filter = {}, orderBy = 'created_at', position = 0 } = req.body

  if (!(await canManageQueue(req, projectId))) {
    res.status(403).json({ error: 'Insufficient permissions to manage queues' })
    return
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const order = ORDER_COLUMNS.has(orderBy) ? orderBy : 'created_at'
  const filterObj = filter && typeof filter === 'object' ? filter : {}

  const result = await run(
    `INSERT INTO queues (project_id, name, description, filter, order_by, position)
     VALUES (?, ?, ?, ?::jsonb, ?, ?)`,
    [projectId || null, name.trim(), description, JSON.stringify(filterObj), order, Number(position) || 0],
  )
  const row = await get(
    'SELECT id, project_id, name, description, filter, order_by, position, created_at FROM queues WHERE id = ?',
    [result.lastID],
  )
  res.status(201).json({ ...row, filter: parseFilter(row.filter) })
}))

// PATCH /api/queues/:id — update (Admin or project lead).
router.patch('/queues/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT id, project_id FROM queues WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Queue not found' })
    return
  }
  if (!(await canManageQueue(req, existing.project_id))) {
    res.status(403).json({ error: 'Insufficient permissions to manage queues' })
    return
  }

  const { name, description, filter, orderBy, position } = req.body
  if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) {
    res.status(400).json({ error: 'name must be a non-empty string' })
    return
  }
  let order = null
  if (orderBy !== undefined) {
    order = ORDER_COLUMNS.has(orderBy) ? orderBy : 'created_at'
  }
  const filterJson = filter !== undefined
    ? JSON.stringify(filter && typeof filter === 'object' ? filter : {})
    : null

  await run(
    `UPDATE queues SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       filter = COALESCE(?::jsonb, filter),
       order_by = COALESCE(?, order_by),
       position = COALESCE(?, position)
     WHERE id = ?`,
    [
      name !== undefined ? name.trim() : null,
      description !== undefined ? description : null,
      filterJson,
      order,
      position !== undefined ? Number(position) || 0 : null,
      id,
    ],
  )
  const row = await get(
    'SELECT id, project_id, name, description, filter, order_by, position, created_at FROM queues WHERE id = ?',
    [id],
  )
  res.json({ ...row, filter: parseFilter(row.filter) })
}))

// DELETE /api/queues/:id — delete (Admin or project lead).
router.delete('/queues/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT id, project_id FROM queues WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Queue not found' })
    return
  }
  if (!(await canManageQueue(req, existing.project_id))) {
    res.status(403).json({ error: 'Insufficient permissions to manage queues' })
    return
  }
  await run('DELETE FROM queues WHERE id = ?', [id])
  res.json({ success: true })
}))

/* ============================================================
   GET /api/queues/:id/issues — the filtered, ordered, SLA-annotated list
   ============================================================ */

router.get('/queues/:id/issues', asyncHandler(async (req, res) => {
  const queue = await get(
    'SELECT id, project_id, name, filter, order_by FROM queues WHERE id = ?',
    [Number(req.params.id)],
  )
  if (!queue) {
    res.status(404).json({ error: 'Queue not found' })
    return
  }

  const filter = parseFilter(queue.filter)
  const { clause, params } = buildQueueWhere(filter)

  const conditions = []
  const sqlParams = []
  if (queue.project_id) {
    conditions.push('project_id = ?')
    sqlParams.push(queue.project_id)
  }
  if (clause) {
    conditions.push(`(${clause})`)
    sqlParams.push(...params)
  }

  const order = ORDER_COLUMNS.has(queue.order_by) ? queue.order_by : 'created_at'
  let sql = 'SELECT id, issue_key, title, priority, status, assignee, project_id, due_date, created_at FROM issues'
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ` ORDER BY ${order} ASC, id ASC`

  const issues = await all(sql, sqlParams)

  // Annotate each issue with an SLA status. Prefer JL-52 resolution policies
  // (by priority); fall back to a simple due-date-based indicator when no
  // policy matches (MVP).
  const policyRows = queue.project_id
    ? await all(
        'SELECT priority, target_hours FROM sla_policies WHERE project_id = ? AND applies_to = ?',
        [queue.project_id, 'resolution'],
      )
    : []
  const targetByPriority = new Map()
  for (const p of policyRows) targetByPriority.set(p.priority, p.target_hours)

  const now = Date.now()
  const annotated = issues.map((issue) => {
    const targetHours = targetByPriority.get(issue.priority)
    let sla = null
    if (targetHours !== undefined) {
      const endMs = issue.status === 'Done' ? new Date(issue.created_at).getTime() : now
      const elapsedHours = elapsedHoursBetween(issue.created_at, endMs)
      const status = slaStatus(elapsedHours, targetHours)
      if (status) {
        sla = {
          source: 'policy',
          targetHours,
          elapsedHours,
          percent: Number(((elapsedHours / targetHours) * 100).toFixed(1)),
          status,
        }
      }
    } else if (issue.due_date && issue.status !== 'Done') {
      // Simple MVP fallback: overdue vs due-soon vs ok based on due_date.
      const dueMs = new Date(issue.due_date).getTime()
      if (Number.isFinite(dueMs)) {
        const daysLeft = (dueMs - now) / (1000 * 60 * 60 * 24)
        const status = daysLeft < 0 ? 'breached' : daysLeft <= 1 ? 'at_risk' : 'ok'
        sla = { source: 'due_date', dueDate: issue.due_date, daysLeft: Number(daysLeft.toFixed(2)), status }
      }
    }
    return { ...issue, sla }
  })

  res.json({ queueId: queue.id, name: queue.name, count: annotated.length, issues: annotated })
}))

export default router
