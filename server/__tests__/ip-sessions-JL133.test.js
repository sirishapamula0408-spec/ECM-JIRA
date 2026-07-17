import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// --- Mock the db layer so no live PostgreSQL is needed ---
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { ipAllowed, ipAllowlist, parseCidrList, normalizeIp } from '../middleware/ipAllowlist.js'
import sessionRoutes, { parseUserAgent } from '../routes/sessions.js'

// Build an app whose auth is stubbed to inject a fixed req.user (route unit test).
function makeApp(user = { id: 1, email: 'user@gmail.com', jti: 'jti-current' }) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/api/sessions', sessionRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   1. ipAllowed — pure helper
   ================================================================ */
describe('ipAllowed()', () => {
  it('matches an exact IPv4 address', () => {
    expect(ipAllowed('203.0.113.5', ['203.0.113.5'])).toBe(true)
    expect(ipAllowed('203.0.113.6', ['203.0.113.5'])).toBe(false)
  })

  it('matches an IP within a CIDR range', () => {
    expect(ipAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true)
    expect(ipAllowed('10.255.255.255', ['10.0.0.0/8'])).toBe(true)
    expect(ipAllowed('192.168.1.10', ['192.168.1.0/24'])).toBe(true)
  })

  it('rejects an IP outside the allowed ranges', () => {
    expect(ipAllowed('11.0.0.1', ['10.0.0.0/8'])).toBe(false)
    expect(ipAllowed('192.168.2.10', ['192.168.1.0/24'])).toBe(false)
  })

  it('allows everything when the list is empty', () => {
    expect(ipAllowed('8.8.8.8', [])).toBe(true)
    expect(ipAllowed('anything', [])).toBe(true)
    expect(ipAllowed('1.2.3.4', undefined)).toBe(true)
  })

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(ipAllowed('::ffff:10.0.0.1', ['10.0.0.0/8'])).toBe(true)
  })

  it('handles multiple rules and /32', () => {
    expect(ipAllowed('203.0.113.5', ['10.0.0.0/8', '203.0.113.5/32'])).toBe(true)
    expect(ipAllowed('203.0.113.9', ['10.0.0.0/8', '203.0.113.5/32'])).toBe(false)
  })

  it('parseCidrList splits and trims a comma-separated string', () => {
    expect(parseCidrList(' 10.0.0.0/8 , 203.0.113.5 ,')).toEqual(['10.0.0.0/8', '203.0.113.5'])
    expect(parseCidrList('')).toEqual([])
  })
})

/* ================================================================
   2. ipAllowlist middleware
   ================================================================ */
describe('ipAllowlist middleware', () => {
  function appWith(allowlist, clientIp = '9.9.9.9') {
    const app = express()
    // Force req.ip deterministically for the test.
    app.use((req, _res, next) => { Object.defineProperty(req, 'ip', { value: clientIp, configurable: true }); next() })
    app.use(ipAllowlist({ allowlist }))
    app.get('/ping', (_req, res) => res.json({ ok: true }))
    return app
  }

  it('403s a client whose IP is not in the allow-list', async () => {
    const res = await request(appWith('10.0.0.0/8', '9.9.9.9')).get('/ping')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not permitted/i)
  })

  it('passes a client whose IP is in the allow-list', async () => {
    const res = await request(appWith('10.0.0.0/8', '10.1.2.3')).get('/ping')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('is a no-op (passes) when the allow-list is empty', async () => {
    const res = await request(appWith('', '9.9.9.9')).get('/ping')
    expect(res.status).toBe(200)
  })
})

/* ================================================================
   3. parseUserAgent — pure helper
   ================================================================ */
describe('parseUserAgent()', () => {
  it('extracts browser + os from a Chrome/Windows UA', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Chrome', os: 'Windows' })
  })

  it('extracts browser + os from a Safari/macOS UA', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Safari', os: 'macOS' })
  })

  it('detects Firefox on Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Firefox', os: 'Linux' })
  })

  it('falls back to Unknown for empty/garbage input', () => {
    expect(parseUserAgent('')).toEqual({ browser: 'Unknown', os: 'Unknown' })
    expect(parseUserAgent(null)).toEqual({ browser: 'Unknown', os: 'Unknown' })
  })
})

/* ================================================================
   4. GET /api/sessions
   ================================================================ */
describe('GET /api/sessions', () => {
  it("returns the caller's active sessions with parsed device info + current flag", async () => {
    const app = makeApp()
    all.mockResolvedValueOnce([
      {
        id: 10, jti: 'jti-current', user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
        ip: '10.0.0.1', created_at: 't1', last_seen_at: 't2', revoked: false,
      },
      {
        id: 11, jti: 'jti-other', user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/16 Safari/605.1.15',
        ip: '10.0.0.2', created_at: 't3', last_seen_at: 't4', revoked: false,
      },
    ])

    const res = await request(app).get('/api/sessions')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({ id: 10, browser: 'Chrome', os: 'Windows', current: true })
    expect(res.body[1]).toMatchObject({ id: 11, browser: 'Safari', os: 'macOS', current: false })
    // Only the caller's own, non-revoked sessions are queried.
    expect(all).toHaveBeenCalledWith(
      expect.stringMatching(/FROM user_sessions[\s\S]*revoked = FALSE/i),
      ['user@gmail.com'],
    )
  })
})

/* ================================================================
   5. DELETE /api/sessions/:id
   ================================================================ */
describe('DELETE /api/sessions/:id', () => {
  it("revokes the owner's session", async () => {
    const app = makeApp()
    get.mockResolvedValueOnce({ id: 5, user_email: 'user@gmail.com' })
    run.mockResolvedValueOnce({ changes: 1 })

    const res = await request(app).delete('/api/sessions/5')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE user_sessions SET revoked = TRUE'),
      [5],
    )
  })

  it('403s when revoking a session owned by someone else', async () => {
    const app = makeApp()
    get.mockResolvedValueOnce({ id: 5, user_email: 'someone-else@gmail.com' })

    const res = await request(app).delete('/api/sessions/5')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('404s when the session does not exist', async () => {
    const app = makeApp()
    get.mockResolvedValueOnce(undefined)

    const res = await request(app).delete('/api/sessions/999')
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   6. POST /api/sessions/revoke-all
   ================================================================ */
describe('POST /api/sessions/revoke-all', () => {
  it('revokes all of the caller\'s sessions except the current one', async () => {
    const app = makeApp({ id: 1, email: 'user@gmail.com', jti: 'jti-current' })
    run.mockResolvedValueOnce({ changes: 3 })

    const res = await request(app).post('/api/sessions/revoke-all').send({})
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE user_sessions SET revoked = TRUE'),
      ['user@gmail.com', 'jti-current'],
    )
  })
})
