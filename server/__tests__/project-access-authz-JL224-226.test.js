// @vitest-environment node
// JL-224/225/226 — project-scoped access authorization.
//
// Target model: workspace Owner/Admin can access ALL projects; workspace
// Member/Viewer are scoped to the projects they belong to (a project_members
// row, or being the project lead) for LISTING, READS, and WRITES. This suite
// exercises the reusable helpers in server/middleware/authorize.js through the
// projects.js and issues.js routers with a mocked db.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => {
  const run = vi.fn()
  const all = vi.fn()
  const get = vi.fn()
  return {
    run,
    all,
    get,
    columnExists: vi.fn(),
    tableExists: vi.fn(),
    withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
  }
})

// Keep issues.js's transitive side-effecting services inert.
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, createNotification: vi.fn().mockResolvedValue(1) }
})
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
  runCommentAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { resolveProjectAccess, canAccessProject } from '../middleware/authorize.js'

// Users. memberId identifies the caller for project_members lookups.
const OWNER = { id: 10, email: 'owner@test.com', memberId: 10, workspaceRole: 'Member', isOwner: true }
const ADMIN = { id: 20, email: 'admin@test.com', memberId: 20, workspaceRole: 'Admin', isOwner: false }
const MEMBER = { id: 30, email: 'member@test.com', memberId: 30, workspaceRole: 'Member', isOwner: false }
const VIEWER = { id: 40, email: 'viewer@test.com', memberId: 40, workspaceRole: 'Viewer', isOwner: false }

function createApp(routeModule, mountPath, user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

// Access-join row shape produced by resolveProjectAccess's query.
function accessRow({ id = 5, leadMemberId = 999, projectRole = null } = {}) {
  return { id, lead_member_id: leadMemberId, project_role: projectRole }
}

let projectsMod
let issuesMod
beforeEach(async () => {
  vi.clearAllMocks()
  projectsMod = await import('../routes/projects.js')
  issuesMod = await import('../routes/issues.js')
})

/* ============================================================
   Unit — resolveProjectAccess / canAccessProject helpers
   ============================================================ */
describe('resolveProjectAccess (authorize.js)', () => {
  it('grants full access to workspace Admin/Owner without a db lookup', async () => {
    const a = await resolveProjectAccess(ADMIN, 5)
    expect(a).toMatchObject({ admin: true, hasAccess: true })
    const o = await resolveProjectAccess(OWNER, 5)
    expect(o).toMatchObject({ admin: true, hasAccess: true })
    expect(get).not.toHaveBeenCalled()
  })

  it('denies a Member with no project_members row / not lead', async () => {
    get.mockResolvedValueOnce(accessRow({ projectRole: null, leadMemberId: 999 }))
    const a = await resolveProjectAccess(MEMBER, 5)
    expect(a.admin).toBe(false)
    expect(a.hasAccess).toBe(false)
  })

  it('grants a Member with a project_members row (any role)', async () => {
    get.mockResolvedValueOnce(accessRow({ projectRole: 'Viewer' }))
    const a = await resolveProjectAccess(MEMBER, 5)
    expect(a.hasAccess).toBe(true)
    expect(a.projectRole).toBe('Viewer')
    // effective rank = max(workspace Member=2, project Viewer=1) = 2
    expect(a.effectiveRank).toBe(2)
  })

  it('treats the project lead as having access (Lead role)', async () => {
    get.mockResolvedValueOnce(accessRow({ projectRole: null, leadMemberId: MEMBER.memberId }))
    const a = await resolveProjectAccess(MEMBER, 5)
    expect(a.hasAccess).toBe(true)
    expect(a.projectRole).toBe('Lead')
  })

  it('reports projectExists=false for a missing project', async () => {
    get.mockResolvedValueOnce(undefined)
    const a = await resolveProjectAccess(MEMBER, 999)
    expect(a.projectExists).toBe(false)
    expect(a.hasAccess).toBe(false)
  })

  it('a workspace Viewer holding a project Admin role gets effective Admin rank', async () => {
    get.mockResolvedValueOnce(accessRow({ projectRole: 'Admin' }))
    const a = await resolveProjectAccess(VIEWER, 5)
    expect(a.hasAccess).toBe(true)
    expect(a.effectiveRank).toBe(3) // max(Viewer=1, Admin=3)
  })

  it('canAccessProject reflects admin bypass and membership', async () => {
    expect(await canAccessProject(ADMIN, 5)).toBe(true)
    get.mockResolvedValueOnce(accessRow({ projectRole: 'Member' }))
    expect(await canAccessProject(MEMBER, 5)).toBe(true)
    get.mockResolvedValueOnce(accessRow({ projectRole: null, leadMemberId: 999 }))
    expect(await canAccessProject(MEMBER, 5)).toBe(false)
  })
})

/* ============================================================
   JL-224 — project listing
   ============================================================ */
describe('JL-224 — GET /api/projects listing', () => {
  it('returns ALL projects for a workspace Admin (no membership filter)', async () => {
    get.mockResolvedValue({ id: 20, name: 'Admin' }) // member lookup
    all.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }])

    const app = createApp(projectsMod, '/api/projects', ADMIN)
    const res = await request(app).get('/api/projects')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
    const [sql] = all.mock.calls[0]
    expect(sql).not.toContain('project_members')
  })

  it('returns ALL projects for an Owner', async () => {
    get.mockResolvedValue({ id: 10, name: 'Owner' })
    all.mockResolvedValue([{ id: 1 }, { id: 2 }])

    const app = createApp(projectsMod, '/api/projects', OWNER)
    const res = await request(app).get('/api/projects')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    const [sql] = all.mock.calls[0]
    expect(sql).not.toContain('project_members')
  })

  it('returns only member/lead projects for a workspace Member', async () => {
    get.mockResolvedValue({ id: 30, name: 'Member' })
    all.mockResolvedValue([{ id: 1 }])

    const app = createApp(projectsMod, '/api/projects', MEMBER)
    const res = await request(app).get('/api/projects')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const [sql] = all.mock.calls[0]
    expect(sql).toContain('project_members')
  })
})

