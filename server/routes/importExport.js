import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireProjectRead, requireProjectWrite } from '../middleware/authorize.js'
import { toCsv } from '../utils/tabular.js'

const router = Router()

// JL-286: both endpoints carry the project id directly in the path — export is a
// project READ (available to any project member, incl. Viewers), import a WRITE.
const importExportProject = (req) => Number(req.params.projectId)

const EXPORT_FIELDS = ['issue_key', 'title', 'description', 'priority', 'assignee', 'status', 'issue_type', 'sprint_id']
const VALID = {
  priority: ['Low', 'Medium', 'High'],
  status: ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done'],
  issue_type: ['Story', 'Bug', 'Task'],
}
const DEFAULTS = { description: '', priority: 'Medium', status: 'To Do', issue_type: 'Task', assignee: 'Unassigned' }

/* ---------- CSV import parser ---------- */
function parseCsv(text) {
  const rows = []
  let cur = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQ = false }
      } else { field += c }
    } else if (c === '"') { inQ = true }
    else if (c === ',') { cur.push(field); field = '' }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
    else { field += c }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur) }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

/* ---------- Export ---------- */
// GET /api/projects/:projectId/export?format=csv|json
router.get('/projects/:projectId/export', requireProjectRead(importExportProject), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const format = String(req.query.format || 'csv').toLowerCase()
  const project = await get('SELECT id, key, name FROM projects WHERE id = ?', [projectId])
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const rows = await all(
    `SELECT ${EXPORT_FIELDS.join(', ')} FROM issues WHERE project_id = ? ORDER BY id ASC`,
    [projectId],
  )

  if (format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${project.key}-issues.json"`)
    res.json({ project: { id: project.id, key: project.key, name: project.name }, issues: rows })
    return
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${project.key}-issues.csv"`)
  res.send(toCsv(rows, EXPORT_FIELDS))
}))

/* ---------- Import ---------- */
// POST /api/projects/:projectId/import  { csv, mapping?, dryRun? }
// mapping maps target field -> source header (defaults to identity where headers match field names)
router.post('/projects/:projectId/import', requireProjectWrite(importExportProject), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const project = await get('SELECT id, key FROM projects WHERE id = ?', [projectId])
  if (!project) { res.status(404).json({ error: 'Project not found' }); return }

  const csv = String(req.body?.csv || '')
  const mapping = req.body?.mapping && typeof req.body.mapping === 'object' ? req.body.mapping : null
  const dryRun = req.body?.dryRun !== false // default to dry-run for safety
  if (!csv.trim()) { res.status(400).json({ error: 'csv content is required' }); return }

  const grid = parseCsv(csv)
  if (grid.length < 2) { res.status(400).json({ error: 'CSV must have a header row and at least one data row' }); return }
  const headers = grid[0].map((h) => h.trim())
  const colOf = (field) => {
    const source = mapping?.[field] || field
    return headers.findIndex((h) => h.toLowerCase() === String(source).toLowerCase())
  }
  const idx = Object.fromEntries(['title', 'description', 'priority', 'assignee', 'status', 'issue_type', 'sprint_id'].map((f) => [f, colOf(f)]))

  const parsed = []
  const errors = []
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r]
    const val = (f) => (idx[f] >= 0 ? String(row[idx[f]] ?? '').trim() : '')
    const rec = {
      title: val('title'),
      description: val('description') || DEFAULTS.description,
      priority: val('priority') || DEFAULTS.priority,
      assignee: val('assignee') || DEFAULTS.assignee,
      status: val('status') || DEFAULTS.status,
      issue_type: val('issue_type') || DEFAULTS.issue_type,
      sprint_id: val('sprint_id') ? Number(val('sprint_id')) : null,
    }
    const rowErrors = []
    if (!rec.title) rowErrors.push('title is required')
    if (!VALID.priority.includes(rec.priority)) rowErrors.push(`invalid priority "${rec.priority}"`)
    if (!VALID.status.includes(rec.status)) rowErrors.push(`invalid status "${rec.status}"`)
    if (!VALID.issue_type.includes(rec.issue_type)) rowErrors.push(`invalid issue_type "${rec.issue_type}"`)
    if (rowErrors.length) errors.push({ row: r + 1, errors: rowErrors })
    else parsed.push(rec)
  }

  if (dryRun) {
    res.json({
      dryRun: true,
      totalRows: grid.length - 1,
      valid: parsed.length,
      invalid: errors.length,
      errors: errors.slice(0, 50),
      preview: parsed.slice(0, 10),
    })
    return
  }

  // Commit — generate keys sequentially
  const countRow = await get('SELECT COUNT(*) AS count FROM issues WHERE project_id = ?', [projectId])
  let n = Number(countRow.count)
  const created = []
  for (const rec of parsed) {
    n++
    const issueKey = `${project.key}-${n}`
    const ins = await run(
      'INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [issueKey, rec.title, rec.description, rec.priority, rec.assignee, rec.status, rec.issue_type, rec.sprint_id, projectId],
    )
    created.push({ id: ins.lastID, issue_key: issueKey })
  }
  res.status(201).json({ dryRun: false, created: created.length, keys: created, invalid: errors.length, errors: errors.slice(0, 50) })
}))

export default router
