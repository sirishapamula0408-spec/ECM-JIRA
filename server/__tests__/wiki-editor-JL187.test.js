/* ================================================================
   JL-187 (fosasoft) — the page editor's backend: autosave and publish.

   Autosave must never write a version (it fires every ~1.5s), must keep a
   published page's readers on the published text, and must respect draft
   visibility. Publish writes exactly one version and clears the draft.
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const tx = { run: vi.fn(), get: vi.fn(), all: vi.fn() }
const db = {
  run: vi.fn(), get: vi.fn(), all: vi.fn(), tableExists: vi.fn(), columnExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn(tx)),
}
vi.mock('../db.js', () => db)
vi.mock('../middleware/authorize.js', () => ({
  requireRole: () => (req, _res, next) => next(),
  loadProjectRole: () => (req, _res, next) => next(),
  requireProjectRole: () => (req, _res, next) => next(),
  loadUserRoles: (req, _res, next) => next(),
}))
vi.mock('../services/auditLog.js', () => ({ safeAppendAudit: vi.fn() }))

const AUTHOR = 'author@x.com'
const OTHER = 'someone@x.com'

const page = (over = {}) => ({
  id: 1, project_id: null, space_id: 7, title: 'Runbook', content: '<p>live</p>', parent_id: null,
  status: 'published', archived: false, deleted_at: null, deleted_by: null,
  created_by: AUTHOR, updated_by: AUTHOR,
  draft_title: null, draft_content: null, draft_updated_by: null, draft_updated_at: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
})

async function buildApp(user = { email: AUTHOR, workspaceRole: 'Member' }) {
  const mod = await import('../routes/wiki.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { id: 1, ...user }; next() })
  app.use('/', mod.default)
  return app
}

const versionInserts = (calls) => calls.filter((c) => /INSERT INTO wiki_page_versions/.test(c[0]))

beforeEach(() => {
  vi.clearAllMocks()
  db.all.mockResolvedValue([])
  db.run.mockResolvedValue({ lastID: 1, changes: 1 })
  tx.run.mockResolvedValue({ lastID: 1, changes: 1 })
  tx.get.mockResolvedValue({ max_ver: 3 })
})

describe('JL-187 POST / — a new page starts as a draft', () => {
  it('accepts an untitled draft', async () => {
    db.get.mockResolvedValue(page({ status: 'draft', title: '' }))
    const res = await request(await buildApp()).post('/').send({ spaceId: 7, status: 'draft' })
    expect(res.status).toBe(201)
  })

  it('still requires a title for a published page', async () => {
    const res = await request(await buildApp()).post('/').send({ spaceId: 7 })
    expect(res.status).toBe(400)
  })

  it('writes no version for a draft — history starts at publish', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    await request(await buildApp()).post('/').send({ spaceId: 7, title: 'X', status: 'draft' })
    expect(versionInserts(db.run.mock.calls)).toHaveLength(0)
  })

  it('still writes version 1 for a page created published', async () => {
    db.get.mockResolvedValue(page())
    await request(await buildApp()).post('/').send({ spaceId: 7, title: 'X' })
    expect(versionInserts(db.run.mock.calls)).toHaveLength(1)
  })
})

describe('JL-187 PUT /:id/draft — autosave', () => {
  it('saves a draft page straight into title and content, with no version', async () => {
    db.get.mockResolvedValueOnce(page({ status: 'draft' })).mockResolvedValue({ status: 'draft', updated_at: 'T' })
    const res = await request(await buildApp()).put('/1/draft').send({ title: 'New', content: '<p>x</p>' })
    expect(res.status).toBe(200)
    const update = db.run.mock.calls.find((c) => /UPDATE wiki_pages/.test(c[0]))
    expect(update[0]).toMatch(/SET title = COALESCE/)
    expect(update[1]).toEqual(['New', '<p>x</p>', AUTHOR, 1])
    expect(versionInserts(db.run.mock.calls)).toHaveLength(0)
  })

  it('saves a PUBLISHED page into its pending draft, leaving the live text alone', async () => {
    db.get.mockResolvedValueOnce(page()).mockResolvedValue({ status: 'published', draft_updated_at: 'T' })
    const res = await request(await buildApp()).put('/1/draft').send({ content: '<p>next</p>' })
    expect(res.status).toBe(200)
    const update = db.run.mock.calls.find((c) => /UPDATE wiki_pages/.test(c[0]))
    expect(update[0]).toMatch(/draft_content = COALESCE/)
    expect(update[0]).not.toMatch(/SET title|[^_]content = \?/)
    expect(versionInserts(db.run.mock.calls)).toHaveLength(0)
    expect(res.body.savedAt).toBe('T')
  })

  it('404s someone else’s draft — its existence is private', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp({ email: OTHER, workspaceRole: 'Member' })).put('/1/draft').send({ title: 'x' })
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('404s a page in the trash', async () => {
    db.get.mockResolvedValue(page({ deleted_at: '2026-09-02T00:00:00Z' }))
    const res = await request(await buildApp()).put('/1/draft').send({ title: 'x' })
    expect(res.status).toBe(404)
  })

  it('rejects a request with nothing to save', async () => {
    db.get.mockResolvedValue(page())
    const res = await request(await buildApp()).put('/1/draft').send({})
    expect(res.status).toBe(400)
  })
})

describe('JL-187 POST /:id/publish', () => {
  it('publishes, writes exactly one version, and clears the pending draft', async () => {
    db.get.mockResolvedValueOnce(page({ status: 'draft', title: 'Plan' })).mockResolvedValue(page())
    const res = await request(await buildApp()).post('/1/publish').send({ content: '<p>done</p>' })
    expect(res.status).toBe(200)
    const update = tx.run.mock.calls.find((c) => /UPDATE wiki_pages/.test(c[0]))
    expect(update[0]).toMatch(/status = 'published'/)
    expect(update[0]).toMatch(/draft_content = NULL/)
    expect(update[1].slice(0, 2)).toEqual(['Plan', '<p>done</p>'])
    const versions = versionInserts(tx.run.mock.calls)
    expect(versions).toHaveLength(1)
    expect(versions[0][1][1]).toBe(4) // max 3 + 1
    expect(res.body.version).toBe(4)
  })

  it('publishes the pending draft when no text is sent', async () => {
    db.get.mockResolvedValueOnce(page({ draft_title: 'Next', draft_content: '<p>pending</p>' })).mockResolvedValue(page())
    await request(await buildApp()).post('/1/publish').send({})
    const update = tx.run.mock.calls.find((c) => /UPDATE wiki_pages/.test(c[0]))
    expect(update[1].slice(0, 2)).toEqual(['Next', '<p>pending</p>'])
  })

  it('refuses to publish without a title', async () => {
    db.get.mockResolvedValue(page({ status: 'draft', title: '' }))
    const res = await request(await buildApp()).post('/1/publish').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/title/)
    expect(tx.run).not.toHaveBeenCalled()
  })

  it('refuses a parent from another space', async () => {
    db.get
      .mockResolvedValueOnce(page({ status: 'draft' }))
      .mockResolvedValueOnce(page({ id: 9, space_id: 99 }))
    const res = await request(await buildApp()).post('/1/publish').send({ parentId: 9 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/same space/)
  })

  it('accepts a parent in the same space', async () => {
    db.get
      .mockResolvedValueOnce(page({ status: 'draft' }))
      .mockResolvedValueOnce(page({ id: 9, space_id: 7 }))
      .mockResolvedValueOnce({ parent_id: null })
      .mockResolvedValue(page())
    const res = await request(await buildApp()).post('/1/publish').send({ parentId: 9 })
    expect(res.status).toBe(200)
    const update = tx.run.mock.calls.find((c) => /UPDATE wiki_pages/.test(c[0]))
    expect(update[1][3]).toBe(9)
  })

  it('404s someone else’s draft', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp({ email: OTHER, workspaceRole: 'Member' })).post('/1/publish').send({})
    expect(res.status).toBe(404)
  })
})

describe('JL-187 GET /:id — a pending draft is for editors only', () => {
  const withDraft = page({ draft_title: 'Secret next', draft_content: '<p>wip</p>', draft_updated_at: 'T' })

  it('includes the pending draft for an editor', async () => {
    db.get.mockResolvedValueOnce(withDraft).mockResolvedValue({ v: 2 })
    const res = await request(await buildApp()).get('/1')
    expect(res.body.draft_content).toBe('<p>wip</p>')
  })

  it('leaves it out for a Viewer', async () => {
    db.get.mockResolvedValueOnce(withDraft).mockResolvedValue({ v: 2 })
    const res = await request(await buildApp({ email: OTHER, workspaceRole: 'Viewer' })).get('/1')
    expect(res.status).toBe(200)
    expect(res.body.content).toBe('<p>live</p>')
    expect(res.body).not.toHaveProperty('draft_content')
    expect(res.body).not.toHaveProperty('draft_title')
  })
})

describe('JL-187 PATCH /:id honours draft visibility', () => {
  it('404s an edit to someone else’s draft', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp({ email: OTHER, workspaceRole: 'Member' })).patch('/1').send({ title: 'x' })
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })
})
