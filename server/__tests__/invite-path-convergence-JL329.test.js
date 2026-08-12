// @vitest-environment node
//
// JL-329 — two independent invite paths that left different traces.
//
// The divergence this pins:
//   POST /api/invitations wrote an `invitations` row (token + 7-day expiry).
//   POST /api/members wrote a `members` row with status='Invited' and an audit
//   entry — and NO `invitations` row at all.
//
// So `SELECT count(*) FROM invitations` returning 0 proved nothing; the Teams
// page's pending list (which reads `invitations`) could not see anyone added
// through the second path; "resend" meant two different things; and only the
// tokened path ever expired.
//
// These tests drive the REAL routes for both entry points against one shared
// in-memory database, and then drive the real JL-371 accept route and the real
// login route against the same rows — so "the members path now produces a
// redeemable invitation" is proved by actually redeeming it and logging in,
// not by asserting on a stub.

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
    audit: [],
    seq: 0,
  }

  const nextId = () => ++state.seq
  const lower = (v) => String(v ?? '').trim().toLowerCase()

  function reset() {
    state.invitations = []
    state.members = []
    state.users = []
    state.blocked = []
    state.audit = []
    state.seq = 0
  }

  // Interpret the invite_only signup gate from the SQL the caller actually
  // wrote, so a widening/narrowing of which statuses authorise signup shows up
  // here rather than being absorbed by a stub. (Same technique as JL-369/JL-371.)
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

    if (/COUNT\(\*\)\s+AS count FROM members/i.test(s)) {
      return { count: state.members.filter((m) => m.role === 'Admin' || m.role === 'Owner' || m.is_owner).length }
    }
    if (/COUNT\(\*\)::int AS total FROM members/i.test(s)) return { total: state.members.length }
    if (/FROM members/i.test(s)) {
      if (/WHERE id\s*=/i.test(s)) return state.members.find((m) => m.id === Number(params[0]))
      return state.members.find((m) => lower(m.email) === lower(params[0]))
    }

    if (/COUNT\(\*\)\s+AS count FROM users/i.test(s)) return { count: state.users.length }
    if (/FROM users/i.test(s)) {
      if (/WHERE id\s*=/i.test(s)) return state.users.find((u) => u.id === Number(params[0]))
      return state.users.find((u) => lower(u.email) === lower(params[0]))
    }

    // security_policy, workspaces, settings, …: absent → production defaults.
    return undefined
  })

  const run = vi.fn(async (sql, params = []) => {
    const s = String(sql)

    if (/INSERT INTO invitations/i.test(s)) {
      const [email, role, token, invited_by, status, expires_at] = params
      // The real column is UNIQUE; ON CONFLICT DO NOTHING must not duplicate.
      if (state.invitations.some((inv) => inv.token === token)) return { lastID: 0, changes: 0 }
      const row = {
        id: nextId(), email, role, token, invited_by, status, expires_at,
        created_at: new Date().toISOString(),
      }
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
      const row = { id: nextId(), name, email, role, status, task_count: 0, invited_by, is_owner: false }
      state.members.push(row)
      return { lastID: row.id, changes: 1 }
    }
    if (/UPDATE members SET role/i.test(s)) {
      const m = state.members.find((x) => x.id === Number(params[1]))
      if (m) { m.role = params[0]; m.status = 'Active' }
      return { lastID: 0, changes: m ? 1 : 0 }
    }
    if (/UPDATE members SET status/i.test(s)) {
      const m = state.members.find((x) => x.id === Number(params[1]))
      if (m) m.status = params[0]
      return { lastID: 0, changes: m ? 1 : 0 }
    }

    if (/INSERT INTO users/i.test(s)) {
      const row = {
        id: nextId(),
        email: params[0],
        password_hash: params[1],
        created_at: new Date().toISOString(),
        status: /INSERT INTO users \(email, password_hash, status\)/i.test(s) ? params[2] : 'Active',
        mfa_enabled: false,
        mfa_secret: null,
        password_changed_at: /password_changed_at/i.test(s) ? new Date().toISOString() : null,
      }
      state.users.push(row)
      return { lastID: row.id, changes: 1 }
    }

    if (/INSERT INTO user_audit_log/i.test(s)) {
      state.audit.push({ id: nextId(), actor: params[0], action: params[3] ?? params[2] })
      return { lastID: 0, changes: 1 }
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

  const all = vi.fn(async (sql, params = []) => {
    const s = String(sql)

    // The JL-329 reconciliation's orphan query.
    if (/FROM members m/i.test(s) && /NOT EXISTS/i.test(s) && /FROM invitations i/i.test(s)) {
      return state.members
        .filter((m) => m.status === 'Invited')
        .filter((m) => !state.invitations.some((inv) => lower(inv.email) === lower(m.email)))
        .sort((a, b) => a.id - b.id)
        .map((m) => ({ id: m.id, email: m.email, role: m.role, invited_by: m.invited_by }))
    }

    if (/FROM invitations/i.test(s)) {
      let rows = [...state.invitations]
      const literal = (s.match(/status\s*=\s*'(\w+)'/i) || [])[1]
      if (literal) rows = rows.filter((inv) => inv.status === literal)
      else if (/status\s*=\s*\?/i.test(s)) rows = rows.filter((inv) => inv.status === params[0])
      if (/expires_at\s*>\s*NOW\(\)/i.test(s)) {
        rows = rows.filter((inv) => new Date(inv.expires_at).getTime() > Date.now())
      }
      // Mirror the column list the caller actually asked for: list endpoints
      // must not leak a live token, so a query that omits it gets rows without.
      const selectsToken = /SELECT[^]*\btoken\b[^]*FROM invitations/i.test(s)
      return rows
        .sort((a, b) => b.id - a.id)
        .map((inv) => {
          const copy = { ...inv }
          if (!selectsToken) delete copy.token
          return copy
        })
    }

    if (/FROM members/i.test(s)) return [...state.members].sort((a, b) => a.id - b.id)

    return []
  })

  return { state, get, run, all, reset }
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
  // members.js only calls tableExists for the optional activity/audit writes.
  tableExists: vi.fn(async () => false),
}))

