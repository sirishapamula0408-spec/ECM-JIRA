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
import {
  computeTimeInStatus,
  computeCycleTimeHours,
  firstTransitionTime,
  computeControlChart,
  aggregateTimeInStatus,
} from '../services/timeInStatusReport.js'

const HOUR = 3600 * 1000

// A fixed clock so time-in-status of the *current* status is deterministic.
const NOW = Date.parse('2026-01-10T00:00:00.000Z')

function createApp(routeModule, mountPath = '/api') {
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

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Pure helper: computeTimeInStatus
   ================================================================ */
describe('computeTimeInStatus (JL-155)', () => {
  it('computes correct per-status ms from an ordered change list', () => {
    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    const changes = [
      // To Do -> In Progress after 2h
      { oldValue: 'To Do', newValue: 'In Progress', changedAt: t0 + 2 * HOUR },
      // In Progress -> Code Review after another 5h
      { oldValue: 'In Progress', newValue: 'Code Review', changedAt: t0 + 7 * HOUR },
      // Code Review -> Done after another 1h
      { oldValue: 'Code Review', newValue: 'Done', changedAt: t0 + 8 * HOUR },
    ]
    // createdAt = t0, endTime = t0 + 10h (Done held for 2h)
    const ms = computeTimeInStatus(changes, { createdAt: t0, endTime: t0 + 10 * HOUR })
    expect(ms['To Do']).toBe(2 * HOUR)
    expect(ms['In Progress']).toBe(5 * HOUR)
    expect(ms['Code Review']).toBe(1 * HOUR)
    expect(ms['Done']).toBe(2 * HOUR)
  })

  it('accumulates repeated visits to the same status', () => {
    const t0 = 0
    const changes = [
      { oldValue: 'To Do', newValue: 'In Progress', changedAt: t0 + 1 * HOUR },
      { oldValue: 'In Progress', newValue: 'To Do', changedAt: t0 + 3 * HOUR }, // IP 2h
      { oldValue: 'To Do', newValue: 'In Progress', changedAt: t0 + 4 * HOUR },
      { oldValue: 'In Progress', newValue: 'Done', changedAt: t0 + 7 * HOUR }, // IP 3h
    ]
    const ms = computeTimeInStatus(changes, { createdAt: t0, endTime: t0 + 7 * HOUR })
    expect(ms['In Progress']).toBe(5 * HOUR) // 2h + 3h
    expect(ms['To Do']).toBe(2 * HOUR) // 0->1h creation + 3h->4h
  })

  it('sorts unordered input before computing', () => {
    const t0 = 0
    const unordered = [
      { oldValue: 'In Progress', newValue: 'Done', changedAt: t0 + 5 * HOUR },
      { oldValue: 'To Do', newValue: 'In Progress', changedAt: t0 + 2 * HOUR },
    ]
    const ms = computeTimeInStatus(unordered, { createdAt: t0, endTime: t0 + 6 * HOUR })
    expect(ms['To Do']).toBe(2 * HOUR)
    expect(ms['In Progress']).toBe(3 * HOUR)
    expect(ms['Done']).toBe(1 * HOUR)
  })

  it('empty history → empty object', () => {
    expect(computeTimeInStatus([], { createdAt: 0, endTime: HOUR })).toEqual({})
    expect(computeTimeInStatus(null)).toEqual({})
  })

  it('without createdAt does not credit the initial status', () => {
    const t0 = 0
    const changes = [{ oldValue: 'To Do', newValue: 'Done', changedAt: t0 + 2 * HOUR }]
    const ms = computeTimeInStatus(changes, { endTime: t0 + 3 * HOUR })
    expect(ms['To Do']).toBeUndefined()
    expect(ms['Done']).toBe(1 * HOUR)
  })
})

/* ================================================================
   Pure helper: computeCycleTimeHours + firstTransitionTime
   ================================================================ */
describe('computeCycleTimeHours (JL-155)', () => {
  it('measures In Progress → Done in hours', () => {
    const t0 = 0
    const changes = [
      { oldValue: 'To Do', newValue: 'In Progress', changedAt: t0 + 1 * HOUR },
      { oldValue: 'In Progress', newValue: 'Done', changedAt: t0 + 4 * HOUR },
    ]
    expect(computeCycleTimeHours(changes)).toBe(3)
  })

  it('falls back to createdAt → Done when no In Progress', () => {
    const t0 = 0
    const changes = [{ oldValue: 'To Do', newValue: 'Done', changedAt: t0 + 6 * HOUR }]
    expect(computeCycleTimeHours(changes, { createdAt: t0 })).toBe(6)
  })

  it('returns null when never Done', () => {
    const changes = [{ oldValue: 'To Do', newValue: 'In Progress', changedAt: HOUR }]
    expect(computeCycleTimeHours(changes)).toBeNull()
  })

  it('firstTransitionTime returns earliest matching timestamp', () => {
    const changes = [
      { oldValue: 'To Do', newValue: 'Done', changedAt: 5 * HOUR },
      { oldValue: 'Done', newValue: 'In Progress', changedAt: 6 * HOUR },
      { oldValue: 'In Progress', newValue: 'Done', changedAt: 8 * HOUR },
    ]
    expect(firstTransitionTime(changes, 'Done')).toBe(5 * HOUR)
    expect(firstTransitionTime(changes, 'Backlog')).toBeNull()
  })
})

/* ================================================================
   Pure helper: computeControlChart
   ================================================================ */
describe('computeControlChart (JL-155)', () => {
  it('computes rolling mean/std and overall stats', () => {
    const points = [
      { issueKey: 'P-1', resolvedAt: '2026-01-01T00:00:00.000Z', cycleTimeHours: 2 },
      { issueKey: 'P-2', resolvedAt: '2026-01-02T00:00:00.000Z', cycleTimeHours: 4 },
      { issueKey: 'P-3', resolvedAt: '2026-01-03T00:00:00.000Z', cycleTimeHours: 6 },
    ]
    const chart = computeControlChart(points, { window: 3 })
    expect(chart.count).toBe(3)
    expect(chart.mean).toBe(4) // (2+4+6)/3
    // population std of [2,4,6] = sqrt(8/3) ≈ 1.63
    expect(chart.std).toBeCloseTo(1.63, 2)

    // first point: window [2] → mean 2, std 0
    expect(chart.points[0].rollingMean).toBe(2)
    expect(chart.points[0].rollingStd).toBe(0)
    // third point: window [2,4,6] → mean 4
    expect(chart.points[2].rollingMean).toBe(4)
    expect(chart.points[2].upper).toBeCloseTo(4 + 1.63, 1)
    expect(chart.points[2].lower).toBeCloseTo(4 - 1.63, 1)
  })

  it('sorts by resolvedAt ascending', () => {
    const points = [
      { issueKey: 'B', resolvedAt: '2026-01-05T00:00:00.000Z', cycleTimeHours: 5 },
      { issueKey: 'A', resolvedAt: '2026-01-01T00:00:00.000Z', cycleTimeHours: 1 },
    ]
    const chart = computeControlChart(points)
    expect(chart.points.map((p) => p.issueKey)).toEqual(['A', 'B'])
  })

  it('respects a trailing window smaller than the series', () => {
    const points = [
      { issueKey: 'P-1', resolvedAt: '2026-01-01T00:00:00.000Z', cycleTimeHours: 10 },
      { issueKey: 'P-2', resolvedAt: '2026-01-02T00:00:00.000Z', cycleTimeHours: 20 },
      { issueKey: 'P-3', resolvedAt: '2026-01-03T00:00:00.000Z', cycleTimeHours: 30 },
    ]
    const chart = computeControlChart(points, { window: 2 })
    // last point window = [20, 30] → mean 25
    expect(chart.points[2].rollingMean).toBe(25)
  })

  it('empty input → zeros/empty', () => {
    const chart = computeControlChart([])
    expect(chart.count).toBe(0)
    expect(chart.mean).toBeNull()
    expect(chart.std).toBeNull()
    expect(chart.points).toEqual([])
  })

  it('drops points without a finite cycle time', () => {
    const points = [
      { issueKey: 'P-1', resolvedAt: '2026-01-01T00:00:00.000Z', cycleTimeHours: null },
      { issueKey: 'P-2', resolvedAt: '2026-01-02T00:00:00.000Z', cycleTimeHours: 3 },
    ]
    const chart = computeControlChart(points)
    expect(chart.count).toBe(1)
    expect(chart.points[0].issueKey).toBe('P-2')
  })
})

/* ================================================================
   Pure helper: aggregateTimeInStatus
   ================================================================ */
describe('aggregateTimeInStatus (JL-155)', () => {
  it('aggregates totals across issues and orders statuses canonically', () => {
    const t0 = 0
    const issues = [
      {
        issueKey: 'P-1',
        currentStatus: 'Done',
        createdAt: t0,
        changes: [
          { oldValue: 'To Do', newValue: 'In Progress', changedAt: t0 + 1 * HOUR },
          { oldValue: 'In Progress', newValue: 'Done', changedAt: t0 + 3 * HOUR },
        ],
      },
      {
        issueKey: 'P-2',
        currentStatus: 'In Progress',
        createdAt: t0,
        changes: [
          { oldValue: 'To Do', newValue: 'In Progress', changedAt: t0 + 2 * HOUR },
        ],
      },
    ]
    const agg = aggregateTimeInStatus(issues, {
      endTime: t0 + 4 * HOUR,
      statusOrder: ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done'],
    })
    expect(agg.perIssue).toHaveLength(2)
    // In Progress: P-1 2h + P-2 2h = 4h
    expect(agg.totals['In Progress'].ms).toBe(4 * HOUR)
    expect(agg.totals['In Progress'].hours).toBe(4)
    // Canonical ordering (only statuses that appear)
    expect(agg.statuses).toEqual(['To Do', 'In Progress', 'Done'])
    expect(agg.perIssue[0].byStatus['Done'].hours).toBe(1)
  })

  it('empty issue list → empty aggregate', () => {
    const agg = aggregateTimeInStatus([], { statusOrder: ['Done'] })
    expect(agg.statuses).toEqual([])
    expect(agg.perIssue).toEqual([])
    expect(agg.totals).toEqual({})
  })
})

/* ================================================================
   Endpoints
   ================================================================ */
describe('GET /api/projects/:id/reports/time-in-status (JL-155)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/timeInStatusReports.js')
    app = createApp(mod)
  })

  it('returns the expected shape', async () => {
    get.mockResolvedValueOnce({ id: 7 }) // project lookup
    all
      .mockResolvedValueOnce([
        { id: 1, issue_key: 'P-1', status: 'Done', created_at: '2026-01-01T00:00:00.000Z' },
      ]) // issues
      .mockResolvedValueOnce([
        { issue_id: 1, old_value: 'To Do', new_value: 'In Progress', changed_at: '2026-01-01T02:00:00.000Z' },
        { issue_id: 1, old_value: 'In Progress', new_value: 'Done', changed_at: '2026-01-01T05:00:00.000Z' },
      ]) // history

    const res = await request(app).get('/api/projects/7/reports/time-in-status')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('projectId', 7)
    expect(res.body).toHaveProperty('statuses')
    expect(res.body).toHaveProperty('perIssue')
    expect(res.body).toHaveProperty('totals')
    expect(res.body.perIssue[0].issueKey).toBe('P-1')
    expect(res.body.perIssue[0].byStatus['In Progress'].hours).toBe(3)
  })

  it('404 for a missing project', async () => {
    get.mockResolvedValueOnce(undefined)
    const res = await request(app).get('/api/projects/999/reports/time-in-status')
    expect(res.status).toBe(404)
  })

  it('400 for an invalid project id', async () => {
    const res = await request(app).get('/api/projects/abc/reports/time-in-status')
    expect(res.status).toBe(400)
  })

  it('empty history → empty totals', async () => {
    get.mockResolvedValueOnce({ id: 7 })
    all.mockResolvedValueOnce([]) // no issues (history query skipped)
    const res = await request(app).get('/api/projects/7/reports/time-in-status')
    expect(res.status).toBe(200)
    expect(res.body.perIssue).toEqual([])
    expect(res.body.totals).toEqual({})
  })
})

