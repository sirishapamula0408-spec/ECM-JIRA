// @vitest-environment node
/* ================================================================
   JL-110→114 — page search.

   The assertion that matters most is JL-111: a page the caller
   cannot see must not be findable by guessing a word in it. Search
   is the endpoint where a leak is easiest to miss, because the
   query returns MORE rows rather than failing.
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

const ME = 'me@x.com'
const SPACES = [{ id: 7, owner_email: ME }, { id: 8, owner_email: 'other@x.com' }]

const hit = (over = {}) => ({
  id: 1, title: 'Deploy runbook', space_id: 7, space_name: 'Engineering', space_key: 'ENG',
  content: '<p>Before deploying, drain the queue and confirm the runbook steps.</p>',
  created_by: ME, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z', ...over,
})

/** Route db by SQL shape; a single mockResolvedValue would prove nothing. */
function wire({ rows = [hit()], total = 1, spaces = SPACES, memberships = [], projectIds = [] } = {}) {
  db.all.mockImplementation(async (sql) => {
    if (/SELECT id, owner_email FROM spaces/.test(sql)) return spaces
    if (/^\s*SELECT space_id, role FROM space_members/.test(sql)) return memberships
    if (/FROM projects p/.test(sql)) return projectIds
    return rows
  })
  db.get.mockImplementation(async (sql) => {
    if (/COUNT\(\*\)::int AS n/.test(sql)) return { n: total }
    return null
  })
}

async function buildApp(user = { id: 1, email: ME }) {
  const mod = await import('../routes/wikiHome.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/', mod.default)
  return app
}

/** The one search SQL, picked out of the calls. */
const searchSql = () =>
  db.all.mock.calls.map((c) => c[0]).find((q) => /FROM wiki_pages w LEFT JOIN spaces/.test(q) && /ILIKE/.test(q))

beforeEach(() => {
  vi.clearAllMocks()
  wire()
})

/* ---------------------------------------------------------------- *
 * JL-111 — the property that matters
 * ---------------------------------------------------------------- */
describe('JL-111 search cannot surface what the caller cannot read', () => {
  it('runs every search through the same visibility filter as every other read', async () => {
    await request(await buildApp()).get('/search?q=runbook')
    const sql = searchSql()
    expect(sql).toMatch(/deleted_at IS NULL/)
    expect(sql).toMatch(/status <> 'draft'/)
  })

  it('applies the filter to the COUNT as well, or the total leaks a number', async () => {
    await request(await buildApp()).get('/search?q=runbook')
    const countSql = db.get.mock.calls.map((c) => c[0]).find((q) => /COUNT\(\*\)/.test(q))
    expect(countSql).toMatch(/deleted_at IS NULL/)
    expect(countSql).toMatch(/status <> 'draft'/)
  })

  it('returns nothing for a Space the caller cannot see, not its contents', async () => {
    // JL-113 narrows on top of the visibility filter, never instead of it.
    wire({ spaces: [{ id: 7, owner_email: ME }] })
    const res = await request(await buildApp()).get('/search?q=x&spaceId=999')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])
    expect(res.body.total).toBe(0)
    // And it did not even run the query.
    expect(searchSql()).toBeUndefined()
  })
})

/* ---------------------------------------------------------------- *
 * JL-110 / JL-114 — what counts as a match
 * ---------------------------------------------------------------- */
describe('JL-110/JL-114 what matches', () => {
  it('matches the title and the body', async () => {
    await request(await buildApp()).get('/search?q=runbook')
    expect(searchSql()).toMatch(/w\.title ILIKE \?/)
    expect(searchSql()).toMatch(/w\.content ILIKE \?/)
  })

  it('matches the Space name and key, so "engineering" finds its pages', async () => {
    await request(await buildApp()).get('/search?q=engineering')
    expect(searchSql()).toMatch(/s\.name ILIKE \?/)
    expect(searchSql()).toMatch(/s\.key ILIKE \?/)
  })

  it('returns the Space on every row, so a result is identifiable unopened', async () => {
    const res = await request(await buildApp()).get('/search?q=runbook')
    expect(res.body.items[0].space_name).toBe('Engineering')
  })

  it('ranks a title hit above a body hit', async () => {
    await request(await buildApp()).get('/search?q=runbook')
    expect(searchSql()).toMatch(/CASE WHEN w\.title ILIKE \? THEN 0 ELSE 1 END/)
  })

  it('treats an empty term as no search rather than as match-everything', async () => {
    const res = await request(await buildApp()).get('/search?q=%20%20')
    expect(res.body.items).toEqual([])
    expect(res.body.total).toBe(0)
    expect(searchSql()).toBeUndefined()
  })
})

