// Project-less issues used to be public: any workspace member could read and
// edit an issue whose project_id was NULL (old PROJ-n tickets, every issue of a
// deleted project). They are now removed as a category — moved into an
// admin-only holding project, which the ordinary project gates already protect.
//
// Real PostgreSQL, because the behaviour under test is SQL: the migration's
// UPDATE, the holding project's lookup by id, and the delete route's re-homing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTestDb, initTestSchema, seedTestMembers, seedTestProject, cleanTestDb } from './setup.js'

const holder = vi.hoisted(() => ({ db: null, user: null }))

vi.mock('../db.js', () => {
  const toPg = (sql) => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`) }
  const get = (sql, params) => holder.db.get(toPg(sql), params)
  return {
    get,
    all: (sql, params) => holder.db.all(toPg(sql), params),
    run: (sql, params) => holder.db.run(toPg(sql), params),
    getSetting: async (key, fallback = null) => {
      const row = await get('SELECT value FROM workspace_settings WHERE key = ?', [key])
      return row && row.value != null ? row.value : fallback
    },
    setSetting: async (key, value) => {
      await holder.db.run(
        'INSERT INTO workspace_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING key',
        [key, String(value)],
      )
    },
  }
})
vi.mock('../routes/workspaceSettings.js', () => ({ getProjectCreationPolicy: async () => 'all_members' }))
vi.mock('../services/workflowSeed.js', () => ({ seedDefaultWorkflow: async () => {} }))

const { adoptProjectlessIssues, ensureHoldingProject, HOLDING_PROJECT_SETTING } = await import('../services/holdingProject.js')
const { default: projectRoutes } = await import('../routes/projects.js')

const OWNER = { id: 1, email: 'owner@test.com', memberId: 1, workspaceRole: 'Owner', isOwner: true }

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { ...holder.user }; next() })
  app.use('/api/projects', projectRoutes)
  return app
}

const addIssue = (key, projectId) => holder.db.run(
  "INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type, project_id) VALUES ($1, 't', 'd', 'Low', 'a', 'Backlog', 'Task', $2) RETURNING id",
  [key, projectId],
)
const projectOf = async (key) => (await holder.db.get('SELECT project_id FROM issues WHERE issue_key = $1', [key])).project_id
const holdingId = async () => Number((await holder.db.get('SELECT value FROM workspace_settings WHERE key = $1', [HOLDING_PROJECT_SETTING]))?.value)

describe('project-less issues are moved into the admin-only holding project', () => {
  beforeEach(async () => {
    holder.db = createTestDb()
    holder.user = OWNER
    await initTestSchema(holder.db)
    await holder.db.run('ALTER TABLE projects ADD COLUMN IF NOT EXISTS issue_counter INTEGER NOT NULL DEFAULT 0')
    await holder.db.run('ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ')
    await holder.db.run('CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT)')
    await seedTestMembers(holder.db)
    await seedTestProject(holder.db) // project 1, key TP, with members
  })

  afterEach(async () => {
    await cleanTestDb(holder.db)
    await holder.db.close()
  })

  it('the migration adopts every orphan, keeps its key, and the holding project has no members or lead', async () => {
    await addIssue('PROJ-837', null)
    await addIssue('DM-63', null)
    await addIssue('TP-1', 1)

    expect(await adoptProjectlessIssues()).toBe(2)

    const hid = await holdingId()
    expect(hid).toBeGreaterThan(1)
    expect(await projectOf('PROJ-837')).toBe(hid)
    expect(await projectOf('DM-63')).toBe(hid)
    expect(await projectOf('TP-1')).toBe(1) // untouched
    expect((await holder.db.get('SELECT COUNT(*)::int AS n FROM issues WHERE project_id IS NULL')).n).toBe(0)

    const project = await holder.db.get('SELECT lead, lead_member_id FROM projects WHERE id = $1', [hid])
    expect(project.lead_member_id).toBeNull()
    expect(project.lead).toBe('system')
    expect((await holder.db.get('SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1', [hid])).n).toBe(0)
  })

  it('is idempotent, and creates no project when there is nothing to adopt', async () => {
    expect(await adoptProjectlessIssues()).toBe(0)
    expect((await holder.db.get('SELECT COUNT(*)::int AS n FROM projects')).n).toBe(1)

    await addIssue('PROJ-1', null)
    await adoptProjectlessIssues()
    const first = await holdingId()
    await addIssue('PROJ-2', null)
    await adoptProjectlessIssues()
    expect(await holdingId()).toBe(first) // reused, not a second holding project
    expect(await projectOf('PROJ-2')).toBe(first)
  })

  it('never files orphans into a user project that happens to use the key ORPHAN', async () => {
    const { lastID: userProject } = await holder.db.run(
      "INSERT INTO projects (name, key, type, lead) VALUES ('Real one', 'ORPHAN', 'Scrum', 'x') RETURNING id",
    )
    const hid = await ensureHoldingProject()
    expect(hid).not.toBe(userProject)
    expect((await holder.db.get('SELECT key FROM projects WHERE id = $1', [hid])).key).toBe('ORPHAN2')
  })

  it('DELETE /api/projects/:id re-homes its issues instead of making them public', async () => {
    await addIssue('TP-1', 1)
    await addIssue('TP-2', 1)

    const res = await request(createApp()).delete('/api/projects/1')
    expect(res.status).toBe(200)

    const hid = await holdingId()
    expect(hid).toBeGreaterThan(0)
    expect(await projectOf('TP-1')).toBe(hid)
    expect(await projectOf('TP-2')).toBe(hid)
    expect((await holder.db.get('SELECT COUNT(*)::int AS n FROM issues WHERE project_id IS NULL')).n).toBe(0)
  })

  it('deleting the holding project is refused while it still holds issues', async () => {
    await addIssue('PROJ-1', null)
    await adoptProjectlessIssues()
    const hid = await holdingId()

    const res = await request(createApp()).delete(`/api/projects/${hid}`)
    expect(res.status).toBe(409)
    expect(await projectOf('PROJ-1')).toBe(hid)
  })
})
