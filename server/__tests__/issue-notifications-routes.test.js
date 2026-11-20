// @vitest-environment node
// The issue routes hand the right event to the notification service — create,
// assignee change, status change, sub-task, clone — and a bulk edit hands over
// ONE batch (so each person gets a summary) instead of a message per issue.
// The service itself is covered by issue-notifications.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { makeDbMock } from './helpers/mockDb.js'

vi.mock('../db.js', () => makeDbMock())
vi.mock('../services/automation.js', () => ({ runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/events.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))
vi.mock('../services/mentions.js', () => ({ processMentions: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/workflow.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadTransitions: vi.fn().mockResolvedValue([]),
  loadWorkflowMeta: vi.fn().mockResolvedValue(null),
}))
vi.mock('../services/approvals.js', async (importOriginal) => ({
  ...(await importOriginal()),
  evaluateApproval: vi.fn().mockResolvedValue({ required: false }),
}))
vi.mock('../services/issueNotifications.js', () => ({
  notifyIssueCreated: vi.fn().mockResolvedValue(undefined),
  notifyIssueAssigned: vi.fn().mockResolvedValue(undefined),
  notifyStatusChanged: vi.fn().mockResolvedValue(undefined),
  notifyBulkChanges: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  notifyIssueCreated, notifyIssueAssigned, notifyStatusChanged, notifyBulkChanges,
} from '../services/issueNotifications.js'

const ACTOR = 'admin@test.com'
const row = (o = {}) => ({
  id: 1, issue_key: 'ECM-1', title: 'X', description: 'd', priority: 'Medium', assignee: 'Alice', status: 'To Do',
  issue_type: 'Task', epic_id: null, sprint_id: 5, project_id: 7, reporter: ACTOR, ...o,
})

let rows
let app
beforeEach(async () => {
  vi.clearAllMocks()
  rows = { 1: row(), 2: row({ id: 2, issue_key: 'ECM-2' }) }
  get.mockImplementation(async (sql, params) => {
    if (/FROM projects WHERE id/.test(sql)) return { id: 7, key: 'ECM' }
    if (/issue_counter/.test(sql)) return { issue_counter: 9 }
    if (/FROM sprints/.test(sql)) return { id: 5, project_id: 7 }
    if (/FROM members/.test(sql)) return { email: 'bob@test.com' }
    if (/FROM issues WHERE id/.test(sql)) return rows[params?.[0]]
    return undefined
  })
  all.mockResolvedValue([])
  run.mockResolvedValue({ lastID: 1, changes: 1 })

  const { default: issues } = await import('../routes/issues.js')
  app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: ACTOR, memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/issues', issues)
  app.use(errorHandler)
})

describe('single-issue routes', () => {
  it('create → notifyIssueCreated', async () => {
    const res = await request(app).post('/api/issues').send({
      title: 'New', description: 'd', assignee: 'Bob', priority: 'Low', status: 'Backlog', issueType: 'Task', projectId: 7,
    })
    expect(res.status).toBe(201)
    expect(notifyIssueCreated).toHaveBeenCalledWith({ issueId: 1, actorEmail: ACTOR })
  })

  it('assignee change → notifyIssueAssigned with the previous assignee', async () => {
    const res = await request(app).patch('/api/issues/1').send({ assignee: 'Bob' })
    expect(res.status).toBe(200)
    expect(notifyIssueAssigned).toHaveBeenCalledWith({ issueId: 1, previousAssignee: 'Alice', actorEmail: ACTOR })
  })

  it('an edit that does not change the assignee notifies nobody', async () => {
    await request(app).patch('/api/issues/1').send({ title: 'Renamed' })
    await request(app).patch('/api/issues/1').send({ assignee: 'Alice' })
    expect(notifyIssueAssigned).not.toHaveBeenCalled()
  })

  it('status change → notifyStatusChanged with from and to', async () => {
    const res = await request(app).patch('/api/issues/1/status').send({ status: 'In Progress' })
    expect(res.status).toBe(200)
    expect(notifyStatusChanged).toHaveBeenCalledWith({ issueId: 1, fromStatus: 'To Do', toStatus: 'In Progress', actorEmail: ACTOR })
  })

  it('a status "change" to the same status notifies nobody', async () => {
    await request(app).patch('/api/issues/1/status').send({ status: 'To Do' })
    expect(notifyStatusChanged).not.toHaveBeenCalled()
  })

  it('sub-task create → notifyIssueCreated', async () => {
    const res = await request(app).post('/api/issues/1/subtasks').send({ title: 'Sub', assignee: 'Bob' })
    expect(res.status).toBe(201)
    expect(notifyIssueCreated).toHaveBeenCalledWith({ issueId: 1, actorEmail: ACTOR })
  })

  it('clone → notifyIssueCreated', async () => {
    const res = await request(app).post('/api/issues/1/clone').send({})
    expect(res.status).toBe(201)
    expect(notifyIssueCreated).toHaveBeenCalledWith({ issueId: 1, actorEmail: ACTOR })
  })
})

describe('POST /api/issues/bulk', () => {
  it('hands ONE batch to notifyBulkChanges — never a message per issue', async () => {
    all.mockResolvedValueOnce(Object.values(rows))
    const res = await request(app).post('/api/issues/bulk').send({
      issueIds: [1, 2], operations: { status: 'In Progress', assignee: 'Bob' },
    })
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(2)
    expect(notifyStatusChanged).not.toHaveBeenCalled()
    expect(notifyIssueAssigned).not.toHaveBeenCalled()
    expect(notifyBulkChanges).toHaveBeenCalledTimes(1)
    expect(notifyBulkChanges.mock.calls[0][0]).toEqual({
      actorEmail: ACTOR,
      changes: [
        { issueId: 1, status: { from: 'To Do', to: 'In Progress' }, assignee: { from: 'Alice' } },
        { issueId: 2, status: { from: 'To Do', to: 'In Progress' }, assignee: { from: 'Alice' } },
      ],
    })
  })

  it('a dry run, or a change to other fields only, notifies nobody', async () => {
    all.mockResolvedValueOnce(Object.values(rows))
    await request(app).post('/api/issues/bulk').send({ issueIds: [1, 2], operations: { status: 'In Progress' }, dryRun: true })
    all.mockResolvedValueOnce(Object.values(rows))
    await request(app).post('/api/issues/bulk').send({ issueIds: [1, 2], operations: { priority: 'High' } })
    expect(notifyBulkChanges).not.toHaveBeenCalled()
  })
})
