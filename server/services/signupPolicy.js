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
//        'invite_only' — registration requires a pending, unexpired invitation
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
    const invite = await get(
      `SELECT id FROM invitations
        WHERE LOWER(email) = LOWER(?) AND status = 'pending' AND expires_at > NOW()
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
