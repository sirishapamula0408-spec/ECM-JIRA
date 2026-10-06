// @vitest-environment node
// JL-155 — signing up with an address that already has a login row.
//
// The db is an in-memory fake that understands just the statements signup
// issues, so each case can assert on the resulting STATE (which rows exist,
// which id survived) rather than on which SQL strings were sent. Its
// withTransaction snapshots and restores, so the rollback case is real.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const state = vi.hoisted(() => ({ current: null }))

vi.mock('../db.js', () => {
  const s = () => state.current
  const byEmail = (rows, email) =>
    rows.find((r) => r.email.trim().toLowerCase() === String(email).trim().toLowerCase()) || null

  async function get(sql, params = []) {
    if (/FROM blocked_signups/.test(sql)) return s().blocked.includes(params[0]) ? { id: 1 } : null
    if (/FROM users WHERE LOWER\(email\)/.test(sql)) return byEmail(s().users, params[0])
    if (/FROM users WHERE id/.test(sql)) return s().users.find((u) => u.id === params[0]) || null
    if (/FROM members WHERE LOWER\(email\)/.test(sql)) return byEmail(s().members, params[0])
    if (/COUNT\(\*\) AS count FROM members/.test(sql)) return { count: s().members.length + 1 }
    if (/COUNT\(\*\) AS count FROM users/.test(sql)) return { count: s().users.length + 1 }
    return null
  }

  async function all(sql, params = []) {
    if (/information_schema\.columns/.test(sql)) {
      return Object.keys(s().dependents).map((k) => {
        const [table_name, column_name] = k.split('.')
        return { table_name, column_name }
      })
    }
    const m = sql.match(/FROM (\w+) WHERE (?:LOWER\(TRIM\((\w+)\)\)|(\w+) =)/)
    if (m) {
      const owner = s().dependents[`${m[1]}.${m[2] || m[3]}`] || {}
      return [{ n: owner[String(params[0]).toLowerCase()] || 0 }]
    }
    return []
  }

  async function run(sql, params = []) {
    const db = s()
    if (/DELETE FROM users WHERE id/.test(sql)) {
      db.users = db.users.filter((u) => u.id !== params[0])
    } else if (/INSERT INTO users/.test(sql)) {
      if (db.failUserInsert) throw new Error('insert failed')
      const id = db.nextId++
      db.users.push({ id, email: params[0], password_hash: params[1], status: 'Active', active: true })
      return { lastID: id, changes: 1 }
    } else if (/UPDATE users\s+SET password_hash/.test(sql)) {
      const u = db.users.find((x) => x.id === params[1])
      Object.assign(u, { password_hash: params[0], status: 'Active', active: true, mfa_enabled: false, mfa_secret: null })
    } else if (/INSERT INTO user_audit_log/.test(sql)) {
      db.userAudit.push({ actor: params[0], target: params[1], action: params[2], detail: params.slice(3) })
    } else if (/INSERT INTO members/.test(sql)) {
      db.members.push({ id: db.nextId++, email: params[1], status: params[3] })
    }
    return { lastID: null, changes: 1 }
  }

  async function withTransaction(fn) {
    const snapshot = structuredClone(s())
    try {
      return await fn({ run, get, all })
    } catch (err) {
      state.current = snapshot
      throw err
    }
  }

  return {
    run, all, get, withTransaction,
    getSetting: vi.fn(async (_k, fallback = null) => fallback),
    setSetting: vi.fn(),
    columnExists: vi.fn(async () => true),
    tableExists: vi.fn(async () => true),
  }
})

vi.mock('../services/auditLog.js', () => ({
  safeAppendAudit: vi.fn(),
  appendAudit: vi.fn(),
}))
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue({ ok: true }),
  buildPasswordResetEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  isSmtpConfigured: vi.fn().mockReturnValue(false),
}))
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))

import { safeAppendAudit } from '../services/auditLog.js'
import { errorHandler } from '../middleware/errorHandler.js'
import authRoutes from '../routes/auth.js'
import { SIGNUP_ERRORS } from '../services/reRegistration.js'

const EMAIL = 'premalatha@sedintechnologies.com'
const PASSWORD = 'Test1234!'

let app
beforeEach(() => {
  vi.clearAllMocks()
  state.current = {
    users: [], members: [], blocked: [], userAudit: [], dependents: {},
    nextId: 100, failUserInsert: false,
  }
  app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use(errorHandler)
})

const signup = (email = EMAIL) =>
  request(app).post('/api/auth/signup').send({ email, password: PASSWORD })
const db = () => state.current
const auditActions = () => safeAppendAudit.mock.calls.map(([e]) => e.action)

function staleLogin(overrides = {}) {
  const user = { id: 42, email: EMAIL, password_hash: 'old', status: 'Deactivated', active: true, mfa_enabled: true, mfa_secret: 'S', ...overrides }
  db().users.push(user)
  return user
}

