// @vitest-environment node
/* ================================================================
   JL-158 — GET /api/wiki/:id returns the Space's name.

   The page viewer renders `page.space_name || 'No space'`. The
   detail fetch was a bare SELECT * FROM wiki_pages, so space_name
   was never present and EVERY page in a Space displayed "No space"
   — including one created in that Space a second earlier, which is
   how it was found.

   The assertions here are on the SQL, not on the shape of a mocked
   row. With db.js mocked, asserting that the response contains
   space_name would only prove the mock returned it: the handler
   passes the row through either way. What actually has to be true
   is that the query JOINs spaces and selects its name.
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
  requireProjectRead: () => (req, _res, next) => next(),
  requireProjectWrite: () => (req, _res, next) => next(),
  loadUserRoles: (req, _res, next) => next(),
}))
vi.mock('../services/auditLog.js', () => ({ safeAppendAudit: vi.fn() }))

const ME = 'me@x.com'

const PAGE = {
  id: 5, project_id: null, space_id: 2, title: 'Runbook', content: '<p>x</p>',
  parent_id: null, status: 'published', deleted_at: null, archived: false,
  created_by: ME, updated_by: ME,
  space_name: 'Engineering', space_key: 'ENG',
}

async function buildApp(user = { id: 1, email: ME, workspaceRole: 'Member' }) {
  const mod = await import('../routes/wiki.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/', mod.default)
  return app
}

/** The SQL the handler used to load the page itself. */
function pageSelectSql() {
  const call = db.get.mock.calls.find(([sql]) => /FROM wiki_pages w?\s/i.test(sql) && /WHERE w?\.?id = \?/.test(sql))
  expect(call, 'no page SELECT was issued').toBeTruthy()
  return call[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  db.all.mockResolvedValue([])
  db.get.mockImplementation(async (sql) => {
    if (/FROM wiki_pages/i.test(sql) && /WHERE w?\.?id = \?/.test(sql)) return PAGE
    return undefined
  })
})

describe('JL-158 the detail fetch joins the Space', () => {
  it('LEFT JOINs spaces and selects its name', async () => {
    await request(await buildApp()).get('/5')
    const sql = pageSelectSql()

    expect(sql).toMatch(/LEFT JOIN spaces/i)
    expect(sql).toMatch(/s\.name AS space_name/i)
  })

  it('LEFT, not INNER — a page with no Space must still load', async () => {
    /*
     * A page can belong to a project instead (JL-88). An INNER JOIN would
     * 404 every one of those, turning a cosmetic label bug into a total
     * loss of the per-project wiki.
     */
    await request(await buildApp()).get('/5')
    expect(pageSelectSql()).not.toMatch(/\bINNER JOIN spaces/i)
  })

  it('still selects every page column, not a hand-picked list', async () => {
    // canSeePage() reads status/created_by, the 404 branch reads deleted_at,
    // and the client reads content. w.* keeps all of them without this query
    // needing to know which.
    await request(await buildApp()).get('/5')
    expect(pageSelectSql()).toMatch(/SELECT w\.\*/i)
  })

  it('passes the joined name through to the client', async () => {
    const res = await request(await buildApp()).get('/5')
    expect(res.status).toBe(200)
    expect(res.body.space_name).toBe('Engineering')
    expect(res.body.space_key).toBe('ENG')
  })
})

describe('JL-158 the visibility rules are unchanged', () => {
  it('still 404s a soft-deleted page', async () => {
    // The join must not have loosened the filter that follows it.
    db.get.mockImplementation(async (sql) => (
      /FROM wiki_pages/i.test(sql) ? { ...PAGE, deleted_at: '2026-01-01' } : undefined
    ))
    const res = await request(await buildApp()).get('/5')
    expect(res.status).toBe(404)
  })

  it("still 404s someone else's draft", async () => {
    db.get.mockImplementation(async (sql) => (
      /FROM wiki_pages/i.test(sql)
        ? { ...PAGE, status: 'draft', created_by: 'someone-else@x.com' }
        : undefined
    ))
    const res = await request(await buildApp()).get('/5')
    expect(res.status).toBe(404)
  })

  it('still 404s a page that does not exist', async () => {
    db.get.mockResolvedValue(undefined)
    const res = await request(await buildApp()).get('/999')
    expect(res.status).toBe(404)
  })
})
