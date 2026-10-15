// JL-202 — the Projects list and Project Settings must show the same lead.
//
// A project stored its lead twice (projects.lead, a name; lead_member_id, a
// member). The list showed the name, access rules used the member, creating a
// project linked the CREATOR as lead member whatever lead was chosen, and the
// Settings dropdown could not show a lead who is not a member. The lead member
// is now the source of truth.
//
// Runs the real projects routes against a PostgreSQL test schema (db.js
// delegates to it), so the SQL itself is exercised.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestDb, initTestSchema, seedTestMembers, cleanTestDb } from './setup.js'

const holder = vi.hoisted(() => ({ db: null, user: null }))

vi.mock('../db.js', () => {
  const toPg = (sql) => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`) }
  return {
    get: (sql, params) => holder.db.get(toPg(sql), params),
    all: (sql, params) => holder.db.all(toPg(sql), params),
    run: async (sql, params) => {
      // db.js appends RETURNING id to INSERTs; mirror that so lastID is set.
      const pgSql = /^\s*insert/i.test(sql) && !/returning/i.test(sql) ? `${toPg(sql)} RETURNING id` : toPg(sql)
      return holder.db.run(pgSql, params)
    },
  }
})
vi.mock('../routes/workspaceSettings.js', () => ({ getProjectCreationPolicy: async () => 'all_members' }))
vi.mock('../services/workflowSeed.js', () => ({ seedDefaultWorkflow: async () => {} }))

const { default: projectRoutes } = await import('../routes/projects.js')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { ...holder.user }; next() })
  app.use('/api/projects', projectRoutes)
  return app
}

// Seeded members: 1 owner (Admin), 2 admin, 3 Member User, 4 Viewer User.
const ADMIN = { id: 1, email: 'owner@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: true }
const MEMBER = { id: 3, email: 'member@test.com', memberId: 3, workspaceRole: 'Member', isOwner: false }

async function addProject(id, key, lead, leadMemberId) {
  await holder.db.run(
    'INSERT INTO projects (id, name, key, type, lead, lead_member_id) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, `Project ${key}`, key, 'Scrum', lead, leadMemberId],
  )
}

describe('project lead — one source of truth (JL-202)', () => {
  beforeEach(async () => {
    holder.db = createTestDb()
    await initTestSchema(holder.db)
    await seedTestMembers(holder.db)
    await holder.db.run('ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ')
    await holder.db.run('ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id INTEGER')
    // P1: lead is a name with no member (like ECM's "Alex Rivera").
    await addProject(1, 'NM', 'Alex Rivera', null)
    // P2: name and member disagree (like Sample Project): name says Owner, member is Member User.
    await addProject(2, 'MX', 'Owner User', 3)
    await holder.db.run("SELECT setval(pg_get_serial_sequence('projects', 'id'), 10)")
    holder.user = ADMIN
  })

  afterEach(async () => {
    await cleanTestDb(holder.db)
    await holder.db.close()
  })

  it('the list and the detail fetch show the same lead name for every project', async () => {
    const list = (await request(createApp()).get('/api/projects')).body
    for (const p of list) {
      const detail = (await request(createApp()).get(`/api/projects/${p.id}`)).body
      expect(detail.lead).toBe(p.lead)
    }
  })

  it('shows the lead member’s name when one is linked, and the stored name otherwise', async () => {
    const list = (await request(createApp()).get('/api/projects')).body
    const byKey = Object.fromEntries(list.map((p) => [p.key, p]))
    expect(byKey.MX.lead).toBe('Member User') // the member, not the stale stored name
    expect(byKey.NM.lead).toBe('Alex Rivera')
    expect(byKey.NM.lead_member_id).toBeNull()
  })

  it('links the CHOSEN lead when a project is created, not the creator', async () => {
    const res = await request(createApp()).post('/api/projects')
      .send({ name: 'New', key: 'NEW', type: 'Scrum', lead: 'Member User', leadMemberId: 3 })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ lead: 'Member User', lead_member_id: 3 })
    const row = await holder.db.get("SELECT lead, lead_member_id FROM projects WHERE key = 'NEW'")
    expect(row).toEqual({ lead: 'Member User', lead_member_id: 3 })
  })

  it('links the lead by name when an older caller sends only a name', async () => {
    const res = await request(createApp()).post('/api/projects')
      .send({ name: 'Named', key: 'NAM', type: 'Scrum', lead: 'viewer user' })
    expect(res.body).toMatchObject({ lead: 'Viewer User', lead_member_id: 4 })
  })

  it('keeps a lead untouched when Settings saves other fields', async () => {
    const res = await request(createApp()).put('/api/projects/1').send({ name: 'Renamed', type: 'Kanban' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ name: 'Renamed', lead: 'Alex Rivera', lead_member_id: null })
  })

  it('changes the lead by member id, updating name and member together', async () => {
    const res = await request(createApp()).put('/api/projects/1').send({ leadMemberId: 4 })
    expect(res.body).toMatchObject({ lead: 'Viewer User', lead_member_id: 4 })
    expect(await holder.db.get('SELECT lead, lead_member_id FROM projects WHERE id = 1'))
      .toEqual({ lead: 'Viewer User', lead_member_id: 4 })
  })

  it('refuses a lead member id that does not exist, changing nothing', async () => {
    const res = await request(createApp()).put('/api/projects/1').send({ leadMemberId: 999 })
    expect(res.status).toBe(400)
    expect(await holder.db.get('SELECT lead, lead_member_id FROM projects WHERE id = 1'))
      .toEqual({ lead: 'Alex Rivera', lead_member_id: null })
  })

  it('lists a project to its lead member, not to someone who merely shares the lead name', async () => {
    holder.user = MEMBER // "Member User" — lead member of MX, no membership rows
    const asLead = (await request(createApp()).get('/api/projects')).body.map((p) => p.key)
    expect(asLead).toEqual(['MX'])

    // A different member whose NAME matches MX's stale stored lead ("Owner User")
    // but who is not its lead member must not see it.
    await holder.db.run("UPDATE members SET name = 'Owner User' WHERE id = 4")
    holder.user = { id: 4, email: 'viewer@test.com', memberId: 4, workspaceRole: 'Viewer', isOwner: false }
    const asNamesake = (await request(createApp()).get('/api/projects')).body.map((p) => p.key)
    expect(asNamesake).not.toContain('MX')
  })
})
