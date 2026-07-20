import { Router } from 'express'
import { all, get, run, tableExists } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { sendMail, buildInviteEmail } from '../utils/mailer.js'
import { requireRole } from '../middleware/authorize.js'
import { isAllowedEmail, hashPassword } from '../middleware/validate.js'

const router = Router()

// Allowed workspace role values for role updates.
const VALID_ROLES = ['Owner', 'Admin', 'Member', 'Viewer']

// JL-246: roles assignable when creating a member. The workspace Owner is
// tracked via the is_owner flag and cannot be granted through POST /members
// (mirrors invitations.js, which also excludes Owner).
const CREATABLE_ROLES = ['Admin', 'Member', 'Viewer']

// JL-192: allowed member/user account statuses
const MEMBER_STATUSES = ['Active', 'Invited', 'Deactivated']

/**
 * Counts members who hold administrative privileges (role Admin/Owner or the
 * is_owner flag). Used to prevent locking every admin out of the workspace.
 */
async function countAdmins() {
  const row = await get(
    "SELECT COUNT(*) AS count FROM members WHERE role IN ('Admin', 'Owner') OR is_owner = TRUE",
  )
  return Number(row?.count || 0)
}

/**
 * Records a workspace-membership action in the activity table when it exists.
 * Failures are swallowed so member management never breaks on a missing table.
 */
async function recordActivity(actor, action) {
  try {
    if (!(await tableExists('activity'))) return
    await run(
      'INSERT INTO activity (actor, action, happened_at, activity_type, created_at) VALUES (?, ?, ?, ?, NOW())',
      [actor || 'System', action, new Date().toISOString(), 'member'],
    )
  } catch (err) {
    console.error('[Members] Failed to record activity:', err.message)
  }
}

/**
 * JL-197: appends an immutable entry to the user_audit_log table. Non-fatal —
 * an audit failure (missing table, bad column) never breaks the member action.
 */
