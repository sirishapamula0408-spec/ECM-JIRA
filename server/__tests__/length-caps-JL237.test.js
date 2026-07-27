// @vitest-environment node
/**
 * JL-237 — Extend server-side length caps + trim to comments, wiki pages,
 * saved filters, labels, and KB articles (building on JL-204).
 *
 * Mocked-db route tests (model: text-length-caps-JL204.test.js) covering:
 *  - comments.js: text (10000) on create (POST) + edit (PATCH)
 *  - wiki.js    : title (255) / content (100000) on create (POST) + update (PATCH)
 *  - filters.js : name (120) / description (1000) on create (POST) + update (PUT)
 *  - labels.js  : name (60) on create (POST) + rename (PUT)
 *  - kb.js      : title (255) / body (100000) on create (POST) + update (PATCH)
 *                 + case-insensitive duplicate-slug → 409
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — no real database is touched.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}))

// Mock helpers used by the comments route so its imports resolve cleanly
// (realtime.js pulls in the optional `ws` package, which isn't installed).
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    createNotification: vi.fn().mockResolvedValue(1),
  }
})
vi.mock('../services/automation.js', () => ({
  runCommentAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/realtime.js', () => ({
  publish: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  COMMENT_TEXT_MAX,
  WIKI_TITLE_MAX,
  WIKI_CONTENT_MAX,
  FILTER_NAME_MAX,
  FILTER_DESCRIPTION_MAX,
  LABEL_NAME_MAX,
  KB_TITLE_MAX,
  KB_CONTENT_MAX,
} from '../utils/validation.js'

// Helper: app stubbing auth as a workspace Admin (passes all role/write guards).
function createApp(routeModule, mountPath = '/api') {
  const app = express()
  app.use(express.json({ limit: '25mb' }))
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

const over = (n) => 'x'.repeat(n + 1)
const atCap = (n) => 'x'.repeat(n)

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   comments.js — text cap
   ================================================================ */
