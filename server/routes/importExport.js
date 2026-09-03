import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireProjectRead, requireProjectWrite } from '../middleware/authorize.js'
import { validStatuses, validPriorities, validIssueTypes } from '../middleware/validate.js'
import { toCsv } from '../utils/tabular.js'

const router = Router()

// JL-286: both endpoints carry the project id directly in the path — export is a
// project READ (available to any project member, incl. Viewers), import a WRITE.
const importExportProject = (req) => Number(req.params.projectId)

const EXPORT_FIELDS = ['issue_key', 'title', 'description', 'priority', 'assignee', 'status', 'issue_type', 'sprint_id']
// What the importer reads: everything exported except the key. The target
// project generates its own from projects.issue_counter, so an incoming
// issue_key could never be honoured.
const IMPORT_FIELDS = EXPORT_FIELDS.filter((f) => f !== 'issue_key')

// JL-450: matches MAX_CSV_BYTES in src/api/importExportApi.js. Characters
// rather than bytes — this is a JS string by the time it reaches here — which
// is close enough for a guard rail and avoids re-encoding to measure.
const MAX_CSV_CHARS = 2 * 1024 * 1024

/*
 * JL-448 — these are READ from validate.js, not restated here.
 *
 * This module used to declare its own copies:
 *
 *   status:     Backlog, To Do, In Progress, Code Review, Done
 *   issue_type: Story, Bug, Task
 *
 * and they fell behind. JL-306 appended the QA-lifecycle statuses (In Testing,
 * In Rework, In UAT, Cancelled); JL-31 and JL-76 added Sub-task and Epic. The
 * route layer picked all of that up, this file did not, and the DB CHECK
 * constraints that might have caught it were deliberately dropped in db.js
 * ("Validation now happens in the route layer").
 *
 * The result: THE IMPORTER REJECTED THIS APPLICATION'S OWN EXPORT. Export an
 * issue sitting in In Testing, or any Epic or Sub-task, and the import refused
 * the row as invalid. Measured on a real file — of five rows using values the
 * app creates without complaint, four were rejected.
 *
 * One source of truth. The next status anyone adds to validate.js reaches the
 * importer for free, and ImporterWhitelists.JL448 fails if these are ever
 * re-declared locally.
 */
const VALID = {
  priority: validPriorities,
  status: validStatuses,
  issue_type: validIssueTypes,
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
  // JL-450: the client caps the file it reads, but that check is advisory —
  // this endpoint takes a JSON string and anything can post to it. The limit is
  // sized against the COMMIT loop below, not the transport: it inserts one row
  // per await, unbatched and deliberately outside a transaction, so a very
  // large payload is a long series of round-trips in one request and a failure
  // part-way leaves earlier rows committed. express.json allows 25mb; that is
  // not the binding constraint.
  if (csv.length > MAX_CSV_CHARS) {
    res.status(413).json({
      error: `CSV too large (${(csv.length / 1024 / 1024).toFixed(1)}MB). Limit is ${MAX_CSV_CHARS / 1024 / 1024}MB — split it and import in parts.`,
    })
    return
  }

  const grid = parseCsv(csv)
  if (grid.length < 2) { res.status(400).json({ error: 'CSV must have a header row and at least one data row' }); return }
  const headers = grid[0].map((h) => h.trim())
  const colOf = (field) => {
    const source = mapping?.[field] || field
    return headers.findIndex((h) => h.toLowerCase() === String(source).toLowerCase())
  }
  // JL-448: derived from EXPORT_FIELDS rather than retyped, so export and
  // import cannot claim different field sets. `issue_key` is the one exception
  // and it is dropped deliberately: the target project mints its own key from
  // projects.issue_counter, so an incoming key would be ignored anyway.
  const idx = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, colOf(f)]))

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

  // Commit — reserve the whole block of key numbers atomically (JL-363).
  //
  // The old code seeded a JS counter from `COUNT(*) WHERE project_id = ?` and
  // incremented it per row. That was wrong twice over:
  //   1. Same bug JL-352 fixed for cloning — any project that has ever had an
  //      issue deleted has COUNT(*) < issue_counter, so imported keys collide
  //      with keys already in use (unique index idx_issues_issue_key → 500).
  //   2. Worse: it never advanced projects.issue_counter, so every issue
  //      created normally *after* an import re-used the imported numbers and
  //      collided — even on a project that had never seen a delete.
  //
  // The fix mirrors nextIssueKey() (issues.js, JL-92) but reserves N numbers in
  // a single atomic UPDATE instead of N round-trips. Doing it in one statement
  // also guarantees the imported keys are contiguous: a concurrent create can
  // only land before or after the whole reserved block, never inside it.
  //
  // There is no project-less path to handle here (unlike nextIssueKey): this
  // endpoint takes :projectId from the URL and 404s above if it does not exist.
  //
  // The inserts below are NOT wrapped in a transaction (they never were), so a
  // failure part-way through leaves the earlier rows committed and the tail of
  // the reserved block unused. That is deliberate and safe: unused numbers are
  // gaps, and gaps are fine — the counter has already moved past them, so
  // nothing will ever hand them out again. Collisions are the failure mode we
  // must avoid, not gaps.
  const created = []
  if (parsed.length > 0) {
    const reservation = await get(
      'UPDATE projects SET issue_counter = issue_counter + ? WHERE id = ? RETURNING issue_counter',
      [parsed.length, projectId],
    )
    // RETURNING yields the counter *after* the bump, i.e. the LAST number of
    // the reserved block. Reserving N from a counter at C gives C + N, so the
    // reserved numbers are [C + 1 .. C + N] = [end - N + 1 .. end].
    // `base` is the number immediately before the block, so row i (0-based)
    // gets base + i + 1 — first key base+1 == C+1, last key base+N == end.
    const base = Number(reservation.issue_counter) - parsed.length
    for (let i = 0; i < parsed.length; i++) {
      const rec = parsed[i]
      const issueKey = `${project.key}-${base + i + 1}`
      const ins = await run(
        'INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [issueKey, rec.title, rec.description, rec.priority, rec.assignee, rec.status, rec.issue_type, rec.sprint_id, projectId],
      )
      created.push({ id: ins.lastID, issue_key: issueKey })
    }
  }
  res.status(201).json({ dryRun: false, created: created.length, keys: created, invalid: errors.length, errors: errors.slice(0, 50) })
}))

export default router