const policyState = vi.hoisted(() => ({ value: 'open' }))

const mailer = vi.hoisted(() => ({
  sent: [],
  built: [],
}))

vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn(async (payload) => {
    mailer.sent.push(payload)
    return { ok: true, messageId: 'test' }
  }),
  buildInviteEmail: vi.fn((args) => {
    mailer.built.push(args)
    return { subject: 's', html: 'h', text: 't' }
  }),
  buildPasswordResetEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  isSmtpConfigured: vi.fn().mockReturnValue(false),
  getLatestEmailStatuses: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))

import { errorHandler } from '../middleware/errorHandler.js'
import { hashPassword } from '../middleware/validate.js'
import invitationsRouter, { publicRouter as publicInvitationsRouter } from '../routes/invitations.js'
import membersRouter from '../routes/members.js'
import authRouter, { setLoginLockout } from '../routes/auth.js'
import { createLoginLockout } from '../middleware/loginLockout.js'
import { reconcileInvitedMembers, INVITE_TTL_MS } from '../services/invitations.js'

/* ── Apps ──────────────────────────────────────────────────────────────── */

const ADMIN = 'admin@sedintechnologies.com'

function adminApp(mountPath, router) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: ADMIN, memberId: 1000, workspaceRole: 'Admin', isOwner: true }
    next()
  })
  app.use(mountPath, router)
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

const PASSWORD = 'Invited123!'
let invites
let members
let auth

beforeEach(() => {
  db.reset()
  db.get.mockClear()
  db.run.mockClear()
  db.all.mockClear()
  mailer.sent = []
  mailer.built = []
  policyState.value = 'open'
  invites = adminApp('/api/invitations', invitationsRouter)
  members = adminApp('/api/members', membersRouter)
  auth = (() => {
    const app = express()
    app.use(express.json())
    app.use('/api/auth', authRouter)
    app.use(errorHandler)
    return app
  })()
  setLoginLockout(createLoginLockout({}))
  // A pre-existing admin so nobody under test is "the first member".
  db.state.members.push({
    id: 1000, name: 'admin', email: ADMIN, role: 'Admin', status: 'Active', is_owner: true,
  })
  db.state.users.push({
    id: 1001,
    email: ADMIN,
    password_hash: hashPassword('AdminPass1!'),
    created_at: new Date().toISOString(),
    status: 'Active',
    mfa_enabled: false,
    mfa_secret: null,
    password_changed_at: new Date().toISOString(),
  })
})

