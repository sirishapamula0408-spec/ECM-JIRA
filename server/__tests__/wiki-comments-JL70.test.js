// @vitest-environment node
/* ================================================================
   JL-115→119 — page comments.

   Two things carry the weight here.

   Visibility: comments on a page you cannot read are as much a
   disclosure as the page — arguably more, since a comment quotes
   the part someone thought worth arguing about. The version
   endpoints shipped without that check and had to be fixed in
   Phase 5; these start with it, and the tests say so.

   Role rules: editing is the author's alone even for an admin,
   because an admin rewriting someone else's words under their
   byline is a misattribution. Deleting is the author's or an
   admin's, which removes without misrepresenting.
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const db = { run: vi.fn(), get: vi.fn(), all: vi.fn(), tableExists: vi.fn(), columnExists: vi.fn() }
vi.mock('../db.js', () => db)
vi.mock('../middleware/authorize.js', () => ({
  requireRole: () => (req, _res, next) => next(),
  loadProjectRole: () => (req, _res, next) => next(),
  requireProjectRole: () => (req, _res, next) => next(),
  loadUserRoles: (req, _res, next) => next(),
}))

const AUTHOR = 'author@x.com'
const OTHER = 'someone@x.com'
const ADMIN = { id: 9, email: 'admin@x.com', workspaceRole: 'Admin' }

const comment = (over = {}) => ({
  id: 5, page_id: 1, parent_id: null, author: AUTHOR, body: 'why this way?',
  edited_at: null, resolved_at: null, resolved_by: null,
  created_at: '2026-09-01T00:00:00Z', ...over,
})

/**
 * Wire the db. `page` false makes the page invisible, which is how every
 * "cannot see it" case is expressed.
 */
function wire({ page = { id: 1 }, found = comment(), rows = [] } = {}) {
  db.all.mockImplementation(async (sql) => {
    if (/SELECT id, owner_email FROM spaces/.test(sql)) return [{ id: 7, owner_email: AUTHOR }]
    if (/^\s*SELECT space_id, role FROM space_members/.test(sql)) return []
    if (/FROM projects p/.test(sql)) return []
    return rows
  })
  db.get.mockImplementation(async (sql) => {
    if (/FROM wiki_pages w WHERE w\.id/.test(sql)) return page || null
    if (/FROM wiki_page_comments/.test(sql)) return found
    return null
  })
  db.run.mockResolvedValue({ lastID: 77, changes: 1 })
}

async function buildApp(user = { id: 1, email: AUTHOR }) {
  const mod = await import('../routes/wikiComments.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/', mod.default)
  return app
}

beforeEach(() => { vi.clearAllMocks(); wire() })

/* ---------------------------------------------------------------- *
 * Visibility is inherited from the page
 * ---------------------------------------------------------------- */
describe('JL-115 comments inherit the page’s visibility', () => {
  const cases = [
    ['read', (a) => a.get('/1/comments')],
    ['add', (a) => a.post('/1/comments').send({ body: 'hi' })],
    ['edit', (a) => a.patch('/1/comments/5').send({ body: 'hi' })],
    ['delete', (a) => a.delete('/1/comments/5')],
    ['resolve', (a) => a.post('/1/comments/5/resolve')],
  ]

  it.each(cases)('404s %s on a page the caller cannot see', async (_label, act) => {
    wire({ page: null })
    const res = await act(request(await buildApp()))
    expect(res.status).toBe(404)
  })

  it('writes nothing when the page is invisible', async () => {
    wire({ page: null })
    await request(await buildApp()).post('/1/comments').send({ body: 'hi' })
    expect(db.run).not.toHaveBeenCalled()
  })

  it('filters through the same visibility rule as every other read', async () => {
    await request(await buildApp()).get('/1/comments')
    const sql = db.get.mock.calls.map((c) => c[0]).find((q) => /FROM wiki_pages w/.test(q))
    expect(sql).toMatch(/deleted_at IS NULL/)
    expect(sql).toMatch(/status <> 'draft'/)
  })
})

/* ---------------------------------------------------------------- *
 * JL-115 / JL-117 — adding, and threading
 * ---------------------------------------------------------------- */
