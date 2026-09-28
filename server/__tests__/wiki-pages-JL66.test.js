// @vitest-environment node
/* ================================================================
   JL-66 — Page Management & Hierarchy.

   Pages gained Spaces, a tree, a trash and a draft state. Built as an
   EXTENSION of the existing wiki router rather than a second one:
   pages are one table with one versioning story, one search and one
   set of issue links, and a parallel "space pages" API would have
   duplicated all of it and then drifted — the failure this repo has
   already paid for twice (two sanitisers in JL-359, two member
   directories in JL-425).

   The behaviours worth pinning down are the ones that lose data when
   they are wrong: soft delete, child promotion, and draft visibility.
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
})

/* ---------------------------------------------------------------- *
 * JL-88 — create a page in a Space
 * ---------------------------------------------------------------- */
describe('JL-88 POST /api/wiki', () => {
  it('accepts a spaceId where it previously demanded a projectId', async () => {
    db.get.mockResolvedValue(page())
    const res = await request(await buildApp()).post('/').send({ spaceId: 7, title: 'Runbook' })
    expect(res.status).toBe(201)
    const insert = db.run.mock.calls[0]
    expect(insert[0]).toMatch(/INSERT INTO wiki_pages .*space_id/)
    expect(insert[1].slice(0, 2)).toEqual([null, 7])
  })

  it('still accepts a projectId — pages written before Spaces keep working', async () => {
    db.get.mockResolvedValue(page({ project_id: 3, space_id: null }))
    const res = await request(await buildApp()).post('/').send({ projectId: 3, title: 'Old page' })
    expect(res.status).toBe(201)
    expect(db.run.mock.calls[0][1].slice(0, 2)).toEqual([3, null])
  })

  it('rejects a page belonging to neither', async () => {
    const res = await request(await buildApp()).post('/').send({ title: 'Nowhere' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/projectId or spaceId/)
  })

  it('defaults to published, so nothing written before drafts existed becomes invisible', async () => {
    db.get.mockResolvedValue(page())
    await request(await buildApp()).post('/').send({ spaceId: 7, title: 'X' })
    expect(db.run.mock.calls[0][1]).toContain('published')
  })

  it('creates a draft when asked', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    await request(await buildApp()).post('/').send({ spaceId: 7, title: 'X', status: 'draft' })
    expect(db.run.mock.calls[0][1]).toContain('draft')
  })

  it('rejects a status outside the vocabulary', async () => {
    const res = await request(await buildApp()).post('/').send({ spaceId: 7, title: 'X', status: 'archived' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/draft, published/)
  })
})

/* ---------------------------------------------------------------- *
 * JL-95 — draft visibility
 * ---------------------------------------------------------------- */
describe('JL-95 drafts belong to their author until published', () => {
  const rows = [page({ id: 1, title: 'Published' }), page({ id: 2, title: 'My draft', status: 'draft' })]

  it('shows the author their own draft', async () => {
    db.all.mockResolvedValue(rows)
    const res = await request(await buildApp(AUTHOR)).get('/?spaceId=7')
    expect(res.body.map((r) => r.id)).toEqual([1, 2])
  })

  it('hides it from everyone else', async () => {
    db.all.mockResolvedValue(rows)
    const res = await request(await buildApp(OTHER)).get('/?spaceId=7')
    expect(res.body.map((r) => r.id)).toEqual([1])
  })
})

/* ---------------------------------------------------------------- *
 * JL-89 / list scoping
 * ---------------------------------------------------------------- */
describe('JL-89 listing', () => {
  it('reads live pages only — a soft-deleted row is still physically present', async () => {
    await request(await buildApp()).get('/?spaceId=7')
    expect(db.all.mock.calls[0][0]).toMatch(/deleted_at IS NULL/)
  })

  it('carries the metadata the UI displays, without SELECT *', async () => {
    await request(await buildApp()).get('/?spaceId=7')
    const sql = db.all.mock.calls[0][0]
    expect(sql).not.toMatch(/SELECT \*/)
    for (const col of ['space_id', 'status', 'archived', 'created_by', 'updated_by', 'updated_at']) {
      expect(sql, col).toContain(col)
    }
  })

  it('requires a scope rather than returning every page in the install', async () => {
    const res = await request(await buildApp()).get('/')
    expect(res.status).toBe(400)
  })
})

/* ---------------------------------------------------------------- *
 * JL-90 / JL-91 — hierarchy and the tree
 * ---------------------------------------------------------------- */
describe('JL-91 GET /api/wiki/tree', () => {
  it('nests children under their parent', async () => {
    db.all.mockResolvedValue([
      page({ id: 1, title: 'Root' }),
      page({ id: 2, title: 'Child', parent_id: 1 }),
      page({ id: 3, title: 'Grandchild', parent_id: 2 }),
    ])
    const res = await request(await buildApp()).get('/tree?spaceId=7')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].children[0].id).toBe(2)
    expect(res.body[0].children[0].children[0].id).toBe(3)
  })

  it('surfaces an orphan at the root instead of dropping it', async () => {
    // The parent is deleted, in another Space, or someone else's draft.
    // Hiding the child because its parent is invisible loses it entirely.
    db.all.mockResolvedValue([page({ id: 5, title: 'Orphan', parent_id: 999 })])
    const res = await request(await buildApp()).get('/tree?spaceId=7')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe(5)
  })

  it('builds in one pass — no query per node', async () => {
    db.all.mockResolvedValue([page({ id: 1 }), page({ id: 2, parent_id: 1 }), page({ id: 3, parent_id: 1 })])
    await request(await buildApp()).get('/tree?spaceId=7')
    expect(db.all).toHaveBeenCalledTimes(1)
  })

  it('excludes deleted pages and other people’s drafts', async () => {
    db.all.mockResolvedValue([page({ id: 1 }), page({ id: 2, status: 'draft', created_by: OTHER })])
    const res = await request(await buildApp(AUTHOR)).get('/tree?spaceId=7')
    expect(res.body.map((r) => r.id)).toEqual([1])
    expect(db.all.mock.calls[0][0]).toMatch(/deleted_at IS NULL/)
  })
})

