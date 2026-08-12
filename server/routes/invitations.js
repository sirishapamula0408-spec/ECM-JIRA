import { Router } from 'express'
import { all, get, run, withTransaction } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { sendMail, buildInviteEmail, getLatestEmailStatuses } from '../utils/mailer.js'
import { unblockSignup, checkSignupAllowed } from '../services/signupPolicy.js'
// JL-371: accepting an invitation now provisions the login, so it needs the same
// password machinery the register path uses — hashing, org policy validation,
// and JWT minting — rather than a second, weaker copy of any of it.
import { hashPassword } from '../middleware/validate.js'
import { validatePassword } from '../services/passwordPolicy.js'
import { getSecurityPolicy } from './securityPolicy.js'
import { issueToken } from '../utils/authToken.js'
import { safeAppendAudit } from '../services/auditLog.js'
// JL-329: issuing a pending invitation now lives in one service, shared with
// POST /api/members, so both entry points write the same row with the same
// token, the same 7-day TTL and the same "one live token per address" rule.
import { issueInvitation, listPendingInvitations, INVITE_LIST_COLUMNS } from '../services/invitations.js'

const router = Router()

const VALID_ROLES = ['Admin', 'Member', 'Viewer']

/**
 * JL-74 — Member invitations.
 * Mounted under `protect` (authGuard + loadUserRoles) at /api/invitations,
 * EXCEPT the token-lookup and accept endpoints which are usable pre-auth.
 *
 * JL-371: those two now live on the exported `publicRouter` below, which
 * server/index.js mounts ahead of `protect`. The "pre-auth" claim above was
 * previously aspirational — the whole module sat behind authGuard, so an invitee
 * following the emailed link got a 401.
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

  // JL-325: inviting someone who was previously removed is an explicit decision
  // to re-admit them, so it lifts the signup block. Without this, a removal
  // would be irreversible through the UI.
  const wasBlocked = await unblockSignup(email)
  if (wasBlocked) {
    console.log(`[invitations] Lifted signup block for ${email} (re-invited by ${req.user?.email || 'unknown'})`)
  }

  const invitedBy = req.user?.email || 'Team Admin'
  // JL-329: issueInvitation revokes any prior pending invite for this address
  // and writes the tokened row — the same call the members path makes.
  const invite = await issueInvitation({ email, role, invitedBy })

  // Fire-and-forget invite email (never block the response on SMTP).
  // JL-361: pass the freshly-stored token so the email carries a working
  // /accept-invite link. Without it the token flow below (GET /:token and
  // POST /:token/accept) could never be reached from the invitation email.
  const { subject, html, text } = buildInviteEmail({
    recipientName: email.split('@')[0],
    invitedBy,
    role,
    token: invite.token,
  })
  // JL-323: sendMail resolves with { ok:false } on an SMTP rejection rather than
  // rejecting, so the outcome must be read off the result — a bare .catch() here
  // was dead code and let failures pass as successes.
  sendMail({ to: email, subject, html, text, type: 'invite', relatedEntity: `invitation:${invite.id}` })
    .then((result) => {
      if (!result.ok) {
        console.error(
          `[invitations] Invite email to ${email} was not delivered (${result.skipped ? 'SMTP not configured' : result.error})`,
        )
      }
    })
    .catch((err) => {
      console.error(`[invitations] Unexpected mailer error for ${email}: ${err.message}`)
    })

  res.status(201).json(invite)
}))

// --- List invitations (Admin only) ---
//
// JL-329: `?status=pending` is THE canonical answer to "who has a pending
// invitation?". It used to be a partial answer — anyone added through
// POST /api/members was pending but had no row here, so this list silently
// omitted them. Both entry points now write an `invitations` row (and the
// boot-time reconciliation adopted the pre-existing ones), so this single query
// over this single table is complete. It delegates to
// services/invitations.js#listPendingInvitations so the predicate is defined in
// exactly one place.
router.get('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const status = String(req.query?.status || '').trim()
  let rows
  if (status === 'pending') {
    rows = await listPendingInvitations()
  } else if (status && ['accepted', 'revoked'].includes(status)) {
    rows = await all(
      `SELECT ${INVITE_LIST_COLUMNS} FROM invitations WHERE status = ? ORDER BY id DESC`,
      [status],
    )
  } else {
    rows = await all(
      `SELECT ${INVITE_LIST_COLUMNS} FROM invitations ORDER BY id DESC`,
    )
  }
  // JL-251: expiry was previously only evaluated at accept-time, so expired
  // pending invites were indistinguishable from live ones. Surface an `expired`
  // flag per row so the client can badge them (and offer a resend).
  const now = Date.now()
  // JL-323: attach the most recent delivery attempt per address so the UI can
  // distinguish "invited" from "invite email never actually arrived".
  const statuses = await getLatestEmailStatuses(rows.map((r) => r.email))
  const decorated = rows.map((r) => {
    const delivery = statuses.get(String(r.email || '').toLowerCase())
    return {
      ...r,
      expired: r.status === 'pending' && r.expires_at != null && new Date(r.expires_at).getTime() < now,
      email_status: delivery?.status || 'unknown',
      email_error: delivery?.error || null,
      email_sent_at: delivery?.created_at || null,
    }
  })
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

  const invitedBy = req.user?.email || 'Team Admin'
  // Revokes any prior pending invites for this email (including this one) so the
  // freshly-issued token is the only valid one — same guarantee as create, and
  // now the same call POST /api/members/:id/resend makes (JL-329).
  const fresh = await issueInvitation({ email: invite.email, role: invite.role, invitedBy })

  // Fire-and-forget courtesy email (never block the response on SMTP).
  // JL-361: resend deliberately mints a NEW token and revokes the previous one
  // (JL-251), so the email must carry the token of the row just inserted — the
  // old token is no longer valid.
  const { subject, html, text } = buildInviteEmail({
    recipientName: invite.email.split('@')[0],
    invitedBy,
    role: invite.role,
    token: fresh.token,
  })
  // JL-323: read the result flag; see the note on the create route above.
  sendMail({ to: invite.email, subject, html, text, type: 'invite', relatedEntity: `invitation:${fresh.id}` })
    .then((result) => {
      if (!result.ok) {
        console.error(
          `[invitations] Resent invite email to ${invite.email} was not delivered (${result.skipped ? 'SMTP not configured' : result.error})`,
        )
      }
    })
    .catch((err) => {
      console.error(`[invitations] Unexpected mailer error for ${invite.email}: ${err.message}`)
    })

  res.json(fresh)
}))

/**
 * The two endpoints an invitee can reach.
 *
 * JL-371: these live on their own router so server/index.js can mount them
 * AHEAD of the `protect` block. The docblock at the top of this file has always
 * described them as pre-auth, but /api/invitations was mounted wholesale behind
 * authGuard — so a signed-out invitee following the emailed link got a bare 401,
 * and neither the JL-361 accept screen nor the account provisioning below could
 * ever run for the one person they exist for. Requiring a session to redeem an
 * invitation is circular by definition: a session is what redeeming it produces.
 *
 * They are also mounted into the main router below, so the whole surface stays
 * reachable through the single protected mount as before.
 */
