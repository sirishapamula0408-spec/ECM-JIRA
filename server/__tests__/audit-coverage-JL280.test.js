// @vitest-environment node
//
// JL-280: verify that security-relevant events across auth, webhooks,
// automation, api-tokens and security-policy are mirrored into the
// tamper-evident audit_log via safeAppendAudit(), using the namespaced
// action taxonomy. The audit-log service is mocked so we can assert the
// exact action + metadata each route emits without touching a real chain.
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
  // JL-325: signup resolves the workspace signup_policy through getSetting;
  // returning the fallback keeps these tests on the default 'open' policy.
  getSetting: vi.fn(async (_key, fallback = null) => fallback),
  setSetting: vi.fn(),
}))

// --- Mock the audit-log service so we can spy on safeAppendAudit() ---
vi.mock('../services/auditLog.js', () => ({
  safeAppendAudit: vi.fn(),
}))

import { run, get } from '../db.js'
import { safeAppendAudit } from '../services/auditLog.js'
import { JWT_SECRET } from '../config.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { generateSecret, generateTOTP } from '../services/totp.js'

import authRoutes from '../routes/auth.js'
import webhookRoutes from '../routes/webhooks.js'
import automationRoutes from '../routes/automation.js'
import apiTokenRoutes from '../routes/apiTokens.js'
import securityPolicyRoutes from '../routes/securityPolicy.js'

/** App for the public/auth-guarded auth router (authGuard verifies a real JWT). */
function authApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use(errorHandler)
  return app
}

function authToken(id = 1, email = 'user@gmail.com') {
  return jwt.sign({ sub: id, email }, JWT_SECRET, { expiresIn: '1h' })
}

/** App that stubs req.user as an Admin, for the admin-gated routers. */
function adminApp(mountPath, router, email = 'admin@gmail.com') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email, memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, router)
  app.use(errorHandler)
  return app
}

/** Find the safeAppendAudit call whose entry.action equals `action`. */
function auditCallFor(action) {
  return safeAppendAudit.mock.calls.find((c) => c[0]?.action === action)?.[0]
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   auth.js
   ================================================================ */
describe('auth events → audit_log', () => {
  it('records auth.login.failed on invalid credentials', async () => {
    get.mockResolvedValueOnce(undefined) // no such user
    const app = authApp()
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@gmail.com', password: 'wrongpass' })

    expect(res.status).toBe(401)
    const entry = auditCallFor('auth.login.failed')
    expect(entry).toBeTruthy()
    expect(entry.actor).toBe('nobody@gmail.com')
    expect(entry.metadata.reason).toBe('invalid_credentials')
  })

  it('records auth.signup on registration', async () => {
    // Smart mock: dispatch by SQL so the signup path finds a created user.
    get.mockImplementation(async (sql) => {
      if (/FROM security_policy/i.test(sql)) return undefined // defaults apply
      if (/FROM users WHERE id/i.test(sql)) return { id: 42, email: 'new@gmail.com', created_at: '2026-07-27T00:00:00.000Z' }
      if (/FROM users WHERE email/i.test(sql)) return undefined // not yet registered
      if (/COUNT\(\*\) AS count FROM members/i.test(sql)) return { count: 0 }
      if (/COUNT\(\*\) AS count FROM users/i.test(sql)) return { count: 1 }
      return undefined // members lookup, invitations, workspaces → absent
    })
    run.mockResolvedValue({ lastID: 42, changes: 1 })

    const app = authApp()
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'new@gmail.com', password: 'password123' })

    expect(res.status).toBe(201)
    const entry = auditCallFor('auth.signup')
    expect(entry).toBeTruthy()
    expect(entry.actor).toBe('new@gmail.com')
    expect(entry.metadata.userId).toBe(42)
  })

  it('records auth.mfa.enabled when a valid code enables MFA', async () => {
    const secret = generateSecret()
    const code = generateTOTP(secret)
    get.mockResolvedValueOnce({ id: 1, mfa_secret: secret, mfa_enabled: false })
    run.mockResolvedValue({ changes: 1 })

    const app = authApp()
    const res = await request(app)
      .post('/api/auth/mfa/enable')
      .set('Authorization', `Bearer ${authToken(1, 'user@gmail.com')}`)
      .send({ code })

    expect(res.status).toBe(200)
    const entry = auditCallFor('auth.mfa.enabled')
    expect(entry).toBeTruthy()
    expect(entry.actor).toBe('user@gmail.com')
  })

  it('records auth.mfa.disabled when MFA is turned off', async () => {
    run.mockResolvedValue({ changes: 1 })
    const app = authApp()
    const res = await request(app)
      .post('/api/auth/mfa/disable')
      .set('Authorization', `Bearer ${authToken(1, 'user@gmail.com')}`)
      .send({})

    expect(res.status).toBe(200)
    expect(auditCallFor('auth.mfa.disabled')).toBeTruthy()
  })
})

/* ================================================================
   webhooks.js
   ================================================================ */
