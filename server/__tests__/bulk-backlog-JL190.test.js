// JL-190 — Backlog bulk toolbar backend.
//  - buildBulkPreview: unassign, issue type, sprint moves that imply a status
//  - POST /api/issues/bulk: status changes go through the same workflow path as
//    PATCH /:id/status, so a refused transition is a per-issue error that leaves
//    the issue untouched while the rest of the batch still applies.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

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
vi.mock('../services/workflow.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTransitions: vi.fn().mockResolvedValue([]),
  loadWorkflowMeta: vi.fn().mockResolvedValue(null),
}))
vi.mock('../services/approvals.js', async (importOriginal) => ({
  ...(await importOriginal()),
  evaluateApproval: vi.fn().mockResolvedValue({ required: false }),
}))

import { run, all, get } from '../db.js'
import { loadTransitions } from '../services/workflow.js'
import { emitEvent } from '../services/events.js'
import { buildBulkPreview } from '../routes/issues.js'
import { errorHandler } from '../middleware/errorHandler.js'

let app
beforeEach(async () => {
  vi.clearAllMocks()
  loadTransitions.mockResolvedValue([])
  const mod = await import('../routes/issues.js')
  app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/issues', mod.default)
  app.use(errorHandler)
})

function issue(overrides = {}) {
  return { id: 1, key: 'ECM-1', status: 'To Do', priority: 'Medium', assignee: 'Alice', issueType: 'Task', epicId: null, sprintId: 5, ...overrides }
}
function row(overrides = {}) {
  return {
    id: 1, issue_key: 'ECM-1', title: 'X', priority: 'Medium', assignee: 'Alice', status: 'To Do',
    issue_type: 'Task', epic_id: null, sprint_id: 5, project_id: 7, ...overrides,
  }
}
// Rows served by get() for the per-issue re-reads, keyed by id.
function serveRows(rowsById) {
  get.mockImplementation(async (sql, params) => {
    if (/FROM members/.test(sql)) return { email: 'bob@test.com' }
    if (/FROM sprints/.test(sql)) return { id: params?.[0] ?? 5, project_id: 7 }
    return rowsById[params?.[0]] ?? undefined
  })
}
const updates = () => run.mock.calls.filter((c) => /^UPDATE issues SET/.test(c[0]))
const history = () => run.mock.calls.filter((c) => /INSERT INTO issue_history/.test(c[0])).map((c) => c[1])

describe('JL-190 — buildBulkPreview', () => {
  it('an explicit null assignee unassigns; already-unassigned is a no-op', () => {
    const [a, b] = buildBulkPreview([issue({ id: 1 }), issue({ id: 2, assignee: null })], { assignee: null })
    expect(a.changes).toEqual([{ field: 'assignee', from: 'Alice', to: null }])
    expect(b.willChange).toBe(false)
  })

  it('changes issue type, but refuses Sub-task in either direction', () => {
    const [toBug, fromSub] = buildBulkPreview([issue({ id: 1 }), issue({ id: 2, issueType: 'Sub-task' })], { issueType: 'Bug' })
    const [toSub] = buildBulkPreview([issue({ id: 3 })], { issueType: 'Sub-task' })
    expect(toBug.changes).toEqual([{ field: 'issueType', from: 'Task', to: 'Bug' }])
    expect(fromSub.error).toMatch(/Sub-task/)
    expect(toSub.error).toMatch(/Sub-task/)
  })

  it('refuses turning an issue that sits in an Epic into an Epic, and rejects unknown types', () => {
    const [inEpic] = buildBulkPreview([issue({ epicId: 9 })], { issueType: 'Epic' })
    const [bogus] = buildBulkPreview([issue()], { issueType: 'Feature' })
    expect(inEpic.error).toMatch(/Epic/)
    expect(bogus.error).toMatch(/Invalid issue type/)
  })

  it('moving to the backlog implies status Backlog; into a sprint from Backlog implies To Do', () => {
    const [toBacklog] = buildBulkPreview([issue({ status: 'In Progress' })], { sprintId: null })
    expect(toBacklog.changes).toContainEqual({ field: 'status', from: 'In Progress', to: 'Backlog', implied: true })

    const [toSprint] = buildBulkPreview([issue({ status: 'Backlog', sprintId: null })], { sprintId: 5 })
    expect(toSprint.changes).toContainEqual({ field: 'sprintId', from: null, to: 5 })
    expect(toSprint.changes).toContainEqual({ field: 'status', from: 'Backlog', to: 'To Do', implied: true })
  })

  it('an explicit status wins over the implied one, and an in-sprint issue keeps its status', () => {
    const [explicit] = buildBulkPreview([issue({ status: 'Backlog', sprintId: null })], { sprintId: 5, status: 'In Progress' })
    expect(explicit.changes.filter((c) => c.field === 'status')).toEqual([{ field: 'status', from: 'Backlog', to: 'In Progress' }])

    const [kept] = buildBulkPreview([issue({ status: 'In Progress', sprintId: 4 })], { sprintId: 5 })
    expect(kept.changes.map((c) => c.field)).toEqual(['sprintId'])
  })
})

