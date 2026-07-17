import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (mocked-db style — modeled on collaboration-modules.test.js)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Avoid real SMTP during create-user invite path
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue(true),
  buildInviteEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { hashPassword } from '../middleware/validate.js'

// Helper: mount a route module with an Admin user stub
function createApp(routeModule, mountPath, role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner: false }
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
   Admin create-user  (POST /api/members)
   ================================================================ */
describe('Admin create-user — POST /api/members', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/members.js')
    app = createApp(mod, '/api/members')
  })

  it('creates an invited member successfully (no password → invite email)', async () => {
    get
      .mockResolvedValueOnce(null) // no existing member
      .mockResolvedValueOnce(null) // no existing user
      .mockResolvedValueOnce({
        id: 7, name: 'New Person', email: 'new.person@test.com',
        role: 'Member', status: 'Invited', task_count: 0, invited_by: 'Team Admin',
      })
    run.mockResolvedValue({ lastID: 7, changes: 1 })

    const res = await request(app)
      .post('/api/members')
      .send({ name: 'New Person', email: 'New.Person@test.com', role: 'Member' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe(7)
    expect(res.body.status).toBe('Invited')
    // members insert happened, no users insert (no password)
    const insertedTables = run.mock.calls.map((c) => c[0])
    expect(insertedTables.some((sql) => /INSERT INTO members/i.test(sql))).toBe(true)
    expect(insertedTables.some((sql) => /INSERT INTO users/i.test(sql))).toBe(false)
  })

  it('provisions a login-capable account when a temp password is supplied (status Active)', async () => {
    get
      .mockResolvedValueOnce(null) // no existing member
      .mockResolvedValueOnce(null) // no existing user
      .mockResolvedValueOnce({
        id: 8, name: 'Temp Pw', email: 'temp.pw@test.com',
        role: 'Member', status: 'Active', task_count: 0, invited_by: 'Team Admin',
      })
    run.mockResolvedValue({ lastID: 8, changes: 1 })

    const res = await request(app)
      .post('/api/members')
      .send({ name: 'Temp Pw', email: 'temp.pw@test.com', role: 'Member', password: 'secret123' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('Active')
    const sqls = run.mock.calls.map((c) => c[0])
    expect(sqls.some((sql) => /INSERT INTO users/i.test(sql))).toBe(true)
  })

  it('rejects a duplicate email (existing member) with 409', async () => {
    get.mockResolvedValueOnce({ id: 3 }) // existing member

    const res = await request(app)
      .post('/api/members')
      .send({ name: 'Dup', email: 'dup@test.com', role: 'Member' })

    expect(res.status).toBe(409)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an invalid email with 400', async () => {
    const res = await request(app)
      .post('/api/members')
      .send({ name: 'Bad', email: 'not-an-email', role: 'Member' })

    expect(res.status).toBe(400)
    expect(get).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('forbids non-admins (403)', async () => {
    const mod = await import('../routes/members.js')
    const viewerApp = createApp(mod, '/api/members', 'Viewer')
    const res = await request(viewerApp)
      .post('/api/members')
      .send({ name: 'X', email: 'x@test.com' })
    expect(res.status).toBe(403)
  })
})

/* ================================================================
   Deactivate / Reactivate  (PATCH /api/members/:id/...)
   ================================================================ */
describe('Deactivate / Reactivate member', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/members.js')
    app = createApp(mod, '/api/members')
  })

  it('deactivates a member and syncs the auth user', async () => {
    get.mockResolvedValueOnce({ id: 5, name: 'A', email: 'a@test.com', role: 'Member', status: 'Active' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/members/5/deactivate')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Deactivated')
    const sqls = run.mock.calls.map((c) => c[0])
    expect(sqls.some((sql) => /UPDATE members SET status/i.test(sql))).toBe(true)
    expect(sqls.some((sql) => /UPDATE users SET status/i.test(sql))).toBe(true)
  })

  it('reactivates a member back to Active', async () => {
    get.mockResolvedValueOnce({ id: 5, name: 'A', email: 'a@test.com', role: 'Member', status: 'Deactivated' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/members/5/reactivate')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Active')
  })

  it('returns 404 when deactivating a missing member', async () => {
    get.mockResolvedValueOnce(null)
    const res = await request(app).patch('/api/members/999/deactivate')
    expect(res.status).toBe(404)
  })
})

/* ================================================================
   Login gate  (POST /api/auth/login)
   ================================================================ */
describe('Login gate blocks deactivated accounts', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/auth.js')
    // auth router is mounted without needing an auth stub for /login
    app = express()
    app.use(express.json())
    app.use('/api/auth', mod.default || mod)
    app.use(errorHandler)
  })

  it('blocks a deactivated account with 403 before issuing a JWT', async () => {
    get.mockResolvedValueOnce({
      id: 10,
      email: 'gone@test.com',
      password_hash: hashPassword('secret123'),
      status: 'Deactivated',
      created_at: new Date().toISOString(),
    })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'gone@test.com', password: 'secret123' })

    expect(res.status).toBe(403)
    expect(res.body.token).toBeUndefined()
    expect(res.body.error).toMatch(/deactivated/i)
  })

  it('allows an active account to log in', async () => {
    get.mockResolvedValueOnce({
      id: 11,
      email: 'active@test.com',
      password_hash: hashPassword('secret123'),
      status: 'Active',
      created_at: new Date().toISOString(),
    })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'active@test.com', password: 'secret123' })

    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })
})