/* ── Helpers: the two entry points ─────────────────────────────────────── */

/** Path A — Teams page → Invite. */
async function inviteViaInvitations(email, role = 'Member') {
  const res = await request(invites).post('/api/invitations').send({ email, role })
  expect(res.status).toBe(201)
  return res
}

/** Path B — Teams/Users → Add member. */
async function inviteViaMembers(email, role = 'Member', name = 'Added Person') {
  const res = await request(members).post('/api/members').send({ name, email, role })
  expect(res.status).toBe(201)
  return res
}

const pendingInvite = (email) =>
  db.state.invitations.find(
    (i) => i.email.toLowerCase() === email.toLowerCase() && i.status === 'pending',
  )

const listPending = () => request(invites).get('/api/invitations?status=pending')

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

function expectSevenDayExpiry(row) {
  const ttl = new Date(row.expires_at).getTime() - Date.now()
  // Generous window — the point is "7 days", not millisecond equality.
  expect(ttl).toBeGreaterThan(SEVEN_DAYS - 60000)
  expect(ttl).toBeLessThanOrEqual(SEVEN_DAYS + 1000)
}

/* ── 1: the members path now writes an invitation too ──────────────────── */

describe('JL-329 — POST /api/members writes an invitation row, not just a member', () => {
  it('creates BOTH a members row and a tokened, expiring invitations row', async () => {
    const email = 'added@sedintechnologies.com'
    const res = await inviteViaMembers(email, 'Member', 'Added Person')

    // The members row — unchanged behaviour.
    const member = db.state.members.find((m) => m.email === email)
    expect(member).toBeTruthy()
    expect(member.status).toBe('Invited')
    expect(member.role).toBe('Member')
    expect(res.body.status).toBe('Invited')

    // The invitations row — the half that never used to exist. Before JL-329
    // this array stayed empty, which is exactly why `SELECT count(*) FROM
    // invitations` returning 0 proved nothing.
    const invite = pendingInvite(email)
    expect(invite).toBeTruthy()
    expect(invite.role).toBe('Member')
    expect(invite.invited_by).toBe(ADMIN)
    expect(invite.token).toMatch(/^[a-f0-9]{64}$/)
    expectSevenDayExpiry(invite)

    // And the response says so, so a caller can see the two paths agree.
    expect(res.body.invitation).toMatchObject({ id: invite.id, email, status: 'pending' })
  })

  it('emails the invitee a token, so the link is actually redeemable', async () => {
    // Before JL-329 this path called buildInviteEmail with no token at all, so
    // the recipient got a bare app URL and nothing to redeem.
    const email = 'mailed@sedintechnologies.com'
    await inviteViaMembers(email)

    expect(mailer.built).toHaveLength(1)
    expect(mailer.built[0].token).toBe(pendingInvite(email).token)
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].to).toBe(email)
  })

  it('does NOT invent a pending invitation when a temp password activates the account', async () => {
    // That person is Active with a login already — they are not pending, so a
    // token for them would be a live signup authorisation nobody asked for.
    const email = 'temp-pw@sedintechnologies.com'
    const res = await request(members)
      .post('/api/members')
      .send({ name: 'Temp Pw', email, role: 'Member', password: 'TempPass1!' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('Active')
    expect(res.body.invitation).toBeNull()
    expect(db.state.invitations).toHaveLength(0)
    expect(db.state.users.some((u) => u.email === email)).toBe(true)
  })
})

/* ── 2: the tokened path is unchanged ──────────────────────────────────── */