describe('JL-190 — POST /api/issues/bulk', () => {
  it('rejects more than 500 ids before touching the database', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1)
    const res = await request(app).post('/api/issues/bulk').send({ issueIds: ids, operations: { priority: 'High' } })
    expect(res.status).toBe(400)
    expect(all).not.toHaveBeenCalled()
  })

  it('a workflow-refused transition fails that issue only, with its key and reason', async () => {
    // Only To Do → In Progress is configured, so ECM-2 (Code Review) cannot move.
    loadTransitions.mockResolvedValue([{ from_status: 'To Do', to_status: 'In Progress' }])
    const rows = { 1: row({ id: 1 }), 2: row({ id: 2, issue_key: 'ECM-2', status: 'Code Review' }) }
    all.mockResolvedValueOnce(Object.values(rows))
    all.mockResolvedValue([])
    serveRows(rows)
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app).post('/api/issues/bulk').send({ issueIds: [1, 2], operations: { status: 'In Progress' } })

    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(1)
    expect(res.body.results).toContainEqual({
      issueId: 2, key: 'ECM-2', applied: false,
      error: 'Transition from "Code Review" to "In Progress" is not allowed by the workflow',
    })
    // ECM-1 moved; ECM-2 was never written to.
    expect(updates()).toHaveLength(1)
    expect(updates()[0][1]).toEqual(['In Progress', 5, 1])
  })

  it('the refusal also shows in a dry-run preview, with no writes', async () => {
    loadTransitions.mockResolvedValue([{ from_status: 'To Do', to_status: 'In Progress' }])
    all.mockResolvedValueOnce([row({ id: 2, issue_key: 'ECM-2', status: 'Code Review' })])
    all.mockResolvedValue([])

    const res = await request(app).post('/api/issues/bulk').send({ issueIds: [2], operations: { status: 'In Progress' }, dryRun: true })

    expect(res.body.preview[0].error).toMatch(/not allowed by the workflow/)
    expect(run).not.toHaveBeenCalled()
  })

  it('a bulk status change leaves the same history and activity trail as a single one', async () => {
    const rows = { 1: row({ id: 1 }) }
    all.mockResolvedValueOnce(Object.values(rows))
    all.mockResolvedValue([])
    serveRows(rows)
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    await request(app).post('/api/issues/bulk').send({ issueIds: [1], operations: { status: 'In Progress' } })

    expect(history()).toContainEqual([1, 'status', 'To Do', 'In Progress', 'admin@test.com'])
    const activity = run.mock.calls.filter((c) => /INSERT INTO activity/.test(c[0]))
    expect(activity).toHaveLength(1)
    expect(activity[0][1][1]).toBe('moved ECM-1 to IN PROGRESS')
    expect(emitEvent).toHaveBeenCalledWith('issue.status_changed', expect.anything(), 7)
  })

  it('refuses closing a parent with open sub-tasks, per issue', async () => {
    all.mockResolvedValueOnce([row({ id: 1 })])
    all.mockResolvedValue([{ id: 30, issue_key: 'ECM-30', title: 'child', status: 'To Do' }])
    serveRows({ 1: row({ id: 1 }) })

    const res = await request(app).post('/api/issues/bulk').send({ issueIds: [1], operations: { status: 'Done' } })

    expect(res.body.results[0]).toMatchObject({ key: 'ECM-1', applied: false, error: 'Cannot close issue with open sub-tasks' })
    expect(updates()).toHaveLength(0)
  })

  it('moving to the backlog goes through the transition and clears the sprint', async () => {
    const rows = { 1: row({ id: 1, status: 'In Progress' }) }
    all.mockResolvedValueOnce(Object.values(rows))
    all.mockResolvedValue([])
    serveRows(rows)
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app).post('/api/issues/bulk').send({ issueIds: [1], operations: { sprintId: null } })

    expect(res.body.updated).toBe(1)
    // One write: the transition itself (status Backlog, sprint NULL) — no separate sprint_id UPDATE.
    expect(updates()).toHaveLength(1)
    expect(updates()[0][1]).toEqual(['Backlog', null, 1])
  })

  it('unassigns and changes issue type with history named like single edits', async () => {
    const rows = { 1: row({ id: 1 }) }
    all.mockResolvedValueOnce(Object.values(rows))
    serveRows(rows)
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app).post('/api/issues/bulk').send({ issueIds: [1], operations: { assignee: null, issueType: 'Bug' } })

    expect(res.body.updated).toBe(1)
    expect(updates()).toHaveLength(1)
    expect(updates()[0][0]).toMatch(/assignee = \?, issue_type = \?/)
    expect(updates()[0][1]).toEqual([null, 'Bug', 1])
    expect(history()).toContainEqual([1, 'type', 'Task', 'Bug', 'admin@test.com'])
    expect(emitEvent).toHaveBeenCalledWith('issue.updated', expect.anything(), 7)
  })
})
