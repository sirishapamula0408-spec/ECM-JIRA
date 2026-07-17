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

import { run, get, all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  computeEstimationTotal,
  isValidEstimationStatistic,
  ESTIMATION_STATISTICS,
} from '../services/estimation.js'

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

/* ================= computeEstimationTotal (pure helper) ================= */
describe('computeEstimationTotal', () => {
  const issues = [
    { id: 1, story_points: 3, original_estimate_minutes: 120 },
    { id: 2, story_points: 5, original_estimate_minutes: 60 },
    { id: 3, story_points: null, original_estimate_minutes: null },
    { id: 4, story_points: 2, original_estimate_minutes: undefined },
  ]

  it('sums story points, ignoring null/missing', () => {
    expect(computeEstimationTotal(issues, 'story_points')).toBe(10)
  })

  it('sums original time estimate minutes, ignoring null/missing', () => {
    expect(computeEstimationTotal(issues, 'time_estimate')).toBe(180)
  })

  it('counts issues for issue_count', () => {
    expect(computeEstimationTotal(issues, 'issue_count')).toBe(4)
  })

  it('supports fractional story points', () => {
    expect(computeEstimationTotal([{ story_points: 1.5 }, { story_points: 2.5 }], 'story_points')).toBe(4)
  })

  it('defaults to story points when no statistic given', () => {
    expect(computeEstimationTotal(issues)).toBe(10)
  })

  it('returns 0 for empty / non-array input', () => {
    expect(computeEstimationTotal([], 'story_points')).toBe(0)
    expect(computeEstimationTotal(null, 'story_points')).toBe(0)
    expect(computeEstimationTotal(undefined, 'issue_count')).toBe(0)
  })

  it('returns 0 for an unknown statistic', () => {
    expect(computeEstimationTotal(issues, 'bogus')).toBe(0)
  })

  it('ignores null/undefined rows', () => {
    expect(computeEstimationTotal([null, { story_points: 4 }, undefined], 'story_points')).toBe(4)
  })
})

describe('isValidEstimationStatistic', () => {
  it('accepts the enum values', () => {
    for (const s of ESTIMATION_STATISTICS) expect(isValidEstimationStatistic(s)).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isValidEstimationStatistic('points')).toBe(false)
    expect(isValidEstimationStatistic('')).toBe(false)
    expect(isValidEstimationStatistic(undefined)).toBe(false)
  })
})

/* ================= GET board-config (estimation field) ================= */
describe('GET board-config estimationStatistic', () => {
  it('returns saved estimation statistic', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({
      project_id: 5,
      swimlane_by: 'none',
      wip_limits: {},
      quick_filters: [],
      estimation_statistic: 'time_estimate',
    })
    const res = await request(app).get('/api/projects/5/board-config')
    expect(res.status).toBe(200)
    expect(res.body.estimationStatistic).toBe('time_estimate')
  })

  it('defaults to story_points when no row', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(null)
    const res = await request(app).get('/api/projects/9/board-config')
    expect(res.status).toBe(200)
    expect(res.body.estimationStatistic).toBe('story_points')
  })
})

/* ================= PUT board-config (validation + RBAC) ================= */
describe('PUT board-config estimationStatistic', () => {
  it('saves a valid estimation statistic (Admin)', async () => {
    const app = createApp(mod, 'Admin')
    run.mockResolvedValueOnce({})
    get.mockResolvedValueOnce({
      project_id: 5,
      swimlane_by: 'none',
      wip_limits: {},
      quick_filters: [],
      estimation_statistic: 'issue_count',
    })
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ estimationStatistic: 'issue_count' })
    expect(res.status).toBe(200)
    expect(res.body.estimationStatistic).toBe('issue_count')
  })

  it('rejects an invalid estimation statistic (400)', async () => {
    const app = createApp(mod, 'Admin')
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ estimationStatistic: 'bogus' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/estimationStatistic/)
    expect(run).not.toHaveBeenCalled()
  })

  it('blocks a non-admin (Viewer) from saving (403)', async () => {
    const app = createApp(mod, 'Viewer')
    const res = await request(app)
      .put('/api/projects/5/board-config')
      .send({ estimationStatistic: 'story_points' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================= estimation-summary endpoint ================= */
describe('GET estimation-summary', () => {
  it('groups totals by sprint and backlog using the configured statistic', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({ estimation_statistic: 'story_points' })
    all.mockResolvedValueOnce([
      { id: 1, sprint_id: 10, story_points: 3, original_estimate_minutes: 60 },
      { id: 2, sprint_id: 10, story_points: 5, original_estimate_minutes: 30 },
      { id: 3, sprint_id: null, story_points: 2, original_estimate_minutes: null },
    ])
    const res = await request(app).get('/api/projects/7/estimation-summary')
    expect(res.status).toBe(200)
    expect(res.body.statistic).toBe('story_points')
    expect(res.body.backlogTotal).toBe(2)
    expect(res.body.total).toBe(10)
    expect(res.body.sprints).toEqual([{ sprintId: 10, total: 8, issueCount: 2 }])
  })
})
