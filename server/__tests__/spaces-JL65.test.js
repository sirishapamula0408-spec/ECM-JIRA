// @vitest-environment node
/* ================================================================
   JL-65 / JL-79 / JL-87 / JL-139 — Confluence Lite Spaces.

   A Space is the unit documentation is organised by, and it is
   deliberately NOT a project: documentation outlives and crosses
   projects, so wiki_pages.space_id is nullable alongside the existing
   project_id and no existing page had to move.

   The part worth pinning down hardest is the authorisation model.
   Space membership is a SECOND axis alongside workspace and project
   RBAC, and the resolution order is defined in ONE place —
   resolveSpaceRole — rather than at each call site. Scattering that
   decision is exactly how JL-457 ended up with four sites each
   colouring a status differently.
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

const { normalizeSpaceKey, resolveSpaceRole, spaceRoleAtLeast, SPACE_ROLES } =
  await import('../routes/spaces.js')

const SPACE = {
  id: 1, key: 'ENG', name: 'Engineering', description: '',
  owner_email: 'owner@x.com', archived: false, created_by: 'owner@x.com',
}

async function buildApp(user = { id: 1, email: 'owner@x.com', workspaceRole: 'Member' }) {
  const mod = await import('../routes/spaces.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/', mod.default)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  db.all.mockResolvedValue([])
})

/* ---------------------------------------------------------------- */
describe('JL-82 normalizeSpaceKey', () => {
  it('uppercases, so "eng" and "ENG" cannot become two Spaces', () => {
    expect(normalizeSpaceKey('eng')).toBe('ENG')
    expect(normalizeSpaceKey('  Eng  ')).toBe('ENG')
  })

  it('accepts 2-10 characters starting with a letter', () => {
    expect(normalizeSpaceKey('AB')).toBe('AB')
    expect(normalizeSpaceKey('RUNBOOK123')).toBe('RUNBOOK123')
  })

  it('rejects a single character, a leading digit, and anything too long', () => {
    for (const bad of ['A', '1ENG', 'TOOLONGKEY1', 'EN-G', 'EN G', '', null, undefined]) {
      expect(normalizeSpaceKey(bad), String(bad)).toBeNull()
    }
  })
})

describe('JL-87 spaceRoleAtLeast', () => {
  it('ranks Admin > Member > Viewer', () => {
    expect(spaceRoleAtLeast('Admin', 'Member')).toBe(true)
    expect(spaceRoleAtLeast('Member', 'Admin')).toBe(false)
    expect(spaceRoleAtLeast('Viewer', 'Member')).toBe(false)
    expect(spaceRoleAtLeast('Member', 'Member')).toBe(true)
  })

  it('treats an unknown role as below everything', () => {
    expect(spaceRoleAtLeast('Nonsense', 'Viewer')).toBe(false)
    expect(spaceRoleAtLeast(null, 'Viewer')).toBe(false)
  })

  it('offers exactly three roles, matching the project vocabulary', () => {
    expect(SPACE_ROLES).toEqual(['Admin', 'Member', 'Viewer'])
  })
})

/* ---------------------------------------------------------------- */
describe('JL-139 resolveSpaceRole — the one place the axes combine', () => {
  it('lets a workspace Admin administer any Space, mirroring the project rule', async () => {
    // middleware/authorize.js already lets a workspace Admin bypass
    // project-level checks. One mental model across the product beats a
    // second, subtly different one for Spaces.
    const role = await resolveSpaceRole(SPACE, { email: 'someone@x.com', workspaceRole: 'Admin' })
    expect(role).toBe('Admin')
    expect(db.get).not.toHaveBeenCalled()
  })

  it('lets a workspace Owner do the same', async () => {
    expect(await resolveSpaceRole(SPACE, { email: 'o@x.com', isOwner: true })).toBe('Admin')
  })

  it('makes the Space owner an Admin without needing a membership row', async () => {
    const role = await resolveSpaceRole(SPACE, { email: 'OWNER@x.com', workspaceRole: 'Member' })
    expect(role).toBe('Admin')
  })

  it('reads the membership row for everyone else', async () => {
    db.get.mockResolvedValue({ role: 'Member' })
    expect(await resolveSpaceRole(SPACE, { email: 'dev@x.com', workspaceRole: 'Member' })).toBe('Member')
  })

  it('treats a member with no row as a Viewer', async () => {
    db.get.mockResolvedValue(undefined)
    expect(await resolveSpaceRole(SPACE, { email: 'dev@x.com', workspaceRole: 'Member' })).toBe('Viewer')
  })

  it('returns null with no identity at all', async () => {
    expect(await resolveSpaceRole(SPACE, {})).toBeNull()
    expect(await resolveSpaceRole(SPACE, null)).toBeNull()
  })

  it('returns null for a Space that does not exist', async () => {
    expect(await resolveSpaceRole(null, { email: 'a@x.com' })).toBeNull()
  })

  it('ignores a junk role stored in the database', async () => {
    db.get.mockResolvedValue({ role: 'Superuser' })
    expect(await resolveSpaceRole(SPACE, { email: 'dev@x.com' })).toBe('Viewer')
  })
})

