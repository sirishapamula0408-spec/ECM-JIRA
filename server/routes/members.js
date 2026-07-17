import { Router } from 'express'
import { all, get, run, tableExists } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { sendMail, buildInviteEmail } from '../utils/mailer.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

// Allowed workspace role values for role updates.
const VALID_ROLES = ['Owner', 'Admin', 'Member', 'Viewer']

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

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, name, email, role, status, task_count, invited_by FROM members ORDER BY id ASC',
  )
  res.json(rows)
}))

router.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, email, role, invited_by } = req.body
  const normalizedName = String(name || '').trim()
  const normalizedEmail = String(email || '').trim()
  const normalizedRole = String(role || 'Viewer').trim()
  const inviter = String(invited_by || '').trim() || 'Team Admin'

  if (!normalizedName || !normalizedEmail) {
    res.status(400).json({ error: 'name and email are required' })
    return
  }

  const created = await run(
    'INSERT INTO members (name, email, role, status, task_count, invited_by) VALUES (?, ?, ?, ?, ?, ?)',
    [normalizedName, normalizedEmail, normalizedRole, 'Invited', 0, inviter],
  )
  const row = await get(
    'SELECT id, name, email, role, status, task_count, invited_by FROM members WHERE id = ?',
    [created.lastID],
  )

  // Send invitation email
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

  res.status(201).json(row)
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

  res.json(updated)
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

  res.json({ ok: true, id })
}))

export default router
