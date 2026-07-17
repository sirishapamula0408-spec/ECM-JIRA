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

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

/**
 * Build an app with stubbed auth/role middleware. `role` controls the workspace
 * role injected onto req.user so requireRole('Admin') can be exercised.
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
  mod = await import('../routes/issueTypeSchemes.js')
})

/* ================= Effective GET (project scheme else global default) ================= */
describe('GET effective issue types', () => {
  it('returns the project scheme when the project has its own row', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({
      id: 10, project_id: 5, allowed_types: ['Story', 'Bug'], default_type: 'Bug',
    })
    const res = await request(app).get('/api/projects/5/issue-types')
    expect(res.status).toBe(200)
    expect(res.body.allowedTypes).toEqual(['Story', 'Bug'])
    expect(res.body.defaultType).toBe('Bug')
    expect(res.body.scoped).toBe(true)
    // Only one lookup when the project has its own scheme.
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('falls back to the global default scheme when the project has none', async () => {
    const app = createApp(mod)
    get
      .mockResolvedValueOnce(null) // no project row
      .mockResolvedValueOnce({     // global default
        id: 1, project_id: null,
        allowed_types: ['Story', 'Bug', 'Task', 'Epic', 'Sub-task'],
        default_type: 'Task',
      })
    const res = await request(app).get('/api/projects/9/issue-types')
    expect(res.status).toBe(200)
    expect(res.body.allowedTypes).toEqual(['Story', 'Bug', 'Task', 'Epic', 'Sub-task'])
    expect(res.body.defaultType).toBe('Task')
    expect(res.body.scoped).toBe(false)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('parses a JSON string allowed_types (driver robustness)', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({
      id: 10, project_id: 5, allowed_types: '["Task","Epic"]', default_type: 'Epic',
    })
    const res = await request(app).get('/api/projects/5/issue-types')
    expect(res.status).toBe(200)
    expect(res.body.allowedTypes).toEqual(['Task', 'Epic'])
  })

  it('coerces an out-of-range default to the first allowed type', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({
      id: 10, project_id: 5, allowed_types: ['Story', 'Bug'], default_type: 'Task',
    })
    const res = await request(app).get('/api/projects/5/issue-types')
    expect(res.status).toBe(200)
    expect(res.body.defaultType).toBe('Story')
  })

  it('returns the full universe when no scheme exists at all', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const res = await request(app).get('/api/projects/5/issue-types')
    expect(res.status).toBe(200)
    expect(res.body.allowedTypes).toEqual(['Epic', 'Story', 'Bug', 'Task', 'Sub-task'])
    expect(res.body.fallback).toBe(true)
  })

  it('is readable by a Viewer (GET is not role-gated)', async () => {
    const app = createApp(mod, 'Viewer')
    get.mockResolvedValueOnce({ id: 10, project_id: 5, allowed_types: ['Task'], default_type: 'Task' })
    const res = await request(app).get('/api/projects/5/issue-types')
    expect(res.status).toBe(200)
    expect(res.body.allowedTypes).toEqual(['Task'])
  })
})

/* ================= Admin PUT (set allowed types + default) ================= */
describe('PUT set issue types (Admin)', () => {
  it('inserts a new project scheme', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(null) // no existing scheme
    run.mockResolvedValueOnce({ lastID: 7 })
    const res = await request(app)
      .put('/api/projects/5/issue-types')
      .send({ allowedTypes: ['Story', 'Bug', 'Task'], defaultType: 'Bug' })
    expect(res.status).toBe(200)
    expect(res.body.allowedTypes).toEqual(['Story', 'Bug', 'Task'])
    expect(res.body.defaultType).toBe('Bug')
    expect(res.body.scoped).toBe(true)
    // INSERT path used when no existing scheme.
    expect(run.mock.calls[0][0]).toMatch(/INSERT INTO issue_type_schemes/)
  })

  it('updates an existing project scheme', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({ id: 7 }) // existing scheme
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(app)
      .put('/api/projects/5/issue-types')
      .send({ allowedTypes: ['Task', 'Epic'], defaultType: 'Epic' })
    expect(res.status).toBe(200)
    expect(res.body.defaultType).toBe('Epic')
    expect(run.mock.calls[0][0]).toMatch(/UPDATE issue_type_schemes/)
  })

  it('dedupes types and coerces an invalid default to the first allowed', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(null)
    run.mockResolvedValueOnce({ lastID: 8 })
    const res = await request(app)
      .put('/api/projects/5/issue-types')
      .send({ allowedTypes: ['Story', 'Story', 'Bug'], defaultType: 'Task' })
    expect(res.status).toBe(200)
    expect(res.body.allowedTypes).toEqual(['Story', 'Bug'])
    expect(res.body.defaultType).toBe('Story')
  })
})

/* ================= Validation ================= */
describe('PUT validation', () => {
  it('rejects an empty allowedTypes array (400)', async () => {
    const app = createApp(mod)
    const res = await request(app).put('/api/projects/5/issue-types').send({ allowedTypes: [] })
    expect(res.status).toBe(400)
  })

  it('rejects a non-array allowedTypes (400)', async () => {
    const app = createApp(mod)
    const res = await request(app).put('/api/projects/5/issue-types').send({ allowedTypes: 'Task' })
    expect(res.status).toBe(400)
  })

  it('rejects an unknown issue type (400)', async () => {
    const app = createApp(mod)
    const res = await request(app)
      .put('/api/projects/5/issue-types')
      .send({ allowedTypes: ['Story', 'Widget'], defaultType: 'Story' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Widget/)
  })
})

/* ================= Viewer 403 (admin-gated write) ================= */
describe('Viewer is forbidden from setting issue types (403)', () => {
  it('blocks a Viewer from the PUT', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app)
      .put('/api/projects/5/issue-types')
      .send({ allowedTypes: ['Task'], defaultType: 'Task' })
    expect(res.status).toBe(403)
  })

  it('blocks a Member from the PUT', async () => {
    const app = createApp(mod, 'Member')
    const res = await request(app)
      .put('/api/projects/5/issue-types')
      .send({ allowedTypes: ['Task'], defaultType: 'Task' })
    expect(res.status).toBe(403)
  })
})
