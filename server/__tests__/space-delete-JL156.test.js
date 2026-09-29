// @vitest-environment node
/* ================================================================
   JL-156 — DELETE /api/spaces/:idOrKey, and the role the wiki-home
   sidebar sends so the client can gate the control that calls it.

   The assertion that carries the most weight here is the refusal.
   wiki_pages.space_id is ON DELETE SET NULL, so deleting a Space
   that still holds pages does not delete them — it ORPHANS them
   into the space-less pool, silently, where they stay readable and
   findable but belong to nothing. Nobody clicking "Delete space"
   means that, so the route must check first. A test that only
   proved "delete removes the row" would pass against exactly the
   implementation that loses people's pages.
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

const { audit } = vi.hoisted(() => ({ audit: { safeAppendAudit: vi.fn() } }))
vi.mock('../services/auditLog.js', () => audit)

const OWNER = 'owner@x.com'
const MEMBER = 'member@x.com'
const STRANGER = 'nobody@x.com'

const SPACE = {
  id: 7, key: 'ENG', name: 'Engineering', description: '',
  owner_email: OWNER, archived: false, created_by: OWNER,
}

/**
 * Wire the mocked db for one delete attempt.
 *
 * @param {object|null} space     the row loadSpace finds
 * @param {number}      livePages what the page COUNT returns
 * @param {string|null} role      the caller's space_members role, if any
 */
function wire({ space = SPACE, livePages = 0, role = null } = {}) {
  db.get.mockImplementation(async (sql) => {
    if (/FROM spaces WHERE/.test(sql)) return space
    if (/FROM space_members WHERE space_id/.test(sql)) return role ? { role } : undefined
    if (/COUNT\(\*\)::int AS pages FROM wiki_pages/.test(sql)) return { pages: livePages }
    return undefined
  })
  db.all.mockResolvedValue([])
  db.run.mockResolvedValue({ lastID: 1, changes: 1 })
}

async function buildApp(user) {
  const mod = await import('../routes/spaces.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/', mod.default)
  return app
}

const as = (email, workspaceRole = 'Member') => ({ id: 1, email, workspaceRole })

beforeEach(() => {
  vi.clearAllMocks()
  db.all.mockResolvedValue([])
})

/* ---------------------------------------------------------------- *
 * The refusal — the assertion this ticket exists for
 * ---------------------------------------------------------------- */
describe('JL-156 a Space holding pages is NOT deleted', () => {
  it('refuses with 409 rather than orphaning them', async () => {
    wire({ livePages: 3 })
    const res = await request(await buildApp(as(OWNER))).delete('/7')

    expect(res.status).toBe(409)
    // The count is in the message: "some pages" does not tell anyone what to
    // do next, and the number is what makes the refusal actionable.
    expect(res.body.error).toMatch(/3 pages/)
    expect(res.body.pageCount).toBe(3)
  })

  it('names archiving as the way to keep them', async () => {
    wire({ livePages: 1 })
    const res = await request(await buildApp(as(OWNER))).delete('/7')
    expect(res.body.error).toMatch(/archive/i)
    // Singular, because "1 pages" reads as a bug in the product.
    expect(res.body.error).toMatch(/1 page\b/)
  })

  it('runs no DELETE at all when it refuses', async () => {
    wire({ livePages: 2 })
    await request(await buildApp(as(OWNER))).delete('/7')
    const deletes = db.run.mock.calls.filter(([sql]) => /^\s*DELETE/i.test(sql))
    expect(deletes).toHaveLength(0)
  })

  it('counts only LIVE pages — trashed ones do not block', async () => {
    /*
     * A page already in the trash is deleted content. Blocking on it would
     * make a Space undeletable with no way forward, since the trash has no
     * purge. The FK sets its space_id to NULL and a later restore brings it
     * back space-less, which the schema supports by design.
     */
    wire({ livePages: 0 })
    const res = await request(await buildApp(as(OWNER))).delete('/7')
    expect(res.status).toBe(200)

    const [sql] = db.get.mock.calls.find(([q]) => /COUNT\(\*\)::int AS pages/.test(q))
    expect(sql).toMatch(/deleted_at IS NULL/)
  })
})

/* ---------------------------------------------------------------- *
 * Who may delete
 * ---------------------------------------------------------------- */
describe('JL-156 only a Space Admin may delete', () => {
  it('lets the owner delete an empty Space', async () => {
    wire()
    const res = await request(await buildApp(as(OWNER))).delete('/7')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, id: 7, key: 'ENG' })
    expect(db.run).toHaveBeenCalledWith('DELETE FROM spaces WHERE id = ?', [7])
  })

  it('lets a workspace Admin delete, matching the project rule', async () => {
    wire({ role: null })
    const res = await request(await buildApp(as(STRANGER, 'Admin'))).delete('/7')
    expect(res.status).toBe(200)
  })

  it('refuses a Space Member with 403', async () => {
    wire({ role: 'Member' })
    const res = await request(await buildApp(as(MEMBER))).delete('/7')
    expect(res.status).toBe(403)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('refuses a Space Viewer with 403', async () => {
    wire({ role: 'Viewer' })
    const res = await request(await buildApp(as(MEMBER))).delete('/7')
    expect(res.status).toBe(403)
  })

  it('404s a Space that does not exist', async () => {
    // `null`, not `undefined`: the default parameter above would swallow
    // undefined and hand back a real Space.
    wire({ space: null })
    const res = await request(await buildApp(as(OWNER))).delete('/999')
    expect(res.status).toBe(404)
  })

  it('addresses a Space by KEY as well as by id', async () => {
    wire()
    const res = await request(await buildApp(as(OWNER))).delete('/ENG')
    expect(res.status).toBe(200)
    const [sql] = db.get.mock.calls.find(([q]) => /FROM spaces WHERE/.test(q))
    expect(sql).toMatch(/LOWER\(key\) = LOWER\(\?\)/)
  })
})

/* ---------------------------------------------------------------- *
 * The audit trail — deleting a Space is administrative (JL-140)
 * ---------------------------------------------------------------- */
describe('JL-156 the deletion is audited', () => {
  it('records actor, action and the Space that went', async () => {
    wire()
    await request(await buildApp(as(OWNER))).delete('/7')
    expect(audit.safeAppendAudit).toHaveBeenCalledWith(expect.objectContaining({
      actor: OWNER,
      action: 'space.deleted',
      target: 'space:7',
      metadata: expect.objectContaining({ key: 'ENG', name: 'Engineering' }),
    }))
  })

  it('does not audit a refused attempt', async () => {
    wire({ role: 'Member' })
    await request(await buildApp(as(MEMBER))).delete('/7')
    expect(audit.safeAppendAudit).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------- *
 * The route does not swallow /:idOrKey/members/:email
 * ---------------------------------------------------------------- */
describe('JL-156 route ordering', () => {
  it('does not capture the member-removal path', async () => {
    /*
     * DELETE /:idOrKey and DELETE /:idOrKey/members/:email differ in depth so
     * Express keeps them apart — but this repo has been bitten three times by
     * a literal segment declared after a /:param (JL-99, JL-68), so it is
     * pinned rather than assumed.
     */
    wire({ role: 'Admin' })
    const res = await request(await buildApp(as(OWNER))).delete(`/7/members/${MEMBER}`)
    expect(res.status).toBe(200)
    expect(db.run).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM space_members/),
      expect.anything(),
    )
    // And emphatically NOT the Space itself.
    const spaceDeletes = db.run.mock.calls.filter(([sql]) => /DELETE FROM spaces/.test(sql))
    expect(spaceDeletes).toHaveLength(0)
  })
})
