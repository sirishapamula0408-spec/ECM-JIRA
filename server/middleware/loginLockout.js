// JL-93: In-house, dependency-free brute-force login lockout.
//
// Tracks failed authentication attempts per identifier (typically email + client
// IP). After `maxAttempts` failures inside `windowMs`, the identifier is locked
// for `lockoutMs`. All helpers accept an injectable clock so they are fully
// unit-testable without real timers. State is in-memory, per-process.
//
// Wire-up (see server/routes/auth.js):
//   1. Before verifying credentials: if isLocked(key) → 429 + Retry-After.
//   2. On invalid credentials:       recordFailure(key).
//   3. On successful login:          reset(key).

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_WINDOW_MS = 15 * 60 * 1000 // failures counted within 15 minutes
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000 // cooldown once locked

/**
 * Create an isolated lockout tracker. Each instance owns its own state Map,
 * which lets tests (and separate concerns) avoid cross-contamination.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts] Failures before locking.
 * @param {number} [opts.windowMs]    Sliding window for counting failures.
 * @param {number} [opts.lockoutMs]   Cooldown duration once locked.
 * @param {Function} [opts.now]       () => epoch ms. Injectable clock.
 */
export function createLoginLockout({
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  windowMs = DEFAULT_WINDOW_MS,
  lockoutMs = DEFAULT_LOCKOUT_MS,
  now = Date.now,
} = {}) {
  /** @type {Map<string, { failures: number[], lockedUntil: number }>} */
  const store = new Map()

  function entryFor(key) {
    let entry = store.get(key)
    if (!entry) {
      entry = { failures: [], lockedUntil: 0 }
      store.set(key, entry)
    }
    return entry
  }

  /**
   * Record a failed attempt for `key`. Locks the key when the number of failures
   * within the sliding window reaches `maxAttempts`. Returns the current lock state.
   */
  function recordFailure(key, current = now()) {
    const entry = entryFor(key)
    // Drop failures older than the window before counting.
    entry.failures = entry.failures.filter((t) => t > current - windowMs)
    entry.failures.push(current)
    if (entry.failures.length >= maxAttempts) {
      entry.lockedUntil = current + lockoutMs
    }
    return { locked: entry.lockedUntil > current, failures: entry.failures.length }
  }

  /** Is `key` currently locked? Lazily clears an expired lock. */
  function isLocked(key, current = now()) {
    const entry = store.get(key)
    if (!entry) return false
    if (entry.lockedUntil > current) return true
    // Lock expired: clear it (and stale failures) so the caller starts fresh.
    if (entry.lockedUntil && entry.lockedUntil <= current) {
      store.delete(key)
    }
    return false
  }

  /** Seconds until `key` unlocks, or 0 if not locked. */
  function retryAfter(key, current = now()) {
    const entry = store.get(key)
    if (!entry || entry.lockedUntil <= current) return 0
    return Math.max(1, Math.ceil((entry.lockedUntil - current) / 1000))
  }

  /** Clear all state for `key` (call on a successful login). */
  function reset(key) {
    store.delete(key)
  }

  /** Clear the entire store (test/ops affordance). */
  function clear() {
    store.clear()
  }

  return {
    recordFailure,
    isLocked,
    retryAfter,
    reset,
    clear,
    store,
    config: { maxAttempts, windowMs, lockoutMs },
  }
}

// Shared default instance used by the login route, tuned via env with safe
// defaults. Reads process.env directly (rather than importing config.js) so
// suites that mock config.js are unaffected by this middleware.
export const loginLockout = createLoginLockout({
  maxAttempts: Number(process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS) || DEFAULT_MAX_ATTEMPTS,
  windowMs: Number(process.env.LOGIN_LOCKOUT_WINDOW_MS) || DEFAULT_WINDOW_MS,
  lockoutMs: Number(process.env.LOGIN_LOCKOUT_MS) || DEFAULT_LOCKOUT_MS,
})

export default loginLockout
