// JL-325 — Signup gating.
//
// Two independent controls, both enforced server-side in POST /api/auth/signup:
//
//   1. The blocked-signup deny-list. Removing a member records their address
//      here, so "delete the user" actually revokes access instead of being a
//      formality they can undo by registering again. Applies under EVERY policy.
//
//   2. The `signup_policy` workspace setting:
//        'open'        — anyone with a valid office/Gmail address may register
//                        (the historical behaviour, and still the default so
//                        enabling this feature does not lock a team out)
//        'invite_only' — registration requires an unexpired invitation that is
//                        still pending, or that has already been accepted via
//                        the emailed link but not yet turned into an account
//                        (JL-369 — accept does not create the login)
//
// Both are deliberately checked in the route rather than in middleware, so the
// error messages can be specific and the ordering (block before policy) is
// explicit.

import { get, run, all, getSetting, setSetting } from '../db.js'

export const SIGNUP_POLICY_KEY = 'signup_policy'
export const SIGNUP_POLICIES = ['open', 'invite_only']
export const DEFAULT_SIGNUP_POLICY = 'open'

/** Resolve the effective signup policy, falling back to the default. */
export async function getSignupPolicy() {
  const value = await getSetting(SIGNUP_POLICY_KEY, DEFAULT_SIGNUP_POLICY)
  return SIGNUP_POLICIES.includes(value) ? value : DEFAULT_SIGNUP_POLICY
}

export async function setSignupPolicy(value) {
  if (!SIGNUP_POLICIES.includes(value)) {
    throw new Error(`signup_policy must be one of: ${SIGNUP_POLICIES.join(', ')}`)
  }
  await setSetting(SIGNUP_POLICY_KEY, value)
  return value
}

function normalize(email) {
  return String(email || '').trim().toLowerCase()
}

/** Is this address on the deny-list? */
export async function isSignupBlocked(email) {
  const normalized = normalize(email)
  if (!normalized) return false
  const row = await get(
    'SELECT id FROM blocked_signups WHERE LOWER(email) = LOWER(?)',
    [normalized],
  )
  return Boolean(row)
}

/**
 * Add an address to the deny-list. Idempotent — re-blocking an already-blocked
 * address is a no-op rather than a unique-violation, so bulk deletes never fail
 * partway through.
 */
export async function blockSignup(email, { reason = null, blockedBy = null } = {}) {
  const normalized = normalize(email)
  if (!normalized) return false
  try {
    await run(
      `INSERT INTO blocked_signups (email, reason, blocked_by)
       VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [normalized, reason, blockedBy],
    )
    return true
  } catch (err) {
    // Never let deny-list bookkeeping fail the delete that triggered it.
    console.error(`[signupPolicy] Could not block ${normalized}: ${err.message}`)
    return false
  }
}

/** Remove an address from the deny-list (re-admitting that person). */
export async function unblockSignup(email) {
  const normalized = normalize(email)
  if (!normalized) return false
  const result = await run(
    'DELETE FROM blocked_signups WHERE LOWER(email) = LOWER(?)',
    [normalized],
  )
  return Number(result?.changes || 0) > 0
}

/** List the deny-list, newest first. */
export async function listBlockedSignups() {
  return all(
    'SELECT id, email, reason, blocked_by, created_at FROM blocked_signups ORDER BY id DESC',
  )
}

/**
 * Decide whether `email` may register right now.
 * Returns { allowed: true } or { allowed: false, status, error }.
 */
export async function checkSignupAllowed(email) {
  const normalized = normalize(email)

  // The deny-list wins over any policy — this is the offboarding guarantee.
  if (await isSignupBlocked(normalized)) {
    return {
      allowed: false,
      status: 403,
      error: 'This email address is not permitted to register. Contact your workspace admin.',
    }
  }

  const policy = await getSignupPolicy()
  if (policy === 'invite_only') {
    // JL-369: accept both 'pending' AND 'accepted' invitations here.
    //
    // POST /api/invitations/:token/accept marks the invitation 'accepted' and
    // upserts the `members` row, but it creates no `users` row and no password
    // — the invitee must still complete signup. Gating on 'pending' alone
    // therefore refused the very person the link existed to authorise: click
    // the emailed link, then get 403 at signup. (Latent in production only
    // because the default policy is 'open'.)
    //
    // The window is bounded by the invitation's own `expires_at`, which accept
    // does not extend: an acceptance authorises signup for the remainder of the
    // original 7-day invite TTL and no longer. A stale acceptance — someone who
    // redeemed a link a year ago and has since been removed — is long past
    // expires_at and re-authorises nothing.
    //
    // 'revoked' is excluded in every state, so an admin revoking after the
    // acceptance still closes the door. And the blocked_signups deny-list is
    // checked ABOVE this block, under every policy, so a removed member is
    // refused even while their accepted invitation is still fresh.
    //
    // Single use is preserved by the account itself: once signup creates the
    // `users` row, a second attempt is a 409 'already registered'.
    const invite = await get(
      `SELECT id FROM invitations
        WHERE LOWER(email) = LOWER(?)
          AND (status = 'pending' OR status = 'accepted')
          AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1`,
      [normalized],
    )
    if (!invite) {
      return {
        allowed: false,
        status: 403,
        error: 'Registration is by invitation only. Ask your workspace admin for an invite.',
      }
    }
  }

  return { allowed: true }
}
