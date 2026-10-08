// JL-157 Track A — Authentication (API layer).
// server/routes/auth.js, services/signupPolicy.js, services/reRegistration.js,
// routes/invitations.js, routes/sessions.js.
import { test, expect } from '@playwright/test'
import { apiAs, anonymous, expectStatus } from '../support/api.mjs'
import { PASSWORD } from '../support/env.mjs'
import {
  freshEmail, rawLogin, rawSignup, apiWithToken, createMember, findMember,
  cleanupMember, withSignupPolicy,
} from '../support/track-a.mjs'

let owner
let originalSignupPolicy
const createdMemberIds = []

test.beforeAll(async () => {
  owner = await apiAs('owner')
  const s = await expectStatus(await owner.get('/api/workspace/settings'), 200)
  originalSignupPolicy = s.signup_policy
})

test.afterAll(async () => {
  // Safety net: whatever happened, the signup policy goes back.
  if (originalSignupPolicy) {
    await owner.put('/api/workspace/settings', { data: { signup_policy: originalSignupPolicy } })
  }
  for (const id of createdMemberIds) await cleanupMember(owner, id)
  await owner.dispose()
})

test.describe('signup', () => {
  test('A-001 signup happy path returns 201 with a token and a Viewer member', async () => {
    const email = freshEmail('su')
    const { status, body } = await rawSignup(email)
    expect(status).toBe(201)
    expect(body.token).toBeTruthy()
    expect(body.user.email).toBe(email)
    const api = await apiWithToken(body.token)
    const me = await expectStatus(await api.get('/api/auth/me'), 200)
    expect(me.email).toBe(email)
    expect(me.workspaceRole).toBe('Viewer')
    expect(me.isOwner).toBe(false)
    createdMemberIds.push(me.memberId)
    await api.dispose()
  })

  test('A-002 signup rejects a malformed email with 400', async () => {
    for (const bad of ['not-an-email', 'a@b', 'two@@at.com', '']) {
      const { status, body } = await rawSignup(bad)
      expect(status, bad).toBe(400)
      expect(body.error).toBe('Use a valid office email or Gmail address')
    }
  })

  test('A-003 signup rejects a password shorter than 6 characters', async () => {
    const { status, body } = await rawSignup(freshEmail('su'), '12345')
    expect(status).toBe(400)
    expect(body.error).toBe('Password must be at least 6 characters')
  })

  test('A-004 signup enforces the org password policy (min length 8 by default)', async () => {
    const policy = await expectStatus(await owner.get('/api/security-policy'), 200)
    const short = 'Ab1!xyz'.slice(0, Math.max(6, policy.min_password_length - 1))
    const { status, body } = await rawSignup(freshEmail('su'), short)
    expect(status).toBe(400)
    expect(body.error).toBe(`Password must be at least ${policy.min_password_length} characters`)
    expect(Array.isArray(body.errors)).toBe(true)
  })

  test('A-005 signup for an existing active account is 409 account_exists', async () => {
    const { status, body } = await rawSignup('member@e2e.example.com', 'Whatever-123!')
    expect(status).toBe(409)
    expect(body.code).toBe('account_exists')
    expect(body.error).toMatch(/An account already exists/)
  })

  test('A-006 mixed-case email does not create a duplicate account', async () => {
    const email = freshEmail('case')
    const first = await rawSignup(email)
    expect(first.status).toBe(201)
    const mixed = email.replace(/^./, (c) => c.toUpperCase()).replace('@e2e', '@E2E')
    const second = await rawSignup(mixed)
    expect(second.status).toBe(409)
    expect(second.body.code).toBe('account_exists')
    // and the mixed-case address logs in to the same account
    const login = await rawLogin(mixed)
    expect(login.status).toBe(200)
    expect(login.body.user.id).toBe(first.body.user.id)
    const m = await findMember(owner, email)
    createdMemberIds.push(m?.id)
  })
})

