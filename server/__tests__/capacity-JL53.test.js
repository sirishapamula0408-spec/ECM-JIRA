import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Builds an app that injects a workspace role so requireRole('Member','Admin')
// gates work exactly as in production.
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
  app.use('/api/reports', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/reports.js')
  app = createApp(mod)
})

describe('Capacity Planning (JL-53)', () => {
  describe('GET /api/reports/capacity', () => {
    it('sums committed story points per assignee and computes utilization vs capacity', async () => {
      // sprint lookup
      get.mockResolvedValueOnce({ id: 5, name: 'Sprint 5' })
      // first all() -> issues in sprint, second all() -> capacity rows
      all
        .mockResolvedValueOnce([
          { assignee: 'alice', issue_type: 'Story', story_points: 5 },
          { assignee: 'alice', issue_type: 'Task', story_points: 3 },
          { assignee: 'bob', issue_type: 'Bug', story_points: 8 },
        ])
        .mockResolvedValueOnce([
          { assignee: 'alice', capacity_points: 10 },
          { assignee: 'bob', capacity_points: 4 },
        ])

      const res = await request(app).get('/api/reports/capacity?sprintId=5')
      expect(res.status).toBe(200)
      expect(res.body.sprintId).toBe(5)

      const byAssignee = Object.fromEntries(res.body.rows.map((r) => [r.assignee, r]))
      // alice: 5 + 3 = 8 committed, 10 capacity -> 80%
      expect(byAssignee.alice.committedPoints).toBe(8)
      expect(byAssignee.alice.capacityPoints).toBe(10)
      expect(byAssignee.alice.utilizationPct).toBe(80)
      // bob: 8 committed, 4 capacity -> 200% (over capacity)
      expect(byAssignee.bob.committedPoints).toBe(8)
      expect(byAssignee.bob.utilizationPct).toBe(200)

      // totals
      expect(res.body.totals.committedPoints).toBe(16)
      expect(res.body.totals.capacityPoints).toBe(14)
    })

    it('reports null utilization when an assignee has no capacity set', async () => {
      get.mockResolvedValueOnce({ id: 1, name: 'Sprint 1' })
      all
        .mockResolvedValueOnce([{ assignee: 'carol', issue_type: 'Story', story_points: 4 }])
        .mockResolvedValueOnce([]) // no capacity rows

      const res = await request(app).get('/api/reports/capacity?sprintId=1')
      expect(res.status).toBe(200)
      const carol = res.body.rows.find((r) => r.assignee === 'carol')
      expect(carol.committedPoints).toBe(4)
      expect(carol.capacityPoints).toBe(0)
      expect(carol.utilizationPct).toBeNull()
    })

    it('falls back to per-type points when story_points is null', async () => {
      get.mockResolvedValueOnce({ id: 2, name: 'Sprint 2' })
      all
        .mockResolvedValueOnce([
          { assignee: 'dave', issue_type: 'Story', story_points: null }, // -> 8
          { assignee: 'dave', issue_type: 'Bug', story_points: null }, // -> 5
        ])
        .mockResolvedValueOnce([])

      const res = await request(app).get('/api/reports/capacity?sprintId=2')
      expect(res.status).toBe(200)
      const dave = res.body.rows.find((r) => r.assignee === 'dave')
      expect(dave.committedPoints).toBe(13)
    })

    it('handles an empty sprint (no issues, no capacity)', async () => {
      get.mockResolvedValueOnce({ id: 9, name: 'Empty Sprint' })
      all.mockResolvedValueOnce([]).mockResolvedValueOnce([])

      const res = await request(app).get('/api/reports/capacity?sprintId=9')
      expect(res.status).toBe(200)
      expect(res.body.rows).toEqual([])
      expect(res.body.totals).toEqual({
        committedPoints: 0,
        capacityPoints: 0,
        utilizationPct: null,
      })
    })

    it('returns 400 when sprintId is missing', async () => {
      const res = await request(app).get('/api/reports/capacity')
      expect(res.status).toBe(400)
    })

    it('returns 404 when the sprint does not exist', async () => {
      get.mockResolvedValueOnce(null)
      const res = await request(app).get('/api/reports/capacity?sprintId=999')
      expect(res.status).toBe(404)
    })
  })

  describe('PUT /api/reports/capacity', () => {
    it('sets an assignee capacity for a sprint (upsert)', async () => {
      get.mockResolvedValueOnce({ id: 5 }) // sprint exists
      run.mockResolvedValueOnce({ lastID: 1, changes: 1 })

      const res = await request(app)
        .put('/api/reports/capacity')
        .send({ sprintId: 5, assignee: 'alice', capacityPoints: 12 })

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ sprintId: 5, assignee: 'alice', capacityPoints: 12 })

      // Upsert SQL was called with parameterized values.
      expect(run).toHaveBeenCalledTimes(1)
      const [sql, params] = run.mock.calls[0]
      expect(sql).toMatch(/INSERT INTO member_capacity/i)
      expect(sql).toMatch(/ON CONFLICT/i)
      expect(params).toEqual(['alice', 5, 12])
    })

    it('rejects a missing assignee', async () => {
      const res = await request(app)
        .put('/api/reports/capacity')
        .send({ sprintId: 5, capacityPoints: 12 })
      expect(res.status).toBe(400)
      expect(run).not.toHaveBeenCalled()
    })

    it('rejects a negative capacity', async () => {
      const res = await request(app)
        .put('/api/reports/capacity')
        .send({ sprintId: 5, assignee: 'alice', capacityPoints: -3 })
      expect(res.status).toBe(400)
      expect(run).not.toHaveBeenCalled()
    })

    it('rejects a missing sprintId', async () => {
      const res = await request(app)
        .put('/api/reports/capacity')
        .send({ assignee: 'alice', capacityPoints: 5 })
      expect(res.status).toBe(400)
    })

    it('returns 404 when the sprint does not exist', async () => {
      get.mockResolvedValueOnce(null)
      const res = await request(app)
        .put('/api/reports/capacity')
        .send({ sprintId: 123, assignee: 'alice', capacityPoints: 5 })
      expect(res.status).toBe(404)
    })

    it('forbids a Viewer from setting capacity', async () => {
      const mod = await import('../routes/reports.js')
      const viewerApp = createApp(mod, 'Viewer')
      const res = await request(viewerApp)
        .put('/api/reports/capacity')
        .send({ sprintId: 5, assignee: 'alice', capacityPoints: 5 })
      expect(res.status).toBe(403)
    })
  })
})