describe('JL-329 — POST /api/invitations still behaves as before', () => {
  it('creates a pending row with a 64-char hex token and a 7-day expiry', async () => {
    const email = 'invited@sedintechnologies.com'
    const res = await inviteViaInvitations(email, 'Admin')

    expect(res.body.email).toBe(email)
    expect(res.body.role).toBe('Admin')
    expect(res.body.status).toBe('pending')
    expect(res.body.token).toMatch(/^[a-f0-9]{64}$/)
    expectSevenDayExpiry(res.body)
    expect(db.state.invitations).toHaveLength(1)
    // It does NOT create a members row — accepting does that.
    expect(db.state.members.some((m) => m.email === email)).toBe(false)
    expect(mailer.built[0].token).toBe(res.body.token)
  })

  it('still revokes a prior pending invite so only the newest token is live', async () => {
    const email = 'twice@sedintechnologies.com'
    const first = await inviteViaInvitations(email)
    const second = await inviteViaInvitations(email)

    expect(db.state.invitations.find((i) => i.id === first.body.id).status).toBe('revoked')
    expect(db.state.invitations.find((i) => i.id === second.body.id).status).toBe('pending')
  })

  it('still refuses to invite an existing member (409) and rejects a bad role (400)', async () => {
    db.state.members.push({ id: 55, name: 'M', email: 'member@sedintechnologies.com', role: 'Member', status: 'Active' })
    const dup = await request(invites).post('/api/invitations').send({ email: 'member@sedintechnologies.com' })
    expect(dup.status).toBe(409)

    const bad = await request(invites).post('/api/invitations').send({ email: 'x@sedintechnologies.com', role: 'Superuser' })
    expect(bad.status).toBe(400)
  })
})

/* ── 3: one canonical answer to "who has a pending invitation?" ────────── */

describe('JL-329 — the canonical pending query covers BOTH entry points', () => {
  it('GET /api/invitations?status=pending returns invites created either way', async () => {
    const viaTokened = 'tokened@sedintechnologies.com'
    const viaMembers = 'membered@sedintechnologies.com'

    await inviteViaInvitations(viaTokened, 'Viewer')
    await inviteViaMembers(viaMembers, 'Admin')

    const res = await listPending()
    expect(res.status).toBe(200)
    const emails = res.body.map((r) => r.email).sort()
    expect(emails).toEqual([viaMembers, viaTokened].sort())

    // Both carry the same shape: role, inviter, expiry, an expired flag.
    for (const row of res.body) {
      expect(row.status).toBe('pending')
      expect(row.expires_at).toBeTruthy()
      expect(row.expired).toBe(false)
      // The list must never leak a live token.
      expect(row.token).toBeUndefined()
    }
  })

  it('the count is now meaningful — it was 0 for a members-path invite before', async () => {
    await inviteViaMembers('counted@sedintechnologies.com')
    expect(db.state.invitations.filter((i) => i.status === 'pending')).toHaveLength(1)
    expect((await listPending()).body).toHaveLength(1)
  })
})

/* ── 4: resend means the same thing on both paths ──────────────────────── */

