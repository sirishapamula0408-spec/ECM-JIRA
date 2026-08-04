import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (mocked-db style — modeled on member-role-validation-JL246.test.js
// and workspaces-JL73.test.js). No real Postgres.
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

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import workspaceRoutes from '../routes/workspaces.js'

// Build an app with a stubbed auth context.
function createApp(user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    next()
  })
  app.use('/api/workspaces', workspaceRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks does not drop queued mockResolvedValueOnce values; after the
  // fix the rejection tests never consume their queued DB responses, so reset
  // the queues too to keep tests isolated.
  run.mockReset()
  get.mockReset()
})

/* ================================================================
   JL-350: POST /api/workspaces/:id/members must validate the role.
   Before this fix the role string went straight from req.body into an
   ON CONFLICT ... DO UPDATE SET role = EXCLUDED.role upsert, so a
   workspace Admin could upsert THEMSELVES to 'Owner' (privilege
   escalation) and arbitrary strings created broken memberships.
   ================================================================ */
describe('JL-350 — POST /api/workspaces/:id/members validates the role field', () => {
  it('rejects role "Owner" with 400 — a workspace Admin cannot self-escalate to Owner', async () => {
    // Caller is NOT globally privileged; they hold a workspace-level Admin role
    // and try to upsert their OWN email as Owner (the escalation path).
    const wsAdmin = { id: 2, email: 'ws.admin@test.com', memberId: 2, workspaceRole: 'Member', isOwner: false }
    get.mockResolvedValueOnce({ role: 'Admin' }) // caller's workspace membership lookup
    // If validation is missing, the upsert would run and hand back an Owner row —
    // these mocks make the escalation observable (201 + role 'Owner') pre-fix.
    run.mockResolvedValue({ lastID: 2, changes: 1 })
    get.mockResolvedValueOnce({ id: 2, workspace_id: 2, member_email: 'ws.admin@test.com', role: 'Owner', created_at: 'now' })

    const res = await request(createApp(wsAdmin))
      .post('/api/workspaces/2/members')
      .send({ email: 'ws.admin@test.com', role: 'Owner' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Owner role cannot be assigned/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an arbitrary role string with 400 and persists nothing', async () => {
    const res = await request(createApp())
      .post('/api/workspaces/2/members')
      .send({ email: 'newbie@test.com', role: 'bogus' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid role\. Allowed roles:/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects lowercase "admin" (validation is case-sensitive, matching invitations/members/projects)', async () => {
    // A lowercase role would insert fine but rank 0 in every later ROLE_RANK
    // lookup — a member that silently fails all privilege checks.
    const res = await request(createApp())
      .post('/api/workspaces/2/members')
      .send({ email: 'newbie@test.com', role: 'admin' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid role\. Allowed roles:/i)
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['Admin', 'Member', 'Viewer'])('accepts assignable role %s and stores it', async (role) => {
    run.mockResolvedValue({ lastID: 9, changes: 1 })
    get.mockResolvedValueOnce({ id: 9, workspace_id: 2, member_email: 'newbie@test.com', role, created_at: 'now' })

    const res = await request(createApp())
      .post('/api/workspaces/2/members')
      .send({ email: 'newbie@test.com', role })

    expect(res.status).toBe(201)
    expect(res.body.role).toBe(role)
    const memberInsert = run.mock.calls.find((c) => /workspace_members/i.test(c[0]))
    expect(memberInsert).toBeTruthy()
    expect(memberInsert[1]).toContain(role)
  })

  it('still defaults to Member when no role is supplied', async () => {
    run.mockResolvedValue({ lastID: 10, changes: 1 })
    get.mockResolvedValueOnce({ id: 10, workspace_id: 2, member_email: 'newbie@test.com', role: 'Member', created_at: 'now' })

    const res = await request(createApp())
      .post('/api/workspaces/2/members')
      .send({ email: 'newbie@test.com' })

    expect(res.status).toBe(201)
    const memberInsert = run.mock.calls.find((c) => /workspace_members/i.test(c[0]))
    expect(memberInsert[1]).toContain('Member')
  })
})
