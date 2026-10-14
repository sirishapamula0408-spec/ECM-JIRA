// JL-194 — GET /api/auth/me must return projectRoles in camelCase.
//
// The handler aliased its columns without quotes (`AS projectId`). PostgreSQL
// folds an unquoted alias to lower case, so the response carried `projectid`,
// and usePermissions (which reads `pr.projectId`) never found a project role:
// a project Admin got read-only Project Settings with no way to add people.
//
// auth-me.test.js did not catch it because it re-states the query with QUOTED
// aliases instead of running the handler. A mocked db cannot catch it either —
// the lower-casing happens inside PostgreSQL. So this suite runs the real route
// with db.js delegating to a real test schema.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createTestDb, initTestSchema, seedTestMembers, seedTestProject, cleanTestDb } from './setup.js'

const holder = vi.hoisted(() => ({ db: null }))

// db.js uses SQLite-style `?` placeholders; the test pool speaks `$n`.
vi.mock('../db.js', () => {
  const toPg = (sql) => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`) }
  return {
    get: (sql, params) => holder.db.get(toPg(sql), params),
    all: (sql, params) => holder.db.all(toPg(sql), params),
    run: (sql, params) => holder.db.run(toPg(sql), params),
  }
})
vi.mock('../routes/workspaceSettings.js', () => ({ getProjectCreationPolicy: async () => 'all_members' }))

const { JWT_SECRET } = await import('../config.js')
const { default: authRoutes } = await import('../routes/auth.js')

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  return app
}

const tokenFor = (id, email) => jwt.sign({ sub: id, email }, JWT_SECRET, { expiresIn: '5m' })

describe('GET /api/auth/me — projectRoles (JL-194)', () => {
  beforeEach(async () => {
    holder.db = createTestDb()
    await initTestSchema(holder.db)
    await seedTestMembers(holder.db)
    await seedTestProject(holder.db) // project 1 'TP': owner + admin are Admin, member is Member
  })

  afterEach(async () => {
    await cleanTestDb(holder.db)
    await holder.db.close()
  })

  it('returns camelCase keys usePermissions can match on', async () => {
    const res = await request(createApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor(3, 'member@test.com')}`)

    expect(res.status).toBe(200)
    expect(res.body.projectRoles).toEqual([
      { projectId: 1, projectKey: 'TP', projectName: 'Test Project', role: 'Member' },
    ])
  })

  it('reports a project Admin who is only a workspace Member', async () => {
    await holder.db.run("UPDATE project_members SET role = 'Admin' WHERE member_id = 3")
    const res = await request(createApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor(3, 'member@test.com')}`)

    expect(res.body.workspaceRole).toBe('Member')
    expect(res.body.projectRoles).toEqual([expect.objectContaining({ projectId: 1, role: 'Admin' })])
  })

  it('reports the project lead as Lead even without a project_members row', async () => {
    await holder.db.run(
      "INSERT INTO projects (name, key, type, lead, lead_member_id) VALUES ('Led Project', 'LP', 'Scrum', 'Viewer User', 4)",
    )
    const res = await request(createApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor(4, 'viewer@test.com')}`)

    const led = res.body.projectRoles.find((pr) => pr.projectKey === 'LP')
    expect(led).toEqual(expect.objectContaining({ projectName: 'Led Project', role: 'Lead' }))
  })

  it('lists only the caller’s own projects', async () => {
    await holder.db.run("INSERT INTO projects (name, key, type, lead) VALUES ('Other', 'OT', 'Scrum', 'x')")
    const res = await request(createApp())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor(3, 'member@test.com')}`)

    expect(res.body.projectRoles.map((pr) => pr.projectKey)).toEqual(['TP'])
  })
})
