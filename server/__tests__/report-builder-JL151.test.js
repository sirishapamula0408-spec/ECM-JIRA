import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import reportBuilder, {
  REPORT_DIMENSIONS,
  REPORT_MEASURES,
  REPORT_CHART_TYPES,
  validateReportDef,
  computeReport,
} from '../routes/reportBuilder.js'

function createApp(email = 'owner@test.com') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email, workspaceRole: 'Admin' }
    next()
  })
  app.use('/api', reportBuilder)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Pure: validateReportDef
   ================================================================ */
describe('validateReportDef', () => {
  it('exposes the builder vocabulary', () => {
    expect(REPORT_DIMENSIONS.map((d) => d.key)).toEqual(
      expect.arrayContaining(['status', 'assignee', 'priority', 'issue_type', 'project', 'label']),
    )
    expect(REPORT_MEASURES.map((m) => m.key)).toEqual(
      expect.arrayContaining(['count', 'sum_story_points', 'avg_cycle_time']),
    )
    expect(REPORT_CHART_TYPES.map((c) => c.key)).toEqual(
      expect.arrayContaining(['bar', 'line', 'pie', 'table']),
    )
  })

  it('accepts a valid definition', () => {
    const res = validateReportDef({ dimension: 'status', measure: 'count', chartType: 'bar' })
    expect(res.ok).toBe(true)
    expect(res.errors).toEqual([])
  })

  it('accepts a valid definition with optional filters', () => {
    const res = validateReportDef({
      dimension: 'assignee',
      measure: 'sum_story_points',
      chartType: 'pie',
      filters: { status: 'Done' },
    })
    expect(res.ok).toBe(true)
  })

  it('rejects an unknown dimension', () => {
    const res = validateReportDef({ dimension: 'nope', measure: 'count', chartType: 'bar' })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/dimension/)
  })

  it('rejects an unknown measure', () => {
    const res = validateReportDef({ dimension: 'status', measure: 'nope', chartType: 'bar' })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/measure/)
  })

  it('rejects an unknown chartType', () => {
    const res = validateReportDef({ dimension: 'status', measure: 'count', chartType: 'nope' })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/chartType/)
  })

  it('rejects a non-object definition', () => {
    expect(validateReportDef(null).ok).toBe(false)
    expect(validateReportDef('x').ok).toBe(false)
  })
})

/* ================================================================
   Pure: computeReport
   ================================================================ */
describe('computeReport', () => {
  const issues = [
    { id: 1, status: 'Done', assignee: 'a@x.com', priority: 'High', story_points: 3 },
    { id: 2, status: 'Done', assignee: 'a@x.com', priority: 'Low', story_points: 5 },
    { id: 3, status: 'To Do', assignee: 'b@x.com', priority: 'High', story_points: null },
    { id: 4, status: 'To Do', assignee: '', priority: 'High' },
  ]

  it('groups by status and counts correctly', () => {
    const { rows, meta } = computeReport(issues, { dimension: 'status', measure: 'count' })
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(map).toEqual({ Done: 2, 'To Do': 2 })
    expect(meta.totalIssues).toBe(4)
  })

  it('groups by assignee and buckets missing assignee as Unassigned', () => {
    const { rows } = computeReport(issues, { dimension: 'assignee', measure: 'count' })
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(map['a@x.com']).toBe(2)
    expect(map['b@x.com']).toBe(1)
    expect(map.Unassigned).toBe(1)
  })

  it('sums story points, ignoring nulls', () => {
    const { rows } = computeReport(issues, { dimension: 'status', measure: 'sum_story_points' })
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(map.Done).toBe(8) // 3 + 5
    expect(map['To Do']).toBe(0) // null + undefined ignored
  })

  it('averages cycle time from resolved - created, ignoring issues without both', () => {
    const withCycle = [
      { status: 'Done', created_at: '2024-01-01T00:00:00Z', resolved_at: '2024-01-02T00:00:00Z' }, // 24h
      { status: 'Done', created_at: '2024-01-01T00:00:00Z', resolved_at: '2024-01-01T12:00:00Z' }, // 12h
      { status: 'Done', created_at: '2024-01-01T00:00:00Z' }, // no resolved — ignored
    ]
    const { rows } = computeReport(withCycle, { dimension: 'status', measure: 'avg_cycle_time' })
    expect(rows[0].label).toBe('Done')
    expect(rows[0].value).toBe(18) // (24 + 12) / 2
  })

  it('buckets by label across multiple label buckets', () => {
    const labeled = [
      { status: 'Done', labels: ['backend', 'urgent'] },
      { status: 'Done', labels: ['backend'] },
      { status: 'Done', labels: [] },
    ]
    const { rows } = computeReport(labeled, { dimension: 'label', measure: 'count' })
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(map.backend).toBe(2)
    expect(map.urgent).toBe(1)
    expect(map.None).toBe(1)
  })

  it('returns an empty rows array for empty issues', () => {
    const { rows } = computeReport([], { dimension: 'status', measure: 'count' })
    expect(rows).toEqual([])
  })
})

