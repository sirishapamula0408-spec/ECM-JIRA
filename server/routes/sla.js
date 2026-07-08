import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { createNotification } from './notifications.js'

const router = Router()

const VALID_APPLIES_TO = ['resolution', 'response']
const MS_PER_HOUR = 1000 * 60 * 60

// JL-52: classify an elapsed duration against an SLA target.
//   ok       — under 75% of the budget consumed
//   at_risk  — 75% up to and including 100% consumed
//   breached — over 100% consumed
// Returns null when the target is missing/invalid so callers can treat the
// issue as un-tracked rather than mis-flagging it.
export function slaStatus(elapsedHours, targetHours) {
  if (!Number.isFinite(targetHours) || targetHours <= 0) return null
  if (!Number.isFinite(elapsedHours) || elapsedHours < 0) return null
  const percent = (elapsedHours / targetHours) * 100
  if (percent > 100) return 'breached'
  if (percent >= 75) return 'at_risk'
  return 'ok'
}

// Whole-hours elapsed between two instants, rounded to 2 decimals. null on
// unparseable input.
export function elapsedHoursBetween(fromIso, toMs) {
  if (!fromIso) return null
  const fromMs = new Date(fromIso).getTime()
  if (!Number.isFinite(fromMs)) return null
  return Number(((toMs - fromMs) / MS_PER_HOUR).toFixed(2))
}

/* ============================================================
   Policy CRUD (Admin-gated for writes)
   ============================================================ */

// GET /api/sla-policies?projectId=X — list policies (optionally scoped)
router.get('/sla-policies', asyncHandler(async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  let sql = 'SELECT id, project_id, priority, target_hours, applies_to, created_at FROM sla_policies'
  const params = []
  if (projectId) {
    sql += ' WHERE project_id = ?'
    params.push(projectId)
  }
  sql += ' ORDER BY project_id NULLS FIRST, priority ASC, id ASC'
  const rows = await all(sql, params)
  res.json(rows)
}))

// POST /api/sla-policies — create a policy (Admin only)
router.post('/sla-policies', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { projectId = null, priority, targetHours, appliesTo = 'resolution' } = req.body
  if (!priority || typeof priority !== 'string') {
    res.status(400).json({ error: 'priority is required' })
    return
  }
  const hours = Number(targetHours)
  if (!Number.isFinite(hours) || hours <= 0) {
    res.status(400).json({ error: 'targetHours must be a positive number' })
    return
  }
  if (!VALID_APPLIES_TO.includes(appliesTo)) {
    res.status(400).json({ error: "appliesTo must be 'resolution' or 'response'" })
    return
  }
  const result = await run(
    'INSERT INTO sla_policies (project_id, priority, target_hours, applies_to) VALUES (?, ?, ?, ?)',
    [projectId || null, priority, Math.round(hours), appliesTo],
  )
  const row = await get('SELECT id, project_id, priority, target_hours, applies_to, created_at FROM sla_policies WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// PUT /api/sla-policies/:id — update a policy (Admin only)
router.put('/sla-policies/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT id FROM sla_policies WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Policy not found' })
    return
  }
  const { priority, targetHours, appliesTo } = req.body
  if (priority !== undefined && (!priority || typeof priority !== 'string')) {
    res.status(400).json({ error: 'priority must be a non-empty string' })
    return
  }
  let hours
  if (targetHours !== undefined) {
    hours = Number(targetHours)
    if (!Number.isFinite(hours) || hours <= 0) {
      res.status(400).json({ error: 'targetHours must be a positive number' })
      return
    }
  }
  if (appliesTo !== undefined && !VALID_APPLIES_TO.includes(appliesTo)) {
    res.status(400).json({ error: "appliesTo must be 'resolution' or 'response'" })
    return
  }
  await run(
    `UPDATE sla_policies SET
       priority = COALESCE(?, priority),
       target_hours = COALESCE(?, target_hours),
       applies_to = COALESCE(?, applies_to)
     WHERE id = ?`,
    [priority ?? null, hours !== undefined ? Math.round(hours) : null, appliesTo ?? null, id],
  )
  const row = await get('SELECT id, project_id, priority, target_hours, applies_to, created_at FROM sla_policies WHERE id = ?', [id])
  res.json(row)
}))