describe('Case A — a login that was never used is replaced', () => {
  it('lets an invited-but-never-activated user re-register', async () => {
    staleLogin({ status: 'Invited' })
    db().members.push({ id: 7, email: EMAIL, status: 'Invited' })

    const res = await signup()

    expect(res.status).toBe(201)
    expect(db().users).toHaveLength(1)
    expect(db().users[0].id).not.toBe(42) // the stale row is gone, not reused
    expect(db().users[0].password_hash).not.toBe('old')
  })

  it('replaces the leftover login of a deleted member', async () => {
    staleLogin({ status: 'Deactivated' }) // Delete leaves no member row

    const res = await signup()

    expect(res.status).toBe(201)
    expect(db().users.map((u) => u.id)).toEqual([res.body.user.id])
  })

  it('audits the deletion: actor system, target email, reason re-registration', async () => {
    staleLogin()

    await signup()

    expect(db().userAudit).toContainEqual(expect.objectContaining({
      actor: 'system', target: EMAIL, action: 'stale_login_deleted',
    }))
    const entry = safeAppendAudit.mock.calls.map(([e]) => e)
      .find((e) => e.action === 'auth.signup.stale_login_deleted')
    expect(entry).toMatchObject({ actor: 'system', target: EMAIL, metadata: { reason: 're-registration', deletedUserId: 42 } })
  })

  it('rolls back the deletion when creating the new login fails', async () => {
    staleLogin()
    db().failUserInsert = true

    const res = await signup()

    expect(res.status).toBe(500)
    // The address still has its record — never left with none at all.
    expect(db().users.map((u) => u.id)).toEqual([42])
    expect(db().userAudit.some((e) => e.action === 'stale_login_deleted')).toBe(false)
    expect(auditActions()).not.toContain('auth.signup.stale_login_deleted')
  })
})

describe('Case B — a login with authored content is reactivated, never deleted', () => {
  beforeEach(() => {
    db().dependents = { 'comments.author': { [EMAIL]: 3 }, 'issues.reporter': {} }
  })

  it('keeps the original id and attaches the new credentials', async () => {
    staleLogin()

    const res = await signup()

    expect(res.status).toBe(201)
    expect(res.body.user.id).toBe(42)
    expect(db().users).toHaveLength(1)
    expect(db().users[0]).toMatchObject({ id: 42, status: 'Active', active: true, mfa_enabled: false, mfa_secret: null })
    expect(db().users[0].password_hash).not.toBe('old')
  })

  it('treats a linked SSO identity as a dependent too', async () => {
    db().dependents = { 'oauth_identities.user_id': { 42: 1 } }
    staleLogin()

    const res = await signup()

    expect(res.body.user.id).toBe(42)
  })

  it('audits the reactivation, including what made it count as used', async () => {
    staleLogin()

    await signup()

    expect(db().userAudit).toContainEqual(expect.objectContaining({ actor: 'system', target: EMAIL, action: 'login_reactivated' }))
    const entry = safeAppendAudit.mock.calls.map(([e]) => e)
      .find((e) => e.action === 'auth.signup.reactivated')
    expect(entry).toMatchObject({
      actor: 'system', target: EMAIL,
      metadata: { userId: 42, reason: 're-registration', dependents: [{ table: 'comments', column: 'author', count: 3 }] },
    })
    expect(auditActions()).not.toContain('auth.signup.stale_login_deleted')
  })
})

describe('Case C — an active account is refused', () => {
  it('returns 409 pointing at log in / reset, and changes nothing', async () => {
    staleLogin({ status: 'Active', password_hash: 'live' })

    const res = await signup()

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: SIGNUP_ERRORS.accountExists, code: 'account_exists' })
    expect(db().users).toEqual([expect.objectContaining({ id: 42, password_hash: 'live' })])
  })

  it('logs the specific reason for admins', async () => {
    staleLogin({ status: 'Active' })
    await signup()
    expect(db().userAudit).toContainEqual(expect.objectContaining({
      action: 'signup_rejected', target: EMAIL, detail: [expect.stringMatching(/^already active/)],
    }))
  })
})

describe('email matching is case-insensitive and trimmed', () => {
  it('a differently-cased address finds the existing login instead of adding one', async () => {
    staleLogin({ status: 'Active' })
    const res = await signup('  Premalatha@SedinTechnologies.com ')
    expect(res.status).toBe(409)
    expect(db().users).toHaveLength(1)
  })

  it('a mixed-case stored address (e.g. from SCIM) is still matched', async () => {
    staleLogin({ email: 'Premalatha@SedinTechnologies.com' })
    const res = await signup()
    expect(res.status).toBe(201)
    expect(db().users.map((u) => u.email)).toEqual([EMAIL])
  })
})

describe('refusals that only an admin can lift', () => {
  it('a suspended member (Deactivated, member row kept) cannot sign up around it', async () => {
    staleLogin()
    db().members.push({ id: 7, email: EMAIL, status: 'Deactivated' })

    const res = await signup()

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: SIGNUP_ERRORS.notEligible })
    expect(db().users).toEqual([expect.objectContaining({ id: 42, password_hash: 'old' })])
    expect(db().userAudit).toContainEqual(expect.objectContaining({ action: 'signup_rejected', detail: [expect.stringMatching(/^suspended/)] }))
  })

  it('a SCIM-deprovisioned login is refused', async () => {
    staleLogin({ active: false })
    const res = await signup()
    expect(res.status).toBe(403)
    expect(db().users[0].password_hash).toBe('old')
  })

  it('the deny-list still wins: a removed address is refused before any record is looked at', async () => {
    db().blocked.push(EMAIL)
    staleLogin() // would be Case A if the block were skipped

    const res = await signup()

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: SIGNUP_ERRORS.notEligible }) // no reason leaked
    expect(db().users.map((u) => u.id)).toEqual([42])
    expect(db().userAudit).toContainEqual(expect.objectContaining({ action: 'signup_rejected', detail: [expect.stringMatching(/^blocked/)] }))
  })
})
