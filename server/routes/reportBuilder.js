import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

/* ============================================================
   JL-151: Custom drag-and-drop report builder
   ------------------------------------------------------------
   The vocabulary + pure helpers below are exported so they can be
   unit-tested without a database. `computeReport` groups an array
   of issues by a dimension and aggregates by a measure.
   ============================================================ */

// group-by dimensions the builder understands
export const REPORT_DIMENSIONS = [
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'priority', label: 'Priority' },
  { key: 'issue_type', label: 'Issue type' },
  { key: 'project', label: 'Project' },
  { key: 'label', label: 'Label' },
]

// aggregation measures
export const REPORT_MEASURES = [
  { key: 'count', label: 'Issue count' },
  { key: 'sum_story_points', label: 'Sum of story points' },
  { key: 'avg_cycle_time', label: 'Avg cycle time (hours)' },
]

// how the result is rendered
export const REPORT_CHART_TYPES = [
  { key: 'bar', label: 'Bar' },
  { key: 'line', label: 'Line' },
  { key: 'pie', label: 'Pie' },
  { key: 'table', label: 'Table' },
]

const DIMENSION_KEYS = new Set(REPORT_DIMENSIONS.map((d) => d.key))
const MEASURE_KEYS = new Set(REPORT_MEASURES.map((m) => m.key))
const CHART_KEYS = new Set(REPORT_CHART_TYPES.map((c) => c.key))

// buckets used when the grouping value is missing
const UNASSIGNED = 'Unassigned'
const NONE = 'None'

/**
 * Validate a report definition. Pure — no db.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateReportDef(def) {
  const errors = []
  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    return { ok: false, errors: ['definition must be an object'] }
  }
  if (!DIMENSION_KEYS.has(def.dimension)) {
    errors.push(`unknown dimension: ${String(def.dimension)}`)
  }
  if (!MEASURE_KEYS.has(def.measure)) {
    errors.push(`unknown measure: ${String(def.measure)}`)
  }
  if (!CHART_KEYS.has(def.chartType)) {
    errors.push(`unknown chartType: ${String(def.chartType)}`)
  }
  // filters are optional; when present they must be an array or plain object
  if (
    def.filters !== undefined &&
    def.filters !== null &&
    !Array.isArray(def.filters) &&
    typeof def.filters !== 'object'
  ) {
    errors.push('filters must be an array or object')
  }
  return { ok: errors.length === 0, errors }
}

// Resolve the group-by bucket(s) for a single issue. Returns an array
// because the `label` dimension can place one issue in several buckets.
function bucketKeys(issue, dimension) {
  switch (dimension) {
    case 'status':
      return [nonEmpty(issue.status) ?? NONE]
    case 'priority':
      return [nonEmpty(issue.priority) ?? NONE]
    case 'issue_type':
      return [nonEmpty(issue.issue_type ?? issue.issueType) ?? NONE]
    case 'assignee':
      return [nonEmpty(issue.assignee) ?? UNASSIGNED]
    case 'project':
      return [
        nonEmpty(issue.project_name ?? issue.projectName ?? issue.project) ??
          (issue.project_id ?? issue.projectId ?? null) ??
          NONE,
      ].map((v) => (v === null ? NONE : String(v)))
    case 'label': {
      const labels = issue.labels
      if (Array.isArray(labels) && labels.length) {
        return labels.map((l) => String(typeof l === 'object' ? l.name : l)).filter(Boolean)
      }
      return [NONE]
    }
    default:
      return [NONE]
  }
}

function nonEmpty(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// Cycle time in hours from created → resolved, or null when unavailable.
function cycleHours(issue) {
  const createdRaw = issue.created_at ?? issue.createdAt
  const resolvedRaw = issue.resolved_at ?? issue.resolvedAt
  if (!createdRaw || !resolvedRaw) return null
  const created = new Date(createdRaw).getTime()
  const resolved = new Date(resolvedRaw).getTime()
  if (!Number.isFinite(created) || !Number.isFinite(resolved)) return null
  if (resolved < created) return null
  return (resolved - created) / (1000 * 60 * 60)
}

/**
 * Group `issues` by `def.dimension` and aggregate by `def.measure`.
 * Pure — no db. Empty input yields an empty rows array.
 * @returns {{ rows: Array<{label:string, value:number}>, meta: object }}
 */
