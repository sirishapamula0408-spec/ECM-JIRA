import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB — matches the collaboration-modules.test.js pattern)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Automation service pulls from db too; stub the status-change hook to a no-op.
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath = '/api/issues') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'reporter@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

function issueRow(overrides = {}) {
  return {
    id: 1,
    issue_key: 'PROJ-1',
    title: 'Sample',
    description: 'Desc',
    priority: 'Medium',
    assignee: 'Alice',
    status: 'Backlog',
    issue_type: 'Story',
    sprint_id: null,
    project_id: 1,
    parent_id: null,
    epic_id: null,
    story_points: null,
    created_at: '2026-07-08T00:00:00.000Z',
    reporter: 'reporter@test.com',
    due_date: null,
    start_date: null,
    resolution: null,
    environment: null,
    components: null,
    updated_at: null,
    ...overrides,
  }
}

const validBody = {
  projectId: 1,
  title: 'Sample',
  description: 'Desc',
  assignee: 'Alice',
  priority: 'Medium',
  status: 'Backlog',
  issueType: 'Story',
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/issues.js')
  app = createApp(mod)
})

describe('JL-92 — monotonic per-project issue-key generation', () => {
  it('uses the counter returned by the atomic increment (not COUNT), so keys never reuse numbers after a delete', async () => {
    // Simulate a project that previously had issues up to PROJ-5, one of which was
    // deleted (so only 4 rows remain). COUNT(*)+1 would wrongly yield PROJ-5 again;
    // the monotonic counter returns 6.
    get
      .mockResolvedValueOnce({ id: 1, key: 'PROJ' }) // project lookup
      .mockResolvedValueOnce({ issue_counter: 6 }) // atomic UPDATE ... RETURNING issue_counter
      .mockResolvedValueOnce(issueRow({ id: 20, issue_key: 'PROJ-6' })) // re-read created row
    run.mockResolvedValue({ lastID: 20, changes: 1 })

    const res = await request(app).post('/api/issues').send(validBody)

    expect(res.status).toBe(201)
    expect(res.body.key).toBe('PROJ-6')

    // The counter came from the atomic UPDATE, not a COUNT query.
    const counterCall = get.mock.calls.find(
      ([sql]) => /UPDATE projects SET issue_counter = issue_counter \+ 1/.test(sql) && /RETURNING issue_counter/.test(sql),
    )
    expect(counterCall).toBeTruthy()

    // No COUNT(*) over issues is used on the project path.
    const countCall = get.mock.calls.find(([sql]) => /COUNT\(\*\)/i.test(sql) && /FROM issues/i.test(sql))
    expect(countCall).toBeFalsy()

    // The INSERT persisted the counter-derived key.
    const insertCall = run.mock.calls.find(([sql]) => /INSERT INTO issues/.test(sql))
    expect(insertCall).toBeTruthy()
    expect(insertCall[1][0]).toBe('PROJ-6')
  })

  it('gives two sequential creates distinct, increasing keys', async () => {
    // First create → counter 1 → PROJ-1
    get
      .mockResolvedValueOnce({ id: 1, key: 'PROJ' })
      .mockResolvedValueOnce({ issue_counter: 1 })
      .mockResolvedValueOnce(issueRow({ id: 1, issue_key: 'PROJ-1' }))
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const first = await request(app).post('/api/issues').send(validBody)
    expect(first.status).toBe(201)
    expect(first.body.key).toBe('PROJ-1')

    // Second create → counter 2 → PROJ-2
    get.mockReset()
    get
      .mockResolvedValueOnce({ id: 1, key: 'PROJ' })
      .mockResolvedValueOnce({ issue_counter: 2 })
      .mockResolvedValueOnce(issueRow({ id: 2, issue_key: 'PROJ-2' }))

    const second = await request(app).post('/api/issues').send(validBody)
    expect(second.status).toBe(201)
    expect(second.body.key).toBe('PROJ-2')

    // Distinct and strictly increasing.
    expect(second.body.key).not.toBe(first.body.key)
  })
})
