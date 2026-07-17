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

import { all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import reportsRouter, { percentile, average } from '../routes/reports.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/reports', reportsRouter)
  app.use(errorHandler)
  return app
}

// Helper: ISO timestamp `n` days after a fixed base date.
const BASE = Date.parse('2026-01-01T00:00:00.000Z')
const day = (n) => new Date(BASE + n * 86400000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   JL-51: percentile / average helpers (nearest-rank)
   ================================================================ */
describe('JL-51 percentile + average helpers', () => {
  it('computes nearest-rank p50/p85/p95 on a known set [1..10]', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(values, 50)).toBe(5)
    expect(percentile(values, 85)).toBe(9)
    expect(percentile(values, 95)).toBe(10)
  })

  it('sorts unordered input before ranking', () => {
    expect(percentile([10, 1, 5, 3, 9, 2, 8, 4, 7, 6], 85)).toBe(9)
  })

  it('averages to 2 decimals and returns null for empty sets', () => {
    expect(average([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(5.5)
    expect(average([])).toBeNull()
    expect(percentile([], 50)).toBeNull()
  })
})

/* ================================================================
   JL-51: GET /api/reports/cycle-time
   ================================================================ */
describe('JL-51 GET /api/reports/cycle-time', () => {
  let app
  beforeEach(() => { app = createApp() })

  it('computes cycle + lead days from In Progress → Done transitions', async () => {
    all
      // 1st all(): Done issues
      .mockResolvedValueOnce([
        { id: 1, issue_key: 'PROJ-1', issue_type: 'Story', priority: 'High', assignee: 'Alice', created_at: day(0) },
        { id: 2, issue_key: 'PROJ-2', issue_type: 'Bug', priority: 'Low', assignee: 'Bob', created_at: day(1) },
      ])
      // 2nd all(): status history (ASC by changed_at)
      .mockResolvedValueOnce([
        { issue_id: 1, new_value: 'In Progress', changed_at: day(2) },
        { issue_id: 1, new_value: 'Done', changed_at: day(5) }, // cycle=3, lead=5
        { issue_id: 2, new_value: 'In Progress', changed_at: day(1) },
        { issue_id: 2, new_value: 'Done', changed_at: day(4) }, // cycle=3, lead=3
      ])

    const res = await request(app).get('/api/reports/cycle-time?projectId=7')
    expect(res.status).toBe(200)
    expect(res.body.issues).toHaveLength(2)

    const byKey = Object.fromEntries(res.body.issues.map((i) => [i.key, i]))
    expect(byKey['PROJ-1']).toMatchObject({ cycleDays: 3, leadDays: 5, issueType: 'Story', priority: 'High', assignee: 'Alice' })
    expect(byKey['PROJ-1'].doneAt).toBe(day(5))
    expect(byKey['PROJ-2']).toMatchObject({ cycleDays: 3, leadDays: 3 })

    // parameterized SQL only (projectId bound, not interpolated)
    const issuesCall = all.mock.calls[0]
    expect(issuesCall[0]).toMatch(/status = 'Done'/)
    expect(issuesCall[0]).toContain('project_id = ?')
    expect(issuesCall[1]).toContain(7)
  })

  it('uses the FIRST In Progress entry when there are re-opens', async () => {
    all
      .mockResolvedValueOnce([
        { id: 1, issue_key: 'PROJ-1', issue_type: 'Task', priority: 'Medium', assignee: 'Alice', created_at: day(0) },
      ])
      .mockResolvedValueOnce([
        { issue_id: 1, new_value: 'In Progress', changed_at: day(1) }, // earliest → cycle anchor
        { issue_id: 1, new_value: 'In Progress', changed_at: day(6) }, // re-open, ignored
        { issue_id: 1, new_value: 'Done', changed_at: day(9) },
      ])

    const res = await request(app).get('/api/reports/cycle-time')
    expect(res.status).toBe(200)
    expect(res.body.issues[0].cycleDays).toBe(8) // day9 - day1
    expect(res.body.issues[0].leadDays).toBe(9)
  })

  it('returns null cycleDays when an issue reached Done without an In Progress row', async () => {
    all
      .mockResolvedValueOnce([
        { id: 1, issue_key: 'PROJ-1', issue_type: 'Task', priority: 'Low', assignee: 'Alice', created_at: day(0) },
      ])
      .mockResolvedValueOnce([
        { issue_id: 1, new_value: 'Done', changed_at: day(4) },
      ])

    const res = await request(app).get('/api/reports/cycle-time')
    expect(res.status).toBe(200)
    expect(res.body.issues[0].cycleDays).toBeNull()
    expect(res.body.issues[0].leadDays).toBe(4)
    // cycle summary ignores the null; lead summary counts it
    expect(res.body.summary.cycle.average).toBeNull()
    expect(res.body.summary.lead.average).toBe(4)
  })

  it('excludes issues that never reached Done (no Done history row)', async () => {
    all
      .mockResolvedValueOnce([
        { id: 1, issue_key: 'PROJ-1', issue_type: 'Story', priority: 'High', assignee: 'Alice', created_at: day(0) },
        { id: 2, issue_key: 'PROJ-2', issue_type: 'Bug', priority: 'Low', assignee: 'Bob', created_at: day(0) },
      ])
      .mockResolvedValueOnce([
        { issue_id: 1, new_value: 'In Progress', changed_at: day(1) },
        { issue_id: 1, new_value: 'Done', changed_at: day(3) },
        // issue 2 only ever went to In Progress — must be excluded
        { issue_id: 2, new_value: 'In Progress', changed_at: day(1) },
      ])

    const res = await request(app).get('/api/reports/cycle-time')
    expect(res.status).toBe(200)
    expect(res.body.issues).toHaveLength(1)
    expect(res.body.issues[0].key).toBe('PROJ-1')
    expect(res.body.summary.count).toBe(1)
  })

  it('computes correct p50/p85/p95 percentiles over a known set of 10', async () => {
    // cycleDays = 1..10 : created day0, inProgress day0, done day N
    const issues = []
    const history = []
    for (let n = 1; n <= 10; n++) {
      issues.push({ id: n, issue_key: `PROJ-${n}`, issue_type: 'Task', priority: 'Medium', assignee: 'Alice', created_at: day(0) })
      history.push({ issue_id: n, new_value: 'In Progress', changed_at: day(0) })
      history.push({ issue_id: n, new_value: 'Done', changed_at: day(n) })
    }
    all.mockResolvedValueOnce(issues).mockResolvedValueOnce(history)

    const res = await request(app).get('/api/reports/cycle-time')
    expect(res.status).toBe(200)
    expect(res.body.summary.count).toBe(10)
    expect(res.body.summary.cycle.p50).toBe(5)
    expect(res.body.summary.cycle.p85).toBe(9)
    expect(res.body.summary.cycle.p95).toBe(10)
    expect(res.body.summary.cycle.average).toBe(5.5)
    // lead == cycle here (created == inProgress)
    expect(res.body.summary.lead.p85).toBe(9)
  })

  it('returns an empty summary when there are no Done issues', async () => {
    all.mockResolvedValueOnce([]) // no Done issues → second all() not called

    const res = await request(app).get('/api/reports/cycle-time?projectId=99')
    expect(res.status).toBe(200)
    expect(res.body.issues).toEqual([])
    expect(res.body.summary.count).toBe(0)
    expect(res.body.summary.cycle.p50).toBeNull()
    expect(all).toHaveBeenCalledTimes(1)
  })

  it('applies optional issueType/priority/assignee filters as bound params', async () => {
    all.mockResolvedValueOnce([]) // short-circuits after first query

    await request(app).get('/api/reports/cycle-time?projectId=7&issueType=Bug&priority=High&assignee=Alice')

    const call = all.mock.calls[0]
    expect(call[0]).toContain('issue_type = ?')
    expect(call[0]).toContain('priority = ?')
    expect(call[0]).toContain('assignee = ?')
    expect(call[1]).toEqual([7, 'Bug', 'High', 'Alice'])
  })
})