test.describe('login / logout / tokens', () => {
  test('A-007 login succeeds with correct credentials', async () => {
    const { status, body } = await rawLogin('member@e2e.example.com')
    expect(status).toBe(200)
    expect(body.token).toBeTruthy()
    expect(body.user.email).toBe('member@e2e.example.com')
  })

  test('A-008 login with a wrong password is 401 with a generic message', async () => {
    const { status, body } = await rawLogin('viewer@e2e.example.com', 'definitely-wrong')
    expect(status).toBe(401)
    expect(body.error).toBe('Invalid email or password')
  })

  test('A-009 login for an unknown user is 401 with the same generic message', async () => {
    const { status, body } = await rawLogin(freshEmail('nobody'), 'whatever-123')
    expect(status).toBe(401)
    expect(body.error).toBe('Invalid email or password')
  })

  test('A-010 login without a password is 400', async () => {
    const { status, body } = await rawLogin('member@e2e.example.com', '')
    expect(status).toBe(400)
    expect(body.error).toBe('Password is required')
  })

  test('A-011 repeated failures lock the login out (429 + Retry-After), even for the right password', async () => {
    const m = await createMember(owner, { role: 'Viewer' })
    createdMemberIds.push(m.id)
    for (let i = 0; i < 5; i += 1) {
      const r = await rawLogin(m.email, `wrong-${i}-pass`)
      expect(r.status).toBe(401)
    }
    const locked = await rawLogin(m.email, PASSWORD)
    expect(locked.status).toBe(429)
    expect(locked.body.error).toMatch(/Too many failed login attempts/)
    expect(Number(locked.body.retryAfter)).toBeGreaterThan(0)
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0)
  })

  test('A-012 protected endpoint without a token is 401', async () => {
    const api = await anonymous()
    const res = await api.get('/api/auth/me')
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('Authentication required')
    await api.dispose()
  })

  test('A-013 a garbage / tampered token is 401 on a protected endpoint', async () => {
    const { body } = await rawLogin('member@e2e.example.com')
    const tampered = body.token.slice(0, -4) + (body.token.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    for (const token of ['garbage.token.value', tampered]) {
      const api = await apiWithToken(token)
      const res = await api.get('/api/projects')
      expect(res.status()).toBe(401)
      expect((await res.json()).error).toBe('Invalid or expired token')
      await api.dispose()
    }
  })

  test('A-014 a revoked session token is rejected with 401 (sign out of a device)', async () => {
    const m = await createMember(owner, { role: 'Viewer' })
    createdMemberIds.push(m.id)
    const first = await rawLogin(m.email)
    const second = await rawLogin(m.email)
    const api2 = await apiWithToken(second.body.token)
    const sessions = await expectStatus(await api2.get('/api/sessions'), 200)
    const other = sessions.find((s) => !s.current)
    expect(other).toBeTruthy()
    await expectStatus(await api2.delete(`/api/sessions/${other.id}`), 200)
    const api1 = await apiWithToken(first.body.token)
    const res = await api1.get('/api/auth/me')
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('Session has been revoked')
    // the session used to revoke is untouched
    await expectStatus(await api2.get('/api/auth/me'), 200)
    await api1.dispose()
    await api2.dispose()
  })

  test('A-015 deactivated account cannot log in (403)', async () => {
    const m = await createMember(owner, { role: 'Member' })
    createdMemberIds.push(m.id)
    await expectStatus(await owner.patch(`/api/members/${m.id}/deactivate`), 200)
    const r = await rawLogin(m.email)
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('This account has been deactivated. Please contact your workspace admin.')
  })

  test('A-016 a token issued before deactivation stops working', async () => {
    test.fail(true, 'DEFECT: authGuard never re-checks users.status, so a deactivated user keeps full API access until the JWT expires')
    const m = await createMember(owner, { role: 'Member' })
    createdMemberIds.push(m.id)
    const { body } = await rawLogin(m.email)
    await expectStatus(await owner.patch(`/api/members/${m.id}/deactivate`), 200)
    const api = await apiWithToken(body.token)
    const res = await api.get('/api/projects')
    await api.dispose()
    expect([401, 403]).toContain(res.status())
  })

  test('A-017 a token issued before the member was deleted stops working', async () => {
    test.fail(true, 'DEFECT: deleting a member deletes user_sessions rows instead of revoking them, so authGuard lets the old JWT through as a Viewer')
    const m = await createMember(owner, { role: 'Member' })
    const { body } = await rawLogin(m.email)
    await expectStatus(await owner.delete(`/api/members/${m.id}`), 200)
    const api = await apiWithToken(body.token)
    const res = await api.get('/api/auth/me')
    await api.dispose()
    expect([401, 403]).toContain(res.status())
  })
})

