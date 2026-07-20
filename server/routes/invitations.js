import crypto from 'node:crypto'
import { Router } from 'express'
import { all, get, run, withTransaction } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { sendMail, buildInviteEmail } from '../utils/mailer.js'

const router = Router()

const VALID_ROLES = ['Admin', 'Member', 'Viewer']
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * JL-74 — Member invitations.
 * Mounted under `protect` (authGuard + loadUserRoles) at /api/invitations,
 * EXCEPT the token-lookup and accept endpoints which are usable pre-auth.
 */

// --- Create an invitation (Admin only) ---
router.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const role = String(req.body?.role || 'Member').trim()

  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'A valid email is required' })
    return
  }
  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` })
    return
  }

  // Don't re-invite someone who is already a member.
  const existingMember = await get('SELECT id FROM members WHERE LOWER(email) = LOWER(?)', [email])
  if (existingMember) {
    res.status(409).json({ error: 'That email is already a member' })
    return
  }

  // Revoke any prior pending invites for this email so only the latest is valid.
  await run("UPDATE invitations SET status = 'revoked' WHERE LOWER(email) = LOWER(?) AND status = 'pending'", [email])

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  const invitedBy = req.user?.email || 'Team Admin'

  const created = await run(
    'INSERT INTO invitations (email, role, token, invited_by, status, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [email, role, token, invitedBy, 'pending', expiresAt],
  )
  const invite = await get(
    'SELECT id, email, role, token, invited_by, status, created_at, expires_at FROM invitations WHERE id = ?',
    [created.lastID],
  )

  // Fire-and-forget invite email (never block the response on SMTP).
  const { subject, html, text } = buildInviteEmail({
    recipientName: email.split('@')[0],
    invitedBy,
    role,
  })
  sendMail({ to: email, subject, html, text }).catch((err) => {
    console.error(`[invitations] Failed to send invite email to ${email}: ${err.message}`)
  })

  res.status(201).json(invite)
}))

// --- List invitations (Admin only) ---
router.get('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const status = String(req.query?.status || '').trim()
  let rows
  if (status && ['pending', 'accepted', 'revoked'].includes(status)) {
    rows = await all(
      'SELECT id, email, role, invited_by, status, created_at, expires_at FROM invitations WHERE status = ? ORDER BY id DESC',
      [status],
    )
  } else {
    rows = await all(
      'SELECT id, email, role, invited_by, status, created_at, expires_at FROM invitations ORDER BY id DESC',
    )
  }
  // JL-251: expiry was previously only evaluated at accept-time, so expired
  // pending invites were indistinguishable from live ones. Surface an `expired`
  // flag per row so the client can badge them (and offer a resend).
  const now = Date.now()
  const decorated = rows.map((r) => ({
    ...r,
    expired: r.status === 'pending' && r.expires_at != null && new Date(r.expires_at).getTime() < now,
  }))
  res.json(decorated)
}))

// --- Resend a token invitation (Admin only) — JL-251 ---
// Re-issues a fresh token + expiry and re-sends the courtesy email. Reuses the
// create-time "auto-revoke prior pending for this email" logic so only the
// latest invite stays valid.
router.post('/:id/resend', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid invitation id' })
    return
  }

  const invite = await get('SELECT id, email, role, status FROM invitations WHERE id = ?', [id])
  if (!invite) {
    res.status(404).json({ error: 'Invitation not found' })
    return
  }
  if (invite.status !== 'pending') {
    res.status(400).json({ error: 'Only pending invitations can be resent' })
    return
  }

  // Revoke any prior pending invites for this email (including this one) so the
  // freshly-issued token is the only valid one — same guarantee as create.
  await run("UPDATE invitations SET status = 'revoked' WHERE LOWER(email) = LOWER(?) AND status = 'pending'", [invite.email])

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()
  const invitedBy = req.user?.email || 'Team Admin'

  const created = await run(
    'INSERT INTO invitations (email, role, token, invited_by, status, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [invite.email, invite.role, token, invitedBy, 'pending', expiresAt],
  )
  const fresh = await get(
    'SELECT id, email, role, token, invited_by, status, created_at, expires_at FROM invitations WHERE id = ?',
    [created.lastID],
  )

  // Fire-and-forget courtesy email (never block the response on SMTP).
  const { subject, html, text } = buildInviteEmail({
    recipientName: invite.email.split('@')[0],
    invitedBy,
    role: invite.role,
  })
  sendMail({ to: invite.email, subject, html, text }).catch((err) => {
    console.error(`[invitations] Failed to resend invite email to ${invite.email}: ${err.message}`)
  })

  res.json(fresh)
}))

// --- Public-ish lookup by token (used by the accept screen) ---
router.get('/:token', asyncHandler(async (req, res) => {
  const token = String(req.params.token || '').trim()
  const invite = await get(
    'SELECT id, email, role, status, created_at, expires_at FROM invitations WHERE token = ?',
    [token],
  )

  if (!invite) {
    res.status(404).json({ error: 'Invitation not found' })
    return
  }

  const expired = new Date(invite.expires_at) < new Date()
  const valid = invite.status === 'pending' && !expired

  res.json({
    email: invite.email,
    role: invite.role,
    status: invite.status,
    expiresAt: invite.expires_at,
    expired,
    valid,
  })
}))

// --- Accept an invitation → create/update the member row ---
router.post('/:token/accept', asyncHandler(async (req, res) => {
  const token = String(req.params.token || '').trim()
  const invite = await get(
    'SELECT id, email, role, status, expires_at FROM invitations WHERE token = ?',
    [token],
  )

  if (!invite) {
    res.status(404).json({ error: 'Invitation not found' })
    return
  }
  if (invite.status === 'revoked') {
    res.status(400).json({ error: 'This invitation has been revoked' })
    return
  }
  if (invite.status === 'accepted') {
    res.status(400).json({ error: 'This invitation has already been accepted' })
    return
  }
  if (new Date(invite.expires_at) < new Date()) {
    res.status(400).json({ error: 'This invitation has expired' })
    return
  }

  const name = String(req.body?.name || '').trim() || invite.email.split('@')[0]

  // JL-94: upserting the member and marking the invitation accepted must be
  // atomic — a partial failure could leave an accepted invite with no member,
  // or a member whose invite still looks pending.
  const member = await withTransaction(async (tx) => {
    // Create or update the member with the invited role.
    const existing = await tx.get('SELECT id FROM members WHERE LOWER(email) = LOWER(?)', [invite.email])
    let m
    if (existing) {
      await tx.run(
        "UPDATE members SET role = ?, status = 'Active' WHERE id = ?",
        [invite.role, existing.id],
      )
      m = await tx.get(
        'SELECT id, name, email, role, status FROM members WHERE id = ?',
        [existing.id],
      )
    } else {
      const created = await tx.run(
        'INSERT INTO members (name, email, role, status, task_count, invited_by, is_owner) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, invite.email, invite.role, 'Active', 0, 'Invitation', false],
      )
      m = await tx.get(
        'SELECT id, name, email, role, status FROM members WHERE id = ?',
        [created.lastID],
      )
    }

    await tx.run("UPDATE invitations SET status = 'accepted' WHERE id = ?", [invite.id])

    return m
  })

  res.json({ ok: true, member })
}))

// --- Revoke an invitation (Admin only) ---
router.delete('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid invitation id' })
    return
  }

  const invite = await get('SELECT id, status FROM invitations WHERE id = ?', [id])
  if (!invite) {
    res.status(404).json({ error: 'Invitation not found' })
    return
  }

  await run("UPDATE invitations SET status = 'revoked' WHERE id = ?", [id])
  res.json({ ok: true })
}))

export default router
