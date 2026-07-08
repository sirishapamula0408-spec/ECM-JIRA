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
 * Create an app with a stubbed auth/role middleware. `role` controls the
 * workspace role injected onto req.user so requireRole('Admin') can be tested.
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
  mod = await import('../routes/issueConfig.js')
})

/* ================= Effective GET (merge global + project) ================= */
describe('GET effective priorities/statuses', () => {
  it('returns project-level priorities when the project has its own rows', async () => {
    const app = createApp(mod)
    const projectRows = [{ id: 10, project_id: 5, name: 'Urgent', position: 0, color: '#FF5630' }]
    all.mockResolvedValueOnce(projectRows) // own rows
    const res = await request(app).get('/api/projects/5/priorities')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Urgent')
    // Only one query needed when project has its own rows
    expect(all).toHaveBeenCalledTimes(1)
  })

  it('falls back to global defaults when the project has no priorities', async () => {
    const app = createApp(mod)
    all
      .mockResolvedValueOnce([]) // no project rows
      .mockResolvedValueOnce([   // global defaults
        { id: 1, project_id: null, name: 'Low', position: 1, color: '#79E2F2' },
        { id: 2, project_id: null, name: 'Medium', position: 2, color: '#FFAB00' },
        { id: 3, project_id: null, name: 'High', position: 3, color: '#FF7452' },
      ])
    const res = await request(app).get('/api/projects/5/priorities')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    expect(res.body.map((p) => p.name)).toEqual(['Low', 'Medium', 'High'])
    expect(all).toHaveBeenCalledTimes(2)
  })

  it('returns effective statuses (with category) falling back to globals', async () => {
    const app = createApp(mod)
    all
      .mockResolvedValueOnce([]) // no project rows
      .mockResolvedValueOnce([
        { id: 1, project_id: null, name: 'To Do', position: 1, color: '#42526E', category: 'todo' },
        { id: 2, project_id: null, name: 'Done', position: 4, color: '#36B37E', category: 'done' },
      ])
    const res = await request(app).get('/api/projects/7/statuses')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[1].category).toBe('done')
  })
})

/* ================= Admin create ================= */
describe('POST create priority/status (Admin)', () => {
  it('creates a project priority', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(null) // no existing name
    run.mockResolvedValueOnce({ lastID: 42 })
    get.mockResolvedValueOnce({ id: 42, project_id: 5, name: 'Urgent', position: 0, color: '#FF5630' })
    const res = await request(app).post('/api/projects/5/priorities').send({ name: 'Urgent', color: '#FF5630' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Urgent')
  })

  it('creates a project status with category', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(null)
    run.mockResolvedValueOnce({ lastID: 99 })
    get.mockResolvedValueOnce({ id: 99, project_id: 5, name: 'Blocked', position: 0, color: '#FF5630', category: 'inprogress' })
    const res = await request(app).post('/api/projects/5/statuses').send({ name: 'Blocked', color: '#FF5630', category: 'inprogress' })
    expect(res.status).toBe(201)
    expect(res.body.category).toBe('inprogress')
  })

  it('rejects duplicate priority name with 409', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({ id: 1 }) // existing
    const res = await request(app).post('/api/projects/5/priorities').send({ name: 'Urgent' })
    expect(res.status).toBe(409)
  })
})

/* ================= Validation ================= */
describe('validation', () => {
  it('rejects a priority with an empty name (400)', async () => {
    const app = createApp(mod)
    const res = await request(app).post('/api/projects/5/priorities').send({ name: '   ' })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid hex color (400)', async () => {
    const app = createApp(mod)
    const res = await request(app).post('/api/projects/5/priorities').send({ name: 'Urgent', color: 'red' })
    expect(res.status).toBe(400)
  })

  it('rejects an invalid status category (400)', async () => {
    const app = createApp(mod)
    const res = await request(app).post('/api/projects/5/statuses').send({ name: 'Weird', color: '#FF5630', category: 'bogus' })
    expect(res.status).toBe(400)
  })
})

/* ================= Admin update ================= */
describe('PUT update priority/status (Admin)', () => {
  it('updates a priority', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({ id: 42, project_id: 5, name: 'Urgent', position: 0, color: '#FF5630' }) // existing
    run.mockResolvedValueOnce({ changes: 1 })
    get.mockResolvedValueOnce({ id: 42, project_id: 5, name: 'Critical', position: 0, color: '#FF5630' })
    const res = await request(app).put('/api/priorities/42').send({ name: 'Critical' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Critical')
  })

  it('returns 404 updating a non-existent status', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(null)
    const res = await request(app).put('/api/statuses/999').send({ name: 'X' })
    expect(res.status).toBe(404)
  })
})

/* ================= Admin delete ================= */
describe('DELETE priority/status (Admin)', () => {
  it('deletes a priority', async () => {
    const app = createApp(mod)
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(app).delete('/api/priorities/42')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('deletes a status', async () => {
    const app = createApp(mod)
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(app).delete('/api/statuses/99')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

/* ================= Viewer 403 (admin-gated writes) ================= */
describe('Viewer is forbidden from write operations (403)', () => {
  it('blocks Viewer from creating a priority', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app).post('/api/projects/5/priorities').send({ name: 'Urgent', color: '#FF5630' })
    expect(res.status).toBe(403)
  })

  it('blocks Viewer from creating a status', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app).post('/api/projects/5/statuses').send({ name: 'Blocked', color: '#FF5630', category: 'todo' })
    expect(res.status).toBe(403)
  })

  it('blocks Viewer from deleting a priority', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app).delete('/api/priorities/42')
    expect(res.status).toBe(403)
  })

  it('allows a Viewer to read effective priorities (GET is not gated)', async () => {
    const app = createApp(mod, 'Viewer')
    all.mockResolvedValueOnce([{ id: 1, project_id: null, name: 'Low', position: 1, color: '#79E2F2' }])
    const res = await request(app).get('/api/projects/5/priorities')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })
})
