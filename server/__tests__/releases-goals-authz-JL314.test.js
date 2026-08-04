// @vitest-environment node
// JL-314 — Releases & Goals endpoints must be project-scoped.
//
// Before this fix, every GET in server/routes/releases.js and
// server/routes/goals.js was completely unguarded at the project level, and the
// writes were gated only by the WORKSPACE role (requireRole('Member','Admin')).
// So any authenticated workspace user could read — and a workspace Member could
// even mutate — the releases, versions and OKRs of a project they are not a
// member of.
//
// The routes keyed by :projectId can be guarded off the path param, but
// /releases/:id, /goals/:id, /key-results/:id and /issues/:issueId/* are keyed
// by the entity, so the guard first has to hop entity → owning project. These
// tests pin down both shapes, plus the workspace Admin/Owner bypass and the
// requirement that a project Viewer keeps read access.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import releaseRoutes from '../routes/releases.js'
import goalRoutes from '../routes/goals.js'

// The project every fixture entity belongs to, and one the caller is a stranger to.
const HOME_PROJECT = 5
const OTHER_PROJECT = 99

// Callers. memberId is what resolveProjectAccess joins project_members on.
const OWNER = { id: 10, email: 'owner@test.com', memberId: 10, workspaceRole: 'Member', isOwner: true }
const WS_ADMIN = { id: 20, email: 'admin@test.com', memberId: 20, workspaceRole: 'Admin', isOwner: false }
// Workspace Member with NO membership in the target project — the leak vector.
const OUTSIDER = { id: 30, email: 'outsider@test.com', memberId: 30, workspaceRole: 'Member', isOwner: false }
// Workspace Viewer who IS a project member (project role Viewer) — must keep reads.
const PROJECT_VIEWER = { id: 40, email: 'viewer@test.com', memberId: 40, workspaceRole: 'Viewer', isOwner: false }

function createApp(user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { ...user }
    next()
  })
  app.use('/api', releaseRoutes)
  app.use('/api', goalRoutes)
  app.use(errorHandler)
  return app
}

/**
 * Stub the db so that:
 *  - the resolveProjectAccess join returns a project_members row only for the
 *    caller listed in `membership` AND only for the project they belong to;
 *  - every release / goal / key result / issue fixture lives in `entityProject`.
 */
