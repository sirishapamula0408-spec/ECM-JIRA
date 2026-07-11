import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { hashToken, generateToken, extractToken } from '../middleware/apiTokenAuth.js'

// Session-authenticated app (token management) — stubs req.user like protect would
function createManagementApp(routeModule) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { email: 'owner@test.com', memberId: 7, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/api-tokens', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

// Public API app — real apiTokenAuth middleware runs (no session stub)
function createPublicApp(routeModule) {
  const app = express()
  app.use(express.json())
  app.use('/api/public', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Token generation helpers
   ================================================================ */
describe('token generation helpers', () => {
  it('hashToken is deterministic SHA-256 hex (64 chars) and never equals plaintext', () => {
    const h1 = hashToken('secret-token')
    const h2 = hashToken('secret-token')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[a-f0-9]{64}$/)
    expect(h1).not.toBe('secret-token')
  })

  it('generateToken returns plaintext + matching hash + short prefix', () => {
    const { plaintext, hash, prefix } = generateToken()
    expect(plaintext.startsWith('ecm_')).toBe(true)
    expect(hash).toBe(hashToken(plaintext))
    expect(plaintext).not.toBe(hash)
    expect(plaintext.startsWith(prefix)).toBe(true)
  })

  it('extractToken reads X-API-Key and Bearer headers', () => {
    expect(extractToken({ headers: { 'x-api-key': 'abc' } })).toBe('abc')
    expect(extractToken({ headers: { authorization: 'Bearer xyz' } })).toBe('xyz')
    expect(extractToken({ headers: {} })).toBe(null)
  })
})

/* ================================================================
   Token management API (session-authenticated)
   ================================================================ */
describe('API token management', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/apiTokens.js')
    app = createManagementApp(mod)
  })

  describe('POST /api/api-tokens', () => {
    it('creates a token and returns plaintext ONCE while storing only the hash', async () => {
      run.mockResolvedValue({ lastID: 1 })
      get.mockResolvedValue({ id: 1, name: 'CI', token_prefix: 'ecm_1234abcd', scopes: 'read', revoked: false })

      const res = await request(app).post('/api/api-tokens').send({ name: 'CI', scopes: 'read' })
      expect(res.status).toBe(201)
      // plaintext returned exactly once
      expect(typeof res.body.token).toBe('string')
      expect(res.body.token.startsWith('ecm_')).toBe(true)

      // stored value is the HASH of the plaintext, never the plaintext itself
      const insertArgs = run.mock.calls[0][1]
      const storedHash = insertArgs[4]
      expect(storedHash).toBe(hashToken(res.body.token))
      expect(storedHash).not.toBe(res.body.token)
    })

    it('rejects a missing name (400)', async () => {
      const res = await request(app).post('/api/api-tokens').send({ scopes: 'read' })
      expect(res.status).toBe(400)
    })

    it('rejects an invalid scope (400)', async () => {
      const res = await request(app).post('/api/api-tokens').send({ name: 'X', scopes: 'delete-everything' })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/api-tokens', () => {
    it('lists tokens without ever exposing hash or plaintext', async () => {
      all.mockResolvedValue([
        { id: 1, name: 'CI', token_prefix: 'ecm_1234abcd', scopes: 'read', revoked: false, created_at: 'now', last_used_at: null },
      ])
      const res = await request(app).get('/api/api-tokens')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
      expect(res.body[0].token).toBeUndefined()
      expect(res.body[0].token_hash).toBeUndefined()

      // the SELECT must not request the hash column
      const selectSql = all.mock.calls[0][0]
      expect(selectSql).not.toMatch(/token_hash/)
    })
  })

  describe('DELETE /api/api-tokens/:id — revoke', () => {
    it('revokes an owned token (soft-delete via UPDATE)', async () => {
      get.mockResolvedValue({ id: 1 })
      run.mockResolvedValue({ changes: 1 })
      const res = await request(app).delete('/api/api-tokens/1')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(run.mock.calls[0][0]).toMatch(/UPDATE api_tokens SET revoked = TRUE/)
    })

    it('returns 404 for a token not owned by the user', async () => {
      get.mockResolvedValue(null)
      const res = await request(app).delete('/api/api-tokens/99')
      expect(res.status).toBe(404)
    })
  })
})

/* ================================================================
   apiTokenAuth middleware / public API
   ================================================================ */
describe('Public API + apiTokenAuth', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/publicApi.js')
    app = createPublicApp(mod)
  })

  it('rejects requests with no token (401)', async () => {
    const res = await request(app).get('/api/public/projects')
    expect(res.status).toBe(401)
  })

  it('rejects an invalid/unknown token (401)', async () => {
    get.mockResolvedValue(null) // no matching hash
    const res = await request(app).get('/api/public/projects').set('X-API-Key', 'ecm_bogus')
    expect(res.status).toBe(401)
  })

  it('rejects a revoked token (401)', async () => {
    get.mockResolvedValue({ id: 1, member_id: 7, user_email: 'owner@test.com', scopes: 'read', revoked: true })
    const res = await request(app).get('/api/public/projects').set('Authorization', 'Bearer ecm_revoked')
    expect(res.status).toBe(401)
  })

  it('accepts a valid token, honors read scope, and stamps last_used_at', async () => {
    get.mockResolvedValue({ id: 1, member_id: 7, user_email: 'owner@test.com', scopes: 'read', revoked: false })
    all.mockResolvedValue([{ id: 1, name: 'Demo', key: 'DEMO', type: 'Scrum', lead: 'owner@test.com', created_at: 'now' }])
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).get('/api/public/projects').set('Authorization', 'Bearer ecm_valid')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    // last_used_at update fired
    expect(run).toHaveBeenCalled()
    expect(run.mock.calls[0][0]).toMatch(/last_used_at = NOW\(\)/)
  })

  it('lists issues for a valid token via X-API-Key', async () => {
    get.mockResolvedValue({ id: 1, member_id: 7, user_email: 'owner@test.com', scopes: 'read', revoked: false })
    all.mockResolvedValue([{ id: 10, issue_key: 'DEMO-1', title: 'Hello', status: 'To Do' }])
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).get('/api/public/issues').set('X-API-Key', 'ecm_valid')
    expect(res.status).toBe(200)
    expect(res.body.issues).toHaveLength(1)
  })

  it('rejects a write-only path when token lacks the required scope', async () => {
    // token has only "write" scope, but /projects requires "read"
    get.mockResolvedValue({ id: 1, member_id: 7, user_email: 'owner@test.com', scopes: 'write', revoked: false })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).get('/api/public/projects').set('Authorization', 'Bearer ecm_valid')
    expect(res.status).toBe(403)
  })
})
