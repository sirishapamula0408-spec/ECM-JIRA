// JL-420 / JL-427 / JL-428 / JL-429 — Atlassian-style teams: schema + API.
//
// Route-level unit suite over a mocked db. The db mock dispatches on the SQL
// text rather than on call ORDER: several handlers issue the same
// `SELECT role FROM team_members ...` twice (once for the caller, once for the
// target member), and an order-based mock would answer both with the same row
// and quietly pass the very permission tests this suite exists to prove.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

import { makeDbMock } from './helpers/mockDb.js'
vi.mock('../db.js', () => makeDbMock())

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import teamRoutes, { MAX_TEAM_LINKS, MEMBERSHIP_MODES, TEAM_ROLES } from '../routes/teams.js'

const WORKSPACE_A = 1
const WORKSPACE_B = 2

/** Mutable fixture the SQL router below answers from. */
let state

function resetState() {
  state = {
    // The team as it exists in workspace A.
    team: {
      id: 10,
      workspace_id: WORKSPACE_A,
      name: 'Platform',
      description: 'Runs the platform',
      avatar_url: null,
      membership: 'OPEN',
      created_by: 'lead@test.com',
      created_at: '2026-01-01T00:00:00.000Z',
    },
    // memberId -> team role on team 10.
    teamMemberRoles: { 1: 'Lead', 2: 'Member' },
    memberRows: [
      { team_id: 10, member_id: 1, role: 'Lead', joined_at: 't', name: 'Ada', email: 'lead@test.com' },
      { team_id: 10, member_id: 2, role: 'Member', joined_at: 't', name: 'Bo', email: 'bo@test.com' },
    ],
    linkRows: [],
    teamsList: [],
    memberExists: true,
  }
}

function sqlGet(sql, params) {
  if (sql.includes('FROM teams WHERE id = ? AND workspace_id = ?')) {
    const [id, workspaceId] = params
    // The tenant predicate is the point: a team in another workspace is simply
    // not there, so the caller gets the same 404 as for a non-existent id.
    if (!state.team) return null
    return Number(id) === state.team.id && Number(workspaceId) === state.team.workspace_id
      ? state.team
      : null
  }
  if (sql.includes('SELECT * FROM teams WHERE id = ?')) return state.team
  if (sql.includes('SELECT role FROM team_members WHERE team_id = ? AND member_id = ?')) {
    const role = state.teamMemberRoles[Number(params[1])]
    return role ? { role } : null
  }
  if (sql.includes("FROM team_members WHERE team_id = ? AND role = 'Lead'")) {
    const count = Object.values(state.teamMemberRoles).filter((r) => r === 'Lead').length
    return { count }
  }
  if (sql.includes('SELECT id FROM members WHERE id = ?')) {
    return state.memberExists ? { id: Number(params[0]) } : null
  }
  if (sql.includes('FROM team_links WHERE team_id = ?') && sql.includes('COUNT')) {
    return { count: state.linkRows.length }
  }
  if (sql.includes('SELECT id FROM team_links WHERE id = ? AND team_id = ?')) {
    return state.linkRows.find((l) => l.id === Number(params[0])) || null
  }
  if (sql.includes('FROM team_links WHERE id = ?')) {
    return { id: 99, team_id: 10, label: 'Docs', url: 'https://example.com', created_at: 't' }
  }
  return null
}

function sqlAll(sql) {
  if (sql.includes('FROM teams t')) return state.teamsList
  if (sql.includes('FROM team_members tm')) return state.memberRows
  if (sql.includes('FROM team_links WHERE team_id = ?')) return state.linkRows
  return []
}

/**
 * @param user  stub identity — workspaceRole / isOwner / memberId
 * @param workspaceId  what resolveWorkspace would have set
 */
function createApp(user = {}, workspaceId = WORKSPACE_A) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1, email: 'user@test.com', memberId: 2,
      workspaceRole: 'Member', isOwner: false, ...user,
    }
    req.workspaceId = workspaceId
    next()
  })
  app.use('/api/teams', teamRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.resetAllMocks()
  resetState()
  get.mockImplementation(async (sql, params = []) => sqlGet(sql, params))
  all.mockImplementation(async (sql, params = []) => sqlAll(sql, params))
  run.mockResolvedValue({ lastID: 99, changes: 1 })
})

