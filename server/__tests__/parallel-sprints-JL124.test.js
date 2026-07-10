import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB — same pattern as reporting-foundation-JL86.test.js)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Sprint start emits a webhook event — stub it so it can't touch the mocked db.
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import sprintRoutes, { projectSprintRouter, canStartSprint } from '../routes/sprints.js'

// Build an app with an auth/role stub. `role` controls the injected workspace role.
function createApp(routeModule, mountPath = '/api', role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

const FINAL_ROW = {
  id: 7, name: 'Sprint 7', date_range: 'Jul 1 - Jul 14',
  is_started: true, start_date: '2026-07-01T00:00:00.000Z', end_date: null, completed_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ===================== canStartSprint (pure helper) ===================== */
describe('canStartSprint', () => {
  it('allows the first sprint regardless of the parallel setting', () => {
    expect(canStartSprint({ activeCount: 0, allowParallel: false })).toBe(true)
    expect(canStartSprint({ activeCount: 0, allowParallel: true })).toBe(true)
  })

  it('blocks a 2nd concurrent sprint when parallel is disabled', () => {
    expect(canStartSprint({ activeCount: 1, allowParallel: false })).toBe(false)
    expect(canStartSprint({ activeCount: 5, allowParallel: false })).toBe(false)
  })

  it('allows a 2nd concurrent sprint when parallel is enabled', () => {
    expect(canStartSprint({ activeCount: 1, allowParallel: true })).toBe(true)
    expect(canStartSprint({ activeCount: 9, allowParallel: true })).toBe(true)
  })

  it('treats missing/invalid activeCount as zero (defensive)', () => {
    expect(canStartSprint({ allowParallel: false })).toBe(true)
    expect(canStartSprint({ activeCount: NaN, allowParallel: false })).toBe(true)
  })
})

/* ============ GET /api/projects/:id/sprints/active (array) ============ */
describe('GET /api/projects/:id/sprints/active', () => {
  it('returns ALL currently-active sprints as an array', async () => {
    const app = createApp(projectSprintRouter)
    all.mockResolvedValueOnce([
      { id: 7, name: 'Sprint 7', date_range: 'x', is_started: true, start_date: null, end_date: null, completed_at: null },
      { id: 8, name: 'Sprint 8', date_range: 'y', is_started: true, start_date: null, end_date: null, completed_at: null },
    ])
    const res = await request(app).get('/api/projects/5/sprints/active')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(2)
    expect(res.body.every((s) => s.isStarted === true)).toBe(true)
    // Query must filter to started sprints only
    expect(all.mock.calls[0][0]).toMatch(/is_started = TRUE/)
  })

  it('returns an empty array when no sprint is active', async () => {
    const app = createApp(projectSprintRouter)
    all.mockResolvedValueOnce([])
    const res = await request(app).get('/api/projects/5/sprints/active')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

/* ============ PATCH /api/sprints/:id/start — parallel gating ============ */
describe('PATCH /api/sprints/:id/start (parallel gating)', () => {
  it('starts the first sprint (no other active) with 200', async () => {
    const app = createApp(sprintRoutes, '/api/sprints')
    get.mockResolvedValueOnce({ count: 0 }) // active-count check
    run.mockResolvedValue({ changes: 1 })
    all.mockResolvedValueOnce([]) // no issues to snapshot
    get.mockResolvedValueOnce(FINAL_ROW) // final row

    const res = await request(app).patch('/api/sprints/7/start')
    expect(res.status).toBe(200)
    expect(res.body.isStarted).toBe(true)
  })

  it('returns 409 when parallel is OFF and another sprint is already active', async () => {
    const app = createApp(sprintRoutes, '/api/sprints')
    get.mockResolvedValueOnce({ allow_parallel_sprints: false }) // project setting
    get.mockResolvedValueOnce({ count: 1 }) // one other active sprint

    const res = await request(app).patch('/api/sprints/7/start').send({ projectId: 5 })
    expect(res.status).toBe(409)
    // No state mutation attempted
    const started = run.mock.calls.find((c) => /is_started = TRUE/.test(c[0]))
    expect(started).toBeUndefined()
  })

  it('allows a 2nd concurrent sprint (200) when parallel is ON', async () => {
    const app = createApp(sprintRoutes, '/api/sprints')
    get.mockResolvedValueOnce({ allow_parallel_sprints: true }) // project setting
    get.mockResolvedValueOnce({ count: 1 }) // one other active sprint
    run.mockResolvedValue({ changes: 1 })
    all.mockResolvedValueOnce([]) // no issues to snapshot
    get.mockResolvedValueOnce(FINAL_ROW) // final row

    const res = await request(app).patch('/api/sprints/7/start').send({ projectId: 5 })
    expect(res.status).toBe(200)
    expect(res.body.isStarted).toBe(true)
    const started = run.mock.calls.find((c) => /is_started = TRUE/.test(c[0]))
    expect(started).toBeDefined()
  })
})

/* ============ PUT /api/projects/:id/sprints/settings (Admin) ============ */
describe('PUT /api/projects/:id/sprints/settings', () => {
  it('lets an Admin enable parallel sprints', async () => {
    const app = createApp(projectSprintRouter)
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(app)
      .put('/api/projects/5/sprints/settings')
      .send({ allowParallelSprints: true })
    expect(res.status).toBe(200)
    expect(res.body.allowParallelSprints).toBe(true)
  })

  it('blocks a Viewer from toggling the setting (403)', async () => {
    const app = createApp(projectSprintRouter, '/api', 'Viewer')
    const res = await request(app)
      .put('/api/projects/5/sprints/settings')
      .send({ allowParallelSprints: true })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})