/* ================================================================
   POST /api/report-builder/run
   ================================================================ */
describe('POST /api/report-builder/run', () => {
  it('returns rows for a count-by-status definition', async () => {
    get.mockResolvedValueOnce({ id: 1, name: 'Owner' }) // member lookup (JL-187 scoping)
    all
      .mockResolvedValueOnce([{ id: 100 }]) // accessible project ids
      .mockResolvedValueOnce([
        { id: 1, status: 'Done', project_name: 'P', project_id: 100 },
        { id: 2, status: 'Done', project_name: 'P', project_id: 100 },
        { id: 3, status: 'To Do', project_name: 'P', project_id: 100 },
      ])
    const app = createApp()
    const res = await request(app)
      .post('/api/report-builder/run')
      .send({ definition: { dimension: 'status', measure: 'count', chartType: 'bar' } })
    expect(res.status).toBe(200)
    const map = Object.fromEntries(res.body.rows.map((r) => [r.label, r.value]))
    expect(map).toEqual({ Done: 2, 'To Do': 1 })
    expect(res.body.meta.dimension).toBe('status')
  })

  it('rejects an invalid definition with 400', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/report-builder/run')
      .send({ definition: { dimension: 'bad', measure: 'count', chartType: 'bar' } })
    expect(res.status).toBe(400)
  })
})

/* ================================================================
   JL-187: /run is scoped to the caller's accessible projects.
   A user only aggregates over projects they can access — no
   cross-tenant leakage.
   ================================================================ */
describe('POST /api/report-builder/run — project scoping (JL-187)', () => {
  const validDef = { dimension: 'status', measure: 'count', chartType: 'bar' }

  it('constrains the issues query to the caller\'s accessible project ids', async () => {
    get.mockResolvedValueOnce({ id: 7, name: 'Member' }) // member lookup
    all
      .mockResolvedValueOnce([{ id: 42 }]) // caller can access only project 42
      .mockResolvedValueOnce([{ id: 1, status: 'Done', project_id: 42 }]) // issues in-scope
    const app = createApp('member@test.com')
    const res = await request(app).post('/api/report-builder/run').send({ definition: validDef })
    expect(res.status).toBe(200)

    // The issues load is the SECOND all() call. It must be scoped by project id.
    const [issuesSql, issuesParams] = all.mock.calls[1]
    expect(issuesSql).toMatch(/i\.project_id IN \(\?\)/)
    expect(issuesParams).toEqual([42])
  })

  it('returns an empty report (and never queries issues) when the caller has no accessible projects', async () => {
    get.mockResolvedValueOnce({ id: 9, name: 'Nobody' }) // member lookup
    all.mockResolvedValueOnce([]) // no accessible projects — another tenant's issues excluded
    const app = createApp('outsider@test.com')
    const res = await request(app).post('/api/report-builder/run').send({ definition: validDef })
    expect(res.status).toBe(200)
    expect(res.body.rows).toEqual([])
    expect(res.body.meta.totalIssues).toBe(0)
    // Only the accessible-projects query ran; the issues table was never loaded.
    expect(all).toHaveBeenCalledTimes(1)
  })

  it('AND-combines the caller\'s scope with an explicit project filter', async () => {
    get.mockResolvedValueOnce({ id: 3, name: 'Lead' })
    all
      .mockResolvedValueOnce([{ id: 10 }, { id: 20 }]) // accessible projects
      .mockResolvedValueOnce([{ id: 5, status: 'Done', project_id: 10 }])
    const app = createApp('lead@test.com')
    const res = await request(app)
      .post('/api/report-builder/run')
      .send({ definition: validDef, filters: { project: 10 } })
    expect(res.status).toBe(200)

    const [issuesSql, issuesParams] = all.mock.calls[1]
    // filter column first, then the scope IN-list
    expect(issuesSql).toMatch(/i\.project_id = \? AND i\.project_id IN \(\?, \?\)/)
    expect(issuesParams).toEqual([10, 10, 20])
  })
})

