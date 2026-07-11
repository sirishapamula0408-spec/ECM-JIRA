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

vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, createNotification: vi.fn().mockResolvedValue(1) }
})

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

beforeEach(() => { vi.clearAllMocks() })

/* ================================================================
   JL-42: Notification Preferences
   ================================================================ */
describe('Notification Preferences (JL-42)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/notifications.js')
    app = createApp(mod)
  })

  it('GET /preferences returns defaults when none exist', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).get('/api/preferences')
    expect(res.status).toBe(200)
    expect(res.body.in_app).toBe(true)
    expect(res.body.email_digest).toBe('off')
  })

  it('PUT /preferences saves preferences', async () => {
    get.mockResolvedValueOnce({ id: 1 }) // existing check
    run.mockResolvedValue({ changes: 1 })
    get.mockResolvedValueOnce({ user_email: 'test@test.com', in_app: true, email_enabled: true, email_digest: 'daily' })

    const res = await request(app).put('/api/preferences').send({
      inApp: true, emailEnabled: true, emailDigest: 'daily', mutedTypes: [],
    })
    expect(res.status).toBe(200)
  })

  it('PUT /preferences rejects invalid digest', async () => {
    const res = await request(app).put('/api/preferences').send({ emailDigest: 'hourly' })
    expect(res.status).toBe(400)
  })

  it('DELETE /:id deletes a notification', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

/* ================================================================
   JL-44: Activity Feed — cursor-based pagination & date filter
   ================================================================ */
describe('Activity Feed Cursor Pagination (JL-44)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/activity.js')
    app = createApp(mod)
  })

  it('returns hasMore and nextCursor', async () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ id: 100 - i, actor: 'User', action: `action ${i}` }))
    all.mockResolvedValue(items)
    get.mockResolvedValue({ count: '50' })

    const res = await request(app).get('/api?limit=10')
    expect(res.status).toBe(200)
    expect(res.body.hasMore).toBe(true)
    expect(res.body.activities).toHaveLength(10)
    expect(res.body.nextCursor).toBeDefined()
  })

  it('supports cursor parameter', async () => {
    all.mockResolvedValue([{ id: 5, actor: 'User', action: 'test' }])
    get.mockResolvedValue({ count: '5' })

    const res = await request(app).get('/api?cursor=10&limit=5')
    expect(res.status).toBe(200)
  })

  it('supports date range filters', async () => {
    all.mockResolvedValue([])
    get.mockResolvedValue({ count: '0' })

    const res = await request(app).get('/api?dateFrom=2026-01-01&dateTo=2026-03-18')
    expect(res.status).toBe(200)
  })
})

/* ================================================================
   JL-48: Wiki Enhancements — versioning, search, linking
   ================================================================ */
describe('Wiki Enhancements (JL-48)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/wiki.js')
    app = createApp(mod)
  })

  describe('Full-text search', () => {
    it('returns matching pages', async () => {
      all.mockResolvedValue([{ id: 1, title: 'Getting Started', project_id: 1 }])
      const res = await request(app).get('/api/search?q=Getting&projectId=1')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })

    it('returns empty for no query', async () => {
      const res = await request(app).get('/api/search?q=')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(0)
    })
  })

  describe('Version history', () => {
    it('lists versions for a page', async () => {
      all.mockResolvedValue([
        { id: 1, page_id: 1, version_number: 2, edited_by: 'test@test.com' },
        { id: 2, page_id: 1, version_number: 1, edited_by: 'test@test.com' },
      ])
      const res = await request(app).get('/api/1/versions')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
    })

    it('gets a specific version', async () => {
      get.mockResolvedValue({ id: 1, page_id: 1, version_number: 1, content: 'v1 content' })
      const res = await request(app).get('/api/1/versions/1')
      expect(res.status).toBe(200)
      expect(res.body.content).toBe('v1 content')
    })

    it('returns 404 for missing version', async () => {
      get.mockResolvedValue(null)
      const res = await request(app).get('/api/1/versions/999')
      expect(res.status).toBe(404)
    })
  })

  describe('Page versioning on update', () => {
    it('creates a new version on content update', async () => {
      get.mockImplementation(async (sql) => {
        if (sql.includes('wiki_pages')) return { id: 1, title: 'Page', content: 'old', project_id: 1 }
        if (sql.includes('MAX')) return { max_ver: 1 }
        return null
      })
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).patch('/api/1').send({ content: 'new content' })
      expect(res.status).toBe(200)
      // Should have called run for both UPDATE and INSERT version
      expect(run).toHaveBeenCalledTimes(2)
    })
  })

  describe('Issue-Wiki linking', () => {
    it('links an issue to a wiki page', async () => {
      run.mockResolvedValue({ lastID: 1 })
      const res = await request(app).post('/api/1/link-issue').send({ issueId: 5 })
      expect(res.status).toBe(201)
    })

    it('rejects missing issueId', async () => {
      const res = await request(app).post('/api/1/link-issue').send({})
      expect(res.status).toBe(400)
    })

    it('unlinks an issue', async () => {
      run.mockResolvedValue({ changes: 1 })
      const res = await request(app).delete('/api/1/link-issue/5')
      expect(res.status).toBe(200)
    })
  })

  describe('Page with linked issues', () => {
    it('returns linkedIssues in page detail', async () => {
      get.mockResolvedValue({ id: 1, title: 'Page', content: 'text', project_id: 1 })
      all.mockImplementation(async (sql) => {
        if (sql.includes('parent_id')) return []
        if (sql.includes('issue_wiki_links')) return [{ link_id: 1, issue_id: 5, issue_key: 'TP-5', issue_title: 'Test Issue' }]
        return []
      })

      const res = await request(app).get('/api/1')
      expect(res.status).toBe(200)
      expect(res.body.linkedIssues).toHaveLength(1)
      expect(res.body.linkedIssues[0].issue_key).toBe('TP-5')
    })
  })
})

/* ================================================================
   JL-47: Webhook HMAC signing
   ================================================================ */
describe('Webhook HMAC Signing (JL-47)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/webhooks.js')
    app = createApp(mod)
  })

  it('GET /api — list webhooks excludes secret', async () => {
    all.mockResolvedValue([{ id: 1, name: 'Hook', url: 'https://test.com', events: '["*"]', is_active: true }])
    const res = await request(app).get('/api')
    expect(res.status).toBe(200)
    expect(res.body[0].secret).toBeUndefined()
  })
})

/* ================================================================
   JL-43: Auto-watch on comment
   ================================================================ */
describe('Auto-watch on comment (JL-43)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/comments.js')
    app = createApp(mod, '/api')
  })

  it('auto-watches the commenter on an issue', async () => {
    run.mockResolvedValue({ lastID: 1 })
    get.mockImplementation(async (sql) => {
      if (sql.includes('comments')) return { id: 1, issue_id: 1, author: 'User', text: 'hello', created_at: new Date().toISOString() }
      if (sql.includes('issues')) return { issue_key: 'TP-1', project_id: 1 }
      return null
    })
    all.mockResolvedValue([]) // no watchers

    const res = await request(app).post('/api/1/comments').send({ author: 'User', text: 'hello' })
    expect(res.status).toBe(201)
    // Should have called run for: INSERT comment + INSERT watcher (ON CONFLICT DO NOTHING)
    const watcherInsert = run.mock.calls.find((c) => c[0].includes('watchers'))
    expect(watcherInsert).toBeTruthy()
  })
})
