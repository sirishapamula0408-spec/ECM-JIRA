// JL-134: Org-wide password policy helpers.
//
// Pure, dependency-free functions so they are trivially unit-testable and can be
// reused by the auth (register) and profile (password-change) routes.

// Defaults mirror the permissive DB defaults (see security_policy migration in
// db.js). Kept in sync so callers can pass a partial/undefined policy safely.
export const DEFAULT_POLICY = Object.freeze({
  require_mfa: false,
  min_password_length: 8,
  require_uppercase: false,
  require_number: false,
  require_symbol: false,
  password_max_age_days: 0,
})

// Normalize an arbitrary (possibly partial, possibly DB-shaped) policy object
// into a fully-populated policy with correct types.
export function normalizePolicy(policy = {}) {
  const p = policy || {}
  return {
    require_mfa: Boolean(p.require_mfa),
    min_password_length:
      Number.isFinite(Number(p.min_password_length)) && Number(p.min_password_length) > 0
        ? Math.floor(Number(p.min_password_length))
        : DEFAULT_POLICY.min_password_length,
    require_uppercase: Boolean(p.require_uppercase),
    require_number: Boolean(p.require_number),
    require_symbol: Boolean(p.require_symbol),
    password_max_age_days:
      Number.isFinite(Number(p.password_max_age_days)) && Number(p.password_max_age_days) >= 0
        ? Math.floor(Number(p.password_max_age_days))
        : DEFAULT_POLICY.password_max_age_days,
  }
}

/**
 * Validate a password against a policy.
 * Pure. Returns { ok: boolean, errors: string[] }.
 */
export function validatePassword(password, policy = DEFAULT_POLICY) {
  const p = normalizePolicy(policy)
  const pw = String(password == null ? '' : password)
  const errors = []

  if (pw.length < p.min_password_length) {
    errors.push(`Password must be at least ${p.min_password_length} characters`)
  }
  if (p.require_uppercase && !/[A-Z]/.test(pw)) {
    errors.push('Password must contain at least one uppercase letter')
  }
  if (p.require_number && !/[0-9]/.test(pw)) {
    errors.push('Password must contain at least one number')
  }
  if (p.require_symbol && !/[^A-Za-z0-9]/.test(pw)) {
    errors.push('Password must contain at least one symbol')
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Is a password expired under the rotation policy?
 * Pure. Returns boolean.
 *
 * - Rotation disabled (password_max_age_days <= 0) → always false.
 * - Missing passwordChangedAt with rotation enabled → treated as expired (true),
 *   so legacy accounts are prompted to rotate once a policy is set.
 */
export function isPasswordExpired(passwordChangedAt, policy = DEFAULT_POLICY, now = new Date()) {
  const p = normalizePolicy(policy)
  if (!p.password_max_age_days || p.password_max_age_days <= 0) return false

  if (!passwordChangedAt) return true

  const changed = passwordChangedAt instanceof Date ? passwordChangedAt : new Date(passwordChangedAt)
  if (Number.isNaN(changed.getTime())) return true

  const nowDate = now instanceof Date ? now : new Date(now)
  const ageMs = nowDate.getTime() - changed.getTime()
  const maxAgeMs = p.password_max_age_days * 24 * 60 * 60 * 1000
  return ageMs > maxAgeMs
}
