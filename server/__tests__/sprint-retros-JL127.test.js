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

// Sprints route emits webhook events on start/complete — stub the emitter.
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath = '/api') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   JL-127: sprint goal persisted on create + PATCH, returned by mapSprint
   ================================================================ */
describe('Sprints API — goal (JL-127)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/sprints.js')
    app = createApp(mod.default, '/api/sprints')
  })

  it('accepts goal on create and returns it (mapSprint → goal)', async () => {
    get
      .mockResolvedValueOnce({ count: 0 }) // sprint count
      .mockResolvedValueOnce({
        id: 5,
        name: 'Sprint 5',
        date_range: 'Upcoming',
        is_started: false,
        start_date: null,
        end_date: null,
        completed_at: null,
        goal: 'Ship the login flow',
      })
    run.mockResolvedValue({ lastID: 5, changes: 1 })

    const res = await request(app).post('/api/sprints').send({
      name: 'Sprint 5',
      dateRange: 'Upcoming',
      goal: 'Ship the login flow',
    })

    expect(res.status).toBe(201)
    expect(res.body.goal).toBe('Ship the login flow')

    const insertCall = run.mock.calls.find((c) => /INSERT INTO sprints/.test(c[0]))
    expect(insertCall).toBeDefined()
    expect(insertCall[0]).toContain('goal')
    expect(insertCall[1]).toContain('Ship the login flow')
  })

  it('persists goal on PATCH and returns it', async () => {
    run.mockResolvedValue({ changes: 1 })
    get.mockResolvedValueOnce({
      id: 5,
      name: 'Sprint 5',
      date_range: 'Upcoming',
      is_started: false,
      start_date: null,
      end_date: null,
      completed_at: null,
      goal: 'Updated goal',
    })

    const res = await request(app).patch('/api/sprints/5').send({
      name: 'Sprint 5',
      dateRange: 'Upcoming',
      goal: 'Updated goal',
    })

    expect(res.status).toBe(200)
    expect(res.body.goal).toBe('Updated goal')

    const updateCall = run.mock.calls.find((c) => /UPDATE sprints/.test(c[0]) && /goal = \?/.test(c[0]))
    expect(updateCall).toBeDefined()
    expect(updateCall[1]).toContain('Updated goal')
  })

  it('does not touch goal on PATCH when goal key is absent', async () => {
    run.mockResolvedValue({ changes: 1 })
    get.mockResolvedValueOnce({
      id: 5,
      name: 'Renamed',
      date_range: 'Upcoming',
      is_started: false,
      goal: 'Original',
    })

    const res = await request(app).patch('/api/sprints/5').send({ name: 'Renamed' })

    expect(res.status).toBe(200)
    const updateCall = run.mock.calls.find((c) => /UPDATE sprints/.test(c[0]))
    expect(updateCall[0]).not.toContain('goal = ?')
  })
})

/* ================================================================
   JL-127: retrospective notes — add / list / delete by category
   ================================================================ */
describe('Sprint retros API (JL-127)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/sprints.js')
    app = createApp(mod.default, '/api/sprints')
  })

  it('lists retros for a sprint (mapRetro shape)', async () => {
    all.mockResolvedValueOnce([
      { id: 1, sprint_id: 7, category: 'well', text: 'Great collab', author: 'a@b.com', created_at: 'now' },
      { id: 2, sprint_id: 7, category: 'improve', text: 'Slow CI', author: 'a@b.com', created_at: 'now' },
    ])

    const res = await request(app).get('/api/sprints/7/retros')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toMatchObject({ id: 1, sprintId: 7, category: 'well', text: 'Great collab' })
  })

  it('adds a retro note with a valid category', async () => {
    get
      .mockResolvedValueOnce({ id: 7 }) // sprint exists
      .mockResolvedValueOnce({
        id: 10,
        sprint_id: 7,
        category: 'action',
        text: 'Automate deploys',
        author: 'test@test.com',
        created_at: 'now',
      })
    run.mockResolvedValue({ lastID: 10, changes: 1 })

    const res = await request(app).post('/api/sprints/7/retros').send({
      category: 'action',
      text: 'Automate deploys',
    })

    expect(res.status).toBe(201)
    expect(res.body.category).toBe('action')
    expect(res.body.text).toBe('Automate deploys')

    const insertCall = run.mock.calls.find((c) => /INSERT INTO sprint_retros/.test(c[0]))
    expect(insertCall).toBeDefined()
    expect(insertCall[1]).toEqual([7, 'action', 'Automate deploys', 'test@test.com'])
  })

  it('rejects an invalid category (400) and does not insert', async () => {
    const res = await request(app).post('/api/sprints/7/retros').send({
      category: 'bogus',
      text: 'nope',
    })

    expect(res.status).toBe(400)
    expect(run.mock.calls.some((c) => /INSERT INTO sprint_retros/.test(c[0]))).toBe(false)
  })

  it('rejects empty retro text (400)', async () => {
    const res = await request(app).post('/api/sprints/7/retros').send({
      category: 'well',
      text: '   ',
    })

    expect(res.status).toBe(400)
    expect(run.mock.calls.some((c) => /INSERT INTO sprint_retros/.test(c[0]))).toBe(false)
  })

  it('deletes a retro note', async () => {
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).delete('/api/sprints/7/retros/10')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const delCall = run.mock.calls.find((c) => /DELETE FROM sprint_retros/.test(c[0]))
    expect(delCall).toBeDefined()
    expect(delCall[1]).toEqual([10, 7])
  })

  it('returns 404 when deleting a missing retro note', async () => {
    run.mockResolvedValue({ changes: 0 })

    const res = await request(app).delete('/api/sprints/7/retros/999')
    expect(res.status).toBe(404)
  })
})
