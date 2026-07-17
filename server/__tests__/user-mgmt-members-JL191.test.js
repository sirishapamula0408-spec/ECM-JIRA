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

import { run, get, tableExists } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Helper: create an app with a stubbed Admin (non-owner) user
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
  tableExists.mockResolvedValue(false) // skip activity insert by default
  const mod = await import('../routes/members.js')
  app = createApp(mod)
})

describe('JL-191 — PATCH /api/members/:id (role update)', () => {
  it('updates a member role successfully', async () => {
    get
      .mockResolvedValueOnce({ id: 2, name: 'Bob', email: 'bob@test.com', role: 'Viewer', is_owner: false }) // fetch target
      .mockResolvedValueOnce({ id: 2, name: 'Bob', email: 'bob@test.com', role: 'Member' }) // fetch updated
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/members/2').send({ role: 'Member' })
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('Member')
    expect(run).toHaveBeenCalledWith('UPDATE members SET role = ? WHERE id = ?', ['Member', 2])
  })

  it('rejects an invalid role with 400', async () => {
    const res = await request(app).patch('/api/members/2').send({ role: 'Superuser' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid role/)
    expect(get).not.toHaveBeenCalled()
  })

  it('returns 404 when member not found', async () => {
    get.mockResolvedValueOnce(undefined)
    const res = await request(app).patch('/api/members/99').send({ role: 'Member' })
    expect(res.status).toBe(404)
  })

  it('forbids changing the workspace Owner (403)', async () => {
    get.mockResolvedValueOnce({ id: 3, email: 'owner@test.com', role: 'Owner', is_owner: true })
    const res = await request(app).patch('/api/members/3').send({ role: 'Member' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/Owner/)
  })

  it('blocks demoting the last remaining Admin (403)', async () => {
    get.mockResolvedValueOnce({ id: 4, email: 'lastadmin@test.com', role: 'Admin', is_owner: false })
    get.mockResolvedValueOnce({ count: 1 }) // countAdmins
    const res = await request(app).patch('/api/members/4').send({ role: 'Member' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/last remaining Admin/)
  })

  it('blocks self-lockout when demoting self as last Admin (403)', async () => {
    // requesting user is memberId 5 demoting themselves
    const mod = await import('../routes/members.js')
    app = createApp(mod, { memberId: 5 })
    get.mockResolvedValueOnce({ id: 5, email: 'admin@test.com', role: 'Admin', is_owner: false })
    get.mockResolvedValueOnce({ count: 1 })
    const res = await request(app).patch('/api/members/5').send({ role: 'Viewer' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/yourself/)
  })

  it('allows demoting an admin when other admins remain', async () => {
    get
      .mockResolvedValueOnce({ id: 4, email: 'a@test.com', role: 'Admin', is_owner: false })
      .mockResolvedValueOnce({ count: 3 }) // countAdmins
      .mockResolvedValueOnce({ id: 4, email: 'a@test.com', role: 'Member' })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).patch('/api/members/4').send({ role: 'Member' })
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('Member')
  })
})

describe('JL-191 — DELETE /api/members/:id', () => {
  it('deletes a member and cleans up project memberships', async () => {
    get.mockResolvedValueOnce({ id: 2, email: 'bob@test.com', role: 'Viewer', is_owner: false })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).delete('/api/members/2')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(run).toHaveBeenCalledWith('DELETE FROM project_members WHERE member_id = ?', [2])
    expect(run).toHaveBeenCalledWith('DELETE FROM members WHERE id = ?', [2])
  })

  it('forbids deleting the workspace Owner (403)', async () => {
    get.mockResolvedValueOnce({ id: 3, email: 'owner@test.com', role: 'Owner', is_owner: true })
    const res = await request(app).delete('/api/members/3')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/Owner/)
  })

  it('blocks deleting the last remaining Admin (403)', async () => {
    get.mockResolvedValueOnce({ id: 4, email: 'lastadmin@test.com', role: 'Admin', is_owner: false })
    get.mockResolvedValueOnce({ count: 1 })
    const res = await request(app).delete('/api/members/4')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/last remaining Admin/)
  })

  it('returns 404 when member not found', async () => {
    get.mockResolvedValueOnce(undefined)
    const res = await request(app).delete('/api/members/99')
    expect(res.status).toBe(404)
  })
})
