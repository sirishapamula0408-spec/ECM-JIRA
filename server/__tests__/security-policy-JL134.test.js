import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// --- Mock the db layer so no live PostgreSQL is needed ---
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import authRoutes from '../routes/auth.js'
import securityPolicyRoutes from '../routes/securityPolicy.js'
import {
  validatePassword,
  isPasswordExpired,
  normalizePolicy,
  DEFAULT_POLICY,
} from '../services/passwordPolicy.js'

const DEFAULT_ROW = {
  require_mfa: false,
  min_password_length: 8,
  require_uppercase: false,
  require_number: false,
  require_symbol: false,
  password_max_age_days: 0,
}

// Build an app that mounts the security-policy router behind a fake auth layer
// that injects the given workspace role onto req.user.
function makePolicyApp(user = { email: 'admin@gmail.com', workspaceRole: 'Admin', isOwner: false }) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { ...user }
    next()
  })
  app.use('/api', securityPolicyRoutes)
  app.use(errorHandler)
  return app
}

function makeAuthApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   1. validatePassword — pure policy enforcement
   ================================================================ */
describe('validatePassword', () => {
  it('accepts a compliant password under the default policy', () => {
    const res = validatePassword('password123', DEFAULT_POLICY)
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
  })

  it('enforces minimum length', () => {
    const res = validatePassword('short', { ...DEFAULT_ROW, min_password_length: 8 })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/at least 8 characters/)
  })

  it('enforces uppercase when required', () => {
    const policy = { ...DEFAULT_ROW, require_uppercase: true }
    expect(validatePassword('lowercase1', policy).ok).toBe(false)
    expect(validatePassword('Uppercase1', policy).ok).toBe(true)
  })

  it('enforces number when required', () => {
    const policy = { ...DEFAULT_ROW, require_number: true }
    expect(validatePassword('nonumbers', policy).ok).toBe(false)
    expect(validatePassword('has1number', policy).ok).toBe(true)
  })

  it('enforces symbol when required', () => {
    const policy = { ...DEFAULT_ROW, require_symbol: true }
    expect(validatePassword('nosymbol1', policy).ok).toBe(false)
    expect(validatePassword('has_symbol!', policy).ok).toBe(true)
  })

  it('accumulates multiple errors under a strict policy', () => {
    const strict = {
      require_mfa: true,
      min_password_length: 12,
      require_uppercase: true,
      require_number: true,
      require_symbol: true,
      password_max_age_days: 90,
    }
    const res = validatePassword('abc', strict)
    expect(res.ok).toBe(false)
    expect(res.errors.length).toBeGreaterThanOrEqual(3)
  })

  it('passes a fully-compliant password under a strict policy', () => {
    const strict = {
      min_password_length: 12,
      require_uppercase: true,
      require_number: true,
      require_symbol: true,
    }
    expect(validatePassword('StrongPass99!', strict).ok).toBe(true)
  })
})

/* ================================================================
   2. isPasswordExpired — pure rotation logic
   ================================================================ */
describe('isPasswordExpired', () => {
  const now = new Date('2026-07-11T00:00:00Z')

  it('returns false when rotation is disabled (0)', () => {
    const old = new Date('2020-01-01T00:00:00Z')
    expect(isPasswordExpired(old, { password_max_age_days: 0 }, now)).toBe(false)
  })

  it('returns true when older than the max age', () => {
    const changed = new Date('2026-01-01T00:00:00Z') // > 90 days before now
    expect(isPasswordExpired(changed, { password_max_age_days: 90 }, now)).toBe(true)
  })

  it('returns false when within the max age', () => {
    const changed = new Date('2026-07-01T00:00:00Z') // 10 days before now
    expect(isPasswordExpired(changed, { password_max_age_days: 90 }, now)).toBe(false)
  })

  it('treats a missing timestamp as expired when rotation is enabled', () => {
    expect(isPasswordExpired(null, { password_max_age_days: 30 }, now)).toBe(true)
  })

  it('normalizePolicy fills defaults for a partial object', () => {
    const p = normalizePolicy({ require_number: true })
    expect(p.min_password_length).toBe(DEFAULT_POLICY.min_password_length)
    expect(p.require_number).toBe(true)
    expect(p.require_mfa).toBe(false)
  })
})

/* ================================================================
   3. GET / PUT /api/security-policy
   ================================================================ */
describe('GET /api/security-policy', () => {
  it('returns the org policy for an authenticated user', async () => {
    const app = makePolicyApp({ email: 'viewer@gmail.com', workspaceRole: 'Viewer', isOwner: false })
    get.mockResolvedValueOnce(DEFAULT_ROW)

    const res = await request(app).get('/api/security-policy')
    expect(res.status).toBe(200)
    expect(res.body.min_password_length).toBe(8)
    expect(res.body.require_mfa).toBe(false)
  })
})

describe('PUT /api/security-policy', () => {
  it('updates the policy for an Admin', async () => {
    const app = makePolicyApp({ email: 'admin@gmail.com', workspaceRole: 'Admin', isOwner: false })
    run.mockResolvedValue({ lastID: 1, changes: 1 })
    get.mockResolvedValueOnce({
      ...DEFAULT_ROW,
      require_mfa: true,
      min_password_length: 12,
      require_number: true,
    })

    const res = await request(app)
      .put('/api/security-policy')
      .send({ require_mfa: true, min_password_length: 12, require_number: true })

    expect(res.status).toBe(200)
    expect(res.body.require_mfa).toBe(true)
    expect(res.body.min_password_length).toBe(12)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO security_policy'),
      expect.arrayContaining([true, 12]),
    )
  })

  it('rejects a non-Admin with 403', async () => {
    const app = makePolicyApp({ email: 'viewer@gmail.com', workspaceRole: 'Viewer', isOwner: false })

    const res = await request(app)
      .put('/api/security-policy')
      .send({ require_mfa: true })

    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   4. Registration enforcement
   ================================================================ */
describe('POST /api/auth/signup — password policy enforcement', () => {
  it('rejects a weak password under a strict policy (400)', async () => {
    const app = makeAuthApp()
    // getSecurityPolicy → strict policy
    get.mockResolvedValueOnce({
      require_mfa: false,
      min_password_length: 12,
      require_uppercase: true,
      require_number: true,
      require_symbol: true,
      password_max_age_days: 0,
    })

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'weakpass@gmail.com', password: 'password123' })

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
    expect(res.body.errors.length).toBeGreaterThan(0)
  })

  it('accepts a compliant password under the default policy (201)', async () => {
    const app = makeAuthApp()
    get
      .mockResolvedValueOnce(DEFAULT_ROW) // getSecurityPolicy
      .mockResolvedValueOnce(null) // existing user check → none
      .mockResolvedValueOnce({ id: 1, email: 'newuser@gmail.com', created_at: new Date().toISOString() }) // created user
    get.mockResolvedValue(undefined) // remaining onboarding/bootstrap lookups
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'newuser@gmail.com', password: 'password123' })

    expect(res.status).toBe(201)
    expect(res.body.token).toBeDefined()
    expect(res.body.user.email).toBe('newuser@gmail.com')
    // password_changed_at is set on registration
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('password_changed_at'),
      expect.arrayContaining(['newuser@gmail.com']),
    )
  })
})
