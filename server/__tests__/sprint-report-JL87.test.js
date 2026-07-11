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

import { all, get } from '../db.js'
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

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/reports.js')
  app = createApp(mod)
})

/* ================================================================
   JL-87: Sprint Report
   ================================================================ */
describe('GET /api/reports/sprint/:id — Sprint Report (JL-87)', () => {
  it('classifies completed / not-completed / removed and computes scope change', async () => {
    const start = '2026-07-01T00:00:00.000Z'
    const afterStart = '2026-07-05T00:00:00.000Z'

    // sprint lookup
    get.mockResolvedValueOnce({
      id: 7,
      name: 'Sprint 7',
      date_range: 'Jul 1 - Jul 14',
      is_started: true,
      start_date: start,
      end_date: null,
      completed_at: null,
    })

    // current issues in the sprint (issue 40 removed one is NOT here)
    all.mockResolvedValueOnce([
      { id: 41, issue_key: 'P-41', title: 'Done story', status: 'Done', issue_type: 'Story', story_points: 8 },
      { id: 42, issue_key: 'P-42', title: 'In progress', status: 'In Progress', issue_type: 'Task', story_points: 3 },
      { id: 43, issue_key: 'P-43', title: 'Added later', status: 'To Do', issue_type: 'Bug', story_points: 5 },
    ])

    // committed snapshot rows
    all.mockResolvedValueOnce([
      // committed at start, still in sprint, done
      { issue_id: 41, points: 8, added_at: start, removed_at: null, issue_key: 'P-41', title: 'Done story', status: 'Done', issue_type: 'Story', story_points: 8, sprint_id: 7 },
      // committed at start, still in sprint, not done
      { issue_id: 42, points: 3, added_at: start, removed_at: null, issue_key: 'P-42', title: 'In progress', status: 'In Progress', issue_type: 'Task', story_points: 3, sprint_id: 7 },
      // committed at start but removed after start (no longer in current issues)
      { issue_id: 40, points: 5, added_at: start, removed_at: afterStart, issue_key: 'P-40', title: 'Removed', status: 'To Do', issue_type: 'Bug', story_points: 5, sprint_id: null },
      // added AFTER start (scope creep) — still in sprint
      { issue_id: 43, points: 5, added_at: afterStart, removed_at: null, issue_key: 'P-43', title: 'Added later', status: 'To Do', issue_type: 'Bug', story_points: 5, sprint_id: 7 },
    ])

    const res = await request(app).get('/api/reports/sprint/7')
    expect(res.status).toBe(200)

    // classification
    expect(res.body.issues.completed.map((i) => i.id)).toEqual([41])
    expect(res.body.issues.notCompleted.map((i) => i.id)).toEqual([42, 43])
    expect(res.body.issues.removed.map((i) => i.id)).toEqual([40])

    const s = res.body.summary
    expect(s.completedIssues).toBe(1)
    expect(s.completedPoints).toBe(8)
    expect(s.notCompletedIssues).toBe(2)
    expect(s.notCompletedPoints).toBe(8) // 3 + 5
    expect(s.removedIssues).toBe(1)
    expect(s.removedPoints).toBe(5)

    // committed = issues present at start (41, 42, 40) = 3 issues / 16 points
    expect(s.committedIssues).toBe(3)
    expect(s.committedPoints).toBe(16)

    // scope change: 43 added after start, 40 removed after start
    expect(s.scopeChange.addedIssues).toBe(1)
    expect(s.scopeChange.addedPoints).toBe(5)
    expect(s.scopeChange.removedIssues).toBe(1)
    expect(s.scopeChange.removedPoints).toBe(5)

    // sprint meta echoed
    expect(res.body.sprint.id).toBe(7)
    expect(res.body.sprint.startDate).toBe(start)
  })

  it('returns 404 when the sprint does not exist', async () => {
    get.mockResolvedValueOnce(undefined)
    const res = await request(app).get('/api/reports/sprint/999')
    expect(res.status).toBe(404)
  })

  it('rejects an invalid sprint id', async () => {
    const res = await request(app).get('/api/reports/sprint/abc')
    expect(res.status).toBe(400)
    expect(get).not.toHaveBeenCalled()
  })

  it('falls back to story_points/type heuristic when scope points are null', async () => {
    get.mockResolvedValueOnce({
      id: 3, name: 'S3', date_range: 'x', is_started: true,
      start_date: '2026-07-01T00:00:00.000Z', end_date: null, completed_at: null,
    })
    all.mockResolvedValueOnce([
      { id: 50, issue_key: 'P-50', title: 'A', status: 'Done', issue_type: 'Story', story_points: null },
    ])
    all.mockResolvedValueOnce([
      // points null -> falls back to story_points (null) -> Story heuristic = 8
      { issue_id: 50, points: null, added_at: '2026-07-01T00:00:00.000Z', removed_at: null,
        issue_key: 'P-50', title: 'A', status: 'Done', issue_type: 'Story', story_points: null, sprint_id: 3 },
    ])

    const res = await request(app).get('/api/reports/sprint/3')
    expect(res.status).toBe(200)
    expect(res.body.summary.committedPoints).toBe(8)
    expect(res.body.summary.completedPoints).toBe(8)
  })
})

