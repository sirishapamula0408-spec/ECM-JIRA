// JL-424 — team <-> project association, both directions.
//
// The assertion that matters most in this file is the one that proves a
// NEGATIVE: team membership confers no project permission. See the last
// describe block.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { makeDbMock } from './helpers/mockDb.js'
vi.mock('../db.js', () => makeDbMock())

import { all, get, run } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import teamRoutes, { projectTeamsRouter } from '../routes/teams.js'
import { resolveProjectAccess } from '../middleware/authorize.js'

const WORKSPACE_A = 1
const WORKSPACE_B = 2

let state

function resetState() {
  state = {
    teams: { 10: WORKSPACE_A, 20: WORKSPACE_B },
    projects: { 100: WORKSPACE_A, 200: WORKSPACE_B },
    // memberId -> role on project 100
    projectRoles: {},
    teamProjects: [{ id: 100, name: 'Apollo', key: 'APO' }],
    projectTeams: [{ id: 10, name: 'Platform', description: null, membership: 'OPEN', memberCount: 2 }],
  }
}

function sqlGet(sql, params) {
  if (sql.includes('FROM teams WHERE id = ? AND workspace_id = ?')) {
    const [id, ws] = params
    return state.teams[Number(id)] === Number(ws) ? { id: Number(id), workspace_id: Number(ws), membership: 'OPEN' } : null
  }
  if (sql.includes('SELECT id, name, key FROM projects WHERE id = ?')) {
    const [id, ws] = params
    return state.projects[Number(id)] === Number(ws)
      ? { id: Number(id), name: 'Apollo', key: 'APO' }
      : null
  }
  // resolveProjectAccess' join
  if (sql.includes('LEFT JOIN project_members pm ON pm.project_id = p.id')) {
    const memberId = params[0]
    const projectId = Number(params[1])
    if (!state.projects[projectId]) return null
    return { id: projectId, lead_member_id: null, project_role: state.projectRoles[memberId] || null }
  }
  // loadProjectRole
  if (sql.includes('SELECT role FROM project_members WHERE project_id = ? AND member_id = ?')) {
    const role = state.projectRoles[params[1]]
    return role ? { role } : null
  }
  return null
}

function sqlAll(sql) {
  if (sql.includes('FROM team_projects tp') && sql.includes('JOIN projects p')) return state.teamProjects
  if (sql.includes('FROM team_projects tp') && sql.includes('JOIN teams t')) return state.projectTeams
  return []
}

function createApp(user = {}, workspaceId = WORKSPACE_A) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1, email: 'user@test.com', memberId: 5,
      workspaceRole: 'Member', isOwner: false, ...user,
    }
    req.workspaceId = workspaceId
    next()
  })
  app.use('/api/teams', teamRoutes)
  app.use('/api', projectTeamsRouter)
  app.use(errorHandler)
  return app
}

const insertCalls = () => run.mock.calls.filter(([sql]) => sql.includes('INSERT INTO team_projects'))

beforeEach(() => {
  vi.resetAllMocks()
  resetState()
  get.mockImplementation(async (sql, params = []) => sqlGet(sql, params))
  all.mockImplementation(async (sql, params = []) => sqlAll(sql, params))
  run.mockResolvedValue({ lastID: 1, changes: 1 })
})

