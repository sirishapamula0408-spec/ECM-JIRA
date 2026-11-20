/* ================================================================
   JL-481 — a project Lead can create (and manage) sprints.

   Before: every sprint-management route was requireRole('Admin'), a WORKSPACE
   gate, so a project Lead who is a workspace Member saw "Create sprint"
   (usePermissions().canManageSprints is project-admin) and got a 403. Now the
   gate is requireProjectAdmin: workspace Owner/Admin, or Lead/Admin of the
   sprint's own project. Project Member/Viewer stay blocked, and a shared
   legacy sprint (no project) stays workspace-Admin only.
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(), all: vi.fn(), get: vi.fn(), columnExists: vi.fn(), tableExists: vi.fn(), withTransaction: vi.fn(),
}))
vi.mock('../services/events.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { resolveProjectAccess } from '../middleware/authorize.js'
import sprintRoutes, { projectSprintRouter, templatesRouter } from '../routes/sprints.js'

const ME = 7
const WS_MEMBER = { id: 70, email: 'lead@x.com', memberId: ME, workspaceRole: 'Member', isOwner: false }
const WS_ADMIN = { id: 1, email: 'admin@x.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }

/*
 * World: project 4 (ECM) and project 5 (MOB). `roles` is the caller's
 * project_members role per project; `leads` the projects.lead_member_id.
 * Sprint 11 belongs to project 4, sprint 12 is a shared legacy sprint.
 */
let roles
let leads
const SPRINTS = { 11: 4, 12: null }

function world() {
  get.mockImplementation(async (sql, params = []) => {
    if (/FROM projects p\s+LEFT JOIN project_members pm/.test(sql)) {
      const projectId = Number(params[1])
      if (![4, 5].includes(projectId)) return undefined
      return { id: projectId, lead_member_id: leads[projectId] ?? null, project_role: roles[projectId] ?? null }
    }
    if (/SELECT project_id FROM sprints WHERE id/.test(sql)) {
      const id = Number(params[0])
      return id in SPRINTS ? { project_id: SPRINTS[id] } : undefined
    }
    if (/SELECT id, key FROM projects/.test(sql)) return [4, 5].includes(Number(params[0])) ? { id: Number(params[0]), key: 'ECM' } : undefined
    if (/SELECT id FROM projects WHERE id/.test(sql)) return [4, 5].includes(Number(params[0])) ? { id: Number(params[0]) } : undefined
    if (/COUNT\(\*\)/.test(sql)) return { count: 0 }
    if (/allow_parallel_sprints/.test(sql)) return { allow_parallel_sprints: false }
    if (/FROM sprint_templates/.test(sql)) return { id: 2, name: 'Two-week', duration_days: 14, default_goal: '' }
    if (/FROM sprints WHERE id/.test(sql)) {
      const id = Number(params[0])
      if (id === 99) return { id, project_id: 4, name: 'ECM Sprint 1', date_range: 'Upcoming', is_started: false }
      if (!(id in SPRINTS)) return undefined
      return { id, project_id: SPRINTS[id], name: 'ECM Sprint 1', date_range: 'Upcoming', is_started: false }
    }
    return undefined
  })
}

function appAs(user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { ...user }; next() })
  app.use('/api/sprints', sprintRoutes)
  app.use('/api', projectSprintRouter)
  app.use('/api/sprint-templates', templatesRouter)
  app.use(errorHandler)
  return app
}

const inserts = () => run.mock.calls.filter(([sql]) => /INSERT INTO sprints/.test(sql))

beforeEach(() => {
  vi.clearAllMocks()
  roles = {}
  leads = {}
  run.mockResolvedValue({ lastID: 99, changes: 1 })
  all.mockResolvedValue([])
  world()
})

