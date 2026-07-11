import { Router } from 'express'
import { all, get, run, withTransaction } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

// Simple, permissive email shape check — good enough to reject obviously
// malformed addresses without pulling in a dependency.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * JL-140: pure, db-free validation for a customer portal submission.
 * @param {object} body            the raw submission body (requesterEmail, summary, ...)
 * @param {object|null} requestType the request type row the submission targets
 * @returns {{ ok: boolean, errors: string[] }}
 *
 * Rules:
 *  - requesterEmail is required and must be email-shaped
 *  - summary is required (non-empty after trim)
 *  - requestType must exist and be enabled
 */
export function validateRequestSubmission(body, requestType) {
  const errors = []
  const b = body || {}

  const email = String(b.requesterEmail || '').trim()
  if (!email) {
    errors.push('requesterEmail is required')
  } else if (!EMAIL_RE.test(email)) {
    errors.push('requesterEmail must be a valid email address')
  }

  const summary = String(b.summary || '').trim()
  if (!summary) {
    errors.push('summary is required')
  }

  if (!requestType) {
    errors.push('request type not found')
  } else if (requestType.enabled === false) {
    errors.push('request type is not enabled')
  }

  return { ok: errors.length === 0, errors }
}

function mapRequestType(row) {
  if (!row) return null
  let fields = row.fields
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields) } catch { fields = [] }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description ?? '',
    icon: row.icon ?? '',
    fields: Array.isArray(fields) ? fields : [],
    defaultIssueType: row.default_issue_type ?? 'Task',
    enabled: row.enabled !== false,
    createdAt: row.created_at,
  }
}

/* =====================================================================
   Request-type admin (protect + Admin)
   ===================================================================== */

// GET /api/request-types — list all request types (optionally ?projectId=)
router.get('/request-types', asyncHandler(async (req, res) => {
  const params = []
  let where = ''
  if (req.query.projectId) {
    where = ' WHERE rt.project_id = ?'
    params.push(Number(req.query.projectId))
  }
  const rows = await all(
    `SELECT rt.id, rt.project_id, rt.name, rt.description, rt.icon, rt.fields,
            rt.default_issue_type, rt.enabled, rt.created_at
     FROM request_types rt${where}
     ORDER BY rt.created_at DESC, rt.id DESC`,
    params,
  )
  res.json(rows.map(mapRequestType))
}))

// GET /api/projects/:projectId/request-types — request types for one project
router.get('/projects/:projectId/request-types', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT id, project_id, name, description, icon, fields, default_issue_type, enabled, created_at
     FROM request_types WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
    [Number(req.params.projectId)],
  )
  res.json(rows.map(mapRequestType))
}))

// POST /api/request-types — create a request type (Admin only)
router.post('/request-types', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.body?.projectId)
  const name = String(req.body?.name || '').trim()
  const description = String(req.body?.description || '').trim()
  const icon = String(req.body?.icon || '').trim()
  const defaultIssueType = String(req.body?.defaultIssueType || 'Task').trim() || 'Task'
  const fields = Array.isArray(req.body?.fields) ? req.body.fields : []

  if (!Number.isInteger(projectId)) {
    res.status(400).json({ error: 'projectId is required' })
    return
  }
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }

  const project = await get('SELECT id FROM projects WHERE id = ?', [projectId])
  if (!project) {
    res.status(400).json({ error: 'Project not found' })
    return
  }

  const created = await run(
    `INSERT INTO request_types (project_id, name, description, icon, fields, default_issue_type, enabled)
     VALUES (?, ?, ?, ?, ?::jsonb, ?, TRUE)`,
    [projectId, name, description, icon, JSON.stringify(fields), defaultIssueType],
  )
  const row = await get(
    `SELECT id, project_id, name, description, icon, fields, default_issue_type, enabled, created_at
     FROM request_types WHERE id = ?`,
    [created.lastID],
  )
  res.status(201).json(mapRequestType(row))
}))

