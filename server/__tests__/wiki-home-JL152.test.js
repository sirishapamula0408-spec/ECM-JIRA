// @vitest-environment node
/* ================================================================
   JL-152 — Confluence Lite home page.

   The thing worth testing hardest here is not that the sections
   render — it is that they cannot render something the caller was
   never allowed to see. The home page reads pages from four angles
   at once (recently viewed, created, starred, feed) plus Spaces, and
   a leak in any one of them is silent: the query returns MORE rows,
   it does not fail.

   So the permission filter is tested directly, as a unit, rather than
   only through the routes — and the batched space-visibility helper
   is pinned against the per-Space resolveSpaceRole it mirrors, so the
   two cannot drift apart unnoticed.
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
const OTHER = 'someone@x.com'

const SPACES = [
  { id: 7, owner_email: ME },
  { id: 8, owner_email: OTHER },
]

/**
 * Route db.all by the shape of the SQL. The home routes issue several
 * different queries per request, so a single mockResolvedValue would answer
 * all of them with the same rows and prove nothing.
 */
function wireDb({ spaces = SPACES, memberships = [], projectIds = [], rows = [] } = {}) {
  /*
   * Order matters: the Following feed's SQL CONTAINS "FROM space_members" in a
   * subquery, so the broad patterns have to be tested after the specific ones
   * or the feed query gets answered with the memberships list.
   */
  db.all.mockImplementation(async (sql) => {
    if (/UNION ALL/.test(sql)) return rows
    if (/SELECT id, owner_email FROM spaces/.test(sql)) return spaces
    if (/^\s*SELECT space_id, role FROM space_members/.test(sql)) return memberships
    if (/FROM projects p/.test(sql)) return projectIds
    return rows
  })
  db.get.mockResolvedValue(null)
  db.run.mockResolvedValue({ lastID: 1, changes: 1 })
}

async function buildApp(user = { id: 1, email: ME }) {
  const mod = await import('../routes/wikiHome.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/', mod.default)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  wireDb()
})

/* ---------------------------------------------------------------- *
 * The filter itself
 * ---------------------------------------------------------------- */
