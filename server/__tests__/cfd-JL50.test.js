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

import { all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath = '/api/reports') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

// Build an ISO timestamp N days before "now" (used to place issues/history
// inside the queried range deterministically).
const daysAgo = (n, hour = 12) => {
  const d = new Date()
  d.setUTCHours(hour, 0, 0, 0)
  d.setTime(d.getTime() - n * 24 * 60 * 60 * 1000)
  return d.toISOString()
}
const isoDay = (n) => daysAgo(n).slice(0, 10)

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/reports.js')
  app = createApp(mod)
})

describe('CFD reconstruction (JL-50)', () => {
  it('carries status forward from creation and applies changes by day', async () => {
    // One issue created 5 days ago in "To Do", moved to In Progress 3 days
    // ago, and to Done 1 day ago. days=6 so the whole life is in range.
    all
      .mockResolvedValueOnce([
        { id: 1, status: 'Done', created_at: daysAgo(5) },
      ]) // issues
      .mockResolvedValueOnce([
        { issue_id: 1, old_value: 'To Do', new_value: 'In Progress', changed_at: daysAgo(3) },
        { issue_id: 1, old_value: 'In Progress', new_value: 'Done', changed_at: daysAgo(1) },
      ]) // history

    const res = await request(app).get('/api/reports/cfd?days=6&granularity=daily')
    expect(res.status).toBe(200)
    expect(res.body.statuses).toEqual(['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done'])

    const byDate = Object.fromEntries(res.body.days.map((d) => [d.date, d.counts]))

    // 5 days ago: created, initial status To Do.
    expect(byDate[isoDay(5)]['To Do']).toBe(1)
    expect(byDate[isoDay(5)]['In Progress']).toBe(0)
    // 4 days ago: still To Do (no change yet).
    expect(byDate[isoDay(4)]['To Do']).toBe(1)
    // 3 days ago: moved to In Progress.
    expect(byDate[isoDay(3)]['In Progress']).toBe(1)
    expect(byDate[isoDay(3)]['To Do']).toBe(0)
    // 2 days ago: still In Progress (carried forward).
    expect(byDate[isoDay(2)]['In Progress']).toBe(1)
    // 1 day ago: Done.
    expect(byDate[isoDay(1)]['Done']).toBe(1)
    expect(byDate[isoDay(1)]['In Progress']).toBe(0)
  })

  it('does not count issues before they were created', async () => {
    // Issue created 2 days ago, no history → stays at its current status.
    all
      .mockResolvedValueOnce([
        { id: 7, status: 'Backlog', created_at: daysAgo(2) },
      ])
      .mockResolvedValueOnce([]) // no history

    const res = await request(app).get('/api/reports/cfd?days=5&granularity=daily')
    expect(res.status).toBe(200)
    const byDate = Object.fromEntries(res.body.days.map((d) => [d.date, d.counts]))

    // 4 days ago: not created yet → all zero.
    const total4 = Object.values(byDate[isoDay(4)]).reduce((a, b) => a + b, 0)
    expect(total4).toBe(0)
    // 2 days ago onward: counted in Backlog.
    expect(byDate[isoDay(2)].Backlog).toBe(1)
    expect(byDate[isoDay(0)].Backlog).toBe(1)
  })

  it('uses initial status (earliest change old_value) for no-history days', async () => {
    // Created 4 days ago in Backlog, one change to In Progress 1 day ago.
    all
      .mockResolvedValueOnce([
        { id: 3, status: 'In Progress', created_at: daysAgo(4) },
      ])
      .mockResolvedValueOnce([
        { issue_id: 3, old_value: 'Backlog', new_value: 'In Progress', changed_at: daysAgo(1) },
      ])

    const res = await request(app).get('/api/reports/cfd?days=5&granularity=daily')
    const byDate = Object.fromEntries(res.body.days.map((d) => [d.date, d.counts]))

    // 3 days ago: initial status Backlog (from earliest change old_value).
    expect(byDate[isoDay(3)].Backlog).toBe(1)
    expect(byDate[isoDay(3)]['In Progress']).toBe(0)
    // 1 day ago: In Progress.
    expect(byDate[isoDay(1)]['In Progress']).toBe(1)
  })

  it('honors the days range and daily granularity (one point per day)', async () => {
    all.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await request(app).get('/api/reports/cfd?days=10&granularity=daily')
    expect(res.status).toBe(200)
    expect(res.body.rangeDays).toBe(10)
    expect(res.body.days).toHaveLength(10)
    expect(res.body.granularity).toBe('daily')
  })

  it('honors weekly granularity (sparser sampling than daily)', async () => {
    all.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await request(app).get('/api/reports/cfd?days=30&granularity=weekly')
    expect(res.status).toBe(200)
    expect(res.body.granularity).toBe('weekly')
    // 30-day range sampled weekly → far fewer than 30 points.
    expect(res.body.days.length).toBeLessThan(30)
    expect(res.body.days.length).toBeGreaterThanOrEqual(4)
  })

  it('defaults to 30 days when days param is missing or invalid', async () => {
    all.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await request(app).get('/api/reports/cfd?days=abc')
    expect(res.status).toBe(200)
    expect(res.body.rangeDays).toBe(30)
    expect(res.body.days).toHaveLength(30)
  })

  it('derives WIP (non-Done, non-Backlog) and average lead time', async () => {
    all
      .mockResolvedValueOnce([
        { id: 1, status: 'In Progress', created_at: daysAgo(5) }, // WIP
        { id: 2, status: 'Code Review', created_at: daysAgo(5) }, // WIP
        { id: 3, status: 'Backlog', created_at: daysAgo(5) }, // not WIP
        { id: 4, status: 'Done', created_at: daysAgo(6) }, // not WIP, done
      ])
      .mockResolvedValueOnce([
        // Issue 4 reached Done 2 days after creation (created 6d ago, done 4d ago).
        { issue_id: 4, old_value: 'In Progress', new_value: 'Done', changed_at: daysAgo(4) },
      ])

    const res = await request(app).get('/api/reports/cfd?days=7')
    expect(res.status).toBe(200)
    expect(res.body.metrics.currentWip).toBe(2)
    // Lead time for issue 4 = 6 - 4 = 2 days.
    expect(res.body.metrics.averageLeadTime).toBeCloseTo(2, 1)
  })

  it('passes projectId as a bound parameter (no interpolation)', async () => {
    all.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await request(app).get('/api/reports/cfd?projectId=42&days=5')
    // Both queries must be parameterized with projectId = 42.
    for (const call of all.mock.calls) {
      expect(call[0]).toContain('project_id = ?')
      expect(call[1]).toEqual([42])
    }
  })
})