/* ---------------------------------------------------------------- *
 * JL-112 — the excerpt
 * ---------------------------------------------------------------- */
describe('JL-112 the excerpt', () => {
  it('shows the text around the match, with the match located', async () => {
    const res = await request(await buildApp()).get('/search?q=drain')
    const ex = res.body.items[0].excerpt
    expect(ex.text).toContain('drain')
    expect(ex.ranges.length).toBeGreaterThan(0)
    const [start, end] = ex.ranges[0]
    expect(ex.text.slice(start, end).toLowerCase()).toBe('drain')
  })

  it('returns offsets, NOT pre-marked HTML', async () => {
    /*
     * Building markup out of stored page content outside sanitizeHtml is the
     * second-assembly-path problem JL-359 removed. Offsets mean the client
     * renders text nodes and there is no markup to get wrong.
     */
    const res = await request(await buildApp()).get('/search?q=drain')
    const ex = res.body.items[0].excerpt
    expect(ex.text).not.toMatch(/<mark|<b>|<strong/i)
    expect(Array.isArray(ex.ranges)).toBe(true)
  })

  it('strips markup out of the excerpt', async () => {
    const res = await request(await buildApp()).get('/search?q=drain')
    expect(res.body.items[0].excerpt.text).not.toContain('<p>')
  })

  it('never ships the whole page back with a search result', async () => {
    const res = await request(await buildApp()).get('/search?q=drain')
    expect(res.body.items[0].content).toBeUndefined()
  })

  it('still gives an excerpt when the hit was on the title or Space', async () => {
    // A body with no match is normal — the page matched some other way.
    wire({ rows: [hit({ content: '<p>Nothing relevant in here at all.</p>' })] })
    const res = await request(await buildApp()).get('/search?q=engineering')
    expect(res.body.items[0].excerpt.text).toContain('Nothing relevant')
    expect(res.body.items[0].excerpt.ranges).toEqual([])
  })
})

/* ---------------------------------------------------------------- *
 * JL-113 — narrowing, and paging
 * ---------------------------------------------------------------- */
describe('JL-113 narrowing and paging', () => {
  it('narrows to one Space when asked', async () => {
    await request(await buildApp()).get('/search?q=x&spaceId=7')
    expect(searchSql()).toMatch(/AND w\.space_id = \?/)
  })

  it('does not narrow when not asked', async () => {
    await request(await buildApp()).get('/search?q=x')
    expect(searchSql()).not.toMatch(/AND w\.space_id = \?/)
  })

  it('reports a total larger than the page, so the count is honest', async () => {
    wire({ rows: [hit()], total: 24 })
    const res = await request(await buildApp()).get('/search?q=x')
    expect(res.body.total).toBe(24)
    expect(res.body.hasMore).toBe(true)
    expect(res.body.nextCursor).toBe(20)
  })

  it('stops paging once the page covers the total', async () => {
    wire({ rows: [hit()], total: 1 })
    const res = await request(await buildApp()).get('/search?q=x')
    expect(res.body.hasMore).toBe(false)
    expect(res.body.nextCursor).toBeNull()
  })

  it('caps an absurd limit', async () => {
    await request(await buildApp()).get('/search?q=x&limit=100000')
    const call = db.all.mock.calls.find((c) => /ILIKE/.test(c[0]) && /LIMIT \? OFFSET \?/.test(c[0]))
    expect(call[1]).toContain(50)
  })
})