describe('JL-329 — resend produces the same observable result either way', () => {
  /** Snapshot the parts of the state a resend is supposed to change. */
  function observe(email) {
    const rows = db.state.invitations.filter((i) => i.email.toLowerCase() === email.toLowerCase())
    const live = rows.filter((i) => i.status === 'pending')
    return {
      liveCount: live.length,
      revokedCount: rows.filter((i) => i.status === 'revoked').length,
      id: live[0]?.id,
      token: live[0]?.token,
      expiresAt: live[0]?.expires_at,
    }
  }

  it('re-issues a fresh token, revokes the old one and mails the new token — via /api/invitations/:id/resend', async () => {
    const email = 'resend-a@sedintechnologies.com'
    const created = await inviteViaInvitations(email)
    const before = observe(email)
    mailer.built = []

    const res = await request(invites).post(`/api/invitations/${created.body.id}/resend`)
    expect(res.status).toBe(200)

    const after = observe(email)
    expect(after.liveCount).toBe(1)
    expect(after.revokedCount).toBe(1)
    expect(after.token).not.toBe(before.token)
    expect(after.token).toMatch(/^[a-f0-9]{64}$/)
    expectSevenDayExpiry({ expires_at: after.expiresAt })
    expect(mailer.built[0].token).toBe(after.token)
  })

  it('does exactly the same thing via /api/members/:id/resend — it used to only re-send mail', async () => {
    const email = 'resend-b@sedintechnologies.com'
    const created = await inviteViaMembers(email)
    const before = observe(email)
    mailer.built = []

    const res = await request(members).post(`/api/members/${created.body.id}/resend`)
    expect(res.status).toBe(200)

    const after = observe(email)
    expect(after.liveCount).toBe(1)
    expect(after.revokedCount).toBe(1)
    expect(after.token).not.toBe(before.token)
    expect(after.token).toMatch(/^[a-f0-9]{64}$/)
    expectSevenDayExpiry({ expires_at: after.expiresAt })
    expect(mailer.built[0].token).toBe(after.token)
    // The response points at the row that is now live, not the revoked one.
    const live = db.state.invitations.find((i) => i.token === after.token)
    expect(res.body.invitation).toMatchObject({ id: live.id, email, status: 'pending' })
    expect(res.body.invitation.id).not.toBe(before.id)
  })

  it('the two resends leave states that differ only in identity, not in kind', async () => {
    const a = 'parity-a@sedintechnologies.com'
    const b = 'parity-b@sedintechnologies.com'
    const viaInvites = await inviteViaInvitations(a)
    const viaMembers = await inviteViaMembers(b)

    await request(invites).post(`/api/invitations/${viaInvites.body.id}/resend`)
    await request(members).post(`/api/members/${viaMembers.body.id}/resend`)

    const shape = (o) => ({ liveCount: o.liveCount, revokedCount: o.revokedCount, hasToken: Boolean(o.token) })
    expect(shape(observe(a))).toEqual(shape(observe(b)))

    // And both are visible, live and redeemable in the one canonical list.
    const rows = (await listPending()).body
    expect(rows.map((r) => r.email).sort()).toEqual([a, b].sort())
    expect(rows.every((r) => r.expired === false)).toBe(true)
  })

  it('refuses to resend for a member who is not pending — same rule the tokened path applies', async () => {
    db.state.members.push({
      id: 77, name: 'Active Person', email: 'active@sedintechnologies.com',
      role: 'Member', status: 'Active', invited_by: ADMIN,
    })
    const res = await request(members).post('/api/members/77/resend')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Only pending invitations can be resent/i)
    expect(db.state.invitations).toHaveLength(0)

    // Byte-for-byte the same refusal the invitations route gives.
    const accepted = await inviteViaInvitations('spent@sedintechnologies.com')
    db.state.invitations.find((i) => i.id === accepted.body.id).status = 'accepted'
    const other = await request(invites).post(`/api/invitations/${accepted.body.id}/resend`)
    expect(other.status).toBe(400)
    expect(other.body.error).toBe(res.body.error)
  })
})

/* ── 5: a members-path invite redeems through the JL-371 accept flow ───── */

