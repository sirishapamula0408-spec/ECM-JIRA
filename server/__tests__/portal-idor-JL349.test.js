// @vitest-environment node
//
// JL-349: IDOR fix for GET /api/portal/requests.
//
// Before the fix the endpoint filtered portal_requests purely on the caller-
// supplied ?email= query parameter, so any authenticated user could read any
// other customer's submitted requests (issue keys, titles, statuses) just by
// changing the parameter. The fix binds the listing to req.user.email — the
// "my things" convention used by apiTokens.js / sessions.js — and honours an
// explicit ?email= only for workspace Owners/Admins. A non-privileged caller
// passing someone else's email has the parameter IGNORED and gets their own
// rows (not a 403): the endpoint is a "my requests" view, so session scoping
// is the correct answer regardless of input.
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
    withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
  }
})

import { all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import portalRoutes from '../routes/portal.js'

// Build an app with a stubbed authenticated user (mirrors portal-JL140.test.js).
function createApp({ email = 'member@test.com', role = 'Member', isOwner = false } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email, memberId: 1, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api', portalRoutes)
  app.use(errorHandler)
  return app
}

const VICTIM_ROW = {
  id: 1,
  requester_email: 'victim@acme.com',
  request_type_id: 5,
  created_at: 'now',
  issue_key: 'SUP-42',
  title: 'Victim private request',
  status: 'In Progress',
  issue_type: 'Bug',
  request_type_name: 'Bug report',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/portal/requests — IDOR (JL-349)', () => {
  it('ignores ?email= from a non-admin Member and scopes to their own session email', async () => {
    const app = createApp({ email: 'member@test.com', role: 'Member' })
    all.mockResolvedValue([])

    const res = await request(app).get('/api/portal/requests?email=victim@acme.com')

    expect(res.status).toBe(200)
    // The SQL must have been bound to the caller's session email —
    // never to the attacker-controlled query parameter.
    const boundParams = all.mock.calls[0][1]
    expect(boundParams).toContain('member@test.com')
    expect(boundParams).not.toContain('victim@acme.com')
  })

  it('does not leak another user rows to a non-admin even if the db would match them', async () => {
    const app = createApp({ email: 'member@test.com', role: 'Member' })
    // Simulate the db: only return the victim's row when the victim's email is bound.
    all.mockImplementation(async (_sql, params) =>
      params.some((p) => String(p).toLowerCase() === 'victim@acme.com') ? [VICTIM_ROW] : [],
    )

    const res = await request(app).get('/api/portal/requests?email=victim@acme.com')

    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('honours ?email= for a workspace Admin (support-desk view)', async () => {
    const app = createApp({ email: 'admin@test.com', role: 'Admin' })
    all.mockImplementation(async (_sql, params) =>
      params.some((p) => String(p).toLowerCase() === 'victim@acme.com') ? [VICTIM_ROW] : [],
    )

    const res = await request(app).get('/api/portal/requests?email=victim@acme.com')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].issueKey).toBe('SUP-42')
    expect(all.mock.calls[0][1]).toContain('victim@acme.com')
  })

  it('honours ?email= for the workspace Owner regardless of role', async () => {
    const app = createApp({ email: 'owner@test.com', role: 'Member', isOwner: true })
    all.mockResolvedValue([])

    const res = await request(app).get('/api/portal/requests?email=victim@acme.com')

    expect(res.status).toBe(200)
    expect(all.mock.calls[0][1]).toContain('victim@acme.com')
  })

  it('returns the caller own rows when ?email= is omitted', async () => {
    const app = createApp({ email: 'member@test.com', role: 'Member' })
    all.mockResolvedValue([{ ...VICTIM_ROW, requester_email: 'member@test.com', title: 'My request' }])

    const res = await request(app).get('/api/portal/requests')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].requesterEmail).toBe('member@test.com')
    expect(all.mock.calls[0][1]).toContain('member@test.com')
  })
})
