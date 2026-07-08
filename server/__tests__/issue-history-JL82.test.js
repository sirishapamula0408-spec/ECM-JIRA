import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB — pure unit test of the route handlers)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Keep automation engine side-effect-free (it only uses the mocked db anyway)
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
  TRIGGER_TYPES: [],
  ACTION_TYPES: [],
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath = '/api/issues') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'actor@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

// Return the params array of the run() call that inserted into issue_history, if any.
function historyInsert() {
  const call = run.mock.calls.find((c) => /INSERT INTO issue_history/i.test(c[0]))
  return call ? call[1] : null
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('JL-82 — per-issue change history', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/issues.js')
    app = createApp(mod)
  })

  const fullIssue = {
    id: 1, issue_key: 'TP-1', title: 'Login bug', description: 'desc',
    priority: 'Medium', assignee: 'User', status: 'To Do', issue_type: 'Bug',
    sprint_id: 5, project_id: 1, parent_id: null, created_at: new Date().toISOString(),
  }

  describe('PATCH /api/issues/:id — records field changes', () => {
    it('writes a history row when priority changes', async () => {
      // 1st get = existing issue, 2nd get = re-read after update
      get.mockResolvedValueOnce({ ...fullIssue })
         .mockResolvedValueOnce({ ...fullIssue, priority: 'High' })
      run.mockResolvedValue({ changes: 1, lastID: 1 })

      const res = await request(app).patch('/api/issues/1').send({ priority: 'High' })

      expect(res.status).toBe(200)
      const params = historyInsert()
      expect(params).not.toBeNull()
      // [issue_id, field, old_value, new_value, actor]
      expect(params[0]).toBe(1)
      expect(params[1]).toBe('priority')
      expect(params[2]).toBe('Medium')
      expect(params[3]).toBe('High')
      expect(params[4]).toBe('actor@test.com')
    })

    it('records the assignee change with old and new values', async () => {
      get.mockResolvedValueOnce({ ...fullIssue })
         .mockResolvedValueOnce({ ...fullIssue, assignee: 'Bob' })
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).patch('/api/issues/1').send({ assignee: 'Bob' })

      expect(res.status).toBe(200)
      const params = historyInsert()
      expect(params).not.toBeNull()
      expect(params[1]).toBe('assignee')
      expect(params[2]).toBe('User')
      expect(params[3]).toBe('Bob')
    })

    it('does NOT write a history row when the value is unchanged', async () => {
      get.mockResolvedValueOnce({ ...fullIssue })
         .mockResolvedValueOnce({ ...fullIssue })
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).patch('/api/issues/1').send({ priority: 'Medium' })

      expect(res.status).toBe(200)
      expect(historyInsert()).toBeNull()
    })
  })

  describe('PATCH /api/issues/:id/status — records status transitions', () => {
    it('writes a history row when status changes', async () => {
      get.mockResolvedValueOnce({ id: 1, sprint_id: 5, status: 'To Do' })
         .mockResolvedValue({ ...fullIssue, status: 'In Progress' })
      all.mockResolvedValue([]) // no open subtasks / no automation rules
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).patch('/api/issues/1/status').send({ status: 'In Progress' })

      expect(res.status).toBe(200)
      const params = historyInsert()
      expect(params).not.toBeNull()
      expect(params[1]).toBe('status')
      expect(params[2]).toBe('To Do')
      expect(params[3]).toBe('In Progress')
      expect(params[4]).toBe('actor@test.com')
    })
  })

  describe('GET /api/issues/:id/history — returns rows newest-first', () => {
    it('returns mapped history rows', async () => {
      const now = new Date().toISOString()
      all.mockResolvedValue([
        { id: 2, issue_id: 1, field: 'status', old_value: 'To Do', new_value: 'In Progress', actor: 'actor@test.com', changed_at: now },
        { id: 1, issue_id: 1, field: 'priority', old_value: 'Medium', new_value: 'High', actor: 'actor@test.com', changed_at: now },
      ])

      const res = await request(app).get('/api/issues/1/history')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      expect(res.body[0]).toMatchObject({
        id: 2, issueId: 1, field: 'status', oldValue: 'To Do', newValue: 'In Progress', actor: 'actor@test.com',
      })
      expect(res.body[1].field).toBe('priority')
      // verify it queried the issue_history table ordered by changed_at DESC
      const sql = all.mock.calls[0][0]
      expect(sql).toMatch(/issue_history/i)
      expect(sql).toMatch(/ORDER BY changed_at DESC/i)
    })

    it('returns an empty array when there is no history', async () => {
      all.mockResolvedValue([])

      const res = await request(app).get('/api/issues/1/history')

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('rejects a non-numeric issue id', async () => {
      const res = await request(app).get('/api/issues/abc/history')
      expect(res.status).toBe(400)
    })
  })
})
