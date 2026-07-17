// @vitest-environment node
//
// JL-93 — Auth abuse protection: rate limiting, login lockout & strict CORS.
// Pure middleware unit tests with an injectable clock (no real timers) plus a
// db-mocked integration check that the login route enforces the lockout gate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { rateLimit } from '../middleware/rateLimit.js'
import { createLoginLockout } from '../middleware/loginLockout.js'
import { corsAllowList } from '../middleware/corsAllowList.js'

// --- Minimal fake req/res so middleware can run without Express/supertest. ---
function makeReq({ ip = '1.2.3.4', method = 'GET', headers = {} } = {}) {
  return { ip, method, headers, socket: { remoteAddress: ip } }
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v
    },
    getHeader(k) {
      return this.headers[k.toLowerCase()]
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    end() {
      this.ended = true
      return this
    },
  }
  return res
}

/** Run a middleware once, returning { res, nextCalled }. */
function invoke(mw, req) {
  const res = makeRes()
  let nextCalled = false
  mw(req, res, () => {
    nextCalled = true
  })
  return { res, nextCalled }
}

/* ================================================================
   1. rateLimit
   ================================================================ */
describe('rateLimit middleware', () => {
  it('allows up to `max` requests then 429s with Retry-After', () => {
    let clock = 1000
    const mw = rateLimit({ windowMs: 1000, max: 3, now: () => clock, keyFn: () => 'k' })

    // First 3 requests pass through.
    for (let i = 0; i < 3; i++) {
      const { res, nextCalled } = invoke(mw, makeReq())
      expect(nextCalled).toBe(true)
      expect(res.statusCode).toBe(200)
    }

    // 4th request is rate limited.
    const { res, nextCalled } = invoke(mw, makeReq())
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(429)
    expect(res.body.error).toMatch(/too many requests/i)
    expect(Number(res.getHeader('Retry-After'))).toBeGreaterThanOrEqual(1)
  })

  it('exposes remaining count via X-RateLimit-Remaining', () => {
    let clock = 0
    const mw = rateLimit({ windowMs: 1000, max: 2, now: () => clock, keyFn: () => 'k' })
    const a = invoke(mw, makeReq())
    expect(a.res.getHeader('X-RateLimit-Remaining')).toBe('1')
    const b = invoke(mw, makeReq())
    expect(b.res.getHeader('X-RateLimit-Remaining')).toBe('0')
  })

  it('resets after the window elapses (advance the injected clock)', () => {
    let clock = 1000
    const mw = rateLimit({ windowMs: 1000, max: 2, now: () => clock, keyFn: () => 'k' })

    invoke(mw, makeReq()) // 1
    invoke(mw, makeReq()) // 2
    expect(invoke(mw, makeReq()).res.statusCode).toBe(429) // over

    // Advance past the window → bucket resets, requests allowed again.
    clock += 1001
    const after = invoke(mw, makeReq())
    expect(after.nextCalled).toBe(true)
    expect(after.res.statusCode).toBe(200)
  })

  it('tracks limits per key independently', () => {
    let clock = 0
    let key = 'a'
    const mw = rateLimit({ windowMs: 1000, max: 1, now: () => clock, keyFn: () => key })

    expect(invoke(mw, makeReq()).res.statusCode).toBe(200) // a #1
    expect(invoke(mw, makeReq()).res.statusCode).toBe(429) // a #2 blocked
    key = 'b'
    expect(invoke(mw, makeReq()).res.statusCode).toBe(200) // b #1 independent
  })

  it('prunes expired buckets over time', () => {
    let clock = 0
    const mw = rateLimit({ windowMs: 100, max: 5, now: () => clock, keyFn: (r) => r.ip })
    invoke(mw, makeReq({ ip: 'x' }))
    expect(mw.buckets.size).toBe(1)
    // Far in the future, a request for a different key triggers periodic prune.
    clock += 10_000
    invoke(mw, makeReq({ ip: 'y' }))
    expect(mw.buckets.has('x')).toBe(false)
  })
})

/* ================================================================
   2. loginLockout
   ================================================================ */
describe('loginLockout helpers', () => {
  it('locks after N failures and reports isLocked during cooldown', () => {
    let clock = 1000
    const lockout = createLoginLockout({
      maxAttempts: 3,
      windowMs: 10_000,
      lockoutMs: 5_000,
      now: () => clock,
    })
    const key = 'user@x.com|1.2.3.4'

    expect(lockout.isLocked(key)).toBe(false)
    lockout.recordFailure(key)
    lockout.recordFailure(key)
    expect(lockout.isLocked(key)).toBe(false) // still under threshold
    const state = lockout.recordFailure(key) // 3rd → lock
    expect(state.locked).toBe(true)
    expect(lockout.isLocked(key)).toBe(true)
    expect(lockout.retryAfter(key)).toBeGreaterThan(0)
  })

  it('reset() clears the lock immediately', () => {
    let clock = 0
    const lockout = createLoginLockout({ maxAttempts: 2, windowMs: 1000, lockoutMs: 1000, now: () => clock })
    const key = 'k'
    lockout.recordFailure(key)
    lockout.recordFailure(key)
    expect(lockout.isLocked(key)).toBe(true)
    lockout.reset(key)
    expect(lockout.isLocked(key)).toBe(false)
    expect(lockout.retryAfter(key)).toBe(0)
  })

  it('unlocks automatically after the cooldown (advance the clock)', () => {
    let clock = 0
    const lockout = createLoginLockout({ maxAttempts: 2, windowMs: 10_000, lockoutMs: 5_000, now: () => clock })
    const key = 'k'
    lockout.recordFailure(key)
    lockout.recordFailure(key)
    expect(lockout.isLocked(key)).toBe(true)

    clock += 5_001 // cooldown elapsed
    expect(lockout.isLocked(key)).toBe(false)
    // A single fresh failure after unlock does not immediately re-lock.
    lockout.recordFailure(key)
    expect(lockout.isLocked(key)).toBe(false)
  })

  it('only counts failures within the sliding window', () => {
    let clock = 0
    const lockout = createLoginLockout({ maxAttempts: 3, windowMs: 1000, lockoutMs: 1000, now: () => clock })
    const key = 'k'
    lockout.recordFailure(key) // t=0
    clock += 1500 // first failure now outside the window
    lockout.recordFailure(key)
    lockout.recordFailure(key)
    // Only 2 failures within window → not locked.
    expect(lockout.isLocked(key)).toBe(false)
  })
})