describe('Comment text length cap (comments.js)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/comments.js')
    app = createApp(mod)
  })

  it(`POST /:issueId/comments rejects text over ${COMMENT_TEXT_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api/1/comments').send({ text: over(COMMENT_TEXT_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('text')
    expect(res.body.error).toContain(String(COMMENT_TEXT_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it(`PATCH /:issueId/comments/:commentId rejects text over ${COMMENT_TEXT_MAX} chars with 400`, async () => {
    const res = await request(app).patch('/api/1/comments/5').send({ text: over(COMMENT_TEXT_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('text')
    expect(run).not.toHaveBeenCalled()
  })

  it('POST /:issueId/comments accepts text at the cap (whitespace does not count against it)', async () => {
    // Author resolution → member lookup; comment insert; reload; watchers; automation issue.
    get.mockImplementation(async (sql) => {
      if (/FROM members/.test(sql)) return { name: 'Tester' }
      if (/issue_key, project_id FROM issues/.test(sql)) return { issue_key: 'TP-1', project_id: 7 }
      if (/assignee FROM issues/.test(sql)) return { id: 1, issue_key: 'TP-1', project_id: 7, assignee: 'A' }
      return { id: 99, issue_id: 1, author: 'Tester', text: 'x', created_at: 'now', edited_at: null }
    })
    all.mockResolvedValue([])
    run.mockResolvedValue({ lastID: 99, changes: 1 })

    const res = await request(app)
      .post('/api/1/comments')
      .send({ text: `   ${atCap(COMMENT_TEXT_MAX)}   ` })
    expect(res.status).toBe(201)
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO comments/.test(sql))
    expect(insert).toBeTruthy()
    expect(insert[1][2].length).toBe(COMMENT_TEXT_MAX) // trimmed to exactly the cap
  })
})

/* ================================================================
   wiki.js — title / content caps
   ================================================================ */
describe('Wiki length caps (wiki.js)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/wiki.js')
    app = createApp(mod, '/api/wiki')
  })

  it(`POST rejects a title over ${WIKI_TITLE_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api/wiki').send({ projectId: 1, title: over(WIKI_TITLE_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('title')
    expect(res.body.error).toContain(String(WIKI_TITLE_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it(`POST rejects content over ${WIKI_CONTENT_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api/wiki').send({ projectId: 1, title: 'Page', content: over(WIKI_CONTENT_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('content')
    expect(run).not.toHaveBeenCalled()
  })

  it('POST accepts within-cap and trims title/content before the INSERT', async () => {
    run.mockResolvedValue({ lastID: 3, changes: 1 })
    get.mockResolvedValue({ id: 3, title: 'Page', content: 'Body' })
    const res = await request(app).post('/api/wiki').send({ projectId: 1, title: '  Page  ', content: '  Body  ' })
    expect(res.status).toBe(201)
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO wiki_pages/.test(sql))
    expect(insert[1][1]).toBe('Page')
    expect(insert[1][2]).toBe('Body')
  })

  it(`PATCH /:id rejects a title over ${WIKI_TITLE_MAX} chars with 400`, async () => {
    get.mockResolvedValue({ id: 1, title: 'Old', content: 'c' })
    const res = await request(app).patch('/api/wiki/1').send({ title: over(WIKI_TITLE_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('title')
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   filters.js — name / description caps
   ================================================================ */
describe('Filter length caps (filters.js)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/filters.js')
    app = createApp(mod, '/api/filters')
  })

  it(`POST rejects a name over ${FILTER_NAME_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api/filters').send({ name: over(FILTER_NAME_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('name')
    expect(res.body.error).toContain(String(FILTER_NAME_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it(`POST rejects a description over ${FILTER_DESCRIPTION_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api/filters').send({ name: 'My filter', description: over(FILTER_DESCRIPTION_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('description')
    expect(run).not.toHaveBeenCalled()
  })

  it('POST accepts within-cap and trims name/description before the INSERT', async () => {
    run.mockResolvedValue({ lastID: 8, changes: 1 })
    get.mockResolvedValue({ id: 8, name: 'My filter', description: 'desc', owner_email: 'test@test.com', criteria: '{}', visibility: 'private' })
    const res = await request(app).post('/api/filters').send({ name: '  My filter  ', description: '  desc  ' })
    expect(res.status).toBe(201)
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO filters/.test(sql))
    expect(insert[1][0]).toBe('My filter')
    expect(insert[1][1]).toBe('desc')
  })

  it(`PUT /:id rejects a name over ${FILTER_NAME_MAX} chars with 400`, async () => {
    get.mockResolvedValue({ id: 5, name: 'Old', description: 'd', owner_email: 'test@test.com', criteria: '{}', visibility: 'private' })
    const res = await request(app).put('/api/filters/5').send({ name: over(FILTER_NAME_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('name')
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   labels.js — name cap
   ================================================================ */
describe('Label name length cap (labels.js)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/labels.js')
    app = createApp(mod)
  })

  it(`POST /projects/:id/labels rejects a name over ${LABEL_NAME_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api/projects/1/labels').send({ name: over(LABEL_NAME_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('name')
    expect(res.body.error).toContain(String(LABEL_NAME_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it('POST /projects/:id/labels accepts a within-cap name', async () => {
    get.mockResolvedValueOnce(null) // no existing duplicate
    run.mockResolvedValue({ lastID: 4, changes: 1 })
    get.mockResolvedValueOnce({ id: 4, project_id: 1, name: 'bug', color: '#42526E' })
    const res = await request(app).post('/api/projects/1/labels').send({ name: '  bug  ' })
    expect(res.status).toBe(201)
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO labels/.test(sql))
    expect(insert[1][1]).toBe('bug')
  })

  it(`PUT /projects/:id/labels/:labelId rejects a name over ${LABEL_NAME_MAX} chars with 400`, async () => {
    get.mockResolvedValueOnce({ id: 2, project_id: 1, name: 'old', color: '#42526E' })
    const res = await request(app).put('/api/projects/1/labels/2').send({ name: over(LABEL_NAME_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('name')
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   kb.js — title / body caps + case-insensitive duplicate slug → 409
   ================================================================ */
describe('KB article length caps + slug 409 (kb.js)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/kb.js')
    app = createApp(mod)
  })

  it(`POST /kb/articles rejects a title over ${KB_TITLE_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api/kb/articles').send({ title: over(KB_TITLE_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('title')
    expect(res.body.error).toContain(String(KB_TITLE_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it(`POST /kb/articles rejects a body over ${KB_CONTENT_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api/kb/articles').send({ title: 'Guide', body: over(KB_CONTENT_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('body')
    expect(run).not.toHaveBeenCalled()
  })

  it('POST /kb/articles accepts within-cap and trims title/body before the INSERT', async () => {
    get.mockResolvedValueOnce(null) // no duplicate slug
    run.mockResolvedValue({ lastID: 10, changes: 1 })
    get.mockResolvedValueOnce({ id: 10, title: 'Guide', slug: 'guide' })
    const res = await request(app).post('/api/kb/articles').send({ title: '  Guide  ', body: '  Content  ' })
    expect(res.status).toBe(201)
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO kb_articles/.test(sql))
    expect(insert[1][1]).toBe('Guide')   // title (trimmed)
    expect(insert[1][3]).toBe('Content') // body (trimmed)
  })

  it('POST /kb/articles rejects a case-insensitive duplicate slug with 409', async () => {
    // title "Getting Started" → slug "getting-started"; an existing row (any case) collides.
    get.mockResolvedValueOnce({ id: 3 }) // duplicate slug found
    const res = await request(app).post('/api/kb/articles').send({ title: 'Getting STARTED' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/slug/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('PATCH /kb/articles/:id rejects a case-insensitive duplicate slug with 409', async () => {
    get.mockResolvedValueOnce({ id: 10, title: 'Old', slug: 'old', status: 'draft' }) // existing article
    get.mockResolvedValueOnce({ id: 3 }) // another article already owns the slug
    const res = await request(app).patch('/api/kb/articles/10').send({ title: 'Getting Started' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/slug/i)
  })

  it(`PATCH /kb/articles/:id rejects a title over ${KB_TITLE_MAX} chars with 400`, async () => {
    get.mockResolvedValueOnce({ id: 10, title: 'Old', slug: 'old', status: 'draft' })
    const res = await request(app).patch('/api/kb/articles/10').send({ title: over(KB_TITLE_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('title')
    expect(run).not.toHaveBeenCalled()
  })
})
