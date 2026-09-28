// @vitest-environment node
/* ================================================================
   JL-68 Phase 5 — version history: restore (JL-108) and compare
   (JL-109), plus the visibility gap both of them exposed.

   The version endpoints had NO visibility check: they read
   wiki_page_versions by page_id directly, so another author's
   unpublished draft — or a page sitting in the trash — had its full
   content readable through its own history. Gating the page while
   leaving its history open protects nothing, because the history IS
   the content, one revision per row.
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

const page = (over = {}) => ({
  id: 1, project_id: null, space_id: 7, title: 'Runbook', parent_id: null,
  status: 'published', archived: false, deleted_at: null, deleted_by: null,
  created_by: AUTHOR, updated_by: AUTHOR,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
})

const version = (over = {}) => ({
  id: 10, page_id: 1, version_number: 2, title: 'Runbook',
  content: '<p>one</p><p>two</p>', edited_by: AUTHOR,
  created_at: '2026-09-02T00:00:00Z', ...over,
})

async function buildApp(email = AUTHOR) {
  const mod = await import('../routes/wiki.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { id: 1, email }; next() })
  app.use('/', mod.default)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  db.all.mockResolvedValue([])
  db.run.mockResolvedValue({ lastID: 1, changes: 1 })
  db.get.mockResolvedValue(page())
})

/* ---------------------------------------------------------------- *
 * The gap
 * ---------------------------------------------------------------- */
describe('JL-108/109 version history is gated like the page itself', () => {
  it('404s the version list for a page in the trash', async () => {
    db.get.mockResolvedValue(page({ deleted_at: '2026-09-20T00:00:00Z' }))
    const res = await request(await buildApp()).get('/1/versions')
    expect(res.status).toBe(404)
  })

  it("404s the version list for someone else's draft", async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp(OTHER)).get('/1/versions')
    expect(res.status).toBe(404)
  })

  it("404s a single version of someone else's draft — the row IS the content", async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp(OTHER)).get('/1/versions/10')
    expect(res.status).toBe(404)
    expect(res.body.content).toBeUndefined()
  })

  it('still serves the author their own draft history', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp(AUTHOR)).get('/1/versions')
    expect(res.status).toBe(200)
  })

  it('404s a restore aimed at a page the caller cannot see', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp(OTHER)).post('/1/versions/10/restore')
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('404s a compare aimed at a page the caller cannot see', async () => {
    db.get.mockResolvedValue(page({ deleted_at: '2026-09-20T00:00:00Z' }))
    const res = await request(await buildApp()).get('/1/versions/compare?from=1&to=2')
    expect(res.status).toBe(404)
  })
})

/* ---------------------------------------------------------------- *
 * JL-108 — restore
 * ---------------------------------------------------------------- */