describe('JL-329 — an Add-member invite goes through the JL-371 accept flow', () => {
  it('a signed-out invitee can look up the token, accept, and log in', async () => {
    const email = 'newhire@sedintechnologies.com'
    await inviteViaMembers(email, 'Admin', 'New Hire')
    const token = pendingInvite(email).token
    const anonymous = signedOutApp()

    // The pre-auth lookup the accept screen does.
    const lookup = await request(anonymous).get(`/api/invitations/${token}`)
    expect(lookup.status).toBe(200)
    expect(lookup.body).toMatchObject({ email, role: 'Admin', valid: true, expired: false })

    // The JL-371 accept: provisions the users row + a session.
    const accepted = await request(anonymous)
      .post(`/api/invitations/${token}/accept`)
      .send({ password: PASSWORD })
    expect(accepted.status).toBe(200)
    expect(accepted.body.accountCreated).toBe(true)
    expect(accepted.body.token).toBeTruthy()

    // Exactly one users row, and the real login route accepts the password.
    expect(db.state.users.filter((u) => u.email === email)).toHaveLength(1)
    const login = await request(auth).post('/api/auth/login').send({ email, password: PASSWORD })
    expect(login.status).toBe(200)
    expect(login.body.user.email).toBe(email)
  })

  it('the pre-existing members row is promoted, not duplicated', async () => {
    const email = 'promoted@sedintechnologies.com'
    const created = await inviteViaMembers(email, 'Viewer', 'Pending Person')
    const token = pendingInvite(email).token

    const res = await request(signedOutApp())
      .post(`/api/invitations/${token}/accept`)
      .send({ password: PASSWORD })
    expect(res.status).toBe(200)

    const rows = db.state.members.filter((m) => m.email === email)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(created.body.id)
    expect(rows[0].status).toBe('Active')
    // The invitation is spent, so it drops out of the pending list.
    expect(db.state.invitations.find((i) => i.token === token).status).toBe('accepted')
    expect((await listPending()).body).toHaveLength(0)
  })

  it('under invite_only, an Add-member invitee is now authorised — before, they never were', async () => {
    // The members path wrote no invitation, so `checkSignupAllowed` found
    // nothing and the person an admin had just added could never register.
    policyState.value = 'invite_only'
    const email = 'gated@sedintechnologies.com'
    await inviteViaMembers(email)

    const res = await request(signedOutApp())
      .post(`/api/invitations/${pendingInvite(email).token}/accept`)
      .send({ password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.accountCreated).toBe(true)

    // A stranger with no invitation is still refused.
    const stranger = await request(auth)
      .post('/api/auth/signup')
      .send({ email: 'stranger@sedintechnologies.com', password: PASSWORD })
    expect(stranger.status).toBe(403)
  })
})

/* ── 6: reconciling the rows the old path left behind ──────────────────── */

describe('JL-329 — reconciliation adopts pre-existing status=Invited members', () => {
  /** A member row exactly as the pre-JL-329 members path would have left it. */
  function seedLegacyInvitedMember(email, role = 'Member') {
    const row = {
      id: 500 + db.state.members.length,
      name: email.split('@')[0],
      email,
      role,
      status: 'Invited',
      task_count: 0,
      invited_by: ADMIN,
      is_owner: false,
    }
    db.state.members.push(row)
    return row
  }

  it('gives an orphaned Invited member an invitation row so they stop being invisible', async () => {
    const email = 'legacy@sedintechnologies.com'
    seedLegacyInvitedMember(email, 'Viewer')

    // The state the ticket describes: pending in `members`, absent from
    // `invitations`, therefore missing from the one canonical list.
    expect((await listPending()).body).toHaveLength(0)

    const result = await reconcileInvitedMembers()
    expect(result.examined).toBe(1)
    expect(result.created).toEqual([email])

    const rows = (await listPending()).body
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ email, role: 'Viewer', status: 'pending', invited_by: ADMIN })
  })

  it('backfills it as already expired, so a stale invite is not silently revalidated', async () => {
    // `members` has no created_at, so we cannot tell a day-old invite from a
    // year-old one. Minting a live 7-day token would hand a stale address a
    // signup authorisation under invite_only that nobody granted.
    const email = 'stale@sedintechnologies.com'
    seedLegacyInvitedMember(email)
    await reconcileInvitedMembers()

    const invite = pendingInvite(email)
    expect(invite.status).toBe('pending')
    expect(new Date(invite.expires_at).getTime()).toBeLessThan(Date.now())

    // Visible AND badged, not a dead end.
    const [row] = (await listPending()).body
    expect(row.expired).toBe(true)

    // Accepting it is refused until an admin re-issues.
    const accepted = await request(signedOutApp())
      .post(`/api/invitations/${invite.token}/accept`)
      .send({ password: PASSWORD })
    expect(accepted.status).toBe(400)
    expect(accepted.body.error).toMatch(/expired/i)
  })

  it('resend is the documented recovery — it makes a reconciled invite live again', async () => {
    const email = 'recovered@sedintechnologies.com'
    const member = seedLegacyInvitedMember(email)
    await reconcileInvitedMembers()

    const res = await request(members).post(`/api/members/${member.id}/resend`)
    expect(res.status).toBe(200)

    const fresh = pendingInvite(email)
    expectSevenDayExpiry(fresh)
    expect((await listPending()).body[0].expired).toBe(false)

    const accepted = await request(signedOutApp())
      .post(`/api/invitations/${fresh.token}/accept`)
      .send({ password: PASSWORD })
    expect(accepted.status).toBe(200)
    expect(accepted.body.accountCreated).toBe(true)
  })

  it('is idempotent and leaves non-pending members alone', async () => {
    seedLegacyInvitedMember('idem@sedintechnologies.com')
    db.state.members.push({
      id: 600, name: 'Active', email: 'already-active@sedintechnologies.com',
      role: 'Member', status: 'Active', invited_by: ADMIN,
    })
    db.state.members.push({
      id: 601, name: 'Gone', email: 'deactivated@sedintechnologies.com',
      role: 'Member', status: 'Deactivated', invited_by: ADMIN,
    })

    const first = await reconcileInvitedMembers()
    expect(first.created).toEqual(['idem@sedintechnologies.com'])

    const second = await reconcileInvitedMembers()
    expect(second.examined).toBe(0)
    expect(second.created).toEqual([])
    expect(db.state.invitations).toHaveLength(1)
  })

  it('skips a member who already has an invitation row in any status', async () => {
    // Someone invited through the tokened path who also has a members row —
    // re-adopting them would fork the lifecycle all over again.
    const email = 'has-one@sedintechnologies.com'
    const created = await inviteViaInvitations(email)
    seedLegacyInvitedMember(email)
    await request(invites).delete(`/api/invitations/${created.body.id}`) // revoked

    const result = await reconcileInvitedMembers()
    expect(result.examined).toBe(0)
    expect(db.state.invitations).toHaveLength(1)
    expect(db.state.invitations[0].status).toBe('revoked')
  })
})