describe('JL-152 pageVisibilityFilter', () => {
  it('always excludes soft-deleted pages', async () => {
    const { pageVisibilityFilter } = await import('../utils/wikiVisibility.js')
    const { clause } = await pageVisibilityFilter({ email: ME })
    expect(clause).toMatch(/w\.deleted_at IS NULL/)
  })

  it("hides other people's drafts, and only theirs", async () => {
    const { pageVisibilityFilter } = await import('../utils/wikiVisibility.js')
    const { clause, params } = await pageVisibilityFilter({ email: ME })
    expect(clause).toMatch(/status <> 'draft' OR LOWER\(w\.created_by\) = LOWER\(\?\)/)
    // The caller's own address is what makes their own drafts visible.
    expect(params).toContain(ME)
  })

  it('restricts pages to Spaces the caller can see', async () => {
    const { pageVisibilityFilter } = await import('../utils/wikiVisibility.js')
    const { clause, params } = await pageVisibilityFilter({ email: ME })
    expect(clause).toMatch(/w\.space_id IN \(/)
    expect(params).toEqual(expect.arrayContaining([7, 8]))
  })

  it('restricts pages to projects the caller is a member of', async () => {
    wireDb({ projectIds: [{ id: 3 }] })
    const { pageVisibilityFilter } = await import('../utils/wikiVisibility.js')
    const { clause, params } = await pageVisibilityFilter({ email: ME })
    expect(clause).toMatch(/w\.project_id IN \(/)
    expect(params).toContain(3)
  })

  it('does not restrict projects for a workspace Admin', async () => {
    const { pageVisibilityFilter } = await import('../utils/wikiVisibility.js')
    const { clause } = await pageVisibilityFilter({ email: ME, workspaceRole: 'Admin' })
    expect(clause).not.toMatch(/project_id IN \(/)
  })

  it('fails CLOSED when the caller can see no project', async () => {
    // The dangerous shape is `IN ()` — a syntax error at best, and an
    // accidental "match everything" if someone papers over it.
    wireDb({ projectIds: [] })
    const { pageVisibilityFilter } = await import('../utils/wikiVisibility.js')
    const { clause } = await pageVisibilityFilter({ email: ME })
    expect(clause).toMatch(/w\.project_id IS NULL/)
    expect(clause).not.toMatch(/IN \(\)/)
  })

  it('fails CLOSED when the caller can see no Space', async () => {
    wireDb({ spaces: [] })
    const { pageVisibilityFilter } = await import('../utils/wikiVisibility.js')
    const { clause } = await pageVisibilityFilter({ email: ME })
    expect(clause).toMatch(/w\.space_id IS NULL/)
    expect(clause).not.toMatch(/IN \(\)/)
  })

  it('gives an anonymous caller access to nothing scoped', async () => {
    const { pageVisibilityFilter } = await import('../utils/wikiVisibility.js')
    const { clause } = await pageVisibilityFilter({})
    expect(clause).toMatch(/w\.project_id IS NULL/)
  })
})

/* ---------------------------------------------------------------- *
 * The batched helper must agree with the one it mirrors
 * ---------------------------------------------------------------- */
describe('JL-152 visibleSpaceIds mirrors resolveSpaceRole', () => {
  const cases = [
    ['a workspace Admin', { email: OTHER, workspaceRole: 'Admin' }],
    ['a Space owner', { email: ME }],
    ['an explicit member', { email: OTHER }],
    ['a stranger', { email: 'nobody@x.com' }],
  ]

  it.each(cases)('agrees for %s', async (_label, user) => {
    wireDb({ memberships: [{ space_id: 8, role: 'Member' }] })
    const { visibleSpaceIds } = await import('../utils/wikiVisibility.js')
    const { resolveSpaceRole } = await import('../routes/spaces.js')

    // resolveSpaceRole asks the db per Space; answer the same membership.
    db.get.mockImplementation(async (sql, params) => {
      if (/FROM space_members/.test(sql)) {
        return params?.[0] === 8 ? { role: 'Member' } : null
      }
      return null
    })

    const batched = await visibleSpaceIds(user)
    const oneByOne = new Set()
    for (const space of SPACES) {
      if (await resolveSpaceRole(space, user)) oneByOne.add(space.id)
    }
    expect([...batched].sort()).toEqual([...oneByOne].sort())
  })
})

/* ---------------------------------------------------------------- *
 * GET /api/wiki-home
 * ---------------------------------------------------------------- */
describe('JL-152 GET /api/wiki-home', () => {
  it('returns every section the sidebar needs in ONE request', async () => {
    const res = await request(await buildApp()).get('/')
    expect(res.status).toBe(200)
    for (const key of ['recent', 'starredPages', 'spaces', 'starredSpaces']) {
      expect(res.body).toHaveProperty(key)
    }
  })

  it('no longer computes pickUp, nor the query that built it', async () => {
    /*
     * JL-154 removed "Pick up where you left off" from the page. Returning it
     * anyway would mean running a per-user "pages you created" query on every
     * home load for a client that ignores the result.
     */
    const res = await request(await buildApp()).get('/')
    expect(res.body).not.toHaveProperty('pickUp')
    const createdQuery = db.all.mock.calls
      .map((c) => c[0])
      .find((sql) => /LOWER(w.created_by) = LOWER/.test(sql))
    expect(createdQuery).toBeUndefined()
  })

  it('filters every page query through the visibility clause', async () => {
    await request(await buildApp()).get('/')
    const pageQueries = db.all.mock.calls
      .map((c) => c[0])
      .filter((sql) => /FROM wiki_pages w/.test(sql))
    expect(pageQueries.length).toBeGreaterThan(0)
    // Not one of them may skip it.
    for (const sql of pageQueries) {
      expect(sql).toMatch(/deleted_at IS NULL/)
      expect(sql).toMatch(/status <> 'draft'/)
    }
  })

  it('reports hasMore from a probe row rather than a second COUNT query', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, title: `P${i}` }))
    db.all.mockImplementation(async (sql) => {
      if (/SELECT id, owner_email FROM spaces/.test(sql)) return SPACES
      if (/^\s*SELECT space_id, role FROM space_members/.test(sql)) return []
      if (/FROM projects p/.test(sql)) return []
      if (/JOIN favorites f/.test(sql)) return many
      return []
    })
    const res = await request(await buildApp()).get('/')
    expect(res.body.starredPages).toHaveLength(5)
    expect(res.body.starredPagesHasMore).toBe(true)
    expect(db.all.mock.calls.some((c) => /COUNT\(\*\)/.test(c[0]) && /favorites/.test(c[0]))).toBe(false)
  })

  it('returns empty sections rather than failing for a brand new user', async () => {
    wireDb({ spaces: [], rows: [] })
    const res = await request(await buildApp()).get('/')
    expect(res.status).toBe(200)
    expect(res.body.recent).toEqual([])
    expect(res.body.spaces).toEqual([])
    expect(res.body.starredSpaces).toEqual([])
  })
})

