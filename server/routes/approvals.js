import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { validStatuses } from '../middleware/validate.js'
import { createNotification } from './notifications.js'

const VALID_APPROVER_ROLES = ['Admin', 'Member', 'Lead']

const router = Router()

// GET /api/approvals/rules?projectId=X — list approval rules
router.get('/rules', asyncHandler(async (req, res) => {
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  let sql = 'SELECT id, project_id, from_status, to_status, required_approvals, approver_role, created_at FROM approval_rules'
  const params = []
  if (projectId) {
    sql += ' WHERE project_id = ?'
    params.push(projectId)
  }
  sql += ' ORDER BY id ASC'
  const rows = await all(sql, params)
  res.json(rows)
}))

// POST /api/approvals/rules — create an approval rule (Admin only)
router.post('/rules', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { projectId, fromStatus, toStatus, requiredApprovals = 1, approverRole = 'Admin' } = req.body
  if (!fromStatus || !toStatus) {
    res.status(400).json({ error: 'fromStatus and toStatus are required' })
    return
  }
  if (!validStatuses.includes(fromStatus) || !validStatuses.includes(toStatus)) {
    res.status(400).json({ error: 'fromStatus and toStatus must be valid issue statuses' })
    return
  }
  if (!VALID_APPROVER_ROLES.includes(approverRole)) {
    res.status(400).json({ error: 'approverRole must be Admin, Member, or Lead' })
    return
  }
  const result = await run(
    'INSERT INTO approval_rules (project_id, from_status, to_status, required_approvals, approver_role) VALUES (?, ?, ?, ?, ?)',
    [projectId || null, fromStatus, toStatus, requiredApprovals, approverRole],
  )
  const row = await get('SELECT * FROM approval_rules WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// DELETE /api/approvals/rules/:id — delete an approval rule
router.delete('/rules/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  await run('DELETE FROM approval_rules WHERE id = ?', [Number(req.params.id)])
  res.json({ success: true })
}))

// GET /api/approvals/issue/:issueId — list approvals for an issue
router.get('/issue/:issueId', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    'SELECT id, issue_id, from_status, to_status, approver_email, decision, comment, created_at FROM approvals WHERE issue_id = ? ORDER BY created_at DESC',
    [issueId],
  )
  res.json(rows)
}))

// POST /api/approvals/issue/:issueId — submit approval decision
router.post('/issue/:issueId', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const { fromStatus, toStatus, decision, comment = '' } = req.body
  const approverEmail = req.user.email

  if (!['approved', 'rejected'].includes(decision)) {
    res.status(400).json({ error: 'decision must be approved or rejected' })
    return
  }

  const result = await run(
    'INSERT INTO approvals (issue_id, from_status, to_status, approver_email, decision, comment) VALUES (?, ?, ?, ?, ?, ?)',
    [issueId, fromStatus, toStatus, approverEmail, decision, comment],
  )

  // Notify issue assignee
  const issue = await get('SELECT assignee, issue_key FROM issues WHERE id = ?', [issueId])
  if (issue) {
    const memberRow = await get('SELECT email FROM members WHERE name = ?', [issue.assignee])
    if (memberRow) {
      await createNotification({
        recipientEmail: memberRow.email,
        type: 'approval',
        title: `${issue.issue_key} ${decision}`,
        message: `Transition ${fromStatus} → ${toStatus} was ${decision} by ${approverEmail}`,
        issueId,
        actorEmail: approverEmail,
      })
    }
  }

  const row = await get('SELECT * FROM approvals WHERE id = ?', [result.lastID])
  res.status(201).json(row)
}))

// GET /api/approvals/check/:issueId — check if transition requires approval
router.get('/check/:issueId', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const toStatus = req.query.toStatus
  const issue = await get('SELECT status, project_id FROM issues WHERE id = ?', [issueId])
  if (!issue) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }

  const rule = await get(
    'SELECT * FROM approval_rules WHERE (project_id = ? OR project_id IS NULL) AND from_status = ? AND to_status = ? ORDER BY project_id DESC NULLS LAST LIMIT 1',
    [issue.project_id, issue.status, toStatus],
  )

  if (!rule) {
    res.json({ required: false })
    return
  }

  const approvedCount = await get(
    "SELECT COUNT(*) AS count FROM approvals WHERE issue_id = ? AND from_status = ? AND to_status = ? AND decision = 'approved'",
    [issueId, issue.status, toStatus],
  )

  res.json({
    required: true,
    rule,
    approvedCount: Number(approvedCount.count),
    satisfied: Number(approvedCount.count) >= rule.required_approvals,
  })
}))

export default router
