import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mocked-db so importing authorize.js / members.js never touches a real pool.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue(true),
  buildInviteEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
}))

import { run, get } from '../db.js'
import { requireRole, ROLE_RANK } from '../middleware/authorize.js'
import { errorHandler } from '../middleware/errorHandler.js'

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   JL-317: a member whose role column is the literal string 'Owner'
   with is_owner=false used to rank 0 (below Viewer) and be locked out
   of every role-gated route. Fix: rank 'Owner' in ROLE_RANK, and reject
   role='Owner' on PATCH so the inconsistent state can't be created.
   ================================================================ */
describe('JL-317 — ROLE_RANK ranks the Owner role', () => {
  // Drive requireRole's middleware directly (no HTTP needed).
  function runMw(user, allowed) {
    const req = { user }
    let status = null
    let nexted = false
    const res = {
      status(c) { status = c; return this },
      json() { return this },
    }
    requireRole(...allowed)(req, res, () => { nexted = true })
    return { status, nexted }
  }

  it('Owner outranks Admin', () => {
    expect(ROLE_RANK.Owner).toBeGreaterThan(ROLE_RANK.Admin)
  })

  it('a member with role="Owner" (is_owner=false) now PASSES an Admin-gated route', () => {
    const r = runMw({ isOwner: false, workspaceRole: 'Owner' }, ['Admin'])
    expect(r.nexted).toBe(true)
    expect(r.status).toBeNull()
  })

  it('the real Owner (isOwner=true) still bypasses', () => {
    const r = runMw({ isOwner: true, workspaceRole: 'Admin' }, ['Admin'])
    expect(r.nexted).toBe(true)
  })

  it('a Viewer is still denied an Admin-gated route (no over-permissioning)', () => {
    const r = runMw({ isOwner: false, workspaceRole: 'Viewer' }, ['Admin'])
    expect(r.nexted).toBe(false)
    expect(r.status).toBe(403)
  })
})

describe('JL-317 — PATCH /api/members/:id rejects role="Owner"', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/members.js')
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
      next()
    })
    app.use('/api/members', mod.default || mod)
    app.use(errorHandler)
  })

  it('returns 400 and does not touch the member when role="Owner"', async () => {
    const res = await request(app).patch('/api/members/5').send({ role: 'Owner' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/owner role cannot be assigned/i)
    // rejected before the member SELECT / any write
    expect(get).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('still allows a valid role change (role="Member") on a non-owner', async () => {
    get
      .mockResolvedValueOnce({ id: 5, name: 'X', email: 'x@test.com', role: 'Viewer', status: 'Active', task_count: 0, invited_by: 'A', is_owner: false })
      .mockResolvedValueOnce({ id: 5, name: 'X', email: 'x@test.com', role: 'Member', status: 'Active', task_count: 0, invited_by: 'A' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/members/5').send({ role: 'Member' })

    expect(res.status).toBe(200)
    expect(res.body.role).toBe('Member')
  })
})
