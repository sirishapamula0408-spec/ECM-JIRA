import { Router } from 'express'
import { all, get, run, tableExists } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { sendMail, buildInviteEmail } from '../utils/mailer.js'
import { requireRole } from '../middleware/authorize.js'
import { isAllowedEmail, hashPassword } from '../middleware/validate.js'
import { parsePagination, isPaginationRequested } from '../utils/pagination.js'
import { blockSignup, unblockSignup } from '../services/signupPolicy.js'
// JL-329: the Add-member path used to write a `members` row with status
// 'Invited' and nothing else — no token, no expiry, no `invitations` row. It now
// issues a real invitation through the same service POST /api/invitations uses,
// so both entry points leave one identical trace with one lifecycle.
import { issueInvitation } from '../services/invitations.js'

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
 * JL-325 — actually revoke access when a member is removed.
 *
 * Deleting the `members` row on its own left two doors open:
 *   1. the `users` row survived with status 'Active', so the person could still
 *      log in — `loadUserRoles` just defaulted them to Viewer;
 *   2. nothing stopped them re-registering, since signup has no invite gate.
 *
 * So: deactivate the login (reusing the JL-192 status, which the login route
 * already refuses), drop any active sessions, and add the address to the
 * JL-325 deny-list. Each step is best-effort — bookkeeping must never fail the
 * delete that has already happened.
 *
 * NOTE: an already-issued JWT keeps working until it expires, because authGuard
 * verifies the token without re-reading user status. Tracked separately.
 */
async function revokeAccessFor(email, actorEmail) {
  if (!email) return
  try {
    await run('UPDATE users SET status = ? WHERE LOWER(email) = LOWER(?)', ['Deactivated', email])
  } catch (err) {
    console.error(`[members] Could not deactivate login for ${email}: ${err.message}`)
  }
  try {
    if (await tableExists('user_sessions')) {
      await run('DELETE FROM user_sessions WHERE LOWER(user_email) = LOWER(?)', [email])
    }
  } catch (err) {
    console.error(`[members] Could not clear sessions for ${email}: ${err.message}`)
  }
  await blockSignup(email, { reason: 'member removed', blockedBy: actorEmail || null })
}

/**
 * Records a workspace-membership action in the activity table when it exists.
 * Failures are swallowed so member management never breaks on a missing table.
 */
