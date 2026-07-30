// @vitest-environment node
// JL-240: Project worklog timesheet — rollup by user/date + CSV export.
// Backend route test using the mocked-db `runRoute`/supertest pattern.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — no real database is touched.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { get, all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import worklogRoutes, { aggregateTimesheet, resolveWorklogRange } from '../routes/worklogs.js'

// Build an app whose stubbed user is configurable per-test (workspace role /
// project membership) so we can exercise the JL-225 read-scoping.
function createApp(user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/api', worklogRoutes)
  app.use(errorHandler)
  return app
}

const ADMIN = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }

// Flat rows as returned by the aggregation query (work_date = YYYY-MM-DD).
const SAMPLE_ROWS = [
  { id: 1, author: 'alice@test.com', time_spent_minutes: 60, issue_id: 10, issue_key: 'TP-10', issue_title: 'Login', work_date: '2026-07-01' },
  { id: 2, author: 'alice@test.com', time_spent_minutes: 30, issue_id: 10, issue_key: 'TP-10', issue_title: 'Login', work_date: '2026-07-01' },
  { id: 3, author: 'alice@test.com', time_spent_minutes: 45, issue_id: 11, issue_key: 'TP-11', issue_title: 'Signup', work_date: '2026-07-01' },
  { id: 4, author: 'alice@test.com', time_spent_minutes: 90, issue_id: 10, issue_key: 'TP-10', issue_title: 'Login', work_date: '2026-07-02' },
  { id: 5, author: 'bob@test.com', time_spent_minutes: 120, issue_id: 12, issue_key: 'TP-12', issue_title: 'Payments', work_date: '2026-07-02' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Pure aggregation — grouping correctness
   ================================================================ */
describe('aggregateTimesheet (grouping)', () => {
  it('groups by (user, date) with per-issue breakdown and totals', () => {
    const agg = aggregateTimesheet(SAMPLE_ROWS)

    // 3 groups: alice/07-01, alice/07-02, bob/07-02
    expect(agg.rollup).toHaveLength(3)

    const aliceDay1 = agg.rollup.find((g) => g.user === 'alice@test.com' && g.date === '2026-07-01')
    expect(aliceDay1.totalMinutes).toBe(135) // 60 + 30 + 45
    // two issues, TP-10 merged to 90 (60+30), TP-11 = 45
    const tp10 = aliceDay1.issues.find((i) => i.issueKey === 'TP-10')
    expect(tp10.minutes).toBe(90)
    expect(aliceDay1.issues).toHaveLength(2)

    // per-user totals
    const aliceTotal = agg.totalsByUser.find((u) => u.user === 'alice@test.com')
    expect(aliceTotal.totalMinutes).toBe(225) // 60+30+45+90
    const bobTotal = agg.totalsByUser.find((u) => u.user === 'bob@test.com')
    expect(bobTotal.totalMinutes).toBe(120)

    // per-date + grand totals
    expect(agg.totalsByDate.find((d) => d.date === '2026-07-02').totalMinutes).toBe(210) // 90 + 120
    expect(agg.grandTotalMinutes).toBe(345)
  })

  it('returns empty rollup for no rows', () => {
    const agg = aggregateTimesheet([])
    expect(agg.rollup).toEqual([])
    expect(agg.grandTotalMinutes).toBe(0)
  })
})

/* ================================================================
   Date-range resolution — default last 30 days
   ================================================================ */
describe('resolveWorklogRange (date filtering)', () => {
  it('defaults to the last 30 days when from/to omitted', () => {
    const { from, to, toExclusive } = resolveWorklogRange({})
    const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000
    expect(days).toBe(30)
    // toExclusive is the day after `to`
    const exc = (new Date(`${toExclusive}T00:00:00Z`) - new Date(`${to}T00:00:00Z`)) / 86400000
    expect(exc).toBe(1)
  })

  it('honors explicit from/to and ignores malformed values', () => {
    const { from, to } = resolveWorklogRange({ from: '2026-01-01', to: '2026-01-31' })
    expect(from).toBe('2026-01-01')
    expect(to).toBe('2026-01-31')

    const bad = resolveWorklogRange({ from: 'not-a-date', to: '2026-02-15' })
    expect(bad.to).toBe('2026-02-15')
    // bad `from` falls back to 30 days before `to`
    expect(bad.from).toBe('2026-01-16')
  })
})

/* ================================================================
   GET /api/projects/:projectId/worklogs — endpoint
   ================================================================ */
describe('GET /api/projects/:projectId/worklogs', () => {
  it('returns the JSON rollup for a workspace admin', async () => {
    get.mockResolvedValue({ id: 5, key: 'TP', name: 'Test Project' })
    all.mockResolvedValue(SAMPLE_ROWS)

    const res = await request(createApp(ADMIN)).get('/api/projects/5/worklogs')
    expect(res.status).toBe(200)
    expect(res.body.projectKey).toBe('TP')
    expect(res.body.rollup).toHaveLength(3)
    expect(res.body.grandTotalMinutes).toBe(345)
    expect(res.body.from).toBeTruthy()
    expect(res.body.to).toBeTruthy()
  })

  it('passes the resolved date range into the query bounds', async () => {
    get.mockResolvedValue({ id: 5, key: 'TP', name: 'Test Project' })
    all.mockResolvedValue([])

    await request(createApp(ADMIN)).get('/api/projects/5/worklogs?from=2026-03-01&to=2026-03-31')
    const [, params] = all.mock.calls[0]
    expect(params[0]).toBe(5)
    expect(params[1]).toBe('2026-03-01')
    expect(params[2]).toBe('2026-04-01') // exclusive upper bound = to + 1 day
  })

  it('returns 404 when the project does not exist', async () => {
    get.mockResolvedValue(null)
    const res = await request(createApp(ADMIN)).get('/api/projects/999/worklogs')
    expect(res.status).toBe(404)
  })

  it('forbids a workspace Viewer who is NOT a project member (JL-225 scoping)', async () => {
    const outsider = { id: 2, email: 'outsider@test.com', memberId: 2, workspaceRole: 'Viewer', isOwner: false }
    // Project EXISTS but the caller has no membership row and is not the lead —
    // resolveProjectAccess → hasAccess:false → 403 (a missing project would instead
    // fall through to the handler's own 404).
    get.mockResolvedValue({ id: 5, lead_member_id: null, project_role: null })
    const res = await request(createApp(outsider)).get('/api/projects/5/worklogs')
    expect(res.status).toBe(403)
    // the handler's project fetch must never run for a forbidden caller
    expect(all).not.toHaveBeenCalled()
  })

  it('allows a project member (non-admin) to read the timesheet', async () => {
    const member = { id: 3, email: 'member@test.com', memberId: 3, workspaceRole: 'Viewer', isOwner: false }
    // First get() = membership resolution (project row + project_role), then the
    // handler's project lookup.
    get
      .mockResolvedValueOnce({ id: 5, lead_member_id: null, project_role: 'Member' })
      .mockResolvedValueOnce({ id: 5, key: 'TP', name: 'Test Project' })
    all.mockResolvedValue(SAMPLE_ROWS)

    const res = await request(createApp(member)).get('/api/projects/5/worklogs')
    expect(res.status).toBe(200)
    expect(res.body.rollup).toHaveLength(3)
  })

  it('returns CSV with the expected header + row shape for format=csv', async () => {
    get.mockResolvedValue({ id: 5, key: 'TP', name: 'Test Project' })
    all.mockResolvedValue(SAMPLE_ROWS)

    const res = await request(createApp(ADMIN)).get('/api/projects/5/worklogs?format=csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/attachment/)
    expect(res.headers['content-disposition']).toMatch(/TP-timesheet/)

    const lines = res.text.split('\n')
    expect(lines[0]).toBe('User,Date,Issue Key,Issue Title,Minutes')
    // one row per (user,date,issue): alice/07-01 TP-10, alice/07-01 TP-11,
    // alice/07-02 TP-10, bob/07-02 TP-12 = 4 data rows
    expect(lines).toHaveLength(5)
    expect(lines[1]).toBe('alice@test.com,2026-07-01,TP-10,Login,90')
  })
})
