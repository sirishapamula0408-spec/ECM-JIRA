import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB — follows collaboration-modules.test.js pattern)
vi.mock('../db.js', () => {
  const run = vi.fn()
  const all = vi.fn()
  const get = vi.fn()
  return {
    run,
    all,
    get,
    columnExists: vi.fn(),
    tableExists: vi.fn(),
    // JL-94: run the callback with the same mocked helpers so existing
    // run/get assertions still see the transactional writes.
    withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
  }
})

// Automation service is invoked by the issues status route — stub it out
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

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
   JL-36: Watchers route (list / watch / unwatch)
   ================================================================ */
describe('JL-36 Watchers route', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/watchers.js')
    app = createApp(mod)
  })

  describe('GET /api/:issueId/watchers — list', () => {
    it('returns watchers list, count, and isWatching=true for the current user', async () => {
      all.mockResolvedValue([
        { id: 1, issue_id: 1, user_email: 'test@test.com', watcher_name: 'Tester', created_at: new Date().toISOString() },
        { id: 2, issue_id: 1, user_email: 'other@test.com', watcher_name: 'Other', created_at: new Date().toISOString() },
      ])

      const res = await request(app).get('/api/1/watchers')
      expect(res.status).toBe(200)
      expect(res.body.watchers).toHaveLength(2)
      expect(res.body.count).toBe(2)
      expect(res.body.isWatching).toBe(true)
    })

    it('returns isWatching=false when current user is absent', async () => {
      all.mockResolvedValue([
        { id: 1, issue_id: 1, user_email: 'other@test.com', watcher_name: 'Other', created_at: new Date().toISOString() },
      ])

      const res = await request(app).get('/api/1/watchers')
      expect(res.body.isWatching).toBe(false)
      expect(res.body.count).toBe(1)
    })

    it('returns an empty list when nobody watches', async () => {
      all.mockResolvedValue([])

      const res = await request(app).get('/api/1/watchers')
      expect(res.status).toBe(200)
      expect(res.body.count).toBe(0)
      expect(res.body.isWatching).toBe(false)
    })
  })

  describe('POST /api/:issueId/watchers — watch', () => {
    it('inserts a watcher and returns 201 watching', async () => {
      get.mockResolvedValue(null)
      run.mockResolvedValue({ lastID: 1 })

      const res = await request(app).post('/api/1/watchers')
      expect(res.status).toBe(201)
      expect(res.body.action).toBe('watching')
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO watchers'),
        [1, 'test@test.com'],
      )
    })

    it('is idempotent — returns already_watching without inserting', async () => {
      get.mockResolvedValue({ id: 7 })

      const res = await request(app).post('/api/1/watchers')
      expect(res.status).toBe(200)
      expect(res.body.action).toBe('already_watching')
      expect(run).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /api/:issueId/watchers — unwatch', () => {
    it('deletes the watcher for the current user', async () => {
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).delete('/api/1/watchers')
      expect(res.status).toBe(200)
      expect(res.body.action).toBe('unwatched')
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM watchers'),
        [1, 'test@test.com'],
      )
    })
  })
})

/* ================================================================
   JL-36: Auto-watch on assign + watcher count on list (issues route)
   ================================================================ */
describe('JL-36 Issues route watcher integration', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/issues.js')
    app = createApp(mod, '/api/issues')
  })

  it('GET /api/issues includes a watcherCount on each issue', async () => {
    all.mockResolvedValue([
      { id: 1, issue_key: 'TP-1', title: 'A', description: 'd', priority: 'Medium', assignee: 'User', status: 'To Do', issue_type: 'Task', sprint_id: null, project_id: 1, parent_id: null, created_at: 'now', watcher_count: '3' },
    ])

    const res = await request(app).get('/api/issues')
    expect(res.status).toBe(200)
    expect(res.body[0].watcherCount).toBe(3)
  })

  it('PATCH /api/issues/:id auto-watches the newly assigned member by name', async () => {
    // existing issue (assignee empty), then member lookup, then updated row
    get
      .mockResolvedValueOnce({ id: 5, issue_key: 'TP-5', title: 'X', description: 'd', priority: 'Medium', assignee: 'Old Guy', status: 'To Do', issue_type: 'Task', sprint_id: null, project_id: 1, parent_id: null, created_at: 'now' })
      .mockResolvedValueOnce({ email: 'newperson@test.com' }) // member lookup
      .mockResolvedValueOnce({ id: 5, issue_key: 'TP-5', title: 'X', description: 'd', priority: 'Medium', assignee: 'New Person', status: 'To Do', issue_type: 'Task', sprint_id: null, project_id: 1, parent_id: null, created_at: 'now' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/issues/5').send({ assignee: 'New Person' })
    expect(res.status).toBe(200)

    // an INSERT INTO watchers with the resolved email must have been issued
    const watcherInsert = run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO watchers'),
    )
    expect(watcherInsert).toBeTruthy()
    expect(watcherInsert[1]).toEqual([5, 'newperson@test.com'])
  })

  it('PATCH /api/issues/:id does not auto-watch when assignee is unchanged', async () => {
    get
      .mockResolvedValueOnce({ id: 6, issue_key: 'TP-6', title: 'Y', description: 'd', priority: 'Medium', assignee: 'Same Person', status: 'To Do', issue_type: 'Task', sprint_id: null, project_id: 1, parent_id: null, created_at: 'now' })
      .mockResolvedValueOnce({ id: 6, issue_key: 'TP-6', title: 'Y', description: 'd', priority: 'High', assignee: 'Same Person', status: 'To Do', issue_type: 'Task', sprint_id: null, project_id: 1, parent_id: null, created_at: 'now' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/issues/6').send({ assignee: 'Same Person', priority: 'High' })
    expect(res.status).toBe(200)

    const watcherInsert = run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO watchers'),
    )
    expect(watcherInsert).toBeFalsy()
  })

  it('POST /api/issues auto-watches the creator', async () => {
    get
      .mockResolvedValueOnce({ count: 0 }) // key count
      .mockResolvedValueOnce({ id: 9, issue_key: 'TP-1', title: 'New', description: 'desc', priority: 'Medium', assignee: 'Creator', status: 'Backlog', issue_type: 'Task', sprint_id: null, project_id: null, parent_id: null, created_at: 'now' })
    run.mockResolvedValue({ lastID: 9 })

    const res = await request(app).post('/api/issues').send({
      title: 'New', description: 'desc', assignee: 'Creator',
      priority: 'Medium', status: 'Backlog', issueType: 'Task',
    })
    expect(res.status).toBe(201)

    const watcherInsert = run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO watchers'),
    )
    expect(watcherInsert).toBeTruthy()
    expect(watcherInsert[1]).toEqual([9, 'test@test.com'])
  })
})
