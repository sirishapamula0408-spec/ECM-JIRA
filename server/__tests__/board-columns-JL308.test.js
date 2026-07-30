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
// workspace role injected onto req.user so requireRole('Admin') gating is testable.
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

/* ================= GET columns ================= */
describe('JL-308 GET /api/projects/:id/board-config — columns', () => {
  it('returns the saved column configuration with status mapping', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({
      project_id: 5,
      swimlane_by: 'none',
      wip_limits: {},
      quick_filters: [],
      estimation_statistic: 'story_points',
      columns: [
        { id: 'c1', name: 'Ready', statuses: ['To Do'] },
        { id: 'c2', name: 'Working', statuses: ['In Progress', 'Code Review'] },
      ],
    })
    const res = await request(app).get('/api/projects/5/board-config')
    expect(res.status).toBe(200)
    expect(res.body.columns).toHaveLength(2)
    expect(res.body.columns[1].name).toBe('Working')
    expect(res.body.columns[1].statuses).toEqual(['In Progress', 'Code Review'])
  })

  it('defaults columns to an empty array when no config row exists', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(null)
    const res = await request(app).get('/api/projects/9/board-config')
    expect(res.status).toBe(200)
    expect(res.body.columns).toEqual([])
  })

  it('parses columns returned as a raw JSON string', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({
      project_id: 5,
      swimlane_by: 'none',
      wip_limits: {},
      quick_filters: [],
      estimation_statistic: 'story_points',
      columns: '[{"id":"c1","name":"Done","statuses":["Done"]}]',
    })
    const res = await request(app).get('/api/projects/5/board-config')
    expect(res.status).toBe(200)
    expect(res.body.columns[0].name).toBe('Done')
  })
})

/* ================= PUT columns (Admin) ================= */
describe('JL-308 PUT /api/projects/:id/board-config — columns', () => {
  it('persists a valid column configuration and echoes it back', async () => {
    const app = createApp(mod)
    run.mockResolvedValueOnce({ lastID: 1 })
    get.mockResolvedValueOnce({
      project_id: 5,
      swimlane_by: 'none',
      wip_limits: {},
      quick_filters: [],
      estimation_statistic: 'story_points',
      columns: [
        { id: 'c1', name: 'Ready', statuses: ['Backlog', 'To Do'] },
        { id: 'c2', name: 'Done', statuses: ['Done'] },
      ],
    })
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({
        swimlaneBy: 'none',
        wipLimits: {},
        quickFilters: [],
        columns: [
          { id: 'c1', name: 'Ready', statuses: ['Backlog', 'To Do'] },
          { id: 'c2', name: 'Done', statuses: ['Done'] },
        ],
      })
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(1)
    // The columns JSON is passed as the 6th positional param.
    const params = run.mock.calls[0][1]
    const savedColumns = JSON.parse(params[5])
    expect(savedColumns).toHaveLength(2)
    expect(savedColumns[0].statuses).toEqual(['Backlog', 'To Do'])
    expect(res.body.columns).toHaveLength(2)
  })

  it('generates an id for a column that omits one', async () => {
    const app = createApp(mod)
    run.mockResolvedValueOnce({ lastID: 1 })
    get.mockResolvedValueOnce({ project_id: 5, swimlane_by: 'none', wip_limits: {}, quick_filters: [], estimation_statistic: 'story_points', columns: [] })
    await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: {}, quickFilters: [], columns: [{ name: 'New', statuses: [] }] })
    const savedColumns = JSON.parse(run.mock.calls[0][1][5])
    expect(savedColumns[0].id).toBeTruthy()
  })

  it('rejects a status mapped to more than one column (400)', async () => {
    const app = createApp(mod)
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({
        swimlaneBy: 'none',
        wipLimits: {},
        quickFilters: [],
        columns: [
          { id: 'c1', name: 'A', statuses: ['To Do'] },
          { id: 'c2', name: 'B', statuses: ['To Do'] },
        ],
      })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/more than one column/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a column with no name (400)', async () => {
    const app = createApp(mod)
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: {}, quickFilters: [], columns: [{ name: '  ', statuses: [] }] })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects columns that are not an array (400)', async () => {
    const app = createApp(mod)
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: {}, quickFilters: [], columns: { bad: true } })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('accepts a config with columns omitted (backward compatible)', async () => {
    const app = createApp(mod)
    run.mockResolvedValueOnce({ lastID: 1 })
    get.mockResolvedValueOnce({ project_id: 5, swimlane_by: 'none', wip_limits: {}, quick_filters: [], estimation_statistic: 'story_points', columns: [] })
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: {}, quickFilters: [] })
    expect(res.status).toBe(200)
    expect(JSON.parse(run.mock.calls[0][1][5])).toEqual([])
  })

  it('blocks a Viewer from saving columns (403)', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: {}, quickFilters: [], columns: [{ name: 'A', statuses: [] }] })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('blocks a Member from saving columns (403)', async () => {
    const app = createApp(mod, 'Member')
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ swimlaneBy: 'none', wipLimits: {}, quickFilters: [], columns: [{ name: 'A', statuses: [] }] })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})