/* ── 7: expiry applies to every pending invite ─────────────────────────── */

describe('JL-329 — one expiry lifecycle for both paths', () => {
  it('both entry points stamp the same 7-day TTL', async () => {
    await inviteViaInvitations('ttl-a@sedintechnologies.com')
    await inviteViaMembers('ttl-b@sedintechnologies.com')

    expect(db.state.invitations).toHaveLength(2)
    for (const invite of db.state.invitations) expectSevenDayExpiry(invite)
    expect(INVITE_TTL_MS).toBe(SEVEN_DAYS)
  })

  it('an expired invite from either path is flagged in the list and refused at accept', async () => {
    const a = 'exp-a@sedintechnologies.com'
    const b = 'exp-b@sedintechnologies.com'
    await inviteViaInvitations(a)
    await inviteViaMembers(b)

    // Age both of them past their expiry.
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    for (const invite of db.state.invitations) invite.expires_at = past

    const rows = (await listPending()).body
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.expired === true)).toBe(true)

    const anonymous = signedOutApp()
    for (const email of [a, b]) {
      const token = pendingInvite(email).token
      const lookup = await request(anonymous).get(`/api/invitations/${token}`)
      expect(lookup.body).toMatchObject({ expired: true, valid: false })

      const accepted = await request(anonymous)
        .post(`/api/invitations/${token}/accept`)
        .send({ password: PASSWORD })
      expect(accepted.status).toBe(400)
      expect(accepted.body.error).toMatch(/expired/i)
      expect(db.state.users.some((u) => u.email === email)).toBe(false)
    }
  })

  it('a members-path invite no longer lives forever — it has an end date at all', async () => {
    // Before JL-329 the only trace was members.status='Invited', which has no
    // expiry column and no lifecycle: it stayed "Invited" indefinitely.
    const email = 'forever@sedintechnologies.com'
    await inviteViaMembers(email)
    const invite = pendingInvite(email)
    expect(invite.expires_at).toBeTruthy()
    expect(Number.isNaN(new Date(invite.expires_at).getTime())).toBe(false)
    expect(new Date(invite.expires_at).getTime()).toBeGreaterThan(Date.now())
  })
})
