import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

// --- Mock the db layer so no live PostgreSQL is needed ---
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get } from '../db.js'
import { JWT_SECRET } from '../config.js'
import { hashPassword } from '../middleware/validate.js'
import { errorHandler } from '../middleware/errorHandler.js'
import authRoutes from '../routes/auth.js'
import {
  generateSecret,
  getOtpAuthUrl,
  generateTOTP,
  verifyTOTP,
  base32Encode,
  base32Decode,
} from '../services/totp.js'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use(errorHandler)
  return app
}

// Bearer token for an authenticated user (authGuard verifies with JWT_SECRET).
function authToken(id = 1, email = 'user@gmail.com') {
  return jwt.sign({ sub: id, email }, JWT_SECRET, { expiresIn: '1h' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   1. TOTP algorithm — RFC 6238 known vectors + properties
   ================================================================ */
describe('TOTP algorithm (RFC 6238)', () => {
  // Canonical RFC 6238 secret: ASCII "12345678901234567890" → base32.
  const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'))

  it('base32 round-trips arbitrary bytes', () => {
    const buf = Buffer.from('12345678901234567890', 'ascii')
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true)
  })

  it('encodes the RFC secret to the documented base32 value', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  })

  it('matches RFC 6238 SHA-1 test vectors (6-digit)', () => {
    // Times (seconds) → last-6-digits of the RFC 6238 SHA-1 appendix vectors.
    expect(generateTOTP(RFC_SECRET, 59)).toBe('287082')
    expect(generateTOTP(RFC_SECRET, 1111111109)).toBe('081804')
    expect(generateTOTP(RFC_SECRET, 1234567890)).toBe('005924')
    expect(generateTOTP(RFC_SECRET, 2000000000)).toBe('279037')
  })

  it('verifyTOTP accepts the code generated for the same time', () => {
    const t = 1234567890
    const code = generateTOTP(RFC_SECRET, t)
    expect(verifyTOTP(RFC_SECRET, code, { time: t })).toBe(true)
  })

  it('verifyTOTP rejects a wrong code', () => {
    const t = 1234567890
    expect(verifyTOTP(RFC_SECRET, '000000', { time: t })).toBe(false)
    expect(verifyTOTP(RFC_SECRET, '123456', { time: t })).toBe(false)
  })

  it('verifyTOTP honors the drift window', () => {
    const t = 1234567890
    // A code from the previous 30s step is accepted with window:1, not window:0.
    const prevCode = generateTOTP(RFC_SECRET, t - 30)
    expect(verifyTOTP(RFC_SECRET, prevCode, { time: t, window: 1 })).toBe(true)
    expect(verifyTOTP(RFC_SECRET, prevCode, { time: t, window: 0 })).toBe(false)

    // A code two steps away is outside a window:1.
    const farCode = generateTOTP(RFC_SECRET, t - 90)
    expect(verifyTOTP(RFC_SECRET, farCode, { time: t, window: 1 })).toBe(false)
  })

  it('verifyTOTP rejects malformed input', () => {
    expect(verifyTOTP(RFC_SECRET, '', {})).toBe(false)
    expect(verifyTOTP(RFC_SECRET, 'abcdef', {})).toBe(false)
    expect(verifyTOTP('', '123456', {})).toBe(false)
  })

  it('generateSecret + getOtpAuthUrl produce a usable enrollment', () => {
    const secret = generateSecret()
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    const url = getOtpAuthUrl(secret, 'user@gmail.com')
    expect(url.startsWith('otpauth://totp/')).toBe(true)
    expect(url).toContain(`secret=${secret}`)
    // A freshly issued secret verifies its own current code.
    const now = Math.floor(Date.now() / 1000)
    expect(verifyTOTP(secret, generateTOTP(secret, now), { time: now })).toBe(true)
  })
})

/* ================================================================
   2. MFA setup / enable endpoints
   ================================================================ */
describe('POST /api/auth/mfa/setup', () => {
  it('generates and stores a secret, returning an otpauth URL (not yet enabled)', async () => {
    const app = makeApp()
    get.mockResolvedValueOnce({ id: 1, email: 'user@gmail.com' })
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app)
      .post('/api/auth/mfa/setup')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.secret).toMatch(/^[A-Z2-7]+$/)
    expect(res.body.otpauthUrl).toContain('otpauth://totp/')
    // Secret persisted with mfa_enabled = FALSE.
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET mfa_secret'),
      expect.arrayContaining([res.body.secret, 1]),
    )
  })

  it('requires authentication', async () => {
    const app = makeApp()
    const res = await request(app).post('/api/auth/mfa/setup').send({})
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/mfa/enable', () => {
  it('enables MFA when the submitted code is valid', async () => {
    const app = makeApp()
    const secret = generateSecret()
    get.mockResolvedValueOnce({ id: 1, mfa_secret: secret, mfa_enabled: false })
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const validCode = generateTOTP(secret)
    const res = await request(app)
      .post('/api/auth/mfa/enable')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ code: validCode })

    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(true)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET mfa_enabled = TRUE'),
      [1],
    )
  })

  it('rejects an invalid code with 401', async () => {
    const app = makeApp()
    const secret = generateSecret()
    get.mockResolvedValueOnce({ id: 1, mfa_secret: secret, mfa_enabled: false })

    const res = await request(app)
      .post('/api/auth/mfa/enable')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ code: '000000' })

    expect(res.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('400s if setup was never run (no secret)', async () => {
    const app = makeApp()
    get.mockResolvedValueOnce({ id: 1, mfa_secret: null, mfa_enabled: false })

    const res = await request(app)
      .post('/api/auth/mfa/enable')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ code: '123456' })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/mfa/disable', () => {
  it('clears the secret and flag', async () => {
    const app = makeApp()
    run.mockResolvedValue({ lastID: null, changes: 1 })

    const res = await request(app)
      .post('/api/auth/mfa/disable')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('mfa_enabled = FALSE, mfa_secret = NULL'),
      [1],
    )
  })
})