async function recordActivity(actor, action, workspaceId = null) {
  try {
    if (!(await tableExists('activity'))) return
    // JL-362: member events belong to a workspace but to no project, so they
    // carry workspace_id (project_id stays NULL). Without it the row was
    // unattributable and GET /api/activity showed every tenant's member
    // add/remove/role-change to every authenticated user.
    await run(
      'INSERT INTO activity (actor, action, happened_at, activity_type, workspace_id, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [actor || 'System', action, new Date().toISOString(), 'member', workspaceId ?? null],
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

// JL-417: task_count is DERIVED, not read from members.task_count.
// That column is written by five INSERT paths and updated by none of them, so
// the stored value was whatever the row was created with — 0 for every real
// user, and hardcoded demo numbers for the seed. The Teams page renders it as a
// SORTABLE column, which meant sorting on noise.
//
// issues.assignee is free text holding either a display name or an email (both
// occur in real data), so a member matches on either. A scalar subquery is used
// rather than a LEFT JOIN onto a grouped table: a member whose issues are
// assigned under BOTH their name and their email would match two grouped rows
// and be duplicated in the result.
const TASK_COUNT_SELECT = `(
      SELECT COUNT(*)::int FROM issues i
       WHERE i.assignee IS NOT NULL AND i.assignee <> ''
         AND (LOWER(i.assignee) = LOWER(m.name) OR LOWER(i.assignee) = LOWER(m.email))
    ) AS task_count`

// JL-281: server-side pagination + search/filtering for the members list.
//
// Backward compatibility: the historical response is a plain array of all
// members. Several callers (App.jsx bootstrap, TeamsPage, ActivityFeedPage)
// rely on that shape and call GET /api/members with no query params — they keep
// getting the plain array. The paginated envelope
//   { items, total, limit, offset }
// is returned only when the request explicitly asks for it, i.e. when any of
// the pagination params (limit/offset/page) or the filter params
// (search/role/status) are present.
router.get('/', asyncHandler(async (req, res) => {
  const { search, role, status } = req.query
  const paginated =
    isPaginationRequested(req.query) ||
    search !== undefined ||
    role !== undefined ||
    status !== undefined

  // Build the shared WHERE clause from the filter params.
  const clauses = []
  const params = []

  const term = String(search ?? '').trim()
  if (term) {
    clauses.push('(name ILIKE ? OR email ILIKE ?)')
    params.push(`%${term}%`, `%${term}%`)
  }
  const roleVal = String(role ?? '').trim()
  if (roleVal) {
    clauses.push('role = ?')
    params.push(roleVal)
  }
  const statusVal = String(status ?? '').trim()
  if (statusVal) {
    clauses.push('status = ?')
    params.push(statusVal)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

  // Legacy path: no pagination/filter params → return the full list as an array.
  if (!paginated) {
    const rows = await all(
      `SELECT m.id, m.name, m.email, m.role, m.status, ${TASK_COUNT_SELECT},
              m.invited_by, m.is_owner
         FROM members m
         ORDER BY m.id ASC`,
    )
    res.json(rows)
    return
  }

  const { limit, offset } = parsePagination(req.query, { defaultLimit: 25, maxLimit: 200 })
  const rows = await all(
    `SELECT m.id, m.name, m.email, m.role, m.status, ${TASK_COUNT_SELECT},
            m.invited_by, m.is_owner
       FROM members m ${where}
       ORDER BY m.id ASC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  const totalRow = await get(`SELECT COUNT(*)::int AS total FROM members m ${where}`, params)
  const total = Number(totalRow?.total || 0)

  res.json({ items: rows, total, limit, offset })
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

  // JL-325: re-adding someone who was previously removed is an explicit decision
  // to re-admit them, so it lifts their signup block — mirroring the same rule on
  // POST /api/invitations. Otherwise a removal could not be undone from the UI.
  const wasBlocked = await unblockSignup(normalizedEmail)
  if (wasBlocked) {
    console.log(`[members] Lifted signup block for ${normalizedEmail} (re-added by ${req.user?.email || 'unknown'})`)
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

  // JL-329 — the convergence. A member whose final status is 'Invited' is a
  // pending invite, so it gets a real `invitations` row: same token shape, same
  // 7-day expiry, same "one live token per address" revoke-prior rule, and
  // therefore the same JL-371 accept flow at the other end. Before this, this
  // route wrote no invitation at all, which is why an empty `invitations` table
  // proved nothing and why these people never appeared in the pending list.
  //
  // Skipped when a temporary password activated the account directly — that
  // person is Active with a login already, not pending.
  let invitation = null
  if (status === 'Invited') {
    invitation = await issueInvitation({
      email: normalizedEmail,
      role: normalizedRole,
      invitedBy: req.user?.email || inviter,
    })
  }

  await recordAudit({
    actor: req.user?.email,
    targetMemberId: row.id,
    targetEmail: normalizedEmail,
    action: createdLogin ? 'member_created' : 'member_invited',
    after: `${normalizedRole} / ${status}`,
  })

  // Send invitation email (skip when a temp password activated the account directly)
  // JL-323: sendMail resolves with { ok:false } on rejection instead of throwing,
  // so the try/catch alone never saw delivery failures and the endpoint reported
  // success unconditionally. Surface the outcome on the response instead.
  let emailStatus = createdLogin ? 'not_applicable' : 'unknown'
  let emailError = null
  if (!createdLogin) {
    try {
      // JL-329: carry the token, so the email from THIS path lands on the same
      // /accept-invite screen as the one from POST /api/invitations. Without it
      // the recipient got a bare app link and no way to redeem anything.
      const { subject, html, text } = buildInviteEmail({
        recipientName: normalizedName,
        invitedBy: inviter,
        role: normalizedRole,
        token: invitation?.token,
      })
      const result = await sendMail({
        to: normalizedEmail, subject, html, text,
        type: 'invite',
        relatedEntity: invitation ? `invitation:${invitation.id}` : `member:${row.id}`,
      })
      emailStatus = result.ok ? 'sent' : result.skipped ? 'skipped' : 'failed'
      emailError = result.ok ? null : result.error || 'SMTP not configured'
      if (!result.ok) {
        console.error(`[Members] Invite email to ${normalizedEmail} was not delivered (${emailError})`)
      }
    } catch (mailErr) {
      emailStatus = 'failed'
      emailError = mailErr.message
      console.error('[Members] Failed to send invite email:', mailErr.message)
    }
  }

  // JL-329: expose the invitation this created, so a caller can see that the two
  // entry points really do produce the same thing. Same shape POST
  // /api/invitations returns to the same Admin-only audience.
  res.status(201).json({
    ...row,
    email_status: emailStatus,
    email_error: emailError,
    invitation,
  })
}))

// JL-192: Deactivate a member (soft) — preserves authored data. Blocks login.
router.patch('/:id/deactivate', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid member id' })
    return
  }
  const member = await get('SELECT id, name, email, role, status, is_owner FROM members WHERE id = ?', [id])
  if (!member) {
    res.status(404).json({ error: 'Member not found' })
    return
  }
  // The workspace Owner cannot be deactivated (would lock them out of the workspace).
  if (member.is_owner) {
    res.status(403).json({ error: 'Cannot deactivate the workspace Owner' })
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

  // JL-329 — resend parity. This used to just re-send the same tokenless
  // courtesy email while POST /api/invitations/:id/resend re-issued a token and
  // a fresh expiry, so "resend" meant two different things depending on which
  // button had created the invite. It now re-issues through the same service, so
  // the observable result is identical either way: prior pending invites for the
  // address revoked, one fresh token, a new 7-day expiry, and an email carrying
  // that token.
  //
  // Gated on status the same way the invitations route gates on 'pending' — an
  // Active or Deactivated member has no pending invitation to resend, and minting
  // one would hand them a live signup authorisation under `invite_only` (JL-369).
  if (member.status !== 'Invited') {
    res.status(400).json({ error: 'Only pending invitations can be resent' })
    return
  }

  const invitation = await issueInvitation({
    email: member.email,
    role: member.role,
    invitedBy: req.user?.email || member.invited_by || 'Team Admin',
  })

  // Resend invitation email — JL-323: report the real delivery outcome rather
  // than always returning ok:true.
  let emailStatus = 'unknown'
  let emailError = null
  try {
    const { subject, html, text } = buildInviteEmail({
      recipientName: member.name,
      invitedBy: member.invited_by || 'Team Admin',
      role: member.role,
      token: invitation.token,
    })
    const result = await sendMail({
      to: member.email, subject, html, text,
      type: 'invite',
      relatedEntity: `invitation:${invitation.id}`,
    })
    emailStatus = result.ok ? 'sent' : result.skipped ? 'skipped' : 'failed'
    emailError = result.ok ? null : result.error || 'SMTP not configured'
    if (!result.ok) {
      console.error(`[Members] Resent invite email to ${member.email} was not delivered (${emailError})`)
    }
  } catch (mailErr) {
    emailStatus = 'failed'
    emailError = mailErr.message
    console.error('[Members] Failed to resend invite email:', mailErr.message)
  }

  res.json({
    ok: emailStatus === 'sent',
    member,
    invitation,
    email_status: emailStatus,
    email_error: emailError,
  })
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
  // JL-317: 'Owner' is tracked via the is_owner flag and must not be assignable
  // through the API (mirrors CREATABLE_ROLES on POST). Assigning role='Owner' to a
  // member with is_owner=false would rank them below Viewer and lock them out.
  if (role === 'Owner') {
    res.status(400).json({ error: 'The Owner role cannot be assigned' })
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
    req.workspaceId ?? null,
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

    // JL-325: revoke access properly — see the single-delete route below.
    await revokeAccessFor(member.email, req.user?.email)

    await recordActivity(req.user?.email, `removed member ${member.email}`, req.workspaceId ?? null)
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

  // JL-325: deleting the member row alone did NOT revoke access — the `users`
  // row survived with status 'Active', so the person could still log in (falling
  // back to Viewer), and could re-register freely because signup has no gate.
  await revokeAccessFor(member.email, req.user?.email)

  await recordActivity(req.user?.email, `removed member ${member.email}`, req.workspaceId ?? null)
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
