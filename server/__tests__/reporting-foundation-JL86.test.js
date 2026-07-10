import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB — same pattern as collaboration-modules.test.js)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Automation engine is invoked from the issues status route — stub it out.
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Helper: create an app with an auth/role stub (Admin passes requireRole).
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
   JL-86: story_points accepted on create + returned by mapIssue
   ================================================================ */
describe('Issues API — story points (JL-86)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/issues.js')
    app = createApp(mod)
  })

  it('accepts storyPoints on create and returns it (mapIssue → storyPoints)', async () => {
    // get sequence: project lookup, JL-92 counter increment, final row fetch
    get
      .mockResolvedValueOnce({ id: 1, key: 'PROJ' }) // project lookup
      .mockResolvedValueOnce({ issue_counter: 1 }) // JL-92 monotonic counter
      .mockResolvedValueOnce({
        id: 42,
        issue_key: 'PROJ-1',
        title: 'Pointed story',
        description: 'desc',
        priority: 'High',
        assignee: 'Alice',
        status: 'Backlog',
        issue_type: 'Story',
        sprint_id: null,
        project_id: 1,
        parent_id: null,
        story_points: 8,
        created_at: new Date().toISOString(),
      })
    run.mockResolvedValue({ lastID: 42, changes: 1 })

    const res = await request(app).post('/api').send({
      projectId: 1,
      title: 'Pointed story',
      description: 'desc',
      priority: 'High',
      assignee: 'Alice',
      status: 'Backlog',
      issueType: 'Story',
      storyPoints: 8,
    })

    expect(res.status).toBe(201)
    expect(res.body.storyPoints).toBe(8)

    // The INSERT must persist story_points as the last bound value.
    const insertCall = run.mock.calls.find((c) => /INSERT INTO issues/.test(c[0]))
    expect(insertCall).toBeDefined()
    expect(insertCall[0]).toContain('story_points')
    expect(insertCall[1]).toContain(8)
  })

  it('rejects a negative storyPoints value', async () => {
    get
      .mockResolvedValueOnce({ id: 1, key: 'PROJ' })
      .mockResolvedValueOnce({ count: 0 })
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app).post('/api').send({
      projectId: 1,
      title: 'Bad',
      description: 'desc',
      priority: 'Low',
      assignee: 'Bob',
      status: 'Backlog',
      issueType: 'Task',
      storyPoints: -3,
    })

    expect(res.status).toBe(400)
    expect(run.mock.calls.some((c) => /INSERT INTO issues/.test(c[0]))).toBe(false)
  })
})

/* ================================================================
   JL-86: reports toPoints prefers real story_points over heuristic
   ================================================================ */
describe('Reports API — toPoints prefers real story points (JL-86)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/reports.js')
    app = createApp(mod)
  })

  it('uses story_points when present, else falls back to the type heuristic', async () => {
    // Task heuristic = 3, but story_points=13 must win.
    // Story with null story_points falls back to 8.
    all
      .mockResolvedValueOnce([
        { priority: 'High', status: 'Done', issue_type: 'Task', sprint_id: null, story_points: 13 },
        { priority: 'Low', status: 'To Do', issue_type: 'Story', sprint_id: null, story_points: null },
      ])
      .mockResolvedValueOnce([]) // sprints

    const res = await request(app).get('/api')
    expect(res.status).toBe(200)
    // 13 (real) + 8 (heuristic fallback for Story) = 21
    expect(res.body.totalPoints).toBe(21)
  })
})

/* ================================================================
   JL-86: sprint start sets start_date and snapshots scope
   ================================================================ */
describe('Sprints API — start sets start_date + snapshots scope (JL-86)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/sprints.js')
    app = createApp(mod)
  })

  it('sets start_date=NOW() and inserts a sprint_scope row per current issue', async () => {
    run.mockResolvedValue({ changes: 1 })
    // current issues in the sprint
    all.mockResolvedValueOnce([
      { id: 10, story_points: 5 },
      { id: 11, story_points: null },
    ])
    // final sprint row
    get.mockResolvedValueOnce({
      id: 7,
      name: 'Sprint 7',
      date_range: 'Jul 1 - Jul 14',
      is_started: true,
      start_date: new Date().toISOString(),
      end_date: null,
      completed_at: null,
    })

    const res = await request(app).patch('/api/7/start')

    expect(res.status).toBe(200)
    expect(res.body.isStarted).toBe(true)
    expect(res.body.startDate).toBeTruthy()

    // start_date must be stamped on the sprint
    const startUpdate = run.mock.calls.find(
      (c) => /UPDATE sprints/.test(c[0]) && /start_date = NOW\(\)/.test(c[0]),
    )
    expect(startUpdate).toBeDefined()

    // one sprint_scope insert per issue, carrying issue_id + points
    const scopeInserts = run.mock.calls.filter((c) => /INSERT INTO sprint_scope/.test(c[0]))
    expect(scopeInserts).toHaveLength(2)
    expect(scopeInserts[0][1]).toEqual([7, 10, 5])
    expect(scopeInserts[1][1]).toEqual([7, 11, null])
  })

  it('complete sets completed_at=NOW()', async () => {
    // sprint lookup, then final row
    get
      .mockResolvedValueOnce({ id: 7, name: 'Sprint 7', date_range: 'x', is_started: true })
      .mockResolvedValueOnce({
        id: 7,
        name: 'Sprint 7',
        date_range: 'x',
        is_started: false,
        start_date: null,
        end_date: null,
        completed_at: new Date().toISOString(),
      })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/7/complete')

    expect(res.status).toBe(200)
    const completeUpdate = run.mock.calls.find(
      (c) => /UPDATE sprints/.test(c[0]) && /completed_at = NOW\(\)/.test(c[0]),
    )
    expect(completeUpdate).toBeDefined()
    expect(res.body.completedAt).toBeTruthy()
  })
})
