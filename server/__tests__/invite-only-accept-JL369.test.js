// @vitest-environment node
//
// JL-369 — under the `invite_only` signup policy, redeeming an invitation link
// locked the invitee out.
//
// The dead-end this pins:
//   1. POST /api/invitations/:token/accept marks the invitation 'accepted' and
//      upserts a `members` row. It does NOT create a `users` row or a password,
//      so the invitee must still complete POST /api/auth/signup.
//   2. checkSignupAllowed() (server/services/signupPolicy.js) required a
//      *pending* invitation under `invite_only`.
//
// So: click the emailed link -> accept -> refused at signup, because the
// invitation is no longer pending. Redeeming the link blocked the very signup
// it existed to authorise. Latent in production only because the default policy
// is 'open'.
//
// These tests drive the two routes against a small in-memory database so the
// accept and the signup really share state — the accept's UPDATE is what the
// signup gate then reads. The invitation SQL is interpreted from the statement
// the production code actually issues (which statuses it names, whether it
// requires expires_at > NOW()), so widening or narrowing that gate is visible
// here rather than silently absorbed by a stub.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

/* ── In-memory database ────────────────────────────────────────────────── */

const db = vi.hoisted(() => {
  const state = {
    invitations: [],
    members: [],
    users: [],
    blocked: [],
    seq: 0,
  }

  const nextId = () => ++state.seq
  const lower = (v) => String(v ?? '').trim().toLowerCase()
  const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString()

  function reset() {
    state.invitations = []
    state.members = []
    state.users = []
    state.blocked = []
    state.seq = 0
  }

  // Interpret the invitation lookup from the SQL the caller actually wrote:
  // which statuses it names, and whether it demands an unexpired row. This is
  // deliberate — the point of JL-369 is exactly which statuses count.
  function matchInvitationGate(sql, email) {
    const statuses = new Set(
      [...sql.matchAll(/'(pending|accepted|revoked)'/g)].map((m) => m[1]),
    )
    const requiresUnexpired = /expires_at\s*>\s*NOW\(\)/i.test(sql)
    const now = Date.now()
    return state.invitations
      .filter((inv) => lower(inv.email) === lower(email))
      .filter((inv) => statuses.size === 0 || statuses.has(inv.status))
      .filter((inv) => !requiresUnexpired || new Date(inv.expires_at).getTime() > now)
      .sort((a, b) => b.id - a.id)[0]
  }

  const get = vi.fn(async (sql, params = []) => {
    const s = String(sql)

    if (/FROM blocked_signups/i.test(s)) {
      const row = state.blocked.find((b) => lower(b.email) === lower(params[0]))
      return row ? { id: row.id } : undefined
    }

    if (/FROM invitations/i.test(s)) {
      if (/WHERE token\s*=/i.test(s)) {
        return state.invitations.find((inv) => inv.token === params[0])
      }
      if (/WHERE id\s*=/i.test(s)) {
        return state.invitations.find((inv) => inv.id === Number(params[0]))
      }
      return matchInvitationGate(s, params[0])
    }

    if (/COUNT\(\*\)\s+AS count FROM members/i.test(s)) {
      return { count: state.members.length }
    }
    if (/FROM members/i.test(s)) {
      if (/WHERE id\s*=/i.test(s)) return state.members.find((m) => m.id === Number(params[0]))
      return state.members.find((m) => lower(m.email) === lower(params[0]))
    }

    if (/COUNT\(\*\)\s+AS count FROM users/i.test(s)) {
      return { count: state.users.length }
    }
    if (/FROM users/i.test(s)) {
      if (/WHERE id\s*=/i.test(s)) return state.users.find((u) => u.id === Number(params[0]))
      return state.users.find((u) => lower(u.email) === lower(params[0]))
    }

    // security_policy, workspaces, everything else: absent -> defaults apply.
    return undefined
  })

  const run = vi.fn(async (sql, params = []) => {
    const s = String(sql)

    if (/INSERT INTO invitations/i.test(s)) {
      const [email, role, token, invited_by, status, expires_at] = params
      const row = { id: nextId(), email, role, token, invited_by, status, expires_at }
      state.invitations.push(row)
      return { lastID: row.id, changes: 1 }
    }
    if (/UPDATE invitations SET status/i.test(s)) {
      const status = (s.match(/SET status\s*=\s*'(\w+)'/i) || [])[1]
      let targets
      if (/WHERE id\s*=/i.test(s)) {
        targets = state.invitations.filter((inv) => inv.id === Number(params[0]))
      } else {
        targets = state.invitations.filter(
          (inv) => lower(inv.email) === lower(params[0]) && inv.status === 'pending',
        )
      }
      targets.forEach((inv) => { inv.status = status })
      return { lastID: 0, changes: targets.length }
    }

    if (/INSERT INTO members/i.test(s)) {
      const [name, email, role, status] = params
      const row = { id: nextId(), name, email, role, status }
      state.members.push(row)
      return { lastID: row.id, changes: 1 }
    }
    if (/UPDATE members SET role/i.test(s)) {
      const m = state.members.find((x) => x.id === Number(params[1]))
      if (m) { m.role = params[0]; m.status = 'Active' }
      return { lastID: 0, changes: m ? 1 : 0 }
    }
    if (/DELETE FROM members/i.test(s)) {
      const before = state.members.length
      state.members = state.members.filter((m) => m.id !== Number(params[0]))
      return { lastID: 0, changes: before - state.members.length }
    }

    if (/INSERT INTO users/i.test(s)) {
      const row = { id: nextId(), email: params[0], password_hash: params[1], created_at: 'now' }
      state.users.push(row)
      return { lastID: row.id, changes: 1 }
    }

    if (/INSERT INTO blocked_signups/i.test(s)) {
      if (!state.blocked.some((b) => lower(b.email) === lower(params[0]))) {
        state.blocked.push({ id: nextId(), email: params[0], reason: params[1] })
      }
      return { lastID: 0, changes: 1 }
    }
    if (/DELETE FROM blocked_signups/i.test(s)) {
      const before = state.blocked.length
      state.blocked = state.blocked.filter((b) => lower(b.email) !== lower(params[0]))
      return { lastID: 0, changes: before - state.blocked.length }
    }

    return { lastID: 0, changes: 0 }
  })

  const all = vi.fn(async () => [])

  return { state, get, run, all, reset, future, past }
})