export function computeReport(issues, def) {
  const list = Array.isArray(issues) ? issues : []
  const dimension = def?.dimension
  const measure = def?.measure ?? 'count'

  const groups = new Map()
  const ensure = (key) => {
    if (!groups.has(key)) {
      groups.set(key, { count: 0, sumPoints: 0, cycleSum: 0, cycleCount: 0 })
    }
    return groups.get(key)
  }

  for (const issue of list) {
    if (!issue || typeof issue !== 'object') continue
    for (const key of bucketKeys(issue, dimension)) {
      const g = ensure(key)
      g.count += 1
      const sp = Number(issue.story_points ?? issue.storyPoints)
      if (Number.isFinite(sp)) g.sumPoints += sp
      const ct = cycleHours(issue)
      if (ct !== null) {
        g.cycleSum += ct
        g.cycleCount += 1
      }
    }
  }

  const rows = [...groups.entries()].map(([label, g]) => {
    let value
    if (measure === 'sum_story_points') value = g.sumPoints
    else if (measure === 'avg_cycle_time') {
      value = g.cycleCount ? Math.round((g.cycleSum / g.cycleCount) * 100) / 100 : 0
    } else value = g.count
    return { label, value }
  })

  // largest first, then alphabetical for stable ties
  rows.sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)))

  return {
    rows,
    meta: { dimension, measure, totalIssues: list.length, groups: rows.length },
  }
}

/* ============================================================
   Issue loading for POST /run
   ============================================================ */

// filter fields that may be applied to the issue query
const FILTERABLE = {
  status: 'i.status',
  priority: 'i.priority',
  assignee: 'i.assignee',
  issue_type: 'i.issue_type',
  issuetype: 'i.issue_type',
  project: 'i.project_id',
  project_id: 'i.project_id',
}

// Normalise filters (array of {field,value} or plain object) into
// [{ column, value }] pairs against known columns.
function normalizeFilters(filters) {
  const pairs = []
  if (!filters) return pairs
  const push = (field, value) => {
    if (value === undefined || value === null || value === '') return
    const column = FILTERABLE[String(field).toLowerCase()]
    if (column) pairs.push({ column, value })
  }
  if (Array.isArray(filters)) {
    for (const f of filters) {
      if (f && typeof f === 'object') push(f.field, f.value)
    }
  } else if (typeof filters === 'object') {
    for (const [field, value] of Object.entries(filters)) push(field, value)
  }
  return pairs
}

async function loadIssues(filters, needsLabels) {
  const pairs = normalizeFilters(filters)
  const conditions = pairs.map((p) => `${p.column} = ?`)
  const params = pairs.map((p) => p.value)
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const issues = await all(
    `SELECT i.id, i.status, i.priority, i.assignee, i.issue_type, i.project_id,
            i.story_points, i.created_at, i.updated_at, i.resolution,
            p.name AS project_name
       FROM issues i
       LEFT JOIN projects p ON p.id = i.project_id
       ${where}`,
    params,
  )

  // Treat a resolved issue's updated_at as its resolution timestamp so
  // avg_cycle_time has something to work with.
  for (const issue of issues) {
    if (issue.status === 'Done' || issue.resolution) {
      issue.resolved_at = issue.updated_at || null
    }
  }

  if (needsLabels && issues.length) {
    const ids = issues.map((i) => i.id)
    const placeholders = ids.map(() => '?').join(', ')
    const labelRows = await all(
      `SELECT il.issue_id, l.name
         FROM issue_labels il
         JOIN labels l ON l.id = il.label_id
        WHERE il.issue_id IN (${placeholders})`,
      ids,
    )
    const byIssue = new Map()
    for (const r of labelRows) {
      if (!byIssue.has(r.issue_id)) byIssue.set(r.issue_id, [])
      byIssue.get(r.issue_id).push(r.name)
    }
    for (const issue of issues) issue.labels = byIssue.get(issue.id) || []
  }

  return issues
}

