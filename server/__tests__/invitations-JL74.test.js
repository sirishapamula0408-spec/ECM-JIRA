import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// --- Mock the db module ---
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

// --- Mock the mailer (never send real email in tests) ---
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue({ ok: true, messageId: 'test' }),
  buildInviteEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  buildPasswordResetEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  isSmtpConfigured: vi.fn().mockReturnValue(false),
}))

import { run, all, get } from '../db.js'
import { sendMail } from '../utils/mailer.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Build an app with a stubbed auth/role user
function createApp(routeModule, { role = 'Admin', isOwner = false, mountPath = '/api/invitations' } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      email: 'admin@test.com',
      memberId: 1,
      workspaceRole: role,
      isOwner,
    }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Onboarding — signup provisions a member row
   ================================================================ */
describe('JL-74 signup onboarding', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/auth.js')
    // auth routes are public — no user stub needed, but harmless
    app = express()
    app.use(express.json())
    app.use('/api/auth', mod.default)
    app.use(errorHandler)
  })

  it('first ever signup becomes Owner (Admin, is_owner=TRUE)', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM users WHERE email')) return undefined // no existing user
      if (sql.includes('FROM users WHERE id')) return { id: 1, email: 'first@test.com', created_at: 'now' }
      if (sql.includes('FROM members WHERE LOWER(email)')) return undefined // no member yet
      if (sql.includes('COUNT(*) AS count FROM members')) return { count: 0 }
      if (sql.includes('FROM invitations')) return undefined
      return undefined
    })
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'first@test.com', password: 'secret123' })

    expect(res.status).toBe(201)
    // Find the members INSERT call
    const memberInsert = run.mock.calls.find((c) => /INSERT INTO members/.test(c[0]))
    expect(memberInsert).toBeTruthy()
    const params = memberInsert[1]
    // params: [name, email, role, status, task_count, invited_by, is_owner]
    expect(params[2]).toBe('Admin')
    expect(params[6]).toBe(true)
  })

  it('later signup becomes a plain Viewer member', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM users WHERE email')) return undefined
      if (sql.includes('FROM users WHERE id')) return { id: 2, email: 'second@test.com', created_at: 'now' }
      if (sql.includes('FROM members WHERE LOWER(email)')) return undefined
      if (sql.includes('COUNT(*) AS count FROM members')) return { count: 3 } // members exist
      if (sql.includes('FROM invitations')) return undefined // no pending invite
      return undefined
    })
    run.mockResolvedValue({ lastID: 2, changes: 1 })

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'second@test.com', password: 'secret123' })

    expect(res.status).toBe(201)
    const memberInsert = run.mock.calls.find((c) => /INSERT INTO members/.test(c[0]))
    expect(memberInsert).toBeTruthy()
    expect(memberInsert[1][2]).toBe('Viewer')
    expect(memberInsert[1][6]).toBe(false)
  })

  it('signup honors a pending invitation role', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM users WHERE email')) return undefined
      if (sql.includes('FROM users WHERE id')) return { id: 3, email: 'invited@test.com', created_at: 'now' }
      if (sql.includes('FROM members WHERE LOWER(email)')) return undefined
      if (sql.includes('COUNT(*) AS count FROM members')) return { count: 5 }
      if (sql.includes('FROM invitations')) return { id: 9, role: 'Member' }
      return undefined
    })
    run.mockResolvedValue({ lastID: 3, changes: 1 })

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'invited@test.com', password: 'secret123' })

    expect(res.status).toBe(201)
    const memberInsert = run.mock.calls.find((c) => /INSERT INTO members/.test(c[0]))
    expect(memberInsert[1][2]).toBe('Member')
    // Invitation should be marked accepted
    const inviteUpdate = run.mock.calls.find((c) => /UPDATE invitations SET status = 'accepted'/.test(c[0]))
    expect(inviteUpdate).toBeTruthy()
  })
})

/* ================================================================
   Invitations API
   ================================================================ */