export const publicRouter = Router()

// --- Public lookup by token (used by the accept screen) ---
publicRouter.get('/:token', asyncHandler(async (req, res) => {
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

// --- Accept an invitation → provision the login + create/update the member row ---
//
// JL-371: accepting used to upsert a `members` row and nothing else. That granted
// the invitee a role while leaving them with no `users` row, no password and no
// session — an invite was a half-step, and the person it was addressed to still
// could not sign in. Accepting now creates the account too, with the invitee
// choosing their own password (an emailed link cannot carry a usable one, and
// minting one server-side then emailing it would be strictly worse).
//
// The password is OPTIONAL on the wire. Sending one is the whole point of the
// ticket and the SPA always does, but the no-password shape is the pre-JL-371
// contract — role grant only, invitee finishes at /signup — and JL-369 depends on
// it staying reachable (an invitation that has been accepted without a password
// still authorises signup under `invite_only`). Keeping both means this change
// adds an ending to the flow instead of breaking the existing one.
publicRouter.post('/:token/accept', asyncHandler(async (req, res) => {
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
  const password = String(req.body?.password || '')

  // --- JL-371: pre-flight the account creation before touching anything ---
  // All of these run BEFORE the transaction so a rejected password never marks
  // the invitation accepted — the link has to stay usable for a second try.
  if (password) {
    // The signup gate applies here too, because this IS a registration. Without
    // it, accept-with-password would be a way around the JL-325 deny-list: an
    // admin removes someone (blocking their address) while an invitation issued
    // earlier is still pending, and they could provision an account anyway.
    // Under `invite_only` (JL-369) the invitee holds the very invitation being
    // redeemed, so this gate passes for exactly the people it should.
    const signupCheck = await checkSignupAllowed(invite.email)
    if (!signupCheck.allowed) {
      res.status(signupCheck.status).json({ error: signupCheck.error })
      return
    }

    // Same two-stage check as POST /api/auth/signup: the hard floor first, then
    // the org policy. validatePassword is NOT bypassed or re-implemented here.
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' })
      return
    }
    const policy = await getSecurityPolicy()
    const pwCheck = validatePassword(password, policy)
    if (!pwCheck.ok) {
      res.status(400).json({ error: pwCheck.errors[0], errors: pwCheck.errors })
      return
    }
  }

  // JL-94: upserting the member and marking the invitation accepted must be
  // atomic — a partial failure could leave an accepted invite with no member,
  // or a member whose invite still looks pending.
  // JL-371 extends the same transaction over the `users` row, so an account can
  // never exist for an invitation that still reads as pending, or vice versa.
  const { member, user, accountExisted } = await withTransaction(async (tx) => {
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

    let u = null
    let existedAlready = false
    if (password) {
      // JL-371 — collision policy: if a `users` row already exists for this
      // address we LINK it (grant the role, mark the invite accepted) and leave
      // its password_hash completely alone. We do not reject, and we do not
      // overwrite.
      //
      // Not overwrite, because an invitation token only proves control of a
      // mailbox at some point in the last 7 days — it is not proof of the
      // existing account's password. Letting it set one would turn "invite an
      // address" into an account-takeover primitive: any workspace Admin could
      // invite a colleague's address and walk into their session. Password
      // changes have their own authenticated paths (change-password) and their
      // own short-lived, single-use tokens (reset-password); an invite must not
      // become a third, weaker one.
      //
      // Not reject, because re-inviting an existing user to change their role is
      // a legitimate flow the members upsert above already supports, and failing
      // the whole accept would strand the role grant with it. The response says
      // plainly that the submitted password was not applied, so nothing is
      // silent about it.
      const existingUser = await tx.get(
        'SELECT id, email, created_at FROM users WHERE LOWER(email) = LOWER(?)',
        [invite.email],
      )
      if (existingUser) {
        u = { id: existingUser.id, email: existingUser.email, created_at: existingUser.created_at }
        existedAlready = true
      } else {
        // `password_changed_at = NOW()` is written exactly as signup / reset /
        // change-password write it, so JL-351's rotation policy can evaluate an
        // invited account instead of treating it as a legacy row with no date.
        const createdUser = await tx.run(
          'INSERT INTO users (email, password_hash, password_changed_at) VALUES (?, ?, NOW())',
          [invite.email, hashPassword(password)],
        )
        u = await tx.get('SELECT id, email, created_at FROM users WHERE id = ?', [createdUser.lastID])
      }
    }

    await tx.run("UPDATE invitations SET status = 'accepted' WHERE id = ?", [invite.id])

    return { member: m, user: u, accountExisted: existedAlready }
  })

  const body = { ok: true, member }

  if (!password) {
    // Pre-JL-371 shape: role granted, no login. Say so explicitly so a caller
    // can tell this apart from a provisioned account.
    body.accountCreated = false
    body.needsSignup = true
    res.json(body)
    return
  }

  body.user = user
  body.accountCreated = !accountExisted
  body.accountExisted = accountExisted

  if (accountExisted) {
    body.message = 'An account already exists for this email. Your role has been applied — sign in with your existing password.'
    // Deliberately no token: we have not authenticated anyone here. Holding the
    // invite link is not proof of that account's password.
    res.json(body)
    return
  }

  // JL-371 — auto-login vs. redirect: we issue a token, matching how the
  // codebase already treats a freshly-registered user (POST /api/auth/signup
  // returns { user, token } and the SPA signs them straight in). This accept
  // *is* a registration — same validation, same hash, same password_changed_at —
  // so bouncing the invitee to a login screen to retype the password they just
  // chose would reintroduce exactly the extra step this ticket removes. The
  // token is scoped like signup's (7d) rather than login's remember-me choice.
  body.token = issueToken(user, '7d')

  // Mirror the account creation into the tamper-evident audit log, as signup does.
  safeAppendAudit({
    actor: invite.email,
    action: 'auth.signup',
    target: invite.email,
    metadata: { userId: user?.id, via: 'invitation', invitationId: invite.id },
  })

  res.json(body)
}))

// Keep the pre-auth endpoints on the main router too, so mounting this module
// alone (as every existing test app and the protected mount in index.js do)
// still exposes the complete /api/invitations surface.
router.use(publicRouter)

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