/* ============================================================
   Routes
   ============================================================ */

// POST /api/report-builder/run — run an ad-hoc report definition.
router.post(
  '/report-builder/run',
  asyncHandler(async (req, res) => {
    const definition = req.body?.definition ?? req.body ?? {}
    // filters may live on the definition or be passed alongside it
    const filters = req.body?.filters ?? definition.filters
    const check = validateReportDef(definition)
    if (!check.ok) {
      return res.status(400).json({ error: 'Invalid report definition', errors: check.errors })
    }
    const needsLabels = definition.dimension === 'label'
    const issues = await loadIssues(filters, needsLabels)
    const result = computeReport(issues, definition)
    res.json(result)
  }),
)

const mapReport = (row) => ({
  id: row.id,
  name: row.name,
  ownerEmail: row.owner_email,
  definition: typeof row.definition === 'string' ? JSON.parse(row.definition) : row.definition,
  createdAt: row.created_at,
})

// GET /api/report-builder/reports — owner-scoped list of saved reports.
router.get(
  '/report-builder/reports',
  asyncHandler(async (req, res) => {
    const email = req.user?.email
    const rows = await all(
      'SELECT id, name, owner_email, definition, created_at FROM saved_reports WHERE owner_email = ? ORDER BY created_at DESC',
      [email],
    )
    res.json(rows.map(mapReport))
  }),
)

// POST /api/report-builder/reports — create a saved report.
router.post(
  '/report-builder/reports',
  asyncHandler(async (req, res) => {
    const email = req.user?.email
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    const definition = req.body?.definition
    if (!name) return res.status(400).json({ error: 'name is required' })
    const check = validateReportDef(definition)
    if (!check.ok) {
      return res.status(400).json({ error: 'Invalid report definition', errors: check.errors })
    }
    const result = await run(
      'INSERT INTO saved_reports (name, owner_email, definition) VALUES (?, ?, ?::jsonb)',
      [name, email, JSON.stringify(definition)],
    )
    const row = await get('SELECT id, name, owner_email, definition, created_at FROM saved_reports WHERE id = ?', [
      result.lastID,
    ])
    res.status(201).json(mapReport(row))
  }),
)

// PATCH /api/report-builder/reports/:id — owner-only edit.
router.patch(
  '/report-builder/reports/:id',
  asyncHandler(async (req, res) => {
    const email = req.user?.email
    const id = Number(req.params.id)
    const existing = await get('SELECT id, owner_email FROM saved_reports WHERE id = ?', [id])
    if (!existing) return res.status(404).json({ error: 'Report not found' })
    if (existing.owner_email !== email) {
      return res.status(403).json({ error: 'Only the owner can edit this report' })
    }

    const sets = []
    const params = []
    if (typeof req.body?.name === 'string' && req.body.name.trim()) {
      sets.push('name = ?')
      params.push(req.body.name.trim())
    }
    if (req.body?.definition !== undefined) {
      const check = validateReportDef(req.body.definition)
      if (!check.ok) {
        return res.status(400).json({ error: 'Invalid report definition', errors: check.errors })
      }
      sets.push('definition = ?::jsonb')
      params.push(JSON.stringify(req.body.definition))
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' })

    params.push(id)
    await run(`UPDATE saved_reports SET ${sets.join(', ')} WHERE id = ?`, params)
    const row = await get('SELECT id, name, owner_email, definition, created_at FROM saved_reports WHERE id = ?', [id])
    res.json(mapReport(row))
  }),
)

// DELETE /api/report-builder/reports/:id — owner-only delete.
router.delete(
  '/report-builder/reports/:id',
  asyncHandler(async (req, res) => {
    const email = req.user?.email
    const id = Number(req.params.id)
    const existing = await get('SELECT id, owner_email FROM saved_reports WHERE id = ?', [id])
    if (!existing) return res.status(404).json({ error: 'Report not found' })
    if (existing.owner_email !== email) {
      return res.status(403).json({ error: 'Only the owner can delete this report' })
    }
    await run('DELETE FROM saved_reports WHERE id = ?', [id])
    res.status(204).end()
  }),
)

export default router
