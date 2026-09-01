// JL-423 — "Worked on": the team dimension on GET /api/activity.
//
// Two things this suite is really about:
//   1. the actor join, which is name-OR-email and case-insensitive because that
//      is what `activity.actor` actually contains (see teamActivity.js);
//   2. that ?teamId= cannot become a second way into another tenant's feed.
//      JL-362 had to retrofit tenant scoping onto this exact endpoint.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

import { makeDbMock } from './helpers/mockDb.js'
vi.mock('../db.js', () => makeDbMock())

import { all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import activityRoutes from '../routes/activity.js'
import { loadTeamActorIdentifiers, TEAM_FEED_MAX } from '../services/teamActivity.js'

const WORKSPACE_A = 1
const WORKSPACE_B = 2

let state

function resetState() {
  state = {
    // teamId -> workspace it belongs to
    teams: { 10: WORKSPACE_A, 20: WORKSPACE_B },
    // teamId -> member rows
    teamMembers: {
      10: [
        { name: 'Sarah Johnson', email: 'sarah@test.com' },
        { name: 'Emily Chen', email: 'emily@test.com' },
      ],
      20: [{ name: 'Other Person', email: 'other@test.com' }],
    },
    activityRows: [],
    count: 0,
    workspaceCount: 2,
  }
}

function sqlGet(sql, params) {
  if (sql.includes('FROM teams WHERE id = ? AND workspace_id = ?')) {
    const [id, ws] = params
    return state.teams[Number(id)] === Number(ws) ? { id: Number(id) } : null
  }
  if (sql.includes('COUNT(*) AS count FROM workspaces')) return { count: state.workspaceCount }
  if (sql.includes('COUNT(*) AS count FROM activity')) return { count: state.count }
  return null
}

function sqlAll(sql, params) {
  if (sql.includes('FROM team_members tm')) return state.teamMembers[Number(params[0])] || []
  if (sql.includes('FROM activity')) return state.activityRows
  return []
}

function createApp(workspaceId = WORKSPACE_A) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'me@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    req.workspaceId = workspaceId
    next()
  })
  app.use('/api/activity', activityRoutes)
  app.use(errorHandler)
  return app
}

/** The row-query SQL and params from the last GET. */
function lastRowQuery() {
  const call = all.mock.calls.find(([sql]) => sql.includes('FROM activity'))
  return call ? { sql: call[0], params: call[1] } : null
}

beforeEach(() => {
  vi.resetAllMocks()
  resetState()
  get.mockImplementation(async (sql, params = []) => sqlGet(sql, params))
  all.mockImplementation(async (sql, params = []) => sqlAll(sql, params))
})

describe('JL-423 — loadTeamActorIdentifiers', () => {
  it('returns every member name AND email, lower-cased and de-duplicated', async () => {
    const ids = await loadTeamActorIdentifiers(10, WORKSPACE_A)
    expect(new Set(ids)).toEqual(new Set([
      'sarah johnson', 'sarah@test.com', 'emily chen', 'emily@test.com',
    ]))
  })

  it('returns null for a team in another workspace, without reading its membership', async () => {
    // Not 403, not an empty array that a caller might mistake for "no members":
    // null means "you cannot see this", and the route turns it into an empty feed.
    expect(await loadTeamActorIdentifiers(20, WORKSPACE_A)).toBeNull()
    expect(all).not.toHaveBeenCalled()
  })

  it('returns null when no workspace resolved — fails closed', async () => {
    expect(await loadTeamActorIdentifiers(10, null)).toBeNull()
    expect(await loadTeamActorIdentifiers(10, 0)).toBeNull()
  })

  it('returns null for a non-numeric or absent team id', async () => {
    expect(await loadTeamActorIdentifiers('abc', WORKSPACE_A)).toBeNull()
    expect(await loadTeamActorIdentifiers(undefined, WORKSPACE_A)).toBeNull()
  })

  it('returns [] for a real team with no members', async () => {
    state.teamMembers[10] = []
    expect(await loadTeamActorIdentifiers(10, WORKSPACE_A)).toEqual([])
  })

  it('skips blank names and emails rather than matching on an empty string', async () => {
    state.teamMembers[10] = [{ name: '  ', email: null }, { name: 'Bo', email: '' }]
    expect(await loadTeamActorIdentifiers(10, WORKSPACE_A)).toEqual(['bo'])
  })

  it('reflects membership changes — the set is derived, never cached', async () => {
    expect(await loadTeamActorIdentifiers(10, WORKSPACE_A)).toHaveLength(4)
    state.teamMembers[10] = [{ name: 'Sarah Johnson', email: 'sarah@test.com' }]
    expect(await loadTeamActorIdentifiers(10, WORKSPACE_A)).toEqual(['sarah johnson', 'sarah@test.com'])
  })

  it('caps the team feed at Atlassian 100', () => {
    expect(TEAM_FEED_MAX).toBe(100)
  })
})

