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

function issueRow(overrides = {}) {
  return {
    id: 1,
    issue_key: 'PROJ-1',
    title: 'Original title',
    description: 'the description',
    priority: 'High',
    assignee: 'Alice',
    status: 'To Do',
    issue_type: 'Bug',
    sprint_id: 5,
    project_id: null,
    parent_id: null,
    epic_id: 9,
    story_points: 3,
    created_at: '2026-01-01T00:00:00Z',
    reporter: 'reporter@test.com',
    due_date: null,
    start_date: null,
    resolution: null,
    environment: 'prod',
    components: 'api',
    updated_at: null,
    ...overrides,
  }
}

describe('JL-158 — Clone / duplicate issue', () => {
  it('clones an issue: new key, prefixed title, copied fields, 201', async () => {
    const source = issueRow()
    get
      .mockResolvedValueOnce(source) // load source issue
      .mockResolvedValueOnce({ count: 7 }) // COUNT for fresh key (project_id null → global count)
      .mockResolvedValueOnce(
        issueRow({ id: 42, issue_key: 'PROJ-8', title: 'CLONE - Original title' }),
      ) // final new-row SELECT
    all.mockResolvedValueOnce([]) // issue_labels for source
    run.mockResolvedValue({ lastID: 42, changes: 1 })

    const res = await request(app).post('/api/issues/1/clone').send({})

    expect(res.status).toBe(201)
    // New key is allocated fresh, not the source key
    expect(res.body.key).toBe('PROJ-8')
    expect(res.body.key).not.toBe(source.issue_key)
    expect(res.body.id).not.toBe(source.id)
    // Title is prefixed
    expect(res.body.title).toBe('CLONE - Original title')

    // The INSERT into issues copied core + expanded fields with the prefixed title
    const insertCall = run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO issues'),
    )
    expect(insertCall).toBeTruthy()
    const params = insertCall[1]
    expect(params[0]).toBe('PROJ-8') // fresh key
    expect(params[1]).toBe('CLONE - Original title') // prefixed title
    expect(params[2]).toBe(source.description)
    expect(params[3]).toBe(source.priority)
    expect(params[4]).toBe(source.assignee)
    expect(params[5]).toBe(source.status)
    expect(params[6]).toBe(source.issue_type)
    expect(params[7]).toBe(source.sprint_id)
    expect(params[8]).toBe(source.project_id)
    expect(params[9]).toBe(source.story_points)
    expect(params[10]).toBe(source.epic_id)

    // An activity row was recorded like a normal create
    const activityCall = run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO activity'),
    )
    expect(activityCall).toBeTruthy()
    expect(activityCall[1][1]).toContain('created PROJ-8')
  })

  it('allocates a project-scoped key when the source has a project', async () => {
    const source = issueRow({ project_id: 3 })
    get
      .mockResolvedValueOnce(source) // load source
      .mockResolvedValueOnce({ key: 'ECM' }) // project key lookup
      .mockResolvedValueOnce({ count: 11 }) // project-scoped COUNT
      .mockResolvedValueOnce(issueRow({ id: 99, issue_key: 'ECM-12', title: 'CLONE - Original title', project_id: 3 }))
    all.mockResolvedValueOnce([])
    run.mockResolvedValue({ lastID: 99, changes: 1 })

    const res = await request(app).post('/api/issues/1/clone').send({})

    expect(res.status).toBe(201)
    expect(res.body.key).toBe('ECM-12')
    expect(res.body.projectId).toBe(3)
  })

  it('copies labels from the source issue when present', async () => {
    const source = issueRow()
    get
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce(issueRow({ id: 42, issue_key: 'PROJ-1', title: 'CLONE - Original title' }))
    all.mockResolvedValueOnce([{ label_id: 10 }, { label_id: 20 }])
    run.mockResolvedValue({ lastID: 42, changes: 1 })

    const res = await request(app).post('/api/issues/1/clone').send({})

    expect(res.status).toBe(201)
    const labelInserts = run.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO issue_labels'),
    )
    expect(labelInserts).toHaveLength(2)
    expect(labelInserts[0][1]).toEqual([42, 10])
    expect(labelInserts[1][1]).toEqual([42, 20])
  })

  it('404s when the source issue does not exist', async () => {
    get.mockResolvedValueOnce(undefined)

    const res = await request(app).post('/api/issues/999/clone').send({})

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Issue not found')
    // No issue was inserted
    const insertCall = run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO issues'),
    )
    expect(insertCall).toBeFalsy()
  })

  it('400s on an invalid issue id', async () => {
    const res = await request(app).post('/api/issues/abc/clone').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid issue id')
  })
})