/* ---------------------------------------------------------------- *
 * GET /api/wiki-home/feed
 * ---------------------------------------------------------------- */
describe('JL-152 GET /api/wiki-home/feed', () => {
  it('defaults to the Following tab', async () => {
    const res = await request(await buildApp()).get('/feed')
    expect(res.body.tab).toBe('following')
  })

  it('narrows Following to pages the caller has a stake in', async () => {
    await request(await buildApp()).get('/feed?tab=following')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /UNION ALL/.test(q))
    expect(sql).toMatch(/FROM space_members/)
    expect(sql).toMatch(/FROM favorites/)
    expect(sql).toMatch(/LOWER\(w\.created_by\)/)
  })

  it('drops that restriction on Popular', async () => {
    await request(await buildApp()).get('/feed?tab=popular')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /UNION ALL/.test(q))
    expect(sql).not.toMatch(/SELECT space_id FROM space_members/)
  })

  it('applies the visibility filter to BOTH union arms', async () => {
    await request(await buildApp()).get('/feed?tab=popular')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /UNION ALL/.test(q))
    const [before, after] = sql.split('UNION ALL')
    expect(before).toMatch(/deleted_at IS NULL/)
    expect(after).toMatch(/deleted_at IS NULL/)
  })

  it('orders by recency when asked, and by relevance otherwise', async () => {
    await request(await buildApp()).get('/feed?sort=recent')
    let sql = db.all.mock.calls.map((c) => c[0]).find((q) => /UNION ALL/.test(q))
    expect(sql).toMatch(/ORDER BY at DESC/)

    db.all.mockClear()
    await request(await buildApp()).get('/feed?sort=relevant')
    sql = db.all.mock.calls.map((c) => c[0]).find((q) => /UNION ALL/.test(q))
    expect(sql).toMatch(/ORDER BY is_starred DESC, viewers DESC, at DESC/)
  })

  it('rejects an unknown tab or sort by falling back, not by erroring', async () => {
    const res = await request(await buildApp()).get('/feed?tab=everything&sort=magic')
    expect(res.status).toBe(200)
    expect(res.body.tab).toBe('following')
    expect(res.body.sort).toBe('relevant')
  })

  it('paginates rather than loading the whole history', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ page_id: i, kind: 'page_created', at: '2026-09-01' }))
    db.all.mockImplementation(async (sql) => {
      if (/SELECT id, owner_email FROM spaces/.test(sql)) return SPACES
      if (/^\s*SELECT space_id, role FROM space_members/.test(sql)) return []
      if (/FROM projects p/.test(sql)) return []
      if (/UNION ALL/.test(sql)) return rows
      return []
    })
    const res = await request(await buildApp()).get('/feed')
    expect(res.body.items).toHaveLength(20)
    expect(res.body.hasMore).toBe(true)
    expect(res.body.nextCursor).toBe(20)
  })

  it('caps an absurd limit instead of honouring it', async () => {
    await request(await buildApp()).get('/feed?limit=100000')
    const call = db.all.mock.calls.find((c) => /UNION ALL/.test(c[0]))
    // limit + 1, where limit is clamped to FEED_MAX (50).
    expect(call[1]).toContain(51)
  })
})

/* ---------------------------------------------------------------- *
 * Writes
 * ---------------------------------------------------------------- */