function stubDb({ membership = null, entityProject = HOME_PROJECT } = {}) {
  get.mockImplementation(async (sql, params = []) => {
    // resolveProjectAccess: SELECT p.id, p.lead_member_id, pm.role ... LEFT JOIN project_members
    if (sql.includes('LEFT JOIN project_members')) {
      const [memberId, projectId] = params
      const role =
        membership && membership.memberId === memberId && membership.projectId === Number(projectId)
          ? membership.role
          : null
      return { id: Number(projectId), lead_member_id: null, project_role: role }
    }
    if (sql.includes('FROM key_results')) {
      return { id: 3, goal_id: 1, project_id: entityProject, title: 'KR', target_value: 100, current_value: 25, unit: '', issue_id: null }
    }
    if (sql.includes('FROM releases')) {
      return { id: 1, project_id: entityProject, name: 'v1.0', description: '', release_date: null, status: 'unreleased', created_at: 't' }
    }
    if (sql.includes('FROM goals')) {
      return { id: 1, project_id: entityProject, objective: 'Obj', description: '', owner: '', status: 'on_track', due_date: null, created_at: 't' }
    }
    if (sql.includes('FROM issues')) {
      return { id: 7, project_id: entityProject }
    }
    return null
  })
  all.mockResolvedValue([])
  run.mockResolvedValue({ lastID: 1, changes: 1 })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Every read endpoint in the two routers, split by how the project is resolved.
const PROJECT_KEYED_READS = [
  ['GET', '/api/projects/5/releases'],
  ['GET', '/api/projects/5/goals'],
]
const ENTITY_KEYED_READS = [
  ['GET', '/api/releases/1'],
  ['GET', '/api/releases/1/issues'],
  ['GET', '/api/releases/1/progress'],
  ['GET', '/api/releases/1/notes'],
  ['GET', '/api/issues/7/versions'],
  ['GET', '/api/goals/1'],
]
const ALL_READS = [...PROJECT_KEYED_READS, ...ENTITY_KEYED_READS]

describe('JL-314 — reads are denied to a non-member of the project', () => {
  it.each(ALL_READS)('%s %s → 403 for a workspace Member with no project membership', async (_method, url) => {
    stubDb({ membership: null })
    const res = await request(createApp(OUTSIDER)).get(url)
    expect(res.status).toBe(403)
  })

  it.each(ENTITY_KEYED_READS)(
    '%s %s → 403 when the entity belongs to a DIFFERENT project than the caller\'s',
    async (_method, url) => {
      // Caller is a full project Member of project 5, but the release/goal/issue
      // actually lives in project 99 — the guard must resolve the OWNING project.
      stubDb({
        membership: { memberId: OUTSIDER.memberId, projectId: HOME_PROJECT, role: 'Member' },
        entityProject: OTHER_PROJECT,
      })
      const res = await request(createApp(OUTSIDER)).get(url)
      expect(res.status).toBe(403)
    },
  )
})

describe('JL-314 — reads stay open to project members, including Viewers', () => {
  it.each(ALL_READS)('%s %s → 200 for a project Viewer', async (_method, url) => {
    stubDb({ membership: { memberId: PROJECT_VIEWER.memberId, projectId: HOME_PROJECT, role: 'Viewer' } })
    const res = await request(createApp(PROJECT_VIEWER)).get(url)
    expect(res.status).toBe(200)
  })
})

describe('JL-314 — workspace Admin / Owner bypass is preserved', () => {
  it.each(ALL_READS)('%s %s → 200 for a workspace Admin with no project row', async (_method, url) => {
    stubDb({ membership: null })
    const res = await request(createApp(WS_ADMIN)).get(url)
    expect(res.status).toBe(200)
  })

  it.each(ALL_READS)('%s %s → 200 for the workspace Owner with no project row', async (_method, url) => {
    stubDb({ membership: null })
    const res = await request(createApp(OWNER)).get(url)
    expect(res.status).toBe(200)
  })

  it('does not even run the project-access lookup for a workspace Admin', async () => {
    stubDb({ membership: null })
    const res = await request(createApp(WS_ADMIN)).get('/api/releases/1')
    expect(res.status).toBe(200)
    expect(get).not.toHaveBeenCalledWith(
      expect.stringContaining('LEFT JOIN project_members'),
      expect.anything(),
    )
  })
})

// The writes carried the same hole: requireRole('Member','Admin') only checked
// the WORKSPACE role, so any workspace Member could mutate any project.
const WRITES = [
  ['post', '/api/projects/5/releases', { name: 'v9' }],
  ['patch', '/api/releases/1', { status: 'released' }],
  ['put', '/api/issues/7/release', { releaseId: 1 }],
  ['put', '/api/issues/7/versions', { fix: [1] }],
  ['post', '/api/projects/5/goals', { objective: 'Obj' }],
  ['patch', '/api/goals/1', { objective: 'Obj' }],
  ['post', '/api/goals/1/key-results', { title: 'KR' }],
  ['patch', '/api/key-results/3', { currentValue: 50 }],
  ['delete', '/api/key-results/3', null],
]

describe('JL-314 — writes are denied to a non-member of the project', () => {
  it.each(WRITES)('%s %s → 403 for a workspace Member with no project membership', async (method, url, body) => {
    stubDb({ membership: null })
    const req = request(createApp(OUTSIDER))[method](url)
    const res = body ? await req.send(body) : await req
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('still lets a project Member write', async () => {
    stubDb({ membership: { memberId: OUTSIDER.memberId, projectId: HOME_PROJECT, role: 'Member' } })
    const res = await request(createApp(OUTSIDER)).post('/api/projects/5/releases').send({ name: 'v9' })
    expect(res.status).toBe(201)
  })

  it('still forbids a project Viewer from writing', async () => {
    stubDb({ membership: { memberId: PROJECT_VIEWER.memberId, projectId: HOME_PROJECT, role: 'Viewer' } })
    const res = await request(createApp(PROJECT_VIEWER)).post('/api/projects/5/goals').send({ objective: 'X' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps DELETE /releases/:id and /goals/:id at workspace Admin', async () => {
    stubDb({ membership: { memberId: OUTSIDER.memberId, projectId: HOME_PROJECT, role: 'Member' } })
    const app = createApp(OUTSIDER)
    expect((await request(app).delete('/api/releases/1')).status).toBe(403)
    expect((await request(app).delete('/api/goals/1')).status).toBe(403)
    expect(run).not.toHaveBeenCalled()

    stubDb({ membership: null })
    const adminApp = createApp(WS_ADMIN)
    expect((await request(adminApp).delete('/api/releases/1')).status).toBe(200)
    expect((await request(adminApp).delete('/api/goals/1')).status).toBe(200)
  })
})
