import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

/**
 * Build an app with a stubbed auth/role middleware. `role` controls the
 * workspace role injected onto req.user so requireRole('Admin'/'Member')
 * can be exercised.
 */
function createApp(routeModule, role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      email: 'test@test.com',
      memberId: 1,
      workspaceRole: role,
      isOwner: false,
    }
    next()
  })
  app.use('/api', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let mod
beforeEach(async () => {
  vi.clearAllMocks()
  mod = await import('../routes/components.js')
})

/* ================= Create ================= */
describe('POST /api/projects/:id/components — create (Admin)', () => {
  it('creates a component when the name is unique', async () => {
    const app = createApp(mod, 'Admin')
    get
      .mockResolvedValueOnce(undefined) // duplicate check → none
      .mockResolvedValueOnce({ id: 7, project_id: 5, name: 'API', description: 'Backend', lead: 'alice' }) // reload
    run.mockResolvedValueOnce({ lastID: 7, changes: 1 })

    const res = await request(app)
      .post('/api/projects/5/components')
      .send({ name: 'API', description: 'Backend', lead: 'alice' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 7, name: 'API', description: 'Backend', lead: 'alice', issueCount: 0 })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty name with 400', async () => {
    const app = createApp(mod, 'Admin')
    const res = await request(app).post('/api/projects/5/components').send({ name: '   ' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a duplicate name with 409', async () => {
    const app = createApp(mod, 'Admin')
    get.mockResolvedValueOnce({ id: 3 }) // existing component with same name
    const res = await request(app).post('/api/projects/5/components').send({ name: 'API' })
    expect(res.status).toBe(409)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 403 for a Viewer', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app).post('/api/projects/5/components').send({ name: 'API' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================= List ================= */
describe('GET /api/projects/:id/components — list with counts', () => {
  it('returns components with issue counts', async () => {
    const app = createApp(mod, 'Viewer')
    all.mockResolvedValueOnce([
      { id: 1, project_id: 5, name: 'API', description: '', lead: '', issueCount: 2 },
      { id: 2, project_id: 5, name: 'UI', description: '', lead: 'bob', issueCount: 0 },
    ])
    const res = await request(app).get('/api/projects/5/components')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({ id: 1, name: 'API', issueCount: 2 })
    expect(res.body[1]).toMatchObject({ id: 2, name: 'UI', lead: 'bob', issueCount: 0 })
  })
})

/* ================= Delete ================= */
describe('DELETE /api/projects/:id/components/:componentId', () => {
  it('deletes a component (Admin)', async () => {
    const app = createApp(mod, 'Admin')
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(app).delete('/api/projects/5/components/7')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(run).toHaveBeenCalledWith(
      'DELETE FROM components WHERE id = ? AND project_id = ?',
      [7, 5],
    )
  })

  it('returns 403 for a Viewer', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app).delete('/api/projects/5/components/7')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================= Issue assignment ================= */
describe('PUT /api/issues/:id/components — replace-all', () => {
  it('replaces the issue components with the provided id list', async () => {
    const app = createApp(mod, 'Member')
    run.mockResolvedValue({ changes: 1 }) // DELETE + inserts
    all.mockResolvedValueOnce([
      { id: 1, project_id: 5, name: 'API', description: '', lead: '' },
      { id: 2, project_id: 5, name: 'UI', description: '', lead: '' },
    ])
    const res = await request(app)
      .put('/api/issues/42/components')
      .send({ componentIds: [1, 2] })

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    // First run() is the DELETE, then one INSERT per component id
    expect(run).toHaveBeenCalledWith('DELETE FROM issue_components WHERE issue_id = ?', [42])
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('clears components when given an empty list', async () => {
    const app = createApp(mod, 'Member')
    run.mockResolvedValue({ changes: 1 })
    all.mockResolvedValueOnce([])
    const res = await request(app).put('/api/issues/42/components').send({ componentIds: [] })
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    // Only the DELETE runs, no inserts
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('returns 403 for a Viewer', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app).put('/api/issues/42/components').send({ componentIds: [1] })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================= GET issue components ================= */
describe('GET /api/issues/:id/components', () => {
  it('returns the components assigned to an issue', async () => {
    const app = createApp(mod, 'Viewer')
    all.mockResolvedValueOnce([{ id: 1, project_id: 5, name: 'API', description: '', lead: '' }])
    const res = await request(app).get('/api/issues/42/components')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('API')
  })
})
