import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { validStatuses } from '../middleware/validate.js'
import { createNotification } from './notifications.js'
import {
  findApprovalRule,
  evaluateApproval,
  canApprove,
  isSelfApproval,
  DEFAULT_APPROVER_ROLE,
} from '../services/approvals.js'

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

  const issue = await get(
    'SELECT assignee, issue_key, reporter, project_id FROM issues WHERE id = ?',
    [issueId],
  )

  // JL-360: enforce the rule's approver_role. Before this, ANY authenticated user
  // could record an approval, so "requires Lead approval" was satisfiable by a
  // Viewer. Only gated transitions are checked — recording a decision on an
  // ungated transition stays open (it is inert record-keeping, and evaluateApproval
  // ignores approvals predating the rule so such rows can never satisfy a later gate).
  const rule = await findApprovalRule(issue?.project_id ?? null, fromStatus, toStatus)
  if (rule) {
    const requiredRole = rule.approver_role || DEFAULT_APPROVER_ROLE
    const allowed = await canApprove(req.user, issue?.project_id ?? null, requiredRole)
    if (!allowed) {
      res.status(403).json({ error: `This transition requires approval from a ${requiredRole}` })
      return
    }
    // Segregation of duties: the reporter cannot approve their own issue's move.
    const self = await get('SELECT name FROM members WHERE LOWER(email) = LOWER(?)', [approverEmail])
    if (isSelfApproval(issue, approverEmail, self?.name)) {
      res.status(403).json({ error: 'You cannot approve a transition on an issue you reported' })
      return
    }
  }

  const result = await run(
    'INSERT INTO approvals (issue_id, from_status, to_status, approver_email, decision, comment) VALUES (?, ?, ?, ?, ?, ?)',
    [issueId, fromStatus, toStatus, approverEmail, decision, comment],
  )

  // Notify issue assignee
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
  const issue = await get('SELECT id, status, project_id FROM issues WHERE id = ?', [issueId])
  if (!issue) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }

  // JL-360: delegate to the shared gate so this endpoint and the status-change
  // enforcement in issues.js can never disagree about whether a move is blocked.
  const state = await evaluateApproval({ ...issue, id: issue.id ?? issueId }, toStatus)
  if (!state.required) {
    res.json({ required: false })
    return
  }

  res.json({
    required: true,
    rule: state.rule,
    approvedCount: state.approvedCount,
    satisfied: state.satisfied,
    approvers: state.approvers,
    rejecters: state.rejecters,
    rejected: state.rejected,
    requiredApprovals: state.requiredApprovals,
    approverRole: state.approverRole,
    remaining: state.remaining,
    // JL-360: whether the CURRENT user may record a decision (drives the UI).
    canApprove: await canApprove(req.user, issue.project_id ?? null, state.approverRole),
  })
}))

export default router
