import { Router } from 'express'
import { all, get, run, withTransaction } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { isEmail } from '../utils/validation.js'

const router = Router()

/**
 * JL-140: pure, db-free validation for a customer portal submission.
 * @param {object} body            the raw submission body (requesterEmail, summary, ...)
 * @param {object|null} requestType the request type row the submission targets
 * @returns {{ ok: boolean, errors: string[] }}
 *
 * Rules:
 *  - requesterEmail is required and must be email-shaped
 *    (JL-357: the route passes the SERVER-RESOLVED requester here, not the raw
 *    body value — this helper validates shape only, never authorisation)
 *  - summary is required (non-empty after trim)
 *  - requestType must exist and be enabled
 */
export function validateRequestSubmission(body, requestType) {
  const errors = []
  const b = body || {}

  const email = String(b.requesterEmail || '').trim()
  if (!email) {
    errors.push('requesterEmail is required')
  } else if (!isEmail(email)) {
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
//
// JL-357 (impersonation fix): the handler used to take `requesterEmail` straight
// from the body and use it as the created issue's reporter AND assignee AND as
// the portal_requests key, without ever consulting req.user. Any authenticated
// caller could therefore file a request in anyone else's name. This is the
// WRITE-side counterpart to the JL-349 read-side fix below, and it uses the same
// trust model:
//
//   - `requesterEmail` omitted            → defaults to the session user
//   - `requesterEmail` === session email  → allowed (case-insensitive)
//   - `requesterEmail` !== session email  → allowed ONLY for a workspace
//                                           Owner/Admin (support desk filing a
//                                           request on a customer's behalf);
//                                           everyone else gets 403.
//
// Why 403 here rather than the silent "ignore the input" the read side uses:
// GET is a "my requests" listing where scoping to the session is simply the
// right answer, but POST creates a durable record. Silently rewriting the
// address to the caller's own would hide an attempted impersonation both from
// the caller (who thinks they filed for someone else) and from anyone reading
// the data later. A 403 leaves the attempt visible and un-recorded.
router.post('/portal/requests', asyncHandler(async (req, res) => {
  const requestTypeId = Number(req.body?.requestTypeId)
  const suppliedEmail = String(req.body?.requesterEmail || '').trim()
  const sessionEmail = String(req.user?.email || '').trim()
  // The single resolved identity: the issue reporter/assignee and the
  // portal_requests row all use THIS value, so they cannot drift apart.
  const requesterEmail = suppliedEmail || sessionEmail
  const summary = String(req.body?.summary || '').trim()
  const description = String(req.body?.description || '').trim()

  const requestType = Number.isInteger(requestTypeId)
    ? await get(
        `SELECT id, project_id, name, default_issue_type, enabled, fields FROM request_types WHERE id = ?`,
        [requestTypeId],
      )
    : null

  // Validate the RESOLVED email so an omitted field defaults to the session user
  // instead of 400-ing, while a supplied-but-malformed address still fails the
  // existing email-shape check exactly as before.
  const { ok, errors } = validateRequestSubmission(
    { ...(req.body || {}), requesterEmail },
    requestType,
  )
  if (!ok) {
    res.status(400).json({ error: errors[0], errors })
    return
  }

  // Mirrors the privilege test used by the JL-349 read side (and the isOwner
  // bypass in middleware/authorize.js). The literal 'Owner' role string is
  // accepted too, per the JL-317 note: a member row with role='Owner' but
  // is_owner=false must not be treated as unprivileged.
  const canSubmitOnBehalf =
    Boolean(req.user?.isOwner) ||
    req.user?.workspaceRole === 'Admin' ||
    req.user?.workspaceRole === 'Owner'
  if (
    suppliedEmail &&
    suppliedEmail.toLowerCase() !== sessionEmail.toLowerCase() &&
    !canSubmitOnBehalf
  ) {
    res.status(403).json({
      error: 'You may only submit a request for your own email address',
    })
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

// GET /api/portal/requests — the caller's own submitted requests (status view)
//
// JL-349 (IDOR fix): the requester email is bound to the authenticated session
// (req.user.email), never taken from caller input — matching the "my things"
// convention in apiTokens.js / sessions.js. An explicit ?email= override is
// honoured ONLY for workspace Owners/Admins (support-desk view of a customer's
// requests). For everyone else the parameter is deliberately IGNORED rather
// than rejected with a 403: this is a "my requests" listing, so scoping to the
// session is the right answer regardless of what was asked for, and it keeps
// the pre-existing frontend flow (which passes the user's own email) working.
router.get('/portal/requests', asyncHandler(async (req, res) => {
  const requestedEmail = String(req.query.email || '').trim()
  const isPrivileged = req.user.isOwner || req.user.workspaceRole === 'Admin'
  const email = (isPrivileged && requestedEmail) ? requestedEmail : req.user.email
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
