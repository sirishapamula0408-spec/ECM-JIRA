import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { sendMail, buildInviteEmail } from '../utils/mailer.js'
import { requireRole } from '../middleware/authorize.js'
import { isAllowedEmail, hashPassword } from '../middleware/validate.js'

const router = Router()

// JL-192: allowed member/user account statuses
const MEMBER_STATUSES = ['Active', 'Invited', 'Deactivated']

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

export default router
