// @vitest-environment node
//
// JL-371 — accepting an invitation granted a role but could not provision a login.
//
// The half-step this pins:
//   POST /api/invitations/:token/accept upserted a `members` row and flipped the
//   invitation to 'accepted'. It created no `users` row, no password and no
//   session. The invitee was handed a role in a workspace they had no way to
//   sign in to; the only route to an actual account was POST /api/auth/signup,
//   a second, separate flow the invite link never led to.
//
// These tests drive the real accept route and the real auth routes against one
// shared in-memory database, so a login here really is the login the invitee
// would perform: the row the accept writes is the row /api/auth/login reads.
// Password hashing is NOT stubbed — verifyPassword() from the production module
// is used to prove the stored hash is a hash, and the login route is exercised
// end to end rather than asserted on a plaintext comparison.

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
  const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString()

  function reset() {
    state.invitations = []
    state.members = []
    state.users = []
    state.blocked = []
    state.seq = 0
  }

  // Interpret the invitation gate from the SQL the caller actually wrote, so a
  // widening or narrowing of which statuses authorise signup is visible here
  // rather than absorbed by a stub. (Same technique as the JL-369 suite.)
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
      if (/WHERE token\s*=/i.test(s)) return state.invitations.find((inv) => inv.token === params[0])
      if (/WHERE id\s*=/i.test(s)) return state.invitations.find((inv) => inv.id === Number(params[0]))
      return matchInvitationGate(s, params[0])
    }

    if (/COUNT\(\*\)\s+AS count FROM members/i.test(s)) return { count: state.members.length }
    if (/FROM members/i.test(s)) {
      if (/WHERE id\s*=/i.test(s)) return state.members.find((m) => m.id === Number(params[0]))
      return state.members.find((m) => lower(m.email) === lower(params[0]))
    }

    if (/COUNT\(\*\)\s+AS count FROM users/i.test(s)) return { count: state.users.length }
    if (/FROM users/i.test(s)) {
      if (/WHERE id\s*=/i.test(s)) return state.users.find((u) => u.id === Number(params[0]))
      return state.users.find((u) => lower(u.email) === lower(params[0]))
    }

    // security_policy, workspaces, audit_log, everything else: absent -> the
    // production defaults apply (min_password_length 8, signup policy fallback).
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
      const targets = /WHERE id\s*=/i.test(s)
        ? state.invitations.filter((inv) => inv.id === Number(params[0]))
        : state.invitations.filter((inv) => lower(inv.email) === lower(params[0]) && inv.status === 'pending')
      targets.forEach((inv) => { inv.status = status })
      return { lastID: 0, changes: targets.length }
    }

    if (/INSERT INTO members/i.test(s)) {
      const [name, email, role, status, , invited_by] = params
      const row = { id: nextId(), name, email, role, status, invited_by }
      state.members.push(row)
      return { lastID: row.id, changes: 1 }
    }
    if (/UPDATE members SET role/i.test(s)) {
      const m = state.members.find((x) => x.id === Number(params[1]))
      if (m) { m.role = params[0]; m.status = 'Active' }
      return { lastID: 0, changes: m ? 1 : 0 }
    }

    if (/INSERT INTO users/i.test(s)) {
      const row = {
        id: nextId(),
        email: params[0],
        password_hash: params[1],
        created_at: new Date().toISOString(),
        status: 'Active',
        mfa_enabled: false,
        mfa_secret: null,
        // Mirror the literal NOW() the statement writes — the point of the
        // password_changed_at assertions is that the column is really stamped.
        password_changed_at: /password_changed_at/i.test(s) ? new Date().toISOString() : null,
      }
      state.users.push(row)
      return { lastID: row.id, changes: 1 }
    }
    if (/UPDATE users SET password_hash/i.test(s)) {
      // Nothing in the accept flow may take this path — see the collision test.
      const u = state.users.find((x) => x.id === Number(params[params.length - 1]))
      if (u) u.password_hash = params[0]
      return { lastID: 0, changes: u ? 1 : 0 }
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

  return { state, get, run, all, reset, past }
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

const policyState = vi.hoisted(() => ({ value: 'open' }))

vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue({ ok: true, messageId: 'test' }),
  buildInviteEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  buildPasswordResetEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  isSmtpConfigured: vi.fn().mockReturnValue(false),
  getLatestEmailStatuses: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))

