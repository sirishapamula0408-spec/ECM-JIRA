import crypto from 'node:crypto'

/**
 * Constant-time string/secret comparison (JL-184).
 *
 * Wraps `crypto.timingSafeEqual` so callers don't have to hand-roll the
 * length guard (timingSafeEqual THROWS on mismatched buffer lengths). Inputs
 * are coerced to UTF-8 buffers; a length mismatch short-circuits to `false`
 * without leaking timing via early return on the first differing byte.
 *
 * Use for bearer tokens / shared secrets where a plain `===` would be
 * timing-unsafe. Pure — unit-testable.
 *
 * @param {string|Buffer|null|undefined} a
 * @param {string|Buffer|null|undefined} b
 * @returns {boolean} true only when both are non-empty and byte-equal.
 */
export function safeEqual(a, b) {
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(String(a ?? ''), 'utf8')
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(String(b ?? ''), 'utf8')
  // Reject empty comparisons outright — an unset secret must never match.
  if (bufA.length === 0 || bufB.length === 0) return false
  // Length mismatch: timingSafeEqual would throw, so bail constant-false.
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export default safeEqual
