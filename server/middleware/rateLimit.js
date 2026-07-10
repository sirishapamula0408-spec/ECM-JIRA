// JL-93: In-house, dependency-free request rate limiting.
//
// A small factory that returns Express middleware backed by an in-memory Map of
// fixed-window buckets. When a key exceeds `max` requests inside `windowMs`, the
// middleware responds `429 Too Many Requests` with a `Retry-After` header.
//
// Design notes:
//  - No external store and no external deps (std lib only) — intentionally simple.
//    In-memory state is per-process; behind multiple instances each has its own
//    counters, which is an acceptable trade-off for basic abuse protection.
//  - The clock is injectable via `now()` so tests can advance time deterministically
//    instead of relying on real timers.
//  - Expired buckets are pruned lazily (on access) and periodically (bounded scan)
//    so the Map never grows without bound.

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX = 300

/**
 * Create a rate-limiting middleware.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.windowMs] Rolling window length in ms.
 * @param {number}   [opts.max]      Max requests allowed per key per window.
 * @param {Function} [opts.keyFn]    (req) => string key. Defaults to client IP.
 * @param {Function} [opts.now]      () => epoch ms. Injectable clock for tests.
 * @param {string}   [opts.message]  Body message on 429.
 * @returns {import('express').RequestHandler & { reset: Function, buckets: Map }}
 */
export function rateLimit({
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX,
  keyFn,
  now = Date.now,
  message = 'Too many requests, please try again later.',
} = {}) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const buckets = new Map()
  let lastPrune = now()

  const resolveKey =
    typeof keyFn === 'function'
      ? keyFn
      : (req) =>
          req.ip ||
          req.headers?.['x-forwarded-for'] ||
          req.socket?.remoteAddress ||
          'unknown'

  function prune(current) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= current) buckets.delete(key)
    }
    lastPrune = current
  }

  const middleware = (req, res, next) => {
    const current = now()

    // Periodic bounded cleanup so long-lived processes don't leak memory.
    if (current - lastPrune >= windowMs) prune(current)

    const key = resolveKey(req)
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count += 1
    const remaining = Math.max(0, max - bucket.count)

    if (typeof res.setHeader === 'function') {
      res.setHeader('X-RateLimit-Limit', String(max))
      res.setHeader('X-RateLimit-Remaining', String(remaining))
    }

    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))
      if (typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(retryAfterSec))
      }
      res.status(429).json({ error: message, retryAfter: retryAfterSec })
      return
    }

    next()
  }

  // Test/ops affordances: clear all counters, or inspect the internal Map.
  middleware.reset = () => buckets.clear()
  middleware.buckets = buckets

  return middleware
}

export default rateLimit