/* ================================================================
   3. Login MFA gate
   ================================================================ */
describe('POST /api/auth/login with MFA', () => {
  const email = 'mfa-user@gmail.com'
  const password = 'password123'
  const passwordHash = hashPassword(password)
  const secret = generateSecret()

  it('is unaffected when MFA is disabled', async () => {
    const app = makeApp()
    get.mockResolvedValueOnce({
      id: 7, email, password_hash: passwordHash, created_at: new Date().toISOString(),
      mfa_enabled: false, mfa_secret: null,
    })

    const res = await request(app).post('/api/auth/login').send({ email, password })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
  })

  it('rejects with 401 + mfaRequired when code is missing', async () => {
    const app = makeApp()
    get.mockResolvedValueOnce({
      id: 7, email, password_hash: passwordHash, created_at: new Date().toISOString(),
      mfa_enabled: true, mfa_secret: secret,
    })

    const res = await request(app).post('/api/auth/login').send({ email, password })
    expect(res.status).toBe(401)
    expect(res.body.mfaRequired).toBe(true)
    expect(res.body.error).toMatch(/MFA code required/i)
    expect(res.body.token).toBeUndefined()
  })

  it('rejects with 401 when the MFA code is invalid', async () => {
    const app = makeApp()
    get.mockResolvedValueOnce({
      id: 7, email, password_hash: passwordHash, created_at: new Date().toISOString(),
      mfa_enabled: true, mfa_secret: secret,
    })

    const res = await request(app).post('/api/auth/login').send({ email, password, mfaCode: '000000' })
    expect(res.status).toBe(401)
    expect(res.body.mfaRequired).toBe(true)
    expect(res.body.token).toBeUndefined()
  })

  it('issues a token when the MFA code is valid', async () => {
    const app = makeApp()
    get.mockResolvedValueOnce({
      id: 7, email, password_hash: passwordHash, created_at: new Date().toISOString(),
      mfa_enabled: true, mfa_secret: secret,
    })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password, mfaCode: generateTOTP(secret) })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.user.email).toBe(email)
  })

  it('still rejects a wrong password before checking MFA', async () => {
    const app = makeApp()
    get.mockResolvedValueOnce({
      id: 7, email, password_hash: passwordHash, created_at: new Date().toISOString(),
      mfa_enabled: true, mfa_secret: secret,
    })

    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrong', mfaCode: generateTOTP(secret) })
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/Invalid email or password/i)
  })
})

/* ================================================================
   4. OAuth scaffold (config-gated)
   ================================================================ */
describe('OAuth endpoints (config-gated)', () => {
  it('returns 501 when the provider is not configured', async () => {
    const app = makeApp()
    const res = await request(app).get('/api/auth/oauth/google')
    expect(res.status).toBe(501)
    expect(res.body.error).toMatch(/not configured/i)
  })

  it('returns 404 for an unknown provider', async () => {
    const app = makeApp()
    const res = await request(app).get('/api/auth/oauth/myspace')
    expect(res.status).toBe(404)
  })

  it('callback is a guarded no-op (501) without config', async () => {
    const app = makeApp()
    const res = await request(app).get('/api/auth/oauth/google/callback?code=abc')
    expect(res.status).toBe(501)
  })
})