async function recordAudit({
  actor,
  targetMemberId = null,
  targetEmail = null,
  action,
  before = null,
  after = null,
}) {
  try {
    await run(
      `INSERT INTO user_audit_log
        (actor, target_member_id, target_email, action, before_value, after_value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [
        actor || 'System',
        targetMemberId,
        targetEmail,
        action,
        before == null ? null : String(before),
        after == null ? null : String(after),
      ],
    )
  } catch (err) {
    console.error('[Members] Failed to record audit entry:', err.message)
  }
}

// JL-197: expose the user-administration audit trail (Admin only). Filterable
// by target (email or member id) and action; newest-first with a sane limit.
router.get('/audit', requireRole('Admin'), asyncHandler(async (req, res) => {
  const clauses = []
  const params = []

  const target = String(req.query.target || '').trim()
  if (target) {
    if (/^\d+$/.test(target)) {
      clauses.push('target_member_id = ?')
      params.push(Number(target))
    } else {
      clauses.push('LOWER(target_email) = LOWER(?)')
      params.push(target)
    }
  }

  const action = String(req.query.action || '').trim()
  if (action) {
    clauses.push('action = ?')
    params.push(action)
  }

  let limit = Number(req.query.limit)
  if (!Number.isInteger(limit) || limit <= 0) limit = 100
  if (limit > 500) limit = 500

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = await all(
    `SELECT id, actor, target_member_id, target_email, action, before_value, after_value, created_at
       FROM user_audit_log
       ${where}
       ORDER BY id DESC
       LIMIT ?`,
    [...params, limit],
  )
  res.json(rows)
}))

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, name, email, role, status, task_count, invited_by FROM members ORDER BY id ASC',
  )
  res.json(rows)
}))

// JL-192: Admin provisions an account directly. Optionally sets a temporary
// password (creating a login-capable `users` row → status Active) or, when no
// password is supplied, sends an invite email (status Invited).
router.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, email, role, invited_by, password } = req.body
  const normalizedName = String(name || '').trim()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedRole = String(role || 'Viewer').trim()
  const inviter = String(invited_by || '').trim() || 'Team Admin'
  const tempPassword = password == null ? '' : String(password)

  if (!normalizedName || !normalizedEmail) {
    res.status(400).json({ error: 'name and email are required' })
    return
  }
  // Validate email per the existing signup rules
  if (!isAllowedEmail(normalizedEmail)) {
    res.status(400).json({ error: 'Use a valid office email or Gmail address' })
    return
  }
  // JL-246: validate the workspace role (defaults to Viewer when omitted)
  if (!CREATABLE_ROLES.includes(normalizedRole)) {
    res.status(400).json({ error: `role must be one of: ${CREATABLE_ROLES.join(', ')}` })
    return
  }
  // Optional explicit status override
  let status = 'Invited'
  if (req.body.status != null) {
    const requested = String(req.body.status).trim()
    if (!MEMBER_STATUSES.includes(requested)) {
      res.status(400).json({ error: `status must be one of ${MEMBER_STATUSES.join(', ')}` })
      return
    }
    status = requested
  }

  // Prevent duplicate accounts (member or auth user)
  const existingMember = await get('SELECT id FROM members WHERE email = ?', [normalizedEmail])
  if (existingMember) {
    res.status(409).json({ error: 'A member with this email already exists' })
    return
  }
  const existingUser = await get('SELECT id FROM users WHERE email = ?', [normalizedEmail])
  if (existingUser) {
    res.status(409).json({ error: 'An account with this email already exists' })
    return
  }

  // If a temporary password is provided, provision a login-capable account.
  let createdLogin = false
  if (tempPassword) {
    if (tempPassword.length < 6) {
      res.status(400).json({ error: 'Temporary password must be at least 6 characters' })
      return
    }
    status = req.body.status != null ? status : 'Active'
    await run(
      'INSERT INTO users (email, password_hash, status) VALUES (?, ?, ?)',
      [normalizedEmail, hashPassword(tempPassword), status],
    )
    createdLogin = true
  }

  const created = await run(
    'INSERT INTO members (name, email, role, status, task_count, invited_by) VALUES (?, ?, ?, ?, ?, ?)',
    [normalizedName, normalizedEmail, normalizedRole, status, 0, inviter],
  )
  const row = await get(
    'SELECT id, name, email, role, status, task_count, invited_by FROM members WHERE id = ?',
    [created.lastID],
  )

  await recordAudit({
    actor: req.user?.email,
    targetMemberId: row.id,
    targetEmail: normalizedEmail,
    action: createdLogin ? 'member_created' : 'member_invited',
    after: `${normalizedRole} / ${status}`,
  })

  // Send invitation email (skip when a temp password activated the account directly)
  if (!createdLogin) {
    try {
      const { subject, html, text } = buildInviteEmail({
        recipientName: normalizedName,
        invitedBy: inviter,
        role: normalizedRole,
      })
      await sendMail({ to: normalizedEmail, subject, html, text })
    } catch (mailErr) {
      console.error('[Members] Failed to send invite email:', mailErr.message)
    }
  }

  res.status(201).json(row)
}))

// JL-192: Deactivate a member (soft) — preserves authored data. Blocks login.
router.patch('/:id/deactivate', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid member id' })
    return
  }
  const member = await get('SELECT id, name, email, role, status FROM members WHERE id = ?', [id])
  if (!member) {
    res.status(404).json({ error: 'Member not found' })
    return
  }
  await run('UPDATE members SET status = ? WHERE id = ?', ['Deactivated', id])
  // Sync the auth user (if any) so login is blocked
  await run('UPDATE users SET status = ? WHERE email = ?', ['Deactivated', member.email])
  await recordAudit({
    actor: req.user?.email,
    targetMemberId: id,
    targetEmail: member.email,
    action: 'deactivated',
    before: member.status,
    after: 'Deactivated',
  })
  res.json({ ...member, status: 'Deactivated' })
}))

// JL-192: Reactivate a previously deactivated member.
router.patch('/:id/reactivate', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid member id' })
    return
  }
  const member = await get('SELECT id, name, email, role, status FROM members WHERE id = ?', [id])
  if (!member) {
    res.status(404).json({ error: 'Member not found' })
    return
  }
  await run('UPDATE members SET status = ? WHERE id = ?', ['Active', id])
  await run('UPDATE users SET status = ? WHERE email = ?', ['Active', member.email])
  await recordAudit({
    actor: req.user?.email,
    targetMemberId: id,
    targetEmail: member.email,
    action: 'reactivated',
    before: member.status,
    after: 'Active',
  })
  res.json({ ...member, status: 'Active' })
}))

router.post('/:id/resend', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid member id' })
    return
  }

  const member = await get(
    'SELECT id, name, email, role, status, task_count, invited_by FROM members WHERE id = ?',
    [id],
  )
  if (!member) {
    res.status(404).json({ error: 'Member not found' })
    return
  }

  // Resend invitation email
  try {
    const { subject, html, text } = buildInviteEmail({
      recipientName: member.name,
      invitedBy: member.invited_by || 'Team Admin',
      role: member.role,
    })
    await sendMail({ to: member.email, subject, html, text })
  } catch (mailErr) {
    console.error('[Members] Failed to resend invite email:', mailErr.message)
  }

  res.json({ ok: true, member })
}))

router.patch('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid member id' })
    return
  }

  const role = String(req.body?.role || '').trim()
  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role. Allowed roles: ${VALID_ROLES.join(', ')}` })
    return
  }

  const member = await get(
    'SELECT id, name, email, role, status, task_count, invited_by, is_owner FROM members WHERE id = ?',
    [id],
  )
  if (!member) {
    res.status(404).json({ error: 'Member not found' })
    return
  }

  // The workspace Owner cannot be changed.
  if (member.is_owner) {
    res.status(403).json({ error: 'Cannot change the workspace Owner' })
    return
  }

  // Guard against demoting the last remaining admin (incl. self-lockout).
  const isDemotion = member.role === 'Admin' && role !== 'Admin' && role !== 'Owner'
  if (isDemotion && (await countAdmins()) <= 1) {
    const isSelf = req.user?.memberId === id
    res.status(403).json({
      error: isSelf
        ? 'You cannot demote yourself as the last remaining Admin'
        : 'Cannot demote the last remaining Admin',
    })
    return
  }

  await run('UPDATE members SET role = ? WHERE id = ?', [role, id])
  const updated = await get(
    'SELECT id, name, email, role, status, task_count, invited_by FROM members WHERE id = ?',
    [id],
  )

  await recordActivity(
    req.user?.email,
    `changed ${member.email} role from ${member.role} to ${role}`,
  )
  await recordAudit({
    actor: req.user?.email,
    targetMemberId: id,
    targetEmail: member.email,
    action: 'role_changed',
    before: member.role,
    after: role,
  })

  res.json(updated)
}))