// DELETE /api/sla-policies/:id — delete a policy (Admin only)
router.delete('/sla-policies/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM sla_policies WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

/* ============================================================
   SLA report — compute status per issue vs matching policy
   ============================================================ */

// Best-effort, non-blocking alert for a breached issue. Never throws.
async function alertBreach(issue, targetHours, elapsedHours, actorEmail) {
  try {
    if (!issue.assignee) return
    const member = await get('SELECT email FROM members WHERE name = ?', [issue.assignee])
    if (!member || !member.email) return
    await createNotification({
      recipientEmail: member.email,
      type: 'sla_breach',
      title: `SLA breached: ${issue.issue_key}`,
      message: `${issue.issue_key} has consumed ${elapsedHours}h against a ${targetHours}h SLA target.`,
      issueId: issue.id,
      projectId: issue.project_id ?? null,
      actorEmail,
    })
  } catch {
    // swallow — alerts must never break the report
  }
}

// GET /api/reports/sla?projectId=X
// For every issue in the project, compute elapsed hours against the SLA policy
// matching its priority and classify ok / at_risk / breached. Non-Done issues
// measure from created_at → now; Done issues measure created_at → first Done.
router.get('/reports/sla', asyncHandler(async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  if (!projectId || !Number.isInteger(projectId)) {
    res.status(400).json({ error: 'projectId is required' })
    return
  }

  const policyRows = await all(
    'SELECT id, project_id, priority, target_hours, applies_to FROM sla_policies WHERE project_id = ? AND applies_to = ?',
    [projectId, 'resolution'],
  )
  const targetByPriority = new Map()
  for (const p of policyRows) targetByPriority.set(p.priority, p.target_hours)

  const issues = await all(
    'SELECT id, issue_key, title, priority, status, assignee, project_id, created_at FROM issues WHERE project_id = ?',
    [projectId],
  )

  // First-Done timestamp per Done issue, from issue_history.
  const doneIds = issues.filter((i) => i.status === 'Done').map((i) => i.id)
  const doneAt = new Map()
  if (doneIds.length) {
    const placeholders = doneIds.map(() => '?').join(', ')
    const doneRows = await all(
      `SELECT issue_id, MIN(changed_at) AS done_at FROM issue_history
        WHERE field = 'status' AND new_value = 'Done' AND issue_id IN (${placeholders})
        GROUP BY issue_id`,
      doneIds,
    )
    for (const r of doneRows) doneAt.set(r.issue_id, r.done_at)
  }

  const now = Date.now()
  const buckets = { breached: [], at_risk: [], ok: [] }
  const noPolicy = []

  for (const issue of issues) {
    const targetHours = targetByPriority.get(issue.priority)
    if (targetHours === undefined) {
      noPolicy.push({
        id: issue.id,
        key: issue.issue_key,
        title: issue.title,
        priority: issue.priority,
        status: issue.status,
        assignee: issue.assignee,
      })
      continue
    }

    // Done issues: measure to the moment they first reached Done (falls back to
    // now if no history row exists). Open issues: measure to now.
    const endMs = issue.status === 'Done'
      ? (doneAt.has(issue.id) ? new Date(doneAt.get(issue.id)).getTime() : now)
      : now
    const elapsedHours = elapsedHoursBetween(issue.created_at, endMs)
    const state = slaStatus(elapsedHours, targetHours)
    if (state === null) continue

    const entry = {
      id: issue.id,
      key: issue.issue_key,
      title: issue.title,
      priority: issue.priority,
      status: issue.status,
      assignee: issue.assignee,
      targetHours,
      elapsedHours,
      percent: Number(((elapsedHours / targetHours) * 100).toFixed(1)),
      slaStatus: state,
    }
    buckets[state].push(entry)

    // Alert only for OPEN breaches — a resolved issue can't be un-breached.
    if (state === 'breached' && issue.status !== 'Done') {
      alertBreach(issue, targetHours, elapsedHours, req.user?.email ?? null)
    }
  }

  res.json({
    projectId,
    policies: policyRows,
    summary: {
      breached: buckets.breached.length,
      atRisk: buckets.at_risk.length,
      ok: buckets.ok.length,
      noPolicy: noPolicy.length,
      total: issues.length,
    },
    breached: buckets.breached,
    atRisk: buckets.at_risk,
    ok: buckets.ok,
    noPolicy,
  })
}))

export default router