vi.mock('../db.js', () => ({
  get: db.get,
  run: db.run,
  all: db.all,
  withTransaction: vi.fn(async (fn) => fn({ get: db.get, run: db.run, all: db.all })),
  getSetting: vi.fn(async (key, fallback = null) =>
    (key === 'signup_policy' ? policyState.value : fallback)),
  setSetting: vi.fn(),
  columnExists: vi.fn(async () => true),
  tableExists: vi.fn(async () => true),
}))

const policyState = vi.hoisted(() => ({ value: 'invite_only' }))

vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue({ ok: true, messageId: 'test' }),
  buildInviteEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  buildPasswordResetEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  isSmtpConfigured: vi.fn().mockReturnValue(false),
  getLatestEmailStatuses: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))

import { errorHandler } from '../middleware/errorHandler.js'
import invitationsRouter from '../routes/invitations.js'
import authRouter from '../routes/auth.js'

/* ── Apps ──────────────────────────────────────────────────────────────── */

function inviteApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@sedintechnologies.com', memberId: 1, workspaceRole: 'Admin', isOwner: true }
    next()
  })
  app.use('/api/invitations', invitationsRouter)
  app.use(errorHandler)
  return app
}

function authApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use(errorHandler)
  return app
}

const PASSWORD = 'Test1234!'
let invites
let auth

