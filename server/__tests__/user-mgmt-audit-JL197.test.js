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

// Mock the mailer so no email is attempted
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue(true),
  buildInviteEmail: vi.fn().mockReturnValue({ subject: '', html: '', text: '' }),
}))

import { run, all, get, tableExists } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Helper: create an app with a stubbed user (defaults to non-owner Admin)
function createApp(routeModule, user = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      email: 'admin@test.com',
      memberId: 1,
      workspaceRole: 'Admin',
      isOwner: false,
      ...user,
    }
    next()
  })
  app.use('/api/members', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

// Find the run() call whose SQL targets the audit table.
function auditInserts() {
  return run.mock.calls.filter((c) => /user_audit_log/i.test(c[0]))
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  tableExists.mockResolvedValue(false) // skip legacy activity insert
  const mod = await import('../routes/members.js')
  app = createApp(mod)
})

describe('JL-197 — audit emission from member endpoints', () => {
  it('writes an audit row on role change (before → after)', async () => {
    get
      .mockResolvedValueOnce({ id: 2, name: 'Bob', email: 'bob@test.com', role: 'Viewer', is_owner: false })
      .mockResolvedValueOnce({ id: 2, name: 'Bob', email: 'bob@test.com', role: 'Member' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/members/2').send({ role: 'Member' })
    expect(res.status).toBe(200)

    const inserts = auditInserts()
    expect(inserts.length).toBe(1)
    const params = inserts[0][1]
    // params: [actor, targetMemberId, targetEmail, action, before, after]
    expect(params[0]).toBe('admin@test.com')
    expect(params[1]).toBe(2)
    expect(params[2]).toBe('bob@test.com')
    expect(params[3]).toBe('role_changed')
    expect(params[4]).toBe('Viewer')
    expect(params[5]).toBe('Member')
  })

  it('writes an audit row on deactivate (status before → after)', async () => {
    get.mockResolvedValueOnce({ id: 3, name: 'Amy', email: 'amy@test.com', role: 'Member', status: 'Active' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/members/3/deactivate')
    expect(res.status).toBe(200)

    const inserts = auditInserts()
    expect(inserts.length).toBe(1)
    const params = inserts[0][1]
    expect(params[3]).toBe('deactivated')
    expect(params[4]).toBe('Active')
    expect(params[5]).toBe('Deactivated')
  })

  it('writes an audit row on reactivate', async () => {
    get.mockResolvedValueOnce({ id: 3, name: 'Amy', email: 'amy@test.com', role: 'Member', status: 'Deactivated' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/members/3/reactivate')
    expect(res.status).toBe(200)

    const inserts = auditInserts()
    expect(inserts.length).toBe(1)
    expect(inserts[0][1][3]).toBe('reactivated')
    expect(inserts[0][1][5]).toBe('Active')
  })

  it('writes an audit row on delete', async () => {
    get.mockResolvedValueOnce({ id: 4, email: 'gone@test.com', role: 'Viewer', is_owner: false })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).delete('/api/members/4')
    expect(res.status).toBe(200)

    const inserts = auditInserts()
    expect(inserts.length).toBe(1)
    expect(inserts[0][1][3]).toBe('deleted')
    expect(inserts[0][1][2]).toBe('gone@test.com')
  })

  it('audit failure is non-fatal (action still succeeds)', async () => {
    get
      .mockResolvedValueOnce({ id: 2, name: 'Bob', email: 'bob@test.com', role: 'Viewer', is_owner: false })
      .mockResolvedValueOnce({ id: 2, name: 'Bob', email: 'bob@test.com', role: 'Member' })
    // UPDATE succeeds, audit INSERT rejects
    run.mockImplementation((sql) => {
      if (/user_audit_log/i.test(sql)) return Promise.reject(new Error('boom'))
      return Promise.resolve({ changes: 1 })
    })

    const res = await request(app).patch('/api/members/2').send({ role: 'Member' })
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('Member')
  })
})

describe('JL-197 — GET /api/members/audit', () => {
  it('returns entries newest-first with a default limit', async () => {
    const rows = [
      { id: 10, actor: 'admin@test.com', target_member_id: 2, target_email: 'bob@test.com', action: 'role_changed', before_value: 'Viewer', after_value: 'Member', created_at: '2026-07-17T10:00:00Z' },
      { id: 9, actor: 'admin@test.com', target_member_id: 3, target_email: 'amy@test.com', action: 'deactivated', before_value: 'Active', after_value: 'Deactivated', created_at: '2026-07-17T09:00:00Z' },
    ]
    all.mockResolvedValueOnce(rows)

    const res = await request(app).get('/api/members/audit')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].id).toBe(10)

    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/ORDER BY id DESC/)
    expect(sql).toMatch(/user_audit_log/)
    expect(params[params.length - 1]).toBe(100) // default limit
  })

  it('filters by target email', async () => {
    all.mockResolvedValueOnce([])
    const res = await request(app).get('/api/members/audit?target=bob@test.com')
    expect(res.status).toBe(200)

    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/LOWER\(target_email\) = LOWER\(\?\)/)
    expect(params).toContain('bob@test.com')
  })

  it('filters by numeric target as member id', async () => {
    all.mockResolvedValueOnce([])
    const res = await request(app).get('/api/members/audit?target=7')
    expect(res.status).toBe(200)

    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/target_member_id = \?/)
    expect(params).toContain(7)
  })

  it('filters by action', async () => {
    all.mockResolvedValueOnce([])
    const res = await request(app).get('/api/members/audit?action=deleted')
    expect(res.status).toBe(200)

    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/action = \?/)
    expect(params).toContain('deleted')
  })

  it('caps the limit at 500', async () => {
    all.mockResolvedValueOnce([])
    const res = await request(app).get('/api/members/audit?limit=9999')
    expect(res.status).toBe(200)
    const params = all.mock.calls[0][1]
    expect(params[params.length - 1]).toBe(500)
  })

  it('rejects a non-admin with 403', async () => {
    const mod = await import('../routes/members.js')
    const viewerApp = createApp(mod, { workspaceRole: 'Viewer', isOwner: false })
    const res = await request(viewerApp).get('/api/members/audit')
    expect(res.status).toBe(403)
    expect(all).not.toHaveBeenCalled()
  })
})