// ---------------------------------------------------------------------------
// JL-427 — CRUD and workspace scoping
// ---------------------------------------------------------------------------
describe('JL-427 — GET /api/teams (list, workspace-scoped, ?search=)', () => {
  it('filters by the caller workspace and returns mapped teams', async () => {
    state.teamsList = [{ ...state.team, memberCount: 2 }]
    const res = await request(createApp()).get('/api/teams')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ id: 10, name: 'Platform', memberCount: 2 })
    const [sql, params] = all.mock.calls[0]
    expect(sql).toContain('t.workspace_id = ?')
    expect(params[0]).toBe(WORKSPACE_A)
  })

  it('pushes ?search= into the SQL rather than filtering in JS', async () => {
    await request(createApp()).get('/api/teams?search=plat')
    const [sql, params] = all.mock.calls[0]
    expect(sql).toContain('t.name ILIKE ?')
    expect(params).toEqual([WORKSPACE_A, '%plat%'])
  })

  it('fails closed with an empty list when no workspace resolves', async () => {
    const res = await request(createApp({}, null)).get('/api/teams')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(all).not.toHaveBeenCalled()
  })
})

describe('JL-427 — POST /api/teams (create)', () => {
  it('lets any workspace member create a team and makes them the first Lead', async () => {
    const res = await request(createApp({ workspaceRole: 'Member', memberId: 7 }))
      .post('/api/teams')
      .send({ name: 'Growth', description: 'd', membership: 'MEMBER_INVITE' })

    expect(res.status).toBe(201)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO teams'),
      expect.arrayContaining([WORKSPACE_A, 'Growth', 'd', 'MEMBER_INVITE']),
    )
    const leadInsert = run.mock.calls.find(([sql]) => sql.includes('INSERT INTO team_members'))
    expect(leadInsert).toBeTruthy()
    expect(leadInsert[0]).toContain("'Lead'")
    // team_members has no `id` column — run() must not auto-append RETURNING id.
    expect(leadInsert[0]).toContain('RETURNING team_id')
    expect(leadInsert[1]).toEqual([99, 7])
  })

  it('rejects a missing name with 400 and writes nothing', async () => {
    const res = await request(createApp()).post('/api/teams').send({ name: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name is required/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an invalid membership value rather than storing it (AC#4)', async () => {
    const res = await request(createApp()).post('/api/teams').send({ name: 'X', membership: 'PUBLIC' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('OPEN')
    expect(run).not.toHaveBeenCalled()
  })

  it('defaults membership to OPEN', async () => {
    await request(createApp()).post('/api/teams').send({ name: 'X' })
    expect(run.mock.calls[0][1]).toContain('OPEN')
  })

  it('refuses to create a team with no workspace context', async () => {
    const res = await request(createApp({}, null)).post('/api/teams').send({ name: 'X' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('JL-427 — GET /api/teams/:id', () => {
  it('returns the team with members, links and the caller viewer role', async () => {
    state.linkRows = [{ id: 5, team_id: 10, label: 'Docs', url: 'https://example.com', created_at: 't' }]
    const res = await request(createApp({ memberId: 1 })).get('/api/teams/10')
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Platform')
    expect(res.body.members).toHaveLength(2)
    expect(res.body.links[0]).toMatchObject({ label: 'Docs', url: 'https://example.com' })
    expect(res.body.viewerRole).toBe('Lead')
    expect(res.body.canManage).toBe(true)
  })

  it('404s a team belonging to ANOTHER workspace (AC#2)', async () => {
    const res = await request(createApp({}, WORKSPACE_B)).get('/api/teams/10')
    expect(res.status).toBe(404)
  })

  it('404s an unknown id rather than crashing', async () => {
    const res = await request(createApp()).get('/api/teams/4242')
    expect(res.status).toBe(404)
  })
})

describe('JL-427 — PATCH / DELETE /api/teams/:id (Lead vs Admin split)', () => {
  it('lets a team Lead edit the team', async () => {
    const res = await request(createApp({ memberId: 1 }))
      .patch('/api/teams/10').send({ name: 'Platform Core' })
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE teams SET'),
      expect.arrayContaining(['Platform Core']),
    )
  })

  it('lets a workspace Admin who is NOT on the team edit it', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin', memberId: 55 }))
      .patch('/api/teams/10').send({ description: 'new' })
    expect(res.status).toBe(200)
  })

  it('forbids a plain team Member from editing (403)', async () => {
    const res = await request(createApp({ memberId: 2 }))
      .patch('/api/teams/10').send({ name: 'Nope' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an invalid membership on PATCH', async () => {
    const res = await request(createApp({ memberId: 1 }))
      .patch('/api/teams/10').send({ membership: 'SECRET' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('cannot PATCH a team in another workspace', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin' }, WORKSPACE_B))
      .patch('/api/teams/10').send({ name: 'Hijack' })
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })

  it('deletes as Lead and relies on the FK cascade (one DELETE statement)', async () => {
    const res = await request(createApp({ memberId: 1 })).delete('/api/teams/10')
    expect(res.status).toBe(200)
    const deletes = run.mock.calls.filter(([sql]) => sql.startsWith('DELETE'))
    expect(deletes).toHaveLength(1)
    expect(deletes[0][0]).toContain('DELETE FROM teams')
  })

  it('forbids a Member from deleting', async () => {
    const res = await request(createApp({ memberId: 2 })).delete('/api/teams/10')
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// JL-428 — membership
// ---------------------------------------------------------------------------
describe('JL-428 — POST /api/teams/:id/members', () => {
  it('lets a Lead add anyone', async () => {
    const res = await request(createApp({ memberId: 1 }))
      .post('/api/teams/10/members').send({ memberId: 3, role: 'Member' })
    expect(res.status).toBe(201)
    const insert = run.mock.calls.find(([sql]) => sql.includes('INSERT INTO team_members'))
    expect(insert[0]).toContain('ON CONFLICT DO NOTHING')
    expect(insert[0]).toContain('RETURNING team_id')
  })

  it('lets a workspace Admin add anyone', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin', memberId: 90 }))
      .post('/api/teams/10/members').send({ memberId: 3 })
    expect(res.status).toBe(201)
  })

  it('lets a workspace member self-join an OPEN team', async () => {
    state.teamMemberRoles = { 1: 'Lead' } // caller (memberId 4) is not on the team
    const res = await request(createApp({ memberId: 4 }))
      .post('/api/teams/10/members').send({ memberId: 4 })
    expect(res.status).toBe(201)
  })

  it('refuses self-join on a MEMBER_INVITE team (403)', async () => {
    state.team.membership = 'MEMBER_INVITE'
    state.teamMemberRoles = { 1: 'Lead' }
    const res = await request(createApp({ memberId: 4 }))
      .post('/api/teams/10/members').send({ memberId: 4 })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/invite-only/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a non-Lead adding SOMEONE ELSE even on an OPEN team', async () => {
    const res = await request(createApp({ memberId: 2 }))
      .post('/api/teams/10/members').send({ memberId: 3 })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses self-joining straight into the Lead role', async () => {
    state.teamMemberRoles = { 1: 'Lead' }
    const res = await request(createApp({ memberId: 4 }))
      .post('/api/teams/10/members').send({ memberId: 4, role: 'Lead' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a role outside Lead|Member (AC#4)', async () => {
    const res = await request(createApp({ memberId: 1 }))
      .post('/api/teams/10/members').send({ memberId: 3, role: 'Owner' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('404s a member who is not in this workspace', async () => {
    state.memberExists = false
    const res = await request(createApp({ memberId: 1 }))
      .post('/api/teams/10/members').send({ memberId: 3 })
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })

  it('is idempotent on a duplicate add (ON CONFLICT DO NOTHING, still 201)', async () => {
    const res = await request(createApp({ memberId: 1 }))
      .post('/api/teams/10/members').send({ memberId: 2 })
    expect(res.status).toBe(201)
    expect(res.body).toHaveLength(2)
  })
})

describe('JL-428 — role changes and the last-Lead guard', () => {
  it('lets a Lead promote a Member', async () => {
    const res = await request(createApp({ memberId: 1 }))
      .patch('/api/teams/10/members/2').send({ role: 'Lead' })
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE team_members SET role'),
      ['Lead', 10, 2],
    )
  })

  it('REFUSES demoting the last Lead (409) rather than auto-promoting', async () => {
    const res = await request(createApp({ memberId: 1 }))
      .patch('/api/teams/10/members/1').send({ role: 'Member' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/at least one Lead/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('allows demoting a Lead while another Lead remains', async () => {
    state.teamMemberRoles = { 1: 'Lead', 2: 'Lead' }
    const res = await request(createApp({ memberId: 1 }))
      .patch('/api/teams/10/members/2').send({ role: 'Member' })
    expect(res.status).toBe(200)
  })

  it('REFUSES removing the last Lead (409)', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin', memberId: 90 }))
      .delete('/api/teams/10/members/1')
    expect(res.status).toBe(409)
    expect(run).not.toHaveBeenCalled()
  })

  it('lets a member leave the team themselves', async () => {
    const res = await request(createApp({ memberId: 2 })).delete('/api/teams/10/members/2')
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM team_members'), [10, 2],
    )
  })

  it('forbids a plain Member removing someone else', async () => {
    const res = await request(createApp({ memberId: 2 })).delete('/api/teams/10/members/1')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('404s removing someone who is not on the team', async () => {
    const res = await request(createApp({ memberId: 1 })).delete('/api/teams/10/members/77')
    expect(res.status).toBe(404)
  })

  it('cannot touch membership of a team in another workspace', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin' }, WORKSPACE_B))
      .post('/api/teams/10/members').send({ memberId: 3 })
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// JL-429 — links, cap and URL allow-list
// ---------------------------------------------------------------------------
describe('JL-429 — team links', () => {
  it('adds a link as a Lead', async () => {
    const res = await request(createApp({ memberId: 1 }))
      .post('/api/teams/10/links').send({ label: 'Docs', url: 'https://example.com/docs' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ label: 'Docs' })
  })

  it('forbids a plain Member from adding a link', async () => {
    const res = await request(createApp({ memberId: 2 }))
      .post('/api/teams/10/links').send({ label: 'Docs', url: 'https://example.com' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it(`refuses the ${MAX_TEAM_LINKS + 1}th link with a readable 4xx, not a 500`, async () => {
    state.linkRows = Array.from({ length: MAX_TEAM_LINKS }, (_, i) => ({
      id: i + 1, team_id: 10, label: `L${i}`, url: 'https://example.com', created_at: 't',
    }))
    const res = await request(createApp({ memberId: 1 }))
      .post('/api/teams/10/links').send({ label: 'Eleven', url: 'https://example.com/11' })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain(String(MAX_TEAM_LINKS))
    expect(run).not.toHaveBeenCalled()
  })

  it('frees a slot when a link is deleted', async () => {
    state.linkRows = Array.from({ length: MAX_TEAM_LINKS }, (_, i) => ({
      id: i + 1, team_id: 10, label: `L${i}`, url: 'https://example.com', created_at: 't',
    }))
    const app = createApp({ memberId: 1 })
    expect((await request(app).delete('/api/teams/10/links/1')).status).toBe(200)
    state.linkRows = state.linkRows.slice(1)
    expect(
      (await request(app).post('/api/teams/10/links').send({ label: 'Now fits', url: 'https://example.com/x' })).status,
    ).toBe(201)
  })

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['//evil.example.com/x'],
  ])('rejects %s at the API — stored XSS never reaches the DB', async (url) => {
    const res = await request(createApp({ memberId: 1 }))
      .post('/api/teams/10/links').send({ label: 'Bad', url })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('accepts http, https and mailto', async () => {
    for (const url of ['http://a.test/x', 'https://a.test/x', 'mailto:team@a.test']) {
      run.mockClear()
      const res = await request(createApp({ memberId: 1 }))
        .post('/api/teams/10/links').send({ label: 'ok', url })
      expect(res.status, url).toBe(201)
    }
  })

  it('requires a label and a URL', async () => {
    const app = createApp({ memberId: 1 })
    expect((await request(app).post('/api/teams/10/links').send({ url: 'https://a.test' })).status).toBe(400)
    expect((await request(app).post('/api/teams/10/links').send({ label: 'x' })).status).toBe(400)
  })

  it('404s a link that belongs to a different team', async () => {
    state.linkRows = [{ id: 5, team_id: 10, label: 'a', url: 'https://a.test', created_at: 't' }]
    const res = await request(createApp({ memberId: 1 })).delete('/api/teams/10/links/6')
    expect(res.status).toBe(404)
  })

  it('cannot list links of a team in another workspace', async () => {
    const res = await request(createApp({ workspaceRole: 'Admin' }, WORKSPACE_B)).get('/api/teams/10/links')
    expect(res.status).toBe(404)
  })
})

describe('JL-420 — the enums are the ones the ticket specifies', () => {
  it('membership modes are exactly OPEN and MEMBER_INVITE', () => {
    expect(MEMBERSHIP_MODES).toEqual(['OPEN', 'MEMBER_INVITE'])
  })
  it('team roles are exactly Lead and Member', () => {
    expect(TEAM_ROLES).toEqual(['Lead', 'Member'])
  })
  it('the link cap is Atlassian 10', () => {
    expect(MAX_TEAM_LINKS).toBe(10)
  })
})