beforeEach(() => {
  db.reset()
  db.get.mockClear()
  db.run.mockClear()
  policyState.value = 'invite_only'
  invites = inviteApp()
  auth = authApp()
  // A pre-existing member so the signing-up invitee is never "the first user"
  // (which would make them Owner and mask the gate under test).
  db.state.members.push({ id: 1000, name: 'admin', email: 'admin@sedintechnologies.com', role: 'Admin', status: 'Active' })
  db.state.users.push({ id: 1001, email: 'admin@sedintechnologies.com', password_hash: 'x', created_at: 'now' })
})

/** Create an invitation through the real Admin route and return its row. */
async function createInvite(email, role = 'Member') {
  const res = await request(invites).post('/api/invitations').send({ email, role })
  expect(res.status).toBe(201)
  return db.state.invitations.find((i) => i.id === res.body.id)
}

const signup = (email, password = PASSWORD) =>
  request(auth).post('/api/auth/signup').send({ email, password })

/* ── The regression ────────────────────────────────────────────────────── */

describe('JL-369 — invite_only: accepting the link must not block signup', () => {
  it('invited address: accept the link, then signup SUCCEEDS', async () => {
    const email = 'invitee@sedintechnologies.com'
    const invite = await createInvite(email, 'Member')

    // 1. Redeem the emailed link.
    const accepted = await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})
    expect(accepted.status).toBe(200)
    expect(accepted.body.ok).toBe(true)
    // Accept created the member row but NO login — that is why signup must follow.
    expect(db.state.members.some((m) => m.email === email)).toBe(true)
    expect(db.state.users.some((u) => u.email === email)).toBe(false)
    expect(db.state.invitations.find((i) => i.id === invite.id).status).toBe('accepted')

    // 2. Complete signup. Before JL-369 this was a 403: the invitation was no
    //    longer 'pending', so checkSignupAllowed refused the invited person.
    const res = await signup(email)
    expect(res.status).toBe(201)
    expect(res.body.user.email).toBe(email)
    expect(res.body.token).toBeTruthy()
    expect(db.state.users.some((u) => u.email === email)).toBe(true)
  })

  it('the invited role from the accept survives signup', async () => {
    const email = 'lead@sedintechnologies.com'
    const invite = await createInvite(email, 'Admin')
    await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})
    await signup(email)
    // Signup must not demote the accepted invitee to Viewer.
    expect(db.state.members.find((m) => m.email === email).role).toBe('Admin')
  })

  it('signup still works for a still-pending invitation (the un-redeemed path)', async () => {
    const email = 'direct@sedintechnologies.com'
    await createInvite(email)
    const res = await signup(email)
    expect(res.status).toBe(201)
  })
})

/* ── The gate must not have widened ────────────────────────────────────── */

describe('JL-369 — invite_only still refuses everyone it should', () => {
  it('refuses an uninvited address', async () => {
    const res = await signup('stranger@sedintechnologies.com')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/invitation only/i)
    expect(db.state.users.some((u) => u.email === 'stranger@sedintechnologies.com')).toBe(false)
  })

  it('refuses an address whose invitation was REVOKED before acceptance', async () => {
    const email = 'revoked@sedintechnologies.com'
    const invite = await createInvite(email)
    const del = await request(invites).delete(`/api/invitations/${invite.id}`)
    expect(del.status).toBe(200)

    // The link itself is dead...
    const accepted = await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})
    expect(accepted.status).toBe(400)
    expect(accepted.body.error).toMatch(/revoked/i)

    // ...and so is signup.
    const res = await signup(email)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/invitation only/i)
  })

  it('refuses an address whose invitation was revoked AFTER acceptance', async () => {
    const email = 'revoked-late@sedintechnologies.com'
    const invite = await createInvite(email)
    await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})
    // Admin changes their mind before the invitee sets a password.
    await request(invites).delete(`/api/invitations/${invite.id}`)

    const res = await signup(email)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/invitation only/i)
  })

  it('refuses an EXPIRED pending invitation', async () => {
    const email = 'expired@sedintechnologies.com'
    const invite = await createInvite(email)
    invite.expires_at = db.past()

    const accepted = await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})
    expect(accepted.status).toBe(400)
    expect(accepted.body.error).toMatch(/expired/i)

    const res = await signup(email)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/invitation only/i)
  })

  it('refuses a STALE accepted invitation — acceptance does not authorise forever', async () => {
    // This is the window that bounds JL-369's widening: an accepted invitation
    // only authorises signup inside the invitation's original expiry (7 days;
    // accept does not extend it). Someone who accepted a year ago, and was
    // since removed from the workspace, must not still be able to register.
    const email = 'stale@sedintechnologies.com'
    const invite = await createInvite(email)
    await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})
    expect(db.state.invitations.find((i) => i.id === invite.id).status).toBe('accepted')

    // ...a year passes.
    invite.expires_at = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()

    const res = await signup(email)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/invitation only/i)
  })

  it('the open policy is unchanged', async () => {
    policyState.value = 'open'
    const res = await signup('anyone@sedintechnologies.com')
    expect(res.status).toBe(201)
  })
})

