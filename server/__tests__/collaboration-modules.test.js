import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Mock notifications helper in comments route
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    createNotification: vi.fn().mockResolvedValue(1),
  }
})

import { run, all, get } from '../db.js'
import { errorHandler, asyncHandler } from '../middleware/errorHandler.js'

// Helper: create an app with auth middleware stub
function createApp(routeModule, mountPath = '/api') {
  const app = express()
  app.use(express.json())
  // Stub auth and role middleware
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
   Module 2: Notifications
   ================================================================ */
describe('Notifications API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/notifications.js')
    app = createApp(mod)
  })

  describe('GET /api — list notifications', () => {
    it('returns notifications and unread count', async () => {
      all.mockResolvedValue([
        { id: 1, recipient_email: 'test@test.com', type: 'mention', title: 'Mentioned', message: 'hello', is_read: false, created_at: new Date().toISOString() },
      ])
      get.mockResolvedValue({ count: '1' })

      const res = await request(app).get('/api')
      expect(res.status).toBe(200)
      expect(res.body.notifications).toHaveLength(1)
      expect(res.body.unreadCount).toBe(1)
    })

    it('returns empty list when no notifications', async () => {
      all.mockResolvedValue([])
      get.mockResolvedValue({ count: '0' })

      const res = await request(app).get('/api')
      expect(res.status).toBe(200)
      expect(res.body.notifications).toHaveLength(0)
      expect(res.body.unreadCount).toBe(0)
    })

    it('filters unread only', async () => {
      all.mockResolvedValue([])
      get.mockResolvedValue({ count: '0' })

      const res = await request(app).get('/api?unread=true')
      expect(res.status).toBe(200)
    })
  })

  describe('PATCH /api/:id/read — mark as read', () => {
    it('marks notification as read', async () => {
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).patch('/api/1/read')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  describe('PATCH /api/read-all — mark all as read', () => {
    it('marks all notifications as read', async () => {
      run.mockResolvedValue({ changes: 5 })

      const res = await request(app).patch('/api/read-all')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})

/* ================================================================
   Module 3: Watchers
   ================================================================ */
describe('Watchers API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/watchers.js')
    app = createApp(mod)
  })

  describe('GET /api/:issueId/watchers', () => {
    it('returns watchers list and watching status', async () => {
      all.mockResolvedValue([
        { id: 1, issue_id: 1, user_email: 'test@test.com', created_at: new Date().toISOString() },
      ])

      const res = await request(app).get('/api/1/watchers')
      expect(res.status).toBe(200)
      expect(res.body.watchers).toHaveLength(1)
      expect(res.body.isWatching).toBe(true)
      expect(res.body.count).toBe(1)
    })

    it('returns isWatching=false when user is not watching', async () => {
      all.mockResolvedValue([
        { id: 1, issue_id: 1, user_email: 'other@test.com', created_at: new Date().toISOString() },
      ])

      const res = await request(app).get('/api/1/watchers')
      expect(res.body.isWatching).toBe(false)
    })
  })

  describe('POST /api/:issueId/watchers — watch', () => {
    it('creates a watcher entry', async () => {
      get.mockResolvedValue(null) // not already watching
      run.mockResolvedValue({ lastID: 1 })

      const res = await request(app).post('/api/1/watchers')
      expect(res.status).toBe(201)
      expect(res.body.action).toBe('watching')
    })

    it('returns already_watching when already subscribed', async () => {
      get.mockResolvedValue({ id: 1 })

      const res = await request(app).post('/api/1/watchers')
      expect(res.status).toBe(200)
      expect(res.body.action).toBe('already_watching')
    })
  })

  describe('DELETE /api/:issueId/watchers — unwatch', () => {
    it('removes watcher entry', async () => {
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).delete('/api/1/watchers')
      expect(res.status).toBe(200)
      expect(res.body.action).toBe('unwatched')
    })
  })
})

/* ================================================================
   Module 4: Activity Feed (filterable)
   ================================================================ */
describe('Activity API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/activity.js')
    app = createApp(mod)
  })

  it('returns paginated activity list', async () => {
    all.mockResolvedValue([
      { id: 1, actor: 'User', action: 'created IT-1', happened_at: 'Just now', activity_type: 'issue', created_at: new Date().toISOString() },
    ])
    get.mockResolvedValue({ count: '1' })

    const res = await request(app).get('/api')
    expect(res.status).toBe(200)
    expect(res.body.activities).toHaveLength(1)
    expect(res.body.total).toBe(1)
  })

  it('filters by activity type', async () => {
    all.mockResolvedValue([])
    get.mockResolvedValue({ count: '0' })

    const res = await request(app).get('/api?type=issue')
    expect(res.status).toBe(200)
    expect(res.body.activities).toHaveLength(0)
  })

  it('filters by project', async () => {
    all.mockResolvedValue([])
    get.mockResolvedValue({ count: '0' })

    const res = await request(app).get('/api?projectId=1')
    expect(res.status).toBe(200)
  })

  it('supports pagination', async () => {
    all.mockResolvedValue([])
    get.mockResolvedValue({ count: '50' })

    const res = await request(app).get('/api?limit=10&offset=20')
    expect(res.status).toBe(200)
    expect(res.body.limit).toBe(10)
    expect(res.body.offset).toBe(20)
  })
})

