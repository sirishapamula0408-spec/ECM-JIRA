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

// Build an app with a stubbed auth/role middleware. `role` controls the
// workspace role injected onto req.user so requireRole('Admin') can be tested.
function createApp(routeModule, role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use('/api', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let mod
beforeEach(async () => {
  vi.clearAllMocks()
  mod = await import('../routes/boardConfig.js')
})

/* ================= GET board config ================= */
describe('GET /api/projects/:id/board-config', () => {
  it('returns saved config for a project', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({
      project_id: 5,
      swimlane_by: 'assignee',
      wip_limits: { 'In Progress': 3 },
      quick_filters: [{ cat: 'type', value: 'Bug' }],
    })
    const res = await request(app).get('/api/projects/5/board-config')
    expect(res.status).toBe(200)
    expect(res.body.swimlaneBy).toBe('assignee')
    expect(res.body.wipLimits['In Progress']).toBe(3)
    expect(res.body.quickFilters).toHaveLength(1)
  })

  it('returns defaults when no config row exists', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(null)
    const res = await request(app).get('/api/projects/9/board-config')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ projectId: 9, swimlaneBy: 'none', wipLimits: {}, quickFilters: [] })
  })

  it('parses JSONB columns returned as raw strings', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({
      project_id: 5,
      swimlane_by: 'priority',
      wip_limits: '{"Done":10}',
      quick_filters: '[]',
    })
    const res = await request(app).get('/api/projects/5/board-config')
    expect(res.status).toBe(200)
    expect(res.body.wipLimits.Done).toBe(10)
  })

  it('allows a Viewer to read config (GET is not gated)', async () => {
    const app = createApp(mod, 'Viewer')
    get.mockResolvedValueOnce(null)
    const res = await request(app).get('/api/projects/5/board-config')
    expect(res.status).toBe(200)
  })
})

/* ================= PUT board config (Admin) ================= */
describe('PUT /api/projects/:id/board-config (Admin)', () => {
  it('upserts a valid config', async () => {
    const app = createApp(mod)
    run.mockResolvedValueOnce({ lastID: 1 })
    get.mockResolvedValueOnce({
      project_id: 5,
      swimlane_by: 'assignee',
      wip_limits: { 'In Progress': 2 },
      quick_filters: [],
    })
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'assignee', wipLimits: { 'In Progress': 2 }, quickFilters: [] })
    expect(res.status).toBe(200)
    expect(res.body.swimlaneBy).toBe('assignee')
    expect(res.body.wipLimits['In Progress']).toBe(2)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid swimlane mode with 400', async () => {
    const app = createApp(mod)
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'bogus', wipLimits: {}, quickFilters: [] })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a negative WIP limit with 400', async () => {
    const app = createApp(mod)
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: { 'To Do': -3 }, quickFilters: [] })
    expect(res.status).toBe(400)
  })

  it('rejects wipLimits that are not an object with 400', async () => {
    const app = createApp(mod)
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: [1, 2], quickFilters: [] })
    expect(res.status).toBe(400)
  })

  it('rejects quickFilters that are not an array with 400', async () => {
    const app = createApp(mod)
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: {}, quickFilters: { bad: true } })
    expect(res.status).toBe(400)
  })

  it('blocks a Viewer from saving config (403)', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'assignee', wipLimits: {}, quickFilters: [] })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('blocks a Member from saving config (403)', async () => {
    const app = createApp(mod, 'Member')
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: {}, quickFilters: [] })
    expect(res.status).toBe(403)
  })
})