/* ---------------------------------------------------------------- *
 * JL-93 — soft delete, children promoted
 * ---------------------------------------------------------------- */
describe('JL-93 DELETE /api/wiki/:id', () => {
  it('marks the page deleted instead of removing the row', async () => {
    db.get.mockResolvedValue(page())
    const res = await request(await buildApp()).delete('/1')
    expect(res.status).toBe(200)
    expect(res.body.softDeleted).toBe(true)
    // A hard delete would cascade wiki_page_versions and destroy the history.
    for (const call of db.run.mock.calls) {
      expect(call[0]).not.toMatch(/^DELETE FROM wiki_pages/)
    }
  })

  it('promotes children to the root rather than cascading the subtree', async () => {
    db.get.mockResolvedValue(page())
    await request(await buildApp()).delete('/1')
    expect(db.run.mock.calls[0][0]).toMatch(/SET parent_id = NULL WHERE parent_id = \?/)
    expect(db.run.mock.calls[0][1]).toEqual([1])
  })

  it('records who deleted it', async () => {
    db.get.mockResolvedValue(page())
    await request(await buildApp('remover@x.com')).delete('/1')
    expect(db.run.mock.calls[1][1]).toContain('remover@x.com')
  })

  it('404s a page that does not exist instead of reporting success', async () => {
    db.get.mockResolvedValue(undefined)
    const res = await request(await buildApp()).delete('/999')
    expect(res.status).toBe(404)
  })
})

/* ---------------------------------------------------------------- *
 * JL-94 — trash and restore
 * ---------------------------------------------------------------- */
describe('JL-94 trash', () => {
  it('lists only deleted pages, newest first', async () => {
    await request(await buildApp()).get('/trash?spaceId=7')
    const sql = db.all.mock.calls[0][0]
    expect(sql).toMatch(/deleted_at IS NOT NULL/)
    expect(sql).toMatch(/ORDER BY deleted_at DESC/)
  })

  it('restores a deleted page', async () => {
    db.get
      .mockResolvedValueOnce(page({ deleted_at: '2026-09-02T00:00:00Z', deleted_by: OTHER }))
      .mockResolvedValue(page())
    const res = await request(await buildApp()).post('/1/restore')
    expect(res.status).toBe(200)
    expect(db.run.mock.calls[0][0]).toMatch(/deleted_at = NULL/)
  })

  it('refuses to restore a page that is not in the trash', async () => {
    db.get.mockResolvedValue(page())
    const res = await request(await buildApp()).post('/1/restore')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/not in the trash/)
  })

  it('restores to the root when the old parent is itself deleted', async () => {
    // Re-parenting under a deleted page would put the restored page straight
    // back out of sight.
    db.get
      .mockResolvedValueOnce(page({ parent_id: 42, deleted_at: '2026-09-02T00:00:00Z' }))
      .mockResolvedValueOnce(undefined)   // the old parent is not live
      .mockResolvedValue(page())
    await request(await buildApp()).post('/1/restore')
    expect(db.run.mock.calls[0][1][0]).toBeNull()
  })

  it('keeps the old parent when it is still live', async () => {
    db.get
      .mockResolvedValueOnce(page({ parent_id: 42, deleted_at: '2026-09-02T00:00:00Z' }))
      .mockResolvedValueOnce({ id: 42 })  // the old parent survives
      .mockResolvedValue(page())
    await request(await buildApp()).post('/1/restore')
    expect(db.run.mock.calls[0][1][0]).toBe(42)
  })

  it('404s an unknown page', async () => {
    db.get.mockResolvedValue(undefined)
    const res = await request(await buildApp()).post('/999/restore')
    expect(res.status).toBe(404)
  })
})