/* ================================================================
   Module 5: Approvals
   ================================================================ */
describe('Approvals API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/approvals.js')
    app = createApp(mod)
  })

  describe('GET /api/rules', () => {
    it('returns approval rules', async () => {
      all.mockResolvedValue([
        { id: 1, project_id: 1, from_status: 'In Progress', to_status: 'Done', required_approvals: 1, approver_role: 'Admin' },
      ])

      const res = await request(app).get('/api/rules')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })
  })

  describe('POST /api/rules', () => {
    it('creates an approval rule', async () => {
      run.mockResolvedValue({ lastID: 1 })
      get.mockResolvedValue({ id: 1, from_status: 'In Progress', to_status: 'Done', required_approvals: 1 })

      const res = await request(app).post('/api/rules').send({
        projectId: 1, fromStatus: 'In Progress', toStatus: 'Done',
      })
      expect(res.status).toBe(201)
    })

    it('rejects missing required fields', async () => {
      const res = await request(app).post('/api/rules').send({})
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/issue/:issueId — submit approval', () => {
    it('creates an approval decision', async () => {
      run.mockResolvedValue({ lastID: 1 })
      get.mockImplementation(async (sql) => {
        if (sql.includes('issues')) return { assignee: 'User', issue_key: 'TP-1' }
        if (sql.includes('members')) return { email: 'member@test.com' }
        if (sql.includes('approvals')) return { id: 1, decision: 'approved' }
        return null
      })

      const res = await request(app).post('/api/issue/1').send({
        fromStatus: 'In Progress', toStatus: 'Done', decision: 'approved',
      })
      expect(res.status).toBe(201)
    })

    it('rejects invalid decision', async () => {
      const res = await request(app).post('/api/issue/1').send({
        fromStatus: 'In Progress', toStatus: 'Done', decision: 'maybe',
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/check/:issueId', () => {
    it('returns not required when no rule exists', async () => {
      get.mockImplementation(async (sql) => {
        if (sql.includes('issues')) return { status: 'In Progress', project_id: 1 }
        return null
      })

      const res = await request(app).get('/api/check/1?toStatus=Done')
      expect(res.status).toBe(200)
      expect(res.body.required).toBe(false)
    })
  })
})

/* ================================================================
   Module 6: Shared Dashboards
   ================================================================ */
describe('Shared Dashboards API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/shared-dashboards.js')
    app = createApp(mod)
  })

  describe('GET /api — list dashboards', () => {
    it('returns dashboards', async () => {
      all.mockResolvedValue([
        { id: 1, name: 'My Dashboard', owner_email: 'test@test.com', visibility: 'private' },
      ])

      const res = await request(app).get('/api')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })
  })

  describe('POST /api — create dashboard', () => {
    it('creates a dashboard', async () => {
      run.mockResolvedValue({ lastID: 1 })
      get.mockResolvedValue({ id: 1, name: 'New Dashboard', owner_email: 'test@test.com' })

      const res = await request(app).post('/api').send({ name: 'New Dashboard' })
      expect(res.status).toBe(201)
    })

    it('rejects empty name', async () => {
      const res = await request(app).post('/api').send({ name: '' })
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/:id', () => {
    it('deletes a dashboard', async () => {
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).delete('/api/1')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})

/* ================================================================
   Module 7: Webhooks
   ================================================================ */
describe('Webhooks API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/webhooks.js')
    app = createApp(mod)
  })

  describe('GET /api — list webhooks', () => {
    it('returns webhooks', async () => {
      all.mockResolvedValue([
        { id: 1, name: 'Slack', url: 'https://hooks.slack.com/test', events: '["*"]', is_active: true },
      ])

      const res = await request(app).get('/api')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })
  })

  describe('POST /api — create webhook', () => {
    it('creates a webhook', async () => {
      run.mockResolvedValue({ lastID: 1 })
      get.mockResolvedValue({ id: 1, name: 'Slack', url: 'https://hooks.slack.com/test' })

      const res = await request(app).post('/api').send({
        name: 'Slack', url: 'https://hooks.slack.com/test', events: ['*'],
      })
      expect(res.status).toBe(201)
    })

    // JL-184: create response must never echo the webhook secret.
    it('never returns the secret in the create response', async () => {
      run.mockResolvedValue({ lastID: 1 })
      // If the route used SELECT *, the mock's secret would leak through.
      get.mockResolvedValue({
        id: 1, name: 'Slack', url: 'https://hooks.slack.com/test', secret: 'super-secret',
      })

      const res = await request(app).post('/api').send({
        name: 'Slack', url: 'https://hooks.slack.com/test', secret: 'super-secret', events: ['*'],
      })
      expect(res.status).toBe(201)
      // The row-fetch SQL must select explicit columns, not SELECT * / secret.
      const fetchCall = get.mock.calls.find((c) => /FROM webhooks WHERE id/i.test(c[0]))
      expect(fetchCall).toBeTruthy()
      expect(fetchCall[0]).not.toMatch(/SELECT\s+\*/i)
      expect(fetchCall[0]).not.toMatch(/\bsecret\b/i)
    })

    it('rejects missing url', async () => {
      const res = await request(app).post('/api').send({ name: 'Test' })
      expect(res.status).toBe(400)
    })

    it('rejects missing name', async () => {
      const res = await request(app).post('/api').send({ url: 'https://test.com' })
      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /api/:id — update webhook', () => {
    // JL-184: update response must never echo the webhook secret.
    it('never returns the secret in the update response', async () => {
      // 1) existence check, 2) final row-fetch after update.
      get
        .mockResolvedValueOnce({ id: 1, name: 'Slack', secret: 'super-secret' })
        .mockResolvedValueOnce({ id: 1, name: 'Renamed', url: 'https://hooks.slack.com/test' })
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).patch('/api/1').send({ name: 'Renamed' })
      expect(res.status).toBe(200)
      expect(res.body.secret).toBeUndefined()
      // The post-update fetch must not select the secret column.
      const fetchCall = get.mock.calls.find((c) => /FROM webhooks WHERE id/i.test(c[0]) && /^SELECT (?!\*)/i.test(c[0]))
      expect(fetchCall).toBeTruthy()
      expect(fetchCall[0]).not.toMatch(/\bsecret\b/i)
    })
  })

  describe('DELETE /api/:id', () => {
    it('deletes a webhook', async () => {
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).delete('/api/1')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})

/* ================================================================
   Module 8: Wiki
   ================================================================ */
describe('Wiki API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/wiki.js')
    app = createApp(mod)
  })

  describe('GET /api — list wiki pages', () => {
    it('returns wiki pages for a project', async () => {
      all.mockResolvedValue([
        { id: 1, project_id: 1, title: 'Getting Started', parent_id: null },
      ])

      const res = await request(app).get('/api?projectId=1')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })

    it('requires projectId', async () => {
      const res = await request(app).get('/api')
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/:id — get wiki page', () => {
    it('returns page with children', async () => {
      get.mockResolvedValue({ id: 1, title: 'Test Page', content: '# Hello', project_id: 1 })
      all.mockResolvedValue([{ id: 2, title: 'Child Page' }])

      const res = await request(app).get('/api/1')
      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Test Page')
      expect(res.body.children).toHaveLength(1)
    })

    it('returns 404 for non-existent page', async () => {
      get.mockResolvedValue(null)

      const res = await request(app).get('/api/999')
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api — create wiki page', () => {
    it('creates a wiki page', async () => {
      run.mockResolvedValue({ lastID: 1 })
      get.mockResolvedValue({ id: 1, title: 'New Page', content: '', project_id: 1 })

      const res = await request(app).post('/api').send({
        projectId: 1, title: 'New Page',
      })
      expect(res.status).toBe(201)
    })

    it('rejects missing title', async () => {
      const res = await request(app).post('/api').send({ projectId: 1 })
      expect(res.status).toBe(400)
    })

    it('rejects missing projectId', async () => {
      const res = await request(app).post('/api').send({ title: 'Test' })
      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /api/:id — update wiki page', () => {
    it('updates page content', async () => {
      get.mockImplementation(async () => ({ id: 1, title: 'Page', content: 'old', project_id: 1 }))
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).patch('/api/1').send({ content: 'new content' })
      expect(res.status).toBe(200)
    })

    it('returns 404 for non-existent page', async () => {
      get.mockResolvedValue(null)

      const res = await request(app).patch('/api/999').send({ title: 'Updated' })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/:id', () => {
    it('deletes a wiki page', async () => {
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).delete('/api/1')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})
