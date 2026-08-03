import { Router } from 'express'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import {
  listBlockedSignups,
  blockSignup,
  unblockSignup,
  isSignupBlocked,
} from '../services/signupPolicy.js'
import { isAllowedEmail } from '../middleware/validate.js'

/*
 * JL-325 — Blocked signups (offboarding deny-list), Admin only.
 *
 * Removing a member adds their address here automatically; these endpoints make
 * the list visible and reversible without direct database access, which is the
 * ticket's third acceptance criterion. Re-inviting or re-adding an address also
 * lifts its block (see invitations.js / members.js) — this router is for the
 * cases where an admin wants to inspect or amend the list directly.
 */

const router = Router()

// GET /api/blocked-signups — list the deny-list, newest first.
router.get('/blocked-signups', requireRole('Admin'), asyncHandler(async (_req, res) => {
  const rows = await listBlockedSignups()
  res.json(rows)
}))

// POST /api/blocked-signups — block an address manually.
router.post('/blocked-signups', requireRole('Admin'), asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'A valid email is required' })
    return
  }
  if (!isAllowedEmail(email)) {
    res.status(400).json({ error: 'Use a valid office email or Gmail address' })
    return
  }
  if (await isSignupBlocked(email)) {
    res.status(409).json({ error: 'That email is already blocked' })
    return
  }

  await blockSignup(email, {
    reason: String(req.body?.reason || '').trim() || 'blocked by admin',
    blockedBy: req.user?.email || null,
  })
  res.status(201).json({ email, blocked: true })
}))

// DELETE /api/blocked-signups/:email — lift a block (re-admit the address).
router.delete('/blocked-signups/:email', requireRole('Admin'), asyncHandler(async (req, res) => {
  const email = String(req.params.email || '').trim().toLowerCase()
  const removed = await unblockSignup(email)
  if (!removed) {
    res.status(404).json({ error: 'That email is not blocked' })
    return
  }
  res.json({ email, blocked: false })
}))

export default router