describe('JL-108 restore a previous version', () => {
  function wire({ src = version({ version_number: 2, content: '<p>old</p>' }), max = 5 } = {}) {
    db.get.mockImplementation(async (sql) => {
      if (/MAX\(version_number\)/.test(sql)) return { max_ver: max }
      if (/FROM wiki_page_versions/.test(sql)) return src
      return page()
    })
  }

  it('APPENDS a new version rather than rewinding to the old row', async () => {
    /*
     * JL-141 requires history to be immutable, and appending is also what
     * makes a restore itself undoable: the edits stepped back over are still
     * there, so restoring the wrong version is recoverable.
     */
    wire()
    const res = await request(await buildApp()).post('/1/versions/10/restore')
    expect(res.status).toBe(200)
    const insert = db.run.mock.calls.find((c) => /INSERT INTO wiki_page_versions/.test(c[0]))
    expect(insert, 'a restore must write a new version row').toBeDefined()
    expect(insert[1]).toContain(6) // MAX(5) + 1
  })

  it('never updates or deletes an existing version row', async () => {
    wire()
    await request(await buildApp()).post('/1/versions/10/restore')
    for (const [sql] of db.run.mock.calls) {
      expect(sql).not.toMatch(/UPDATE wiki_page_versions/i)
      expect(sql).not.toMatch(/DELETE FROM wiki_page_versions/i)
    }
  })

  it('copies the old content onto the live page', async () => {
    wire()
    await request(await buildApp()).post('/1/versions/10/restore')
    const update = db.run.mock.calls.find((c) => /UPDATE wiki_pages SET title/.test(c[0]))
    expect(update[1]).toContain('<p>old</p>')
  })

  it('credits the restore to whoever performed it, not the original author', async () => {
    wire({ src: version({ edited_by: 'ancient@x.com', content: '<p>old</p>' }) })
    await request(await buildApp('restorer@x.com')).post('/1/versions/10/restore')
    const insert = db.run.mock.calls.find((c) => /INSERT INTO wiki_page_versions/.test(c[0]))
    expect(insert[1]).toContain('restorer@x.com')
  })

  it('reports which version it came from', async () => {
    wire({ src: version({ version_number: 2 }) })
    const res = await request(await buildApp()).post('/1/versions/10/restore')
    expect(res.body.restoredFrom).toBe(2)
    expect(res.body.version).toBe(6)
  })

  it('404s a version id that belongs to another page', async () => {
    db.get.mockImplementation(async (sql) => {
      if (/FROM wiki_page_versions/.test(sql)) return null
      return page()
    })
    const res = await request(await buildApp()).post('/1/versions/999/restore')
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------- *
 * JL-109 — compare
 * ---------------------------------------------------------------- */
describe('JL-109 compare two versions', () => {
  function wireCompare(fromV, toV) {
    db.get.mockImplementation(async (sql, params) => {
      if (/FROM wiki_page_versions WHERE page_id = \? AND version_number/.test(sql)) {
        return params[1] === fromV.version_number ? fromV : toV
      }
      return page()
    })
  }

  it('is not swallowed by the :versionId route', async () => {
    /*
     * Express matches in declaration order. With /:id/versions/:versionId
     * declared first, "compare" is read as a version id, Number('compare') is
     * NaN, and a working endpoint 404s. This pins the ordering.
     */
    wireCompare(version({ version_number: 1 }), version({ version_number: 2 }))
    const res = await request(await buildApp()).get('/1/versions/compare?from=1&to=2')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('diff')
  })

  it('reports added and removed lines', async () => {
    wireCompare(
      version({ version_number: 1, content: '<p>alpha</p><p>beta</p>' }),
      version({ version_number: 2, content: '<p>alpha</p><p>gamma</p>' }),
    )
    const res = await request(await buildApp()).get('/1/versions/compare?from=1&to=2')
    const kinds = res.body.diff.map((d) => `${d.type}:${d.text}`)
    expect(kinds).toContain('same:alpha')
    expect(kinds).toContain('removed:beta')
    expect(kinds).toContain('added:gamma')
    expect(res.body.summary).toEqual({ added: 1, removed: 1, unchanged: 1 })
  })

  it('compares the TEXT, so markup is not reported as a change', async () => {
    wireCompare(
      version({ version_number: 1, content: '<p>hello</p>' }),
      version({ version_number: 2, content: '<h2>hello</h2>' }),
    )
    const res = await request(await buildApp()).get('/1/versions/compare?from=1&to=2')
    // A documented consequence: a purely formatting change shows as no change.
    expect(res.body.summary.added).toBe(0)
    expect(res.body.summary.removed).toBe(0)
  })

  it('flags a rename, which a body diff would never show', async () => {
    wireCompare(
      version({ version_number: 1, title: 'Old name' }),
      version({ version_number: 2, title: 'New name' }),
    )
    const res = await request(await buildApp()).get('/1/versions/compare?from=1&to=2')
    expect(res.body.titleChanged).toBe(true)
  })

  it('rejects a missing or non-numeric version', async () => {
    const res = await request(await buildApp()).get('/1/versions/compare?from=1')
    expect(res.status).toBe(400)
  })

  it('404s when one of the two versions does not exist', async () => {
    db.get.mockImplementation(async (sql) => {
      if (/FROM wiki_page_versions WHERE page_id/.test(sql)) return null
      return page()
    })
    const res = await request(await buildApp()).get('/1/versions/compare?from=1&to=99')
    expect(res.status).toBe(404)
  })
})
