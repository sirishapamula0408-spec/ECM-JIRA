// JL-179 — small, pure, dependency-free validation helpers shared across the
// ~40 route modules. These codify the three checks that were being re-inlined
// everywhere: required-field presence, enum / allow-list membership, and a
// permissive email-shape test. Keeping them here (a) removes drift between
// copies and (b) makes each rule trivially unit-testable.
//
// Every helper is pure (no db, no req/res) so route validators can compose them
// while still returning their own domain-specific error strings/ordering.

// Permissive email shape — good enough to reject obviously malformed addresses
// without pulling in a dependency. Matches the historical per-route regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * True when `value` counts as "present" for a required field. A value is
 * considered missing when it is `undefined`/`null`, or a string that is empty
 * after trimming (mirrors the `typeof x === 'string' ? x.trim() : ''; if (!x)`
 * idiom the routes used). Numbers/booleans (including `0`/`false`) are present.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isPresent(value) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

/**
 * Validate that each named field is present on `body`.
 *
 * @param {object} body      the request body (defaults to {})
 * @param {string[]} fields  required field names, checked in order
 * @returns {{ ok: boolean, errors: string[] }} errors are `"<field> is required"`
 */
export function requireFields(body = {}, fields = []) {
  const b = body || {}
  const errors = []
  for (const field of fields) {
    if (!isPresent(b[field])) errors.push(`${field} is required`)
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Allow-list / enum membership check.
 *
 * @param {*} value        the candidate value
 * @param {Array<*>} allowed  the permitted values
 * @returns {boolean} true when `value` is one of `allowed`
 */
export function oneOf(value, allowed) {
  return Array.isArray(allowed) && allowed.includes(value)
}

/**
 * Permissive email-shape check. Does not trim — callers that accept surrounding
 * whitespace should trim before calling (matching prior route behavior).
 *
 * @param {*} str
 * @returns {boolean}
 */
export function isEmail(str) {
  return typeof str === 'string' && EMAIL_RE.test(str)
}

/* ================================================================
   JL-204 — server-side length caps for user-facing text fields.
   Named constants keep the limits consistent across the routes
   (issues.js / projects.js / sprints.js). Values are checked AFTER
   trimming, so surrounding whitespace never pushes a value over cap.
   ================================================================ */
export const ISSUE_TITLE_MAX = 255
export const ISSUE_DESCRIPTION_MAX = 20000
export const PROJECT_NAME_MAX = 120
export const PROJECT_KEY_MAX = 10
export const SPRINT_NAME_MAX = 120
export const SPRINT_GOAL_MAX = 1000

/**
 * JL-204 — build a 400-ready error message when a string exceeds its cap.
 * Pure helper: returns `null` when the value is within the limit (or not a
 * string), otherwise a message naming the field and the limit. Callers chain
 * these with `||` and return the first non-null message with HTTP 400.
 *
 * @param {string} field  user-facing field name for the error message
 * @param {*} value       the (already-trimmed) candidate value
 * @param {number} max    maximum allowed length in characters
 * @returns {string|null}
 */
export function maxLengthError(field, value, max) {
  if (typeof value === 'string' && value.length > max) {
    return `${field} must be at most ${max} characters`
  }
  return null
}

export default { isPresent, requireFields, oneOf, isEmail, maxLengthError }