import { errorHandler } from '../middleware/errorHandler.js'
import { hashPassword, verifyPassword } from '../middleware/validate.js'
import invitationsRouter, { publicRouter as publicInvitationsRouter } from '../routes/invitations.js'
import authRouter, { setLoginLockout } from '../routes/auth.js'
import { createLoginLockout } from '../middleware/loginLockout.js'

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

// No auth middleware at all — the shape server/index.js mounts ahead of
// `protect`, i.e. what a signed-out invitee actually talks to.
function signedOutApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/invitations', publicInvitationsRouter)
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

const PASSWORD = 'Invited123!'
let invites
let auth

beforeEach(() => {
  db.reset()
  db.get.mockClear()
  db.run.mockClear()
  policyState.value = 'open'
  invites = inviteApp()
  auth = authApp()
  // Isolated lockout tracker so repeated logins in this suite never trip the
  // shared process-wide singleton (see setLoginLockout in routes/auth.js).
  setLoginLockout(createLoginLockout({}))
  // A pre-existing admin so an invitee is never "the first member" (which would
  // make them Owner and mask the role grant under test).
  db.state.members.push({ id: 1000, name: 'admin', email: 'admin@sedintechnologies.com', role: 'Admin', status: 'Active' })
  db.state.users.push({
    id: 1001,
    email: 'admin@sedintechnologies.com',
    password_hash: hashPassword('AdminPass1!'),
    created_at: new Date().toISOString(),
    status: 'Active',
    mfa_enabled: false,
    mfa_secret: null,
    password_changed_at: new Date().toISOString(),
  })
})

/** Create an invitation through the real Admin route and return its row. */
async function createInvite(email, role = 'Member') {
  const res = await request(invites).post('/api/invitations').send({ email, role })
  expect(res.status).toBe(201)
  return db.state.invitations.find((i) => i.id === res.body.id)
}

/**
 * Insert a pending invitation directly.
 *
 * The create route refuses to invite an address that is already a member (409),
 * so a "second live token for someone who has already redeemed one" state is
 * only reachable by seeding. It is a real state all the same — a token already
 * sitting in an inbox when the member row appears — and it is the one that would
 * double-provision if the accept were not idempotent.
 */
function seedInvite(email, role = 'Member') {
  const row = {
    id: 9000 + db.state.invitations.length,
    email,
    role,
    token: `seeded-${role}-${email}`,
    invited_by: 'admin@sedintechnologies.com',
    status: 'pending',
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }
  db.state.invitations.push(row)
  return row
}

const accept = (token, body = {}) =>
  request(invites).post(`/api/invitations/${token}/accept`).send(body)

const login = (email, password) =>
  request(auth).post('/api/auth/login').send({ email, password })

const signup = (email, password = PASSWORD) =>
  request(auth).post('/api/auth/signup').send({ email, password })

/* ── 0: the invitee can actually reach the endpoint ────────────────────── */

