import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Helper: create an app with a stubbed user. memberId is null so
// loadProjectRole skips its DB lookup; workspaceRole 'Admin' bypasses
// requireProjectRole, matching the JL-197 test harness style.
function createApp(routeModule, user = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      email: 'admin@test.com',
      memberId: null,
      workspaceRole: 'Admin',
      isOwner: false,
      ...user,
    }
    next()
  })
  app.use('/api/projects', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

// Find the run() calls whose SQL targets the audit table.
function auditInserts() {
  return run.mock.calls.filter((c) => /user_audit_log/i.test(c[0]))
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/projects.js')
  app = createApp(mod)
})

describe('JL-213 — audit on POST /api/projects/:id/members (add member)', () => {
  it('writes a project_member_added audit row with actor, member id, and role', async () => {
    run.mockResolvedValue({ changes: 1 })
    // Route get(): fetch the joined project-member row after insert
    get.mockResolvedValueOnce({
      pm_id: 10, project_role: 'Member', id: 5, name: 'Bob',
      email: 'bob@test.com', global_role: 'Member', status: 'Active',
    })

    const res = await request(app)
      .post('/api/projects/7/members')
      .send({ memberId: 5, role: 'Member' })
    expect(res.status).toBe(201)

    const inserts = auditInserts()
    expect(inserts.length).toBe(1)
    const params = inserts[0][1]
    // params: [actor, targetMemberId, targetEmail, action, before, after]
    expect(params[0]).toBe('admin@test.com')
    expect(params[1]).toBe(5)
    expect(params[2]).toBe('bob@test.com')
    expect(params[3]).toBe('project_member_added')
    expect(params[4]).toBeNull()
    expect(params[5]).toBe('project:7 / Member')
  })

  it('defaults an invalid role to Member in the audit after_value', async () => {
    run.mockResolvedValue({ changes: 1 })
    get.mockResolvedValueOnce({ pm_id: 11, id: 5, email: 'bob@test.com' })

    const res = await request(app)
      .post('/api/projects/7/members')
      .send({ memberId: 5, role: 'Superuser' })
    expect(res.status).toBe(201)

    const inserts = auditInserts()
    expect(inserts.length).toBe(1)
    expect(inserts[0][1][5]).toBe('project:7 / Member')
  })

  it('does not audit when memberId is invalid (400)', async () => {
    const res = await request(app)
      .post('/api/projects/7/members')
      .send({ role: 'Member' })
    expect(res.status).toBe(400)
    expect(auditInserts().length).toBe(0)
  })
})

describe('JL-213 — audit on DELETE /api/projects/:id/members/:memberId (remove member)', () => {
  it('writes a project_member_removed audit row with the prior role as before_value', async () => {
    run.mockResolvedValue({ changes: 1 })
    // Route get(): existing assignment lookup before delete
    get.mockResolvedValueOnce({ role: 'Admin', email: 'bob@test.com' })

    const res = await request(app).delete('/api/projects/7/members/5')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    const inserts = auditInserts()
    expect(inserts.length).toBe(1)
    const params = inserts[0][1]
    expect(params[0]).toBe('admin@test.com')
    expect(params[1]).toBe(5)
    expect(params[2]).toBe('bob@test.com')
    expect(params[3]).toBe('project_member_removed')
    expect(params[4]).toBe('project:7 / Admin')
    expect(params[5]).toBeNull()
  })

  it('still audits (project id only) when the assignment row is missing', async () => {
    run.mockResolvedValue({ changes: 1 })
    get.mockResolvedValueOnce(undefined)

    const res = await request(app).delete('/api/projects/7/members/5')
    expect(res.status).toBe(200)

    const inserts = auditInserts()
    expect(inserts.length).toBe(1)
    expect(inserts[0][1][3]).toBe('project_member_removed')
    expect(inserts[0][1][4]).toBe('project:7')
    expect(inserts[0][1][2]).toBeNull()
  })
})

describe('JL-213 — audit failures are non-fatal', () => {
  it('add member still succeeds when the audit INSERT rejects', async () => {
    run.mockImplementation((sql) => {
      if (/user_audit_log/i.test(sql)) return Promise.reject(new Error('boom'))
      return Promise.resolve({ changes: 1 })
    })
    get.mockResolvedValueOnce({ pm_id: 10, id: 5, email: 'bob@test.com' })

    const res = await request(app)
      .post('/api/projects/7/members')
      .send({ memberId: 5, role: 'Viewer' })
    expect(res.status).toBe(201)
  })

  it('remove member still succeeds when the audit INSERT rejects', async () => {
    run.mockImplementation((sql) => {
      if (/user_audit_log/i.test(sql)) return Promise.reject(new Error('boom'))
      return Promise.resolve({ changes: 1 })
    })
    get.mockResolvedValueOnce({ role: 'Member', email: 'bob@test.com' })

    const res = await request(app).delete('/api/projects/7/members/5')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
