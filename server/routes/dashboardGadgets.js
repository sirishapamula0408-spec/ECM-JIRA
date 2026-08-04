import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { loadAccessibleProjectIds } from '../services/projectAccess.js'

/*
 * JL-152 — Configurable dashboard gadget library.
 *
 * Provides a catalog of dashboard "gadgets" (widgets) plus a single data
 * endpoint that computes each gadget's data. Layout persistence reuses the
 * existing shared_dashboards.layout JSONB column (see shared-dashboards.js);
 * a gadget layout is just an array of placed gadgets
 * ({ id, type, config, x, y, w, h }) stored there via PATCH.
 *
 * The catalog, validation and breakdown computation are pure and exported so
 * they can be unit-tested without a database.
 */

// The gadget catalog. Each entry is a placeable widget the user can add to a
// dashboard. `configSchema` describes the per-gadget configuration knobs.
export const GADGET_CATALOG = [
  {
    type: 'issue_count',
    name: 'Issue Count',
    description: 'A single number: how many issues match an optional filter.',
    category: 'metrics',
    configSchema: {
      projectId: { type: 'number', required: false, label: 'Project' },
      status: { type: 'string', required: false, label: 'Status' },
    },
  },
  {
    type: 'issues_by_status',
    name: 'Issues by Status',
    description: 'Breakdown of issues grouped by workflow status.',
    category: 'chart',
    configSchema: {
      projectId: { type: 'number', required: false, label: 'Project' },
    },
  },
  {
    type: 'issues_by_assignee',
    name: 'Issues by Assignee',
    description: 'Breakdown of issues grouped by assignee.',
    category: 'chart',
    configSchema: {
      projectId: { type: 'number', required: false, label: 'Project' },
    },
  },
  {
    type: 'issues_by_priority',
    name: 'Issues by Priority',
    description: 'Breakdown of issues grouped by priority.',
    category: 'chart',
    configSchema: {
      projectId: { type: 'number', required: false, label: 'Project' },
    },
  },
  {
    type: 'recent_activity',
    name: 'Recent Activity',
    description: 'The most recent activity across your projects.',
    category: 'activity',
    configSchema: {
      limit: { type: 'number', required: false, label: 'Items to show' },
    },
  },
  {
    type: 'filter_results',
    name: 'Filter Results',
    description: 'A list of issues matching status / assignee / priority.',
    category: 'list',
    configSchema: {
      projectId: { type: 'number', required: false, label: 'Project' },
      status: { type: 'string', required: false, label: 'Status' },
      assignee: { type: 'string', required: false, label: 'Assignee' },
      priority: { type: 'string', required: false, label: 'Priority' },
      limit: { type: 'number', required: false, label: 'Max rows' },
    },
  },
]

// Pure accessor — returns a copy so callers can't mutate the catalog.
export function getGadgetCatalog() {
  return GADGET_CATALOG.map((g) => ({ ...g, configSchema: { ...g.configSchema } }))
}

// Which issue field a breakdown gadget groups by.
const BREAKDOWN_FIELD = {
  issues_by_status: 'status',
  issues_by_assignee: 'assignee',
  issues_by_priority: 'priority',
}

/**
 * validateGadgetConfig — pure validation of a gadget's config against the
 * catalog. Returns { ok, errors }.
 *   - Unknown gadget type → not ok.
 *   - Missing required config field → not ok.
 *   - Non-numeric value for a number-typed field → not ok.
 */
