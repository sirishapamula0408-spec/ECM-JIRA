import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue(true),
  buildInviteEmail: vi.fn().mockReturnValue({ subject: '', html: '', text: '' }),
}))

import { run, get, tableExists } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

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

let app
beforeEach(async () => {
  vi.clearAllMocks()
  tableExists.mockResolvedValue(false) // skip activity insert
  run.mockResolvedValue({ changes: 1 })
  const mod = await import('../routes/members.js')
  app = createApp(mod)
})

describe('JL-207 — POST /api/members/bulk-delete', () => {
  it('deletes all non-protected ids', async () => {
    get
      .mockResolvedValueOnce({ count: 5 }) // countAdmins
      .mockResolvedValueOnce({ id: 2, email: 'b@test.com', role: 'Viewer', is_owner: false })
      .mockResolvedValueOnce({ id: 3, email: 'c@test.com', role: 'Member', is_owner: false })

    const res = await request(app).post('/api/members/bulk-delete').send({ ids: [2, 3] })
    expect(res.status).toBe(200)
    expect(res.body.deleted).toEqual([2, 3])
    expect(res.body.skipped).toEqual([])
    expect(run).toHaveBeenCalledWith('DELETE FROM members WHERE id = ?', [2])
    expect(run).toHaveBeenCalledWith('DELETE FROM members WHERE id = ?', [3])
  })

  it('skips the Owner and missing ids, deletes the rest', async () => {
    get
      .mockResolvedValueOnce({ count: 5 }) // countAdmins
      .mockResolvedValueOnce({ id: 2, email: 'b@test.com', role: 'Viewer', is_owner: false })
      .mockResolvedValueOnce({ id: 3, email: 'o@test.com', role: 'Owner', is_owner: true })
      .mockResolvedValueOnce(undefined) // id 99 not found

    const res = await request(app).post('/api/members/bulk-delete').send({ ids: [2, 3, 99] })
    expect(res.status).toBe(200)
    expect(res.body.deleted).toEqual([2])
    const reasons = Object.fromEntries(res.body.skipped.map((s) => [s.id, s.reason]))
    expect(reasons[3]).toMatch(/Owner/)
    expect(reasons[99]).toMatch(/not found/)
  })

  it('skips the last remaining Admin (respecting the running count)', async () => {
    // Two admins to start; deleting the first is allowed, the second becomes the last.
    get
      .mockResolvedValueOnce({ count: 2 }) // countAdmins
      .mockResolvedValueOnce({ id: 4, email: 'a1@test.com', role: 'Admin', is_owner: false })
      .mockResolvedValueOnce({ id: 6, email: 'a2@test.com', role: 'Admin', is_owner: false })

    const res = await request(app).post('/api/members/bulk-delete').send({ ids: [4, 6] })
    expect(res.status).toBe(200)
    expect(res.body.deleted).toEqual([4])
    expect(res.body.skipped).toHaveLength(1)
    expect(res.body.skipped[0].id).toBe(6)
    expect(res.body.skipped[0].reason).toMatch(/last remaining Admin/)
  })

  it('writes an audit row per deletion', async () => {
    get
      .mockResolvedValueOnce({ count: 5 })
      .mockResolvedValueOnce({ id: 2, email: 'b@test.com', role: 'Viewer', is_owner: false })

    await request(app).post('/api/members/bulk-delete').send({ ids: [2] })
    const auditCalls = run.mock.calls.filter((c) => String(c[0]).includes('user_audit_log'))
    expect(auditCalls.length).toBe(1)
  })

  it('rejects an empty or invalid ids payload with 400', async () => {
    const empty = await request(app).post('/api/members/bulk-delete').send({ ids: [] })
    expect(empty.status).toBe(400)
    const bad = await request(app).post('/api/members/bulk-delete').send({ ids: 'nope' })
    expect(bad.status).toBe(400)
    expect(get).not.toHaveBeenCalled()
  })

  it('forbids a non-admin (403)', async () => {
    const mod = await import('../routes/members.js')
    const viewerApp = createApp(mod, { workspaceRole: 'Viewer' })
    const res = await request(viewerApp).post('/api/members/bulk-delete').send({ ids: [2] })
    expect(res.status).toBe(403)
  })
})