describe('JL-115/117 adding comments', () => {
  it('adds a top-level comment', async () => {
    const res = await request(await buildApp()).post('/1/comments').send({ body: 'why this way?' })
    expect(res.status).toBe(201)
    const insert = db.run.mock.calls.find((c) => /INSERT INTO wiki_page_comments/.test(c[0]))
    expect(insert[1]).toEqual([1, null, AUTHOR, 'why this way?'])
  })

  it('refuses an empty or whitespace-only comment', async () => {
    for (const body of ['', '   ', undefined]) {
      const res = await request(await buildApp()).post('/1/comments').send({ body })
      expect(res.status).toBe(400)
    }
    expect(db.run).not.toHaveBeenCalled()
  })

  it('caps the length', async () => {
    const res = await request(await buildApp()).post('/1/comments').send({ body: 'x'.repeat(5001) })
    expect(res.status).toBe(400)
  })

  it('attaches a reply to its parent', async () => {
    wire({ found: comment({ id: 5, parent_id: null }) })
    await request(await buildApp()).post('/1/comments').send({ body: 'because', parentId: 5 })
    const insert = db.run.mock.calls.find((c) => /INSERT INTO wiki_page_comments/.test(c[0]))
    expect(insert[1][1]).toBe(5)
  })

  it('flattens a reply-to-a-reply onto the same root', async () => {
    /*
     * Threads are one level deep. An unbounded tree is unreadable at width,
     * and every product that allows it caps the display depth anyway — which
     * means the extra depth was never real.
     */
    wire({ found: comment({ id: 6, parent_id: 5 }) })
    await request(await buildApp()).post('/1/comments').send({ body: 'also', parentId: 6 })
    const insert = db.run.mock.calls.find((c) => /INSERT INTO wiki_page_comments/.test(c[0]))
    expect(insert[1][1]).toBe(5)
  })

  it('refuses a parent that lives on another page', async () => {
    // Otherwise a reply could be smuggled onto a page its author never opened.
    wire({ found: comment({ id: 5, page_id: 999 }) })
    const res = await request(await buildApp()).post('/1/comments').send({ body: 'x', parentId: 5 })
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------- *
 * JL-116 — threads come back nested
 * ---------------------------------------------------------------- */
describe('JL-116 reading', () => {
  it('nests replies under their root', async () => {
    wire({
      rows: [comment({ id: 5 }), comment({ id: 6, parent_id: 5, author: OTHER, body: 'because' })],
    })
    const res = await request(await buildApp()).get('/1/comments')
    expect(res.body.threads).toHaveLength(1)
    expect(res.body.threads[0].replies).toHaveLength(1)
    expect(res.body.total).toBe(2)
  })

  it('carries the author and timestamp on every comment', async () => {
    wire({ rows: [comment()] })
    const res = await request(await buildApp()).get('/1/comments')
    expect(res.body.threads[0].author).toBe(AUTHOR)
    expect(res.body.threads[0].created_at).toBeTruthy()
  })

  it('surfaces an orphaned reply rather than dropping it', async () => {
    wire({ rows: [comment({ id: 6, parent_id: 999 })] })
    const res = await request(await buildApp()).get('/1/comments')
    expect(res.body.threads).toHaveLength(1)
  })

  it('builds in one pass — no query per thread', async () => {
    wire({ rows: [comment({ id: 5 }), comment({ id: 6, parent_id: 5 })] })
    await request(await buildApp()).get('/1/comments')
    const commentQueries = db.all.mock.calls.filter((c) => /FROM wiki_page_comments/.test(c[0]))
    expect(commentQueries).toHaveLength(1)
  })
})

/* ---------------------------------------------------------------- *
 * JL-118 — role rules
 * ---------------------------------------------------------------- */
describe('JL-118 editing and deleting', () => {
  it('lets the author edit their own comment', async () => {
    const res = await request(await buildApp()).patch('/1/comments/5').send({ body: 'rephrased' })
    expect(res.status).toBe(200)
  })

  it('discloses the edit rather than rewriting silently', async () => {
    await request(await buildApp()).patch('/1/comments/5').send({ body: 'rephrased' })
    const update = db.run.mock.calls.find((c) => /UPDATE wiki_page_comments SET body/.test(c[0]))
    expect(update[0]).toMatch(/edited_at = NOW\(\)/)
  })

  it('refuses to let anyone else edit it', async () => {
    const res = await request(await buildApp(({ id: 2, email: OTHER }))).patch('/1/comments/5').send({ body: 'no' })
    expect(res.status).toBe(403)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('refuses to let an ADMIN edit it either', async () => {
    /*
     * An admin rewriting someone else's words while the byline still names
     * that person is a misattribution. Admins may delete instead, which
     * removes without misrepresenting.
     */
    const res = await request(await buildApp(ADMIN)).patch('/1/comments/5').send({ body: 'no' })
    expect(res.status).toBe(403)
  })

  it('lets the author delete their own', async () => {
    const res = await request(await buildApp()).delete('/1/comments/5')
    expect(res.status).toBe(200)
  })

  it('lets an admin delete someone else’s', async () => {
    const res = await request(await buildApp(ADMIN)).delete('/1/comments/5')
    expect(res.status).toBe(200)
  })

  it('refuses an ordinary member deleting someone else’s', async () => {
    const res = await request(await buildApp({ id: 2, email: OTHER })).delete('/1/comments/5')
    expect(res.status).toBe(403)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('leaves the reply cascade to the database', async () => {
    // A future code path that deletes a comment then cannot forget.
    await request(await buildApp()).delete('/1/comments/5')
    const calls = db.run.mock.calls.filter((c) => /DELETE FROM wiki_page_comments/.test(c[0]))
    expect(calls).toHaveLength(1)
  })
})

/* ---------------------------------------------------------------- *
 * JL-119 — resolving
 * ---------------------------------------------------------------- */
describe('JL-119 resolving a thread', () => {
  it('resolves a root, recording who and when', async () => {
    const res = await request(await buildApp()).post('/1/comments/5/resolve')
    expect(res.status).toBe(200)
    const update = db.run.mock.calls.find((c) => /SET resolved_at/.test(c[0]))
    expect(update[1][1]).toBe(AUTHOR)
    expect(update[1][0]).toBeTruthy()
  })

  it('reopens by clearing both fields', async () => {
    // A reopened thread should be indistinguishable from one never resolved.
    await request(await buildApp()).post('/1/comments/5/resolve').send({ resolved: false })
    const update = db.run.mock.calls.find((c) => /SET resolved_at/.test(c[0]))
    expect(update[1][0]).toBeNull()
    expect(update[1][1]).toBeNull()
  })

  it('refuses to resolve an individual reply', async () => {
    /*
     * Resolution belongs to the thread. Resolving a reply would let one
     * message claim a state different from the conversation it sits in.
     */
    wire({ found: comment({ id: 6, parent_id: 5 }) })
    const res = await request(await buildApp()).post('/1/comments/6/resolve')
    expect(res.status).toBe(400)
    expect(db.run).not.toHaveBeenCalled()
  })
})