test.describe('forgot / reset password', () => {
  test('A-018 forgot-password returns the token when SMTP is off; reset changes the password', async () => {
    const m = await createMember(owner, { role: 'Viewer' })
    createdMemberIds.push(m.id)
    const anon = await anonymous()
    const fp = await expectStatus(await anon.post('/api/auth/forgot-password', { data: { email: m.email } }), 200)
    expect(fp.message).toMatch(/If an account exists/)
    expect(fp.resetToken).toMatch(/^[0-9a-f]{64}$/)
    const newPw = 'Reset-Pass-9876!'
    const rp = await expectStatus(await anon.post('/api/auth/reset-password', { data: { token: fp.resetToken, newPassword: newPw } }), 200)
    expect(rp.message).toMatch(/Password has been reset/)
    expect((await rawLogin(m.email, PASSWORD)).status).toBe(401)
    expect((await rawLogin(m.email, newPw)).status).toBe(200)
    // single use
    const again = await anon.post('/api/auth/reset-password', { data: { token: fp.resetToken, newPassword: 'Another-Pass-1!' } })
    expect(again.status()).toBe(400)
    expect((await again.json()).error).toBe('This reset token has already been used')
    await anon.dispose()
  })

  test('A-019 forgot-password for an unknown address does not reveal it (200, no token)', async () => {
    const anon = await anonymous()
    const fp = await expectStatus(await anon.post('/api/auth/forgot-password', { data: { email: freshEmail('ghost') } }), 200)
    expect(fp.message).toMatch(/If an account exists/)
    expect(fp.resetToken).toBeUndefined()
    await anon.dispose()
  })

  test('A-020 reset-password rejects an unknown token and a weak password', async () => {
    const anon = await anonymous()
    let res = await anon.post('/api/auth/reset-password', { data: { token: 'f'.repeat(64), newPassword: 'Good-Pass-123!' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('Invalid or expired reset token')
    res = await anon.post('/api/auth/reset-password', { data: { token: 'f'.repeat(64), newPassword: '123' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('New password must be at least 6 characters')
    res = await anon.post('/api/auth/reset-password', { data: { newPassword: 'Good-Pass-123!' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('Reset token is required')
    await anon.dispose()
  })

  test('A-021 requesting a second reset token invalidates the first', async () => {
    const m = await createMember(owner, { role: 'Viewer' })
    createdMemberIds.push(m.id)
    const anon = await anonymous()
    const first = await expectStatus(await anon.post('/api/auth/forgot-password', { data: { email: m.email } }), 200)
    const second = await expectStatus(await anon.post('/api/auth/forgot-password', { data: { email: m.email } }), 200)
    expect(second.resetToken).not.toBe(first.resetToken)
    const res = await anon.post('/api/auth/reset-password', { data: { token: first.resetToken, newPassword: 'Reset-Pass-9876!' } })
    expect(res.status()).toBe(400)
    await expectStatus(await anon.post('/api/auth/reset-password', { data: { token: second.resetToken, newPassword: 'Reset-Pass-9876!' } }), 200)
    await anon.dispose()
  })
})

test.describe('invitations', () => {
  test('A-022 invite → public lookup → accept with password provisions a signed-in account', async () => {
    const email = freshEmail('inv')
    const invite = await expectStatus(await owner.post('/api/invitations', { data: { email, role: 'Member' } }), 201)
    expect(invite.token).toBeTruthy()
    expect(invite.email_status).toBe('skipped')
    const anon = await anonymous()
    const look = await expectStatus(await anon.get(`/api/invitations/${invite.token}`), 200)
    expect(look).toMatchObject({ email, role: 'Member', status: 'pending', valid: true, expired: false })
    const acc = await expectStatus(await anon.post(`/api/invitations/${invite.token}/accept`, { data: { name: 'Invited Person', password: PASSWORD } }), 200)
    expect(acc.accountCreated).toBe(true)
    expect(acc.token).toBeTruthy()
    expect(acc.member.role).toBe('Member')
    createdMemberIds.push(acc.member.id)
    const api = await apiWithToken(acc.token)
    const me = await expectStatus(await api.get('/api/auth/me'), 200)
    expect(me.workspaceRole).toBe('Member')
    await api.dispose()
    expect((await rawLogin(email)).status).toBe(200)
    // single use
    const again = await anon.post(`/api/invitations/${invite.token}/accept`, { data: { password: PASSWORD } })
    expect(again.status()).toBe(400)
    expect((await again.json()).error).toBe('This invitation has already been accepted')
    await anon.dispose()
  })

  test('A-023 accept without a password grants the role; signup then completes the account', async () => {
    const email = freshEmail('inv')
    const invite = await expectStatus(await owner.post('/api/invitations', { data: { email, role: 'Member' } }), 201)
    const anon = await anonymous()
    const acc = await expectStatus(await anon.post(`/api/invitations/${invite.token}/accept`, { data: {} }), 200)
    expect(acc).toMatchObject({ ok: true, accountCreated: false, needsSignup: true })
    createdMemberIds.push(acc.member.id)
    const su = await rawSignup(email)
    expect(su.status).toBe(201)
    const api = await apiWithToken(su.body.token)
    const me = await expectStatus(await api.get('/api/auth/me'), 200)
    expect(me.workspaceRole).toBe('Member')
    await api.dispose()
    await anon.dispose()
  })

  test('A-024 unknown invitation token is 404; revoked invitation cannot be accepted', async () => {
    const anon = await anonymous()
    expect((await anon.get(`/api/invitations/${'0'.repeat(64)}`)).status()).toBe(404)
    const invite = await expectStatus(await owner.post('/api/invitations', { data: { email: freshEmail('inv'), role: 'Viewer' } }), 201)
    await expectStatus(await owner.delete(`/api/invitations/${invite.id}`), 200)
    const res = await anon.post(`/api/invitations/${invite.token}/accept`, { data: { password: PASSWORD } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('This invitation has been revoked')
    await anon.dispose()
  })

  test('A-025 inviting an existing member is 409', async () => {
    const res = await owner.post('/api/invitations', { data: { email: 'member@e2e.example.com', role: 'Viewer' } })
    expect(res.status()).toBe(409)
    expect((await res.json()).error).toBe('That email is already a member')
  })
})

test.describe('signup policy and deny-list', () => {
  test('A-026 invite_only: signup without an invitation is refused, with one it succeeds', async () => {
    const uninvited = freshEmail('io')
    const invited = freshEmail('io')
    await withSignupPolicy(owner, 'invite_only', async () => {
      const refused = await rawSignup(uninvited)
      expect(refused.status).toBe(403)
      expect(refused.body.error).toBe('This email address is not eligible to register here. Contact your workspace admin.')
      await expectStatus(await owner.post('/api/invitations', { data: { email: invited, role: 'Member' } }), 201)
      const ok = await rawSignup(invited)
      expect(ok.status).toBe(201)
      const api = await apiWithToken(ok.body.token)
      const me = await expectStatus(await api.get('/api/auth/me'), 200)
      expect(me.workspaceRole).toBe('Member')
      createdMemberIds.push(me.memberId)
      await api.dispose()
    })
    const after = await expectStatus(await owner.get('/api/workspace/settings'), 200)
    expect(after.signup_policy).toBe(originalSignupPolicy)
  })

  test('A-027 invalid signup_policy value is rejected with 400', async () => {
    const res = await owner.put('/api/workspace/settings', { data: { signup_policy: 'everyone' } })
    expect(res.status()).toBe(400)
  })

  test('A-028 deleting a member blocks re-signup; re-inviting lifts the block', async () => {
    const m = await createMember(owner, { role: 'Member' })
    await expectStatus(await owner.delete(`/api/members/${m.id}`), 200)
    const blocked = await expectStatus(await owner.get('/api/blocked-signups'), 200)
    expect(blocked.map((b) => b.email)).toContain(m.email)
    const refused = await rawSignup(m.email)
    expect(refused.status).toBe(403)
    expect(refused.body.error).toMatch(/not eligible to register/)
    // the same vague answer as "not invited" — no information leak
    await expectStatus(await owner.post('/api/invitations', { data: { email: m.email, role: 'Viewer' } }), 201)
    const after = await expectStatus(await owner.get('/api/blocked-signups'), 200)
    expect(after.map((b) => b.email)).not.toContain(m.email)
    const ok = await rawSignup(m.email, 'Fresh-Pass-4321!')
    expect(ok.status).toBe(201)
    const row = await findMember(owner, m.email)
    createdMemberIds.push(row?.id)
  })

  test('A-029 JL-155: a re-admitted address whose old login was never used signs up with a fresh login', async () => {
    const m = await createMember(owner, { role: 'Viewer' }) // never logs in
    await expectStatus(await owner.delete(`/api/members/${m.id}`), 200)
    await expectStatus(await owner.post('/api/invitations', { data: { email: m.email, role: 'Viewer' } }), 201)
    const ok = await rawSignup(m.email, 'Fresh-Pass-4321!')
    expect(ok.status).toBe(201)
    const audit = await expectStatus(await owner.get(`/api/members/audit?target=${encodeURIComponent(m.email)}`), 200)
    expect(audit.map((a) => a.action)).toContain('stale_login_deleted')
    expect((await rawLogin(m.email, 'Fresh-Pass-4321!')).status).toBe(200)
    expect((await rawLogin(m.email, PASSWORD)).status).toBe(401)
    const row = await findMember(owner, m.email)
    createdMemberIds.push(row?.id)
  })

  test('A-030 JL-155: a re-admitted address whose old login WAS used is reactivated, keeping its id', async () => {
    const m = await createMember(owner, { role: 'Viewer' })
    const used = await rawLogin(m.email) // writes an audit_log 'login' row → login counts as used
    expect(used.status).toBe(200)
    await expectStatus(await owner.delete(`/api/members/${m.id}`), 200)
    await expectStatus(await owner.post('/api/invitations', { data: { email: m.email, role: 'Viewer' } }), 201)
    const ok = await rawSignup(m.email, 'Fresh-Pass-4321!')
    expect(ok.status).toBe(201)
    expect(ok.body.user.id).toBe(used.body.user.id)
    const audit = await expectStatus(await owner.get(`/api/members/audit?target=${encodeURIComponent(m.email)}`), 200)
    expect(audit.map((a) => a.action)).toContain('login_reactivated')
    const row = await findMember(owner, m.email)
    createdMemberIds.push(row?.id)
  })

  test('A-031 JL-155: signup for a suspended (deactivated) member is refused as not eligible', async () => {
    const m = await createMember(owner, { role: 'Member' })
    createdMemberIds.push(m.id)
    await expectStatus(await owner.patch(`/api/members/${m.id}/deactivate`), 200)
    const r = await rawSignup(m.email, 'Fresh-Pass-4321!')
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/not eligible to register/)
  })
})