/* ── JL-325 deny-list ordering ─────────────────────────────────────────── */

describe('JL-369 — the JL-325 deny-list still wins', () => {
  it('refuses a blocked address that holds a live PENDING invitation', async () => {
    const email = 'blocked@sedintechnologies.com'
    await createInvite(email)
    db.state.blocked.push({ id: 900, email, reason: 'member removed' })

    const res = await signup(email)
    expect(res.status).toBe(403)
    // The deny-list message, not the policy message — block is checked first.
    expect(res.body.error).toMatch(/not permitted to register/i)
    expect(res.body.error).not.toMatch(/invitation only/i)
  })

  it('refuses a blocked address that has ACCEPTED its invitation', async () => {
    const email = 'blocked-accepted@sedintechnologies.com'
    const invite = await createInvite(email)
    await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})
    // Removed from the workspace after accepting but before setting a password.
    db.state.blocked.push({ id: 901, email, reason: 'member removed' })

    const res = await signup(email)
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not permitted to register/i)
    expect(db.state.users.some((u) => u.email === email)).toBe(false)
  })

  it('removed-then-re-invited: the fresh invite lifts the block and signup works', async () => {
    const email = 'returning@sedintechnologies.com'
    db.state.blocked.push({ id: 902, email, reason: 'member removed' })
    expect((await signup(email)).status).toBe(403)

    // JL-325: creating an invitation is an explicit re-admission.
    const invite = await createInvite(email)
    expect(db.state.blocked.some((b) => b.email === email)).toBe(false)

    await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})
    const res = await signup(email)
    expect(res.status).toBe(201)
  })
})

/* ── Single use ────────────────────────────────────────────────────────── */

describe('JL-369 — an invitation cannot be redeemed twice', () => {
  it('a second accept on the same token is refused', async () => {
    const email = 'once@sedintechnologies.com'
    const invite = await createInvite(email)

    expect((await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})).status).toBe(200)

    const second = await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})
    expect(second.status).toBe(400)
    expect(second.body.error).toMatch(/already been accepted/i)
  })

  it('a second signup on the same accepted invitation is refused', async () => {
    const email = 'once-signup@sedintechnologies.com'
    const invite = await createInvite(email)
    await request(invites).post(`/api/invitations/${invite.token}/accept`).send({})

    expect((await signup(email)).status).toBe(201)

    // The invitation is spent because the account now exists.
    const second = await signup(email)
    expect(second.status).toBe(409)
    expect(second.body.error).toMatch(/already registered/i)
    expect(db.state.users.filter((u) => u.email === email)).toHaveLength(1)
  })

  it('re-inviting revokes the earlier invitation so only the newest token works', async () => {
    const email = 'reinvited@sedintechnologies.com'
    const first = await createInvite(email)
    const second = await createInvite(email)

    const stale = await request(invites).post(`/api/invitations/${first.token}/accept`).send({})
    expect(stale.status).toBe(400)
    expect(stale.body.error).toMatch(/revoked/i)

    const fresh = await request(invites).post(`/api/invitations/${second.token}/accept`).send({})
    expect(fresh.status).toBe(200)
  })
})