// DELETE /api/request-types/:id — remove a request type (Admin only)
router.delete('/request-types/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM request_types WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

/* =====================================================================
   Public portal surface (kept behind protect for now, but treated as the
   external customer API — see JL-140)
   ===================================================================== */

// GET /api/portal/request-types — the catalog customers choose from (enabled only)
router.get('/portal/request-types', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT rt.id, rt.project_id, rt.name, rt.description, rt.icon, rt.fields,
            rt.default_issue_type, rt.enabled, rt.created_at, p.name AS project_name
     FROM request_types rt
     JOIN projects p ON p.id = rt.project_id
     WHERE rt.enabled = TRUE
     ORDER BY rt.name ASC`,
  )
  res.json(rows.map((r) => ({ ...mapRequestType(r), projectName: r.project_name })))
}))

// POST /api/portal/requests — submit a customer request → creates an issue
router.post('/portal/requests', asyncHandler(async (req, res) => {
  const requestTypeId = Number(req.body?.requestTypeId)
  const requesterEmail = String(req.body?.requesterEmail || '').trim()
  const summary = String(req.body?.summary || '').trim()
  const description = String(req.body?.description || '').trim()

  const requestType = Number.isInteger(requestTypeId)
    ? await get(
        `SELECT id, project_id, name, default_issue_type, enabled, fields FROM request_types WHERE id = ?`,
        [requestTypeId],
      )
    : null

  const { ok, errors } = validateRequestSubmission(req.body, requestType)
  if (!ok) {
    res.status(400).json({ error: errors[0], errors })
    return
  }

  const project = await get('SELECT id, key FROM projects WHERE id = ?', [requestType.project_id])
  if (!project) {
    res.status(400).json({ error: 'Target project not found' })
    return
  }

  // Allocate a monotonic per-project issue key (mirrors issues.js nextIssueKey).
  const counterRow = await get(
    'UPDATE projects SET issue_counter = issue_counter + 1 WHERE id = ? RETURNING issue_counter',
    [project.id],
  )
  const issueKey = `${project.key}-${counterRow.issue_counter}`

  const issueType = requestType.default_issue_type || 'Task'

  // Fold any extra custom fields into the description so the submission is not lost.
  let fullDescription = description || summary
  if (req.body?.fields && typeof req.body.fields === 'object' && !Array.isArray(req.body.fields)) {
    const extra = Object.entries(req.body.fields)
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
      .map(([k, v]) => `- ${k}: ${v}`)
    if (extra.length > 0) {
      fullDescription += `\n\n---\nSubmitted via portal:\n${extra.join('\n')}`
    }
  }

  const result = await withTransaction(async (tx) => {
    const created = await tx.run(
      `INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type, project_id, reporter, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [issueKey, summary, fullDescription, 'Medium', requesterEmail, 'Backlog', issueType, project.id, requesterEmail],
    )
    const issue = await tx.get(
      'SELECT id, issue_key, status FROM issues WHERE id = ?',
      [created.lastID],
    )
    await tx.run(
      'INSERT INTO portal_requests (issue_id, requester_email, request_type_id) VALUES (?, ?, ?)',
      [issue.id, requesterEmail, requestType.id],
    )
    return issue
  })

  res.status(201).json({ issueKey: result.issue_key, status: result.status })
}))

// GET /api/portal/requests?email= — a customer's own submitted requests (status view)
router.get('/portal/requests', asyncHandler(async (req, res) => {
  const email = String(req.query.email || '').trim()
  if (!email) {
    res.status(400).json({ error: 'email query parameter is required' })
    return
  }
  const rows = await all(
    `SELECT pr.id, pr.requester_email, pr.request_type_id, pr.created_at,
            i.issue_key, i.title, i.status, i.issue_type,
            rt.name AS request_type_name
     FROM portal_requests pr
     JOIN issues i ON i.id = pr.issue_id
     LEFT JOIN request_types rt ON rt.id = pr.request_type_id
     WHERE LOWER(pr.requester_email) = LOWER(?)
     ORDER BY pr.created_at DESC, pr.id DESC`,
    [email],
  )
  res.json(
    rows.map((r) => ({
      id: r.id,
      issueKey: r.issue_key,
      summary: r.title,
      status: r.status,
      issueType: r.issue_type,
      requestType: r.request_type_name,
      requesterEmail: r.requester_email,
      createdAt: r.created_at,
    })),
  )
}))

export default router
