import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module used by the issues route (and its imported services)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Keep automation / events side-effects inert
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/issues', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/issues.js')
  app = createApp(mod)
})

// Shared base issue row shape returned by SELECTs
function issueRow(overrides = {}) {
  return {
    id: 1,
    issue_key: 'PROJ-1',
    title: 'Sample',
    description: 'desc',
    priority: 'Medium',
    assignee: 'Alice',
    status: 'Backlog',
    issue_type: 'Story',
    sprint_id: null,
    project_id: null,
    parent_id: null,
    epic_id: null,
    story_points: null,
    created_at: '2026-01-01T00:00:00Z',
    reporter: 'test@test.com',
    due_date: null,
    start_date: null,
    resolution: null,
    environment: null,
    components: null,
    updated_at: null,
    ...overrides,
  }
}

describe('JL-76 — Epic issue type & hierarchy', () => {
  it('creates an Epic issue (top-level, no epic_id)', async () => {
    // get() call order: COUNT, then final row SELECT
    get.mockResolvedValueOnce({ count: 0 }) // COUNT for issue key
    get.mockResolvedValueOnce(issueRow({ id: 10, issue_key: 'PROJ-1', issue_type: 'Epic', title: 'Big Epic' }))
    run.mockResolvedValue({ lastID: 10, changes: 1 })

    const res = await request(app).post('/api/issues').send({
      title: 'Big Epic',
      description: 'An epic',
      assignee: 'Alice',
      priority: 'Medium',
      status: 'Backlog',
      issueType: 'Epic',
    })

    expect(res.status).toBe(201)
    expect(res.body.issueType).toBe('Epic')
    expect(res.body.epicId).toBeNull()
  })

  it('assigns a Story to an epic via epic_id on create', async () => {
    // get() order: COUNT, epic ref lookup, final row
    get.mockResolvedValueOnce({ count: 3 }) // COUNT
    get.mockResolvedValueOnce({ id: 5, issue_type: 'Epic' }) // validateEpicRef
    get.mockResolvedValueOnce(issueRow({ id: 11, issue_key: 'PROJ-4', issue_type: 'Story', epic_id: 5 }))
    run.mockResolvedValue({ lastID: 11, changes: 1 })

    const res = await request(app).post('/api/issues').send({
      title: 'Story under epic',
      description: 'child',
      assignee: 'Bob',
      priority: 'High',
      status: 'Backlog',
      issueType: 'Story',
      epicId: 5,
    })

    expect(res.status).toBe(201)
    expect(res.body.epicId).toBe(5)
    // INSERT must have received epic_id = 5
    const insertCall = run.mock.calls.find((c) => /INSERT INTO issues/.test(c[0]))
    expect(insertCall).toBeTruthy()
    expect(insertCall[1]).toContain(5)
  })

  it('rejects epic_id set on an Epic issue', async () => {
    get.mockResolvedValueOnce({ count: 0 }) // COUNT

    const res = await request(app).post('/api/issues').send({
      title: 'Nested epic',
      description: 'bad',
      assignee: 'Alice',
      priority: 'Medium',
      status: 'Backlog',
      issueType: 'Epic',
      epicId: 5,
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Epic cannot belong/i)
    // No INSERT should have happened
    expect(run.mock.calls.find((c) => /INSERT INTO issues/.test(c[0]))).toBeFalsy()
  })

  it('rejects epic_id referencing a non-Epic issue', async () => {
    get.mockResolvedValueOnce({ count: 0 }) // COUNT
    get.mockResolvedValueOnce({ id: 9, issue_type: 'Story' }) // ref is not an Epic

    const res = await request(app).post('/api/issues').send({
      title: 'Story',
      description: 'x',
      assignee: 'Alice',
      priority: 'Medium',
      status: 'Backlog',
      issueType: 'Story',
      epicId: 9,
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not an Epic/i)
  })

  it('returns epic children and a rollup percent', async () => {
    get.mockResolvedValueOnce({ id: 1, issue_type: 'Epic' }) // epic exists
    all.mockResolvedValueOnce([
      issueRow({ id: 2, issue_key: 'PROJ-2', status: 'Done', epic_id: 1 }),
      issueRow({ id: 3, issue_key: 'PROJ-3', status: 'Done', epic_id: 1 }),
      issueRow({ id: 4, issue_key: 'PROJ-4', status: 'In Progress', epic_id: 1 }),
      issueRow({ id: 5, issue_key: 'PROJ-5', status: 'To Do', epic_id: 1 }),
    ])

    const res = await request(app).get('/api/issues/1/epic-children')

    expect(res.status).toBe(200)
    expect(res.body.children).toHaveLength(4)
    expect(res.body.rollup).toEqual({ total: 4, done: 2, percent: 50 })
    expect(res.body.children[0].epicId).toBe(1)
  })

  it('mapIssue exposes epicId via GET /api/issues/:id', async () => {
    get.mockResolvedValueOnce(issueRow({ id: 7, issue_key: 'PROJ-7', epic_id: 42 }))

    const res = await request(app).get('/api/issues/7')

    expect(res.status).toBe(200)
    expect(res.body.epicId).toBe(42)
  })

  it('assigns and clears an epic via PATCH', async () => {
    // existing issue (Story, no epic)
    get.mockResolvedValueOnce(issueRow({ id: 8, issue_type: 'Story', epic_id: null }))
    // validateEpicRef lookup → Epic
    get.mockResolvedValueOnce({ id: 3, issue_type: 'Epic' })
    // updated row
    get.mockResolvedValueOnce(issueRow({ id: 8, issue_type: 'Story', epic_id: 3 }))
    run.mockResolvedValue({ lastID: 8, changes: 1 })

    const res = await request(app).patch('/api/issues/8').send({ epicId: 3 })

    expect(res.status).toBe(200)
    expect(res.body.epicId).toBe(3)
    const updateCall = run.mock.calls.find((c) => /UPDATE issues SET/.test(c[0]))
    expect(updateCall[0]).toMatch(/epic_id = \?/)
  })
})