describe('GET /api/projects/:id/reports/control-chart (JL-155)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/timeInStatusReports.js')
    app = createApp(mod)
  })

  it('returns cycle-time points with rolling stats', async () => {
    get.mockResolvedValueOnce({ id: 7 })
    all
      .mockResolvedValueOnce([
        { id: 1, issue_key: 'P-1', status: 'Done', created_at: '2026-01-01T00:00:00.000Z' },
        { id: 2, issue_key: 'P-2', status: 'Done', created_at: '2026-01-02T00:00:00.000Z' },
      ]) // issues
      .mockResolvedValueOnce([
        { issue_id: 1, old_value: 'To Do', new_value: 'In Progress', changed_at: '2026-01-01T01:00:00.000Z' },
        { issue_id: 1, old_value: 'In Progress', new_value: 'Done', changed_at: '2026-01-01T03:00:00.000Z' },
        { issue_id: 2, old_value: 'To Do', new_value: 'In Progress', changed_at: '2026-01-02T01:00:00.000Z' },
        { issue_id: 2, old_value: 'In Progress', new_value: 'Done', changed_at: '2026-01-02T05:00:00.000Z' },
      ]) // history

    const res = await request(app).get('/api/projects/7/reports/control-chart')
    expect(res.status).toBe(200)
    expect(res.body.projectId).toBe(7)
    expect(res.body.count).toBe(2)
    expect(res.body.points).toHaveLength(2)
    expect(res.body.points[0].cycleTimeHours).toBe(2) // P-1: 1h->3h
    expect(res.body.points[1].cycleTimeHours).toBe(4) // P-2: 1h->5h
    expect(res.body.mean).toBe(3)
    expect(res.body).toHaveProperty('window', 7)
  })

  it('empty (no completed issues) → count 0', async () => {
    get.mockResolvedValueOnce({ id: 7 })
    all
      .mockResolvedValueOnce([
        { id: 1, issue_key: 'P-1', status: 'To Do', created_at: '2026-01-01T00:00:00.000Z' },
      ])
      .mockResolvedValueOnce([]) // no status history
    const res = await request(app).get('/api/projects/7/reports/control-chart')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(0)
    expect(res.body.points).toEqual([])
    expect(res.body.mean).toBeNull()
  })

  it('honours the window query param', async () => {
    get.mockResolvedValueOnce({ id: 7 })
    all.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await request(app).get('/api/projects/7/reports/control-chart?window=3')
    expect(res.status).toBe(200)
    expect(res.body.window).toBe(3)
  })
})

// Silence unused-import lint for NOW (kept for clarity of intent).
void NOW