/* ============================================================
   JL-225 — project + issue reads
   ============================================================ */
describe('JL-225 — GET /api/projects/:id read scoping', () => {
  function projectGetMock(scenario) {
    // scenario: { access } row for the resolveProjectAccess join, plus the
    // handler's own SELECT * FROM projects.
    get.mockImplementation(async (sql) => {
      if (sql.includes('pm.role AS project_role')) return scenario.access
      if (sql.includes('SELECT * FROM projects WHERE id')) return scenario.project
      return null
    })
  }

  it('403 for a Member who is not a member of the project', async () => {
    projectGetMock({ access: accessRow({ projectRole: null }), project: { id: 5, name: 'P' } })
    const app = createApp(projectsMod, '/api/projects', MEMBER)
    const res = await request(app).get('/api/projects/5')
    expect(res.status).toBe(403)
  })

  it('200 for a Member who belongs to the project', async () => {
    projectGetMock({ access: accessRow({ projectRole: 'Member' }), project: { id: 5, name: 'P' } })
    const app = createApp(projectsMod, '/api/projects', MEMBER)
    const res = await request(app).get('/api/projects/5')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(5)
  })

  it('200 for a workspace Admin on any project (bypass)', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM projects WHERE id')) return { id: 5, name: 'P' }
      return null
    })
    const app = createApp(projectsMod, '/api/projects', ADMIN)
    const res = await request(app).get('/api/projects/5')
    expect(res.status).toBe(200)
  })

  it('404 (not 403) for a missing project — guard lets the handler answer', async () => {
    get.mockImplementation(async () => null) // access join + handler both miss
    const app = createApp(projectsMod, '/api/projects', MEMBER)
    const res = await request(app).get('/api/projects/999')
    expect(res.status).toBe(404)
  })
})