/* ================================================================
   JL-87: Created vs Resolved report
   ================================================================ */
describe('GET /api/reports/created-resolved (JL-87)', () => {
  it('returns correct daily created + resolved series with cumulative totals', async () => {
    // Use a small window so we can assert exact days. days=3 => today + 2 prior.
    const now = new Date()
    const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    const day = (offset) => new Date(todayMs + offset * 86400000).toISOString()
    const today = day(0).slice(0, 10)
    const yesterday = day(-1).slice(0, 10)
    const twoAgo = day(-2).slice(0, 10)

    // created rows
    all.mockResolvedValueOnce([
      { created_at: day(-2) },
      { created_at: day(-2) },
      { created_at: day(0) },
    ])
    // resolved (first-done) rows
    all.mockResolvedValueOnce([
      { done_at: day(-1) },
      { done_at: day(0) },
    ])

    const res = await request(app).get('/api/reports/created-resolved?days=3&projectId=5')
    expect(res.status).toBe(200)
    expect(res.body.days).toBe(3)
    expect(res.body.projectId).toBe(5)
    expect(res.body.series).toHaveLength(3)

    const byDate = Object.fromEntries(res.body.series.map((r) => [r.date, r]))
    expect(byDate[twoAgo].created).toBe(2)
    expect(byDate[twoAgo].resolved).toBe(0)
    expect(byDate[yesterday].created).toBe(0)
    expect(byDate[yesterday].resolved).toBe(1)
    expect(byDate[today].created).toBe(1)
    expect(byDate[today].resolved).toBe(1)

    // cumulative
    expect(byDate[twoAgo].cumulativeCreated).toBe(2)
    expect(byDate[today].cumulativeCreated).toBe(3)
    expect(byDate[today].cumulativeResolved).toBe(2)

    expect(res.body.totals).toEqual({ created: 3, resolved: 2 })

    // resolved query bound the status/Done + project params (parameterized)
    const resolvedCall = all.mock.calls[1]
    expect(resolvedCall[0]).toMatch(/issue_history/)
    expect(resolvedCall[0]).toMatch(/MIN\(h\.changed_at\)/)
    expect(resolvedCall[1]).toEqual(['status', 'Done', 5, expect.any(String)])
  })

  it('defaults to 30 days and no project filter when params are absent', async () => {
    all.mockResolvedValueOnce([]) // created
    all.mockResolvedValueOnce([]) // resolved

    const res = await request(app).get('/api/reports/created-resolved')
    expect(res.status).toBe(200)
    expect(res.body.days).toBe(30)
    expect(res.body.projectId).toBeNull()
    expect(res.body.series).toHaveLength(30)
    expect(res.body.totals).toEqual({ created: 0, resolved: 0 })

    // no project filter -> created query has only the cutoff param
    expect(all.mock.calls[0][1]).toHaveLength(1)
    expect(all.mock.calls[1][1]).toEqual(['status', 'Done', expect.any(String)])
  })
})
