// @vitest-environment node
// JL-325 — removing a user must actually revoke their access.
//
// Two holes are covered here:
//   1. POST /api/auth/signup had no gate, so a removed person could simply
//      register again.
//   2. DELETE /api/members/:id only removed the `members` row — the `users` row
//      survived with status 'Active', so they could still LOG IN (demoted to
//      Viewer by loadUserRoles).
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
    getSetting: vi.fn(async (_key, fallback = null) => fallback),
    setSetting: vi.fn(),
    columnExists: vi.fn(),
    tableExists: vi.fn(async () => true),
  }
})

vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue({ ok: true, messageId: 't' }),
  buildInviteEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  buildPasswordResetEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
  isSmtpConfigured: vi.fn().mockReturnValue(false),
  getLatestEmailStatuses: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))

import { run, all, get, getSetting } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  checkSignupAllowed,
  isSignupBlocked,
  blockSignup,
  unblockSignup,
  getSignupPolicy,
  SIGNUP_POLICIES,
  DEFAULT_SIGNUP_POLICY,
} from '../services/signupPolicy.js'

function createApp(routeModule, mountPath, { role = 'Admin', memberId = 1 } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId, workspaceRole: role, isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  run.mockResolvedValue({ lastID: 1, changes: 1 })
  all.mockResolvedValue([])
  get.mockResolvedValue(undefined)
  getSetting.mockImplementation(async (_key, fallback = null) => fallback)
})

/* ── The deny-list primitive ───────────────────────────────────────────── */

describe('JL-325 — blocked-signup deny-list', () => {
  it('reports an address as blocked when a row exists', async () => {
    get.mockImplementation(async (sql) =>
      /FROM blocked_signups/.test(sql) ? { id: 3 } : undefined)
    expect(await isSignupBlocked('gone@x.com')).toBe(true)
  })

  it('matches case-insensitively', async () => {
    const seen = []
    get.mockImplementation(async (sql, params) => {
      if (/FROM blocked_signups/.test(sql)) { seen.push(params); return { id: 3 } }
      return undefined
    })
    await isSignupBlocked('  GONE@X.com  ')
    expect(seen[0]).toContain('gone@x.com') // trimmed + lower-cased
  })

  it('treats an empty address as not blocked without querying', async () => {
    expect(await isSignupBlocked('')).toBe(false)
    expect(get).not.toHaveBeenCalled()
  })

  it('blockSignup is idempotent (ON CONFLICT DO NOTHING)', async () => {
    await blockSignup('gone@x.com', { reason: 'member removed', blockedBy: 'admin@test.com' })
    const insert = run.mock.calls.find(([sql]) => /INSERT INTO blocked_signups/.test(sql))
    expect(insert).toBeTruthy()
    expect(insert[0]).toMatch(/ON CONFLICT DO NOTHING/)
    expect(insert[1]).toEqual(['gone@x.com', 'member removed', 'admin@test.com'])
  })

  it('never throws if the deny-list write fails', async () => {
    // Bookkeeping must not fail the delete that already happened.
    run.mockRejectedValue(new Error('relation "blocked_signups" does not exist'))
    await expect(blockSignup('gone@x.com')).resolves.toBe(false)
  })

  it('unblockSignup reports whether a row was actually removed', async () => {
    run.mockResolvedValueOnce({ changes: 1 })
    expect(await unblockSignup('gone@x.com')).toBe(true)
    run.mockResolvedValueOnce({ changes: 0 })
    expect(await unblockSignup('never@x.com')).toBe(false)
  })
})

/* ── Policy resolution ─────────────────────────────────────────────────── */

describe('JL-325 — signup policy', () => {
  it('defaults to open so enabling the feature cannot lock a team out', async () => {
    expect(DEFAULT_SIGNUP_POLICY).toBe('open')
    expect(await getSignupPolicy()).toBe('open')
  })

  it('falls back to the default for an unrecognised stored value', async () => {
    getSetting.mockResolvedValue('nonsense')
    expect(await getSignupPolicy()).toBe('open')
    expect(SIGNUP_POLICIES).toEqual(['open', 'invite_only'])
  })

  it('allows any valid address under the open policy', async () => {
    expect(await checkSignupAllowed('anyone@x.com')).toEqual({ allowed: true })
  })

  it('refuses a blocked address even under the open policy', async () => {
    get.mockImplementation(async (sql) =>
      /FROM blocked_signups/.test(sql) ? { id: 1 } : undefined)
    const result = await checkSignupAllowed('gone@x.com')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.error).toMatch(/not permitted to register/i)
  })

  it('requires a live invitation under invite_only', async () => {
    getSetting.mockResolvedValue('invite_only')
    get.mockImplementation(async () => undefined) // no invite, not blocked
    const result = await checkSignupAllowed('stranger@x.com')
    expect(result.allowed).toBe(false)
    expect(result.status).toBe(403)
    expect(result.error).toMatch(/invitation only/i)
  })

  it('allows an invited address under invite_only', async () => {
    getSetting.mockResolvedValue('invite_only')
    get.mockImplementation(async (sql) => {
      if (/FROM blocked_signups/.test(sql)) return undefined
      if (/FROM invitations/.test(sql)) return { id: 9 }
      return undefined
    })
    expect(await checkSignupAllowed('invited@x.com')).toEqual({ allowed: true })
  })

  it('only accepts pending, unexpired invitations', async () => {
    getSetting.mockResolvedValue('invite_only')
    let sqlSeen = ''
    get.mockImplementation(async (sql) => {
      if (/FROM invitations/.test(sql)) { sqlSeen = sql; return { id: 9 } }
      return undefined
    })
    await checkSignupAllowed('invited@x.com')
    expect(sqlSeen).toMatch(/status = 'pending'/)
    expect(sqlSeen).toMatch(/expires_at > NOW\(\)/)
  })
})