describe('JL-74 invitations API', () => {
  let mod
  beforeEach(async () => {
    mod = await import('../routes/invitations.js')
  })

  describe('POST /api/invitations — create invite', () => {
    it('creates an invite, generates a token, and attempts email (Admin)', async () => {
      const app = createApp(mod, { role: 'Admin' })
      get.mockImplementation(async (sql) => {
        if (sql.includes('FROM members WHERE LOWER(email)')) return undefined // not a member yet
        if (sql.includes('FROM invitations WHERE id')) {
          return {
            id: 1,
            email: 'newbie@test.com',
            role: 'Member',
            token: 'abc123',
            invited_by: 'admin@test.com',
            status: 'pending',
            created_at: 'now',
            expires_at: '2099-01-01',
          }
        }
        return undefined
      })
      run.mockResolvedValue({ lastID: 1, changes: 1 })

      const res = await request(app)
        .post('/api/invitations')
        .send({ email: 'newbie@test.com', role: 'Member' })

      expect(res.status).toBe(201)
      expect(res.body.email).toBe('newbie@test.com')
      // Token was generated: check the INSERT call carried a 64-char hex token
      const insert = run.mock.calls.find((c) => /INSERT INTO invitations/.test(c[0]))
      expect(insert).toBeTruthy()
      expect(insert[1][2]).toMatch(/^[a-f0-9]{64}$/)
      // Email attempted
      expect(sendMail).toHaveBeenCalledTimes(1)
    })

    it('rejects a non-admin (403)', async () => {
      const app = createApp(mod, { role: 'Viewer', isOwner: false })
      const res = await request(app)
        .post('/api/invitations')
        .send({ email: 'x@test.com', role: 'Member' })
      expect(res.status).toBe(403)
    })

    it('rejects an invalid role (400)', async () => {
      const app = createApp(mod, { role: 'Admin' })
      get.mockResolvedValue(undefined)
      const res = await request(app)
        .post('/api/invitations')
        .send({ email: 'x@test.com', role: 'Superuser' })
      expect(res.status).toBe(400)
    })

    it('rejects when email is already a member (409)', async () => {
      const app = createApp(mod, { role: 'Admin' })
      get.mockImplementation(async (sql) => {
        if (sql.includes('FROM members WHERE LOWER(email)')) return { id: 7 }
        return undefined
      })
      const res = await request(app)
        .post('/api/invitations')
        .send({ email: 'exists@test.com', role: 'Member' })
      expect(res.status).toBe(409)
    })
  })

  describe('GET /api/invitations — list (Admin)', () => {
    it('returns invitation list', async () => {
      const app = createApp(mod, { role: 'Admin' })
      all.mockResolvedValue([
        { id: 1, email: 'a@test.com', role: 'Member', invited_by: 'admin@test.com', status: 'pending', created_at: 'now', expires_at: '2099' },
      ])
      const res = await request(app).get('/api/invitations')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })
  })

  describe('GET /api/invitations/:token — lookup', () => {
    it('returns validity for a valid pending token', async () => {
      const app = createApp(mod)
      get.mockResolvedValue({
        id: 1,
        email: 'look@test.com',
        role: 'Member',
        status: 'pending',
        created_at: 'now',
        expires_at: '2099-01-01',
      })
      const res = await request(app).get('/api/invitations/sometoken')
      expect(res.status).toBe(200)
      expect(res.body.valid).toBe(true)
      expect(res.body.email).toBe('look@test.com')
    })

    it('returns 404 for an unknown token', async () => {
      const app = createApp(mod)
      get.mockResolvedValue(undefined)
      const res = await request(app).get('/api/invitations/nope')
      expect(res.status).toBe(404)
    })

    it('flags an expired token as invalid', async () => {
      const app = createApp(mod)
      get.mockResolvedValue({
        id: 1,
        email: 'old@test.com',
        role: 'Member',
        status: 'pending',
        created_at: 'past',
        expires_at: '2000-01-01',
      })
      const res = await request(app).get('/api/invitations/expiredtoken')
      expect(res.status).toBe(200)
      expect(res.body.valid).toBe(false)
      expect(res.body.expired).toBe(true)
    })
  })

  describe('POST /api/invitations/:token/accept', () => {
    it('creates a member with the invited role and marks invite accepted', async () => {
      const app = createApp(mod)
      get.mockImplementation(async (sql) => {
        if (sql.includes('FROM invitations WHERE token')) {
          return { id: 1, email: 'accept@test.com', role: 'Member', status: 'pending', expires_at: '2099-01-01' }
        }
        if (sql.includes('FROM members WHERE LOWER(email)')) return undefined // no member yet
        if (sql.includes('FROM members WHERE id')) {
          return { id: 10, name: 'accept', email: 'accept@test.com', role: 'Member', status: 'Active' }
        }
        return undefined
      })
      run.mockResolvedValue({ lastID: 10, changes: 1 })

      const res = await request(app).post('/api/invitations/goodtoken/accept').send({})
      expect(res.status).toBe(200)
      expect(res.body.member.role).toBe('Member')
      const insert = run.mock.calls.find((c) => /INSERT INTO members/.test(c[0]))
      expect(insert[1][2]).toBe('Member')
      const accepted = run.mock.calls.find((c) => /UPDATE invitations SET status = 'accepted'/.test(c[0]))
      expect(accepted).toBeTruthy()
    })

    it('rejects an expired invitation (400)', async () => {
      const app = createApp(mod)
      get.mockImplementation(async (sql) => {
        if (sql.includes('FROM invitations WHERE token')) {
          return { id: 1, email: 'x@test.com', role: 'Member', status: 'pending', expires_at: '2000-01-01' }
        }
        return undefined
      })
      const res = await request(app).post('/api/invitations/expired/accept').send({})
      expect(res.status).toBe(400)
    })

    it('rejects an unknown token (404)', async () => {
      const app = createApp(mod)
      get.mockResolvedValue(undefined)
      const res = await request(app).post('/api/invitations/ghost/accept').send({})
      expect(res.status).toBe(404)
    })

    it('rejects an already-revoked invitation (400)', async () => {
      const app = createApp(mod)
      get.mockImplementation(async (sql) => {
        if (sql.includes('FROM invitations WHERE token')) {
          return { id: 1, email: 'x@test.com', role: 'Member', status: 'revoked', expires_at: '2099-01-01' }
        }
        return undefined
      })
      const res = await request(app).post('/api/invitations/revoked/accept').send({})
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/invitations/:id — revoke (Admin)', () => {
    it('revokes an existing invitation', async () => {
      const app = createApp(mod, { role: 'Admin' })
      get.mockResolvedValue({ id: 5, status: 'pending' })
      run.mockResolvedValue({ changes: 1 })
      const res = await request(app).delete('/api/invitations/5')
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      const revoke = run.mock.calls.find((c) => /UPDATE invitations SET status = 'revoked'/.test(c[0]))
      expect(revoke).toBeTruthy()
    })

    it('returns 404 for an unknown invitation', async () => {
      const app = createApp(mod, { role: 'Admin' })
      get.mockResolvedValue(undefined)
      const res = await request(app).delete('/api/invitations/999')
      expect(res.status).toBe(404)
    })

    it('rejects a non-admin (403)', async () => {
      const app = createApp(mod, { role: 'Member', isOwner: false })
      const res = await request(app).delete('/api/invitations/5')
      expect(res.status).toBe(403)
    })
  })
})
