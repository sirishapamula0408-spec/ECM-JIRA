// JL-195 — GET /api/members carries each user's projects and project roles,
// for the Users page "Projects & roles" column — but only for a system admin.
//
// Runs the real route against a real PostgreSQL test schema (db.js delegates to
// it), so a column alias PostgreSQL would lower-case (the JL-194 bug) fails
// here instead of in the browser.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestDb, initTestSchema, seedTestMembers, seedTestProject, cleanTestDb } from './setup.js'

const holder = vi.hoisted(() => ({ db: null, user: null }))

vi.mock('../db.js', () => {
  const toPg = (sql) => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`) }
  return {
    get: (sql, params) => holder.db.get(toPg(sql), params),
    all: (sql, params) => holder.db.all(toPg(sql), params),
    run: (sql, params) => holder.db.run(toPg(sql), params),
    tableExists: async () => true,
  }
})
// Invite-delivery status is not what this suite is about.
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn(),
  buildInviteEmail: vi.fn(),
  getLatestEmailStatuses: async () => new Map(),
}))

const { default: memberRoutes } = await import('../routes/members.js')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { ...holder.user }; next() })
  app.use('/api/members', memberRoutes)
  return app
}

// Seeded members: 1 owner (Admin, is_owner), 2 admin, 3 member, 4 viewer.
// seedTestProject: project 1 'TP' — owner + admin are Admin, member is Member,
// viewer is Viewer.
const asUser = (memberId, workspaceRole, isOwner = false) => ({
  id: memberId, email: `${memberId}@test.com`, memberId, workspaceRole, isOwner,
})

const rolesOf = (items, email) =>
  items.find((m) => m.email === email)?.projectRoles?.map((pr) => `${pr.projectKey}:${pr.role}`)

describe('GET /api/members — projectRoles (JL-195)', () => {
  beforeEach(async () => {
    holder.db = createTestDb()
    await initTestSchema(holder.db)
    await seedTestMembers(holder.db)
    await seedTestProject(holder.db)
    // A second project led by the Viewer, with no project_members row for them.
    await holder.db.run(
      "INSERT INTO projects (name, key, type, lead, lead_member_id) VALUES ('Led Project', 'LP', 'Scrum', 'Viewer User', 4)",
    )
  })

  afterEach(async () => {
    await cleanTestDb(holder.db)
    await holder.db.close()
  })

  it('gives a system admin every user’s projects and roles (paginated list)', async () => {
    holder.user = asUser(2, 'Admin')
    const res = await request(createApp()).get('/api/members?limit=50')

    expect(res.status).toBe(200)
    expect(rolesOf(res.body.items, 'owner@test.com')).toEqual(['TP:Admin'])
    expect(rolesOf(res.body.items, 'member@test.com')).toEqual(['TP:Member'])
    // The project lead without a membership row is reported as Lead, beside
    // the Viewer's seeded TP membership (sorted by project name).
    expect(rolesOf(res.body.items, 'viewer@test.com')).toEqual(['LP:Lead', 'TP:Viewer'])
    expect(res.body.items[0].projectRoles[0]).toEqual({
      projectId: 1, projectKey: 'TP', projectName: 'Test Project', role: 'Admin',
    })
  })

  it('gives the workspace Owner the same view, on the legacy (unpaginated) list too', async () => {
    holder.user = asUser(1, 'Admin', true)
    const res = await request(createApp()).get('/api/members')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(rolesOf(res.body, 'member@test.com')).toEqual(['TP:Member'])
  })

  it('returns an empty list for a user in no project', async () => {
    await holder.db.run("INSERT INTO members (name, email, role, status) VALUES ('New', 'new@test.com', 'Member', 'Active')")
    holder.user = asUser(2, 'Admin')
    const res = await request(createApp()).get('/api/members?limit=50')

    expect(rolesOf(res.body.items, 'new@test.com')).toEqual([])
  })

  it.each([
    ['a workspace Member (even a project Admin)', asUser(3, 'Member')],
    ['a workspace Viewer', asUser(4, 'Viewer')],
  ])('does not reveal project memberships to %s', async (_label, user) => {
    holder.user = user
    const paged = await request(createApp()).get('/api/members?limit=50')
    const legacy = await request(createApp()).get('/api/members')

    expect(paged.status).toBe(200)
    for (const m of [...paged.body.items, ...legacy.body]) expect(m).not.toHaveProperty('projectRoles')
  })
})