/* ---------------------------------------------------------------- *
 * JL-92 — moving a page
 * ---------------------------------------------------------------- */
describe('JL-92 PATCH /api/wiki/:id — move', () => {
  it('re-parents a page', async () => {
    db.get
      .mockResolvedValueOnce(page())        // existing
      .mockResolvedValueOnce({ parent_id: null })  // wouldCycle walks up from 5
      .mockResolvedValue(page({ parent_id: 5 }))
    const res = await request(await buildApp()).patch('/1').send({ parentId: 5 })
    expect(res.status).toBe(200)
    const update = db.run.mock.calls.find((c) => /UPDATE wiki_pages SET/.test(c[0]))
    expect(update[0]).toMatch(/parent_id = \?/)
  })

  it('refuses to make a page its own parent', async () => {
    db.get.mockResolvedValueOnce(page())
    const res = await request(await buildApp()).patch('/1').send({ parentId: 1 })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/its own ancestor/)
  })

  it('refuses a move that would make a page its own ancestor', async () => {
    // Moving 1 under 2, where 2's parent is already 1. A page made its own
    // ancestor vanishes from every tree at once and nothing else reports it.
    db.get
      .mockResolvedValueOnce(page({ id: 1 }))
      .mockResolvedValueOnce({ parent_id: 1 })
    const res = await request(await buildApp()).patch('/1').send({ parentId: 2 })
    expect(res.status).toBe(409)
  })

  it('writes nothing when the move is refused', async () => {
    db.get.mockResolvedValueOnce(page()).mockResolvedValueOnce({ parent_id: 1 })
    await request(await buildApp()).patch('/1').send({ parentId: 2 })
    expect(db.run.mock.calls.filter((c) => /UPDATE wiki_pages SET/.test(c[0]))).toHaveLength(0)
  })

  it('allows a move to the root', async () => {
    db.get.mockResolvedValueOnce(page({ parent_id: 3 })).mockResolvedValue(page())
    const res = await request(await buildApp()).patch('/1').send({ parentId: null })
    expect(res.status).toBe(200)
  })

  it('detaches from its parent when moved to another Space', async () => {
    // A parent left behind in the old Space would root the page somewhere it
    // no longer belongs, and it would be invisible in both trees.
    db.get.mockResolvedValueOnce(page()).mockResolvedValue(page({ space_id: 9 }))
    await request(await buildApp()).patch('/1').send({ spaceId: 9 })
    const update = db.run.mock.calls.find((c) => /UPDATE wiki_pages SET/.test(c[0]))
    expect(update[0]).toMatch(/space_id = \?/)
    expect(update[0]).toMatch(/parent_id = \?/)
  })

  it('keeps an explicit parent when one is given alongside the Space', async () => {
    db.get
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce({ parent_id: null })
      .mockResolvedValue(page({ space_id: 9, parent_id: 4 }))
    await request(await buildApp()).patch('/1').send({ spaceId: 9, parentId: 4 })
    const update = db.run.mock.calls.find((c) => /UPDATE wiki_pages SET/.test(c[0]))
    expect(update[1]).toContain(4)
  })
})

/* ---------------------------------------------------------------- *
 * JL-95 — publishing
 * ---------------------------------------------------------------- */
describe('JL-95 publish / unpublish', () => {
  it('publishes a draft', async () => {
    db.get.mockResolvedValueOnce(page({ status: 'draft' })).mockResolvedValue(page())
    const res = await request(await buildApp()).patch('/1').send({ status: 'published' })
    expect(res.status).toBe(200)
    const update = db.run.mock.calls.find((c) => /UPDATE wiki_pages SET/.test(c[0]))
    expect(update[0]).toMatch(/status = \?/)
    expect(update[1]).toContain('published')
  })

  it('rejects an unknown status', async () => {
    db.get.mockResolvedValueOnce(page())
    const res = await request(await buildApp()).patch('/1').send({ status: 'deleted' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/draft, published/)
  })
})

/* ---------------------------------------------------------------- *
 * JL-93/95 — the detail fetch enforces what the listings enforce
 *
 * The list, tree and trash endpoints all filter deleted rows and other
 * people's drafts. GET /:id did not, and a wiki page id is a small
 * integer — so the filtering the other three did was decorative: anyone
 * could read an unpublished draft, or a page already in the trash, by
 * asking for it directly.
 * ---------------------------------------------------------------- */
describe('JL-95 GET /api/wiki/:id honours draft and trash visibility', () => {
  it('serves the author their own draft', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp(AUTHOR)).get('/1')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(1)
  })

  it('404s someone else asking for that draft by id', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp(OTHER)).get('/1')
    expect(res.status).toBe(404)
    // 404 and not 403: a 403 would confirm the draft exists.
    expect(res.body.error).toMatch(/not found/i)
    expect(res.body.content).toBeUndefined()
  })

  it('404s a soft-deleted page rather than serving it as though it were live', async () => {
    db.get.mockResolvedValue(page({ deleted_at: '2026-09-20T00:00:00Z', deleted_by: AUTHOR }))
    const res = await request(await buildApp(AUTHOR)).get('/1')
    expect(res.status).toBe(404)
  })

  it('leaves deleted children out of the child list', async () => {
    db.get.mockResolvedValue(page())
    await request(await buildApp(AUTHOR)).get('/1')
    const childQuery = db.all.mock.calls.find((c) => /WHERE parent_id = ?/.test(c[0]))
    expect(childQuery).toBeDefined()
    expect(childQuery[0]).toMatch(/deleted_at IS NULL/)
  })

  it('keeps serving an ordinary published page', async () => {
    db.get.mockResolvedValue(page())
    const res = await request(await buildApp(OTHER)).get('/1')
    expect(res.status).toBe(200)
  })
})

