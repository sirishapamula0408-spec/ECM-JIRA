import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { sendMail, buildInviteEmail } from '../utils/mailer.js'

const router = Router()

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, name, email, role, status, task_count, invited_by FROM members ORDER BY id ASC',
  )
  res.json(rows)
}))

router.post('/', asyncHandler(async (req, res) => {
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

router.post('/:id/resend', asyncHandler(async (req, res) => {
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