describe('JL-371 — the accept endpoint is reachable without a session', () => {
  it('a signed-out invitee can look up and redeem their token', async () => {
    // /api/invitations was mounted wholesale behind authGuard, so following the
    // emailed link signed out returned 401 — a session was required to create
    // the session. Provisioning a login is worthless if this is unreachable.
    const email = 'signedout@sedintechnologies.com'
    const invite = await createInvite(email)
    const anonymous = signedOutApp()

    const lookup = await request(anonymous).get(`/api/invitations/${invite.token}`)
    expect(lookup.status).toBe(200)
    expect(lookup.body).toMatchObject({ email, role: 'Member', valid: true })

    const res = await request(anonymous)
      .post(`/api/invitations/${invite.token}/accept`)
      .send({ password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.accountCreated).toBe(true)
    expect((await login(email, PASSWORD)).status).toBe(200)
  })

  it('exposes only those two endpoints — the Admin CRUD is not on the public router', async () => {
    const anonymous = signedOutApp()
    expect((await request(anonymous).post('/api/invitations').send({ email: 'x@sedintechnologies.com' })).status).toBe(404)
    expect((await request(anonymous).get('/api/invitations')).status).toBe(404)
    expect((await request(anonymous).delete('/api/invitations/1')).status).toBe(404)
    expect((await request(anonymous).post('/api/invitations/1/resend')).status).toBe(404)
  })
})

/* ── 1 + 2 + 3: accepting provisions a real, usable account ────────────── */

describe('JL-371 — accepting with a password provisions the login', () => {
  it('creates the users row AND the members row, and grants the invited role', async () => {
    const email = 'newhire@sedintechnologies.com'
    const invite = await createInvite(email, 'Admin')

    const res = await accept(invite.token, { name: 'New Hire', password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.accountCreated).toBe(true)

    // The users row — the half that never used to exist.
    const users = db.state.users.filter((u) => u.email === email)
    expect(users).toHaveLength(1)
    expect(res.body.user).toMatchObject({ id: users[0].id, email })

    // The members row + role grant — unchanged behaviour.
    const members = db.state.members.filter((m) => m.email === email)
    expect(members).toHaveLength(1)
    expect(members[0].role).toBe('Admin')
    expect(members[0].status).toBe('Active')
    expect(members[0].name).toBe('New Hire')

    // And the invitation is spent.
    expect(db.state.invitations.find((i) => i.id === invite.id).status).toBe('accepted')
  })

  it('the invitee can then authenticate — the password is stored the way login expects', async () => {
    const email = 'canlogin@sedintechnologies.com'
    const invite = await createInvite(email)
    expect((await accept(invite.token, { password: PASSWORD })).status).toBe(200)

    const stored = db.state.users.find((u) => u.email === email)
    // Never the plaintext: a `salt:hash` pbkdf2 pair, exactly what
    // verifyPassword() (and therefore POST /api/auth/login) reads.
    expect(stored.password_hash).not.toContain(PASSWORD)
    expect(stored.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
    expect(verifyPassword(PASSWORD, stored.password_hash)).toBe(true)
    expect(verifyPassword('not-the-password', stored.password_hash)).toBe(false)

    // The real login route, against the row the accept just wrote.
    const ok = await login(email, PASSWORD)
    expect(ok.status).toBe(200)
    expect(ok.body.token).toBeTruthy()
    expect(ok.body.user.email).toBe(email)

    const wrong = await login(email, 'WrongPass1!')
    expect(wrong.status).toBe(401)
  })

  it('stamps password_changed_at so the JL-351 rotation policy covers invited users', async () => {
    const email = 'rotates@sedintechnologies.com'
    const invite = await createInvite(email)
    await accept(invite.token, { password: PASSWORD })

    const stored = db.state.users.find((u) => u.email === email)
    expect(stored.password_changed_at).toBeTruthy()
    expect(Number.isNaN(new Date(stored.password_changed_at).getTime())).toBe(false)

    // Written by the statement itself, as NOW() — the same way signup, reset and
    // change-password write it. isPasswordExpired() treats a missing timestamp as
    // expired, so an unstamped invited account would be flagged forever.
    const insert = db.run.mock.calls.find((c) => /INSERT INTO users/i.test(c[0]))
    expect(insert[0]).toMatch(/password_changed_at/i)
    expect(insert[0]).toMatch(/NOW\(\)/i)
  })

  it('issues a session, matching how a freshly registered user is treated', async () => {
    // Design decision (JL-371): accept-with-password auto-logs in, because it IS
    // a registration and POST /api/auth/signup returns { user, token } too.
    const email = 'autologin@sedintechnologies.com'
    const invite = await createInvite(email)
    const res = await accept(invite.token, { password: PASSWORD })

    expect(res.body.token).toBeTruthy()
    const [, payload] = String(res.body.token).split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    expect(claims.email).toBe(email)
    expect(claims.sub).toBe(db.state.users.find((u) => u.email === email).id)
  })
})

/* ── 4: the register path's password rules are reused, not bypassed ─────── */

describe('JL-371 — a weak password is rejected by the same validation as register', () => {
  it('rejects a policy-violating password with the identical error signup gives', async () => {
    const email = 'weak@sedintechnologies.com'
    const other = 'weak-signup@sedintechnologies.com'
    const invite = await createInvite(email)
    await createInvite(other)

    // 7 characters: clears the hard 6-char floor, fails the org policy's
    // min_password_length of 8 — i.e. this is validatePassword talking.
    const WEAK = 'abc1234'

    const accepted = await accept(invite.token, { password: WEAK })
    const registered = await signup(other, WEAK)

    expect(accepted.status).toBe(400)
    expect(registered.status).toBe(400)
    expect(accepted.body.error).toBe(registered.body.error)
    expect(accepted.body.error).toMatch(/at least 8 characters/i)
    expect(accepted.body.errors).toEqual(registered.body.errors)
  })

  it('rejects a password under the hard 6-character floor', async () => {
    const invite = await createInvite('tiny@sedintechnologies.com')
    const res = await accept(invite.token, { password: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at least 6 characters/i)
  })

  it('a rejected password leaves the invitation usable — nothing is written', async () => {
    const email = 'retry@sedintechnologies.com'
    const invite = await createInvite(email)

    expect((await accept(invite.token, { password: 'abc1234' })).status).toBe(400)
    expect(db.state.users.some((u) => u.email === email)).toBe(false)
    expect(db.state.members.some((m) => m.email === email)).toBe(false)
    expect(db.state.invitations.find((i) => i.id === invite.id).status).toBe('pending')

    // Second try with a good password succeeds.
    expect((await accept(invite.token, { password: PASSWORD })).status).toBe(200)
    expect((await login(email, PASSWORD)).status).toBe(200)
  })
})

/* ── 5: collision with an existing users row ───────────────────────────── */

describe('JL-371 — an existing account is linked, never duplicated or overwritten', () => {
  const EXISTING = 'veteran@sedintechnologies.com'
  const THEIR_PASSWORD = 'TheirOwnPass1!'

  function seedExistingUser() {
    const row = {
      id: 2000,
      email: EXISTING,
      password_hash: hashPassword(THEIR_PASSWORD),
      created_at: new Date('2024-01-01').toISOString(),
      status: 'Active',
      mfa_enabled: false,
      mfa_secret: null,
      password_changed_at: new Date('2024-01-01').toISOString(),
    }
    db.state.users.push(row)
    return row
  }

  it('grants the role without creating a second users row', async () => {
    const before = seedExistingUser()
    const invite = await createInvite(EXISTING, 'Admin')

    const res = await accept(invite.token, { password: 'BrandNewPass1!' })
    expect(res.status).toBe(200)
    expect(res.body.accountExisted).toBe(true)
    expect(res.body.accountCreated).toBe(false)

    expect(db.state.users.filter((u) => u.email === EXISTING)).toHaveLength(1)
    expect(db.state.users.find((u) => u.email === EXISTING).id).toBe(before.id)
    // The role grant still happened — that is the part an invitation is for.
    expect(db.state.members.find((m) => m.email === EXISTING).role).toBe('Admin')
    expect(db.state.invitations.find((i) => i.id === invite.id).status).toBe('accepted')
  })

  it('does not touch the existing password — an invite link is not proof of it', async () => {
    seedExistingUser()
    const invite = await createInvite(EXISTING)
    await accept(invite.token, { password: 'BrandNewPass1!' })

    // Their original password still works; the one submitted with the accept
    // does not. Anything else would make "invite an address" an account takeover.
    expect((await login(EXISTING, THEIR_PASSWORD)).status).toBe(200)
    expect((await login(EXISTING, 'BrandNewPass1!')).status).toBe(401)
    expect(db.run.mock.calls.some((c) => /UPDATE users SET password_hash/i.test(c[0]))).toBe(false)
  })

  it('says so explicitly rather than silently ignoring the submitted password', async () => {
    seedExistingUser()
    const invite = await createInvite(EXISTING)
    const res = await accept(invite.token, { password: 'BrandNewPass1!' })

    expect(res.body.message).toMatch(/already exists/i)
    expect(res.body.message).toMatch(/existing password/i)
    // And no session: nobody was authenticated here.
    expect(res.body.token).toBeUndefined()
  })
})

/* ── 6: idempotency ────────────────────────────────────────────────────── */

describe('JL-371 — accepting twice cannot double-provision', () => {
  it('a second accept on the same token is refused and duplicates nothing', async () => {
    const email = 'twice@sedintechnologies.com'
    const invite = await createInvite(email)

    const first = await accept(invite.token, { password: PASSWORD })
    expect(first.status).toBe(200)

    const second = await accept(invite.token, { password: 'DifferentPass1!' })
    expect(second.status).toBe(400)
    expect(second.body.error).toMatch(/already been accepted/i)

    expect(db.state.users.filter((u) => u.email === email)).toHaveLength(1)
    expect(db.state.members.filter((m) => m.email === email)).toHaveLength(1)
    // The first password is still the live one.
    expect((await login(email, PASSWORD)).status).toBe(200)
    expect((await login(email, 'DifferentPass1!')).status).toBe(401)
  })

  it('a second invitation for someone who already accepted re-grants the role only', async () => {
    // The other "accepted twice" shape: a second live token for the same address.
    // The second acceptance must link, not duplicate — this is the collision path
    // reached through the invitation flow itself.
    const email = 'reinvited@sedintechnologies.com'
    const first = await createInvite(email, 'Viewer')
    await accept(first.token, { password: PASSWORD })

    const second = seedInvite(email, 'Admin')
    const res = await accept(second.token, { password: 'YetAnotherPass1!' })
    expect(res.status).toBe(200)
    expect(res.body.accountExisted).toBe(true)

    expect(db.state.users.filter((u) => u.email === email)).toHaveLength(1)
    expect(db.state.members.filter((m) => m.email === email)).toHaveLength(1)
    expect(db.state.members.find((m) => m.email === email).role).toBe('Admin')
    expect((await login(email, PASSWORD)).status).toBe(200)
  })

  it('accepting without a password then with one still yields a single account', async () => {
    const email = 'staged@sedintechnologies.com'
    const first = await createInvite(email)
    // Legacy shape: role only, no login.
    const legacy = await accept(first.token, {})
    expect(legacy.status).toBe(200)
    expect(legacy.body.needsSignup).toBe(true)
    expect(db.state.users.some((u) => u.email === email)).toBe(false)

    // A second token, this time redeemed with a password.
    const second = seedInvite(email)
    expect((await accept(second.token, { password: PASSWORD })).status).toBe(200)
    expect(db.state.users.filter((u) => u.email === email)).toHaveLength(1)
    expect(db.state.members.filter((m) => m.email === email)).toHaveLength(1)
  })
})

/* ── 7: JL-369 and the JL-325 deny-list still hold ─────────────────────── */

describe('JL-371 — the invite_only rule (JL-369) is unchanged', () => {
  beforeEach(() => { policyState.value = 'invite_only' })

  it('an invited address can still provision through accept', async () => {
    const email = 'invited@sedintechnologies.com'
    const invite = await createInvite(email)
    expect((await accept(invite.token, { password: PASSWORD })).status).toBe(200)
    expect((await login(email, PASSWORD)).status).toBe(200)
  })

  it('an uninvited address still cannot register', async () => {
    const res = await signup('stranger@sedintechnologies.com')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/invitation only/i)
    expect(db.state.users.some((u) => u.email === 'stranger@sedintechnologies.com')).toBe(false)
  })

  it('accepting without a password still authorises the follow-up signup (the JL-369 fix)', async () => {
    const email = 'legacy-path@sedintechnologies.com'
    const invite = await createInvite(email)
    expect((await accept(invite.token, {})).status).toBe(200)
    // JL-369: the invitation is 'accepted', not 'pending' — signup must still pass.
    const res = await signup(email)
    expect(res.status).toBe(201)
    expect(db.state.users.filter((u) => u.email === email)).toHaveLength(1)
  })

  it('a revoked invitation provisions nothing, password or not', async () => {
    const email = 'revoked@sedintechnologies.com'
    const invite = await createInvite(email)
    expect((await request(invites).delete(`/api/invitations/${invite.id}`)).status).toBe(200)

    const res = await accept(invite.token, { password: PASSWORD })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/revoked/i)
    expect(db.state.users.some((u) => u.email === email)).toBe(false)
    expect((await signup(email)).status).toBe(403)
  })

  it('an expired invitation provisions nothing', async () => {
    const email = 'expired@sedintechnologies.com'
    const invite = await createInvite(email)
    invite.expires_at = db.past()

    const res = await accept(invite.token, { password: PASSWORD })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/expired/i)
    expect(db.state.users.some((u) => u.email === email)).toBe(false)
  })

  it('the JL-325 deny-list still wins — a blocked invitee cannot provision an account', async () => {
    // The gap this closes: an admin removes someone (blocking their address)
    // while an invitation issued earlier is still pending. Signup already refused
    // them (JL-369 suite); accept must too, now that accept creates accounts.
    const email = 'blocked@sedintechnologies.com'
    const invite = await createInvite(email)
    db.state.blocked.push({ id: 900, email, reason: 'member removed' })

    const res = await accept(invite.token, { password: PASSWORD })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not permitted to register/i)
    expect(db.state.users.some((u) => u.email === email)).toBe(false)
    expect(db.state.invitations.find((i) => i.id === invite.id).status).toBe('pending')
  })
})