export function validateGadgetConfig(type, config = {}, catalog = GADGET_CATALOG) {
  const entry = (Array.isArray(catalog) ? catalog : []).find((g) => g.type === type)
  if (!entry) {
    return { ok: false, errors: [`Unknown gadget type: ${type}`] }
  }
  const errors = []
  const schema = entry.configSchema || {}
  const cfg = config && typeof config === 'object' ? config : {}
  for (const [key, spec] of Object.entries(schema)) {
    const value = cfg[key]
    const provided = value !== undefined && value !== null && value !== ''
    if (spec.required && !provided) {
      errors.push(`${key} is required`)
      continue
    }
    if (provided && spec.type === 'number' && Number.isNaN(Number(value))) {
      errors.push(`${key} must be a number`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * computeGadgetData — pure computation of a gadget's data from a plain array
 * of issue rows. Used for the count + breakdown gadgets so the aggregation
 * logic is unit-testable without a database.
 *   - issue_count            → { count }
 *   - issues_by_status/...   → [{ <field>, count }] (null/empty values ignored)
 */
export function computeGadgetData(type, rows) {
  const list = Array.isArray(rows) ? rows : []
  if (type === 'issue_count') {
    return { count: list.length }
  }
  const field = BREAKDOWN_FIELD[type]
  if (field) {
    const counts = new Map()
    for (const row of list) {
      const value = row?.[field]
      if (value === null || value === undefined || value === '') continue
      counts.set(value, (counts.get(value) || 0) + 1)
    }
    return Array.from(counts.entries()).map(([key, count]) => ({ [field]: key, count }))
  }
  return null
}

// Clamp a user-supplied limit into a sane range.
function clampLimit(value, fallback, max) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

/*
 * JL-356 — resolve the project ids this caller is allowed to read issue data
 * for. Workspace Owner/Admin may read every project in the resolved workspace
 * (same rule as projects.js GET / — JL-224); everybody else gets the shared
 * membership/lead resolver from projectAccess.js (JL-187), so gadgets apply
 * exactly the same accessibility rule as the projects listing and the report
 * builder instead of trusting whatever project id the client posted.
 */
async function loadScopeProjectIds(req) {
  const workspaceId = req?.workspaceId ?? null
  const isWorkspaceAdmin = req?.user?.isOwner || req?.user?.workspaceRole === 'Admin'
  if (isWorkspaceAdmin) {
    // Legacy NULL-workspace rows stay visible so single-tenant / pre-migration
    // installs are unaffected (mirrors the wsClause in projects.js).
    const scoped = workspaceId != null
    const rows = await all(
      `SELECT id FROM projects${scoped ? ' WHERE workspace_id = ? OR workspace_id IS NULL' : ''}`,
      scoped ? [workspaceId] : [],
    )
    return (rows || []).map((r) => Number(r.id))
  }
  return loadAccessibleProjectIds(req?.user, workspaceId)
}

/*
 * Build the issue-scoping WHERE fragment.
 *
 * JL-356 (cross-workspace data leak): this used to be
 *   if (config.projectId) { project_id = ? } else if (req.workspaceId) { …workspace… }
 * — an `else if`, which made the tenant scoping *mutually exclusive* with a
 * caller-supplied project id. Any authenticated user could therefore post an
 * arbitrary `config.projectId` and read issue counts, status/assignee/priority
 * breakdowns and (via filter_results) issue keys, titles, assignees and
 * priorities from ANY project in ANY workspace.
 *
 * The caller's accessible project ids are now ALWAYS applied and a requested
 * projectId only ever *narrows* within that set (an intersection, never a
 * replacement).
 *
 * A requested project the caller cannot access yields an EMPTY result rather
 * than 403, because 403-vs-empty would turn this endpoint into an existence
 * oracle: an attacker could distinguish "this project id exists in someone
 * else's workspace" (403) from "no such project" (200 + empty) and enumerate
 * other tenants. Empty is also what reportBuilder/loadIssues does (JL-187)
 * when the accessible set is empty.
 */
function buildIssueScope(config, accessibleProjectIds) {
  const accessible = (Array.isArray(accessibleProjectIds) ? accessibleProjectIds : [])
    .map(Number)
    .filter((id) => Number.isFinite(id))
  let scope = accessible
  const requested = config?.projectId
  if (requested !== undefined && requested !== null && requested !== '') {
    const wanted = Number(requested)
    scope = accessible.filter((id) => id === wanted)
  }
  if (scope.length === 0) {
    // Nothing readable → short-circuit so we never emit an unscoped query (or
    // an empty `IN ()` a DB might treat as "match everything").
    return { clauses: [], params: [], empty: true }
  }
  return {
    clauses: [`project_id IN (${scope.map(() => '?').join(', ')})`],
    params: [...scope],
    empty: false,
  }
}

// The "you may read nothing" shape for each issue-backed gadget. Must match the
// shape of a real (but zero-row) response so the frontend renders an empty
// gadget instead of erroring (JL-356).
function emptyGadgetData(type) {
  if (type === 'issue_count') return { count: 0 }
  if (BREAKDOWN_FIELD[type]) return []
  if (type === 'filter_results') return { issues: [], count: 0 }
  return null
}

// Compute a gadget's data against the database, scoped to the caller.
async function runGadgetQuery(type, config, req) {
  // JL-356: every issue-backed gadget type goes through buildIssueScope, so the
  // fix covers issue_count, issues_by_status/assignee/priority and
  // filter_results alike — not just the one leak path named in the ticket.
  const accessibleProjectIds = await loadScopeProjectIds(req)
  const scope = buildIssueScope(config, accessibleProjectIds)

  if (type === 'recent_activity') {
    const limit = clampLimit(config?.limit, 5, 50)
    // JL-356: the activity gadget was completely unscoped and returned the most
    // recent rows across every workspace. Rows attributed to a project the
    // caller cannot access are now excluded. Rows with no project attribution
    // (project_id IS NULL — most activity inserts predate JL-44's project_id
    // column) stay visible, which is exactly what GET /api/activity already
    // exposes to any authenticated user, so the gadget does not go blank.
    const where = accessibleProjectIds.length
      ? ` WHERE project_id IS NULL OR project_id IN (${accessibleProjectIds.map(() => '?').join(', ')})`
      : ' WHERE project_id IS NULL'
    const rows = await all(
      `SELECT id, actor, action, happened_at FROM activity${where} ORDER BY id DESC LIMIT ?`,
      [...accessibleProjectIds, limit],
    )
    return rows
  }

  if (scope.empty) return emptyGadgetData(type)

  if (type === 'issue_count') {
    const clauses = [...scope.clauses]
    const params = [...scope.params]
    if (config?.status) { clauses.push('status = ?'); params.push(config.status) }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const row = await get(`SELECT COUNT(*) AS count FROM issues${where}`, params)
    return { count: Number(row?.count ?? 0) }
  }

  if (BREAKDOWN_FIELD[type]) {
    const where = scope.clauses.length ? ` WHERE ${scope.clauses.join(' AND ')}` : ''
    const rows = await all(`SELECT status, assignee, priority FROM issues${where}`, scope.params)
    return computeGadgetData(type, rows)
  }

  if (type === 'filter_results') {
    const clauses = [...scope.clauses]
    const params = [...scope.params]
    for (const f of ['status', 'assignee', 'priority']) {
      if (config?.[f]) { clauses.push(`${f} = ?`); params.push(config[f]) }
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const limit = clampLimit(config?.limit, 10, 100)
    const rows = await all(
      `SELECT id, issue_key, title, status, assignee, priority FROM issues${where} ORDER BY id DESC LIMIT ?`,
      [...params, limit],
    )
    return { issues: rows, count: rows.length }
  }

  return null
}

const router = Router()

// GET /api/dashboards/gadgets/catalog — the gadget library.
router.get('/dashboards/gadgets/catalog', asyncHandler(async (_req, res) => {
  res.json({ gadgets: getGadgetCatalog() })
}))

// POST /api/dashboards/gadgets/data — compute one gadget's data.
router.post('/dashboards/gadgets/data', asyncHandler(async (req, res) => {
  const { type, config = {} } = req.body || {}
  const validation = validateGadgetConfig(type, config)
  if (!validation.ok) {
    res.status(400).json({ error: validation.errors[0] || 'Invalid gadget configuration', errors: validation.errors })
    return
  }
  const data = await runGadgetQuery(type, config, req)
  res.json({ type, data })
}))

export default router
