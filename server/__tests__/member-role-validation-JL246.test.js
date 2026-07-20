import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (mocked-db style — modeled on user-mgmt-createuser-JL192.test.js)
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

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Helper: mount the members router with an Admin user stub
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
   JL-246: role validation on POST /api/members
   ================================================================ */
describe('JL-246 — POST /api/members validates the role field', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/members.js')
    app = createApp(mod, '/api/members')
  })

  it('rejects an arbitrary role string with 400 and persists nothing', async () => {
    const res = await request(app)
      .post('/api/members')
      .send({ name: 'Bad Role', email: 'bad.role@test.com', role: 'Superuser' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/role must be one of/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects role "Owner" with 400 (Owner is tracked via is_owner, not assignable)', async () => {
    const res = await request(app)
      .post('/api/members')
      .send({ name: 'Wannabe Owner', email: 'owner.try@test.com', role: 'Owner' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/role must be one of/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('accepts a valid role and stores it', async () => {
    get
      .mockResolvedValueOnce(null) // no existing member
      .mockResolvedValueOnce(null) // no existing user
      .mockResolvedValueOnce({
        id: 21, name: 'Good Role', email: 'good.role@test.com',
        role: 'Admin', status: 'Invited', task_count: 0, invited_by: 'Team Admin',
      })
    run.mockResolvedValue({ lastID: 21, changes: 1 })

    const res = await request(app)
      .post('/api/members')
      .send({ name: 'Good Role', email: 'good.role@test.com', role: 'Admin' })

    expect(res.status).toBe(201)
    expect(res.body.role).toBe('Admin')
    const memberInsert = run.mock.calls.find((c) => /INSERT INTO members/i.test(c[0]))
    expect(memberInsert).toBeTruthy()
    expect(memberInsert[1]).toContain('Admin')
  })

  it('defaults to Viewer when no role is supplied', async () => {
    get
      .mockResolvedValueOnce(null) // no existing member
      .mockResolvedValueOnce(null) // no existing user
      .mockResolvedValueOnce({
        id: 22, name: 'No Role', email: 'no.role@test.com',
        role: 'Viewer', status: 'Invited', task_count: 0, invited_by: 'Team Admin',
      })
    run.mockResolvedValue({ lastID: 22, changes: 1 })

    const res = await request(app)
      .post('/api/members')
      .send({ name: 'No Role', email: 'no.role@test.com' })

    expect(res.status).toBe(201)
    const memberInsert = run.mock.calls.find((c) => /INSERT INTO members/i.test(c[0]))
    expect(memberInsert[1]).toContain('Viewer')
  })
})