describe('webhook events → audit_log', () => {
  it('records webhook.updated on PATCH', async () => {
    get
      .mockResolvedValueOnce({ id: 7, name: 'old', url: 'http://x', secret: 's' }) // existing
      .mockResolvedValueOnce({ id: 7, name: 'new', url: 'http://x' }) // re-read
    run.mockResolvedValue({ changes: 1 })

    const app = adminApp('/api/webhooks', webhookRoutes)
    const res = await request(app).patch('/api/webhooks/7').send({ name: 'new' })

    expect(res.status).toBe(200)
    const entry = auditCallFor('webhook.updated')
    expect(entry).toBeTruthy()
    expect(entry.target).toBe('webhook:7')
  })

  it('records webhook.deleted on DELETE', async () => {
    run.mockResolvedValue({ changes: 1 })
    const app = adminApp('/api/webhooks', webhookRoutes)
    const res = await request(app).delete('/api/webhooks/9')

    expect(res.status).toBe(200)
    const entry = auditCallFor('webhook.deleted')
    expect(entry).toBeTruthy()
    expect(entry.target).toBe('webhook:9')
  })

  it('records webhook.tested when a test is fired', async () => {
    get.mockResolvedValueOnce({ id: 3, name: 'hook', url: 'http://127.0.0.1:0', secret: '' })
    // fetch will fail (unreachable) — the audit entry is recorded before the fetch.
    const app = adminApp('/api/webhooks', webhookRoutes)
    const res = await request(app).post('/api/webhooks/3/test')

    expect(res.status).toBe(200)
    const entry = auditCallFor('webhook.tested')
    expect(entry).toBeTruthy()
    expect(entry.target).toBe('webhook:3')
  })
})

/* ================================================================
   automation.js
   ================================================================ */
describe('automation-rule events → audit_log', () => {
  it('records automation.rule.created on POST', async () => {
    run.mockResolvedValue({ lastID: 11, changes: 1 })
    get.mockResolvedValueOnce({
      id: 11, project_id: 5, name: 'auto', trigger_type: 'status_changed',
      action_type: 'notify', action_value: '', enabled: true, created_at: 'now',
    })

    const app = adminApp('/api', automationRoutes)
    const res = await request(app)
      .post('/api/projects/5/automation-rules')
      .send({ name: 'auto', triggerType: 'status_changed', actionType: 'notify' })

    expect(res.status).toBe(201)
    const entry = auditCallFor('automation.rule.created')
    expect(entry).toBeTruthy()
    expect(entry.target).toBe('automation-rule:11')
  })

  it('records automation.rule.updated on PATCH', async () => {
    get
      .mockResolvedValueOnce({ id: 11, name: 'auto', enabled: true }) // existing
      .mockResolvedValueOnce({ id: 11, name: 'auto2', enabled: false }) // re-read
    run.mockResolvedValue({ changes: 1 })

    const app = adminApp('/api', automationRoutes)
    const res = await request(app).patch('/api/automation-rules/11').send({ enabled: false })

    expect(res.status).toBe(200)
    expect(auditCallFor('automation.rule.updated')?.target).toBe('automation-rule:11')
  })

  it('records automation.rule.deleted on DELETE', async () => {
    run.mockResolvedValue({ changes: 1 })
    const app = adminApp('/api', automationRoutes)
    const res = await request(app).delete('/api/automation-rules/11')

    expect(res.status).toBe(200)
    expect(auditCallFor('automation.rule.deleted')?.target).toBe('automation-rule:11')
  })
})

/* ================================================================
   apiTokens.js
   ================================================================ */
describe('api-token events → audit_log', () => {
  it('records apitoken.created on POST (never logs the secret)', async () => {
    run.mockResolvedValue({ lastID: 4, changes: 1 })
    get.mockResolvedValueOnce({
      id: 4, name: 'ci', token_prefix: 'abc123', scopes: 'read', revoked: false,
      created_at: 'now', last_used_at: null,
    })

    const app = adminApp('/api/api-tokens', apiTokenRoutes)
    const res = await request(app).post('/api/api-tokens').send({ name: 'ci', scopes: ['read'] })

    expect(res.status).toBe(201)
    const entry = auditCallFor('apitoken.created')
    expect(entry).toBeTruthy()
    expect(entry.target).toBe('apitoken:4')
    // The audit metadata must NOT contain the plaintext token or its hash.
    const meta = JSON.stringify(entry.metadata)
    expect(meta).not.toMatch(/token_hash/i)
    expect(meta).toContain('abc123') // prefix is fine
  })

  it('records apitoken.revoked on DELETE', async () => {
    get.mockResolvedValueOnce({ id: 4 }) // ownership check passes
    run.mockResolvedValue({ changes: 1 })

    const app = adminApp('/api/api-tokens', apiTokenRoutes)
    const res = await request(app).delete('/api/api-tokens/4')

    expect(res.status).toBe(200)
    expect(auditCallFor('apitoken.revoked')?.target).toBe('apitoken:4')
  })
})

/* ================================================================
   securityPolicy.js
   ================================================================ */
describe('security-policy events → audit_log', () => {
  it('records security.policy.updated on PUT', async () => {
    run.mockResolvedValue({ changes: 1 })
    get.mockResolvedValueOnce({
      require_mfa: true, min_password_length: 12, require_uppercase: true,
      require_number: true, require_symbol: false, password_max_age_days: 90,
    })

    const app = adminApp('/api', securityPolicyRoutes)
    const res = await request(app).put('/api/security-policy').send({ require_mfa: true, min_password_length: 12 })

    expect(res.status).toBe(200)
    const entry = auditCallFor('security.policy.updated')
    expect(entry).toBeTruthy()
    expect(entry.actor).toBe('admin@gmail.com')
    expect(entry.target).toBe('security-policy')
  })
})
