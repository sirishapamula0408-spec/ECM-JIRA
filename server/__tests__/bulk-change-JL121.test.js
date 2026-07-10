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

vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { buildBulkPreview } from '../routes/issues.js'
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

function issue(overrides = {}) {
  return { id: 1, key: 'PROJ-1', status: 'To Do', priority: 'Medium', assignee: 'Alice', sprintId: null, ...overrides }
}
// DB row shape returned by the endpoint's SELECT
function row(overrides = {}) {
  return { id: 1, issue_key: 'PROJ-1', title: 'X', priority: 'Medium', assignee: 'Alice', status: 'To Do', sprint_id: null, project_id: 7, ...overrides }
}

describe('JL-121 — buildBulkPreview (pure helper)', () => {
  it('shows only the fields that actually change', () => {
    const issues = [issue({ id: 1, status: 'To Do', priority: 'High', assignee: 'Alice' })]
    // status changes, priority already High (unchanged), assignee changes
    const preview = buildBulkPreview(issues, { status: 'Done', priority: 'High', assignee: 'Bob' })
    expect(preview).toHaveLength(1)
    const fields = preview[0].changes.map((c) => c.field)
    expect(fields).toContain('status')
    expect(fields).toContain('assignee')
    expect(fields).not.toContain('priority') // no-op field excluded
    expect(preview[0].willChange).toBe(true)
    const statusChange = preview[0].changes.find((c) => c.field === 'status')
    expect(statusChange).toEqual({ field: 'status', from: 'To Do', to: 'Done' })
  })

  it('flags a no-op when every requested value already matches', () => {
    const issues = [issue({ status: 'Done', priority: 'Medium' })]
    const preview = buildBulkPreview(issues, { status: 'Done', priority: 'Medium' })
    expect(preview[0].changes).toEqual([])
    expect(preview[0].willChange).toBe(false)
    expect(preview[0].error).toBeNull()
  })

  it('records a value-level error for an invalid status', () => {
    const preview = buildBulkPreview([issue()], { status: 'Nope' })
    expect(preview[0].error).toMatch(/Invalid status/i)
    expect(preview[0].changes).toEqual([])
  })

  it('marks every issue for deletion when delete=true', () => {
    const preview = buildBulkPreview([issue({ id: 1 }), issue({ id: 2 })], { delete: true })
    expect(preview.every((p) => p.delete && p.willChange)).toBe(true)
  })
})

describe('JL-121 — POST /api/issues/bulk', () => {
  it('empty issueIds → 400', async () => {
    const res = await request(app).post('/api/issues/bulk').send({ issueIds: [], operations: { status: 'Done' } })
    expect(res.status).toBe(400)
    expect(all).not.toHaveBeenCalled()
  })

  it('dryRun returns a preview and writes nothing', async () => {
    all.mockResolvedValueOnce([row({ id: 1, status: 'To Do' }), row({ id: 2, issue_key: 'PROJ-2', status: 'To Do' })])
    const res = await request(app)
      .post('/api/issues/bulk')
      .send({ issueIds: [1, 2], operations: { status: 'Done' }, dryRun: true })

    expect(res.status).toBe(200)
    expect(res.body.dryRun).toBe(true)
    expect(res.body.preview).toHaveLength(2)
    expect(res.body.preview[0].changes[0]).toMatchObject({ field: 'status', to: 'Done' })
    // No writes at all during a dry run
    expect(run).not.toHaveBeenCalled()
  })

  it('applies valid issues, reports errors for missing ones, and continues', async () => {
    // ids 1 & 2 exist; 99 is requested but not returned by the SELECT
    all.mockResolvedValueOnce([row({ id: 1, status: 'To Do' }), row({ id: 2, issue_key: 'PROJ-2', status: 'To Do' })])
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app)
      .post('/api/issues/bulk')
      .send({ issueIds: [1, 2, 99], operations: { status: 'Done' }, dryRun: false })

    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(2)
    expect(res.body.skipped).toBe(1)
    expect(res.body.errors).toEqual([{ issueId: 99, error: 'Issue not found' }])
    // Two UPDATE statements were issued (one per valid issue)
    const updateCalls = run.mock.calls.filter((c) => /UPDATE issues SET/.test(c[0]))
    expect(updateCalls).toHaveLength(2)
  })

  it('reports a per-issue error for an invalid status and writes no UPDATE', async () => {
    all.mockResolvedValueOnce([row({ id: 1 }), row({ id: 2, issue_key: 'PROJ-2' })])
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app)
      .post('/api/issues/bulk')
      .send({ issueIds: [1, 2], operations: { status: 'Bogus' }, dryRun: false })

    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(0)
    expect(res.body.skipped).toBe(2)
    expect(res.body.errors).toHaveLength(2)
    expect(run.mock.calls.filter((c) => /UPDATE issues SET/.test(c[0]))).toHaveLength(0)
  })

  it('reports sprint-not-found as a per-issue error', async () => {
    all.mockResolvedValueOnce([row({ id: 1, sprint_id: null })])
    get.mockResolvedValueOnce(undefined) // sprint lookup → not found
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app)
      .post('/api/issues/bulk')
      .send({ issueIds: [1], operations: { sprintId: 555 }, dryRun: false })

    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(0)
    expect(res.body.errors[0]).toEqual({ issueId: 1, error: 'Sprint not found' })
  })
})