/* ================================================================
   Saved-report CRUD (owner-scoped)
   ================================================================ */
describe('saved-report CRUD', () => {
  const validDef = { dimension: 'status', measure: 'count', chartType: 'bar' }

  it('lists only the owner\'s reports', async () => {
    all.mockResolvedValueOnce([
      { id: 1, name: 'Mine', owner_email: 'owner@test.com', definition: validDef, created_at: 'now' },
    ])
    const app = createApp('owner@test.com')
    const res = await request(app).get('/api/report-builder/reports')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(all).toHaveBeenCalledWith(expect.stringContaining('owner_email = ?'), ['owner@test.com'])
  })

  it('creates a report for the current user', async () => {
    run.mockResolvedValueOnce({ lastID: 7, changes: 1 })
    get.mockResolvedValueOnce({
      id: 7,
      name: 'New',
      owner_email: 'owner@test.com',
      definition: validDef,
      created_at: 'now',
    })
    const app = createApp('owner@test.com')
    const res = await request(app)
      .post('/api/report-builder/reports')
      .send({ name: 'New', definition: validDef })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(7)
    expect(res.body.ownerEmail).toBe('owner@test.com')
  })

  it('rejects creating with an invalid definition', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/api/report-builder/reports')
      .send({ name: 'Bad', definition: { dimension: 'x', measure: 'count', chartType: 'bar' } })
    expect(res.status).toBe(400)
  })

  it('forbids a non-owner from editing (403)', async () => {
    get.mockResolvedValueOnce({ id: 1, owner_email: 'someone@else.com' })
    const app = createApp('owner@test.com')
    const res = await request(app)
      .patch('/api/report-builder/reports/1')
      .send({ name: 'Hijack' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('forbids a non-owner from deleting (403)', async () => {
    get.mockResolvedValueOnce({ id: 1, owner_email: 'someone@else.com' })
    const app = createApp('owner@test.com')
    const res = await request(app).delete('/api/report-builder/reports/1')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('allows the owner to delete (204)', async () => {
    get.mockResolvedValueOnce({ id: 1, owner_email: 'owner@test.com' })
    run.mockResolvedValueOnce({ changes: 1 })
    const app = createApp('owner@test.com')
    const res = await request(app).delete('/api/report-builder/reports/1')
    expect(res.status).toBe(204)
    expect(run).toHaveBeenCalledWith(expect.stringContaining('DELETE'), [1])
  })

  it('returns 404 when editing a missing report', async () => {
    get.mockResolvedValueOnce(undefined)
    const app = createApp()
    const res = await request(app).patch('/api/report-builder/reports/999').send({ name: 'x' })
    expect(res.status).toBe(404)
  })
})
