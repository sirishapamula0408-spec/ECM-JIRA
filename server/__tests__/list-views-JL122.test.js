import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Build an app whose req.user email is configurable per-test (stubs `protect`).
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

describe('GET /api/list-views', () => {
  it('returns only the caller-scoped views (query filters by owner_email)', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'me@test.com')
    all.mockResolvedValue([
      { id: 1, owner_email: 'me@test.com', name: 'My View', columns: ['key', 'summary'], filter_jql: null, is_default: true, created_at: 'now', updated_at: 'now' },
    ])
    const res = await request(app).get('/api/list-views')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('My View')
    expect(res.body[0].isDefault).toBe(true)
    // scoped to the caller
    const selectSql = all.mock.calls[0][0]
    const selectParams = all.mock.calls[0][1]
    expect(selectSql).toMatch(/owner_email = \?/)
    expect(selectParams).toEqual(['me@test.com'])
  })
})

describe('GET /api/list-views/columns', () => {
  it('exposes the allowed column catalog + defaults', async () => {
    const mod = await loadRoute()
    const app = createApp(mod)
    const res = await request(app).get('/api/list-views/columns')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.allowed)).toBe(true)
    expect(res.body.allowed).toContain('summary')
    expect(res.body.allowed).toContain('status')
    expect(Array.isArray(res.body.defaults)).toBe(true)
  })
})

describe('POST /api/list-views — column validation', () => {
  it('creates a view with valid columns (201)', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'owner@test.com')
    run.mockResolvedValue({ lastID: 5 })
    get.mockResolvedValue({ id: 5, owner_email: 'owner@test.com', name: 'V', columns: ['key', 'status'], filter_jql: 'status = "Done"', is_default: false, created_at: 'now', updated_at: 'now' })

    const res = await request(app).post('/api/list-views').send({ name: 'V', columns: ['key', 'status'], filterJql: 'status = "Done"' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(5)
    expect(res.body.columns).toEqual(['key', 'status'])
  })

  it('rejects an unknown column key (400)', async () => {
    const mod = await loadRoute()
    const app = createApp(mod)
    const res = await request(app).post('/api/list-views').send({ name: 'Bad', columns: ['key', 'not_a_real_column'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Unknown column/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an empty columns array (400)', async () => {
    const mod = await loadRoute()
    const app = createApp(mod)
    const res = await request(app).post('/api/list-views').send({ name: 'Empty', columns: [] })
    expect(res.status).toBe(400)
  })

  it('rejects a missing name (400)', async () => {
    const mod = await loadRoute()
    const app = createApp(mod)
    const res = await request(app).post('/api/list-views').send({ columns: ['key'] })
    expect(res.status).toBe(400)
  })

  it('setting is_default first unsets other defaults for the user', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'owner@test.com')
    run.mockResolvedValue({ lastID: 9 })
    get.mockResolvedValue({ id: 9, owner_email: 'owner@test.com', name: 'D', columns: ['key'], filter_jql: null, is_default: true, created_at: 'now', updated_at: 'now' })

    const res = await request(app).post('/api/list-views').send({ name: 'D', columns: ['key'], isDefault: true })
    expect(res.status).toBe(201)
    // first run() call clears existing defaults
    expect(run.mock.calls[0][0]).toMatch(/UPDATE list_views SET is_default = FALSE WHERE owner_email = \?/)
    expect(run.mock.calls[0][1]).toEqual(['owner@test.com'])
  })
})

describe('PATCH /api/list-views/:id — ownership', () => {
  it('updates an owned view (200)', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'owner@test.com')
    get
      .mockResolvedValueOnce({ id: 1, owner_email: 'owner@test.com', name: 'Old', columns: ['key'], filter_jql: null, is_default: false })
      .mockResolvedValueOnce({ id: 1, owner_email: 'owner@test.com', name: 'New', columns: ['key', 'status'], filter_jql: null, is_default: false, created_at: 'now', updated_at: 'now' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/list-views/1').send({ name: 'New', columns: ['key', 'status'] })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('New')
  })

  it('returns 403 for a non-owner', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'intruder@test.com')
    get.mockResolvedValue({ id: 1, owner_email: 'owner@test.com', name: 'Old', columns: ['key'], filter_jql: null, is_default: false })

    const res = await request(app).patch('/api/list-views/1').send({ name: 'Hijack' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-existent view', async () => {
    const mod = await loadRoute()
    const app = createApp(mod)
    get.mockResolvedValue(null)
    const res = await request(app).patch('/api/list-views/999').send({ name: 'X' })
    expect(res.status).toBe(404)
  })

  it('rejects an unknown column key on update (400)', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'owner@test.com')
    get.mockResolvedValue({ id: 1, owner_email: 'owner@test.com', name: 'Old', columns: ['key'], filter_jql: null, is_default: false })
    const res = await request(app).patch('/api/list-views/1').send({ columns: ['bogus'] })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/list-views/:id — ownership', () => {
  it('deletes an owned view (200)', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'owner@test.com')
    get.mockResolvedValue({ id: 1, owner_email: 'owner@test.com' })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/list-views/1')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(run.mock.calls[0][0]).toMatch(/DELETE FROM list_views/)
  })

  it('returns 403 for a non-owner', async () => {
    const mod = await loadRoute()
    const app = createApp(mod, 'intruder@test.com')
    get.mockResolvedValue({ id: 1, owner_email: 'owner@test.com' })
    const res = await request(app).delete('/api/list-views/1')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 when the view is missing', async () => {
    const mod = await loadRoute()
    const app = createApp(mod)
    get.mockResolvedValue(null)
    const res = await request(app).delete('/api/list-views/5')
    expect(res.status).toBe(404)
  })
})