describe('JL-152 recording a view', () => {
  it('upserts rather than appending a row per read', async () => {
    db.get.mockResolvedValue({ id: 5 })
    const res = await request(await buildApp()).post('/views/5')
    expect(res.status).toBe(201)
    const insert = db.run.mock.calls.find((c) => /INSERT INTO recently_viewed/.test(c[0]))
    expect(insert[0]).toMatch(/ON CONFLICT \(user_email, page_id\) DO UPDATE SET viewed_at = NOW\(\)/)
  })

  it('refuses to record a view of a page the caller cannot see', async () => {
    db.get.mockResolvedValue(null)
    const res = await request(await buildApp()).post('/views/5')
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('rejects a non-numeric page id', async () => {
    const res = await request(await buildApp()).post('/views/abc')
    expect(res.status).toBe(400)
  })
})

describe('JL-152 favourites', () => {
  it('stars a visible page', async () => {
    db.get.mockResolvedValue({ id: 5 })
    const res = await request(await buildApp()).post('/favorites').send({ targetType: 'page', targetId: 5 })
    expect(res.status).toBe(201)
    expect(db.run.mock.calls.some((c) => /INSERT INTO favorites/.test(c[0]))).toBe(true)
  })

  it('404s starring a page the caller cannot see, rather than 403', async () => {
    db.get.mockResolvedValue(null)
    const res = await request(await buildApp()).post('/favorites').send({ targetType: 'page', targetId: 5 })
    // 403 would confirm the page exists.
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('404s starring a Space the caller cannot see', async () => {
    wireDb({ spaces: [{ id: 7, owner_email: OTHER }] })
    const res = await request(await buildApp()).post('/favorites').send({ targetType: 'space', targetId: 99 })
    expect(res.status).toBe(404)
  })

  it('rejects a target type outside the vocabulary', async () => {
    const res = await request(await buildApp()).post('/favorites').send({ targetType: 'issue', targetId: 5 })
    expect(res.status).toBe(400)
  })

  it('unstars without a visibility check, so a star can never be stranded', async () => {
    const res = await request(await buildApp()).delete('/favorites/page/5')
    expect(res.status).toBe(200)
    expect(db.run.mock.calls.some((c) => /DELETE FROM favorites/.test(c[0]))).toBe(true)
  })
})

/* ---------------------------------------------------------------- *
 * GET /api/wiki-home/list — the "Show more" target
 * ---------------------------------------------------------------- */
describe('JL-152 GET /api/wiki-home/list', () => {
  it('serves the recent list by default, filtered', async () => {
    const res = await request(await buildApp()).get('/list')
    expect(res.status).toBe(200)
    expect(res.body.kind).toBe('recent')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /recently_viewed rv/.test(q))
    expect(sql).toMatch(/deleted_at IS NULL/)
  })

  it('serves the starred list when asked, filtered', async () => {
    const res = await request(await buildApp()).get('/list?kind=starred')
    expect(res.body.kind).toBe('starred')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /JOIN favorites f/.test(q))
    expect(sql).toMatch(/deleted_at IS NULL/)
  })
})

/* ---------------------------------------------------------------- *
 * JL-130 — recently modified pages within a Space
 * ---------------------------------------------------------------- */
describe('JL-130 recently modified', () => {
  it('orders by when the page changed, not by when I looked at it', async () => {
    const res = await request(await buildApp()).get('/list?kind=modified')
    expect(res.status).toBe(200)
    expect(res.body.kind).toBe('modified')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /modified_at/.test(q))
    expect(sql).toMatch(/ORDER BY w\.updated_at DESC/)
  })

  it('needs no join — it is about the SPACE, not about me', async () => {
    await request(await buildApp()).get('/list?kind=modified')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /modified_at/.test(q))
    expect(sql).not.toMatch(/JOIN recently_viewed/)
    expect(sql).not.toMatch(/JOIN favorites/)
  })

  it('narrows to one Space when asked', async () => {
    await request(await buildApp()).get('/list?kind=modified&spaceId=7')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /modified_at/.test(q))
    expect(sql).toMatch(/w\.space_id = \?/)
  })

  it('returns nothing for a Space the caller cannot see', async () => {
    // Narrowing sits on top of the visibility filter, never instead of it.
    const res = await request(await buildApp()).get('/list?kind=modified&spaceId=999')
    expect(res.body.items).toEqual([])
    expect(db.all.mock.calls.some((c) => /modified_at/.test(c[0]))).toBe(false)
  })

  it('still filters by visibility', async () => {
    await request(await buildApp()).get('/list?kind=modified')
    const sql = db.all.mock.calls.map((c) => c[0]).find((q) => /modified_at/.test(q))
    expect(sql).toMatch(/deleted_at IS NULL/)
  })

  it('leaves recent and starred behaving as before', async () => {
    const recent = await request(await buildApp()).get('/list?kind=recent')
    expect(recent.body.kind).toBe('recent')
    const starred = await request(await buildApp()).get('/list?kind=starred')
    expect(starred.body.kind).toBe('starred')
  })
})
