// @vitest-environment node
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
}))

import { isOidcConfigured, isSamlConfigured } from '../config.js'
import { upsertSsoUser } from '../services/sso.js'
import { errorHandler } from '../middleware/errorHandler.js'
import authRoutes from '../routes/auth.js'

function makeApp() {
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
   1. Config predicates — true only when ALL required vars are set
   ================================================================ */
describe('isOidcConfigured', () => {
  const full = {
    issuerUrl: 'https://idp.example.com',
    clientId: 'client-123',
    clientSecret: 'secret-abc',
    redirectUri: 'http://localhost:4000/api/auth/sso/oidc/callback',
  }

  it('is true when issuer, client id, client secret, and redirect are all set', () => {
    expect(isOidcConfigured(full)).toBe(true)
  })

  it('is false when any required field is missing', () => {
    for (const key of Object.keys(full)) {
      const partial = { ...full, [key]: '' }
      expect(isOidcConfigured(partial)).toBe(false)
    }
  })

  it('is false for an empty config', () => {
    expect(isOidcConfigured({})).toBe(false)
    expect(isOidcConfigured(null)).toBe(false)
  })
})

describe('isSamlConfigured', () => {
  const full = {
    entryPoint: 'https://idp.example.com/sso',
    issuer: 'ecm-jira',
    cert: 'MIIC-fake-cert',
    callbackUrl: 'http://localhost:4000/api/auth/sso/saml/callback',
  }

  it('is true when entry point, issuer, cert, and callback are all set', () => {
    expect(isSamlConfigured(full)).toBe(true)
  })

  it('is false when any required field is missing', () => {
    for (const key of Object.keys(full)) {
      const partial = { ...full, [key]: '' }
      expect(isSamlConfigured(partial)).toBe(false)
    }
  })

  it('is false for an empty config', () => {
    expect(isSamlConfigured({})).toBe(false)
    expect(isSamlConfigured(null)).toBe(false)
  })
})

/* ================================================================
   2. upsertSsoUser — pure, dependency-injected persistence
   ================================================================ */
describe('upsertSsoUser', () => {
  it('creates a new user AND identity when neither exists', async () => {
    const get = vi
      .fn()
      // 1) identity lookup → none
      .mockResolvedValueOnce(undefined)
      // 2) user-by-email lookup → none
      .mockResolvedValueOnce(undefined)
      // 3) fetch the freshly-created user
      .mockResolvedValueOnce({ id: 42, email: 'new@corp.com', created_at: 'now' })
    const run = vi
      .fn()
      // INSERT users
      .mockResolvedValueOnce({ lastID: 42, changes: 1 })
      // INSERT oauth_identities
      .mockResolvedValueOnce({ lastID: 1, changes: 1 })

    const user = await upsertSsoUser(
      { email: 'New@Corp.com', provider: 'oidc', providerUserId: 'sub-1' },
      { get, run },
    )

    expect(user).toEqual({ id: 42, email: 'new@corp.com', created_at: 'now' })
    // A user row was inserted (email normalized to lowercase)...
    expect(run.mock.calls[0][0]).toMatch(/INSERT INTO users/i)
    expect(run.mock.calls[0][1][0]).toBe('new@corp.com')
    // ...and an identity row was linked.
    expect(run.mock.calls[1][0]).toMatch(/INSERT INTO oauth_identities/i)
    expect(run.mock.calls[1][1]).toEqual([42, 'oidc', 'sub-1'])
  })

  it('reuses the existing user when the identity already exists (no user insert)', async () => {
    const get = vi
      .fn()
      // identity lookup → found
      .mockResolvedValueOnce({ user_id: 7 })
      // fetch linked user
      .mockResolvedValueOnce({ id: 7, email: 'known@corp.com', created_at: 't' })
    const run = vi.fn()

    const user = await upsertSsoUser(
      { email: 'known@corp.com', provider: 'saml', providerUserId: 'nameid-7' },
      { get, run },
    )

    expect(user).toEqual({ id: 7, email: 'known@corp.com', created_at: 't' })
    // No writes at all — the identity already mapped to a user.
    expect(run).not.toHaveBeenCalled()
  })

  it('links a new identity to an existing user matched by email (no user insert)', async () => {
    const get = vi
      .fn()
      // identity lookup → none
      .mockResolvedValueOnce(undefined)
      // user-by-email → found
      .mockResolvedValueOnce({ id: 9, email: 'exists@corp.com', created_at: 't' })
    const run = vi.fn().mockResolvedValueOnce({ lastID: 5, changes: 1 })

    const user = await upsertSsoUser(
      { email: 'exists@corp.com', provider: 'oidc', providerUserId: 'sub-9' },
      { get, run },
    )

    expect(user).toEqual({ id: 9, email: 'exists@corp.com', created_at: 't' })
    // Only the identity is inserted — no new user row.
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toMatch(/INSERT INTO oauth_identities/i)
    expect(run.mock.calls[0][1]).toEqual([9, 'oidc', 'sub-9'])
  })

  it('throws when the email claim is missing', async () => {
    await expect(
      upsertSsoUser({ email: '', provider: 'oidc', providerUserId: 'x' }, { get: vi.fn(), run: vi.fn() }),
    ).rejects.toThrow(/email/i)
  })
})

/* ================================================================
   3. /sso/status + 501 when unconfigured (today's default behaviour)
   ================================================================ */
describe('SSO endpoints (unconfigured environment)', () => {
  const app = makeApp()

  it('GET /api/auth/sso/status reports both methods disabled', async () => {
    const res = await request(app).get('/api/auth/sso/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ oidc: false, saml: false })
  })

  it('GET /api/auth/sso/oidc returns 501 when OIDC is not configured', async () => {
    const res = await request(app).get('/api/auth/sso/oidc')
    expect(res.status).toBe(501)
  })

  it('GET /api/auth/sso/oidc/callback returns 501 when OIDC is not configured', async () => {
    const res = await request(app).get('/api/auth/sso/oidc/callback?code=abc&state=xyz')
    expect(res.status).toBe(501)
  })

  it('GET /api/auth/sso/saml returns 501 when SAML is not configured', async () => {
    const res = await request(app).get('/api/auth/sso/saml')
    expect(res.status).toBe(501)
  })

  it('POST /api/auth/sso/saml/callback returns 501 when SAML is not configured', async () => {
    const res = await request(app).post('/api/auth/sso/saml/callback').send({ SAMLResponse: 'x' })
    expect(res.status).toBe(501)
  })
})