/* ================================================================
   3. corsAllowList
   ================================================================ */
describe('corsAllowList middleware', () => {
  it('reflects an allowed origin and sets credentials', () => {
    const mw = corsAllowList({ allowedOrigins: ['https://app.example.com'] })
    const { res, nextCalled } = invoke(
      mw,
      makeReq({ headers: { origin: 'https://app.example.com' } }),
    )
    expect(nextCalled).toBe(true)
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('https://app.example.com')
    expect(res.getHeader('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('omits ACAO for a disallowed origin in strict mode', () => {
    const mw = corsAllowList({ allowedOrigins: ['https://app.example.com'] })
    const { res, nextCalled } = invoke(
      mw,
      makeReq({ headers: { origin: 'https://evil.example.com' } }),
    )
    // Request still proceeds server-side, but no ACAO header → browser blocks it.
    expect(nextCalled).toBe(true)
    expect(res.getHeader('Access-Control-Allow-Origin')).toBeUndefined()
    expect(mw.isAllowed('https://evil.example.com')).toBe(false)
  })

  it('is permissive when the allow-list is empty (reflects any origin)', () => {
    const mw = corsAllowList({ allowedOrigins: [] })
    expect(mw.permissive).toBe(true)
    const { res } = invoke(mw, makeReq({ headers: { origin: 'http://localhost:5173' } }))
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    // No Origin header → wildcard fallback preserves prior open behaviour.
    const { res: res2 } = invoke(mw, makeReq({ headers: {} }))
    expect(res2.getHeader('Access-Control-Allow-Origin')).toBe('*')
  })

  it('accepts a comma-separated string allow-list', () => {
    const mw = corsAllowList({ allowedOrigins: 'https://a.com, https://b.com' })
    expect(mw.permissive).toBe(false)
    expect(mw.isAllowed('https://a.com')).toBe(true)
    expect(mw.isAllowed('https://b.com')).toBe(true)
    expect(mw.isAllowed('https://c.com')).toBe(false)
  })

  it('short-circuits an OPTIONS preflight with 204', () => {
    const mw = corsAllowList({ allowedOrigins: ['https://app.example.com'] })
    const { res, nextCalled } = invoke(
      mw,
      makeReq({ method: 'OPTIONS', headers: { origin: 'https://app.example.com' } }),
    )
    expect(nextCalled).toBe(false)
    expect(res.statusCode).toBe(204)
    expect(res.ended).toBe(true)
  })
})

/* ================================================================
   4. Login route integration — lockout gate (db mocked)
   ================================================================ */
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

describe('POST /api/auth/login lockout gate', () => {
  let request, express, get, authRoutes, errorHandler, createLoginLockout, setLoginLockout

  beforeEach(async () => {
    vi.clearAllMocks()
    request = (await import('supertest')).default
    express = (await import('express')).default
    ;({ get } = await import('../db.js'))
    ;({ default: authRoutes, setLoginLockout } = await import('../routes/auth.js'))
    ;({ errorHandler } = await import('../middleware/errorHandler.js'))
    ;({ createLoginLockout } = await import('../middleware/loginLockout.js'))
    // Inject a FRESH, fully isolated lockout instance into the auth route for
    // the duration of this test. This makes the assertion deterministic under
    // the full parallel suite: the shared, process-wide `loginLockout`
    // singleton can accumulate state from other auth-touching suites that run
    // in the same worker, but here the route counts failures against a Map that
    // no other suite can see. Same default config (5 attempts) → same behaviour.
    setLoginLockout(createLoginLockout())
  })

  afterEach(() => {
    // Restore the shared default so we don't leak our test instance onward.
    setLoginLockout()
  })

  function makeApp() {
    const app = express()
    app.use(express.json())
    app.use('/api/auth', authRoutes)
    app.use(errorHandler)
    return app
  }

  it('429s once the identity is locked out after repeated bad passwords', async () => {
    const app = makeApp()
    const email = 'victim@gmail.com'
    // Every lookup returns a user whose password never matches "wrong".
    get.mockResolvedValue({
      id: 1,
      email,
      password_hash: 'notarealhash',
      created_at: new Date().toISOString(),
      mfa_enabled: false,
      mfa_secret: null,
    })

    // Default lockout is 5 attempts → first 5 wrong tries return 401.
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/auth/login').send({ email, password: 'wrong' })
      expect(r.status).toBe(401)
    }

    // 6th attempt is now locked → 429 with Retry-After.
    const locked = await request(app).post('/api/auth/login').send({ email, password: 'wrong' })
    expect(locked.status).toBe(429)
    expect(locked.headers['retry-after']).toBeDefined()
    expect(locked.body.error).toMatch(/too many failed login/i)
    // This test performs 6 sequential supertest round-trips (each spins up a
    // real HTTP server). Under the full parallel suite that can take several
    // seconds on a busy CI box, so give it explicit headroom over the default
    // per-test timeout rather than letting contention turn it flaky.
  }, 30000)
})
