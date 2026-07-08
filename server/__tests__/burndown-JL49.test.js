import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB — same pattern as reporting-foundation-JL86).
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import reportRoutes from '../routes/reports.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/reports', reportRoutes)
  app.use(errorHandler)
  return app
}

const app = createApp()

// A 3-day sprint: Jan 1 → Jan 3, 2026 (UTC).
const SPRINT = {
  id: 7,
  name: 'Sprint 7',
  start_date: '2026-01-01T00:00:00.000Z',
  end_date: '2026-01-03T00:00:00.000Z',
  completed_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   JL-49: Burndown
   ================================================================ */
describe('GET /api/reports/burndown (JL-49)', () => {
  it('computes remaining series + a linear ideal line from committed scope', async () => {
    get.mockResolvedValueOnce(SPRINT)
    // scope: 3 issues committed at start = 5 + 3 + 2 = 10 points
    all.mockResolvedValueOnce([
      { issue_id: 1, points: 5, added_at: SPRINT.start_date, removed_at: null, issue_type: 'Story', story_points: 5 },
      { issue_id: 2, points: 3, added_at: SPRINT.start_date, removed_at: null, issue_type: 'Task', story_points: 3 },
      { issue_id: 3, points: 2, added_at: SPRINT.start_date, removed_at: null, issue_type: 'Bug', story_points: 2 },
    ])
    // Done events: issue 1 on day 1, issue 2 on day 2, issue 3 never
    all.mockResolvedValueOnce([
      { issue_id: 1, done_at: '2026-01-01T10:00:00.000Z' },
      { issue_id: 2, done_at: '2026-01-02T10:00:00.000Z' },
    ])

    const res = await request(app).get('/api/reports/burndown?sprintId=7')
    expect(res.status).toBe(200)
    expect(res.body.committedPoints).toBe(10)
    expect(res.body.unit).toBe('points')
    expect(res.body.days).toEqual([
      { date: '2026-01-01', ideal: 10, remaining: 5 },
      { date: '2026-01-02', ideal: 5, remaining: 2 },
      { date: '2026-01-03', ideal: 0, remaining: 2 },
    ])
  })

  it('supports unit=count (each issue weighs 1)', async () => {
    get.mockResolvedValueOnce(SPRINT)
    all.mockResolvedValueOnce([
      { issue_id: 1, points: 5, added_at: SPRINT.start_date, removed_at: null, issue_type: 'Story', story_points: 5 },
      { issue_id: 2, points: 3, added_at: SPRINT.start_date, removed_at: null, issue_type: 'Task', story_points: 3 },
    ])
    all.mockResolvedValueOnce([{ issue_id: 1, done_at: '2026-01-02T10:00:00.000Z' }])

    const res = await request(app).get('/api/reports/burndown?sprintId=7&unit=count')
    expect(res.status).toBe(200)
    expect(res.body.unit).toBe('count')
    expect(res.body.committedPoints).toBe(2)
    // issue 1 done on day 2 → remaining drops from 2 to 1
    expect(res.body.days.map((d) => d.remaining)).toEqual([2, 1, 1])
  })

  it('returns 400 when sprintId is missing', async () => {
    const res = await request(app).get('/api/reports/burndown')
    expect(res.status).toBe(400)
    expect(get).not.toHaveBeenCalled()
  })

  it('returns 404 when the sprint does not exist', async () => {
    get.mockResolvedValueOnce(null)
    const res = await request(app).get('/api/reports/burndown?sprintId=999')
    expect(res.status).toBe(404)
  })

  it('returns empty days + zero committed when the sprint has no dates', async () => {
    get.mockResolvedValueOnce({ id: 8, name: 'Draft', start_date: null, end_date: null, completed_at: null })
    all.mockResolvedValueOnce([]) // scope
    all.mockResolvedValueOnce([]) // done
    const res = await request(app).get('/api/reports/burndown?sprintId=8')
    expect(res.status).toBe(200)
    expect(res.body.days).toEqual([])
    expect(res.body.committedPoints).toBe(0)
  })
})

/* ================================================================
   JL-49: Burnup
   ================================================================ */
describe('GET /api/reports/burnup (JL-49)', () => {
  it('computes scope (honouring adds) + completed series', async () => {
    get.mockResolvedValueOnce(SPRINT)
    // issue 3 is added mid-sprint on day 2 → scope grows from 8 to 10
    all.mockResolvedValueOnce([
      { issue_id: 1, points: 5, added_at: '2026-01-01T00:00:00.000Z', removed_at: null, issue_type: 'Story', story_points: 5 },
      { issue_id: 2, points: 3, added_at: '2026-01-01T00:00:00.000Z', removed_at: null, issue_type: 'Task', story_points: 3 },
      { issue_id: 3, points: 2, added_at: '2026-01-02T12:00:00.000Z', removed_at: null, issue_type: 'Bug', story_points: 2 },
    ])
    // issue 1 done day 1, issue 2 done day 3
    all.mockResolvedValueOnce([
      { issue_id: 1, done_at: '2026-01-01T10:00:00.000Z' },
      { issue_id: 2, done_at: '2026-01-03T09:00:00.000Z' },
    ])

    const res = await request(app).get('/api/reports/burnup?sprintId=7')
    expect(res.status).toBe(200)
    expect(res.body.days).toEqual([
      { date: '2026-01-01', scope: 8, completed: 5 },
      { date: '2026-01-02', scope: 10, completed: 5 },
      { date: '2026-01-03', scope: 10, completed: 8 },
    ])
  })

  it('honours removed_at (scope shrinks) and unit=count', async () => {
    get.mockResolvedValueOnce(SPRINT)
    all.mockResolvedValueOnce([
      { issue_id: 1, points: 5, added_at: '2026-01-01T00:00:00.000Z', removed_at: null, issue_type: 'Story', story_points: 5 },
      // issue 2 removed on day 2 → out of scope from day 2 onward
      { issue_id: 2, points: 3, added_at: '2026-01-01T00:00:00.000Z', removed_at: '2026-01-02T08:00:00.000Z', issue_type: 'Task', story_points: 3 },
    ])
    all.mockResolvedValueOnce([])

    const res = await request(app).get('/api/reports/burnup?sprintId=7&unit=count')
    expect(res.status).toBe(200)
    expect(res.body.unit).toBe('count')
    expect(res.body.days.map((d) => d.scope)).toEqual([2, 1, 1])
    expect(res.body.days.map((d) => d.completed)).toEqual([0, 0, 0])
  })

  it('returns 400 when sprintId is missing', async () => {
    const res = await request(app).get('/api/reports/burnup')
    expect(res.status).toBe(400)
  })
})