describe('JL-481 — POST /api/sprints for a project Lead', () => {
  it('a project_members Lead (workspace Member) creates a sprint in that project', async () => {
    roles = { 4: 'Lead' }
    const res = await request(appAs(WS_MEMBER)).post('/api/sprints').send({ projectId: 4 })
    expect(res.status).toBe(201)
    expect(inserts()).toHaveLength(1)
    expect(inserts()[0][1][0]).toBe(4)
  })

  it('the designated lead (projects.lead_member_id) with no project_members row creates one', async () => {
    leads = { 4: ME }
    const res = await request(appAs(WS_MEMBER)).post('/api/sprints').send({ projectId: 4 })
    expect(res.status).toBe(201)
  })

  it('the designated lead wins over a stale lower project_members row', async () => {
    leads = { 4: ME }
    roles = { 4: 'Member' }
    const res = await request(appAs(WS_MEMBER)).post('/api/sprints').send({ projectId: 4 })
    expect(res.status).toBe(201)
  })

  it('a project Admin also may (same gate as canManageSprints)', async () => {
    roles = { 4: 'Admin' }
    const res = await request(appAs(WS_MEMBER)).post('/api/sprints').send({ projectId: 4 })
    expect(res.status).toBe(201)
  })

  it('a workspace Admin still may, with no project role', async () => {
    const res = await request(appAs(WS_ADMIN)).post('/api/sprints').send({ projectId: 4 })
    expect(res.status).toBe(201)
  })

  it('a missing projectId is still a 400 from the handler, not a 403', async () => {
    roles = { 4: 'Lead' }
    const res = await request(appAs(WS_MEMBER)).post('/api/sprints').send({ name: 'x' })
    expect(res.status).toBe(400)
    expect(inserts()).toHaveLength(0)
  })
})

describe('JL-481 — who still cannot create sprints', () => {
  it.each(['Member', 'Viewer'])('a project %s gets 403 and nothing is written', async (role) => {
    roles = { 4: role }
    const res = await request(appAs(WS_MEMBER)).post('/api/sprints').send({ projectId: 4 })
    expect(res.status).toBe(403)
    expect(inserts()).toHaveLength(0)
  })

  it('a workspace Member with no role on the project gets 403', async () => {
    const res = await request(appAs(WS_MEMBER)).post('/api/sprints').send({ projectId: 4 })
    expect(res.status).toBe(403)
  })

  it('the Lead of project 4 cannot create a sprint in project 5', async () => {
    roles = { 4: 'Lead' }
    leads = { 4: ME }
    const res = await request(appAs(WS_MEMBER)).post('/api/sprints').send({ projectId: 5 })
    expect(res.status).toBe(403)
    expect(inserts()).toHaveLength(0)
  })
})

describe('JL-481 — the rest of sprint management follows the same gate', () => {
  const actions = [
    ['start', (app) => request(app).patch('/api/sprints/11/start').send({})],
    ['edit', (app) => request(app).patch('/api/sprints/11').send({ name: 'Renamed' })],
    ['complete', (app) => request(app).patch('/api/sprints/11/complete').send({})],
    ['delete', (app) => request(app).delete('/api/sprints/11')],
    ['parallel setting', (app) => request(app).put('/api/projects/4/sprints/settings').send({ allowParallelSprints: true })],
    ['create from template', (app) => request(app).post('/api/sprint-templates/2/create-sprint').send({ projectId: 4 })],
  ]

  it.each(actions)('a project Lead may %s', async (_name, call) => {
    roles = { 4: 'Lead' }
    const res = await call(appAs(WS_MEMBER))
    expect([200, 201]).toContain(res.status)
  })

  it.each(actions)('a project Member may not %s', async (_name, call) => {
    roles = { 4: 'Member' }
    const res = await call(appAs(WS_MEMBER))
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('a shared legacy sprint (no project) stays workspace-Admin only', async () => {
    roles = { 4: 'Lead', 5: 'Lead' }
    const asLead = await request(appAs(WS_MEMBER)).delete('/api/sprints/12')
    expect(asLead.status).toBe(403)
    const asAdmin = await request(appAs(WS_ADMIN)).delete('/api/sprints/12')
    expect(asAdmin.status).toBe(200)
  })

  it('an unknown sprint is a 404 from the handler, not a 403', async () => {
    roles = { 4: 'Lead' }
    const res = await request(appAs(WS_MEMBER)).patch('/api/sprints/404/complete').send({})
    expect(res.status).toBe(404)
  })

  it('creating sprint templates themselves stays workspace-Admin', async () => {
    roles = { 4: 'Lead' }
    const res = await request(appAs(WS_MEMBER)).post('/api/sprint-templates').send({ name: 'T' })
    expect(res.status).toBe(403)
  })
})

describe('JL-481 — resolveProjectAccess: the designated lead is the Lead', () => {
  it('lead_member_id outranks a lower project_members role', async () => {
    leads = { 4: ME }
    roles = { 4: 'Viewer' }
    const access = await resolveProjectAccess(WS_MEMBER, 4)
    expect(access.projectRole).toBe('Lead')
    expect(access.hasAccess).toBe(true)
  })

  it('without being the lead, the project_members role stands', async () => {
    leads = { 4: 999 }
    roles = { 4: 'Member' }
    const access = await resolveProjectAccess(WS_MEMBER, 4)
    expect(access.projectRole).toBe('Member')
  })
})