// JL-207: bulk-delete members in one request. Applies the same guards as the
// single delete per id, skipping (not failing) any protected/missing id, and
// returns a { deleted, skipped } summary. Must be declared before '/:id' — it
// is a distinct POST path, but keep it grouped with the delete logic.
router.post('/bulk-delete', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n))) {
    res.status(400).json({ error: 'ids must be a non-empty array of integers' })
    return
  }

  const deleted = []
  const skipped = []
  const selfId = req.user?.memberId
  // Track the admin count across the batch so the last-admin guard stays correct
  // as admins are removed one by one (countAdmins() includes the Owner).
  let adminCount = await countAdmins()

  for (const id of ids) {
    const member = await get(
      'SELECT id, name, email, role, is_owner FROM members WHERE id = ?',
      [id],
    )
    if (!member) {
      skipped.push({ id, reason: 'not found' })
      continue
    }
    if (member.is_owner) {
      skipped.push({ id, reason: 'workspace Owner cannot be deleted' })
      continue
    }
    if (member.role === 'Admin' && adminCount <= 1) {
      skipped.push({
        id,
        reason: id === selfId
          ? 'cannot remove yourself as the last remaining Admin'
          : 'cannot delete the last remaining Admin',
      })
      continue
    }

    await run('DELETE FROM project_members WHERE member_id = ?', [id])
    await run('DELETE FROM members WHERE id = ?', [id])
    if (member.role === 'Admin') adminCount -= 1

    await recordActivity(req.user?.email, `removed member ${member.email}`)
    await recordAudit({
      actor: req.user?.email,
      targetMemberId: id,
      targetEmail: member.email,
      action: 'deleted',
      before: member.role,
    })
    deleted.push(id)
  }

  res.json({ deleted, skipped })
}))

router.delete('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid member id' })
    return
  }

  const member = await get(
    'SELECT id, name, email, role, is_owner FROM members WHERE id = ?',
    [id],
  )
  if (!member) {
    res.status(404).json({ error: 'Member not found' })
    return
  }

  // The workspace Owner cannot be removed.
  if (member.is_owner) {
    res.status(403).json({ error: 'Cannot delete the workspace Owner' })
    return
  }

  // Guard against removing the last remaining admin (incl. self-lockout).
  const isAdmin = member.role === 'Admin'
  if (isAdmin && (await countAdmins()) <= 1) {
    const isSelf = req.user?.memberId === id
    res.status(403).json({
      error: isSelf
        ? 'You cannot remove yourself as the last remaining Admin'
        : 'Cannot delete the last remaining Admin',
    })
    return
  }

  // Clean up project memberships, then remove the workspace member.
  await run('DELETE FROM project_members WHERE member_id = ?', [id])
  await run('DELETE FROM members WHERE id = ?', [id])

  await recordActivity(req.user?.email, `removed member ${member.email}`)
  await recordAudit({
    actor: req.user?.email,
    targetMemberId: id,
    targetEmail: member.email,
    action: 'deleted',
    before: member.role,
  })

  res.json({ ok: true, id })
}))

export default router
