import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Build an app with a stubbed user. Default = workspace Admin (non-owner) with
// no memberId, so loadProjectRole makes no db call and requireProjectRole
// bypasses on the workspace-Admin fast path.
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

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/projects.js')
  app = createApp(mod)
})

describe('JL-212 — PATCH /api/projects/:id/members/:memberId', () => {
  it('changes a member role successfully', async () => {
    get
      .mockResolvedValueOnce({ role: 'Member' }) // existing membership
      .mockResolvedValueOnce({ pm_id: 10, project_role: 'Admin', id: 2, name: 'Bob' }) // final row
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/projects/1/members/2').send({ role: 'Admin' })
    expect(res.status).toBe(200)
    expect(res.body.project_role).toBe('Admin')
    expect(run).toHaveBeenCalledWith(
      'UPDATE project_members SET role = ? WHERE project_id = ? AND member_id = ?',
      ['Admin', 1, 2],
    )
  })

  it('rejects an invalid role with 400', async () => {
    const res = await request(app).patch('/api/projects/1/members/2').send({ role: 'Superuser' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/role must be one of/)
    expect(get).not.toHaveBeenCalled()
  })

  it('returns 404 when the membership does not exist', async () => {
    get.mockResolvedValueOnce(undefined)
    const res = await request(app).patch('/api/projects/1/members/99').send({ role: 'Member' })
    expect(res.status).toBe(404)
  })

  it('blocks demoting the last remaining project admin (409)', async () => {
    get
      .mockResolvedValueOnce({ role: 'Admin' }) // existing membership
      .mockResolvedValueOnce({ count: 1 }) // countProjectAdmins
    const res = await request(app).patch('/api/projects/1/members/2').send({ role: 'Member' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/last remaining project admin/)
    expect(run).not.toHaveBeenCalled()
  })

  it('allows demoting an admin when other admins remain', async () => {
    get
      .mockResolvedValueOnce({ role: 'Admin' }) // existing
      .mockResolvedValueOnce({ count: 2 }) // countProjectAdmins
      .mockResolvedValueOnce({ pm_id: 10, project_role: 'Member', id: 2 }) // final row
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).patch('/api/projects/1/members/2').send({ role: 'Member' })
    expect(res.status).toBe(200)
    expect(res.body.project_role).toBe('Member')
  })

  it('treats Lead as admin tier — Admin → Lead is allowed even as sole admin', async () => {
    get
      .mockResolvedValueOnce({ role: 'Admin' }) // existing
      .mockResolvedValueOnce({ pm_id: 10, project_role: 'Lead', id: 2 }) // final row (no count call)
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).patch('/api/projects/1/members/2').send({ role: 'Lead' })
    expect(res.status).toBe(200)
    expect(res.body.project_role).toBe('Lead')
  })

  it('forbids a non-admin (project Member) from changing roles (403)', async () => {
    const mod = await import('../routes/projects.js')
    app = createApp(mod, { workspaceRole: 'Member', memberId: 5 })
    // loadProjectRole reads the caller's project role
    get.mockResolvedValueOnce({ role: 'Member' })
    const res = await request(app).patch('/api/projects/1/members/2').send({ role: 'Admin' })
    expect(res.status).toBe(403)
  })
})

describe('JL-212 — DELETE /api/projects/:id/members/:memberId guard', () => {
  it('blocks removing the last remaining project admin (409)', async () => {
    get
      .mockResolvedValueOnce({ role: 'Admin' }) // existing membership
      .mockResolvedValueOnce({ count: 1 }) // countProjectAdmins
    const res = await request(app).delete('/api/projects/1/members/2')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/last remaining project admin/)
    expect(run).not.toHaveBeenCalled()
  })

  it('removes a non-admin member normally', async () => {
    get.mockResolvedValueOnce({ role: 'Member' }) // existing membership
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/projects/1/members/2')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(run).toHaveBeenCalledWith(
      'DELETE FROM project_members WHERE project_id = ? AND member_id = ?',
      [1, 2],
    )
  })

  it('removes an admin when other admins remain', async () => {
    get
      .mockResolvedValueOnce({ role: 'Admin' }) // existing
      .mockResolvedValueOnce({ count: 3 }) // countProjectAdmins
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/projects/1/members/2')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})