describe('JL-94 trash does not expose another author’s deleted draft', () => {
  const deletedDraft = page({ id: 2, status: 'draft', deleted_at: '2026-09-20T00:00:00Z' })

  it('shows the author their own deleted draft', async () => {
    db.all.mockResolvedValue([deletedDraft])
    const res = await request(await buildApp(AUTHOR)).get('/trash?spaceId=7')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('hides it from everyone else — deleting a draft does not publish it', async () => {
    db.all.mockResolvedValue([deletedDraft])
    const res = await request(await buildApp(OTHER)).get('/trash?spaceId=7')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(0)
  })

  it('still lists a deleted published page for everyone', async () => {
    db.all.mockResolvedValue([page({ id: 3, deleted_at: '2026-09-20T00:00:00Z' })])
    const res = await request(await buildApp(OTHER)).get('/trash?spaceId=7')
    expect(res.body).toHaveLength(1)
  })
})

/* ---------------------------------------------------------------- *
 * JL-103 — a save built on a superseded version is refused
 *
 * Without this, two people editing the same page produces a silent
 * last-write-wins: the second save overwrites the first with content
 * that never contained it, and nothing anywhere reports a loss.
 * ---------------------------------------------------------------- */
describe('JL-103 concurrent edit detection', () => {
  /** Answer the MAX(version_number) probe with `v`, everything else normally. */
  function atVersion(v, page = pageAt()) {
    db.get.mockImplementation(async (sql) => {
      if (/MAX\(version_number\)/.test(sql)) return { v, max_ver: v }
      if (/FROM wiki_page_versions/.test(sql)) return { edited_by: OTHER, created_at: '2026-09-28T00:00:00Z' }
      return page
    })
  }
  const pageAt = () => page()

  it('saves when the editor is on the current version', async () => {
    atVersion(4)
    const res = await request(await buildApp())
      .patch('/1').send({ content: 'new', expectedVersion: 4 })
    expect(res.status).toBe(200)
  })

  it('409s when someone else saved in the meantime', async () => {
    atVersion(5)
    const res = await request(await buildApp())
      .patch('/1').send({ content: 'mine', expectedVersion: 4 })
    expect(res.status).toBe(409)
    expect(res.body.currentVersion).toBe(5)
    expect(res.body.yourVersion).toBe(4)
  })

  it('names who changed it, so the message is actionable', async () => {
    atVersion(5)
    const res = await request(await buildApp())
      .patch('/1').send({ content: 'mine', expectedVersion: 4 })
    expect(res.body.editedBy).toBe(OTHER)
    expect(res.body.error).toMatch(/changed by someone else/i)
  })

  it('writes NOTHING when it refuses — the check runs before the update', async () => {
    atVersion(5)
    await request(await buildApp()).patch('/1').send({ content: 'mine', expectedVersion: 4 })
    expect(db.run).not.toHaveBeenCalled()
  })

  it('leaves callers that send no expectedVersion exactly as they were', async () => {
    // A move from the page tree has no base revision to compare against.
    atVersion(5)
    const res = await request(await buildApp()).patch('/1').send({ content: 'mine' })
    expect(res.status).toBe(200)
  })

  it('does not gate a pure move, which carries no content', async () => {
    atVersion(5)
    const res = await request(await buildApp())
      .patch('/1').send({ parentId: 9, expectedVersion: 1 })
    expect(res.status).toBe(200)
  })

  it('reports the current version on GET so the editor has a base', async () => {
    atVersion(7)
    db.all.mockResolvedValue([])
    const res = await request(await buildApp()).get('/1')
    expect(res.status).toBe(200)
    expect(res.body.version).toBe(7)
  })
})