describe('JL-424 — the team side: /api/teams/:id/projects', () => {
  it("lists a team's projects", async () => {
    const res = await request(createApp()).get('/api/teams/10/projects')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 100, name: 'Apollo', key: 'APO' }])
  })

  it('404s a team in another workspace', async () => {
    const res = await request(createApp({}, WORKSPACE_A)).get('/api/teams/20/projects')
    expect(res.status).toBe(404)
  })

  it('lets a workspace Admin associate, idempotently', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin' }))
      .post('/api/teams/10/projects').send({ projectId: 100 })
    expect(res.status).toBe(201)
    const [sql, params] = insertCalls()[0]
    expect(sql).toContain('ON CONFLICT DO NOTHING')
    // Composite PK, no id column.
    expect(sql).toContain('RETURNING team_id')
    expect(params).toEqual([10, 100])
  })

  it('lets a project Admin who is only a workspace Member associate', async () => {
    state.projectRoles[5] = 'Admin'
    const res = await request(createApp({ workspaceRole: 'Member', memberId: 5 }))
      .post('/api/teams/10/projects').send({ projectId: 100 })
    expect(res.status).toBe(201)
  })

  it('lets a project Lead associate (Lead outranks Admin in ROLE_RANK)', async () => {
    state.projectRoles[5] = 'Lead'
    const res = await request(createApp({ workspaceRole: 'Member', memberId: 5 }))
      .post('/api/teams/10/projects').send({ projectId: 100 })
    expect(res.status).toBe(201)
  })

  it('refuses a project Member (403) and writes nothing', async () => {
    state.projectRoles[5] = 'Member'
    const res = await request(createApp({ workspaceRole: 'Member', memberId: 5 }))
      .post('/api/teams/10/projects').send({ projectId: 100 })
    expect(res.status).toBe(403)
    expect(insertCalls()).toHaveLength(0)
  })

  it('refuses a plain workspace Member with no project role (403)', async () => {
    const res = await request(createApp({ workspaceRole: 'Member', memberId: 5 }))
      .post('/api/teams/10/projects').send({ projectId: 100 })
    expect(res.status).toBe(403)
    expect(insertCalls()).toHaveLength(0)
  })

  it('404s a project belonging to another workspace', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin' }))
      .post('/api/teams/10/projects').send({ projectId: 200 })
    expect(res.status).toBe(404)
    expect(insertCalls()).toHaveLength(0)
  })

  it('404s a team belonging to another workspace', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin' }))
      .post('/api/teams/20/projects').send({ projectId: 100 })
    expect(res.status).toBe(404)
    expect(insertCalls()).toHaveLength(0)
  })

  it('dissociates as a workspace Admin', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin' }))
      .delete('/api/teams/10/projects/100')
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM team_projects'), [10, 100],
    )
  })

  it('refuses dissociation from someone with no project authority', async () => {
    const res = await request(createApp({ workspaceRole: 'Member', memberId: 5 }))
      .delete('/api/teams/10/projects/100')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('JL-424 — the project side: /api/projects/:projectId/teams', () => {
  it("lists a project's teams, filtered to the caller's workspace", async () => {
    const res = await request(createApp()).get('/api/projects/100/teams')
    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({ id: 10, name: 'Platform' })
    const call = all.mock.calls.find(([sql]) => sql.includes('JOIN teams t'))
    expect(call[0]).toContain('t.workspace_id = ?')
    expect(call[1]).toEqual([100, WORKSPACE_A])
  })

  it('404s a project in another workspace', async () => {
    const res = await request(createApp()).get('/api/projects/200/teams')
    expect(res.status).toBe(404)
  })

  it('associates from the project side as a project Admin', async () => {
    state.projectRoles[5] = 'Admin'
    const res = await request(createApp({ workspaceRole: 'Member', memberId: 5 }))
      .post('/api/projects/100/teams').send({ teamId: 10 })
    expect(res.status).toBe(201)
    expect(insertCalls()[0][1]).toEqual([10, 100])
  })

  it('refuses a project Member from the project side (403)', async () => {
    state.projectRoles[5] = 'Member'
    const res = await request(createApp({ workspaceRole: 'Member', memberId: 5 }))
      .post('/api/projects/100/teams').send({ teamId: 10 })
    expect(res.status).toBe(403)
    expect(insertCalls()).toHaveLength(0)
  })

  it('dissociates from the project side as a workspace Admin', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin' }))
      .delete('/api/projects/100/teams/10')
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM team_projects'), [10, 100],
    )
  })

  it('refuses to associate a team from another workspace', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin' }))
      .post('/api/projects/100/teams').send({ teamId: 20 })
    expect(res.status).toBe(404)
    expect(insertCalls()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// AC#5 — the negative that matters
// ---------------------------------------------------------------------------
describe('JL-424 AC#5 — team membership confers NO project permission', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

  it('a workspace Viewer on an associated team is still shut out of the project', async () => {
    // The team IS associated with project 100 (state.teamProjects), and the
    // caller IS on the team — neither fact is visible to project access.
    const access = await resolveProjectAccess(
      { workspaceRole: 'Viewer', isOwner: false, memberId: 5 }, 100,
    )
    expect(access.admin).toBe(false)
    expect(access.hasAccess).toBe(false)
    expect(access.projectRole).toBeNull()
  })

  it('project access never reads a team table — checked in the source, not just in behaviour', async () => {
    // A behavioural test alone would pass on the day someone adds the join and
    // forgets this case. Reading the source makes the omission deliberate.
    for (const file of ['middleware/authorize.js', 'services/projectAccess.js']) {
      const src = read(file)
      expect(src, `${file} must not consult team membership`).not.toMatch(/team_members|team_projects|\bteams\b/)
    }
  })

  it('resolving project access issues no query against team_projects', async () => {
    get.mockClear()
    await resolveProjectAccess({ workspaceRole: 'Member', isOwner: false, memberId: 5 }, 100)
    for (const [sql] of get.mock.calls) {
      expect(sql).not.toContain('team_projects')
      expect(sql).not.toContain('team_members')
    }
  })
})

describe('JL-424 — schema', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const dbSource = readFileSync(join(here, '..', 'db.js'), 'utf8')

  it('creates team_projects with both cascades and the composite PK', () => {
    expect(dbSource).toMatch(/CREATE TABLE IF NOT EXISTS team_projects/)
    expect(dbSource).toMatch(/team_id INTEGER NOT NULL REFERENCES teams\(id\) ON DELETE CASCADE/)
    expect(dbSource).toMatch(/project_id INTEGER NOT NULL REFERENCES projects\(id\) ON DELETE CASCADE/)
    expect(dbSource).toMatch(/PRIMARY KEY \(team_id, project_id\)/)
  })

  it('indexes the reverse lookup', () => {
    expect(dbSource).toContain('idx_team_projects_project_id ON team_projects(project_id)')
  })
})