describe('JL-423 — GET /api/activity?teamId=', () => {
  it('filters on LOWER(actor) against the team members name-or-email set', async () => {
    state.activityRows = [
      { id: 3, actor: 'Sarah Johnson', action: 'moved APO-1 to DONE', created_at: 't' },
    ]
    state.count = 1
    const res = await request(createApp()).get('/api/activity?teamId=10')
    expect(res.status).toBe(200)
    expect(res.body.activities).toHaveLength(1)

    const q = lastRowQuery()
    expect(q.sql).toContain('LOWER(actor) IN (')
    // Four identifiers => four placeholders, and the emails are in there too.
    expect(q.params).toEqual(expect.arrayContaining(['sarah johnson', 'sarah@test.com', 'emily chen']))
  })

  it('applies the same filter to the count so `total` cannot over-report', async () => {
    state.activityRows = []
    state.count = 0
    await request(createApp()).get('/api/activity?teamId=10')
    const countCall = get.mock.calls.find(([sql]) => sql.includes('COUNT(*) AS count FROM activity'))
    expect(countCall[0]).toContain('LOWER(actor) IN (')
  })

  it('returns an empty feed for a team in ANOTHER workspace, and never queries activity', async () => {
    const res = await request(createApp(WORKSPACE_A)).get('/api/activity?teamId=20')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ activities: [], total: 0, hasMore: false, nextCursor: null })
    expect(lastRowQuery()).toBeNull()
  })

  it('returns an empty feed for a team with no members', async () => {
    state.teamMembers[10] = []
    const res = await request(createApp()).get('/api/activity?teamId=10')
    expect(res.body.activities).toEqual([])
    expect(lastRowQuery()).toBeNull()
  })

  it('returns an empty feed for an unknown team id', async () => {
    const res = await request(createApp()).get('/api/activity?teamId=999')
    expect(res.body.activities).toEqual([])
    expect(lastRowQuery()).toBeNull()
  })

  it('keeps the tenant scope clause as well as the team clause', async () => {
    state.activityRows = []
    state.count = 0
    await request(createApp()).get('/api/activity?teamId=10')
    const q = lastRowQuery()
    // The JL-362 scope fragment is still in the WHERE; the team filter is an
    // extra AND, never a replacement for it.
    expect(q.sql).toContain('workspace_id = ?')
    expect(q.sql).toContain('LOWER(actor) IN (')
  })

  it('caps the team feed at 100 even when a larger limit is asked for', async () => {
    state.activityRows = []
    state.count = 0
    await request(createApp()).get('/api/activity?teamId=10&limit=5000')
    const q = lastRowQuery()
    // limit + 1 is fetched to compute hasMore.
    expect(q.params[q.params.length - 1]).toBe(TEAM_FEED_MAX + 1)
  })
})

describe('JL-423 — the endpoint without ?teamId= is unchanged', () => {
  it('adds no team clause and no teams lookup', async () => {
    state.activityRows = [{ id: 1, actor: 'x', action: 'y', created_at: 't' }]
    state.count = 1
    const res = await request(createApp()).get('/api/activity?limit=10')
    expect(res.status).toBe(200)
    expect(res.body.activities).toHaveLength(1)
    const q = lastRowQuery()
    expect(q.sql).not.toContain('LOWER(actor) IN (')
    expect(get.mock.calls.some(([sql]) => sql.includes('FROM teams WHERE id = ?'))).toBe(false)
  })

  it('still honours the existing 100 ceiling on limit', async () => {
    state.activityRows = []
    state.count = 0
    await request(createApp()).get('/api/activity?limit=5000')
    const q = lastRowQuery()
    expect(q.params[q.params.length - 1]).toBe(101)
  })
})