/* ---------------------------------------------------------------- */
describe('JL-82 POST /api/spaces', () => {
  it('creates a Space and seeds the creator as an Admin member', async () => {
    db.get
      .mockResolvedValueOnce(undefined)              // no key clash
      .mockResolvedValue({ ...SPACE, id: 7 })        // read back
    db.run.mockResolvedValue({ lastID: 7, changes: 1 })

    const res = await request(await buildApp()).post('/').send({ key: 'eng', name: 'Engineering' })

    expect(res.status).toBe(201)
    expect(res.body.key).toBe('ENG')
    // Ownership is one column and is reassignable (JL-83); membership is what
    // the access check actually reads, so it must not depend on ownership.
    const memberInsert = db.run.mock.calls.find((c) => /INSERT INTO space_members/.test(c[0]))
    expect(memberInsert).toBeTruthy()
    expect(memberInsert[1]).toContain('Admin')
  })

  it('rejects a duplicate key with 409, comparing case-insensitively', async () => {
    db.get.mockResolvedValueOnce({ id: 1 })
    const res = await request(await buildApp()).post('/').send({ key: 'ENG', name: 'Dup' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already exists/i)
  })

  it('rejects a malformed key with a message that says the rule', async () => {
    const res = await request(await buildApp()).post('/').send({ key: '1', name: 'Bad' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/2-10 characters/)
  })

  it('requires a name', async () => {
    const res = await request(await buildApp()).post('/').send({ key: 'ENG' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name is required/)
  })
})

/* ---------------------------------------------------------------- */
describe('JL-83 / JL-84 PATCH /api/spaces/:idOrKey', () => {
  const asMember = () => buildApp({ id: 2, email: 'dev@x.com', workspaceRole: 'Member' })

  it('refuses a Member changing settings', async () => {
    db.get
      .mockResolvedValueOnce(SPACE)          // loadSpace
      .mockResolvedValueOnce({ role: 'Member' })
    const res = await request(await asMember()).patch('/ENG').send({ name: 'New' })
    expect(res.status).toBe(403)
  })

  it('404s a Space the caller cannot see, rather than 403', async () => {
    // Telling someone a Space exists but is closed to them is itself a
    // disclosure, so absence and denial look the same from outside.
    db.get.mockResolvedValueOnce(undefined)
    const res = await request(await asMember()).patch('/SECRET').send({ name: 'x' })
    expect(res.status).toBe(404)
  })

  it('archives a Space', async () => {
    db.get.mockResolvedValueOnce(SPACE).mockResolvedValue({ ...SPACE, archived: true })
    const res = await request(await buildApp()).patch('/ENG').send({ archived: true })
    expect(res.status).toBe(200)
    expect(db.run.mock.calls[0][0]).toMatch(/archived = \?/)
  })

  it('refuses to blank the owner — a Space with no owner cannot be reassigned', async () => {
    db.get.mockResolvedValueOnce(SPACE)
    const res = await request(await buildApp()).patch('/ENG').send({ ownerEmail: '  ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/ownerEmail cannot be empty/)
  })

  it('makes a newly assigned owner an Admin of what they now own', async () => {
    db.get.mockResolvedValueOnce(SPACE).mockResolvedValue(SPACE)
    await request(await buildApp()).patch('/ENG').send({ ownerEmail: 'new@x.com' })
    const upsert = db.run.mock.calls.find((c) => /INSERT INTO space_members/.test(c[0]))
    expect(upsert).toBeTruthy()
    expect(upsert[0]).toMatch(/DO UPDATE SET role = 'Admin'/)
  })

  it('rejects an update with no supported fields', async () => {
    db.get.mockResolvedValueOnce(SPACE)
    const res = await request(await buildApp()).patch('/ENG').send({ nonsense: 1 })
    expect(res.status).toBe(400)
  })
})

/* ---------------------------------------------------------------- */
describe('JL-86 members', () => {
  it('rejects a role outside the vocabulary', async () => {
    db.get.mockResolvedValueOnce(SPACE)
    const res = await request(await buildApp()).post('/ENG/members').send({ email: 'a@x.com', role: 'God' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Admin, Member, Viewer/)
  })

  it('upserts, so adding an existing member changes their role instead of failing', async () => {
    db.get.mockResolvedValueOnce(SPACE)
    await request(await buildApp()).post('/ENG/members').send({ email: 'a@x.com', role: 'Admin' })
    const call = db.run.mock.calls.find((c) => /INSERT INTO space_members/.test(c[0]))
    expect(call[0]).toMatch(/DO UPDATE SET role = EXCLUDED.role/)
  })

  it('refuses to remove the owner before ownership is reassigned', async () => {
    db.get.mockResolvedValueOnce(SPACE)
    const res = await request(await buildApp()).delete('/ENG/members/owner@x.com')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/Reassign ownership/)
  })

  it('removes an ordinary member', async () => {
    db.get.mockResolvedValueOnce(SPACE)
    const res = await request(await buildApp()).delete('/ENG/members/dev@x.com')
    expect(res.status).toBe(200)
    expect(db.run.mock.calls[0][0]).toMatch(/DELETE FROM space_members/)
  })
})

/* ---------------------------------------------------------------- */
describe('JL-85 GET /api/spaces', () => {
  it('hides archived Spaces unless asked', async () => {
    db.all.mockResolvedValue([])
    await request(await buildApp()).get('/')
    expect(db.all.mock.calls[0][0]).toMatch(/WHERE archived = FALSE/)
  })

  it('includes them with ?archived=true', async () => {
    db.all.mockResolvedValue([])
    await request(await buildApp()).get('/?archived=true')
    expect(db.all.mock.calls[0][0]).not.toMatch(/WHERE archived = FALSE/)
  })

  it('decorates each row with the caller’s own role and a live page count', async () => {
    db.all.mockResolvedValue([SPACE])
    db.get.mockResolvedValue({ pages: 4 })
    const res = await request(await buildApp({ email: 'owner@x.com', workspaceRole: 'Member' })).get('/')
    expect(res.body[0].myRole).toBe('Admin')
    expect(res.body[0].pageCount).toBe(4)
    // Deleted pages must not inflate the count — Trash is recoverable, not live.
    const countSql = db.get.mock.calls.find((c) => /COUNT\(\*\)/.test(c[0]))[0]
    expect(countSql).toMatch(/deleted_at IS NULL/)
  })
})