/* ── The signup route ──────────────────────────────────────────────────── */

describe('JL-325 — POST /api/auth/signup enforcement', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/auth.js')
    app = createApp(mod, '/api/auth')
  })

  it('refuses a previously-removed address with 403', async () => {
    get.mockImplementation(async (sql) =>
      /FROM blocked_signups/.test(sql) ? { id: 1 } : undefined)

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'removed@sedintechnologies.com', password: 'Test1234!' })

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not permitted to register/i)
    // The account must not be created.
    expect(run.mock.calls.some(([sql]) => /INSERT INTO users/.test(sql))).toBe(false)
  })

  it('still creates the account for an allowed address (happy path)', async () => {
    get.mockImplementation(async (sql) => {
      if (/FROM blocked_signups/.test(sql)) return undefined
      if (/FROM users WHERE email/.test(sql)) return undefined
      if (/FROM users WHERE id/.test(sql)) {
        return { id: 7, email: 'fresh@sedintechnologies.com', created_at: 'now' }
      }
      return undefined
    })

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'fresh@sedintechnologies.com', password: 'Test1234!' })

    expect(res.status).toBe(201)
    expect(run.mock.calls.some(([sql]) => /INSERT INTO users/.test(sql))).toBe(true)
  })

  it('checks the block before the password rules', async () => {
    // A blocked address gets a blocked answer, not password feedback for an
    // account it could never create.
    get.mockImplementation(async (sql) =>
      /FROM blocked_signups/.test(sql) ? { id: 1 } : undefined)

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'removed@sedintechnologies.com', password: 'x' }) // also too short

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/not permitted/i)
  })
})

/* ── Removal actually revokes access ───────────────────────────────────── */

describe('JL-325 — DELETE /api/members/:id revokes access', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/members.js')
    app = createApp(mod, '/api/members')
  })

  function memberRows(member) {
    get.mockImplementation(async (sql) => {
      if (/COUNT\(\*\) AS count FROM members/.test(sql)) return { count: 5 } // not last admin
      if (/FROM members WHERE id/.test(sql)) return member
      return undefined
    })
  }

  it('deactivates the login so the person can no longer sign in', async () => {
    memberRows({ id: 4, name: 'Gone', email: 'gone@x.com', role: 'Member', is_owner: false })

    const res = await request(app).delete('/api/members/4')
    expect(res.status).toBeLessThan(400)

    // This is the hole: previously only `members` was deleted and the users row
    // stayed Active, so login still worked.
    const deactivate = run.mock.calls.find(
      ([sql]) => /UPDATE users SET status/.test(sql),
    )
    expect(deactivate).toBeTruthy()
    expect(deactivate[1]).toEqual(['Deactivated', 'gone@x.com'])
  })

  it('clears any active sessions', async () => {
    memberRows({ id: 4, name: 'Gone', email: 'gone@x.com', role: 'Member', is_owner: false })
    await request(app).delete('/api/members/4')
    expect(run.mock.calls.some(
      ([sql]) => /DELETE FROM user_sessions/.test(sql),
    )).toBe(true)
  })

  it('adds the address to the deny-list', async () => {
    memberRows({ id: 4, name: 'Gone', email: 'gone@x.com', role: 'Member', is_owner: false })
    await request(app).delete('/api/members/4')

    const block = run.mock.calls.find(([sql]) => /INSERT INTO blocked_signups/.test(sql))
    expect(block).toBeTruthy()
    expect(block[1][0]).toBe('gone@x.com')
    expect(block[1][1]).toBe('member removed')
  })

  it('does not revoke anything when the delete is refused', async () => {
    // Owner is protected — nothing should be blocked or deactivated.
    memberRows({ id: 4, name: 'Owner', email: 'owner@x.com', role: 'Admin', is_owner: true })

    const res = await request(app).delete('/api/members/4')

    expect(res.status).toBe(403)
    expect(run.mock.calls.some(([sql]) => /INSERT INTO blocked_signups/.test(sql))).toBe(false)
    expect(run.mock.calls.some(([sql]) => /UPDATE users SET status/.test(sql))).toBe(false)
  })
})

/* ── Re-admitting someone ──────────────────────────────────────────────── */

describe('JL-325 — re-inviting lifts the block', () => {
  it('POST /api/invitations unblocks the address', async () => {
    const mod = await import('../routes/invitations.js')
    const app = createApp(mod, '/api/invitations')
    get.mockImplementation(async (sql) => {
      if (/FROM members WHERE LOWER\(email\)/.test(sql)) return undefined // not a member
      if (/FROM invitations WHERE id/.test(sql)) {
        return { id: 1, email: 'back@x.com', role: 'Member', status: 'pending' }
      }
      return undefined
    })

    const res = await request(app)
      .post('/api/invitations')
      .send({ email: 'back@x.com', role: 'Member' })

    expect(res.status).toBe(201)
    expect(run.mock.calls.some(
      ([sql]) => /DELETE FROM blocked_signups/.test(sql),
    )).toBe(true)
  })
})