describe('JL-225 — GET /api/issues/:id read scoping', () => {
  const ISSUE = {
    id: 1, issue_key: 'P-1', title: 't', description: 'd', priority: 'Low', assignee: 'a',
    status: 'To Do', issue_type: 'Task', sprint_id: null, project_id: 5, parent_id: null,
    epic_id: null, story_points: null, created_at: 'x', reporter: 'r', due_date: null,
    start_date: null, resolution: null, environment: null, components: null, updated_at: null,
    security_level_id: null, flagged: false,
  }

  function issueGetMock({ access }) {
    get.mockImplementation(async (sql) => {
      if (sql.includes('SELECT project_id FROM issues WHERE id')) return { project_id: 5 }
      if (sql.includes('pm.role AS project_role')) return access
      if (sql.includes('security_level_id, flagged FROM issues WHERE id')) return ISSUE
      return null
    })
    all.mockResolvedValue([]) // best-effort versions query
  }

  it('403 for a Member not in the issue’s project', async () => {
    issueGetMock({ access: accessRow({ projectRole: null }) })
    const app = createApp(issuesMod, '/api/issues', MEMBER)
    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(403)
  })

  it('200 for a Member who belongs to the issue’s project', async () => {
    issueGetMock({ access: accessRow({ projectRole: 'Member' }) })
    const app = createApp(issuesMod, '/api/issues', MEMBER)
    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(200)
    expect(res.body.key).toBe('P-1')
  })

  it('200 for an Admin (bypass)', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('security_level_id, flagged FROM issues WHERE id')) return ISSUE
      return null
    })
    all.mockResolvedValue([])
    const app = createApp(issuesMod, '/api/issues', ADMIN)
    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(200)
  })
})

/* ============================================================
   JL-226 — issue write scoping (via DELETE /api/issues/:id)
   ============================================================ */
describe('JL-226 — issue mutation authorization', () => {
  function writeGetMock({ access, projectId = 5 }) {
    get.mockImplementation(async (sql) => {
      if (sql.includes('SELECT project_id FROM issues WHERE id')) return { project_id: projectId }
      if (sql.includes('pm.role AS project_role')) return access
      if (sql.includes('SELECT id, issue_key FROM issues WHERE id')) return { id: 1, issue_key: 'P-1' }
      return null
    })
    run.mockResolvedValue({ changes: 1 })
  }

  it('403 — workspace Member who is NOT a member of the project', async () => {
    writeGetMock({ access: accessRow({ projectRole: null }) })
    const app = createApp(issuesMod, '/api/issues', MEMBER)
    const res = await request(app).delete('/api/issues/1')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('200 — project Member (workspace Member) may mutate their project', async () => {
    writeGetMock({ access: accessRow({ projectRole: 'Member' }) })
    const app = createApp(issuesMod, '/api/issues', MEMBER)
    const res = await request(app).delete('/api/issues/1')
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith('DELETE FROM issues WHERE id = ?', [1])
  })

  it('200 — workspace Viewer holding a project Member role may mutate', async () => {
    writeGetMock({ access: accessRow({ projectRole: 'Member' }) })
    const app = createApp(issuesMod, '/api/issues', VIEWER)
    const res = await request(app).delete('/api/issues/1')
    expect(res.status).toBe(200)
  })

  it('403 — project Viewer (workspace Viewer) is denied', async () => {
    writeGetMock({ access: accessRow({ projectRole: 'Viewer' }) })
    const app = createApp(issuesMod, '/api/issues', VIEWER)
    const res = await request(app).delete('/api/issues/1')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('200 — workspace Admin bypasses project membership', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('SELECT id, issue_key FROM issues WHERE id')) return { id: 1, issue_key: 'P-1' }
      return null
    })
    run.mockResolvedValue({ changes: 1 })
    const app = createApp(issuesMod, '/api/issues', ADMIN)
    const res = await request(app).delete('/api/issues/1')
    expect(res.status).toBe(200)
  })

  it('403 — POST /api/issues create in a project the Member does not belong to', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('pm.role AS project_role')) return accessRow({ projectRole: null })
      return null
    })
    const app = createApp(issuesMod, '/api/issues', MEMBER)
    const res = await request(app)
      .post('/api/issues')
      .send({ title: 'x', description: 'y', assignee: 'z', priority: 'Low', status: 'To Do', issueType: 'Task', projectId: 5 })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})
