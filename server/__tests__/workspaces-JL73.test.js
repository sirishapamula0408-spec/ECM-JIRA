import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — these are unit tests, no real Postgres.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { pickWorkspaceId } from '../middleware/workspace.js'
import { errorHandler } from '../middleware/errorHandler.js'
import workspaceRoutes from '../routes/workspaces.js'

// Build an app with a stubbed auth/role/workspace context.
function createApp(user = { id: 1, email: 'owner@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }, workspaceId) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    if (workspaceId !== undefined) req.workspaceId = workspaceId
    next()
  })
  app.use('/api/workspaces', workspaceRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => { vi.clearAllMocks() })

/* ================================================================
   pickWorkspaceId — precedence: header > user default > fallback
   ================================================================ */
describe('pickWorkspaceId precedence (JL-73)', () => {
  it('prefers a valid header value over the user default and fallback', () => {
    expect(pickWorkspaceId('7', 3, 1)).toBe(7)
  })

  it('falls back to the user default when the header is missing', () => {
    expect(pickWorkspaceId(null, 3, 1)).toBe(3)
  })

  it('falls back to the seeded default when header and user default are absent', () => {
    expect(pickWorkspaceId(undefined, null, 1)).toBe(1)
  })

  it('ignores malformed / non-positive header values and uses the next candidate', () => {
    expect(pickWorkspaceId('abc', 3, 1)).toBe(3)
    expect(pickWorkspaceId('0', null, 1)).toBe(1)
    expect(pickWorkspaceId('-5', undefined, 9)).toBe(9)
  })

  it('returns null when nothing valid is available', () => {
    expect(pickWorkspaceId(null, null, null)).toBeNull()
  })
})

/* ================================================================
   POST /api/workspaces — create adds an Owner membership
   ================================================================ */
describe('POST /api/workspaces (JL-73)', () => {
  it('creates a workspace and adds the caller as Owner', async () => {
    get.mockResolvedValueOnce(null) // slug uniqueness check → free
    run.mockResolvedValue({ lastID: 5, changes: 1 })
    get.mockResolvedValueOnce({ id: 5, name: 'Acme', slug: 'acme', owner_email: 'owner@test.com', created_at: 'now' })

    const res = await request(createApp()).post('/api/workspaces').send({ name: 'Acme' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe(5)
    expect(res.body.slug).toBe('acme')
    // Owner membership insert happened.
    const memberInsert = run.mock.calls.find((c) => /workspace_members/i.test(c[0]))
    expect(memberInsert).toBeTruthy()
    expect(memberInsert[0]).toMatch(/Owner/)
  })

  it('rejects a missing name with 400', async () => {
    const res = await request(createApp()).post('/api/workspaces').send({})
    expect(res.status).toBe(400)
  })
})

/* ================================================================
   GET /api/workspaces — list the caller's workspaces
   ================================================================ */
describe('GET /api/workspaces (JL-73)', () => {
  it("returns the caller's workspace memberships", async () => {
    all.mockResolvedValue([
      { id: 1, name: 'Default Workspace', slug: 'default', owner_email: 'owner@test.com', role: 'Owner' },
      { id: 2, name: 'Acme', slug: 'acme', owner_email: 'owner@test.com', role: 'Admin' },
    ])

    const res = await request(createApp()).get('/api/workspaces')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].slug).toBe('default')
    // Scoped by the caller's email.
    expect(all.mock.calls[0][1]).toEqual(['owner@test.com'])
  })
})

/* ================================================================
   POST /api/workspaces/:id/members — add a member
   ================================================================ */
describe('POST /api/workspaces/:id/members (JL-73)', () => {
  it('adds a member when the caller is a global Admin', async () => {
    run.mockResolvedValue({ lastID: 9, changes: 1 })
    get.mockResolvedValueOnce({ id: 9, workspace_id: 2, member_email: 'newbie@test.com', role: 'Member', created_at: 'now' })

    const res = await request(createApp()).post('/api/workspaces/2/members').send({ email: 'newbie@test.com' })

    expect(res.status).toBe(201)
    expect(res.body.member_email).toBe('newbie@test.com')
    expect(run.mock.calls[0][0]).toMatch(/workspace_members/i)
  })

  it('rejects a member with no email (400)', async () => {
    const res = await request(createApp()).post('/api/workspaces/2/members').send({})
    expect(res.status).toBe(400)
  })

  it('forbids a non-privileged caller (403)', async () => {
    const viewer = { id: 2, email: 'viewer@test.com', memberId: 2, workspaceRole: 'Viewer', isOwner: false }
    get.mockResolvedValueOnce(null) // caller has no privileged workspace membership

    const res = await request(createApp(viewer)).post('/api/workspaces/2/members').send({ email: 'x@test.com' })

    expect(res.status).toBe(403)
  })
})

/* ================================================================
   GET /api/workspaces/current — resolves the default workspace
   ================================================================ */
describe('GET /api/workspaces/current (JL-73)', () => {
  it('falls back to the seeded default when no workspace context is set', async () => {
    get.mockResolvedValue({ id: 1, name: 'Default Workspace', slug: 'default', owner_email: '', created_at: 'now' })

    const res = await request(createApp()).get('/api/workspaces/current')

    expect(res.status).toBe(200)
    expect(res.body.slug).toBe('default')
  })

  it('returns the workspace matching req.workspaceId when present', async () => {
    get.mockResolvedValue({ id: 2, name: 'Acme', slug: 'acme', owner_email: 'owner@test.com', created_at: 'now' })

    const res = await request(createApp(undefined, 2)).get('/api/workspaces/current')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(2)
    expect(get.mock.calls[0][1]).toEqual([2])
  })
})
