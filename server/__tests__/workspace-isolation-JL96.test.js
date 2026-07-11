import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Unit tests — the db module is mocked, no real Postgres.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { resolveWorkspace, isWorkspaceMember, pickWorkspaceId } from '../middleware/workspace.js'
import { errorHandler } from '../middleware/errorHandler.js'
import projectRoutes from '../routes/projects.js'

beforeEach(() => { vi.clearAllMocks() })

// App that runs the real resolveWorkspace middleware with a stubbed user.
function middlewareApp(user = { id: 1, email: 'member@test.com' }) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use(resolveWorkspace)
  // Echo the resolved workspace id so tests can assert it.
  app.get('/probe', (req, res) => res.json({ workspaceId: req.workspaceId ?? null }))
  app.use(errorHandler)
  return app
}

// App that mounts the real projects router with an injected workspace context.
function projectsApp(user, workspaceId) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    if (workspaceId !== undefined) req.workspaceId = workspaceId
    next()
  })
  app.use('/api/projects', projectRoutes)
  app.use(errorHandler)
  return app
}

/* ================================================================
   isWorkspaceMember helper
   ================================================================ */
describe('isWorkspaceMember (JL-96)', () => {
  it('returns true when a membership row exists', async () => {
    get.mockResolvedValueOnce({ ok: 1 })
    expect(await isWorkspaceMember('member@test.com', 2)).toBe(true)
    // Scoped by workspace id + email.
    expect(get.mock.calls[0][1]).toEqual([2, 'member@test.com'])
  })

  it('returns false when no membership row exists', async () => {
    get.mockResolvedValueOnce(null)
    expect(await isWorkspaceMember('stranger@test.com', 2)).toBe(false)
  })

  it('returns false for missing args without querying', async () => {
    expect(await isWorkspaceMember('', 2)).toBe(false)
    expect(await isWorkspaceMember('a@test.com', null)).toBe(false)
    expect(get).not.toHaveBeenCalled()
  })
})

/* ================================================================
   resolveWorkspace — header membership enforcement
   ================================================================ */
describe('resolveWorkspace header enforcement (JL-96)', () => {
  it('accepts the X-Workspace-Id header when the caller IS a member', async () => {
    get.mockResolvedValueOnce({ ok: 1 }) // membership check → member

    const res = await request(middlewareApp()).get('/probe').set('X-Workspace-Id', '2')

    expect(res.status).toBe(200)
    expect(res.body.workspaceId).toBe(2)
  })

  it('rejects with 403 when a non-member spoofs the header', async () => {
    get.mockResolvedValueOnce(null)      // membership check → NOT a member
    get.mockResolvedValueOnce({ ok: 1 }) // any-membership probe → data exists → enforce

    const res = await request(middlewareApp()).get('/probe').set('X-Workspace-Id', '99')

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not a member/i)
  })

  it('does NOT enforce on a legacy/empty install (no membership rows anywhere)', async () => {
    get.mockResolvedValueOnce(null) // membership check → none
    get.mockResolvedValueOnce(null) // any-membership probe → empty tables

    const res = await request(middlewareApp()).get('/probe').set('X-Workspace-Id', '5')

    expect(res.status).toBe(200)
    expect(res.body.workspaceId).toBe(5)
  })

  it('falls back to the default workspace when no header is supplied', async () => {
    get.mockResolvedValueOnce({ workspace_id: 3 }) // user default membership
    get.mockResolvedValueOnce({ id: 1 })           // seeded default fallback

    const res = await request(middlewareApp()).get('/probe')

    expect(res.status).toBe(200)
    expect(res.body.workspaceId).toBe(3) // user default wins over seeded fallback
  })

  it('uses the seeded default when the user has no membership and no header', async () => {
    get.mockResolvedValueOnce(null)      // no user default membership
    get.mockResolvedValueOnce({ id: 1 }) // seeded default

    const res = await request(middlewareApp()).get('/probe')

    expect(res.status).toBe(200)
    expect(res.body.workspaceId).toBe(1)
  })

  it('ignores a malformed header and resolves the default (no 403)', async () => {
    get.mockResolvedValueOnce(null)      // no user default membership
    get.mockResolvedValueOnce({ id: 1 }) // seeded default

    const res = await request(middlewareApp()).get('/probe').set('X-Workspace-Id', 'abc')

    expect(res.status).toBe(200)
    expect(res.body.workspaceId).toBe(1)
  })
})

/* ================================================================
   GET /api/projects — workspace-scoped listing
   ================================================================ */
describe('GET /api/projects workspace scoping (JL-96)', () => {
  const user = { id: 1, email: 'member@test.com' }

  it('filters the member query by req.workspaceId (+ legacy NULL)', async () => {
    get.mockResolvedValueOnce({ id: 10, name: 'Member Name' }) // member lookup
    all.mockResolvedValueOnce([
      { id: 1, name: 'Alpha', workspace_id: 2 },
    ])

    const res = await request(projectsApp(user, 2)).get('/api/projects')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/p\.workspace_id = \?/)
    expect(sql).toMatch(/p\.workspace_id IS NULL/)
    expect(params).toContain(2) // workspace id bound
  })

  it('a member of another workspace does not receive this workspace rows', async () => {
    // The DB (mock) returns only the rows matching the bound workspace id; here
    // the caller's workspace has no visible projects.
    get.mockResolvedValueOnce({ id: 11, name: 'Other Name' })
    all.mockResolvedValueOnce([]) // scoped query returns nothing for their workspace

    const res = await request(projectsApp(user, 7)).get('/api/projects')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(all.mock.calls[0][1]).toContain(7)
  })

  it('does NOT add a workspace filter when no workspace is resolved (backward compatible)', async () => {
    get.mockResolvedValueOnce({ id: 12, name: 'Legacy Name' })
    all.mockResolvedValueOnce([{ id: 1, name: 'Legacy', workspace_id: null }])

    // workspaceId undefined → middleware never set it (legacy path)
    const res = await request(projectsApp(user, undefined)).get('/api/projects')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const [sql, params] = all.mock.calls[0]
    expect(sql).not.toMatch(/workspace_id/)
    expect(params).toEqual([12, 'Legacy Name'])
  })
})

/* re-export sanity: pickWorkspaceId still exported/behaves */
describe('pickWorkspaceId still intact (JL-96)', () => {
  it('parses a lone header value', () => {
    expect(pickWorkspaceId('4', null, null)).toBe(4)
    expect(pickWorkspaceId('bad', null, null)).toBeNull()
  })
})
