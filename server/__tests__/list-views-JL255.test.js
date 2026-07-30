// JL-255 — project-scoped saved views + persistence of the List page's own
// column vocabulary. Mocks the db module (same pattern as list-views-JL122).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, email = 'owner@test.com') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { email, memberId: 7, workspaceRole: 'Member' }
    next()
  })
  app.use('/api/list-views', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

async function loadRoute() {
  return import('../routes/listViews.js')
}

describe('GET /api/list-views — project scoping (JL-255)', () => {
  it('scopes the query to a project when ?projectId is supplied', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'me@test.com')
    all.mockResolvedValue([
      { id: 1, owner_email: 'me@test.com', name: 'Proj View', columns: ['key'], filter_jql: null, is_default: false, project_id: 5, created_at: 'now', updated_at: 'now' },
    ])
    const res = await request(app).get('/api/list-views?projectId=5')
    expect(res.status).toBe(200)
    expect(res.body[0].projectId).toBe(5)
    const sql = all.mock.calls[0][0]
    const params = all.mock.calls[0][1]
    expect(sql).toMatch(/project_id = \?/)
    expect(params).toEqual(['me@test.com', 5])
  })

  it('returns only global views (project_id IS NULL) when no projectId is supplied', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'me@test.com')
    all.mockResolvedValue([])
    const res = await request(app).get('/api/list-views')
    expect(res.status).toBe(200)
    const sql = all.mock.calls[0][0]
    const params = all.mock.calls[0][1]
    expect(sql).toMatch(/project_id IS NULL/)
    expect(params).toEqual(['me@test.com'])
  })
})

describe('POST /api/list-views — project scoping (JL-255)', () => {
  it('persists project_id and accepts the List page column keys', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'owner@test.com')
    run.mockResolvedValue({ lastID: 11 })
    get.mockResolvedValue({ id: 11, owner_email: 'owner@test.com', name: 'L', columns: ['type', 'key', 'summary', 'status', 'comments', 'sprint'], filter_jql: null, is_default: false, project_id: 3, created_at: 'now', updated_at: 'now' })

    const res = await request(app).post('/api/list-views').send({
      name: 'L',
      columns: ['type', 'key', 'summary', 'status', 'comments', 'sprint'],
      projectId: 3,
    })
    expect(res.status).toBe(201)
    expect(res.body.projectId).toBe(3)
    // INSERT carries the project_id as the last param.
    const insert = run.mock.calls.find((c) => /INSERT INTO list_views/.test(c[0]))
    expect(insert).toBeTruthy()
    expect(insert[0]).toMatch(/project_id/)
    expect(insert[1][insert[1].length - 1]).toBe(3)
  })

  it('scopes the default-unset to the same project when isDefault is set', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'owner@test.com')
    run.mockResolvedValue({ lastID: 12 })
    get.mockResolvedValue({ id: 12, owner_email: 'owner@test.com', name: 'D', columns: ['key'], filter_jql: null, is_default: true, project_id: 3, created_at: 'now', updated_at: 'now' })

    const res = await request(app).post('/api/list-views').send({ name: 'D', columns: ['key'], isDefault: true, projectId: 3 })
    expect(res.status).toBe(201)
    // First run() clears defaults only within this project scope.
    expect(run.mock.calls[0][0]).toMatch(/UPDATE list_views SET is_default = FALSE WHERE owner_email = \? AND project_id = \?/)
    expect(run.mock.calls[0][1]).toEqual(['owner@test.com', 3])
  })

  it('unsets global defaults (project_id IS NULL) when no projectId is supplied', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'owner@test.com')
    run.mockResolvedValue({ lastID: 13 })
    get.mockResolvedValue({ id: 13, owner_email: 'owner@test.com', name: 'G', columns: ['key'], filter_jql: null, is_default: true, project_id: null, created_at: 'now', updated_at: 'now' })

    const res = await request(app).post('/api/list-views').send({ name: 'G', columns: ['key'], isDefault: true })
    expect(res.status).toBe(201)
    expect(run.mock.calls[0][0]).toMatch(/UPDATE list_views SET is_default = FALSE WHERE owner_email = \? AND project_id IS NULL/)
    expect(run.mock.calls[0][1]).toEqual(['owner@test.com'])
  })
})
