import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import kbRoutes, { slugify } from '../routes/kb.js'
import { requireRole } from '../middleware/authorize.js'

// Build an app with a stubbed auth user. Pass role to exercise RBAC.
function createApp({ workspaceRole = 'Admin', isOwner = false } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'author@test.com', memberId: 1, workspaceRole, isOwner }
    next()
  })
  app.use('/api', kbRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   slugify — pure helper
   ================================================================ */
describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })
  it('strips punctuation', () => {
    expect(slugify('Reset your password!')).toBe('reset-your-password')
  })
  it('collapses repeated separators', () => {
    expect(slugify('Multiple   Spaces --- Here')).toBe('multiple-spaces-here')
  })
  it('trims leading/trailing separators', () => {
    expect(slugify('  ...Trimmed!!  ')).toBe('trimmed')
  })
  it('handles mixed case + numbers', () => {
    expect(slugify('API v2 Guide')).toBe('api-v2-guide')
  })
  it('returns empty string for punctuation-only input', () => {
    expect(slugify('!!!')).toBe('')
  })
})

/* ================================================================
   Categories RBAC
   ================================================================ */
describe('POST /api/kb/categories — RBAC', () => {
  it('non-admin (Viewer) is rejected with 403', async () => {
    const app = createApp({ workspaceRole: 'Viewer' })
    const res = await request(app)
      .post('/api/kb/categories')
      .send({ name: 'Getting Started' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('admin can create a category with a generated slug', async () => {
    const app = createApp({ workspaceRole: 'Admin' })
    get.mockResolvedValueOnce(null) // uniqueSlug: no collision
    run.mockResolvedValueOnce({ lastID: 5 })
    get.mockResolvedValueOnce({ id: 5, name: 'Getting Started', slug: 'getting-started' })
    const res = await request(app)
      .post('/api/kb/categories')
      .send({ name: 'Getting Started' })
    expect(res.status).toBe(201)
    const insert = run.mock.calls.find((c) => /INSERT INTO kb_categories/.test(c[0]))
    expect(insert).toBeTruthy()
    expect(insert[1]).toContain('getting-started')
  })
})

/* ================================================================
   Articles authoring
   ================================================================ */
describe('POST /api/kb/articles', () => {
  it('creates with a generated slug and default draft status', async () => {
    const app = createApp()
    get.mockResolvedValueOnce(null) // uniqueSlug: no collision
    run.mockResolvedValueOnce({ lastID: 10 })
    get.mockResolvedValueOnce({ id: 10, title: 'How to reset', slug: 'how-to-reset', status: 'draft' })
    const res = await request(app)
      .post('/api/kb/articles')
      .send({ title: 'How to reset' })
    expect(res.status).toBe(201)
    const insert = run.mock.calls.find((c) => /INSERT INTO kb_articles/.test(c[0]))
    expect(insert).toBeTruthy()
    // params: [category_id, title, slug, body, status, author_email]
    expect(insert[1][2]).toBe('how-to-reset')
    expect(insert[1][4]).toBe('draft')
    expect(insert[1][5]).toBe('author@test.com')
  })

  it('rejects missing title with 400', async () => {
    const app = createApp()
    const res = await request(app).post('/api/kb/articles').send({ body: 'x' })
    expect(res.status).toBe(400)
  })

  it('list passes ILIKE params for ?search', async () => {
    const app = createApp()
    all.mockResolvedValueOnce([])
    const res = await request(app).get('/api/kb/articles?search=reset')
    expect(res.status).toBe(200)
    const call = all.mock.calls[0]
    expect(call[0]).toMatch(/ILIKE/)
    expect(call[1]).toContain('%reset%')
  })
})

/* ================================================================
   Public read view — published only
   ================================================================ */
describe('GET /api/kb/public/articles', () => {
  it('filters to status = published', async () => {
    const app = createApp({ workspaceRole: 'Viewer' })
    all.mockResolvedValueOnce([])
    const res = await request(app).get('/api/kb/public/articles')
    expect(res.status).toBe(200)
    const call = all.mock.calls[0]
    expect(call[0]).toMatch(/status = \?/)
    expect(call[1]).toContain('published')
  })

  it('single public GET increments views and returns published article', async () => {
    const app = createApp({ workspaceRole: 'Viewer' })
    get.mockResolvedValueOnce({ id: 3, slug: 'how-to-reset', title: 'How to reset', status: 'published', views: 4 })
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(app).get('/api/kb/public/articles/how-to-reset')
    expect(res.status).toBe(200)
    expect(res.body.views).toBe(5)
    const update = run.mock.calls.find((c) => /UPDATE kb_articles SET views = views \+ 1/.test(c[0]))
    expect(update).toBeTruthy()
    expect(update[0]).toMatch(/status = 'published'/)
  })

  it('single public GET 404s when article not published/found', async () => {
    const app = createApp({ workspaceRole: 'Viewer' })
    get.mockResolvedValueOnce(null)
    const res = await request(app).get('/api/kb/public/articles/missing')
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   Publishing via PATCH
   ================================================================ */
describe('PATCH /api/kb/articles/:id', () => {
  it('publishes by setting status to published', async () => {
    const app = createApp()
    get.mockResolvedValueOnce({ id: 10, title: 'How to reset', slug: 'how-to-reset', status: 'draft' })
    run.mockResolvedValueOnce({ changes: 1 })
    get.mockResolvedValueOnce({ id: 10, status: 'published' })
    const res = await request(app).patch('/api/kb/articles/10').send({ status: 'published' })
    expect(res.status).toBe(200)
    const update = run.mock.calls.find((c) => /UPDATE kb_articles SET/.test(c[0]))
    expect(update[1]).toContain('published')
  })

  it('rejects an invalid status', async () => {
    const app = createApp()
    get.mockResolvedValueOnce({ id: 10, status: 'draft' })
    const res = await request(app).patch('/api/kb/articles/10').send({ status: 'archived' })
    expect(res.status).toBe(400)
  })
})

// Guard: requireRole('Admin') is what the routes use — sanity-check its shape.
describe('requireRole wiring', () => {
  it('is a middleware factory', () => {
    expect(typeof requireRole('Admin')).toBe('function')
  })
})
