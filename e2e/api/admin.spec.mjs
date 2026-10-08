// JL-157 Track A — Administration (API layer).
// server/routes/members.js, teams.js, workflowTransitions.js, workflowLayout.js,
// workflowDefinitions.js, auditLog.js, emailLog.js.
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus, uniq, createProject } from '../support/api.mjs'
import { PASSWORD } from '../support/env.mjs'
import { freshEmail, rawLogin, createMember, findMember, cleanupMember } from '../support/track-a.mjs'

let owner
let admin
let member
const createdMemberIds = []
const createdTeamIds = []

test.beforeAll(async () => {
  owner = await apiAs('owner')
  admin = await apiAs('admin')
  member = await apiAs('member')
})

test.afterAll(async () => {
  for (const id of createdTeamIds) await owner.delete(`/api/teams/${id}`).catch(() => {})
  for (const id of createdMemberIds) await cleanupMember(owner, id)
  await Promise.all([owner.dispose(), admin.dispose(), member.dispose()])
})

async function ownerMemberId() {
  const rows = await expectStatus(await owner.get('/api/members'), 200)
  return rows.find((r) => r.is_owner).id
}

test.describe('members', () => {
  test('A-032 admin creates a member with a password → Active, can log in', async () => {
    const m = await createMember(admin, { role: 'Member' })
    createdMemberIds.push(m.id)
    expect(m.status).toBe('Active')
    expect(m.role).toBe('Member')
    expect(m.email_status).toBe('not_applicable')
    expect(m.invitation).toBeNull()
    const r = await rawLogin(m.email)
    expect(r.status).toBe(200)
  })

  test('A-033 admin creates a member without a password → Invited, with a real invitation', async () => {
    const m = await createMember(admin, { role: 'Viewer', password: null })
    createdMemberIds.push(m.id)
    expect(m.status).toBe('Invited')
    expect(m.invitation?.token).toMatch(/^[0-9a-f]{64}$/)
    expect(m.invitation?.status).toBe('pending')
    expect(m.email_status).toBe('skipped') // SMTP is off in the e2e env
    expect((await rawLogin(m.email)).status).toBe(401)
    const pending = await expectStatus(await admin.get('/api/invitations?status=pending'), 200)
    const row = pending.find((p) => p.email === m.email)
    expect(row).toBeTruthy()
    expect(row.token).toBeUndefined() // list endpoints never leak live tokens
    const log = await expectStatus(await admin.get(`/api/email-log?recipient=${encodeURIComponent(m.email)}`), 200)
    expect(log.rows.some((r) => r.email_type === 'invite' && r.status === 'skipped')).toBe(true)
  })

  test('A-034 create-member validation: missing fields, bad email, Owner role, short password, duplicate', async () => {
    const cases = [
      [{ email: freshEmail(), role: 'Member' }, 400, 'name and email are required'],
      [{ name: 'X', email: 'nope', role: 'Member' }, 400, 'Use a valid office email or Gmail address'],
      [{ name: 'X', email: freshEmail(), role: 'Owner' }, 400, 'role must be one of: Admin, Member, Viewer'],
      [{ name: 'X', email: freshEmail(), role: 'Member', password: '123' }, 400, 'Temporary password must be at least 6 characters'],
      [{ name: 'X', email: 'member@e2e.example.com', role: 'Member' }, 409, 'A member with this email already exists'],
    ]
    for (const [data, status, error] of cases) {
      const res = await admin.post('/api/members', { data })
      expect(res.status(), JSON.stringify(data)).toBe(status)
      expect((await res.json()).error).toBe(error)
    }
  })

  test('A-035 admin changes a member role; audit trail and the user\'s own /me reflect it', async () => {
    const m = await createMember(admin, { role: 'Viewer' })
    createdMemberIds.push(m.id)
    const updated = await expectStatus(await admin.patch(`/api/members/${m.id}`, { data: { role: 'Member' } }), 200)
    expect(updated.role).toBe('Member')
    const self = await apiAs({ email: m.email, password: PASSWORD })
    expect((await expectStatus(await self.get('/api/auth/me'), 200)).workspaceRole).toBe('Member')
    await self.dispose()
    const audit = await expectStatus(await admin.get(`/api/members/audit?target=${m.id}`), 200)
    const entry = audit.find((a) => a.action === 'role_changed')
    expect(entry).toMatchObject({ before_value: 'Viewer', after_value: 'Member', actor: 'admin@e2e.example.com' })
  })

  test('A-036 role change rejects Owner and unknown roles', async () => {
    const m = await createMember(admin, { role: 'Viewer' })
    createdMemberIds.push(m.id)
    let res = await admin.patch(`/api/members/${m.id}`, { data: { role: 'Owner' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('The Owner role cannot be assigned')
    res = await admin.patch(`/api/members/${m.id}`, { data: { role: 'Superuser' } })
    expect(res.status()).toBe(400)
    res = await admin.patch('/api/members/99999999', { data: { role: 'Member' } })
    expect(res.status()).toBe(404)
  })

  test('A-037 the workspace Owner cannot be demoted, deactivated or deleted', async () => {
    const id = await ownerMemberId()
    let res = await admin.patch(`/api/members/${id}`, { data: { role: 'Viewer' } })
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('Cannot change the workspace Owner')
    res = await admin.patch(`/api/members/${id}/deactivate`)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('Cannot deactivate the workspace Owner')
    res = await admin.delete(`/api/members/${id}`)
    expect(res.status()).toBe(403)
    expect((await res.json()).error).toBe('Cannot delete the workspace Owner')
    const me = await expectStatus(await owner.get('/api/auth/me'), 200)
    expect(me).toMatchObject({ isOwner: true, workspaceRole: 'Admin' })
  })

  test('A-038 deactivate blocks login; reactivate restores it', async () => {
    const m = await createMember(admin, { role: 'Member' })
    createdMemberIds.push(m.id)
    const d = await expectStatus(await admin.patch(`/api/members/${m.id}/deactivate`), 200)
    expect(d.status).toBe('Deactivated')
    expect((await findMember(admin, m.email)).status).toBe('Deactivated')
    expect((await rawLogin(m.email)).status).toBe(403)
    const r = await expectStatus(await admin.patch(`/api/members/${m.id}/reactivate`), 200)
    expect(r.status).toBe('Active')
    expect((await rawLogin(m.email)).status).toBe(200)
    // deactivation preserved the role
    expect((await findMember(admin, m.email)).role).toBe('Member')
  })

  test('A-039 delete removes the member, deactivates the login and records the audit', async () => {
    const m = await createMember(admin, { role: 'Member' })
    const res = await expectStatus(await admin.delete(`/api/members/${m.id}`), 200)
    expect(res).toEqual({ ok: true, id: m.id })
    expect(await findMember(admin, m.email)).toBeNull()
    expect((await rawLogin(m.email)).status).toBe(403)
    const audit = await expectStatus(await admin.get(`/api/members/audit?target=${encodeURIComponent(m.email)}`), 200)
    expect(audit.map((a) => a.action)).toContain('deleted')
    expect((await admin.delete(`/api/members/${m.id}`)).status()).toBe(404)
  })

  test('A-040 bulk delete removes the given members and skips the Owner and unknown ids', async () => {
    const a = await createMember(admin, { role: 'Viewer' })
    const b = await createMember(admin, { role: 'Viewer' })
    const ownerId = await ownerMemberId()
    const res = await expectStatus(await admin.post('/api/members/bulk-delete', { data: { ids: [a.id, b.id, ownerId, 99999999] } }), 200)
    expect(res.deleted.sort()).toEqual([a.id, b.id].sort())
    expect(res.skipped).toEqual(expect.arrayContaining([
      { id: ownerId, reason: 'workspace Owner cannot be deleted' },
      { id: 99999999, reason: 'not found' },
    ]))
    expect(await findMember(admin, a.email)).toBeNull()
    const bad = await admin.post('/api/members/bulk-delete', { data: { ids: [] } })
    expect(bad.status()).toBe(400)
  })

  test('A-041 member list supports search, role and status filters with a paginated envelope', async () => {
    const tag = uniq('Filtr')
    const active = await createMember(admin, { role: 'Viewer', name: `${tag} Active` })
    const invited = await createMember(admin, { role: 'Member', name: `${tag} Invited`, password: null })
    createdMemberIds.push(active.id, invited.id)
    const all = await expectStatus(await admin.get(`/api/members?search=${tag}`), 200)
    expect(all.total).toBe(2)
    expect(all.items.map((i) => i.id).sort()).toEqual([active.id, invited.id].sort())
    const byStatus = await expectStatus(await admin.get(`/api/members?search=${tag}&status=Invited`), 200)
    expect(byStatus.items.map((i) => i.id)).toEqual([invited.id])
    const byRole = await expectStatus(await admin.get(`/api/members?search=${tag}&role=Viewer`), 200)
    expect(byRole.items.map((i) => i.id)).toEqual([active.id])
    const page = await expectStatus(await admin.get(`/api/members?search=${tag}&limit=1&offset=1`), 200)
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 1 })
    expect(page.items).toHaveLength(1)
  })

  test('A-042 a member with an Invited status can have the invite resent; an Active one cannot', async () => {
    const inv = await createMember(admin, { role: 'Viewer', password: null })
    const act = await createMember(admin, { role: 'Viewer' })
    createdMemberIds.push(inv.id, act.id)
    const res = await expectStatus(await admin.post(`/api/members/${inv.id}/resend`), 200)
    expect(res.invitation.token).not.toBe(inv.invitation.token)
    const anon = await rawLogin(inv.email) // still no login
    expect(anon.status).toBe(401)
    const bad = await admin.post(`/api/members/${act.id}/resend`)
    expect(bad.status()).toBe(400)
  })

  test('A-043 last-Admin guard: deleting an Admin is allowed while the Owner still counts as an admin', async () => {
    // The guard can only bite when ONE admin-class member remains; the Owner
    // always counts (is_owner), and the seeded admin must not be touched, so the
    // reachable assertion is that a second Admin is NOT wrongly protected.
    const extra = await createMember(admin, { role: 'Admin' })
    const res = await admin.delete(`/api/members/${extra.id}`)
    expect(res.status()).toBe(200)
  })
})

test.describe('teams', () => {
  test('A-044 create → read → edit → delete a team', async () => {
    const name = uniq('Team')
    const team = await expectStatus(await admin.post('/api/teams', { data: { name, description: 'd1' } }), 201)
    createdTeamIds.push(team.id)
    expect(team).toMatchObject({ name, description: 'd1', membership: 'OPEN', memberCount: 1 })
    const got = await expectStatus(await admin.get(`/api/teams/${team.id}`), 200)
    expect(got.members[0]).toMatchObject({ email: 'admin@e2e.example.com', role: 'Lead' })
    expect(got.canManage).toBe(true)
    const list = await expectStatus(await member.get(`/api/teams?search=${encodeURIComponent(name)}`), 200)
    expect(list.map((t) => t.id)).toContain(team.id)
    const edited = await expectStatus(await admin.patch(`/api/teams/${team.id}`, { data: { name: `${name} v2`, membership: 'MEMBER_INVITE' } }), 200)
    expect(edited).toMatchObject({ name: `${name} v2`, membership: 'MEMBER_INVITE' })
    await expectStatus(await admin.delete(`/api/teams/${team.id}`), 200)
    expect((await admin.get(`/api/teams/${team.id}`)).status()).toBe(404)
  })

  test('A-045 team validation: name required, bad membership mode, unsafe link URL', async () => {
    expect((await admin.post('/api/teams', { data: { name: '  ' } })).status()).toBe(400)
    expect((await admin.post('/api/teams', { data: { name: uniq('T'), membership: 'ANYONE' } })).status()).toBe(400)
    const team = await expectStatus(await admin.post('/api/teams', { data: { name: uniq('Team') } }), 201)
    createdTeamIds.push(team.id)
    const bad = await admin.post(`/api/teams/${team.id}/links`, { data: { label: 'x', url: 'javascript:alert(1)' } })
    expect(bad.status()).toBe(400)
    await expectStatus(await admin.post(`/api/teams/${team.id}/links`, { data: { label: 'Docs', url: 'https://example.com/docs' } }), 201)
  })

  test('A-046 team membership: add, promote, last-Lead guard, remove', async () => {
    const team = await expectStatus(await admin.post('/api/teams', { data: { name: uniq('Team') } }), 201)
    createdTeamIds.push(team.id)
    const m = await createMember(admin, { role: 'Member' })
    createdMemberIds.push(m.id)
    const adminMemberId = (await findMember(admin, 'admin@e2e.example.com')).id
    const after = await expectStatus(await admin.post(`/api/teams/${team.id}/members`, { data: { memberId: m.id } }), 201)
    expect(after.find((x) => x.memberId === m.id).role).toBe('Member')
    // the only Lead cannot be demoted or removed
    let res = await admin.patch(`/api/teams/${team.id}/members/${adminMemberId}`, { data: { role: 'Member' } })
    expect(res.status()).toBe(409)
    res = await admin.delete(`/api/teams/${team.id}/members/${adminMemberId}`)
    expect(res.status()).toBe(409)
    // promote the other person, then the original Lead may step down
    await expectStatus(await admin.patch(`/api/teams/${team.id}/members/${m.id}`, { data: { role: 'Lead' } }), 200)
    await expectStatus(await admin.patch(`/api/teams/${team.id}/members/${adminMemberId}`, { data: { role: 'Member' } }), 200)
    const removed = await expectStatus(await admin.delete(`/api/teams/${team.id}/members/${adminMemberId}`), 200)
    expect(removed.map((x) => x.memberId)).toEqual([m.id])
  })

  test('A-047 a non-Lead workspace Member cannot edit/delete a team or add others; may join an OPEN team', async () => {
    const team = await expectStatus(await admin.post('/api/teams', { data: { name: uniq('Team') } }), 201)
    createdTeamIds.push(team.id)
    expect((await member.patch(`/api/teams/${team.id}`, { data: { name: 'hijack' } })).status()).toBe(403)
    expect((await member.delete(`/api/teams/${team.id}`)).status()).toBe(403)
    const viewerId = (await findMember(admin, 'viewer@e2e.example.com')).id
    expect((await member.post(`/api/teams/${team.id}/members`, { data: { memberId: viewerId } })).status()).toBe(403)
    expect((await member.post(`/api/teams/${team.id}/members`, { data: { role: 'Lead' } })).status()).toBe(403)
    const joined = await expectStatus(await member.post(`/api/teams/${team.id}/members`, { data: {} }), 201)
    expect(joined.some((x) => x.email === 'member@e2e.example.com' && x.role === 'Member')).toBe(true)
    // invite-only team refuses self-join
    await expectStatus(await admin.patch(`/api/teams/${team.id}`, { data: { membership: 'MEMBER_INVITE' } }), 200)
    const viewer = await apiAs('viewer')
    expect((await viewer.post(`/api/teams/${team.id}/members`, { data: {} })).status()).toBe(403)
    await viewer.dispose()
  })
})

test.describe('workflow editor', () => {
  test('A-048 a workflow transition change persists, and is removed again', async () => {
    const project = await createProject(owner)
    const defs = await expectStatus(await owner.get(`/api/projects/${project.id}/workflow-definitions`), 200)
    expect(defs.some((d) => d.isDefault)).toBe(true)
    const t = await expectStatus(await admin.post(`/api/projects/${project.id}/workflow-transitions`, { data: { fromStatus: 'To Do', toStatus: 'Done' } }), 201)
    let list = await expectStatus(await admin.get(`/api/projects/${project.id}/workflow-transitions`), 200)
    expect(list.find((x) => x.id === t.id)).toMatchObject({ fromStatus: 'To Do', toStatus: 'Done' })
    const dup = await admin.post(`/api/projects/${project.id}/workflow-transitions`, { data: { fromStatus: 'To Do', toStatus: 'Done' } })
    expect(dup.status()).toBe(409)
    const bad = await admin.post(`/api/projects/${project.id}/workflow-transitions`, { data: { fromStatus: 'To Do', toStatus: 'Nowhere' } })
    expect(bad.status()).toBe(400)
    await expectStatus(await admin.delete(`/api/workflow-transitions/${t.id}`), 200)
    list = await expectStatus(await admin.get(`/api/projects/${project.id}/workflow-transitions`), 200)
    expect(list.find((x) => x.id === t.id)).toBeUndefined()
  })

  test('A-049 the workflow diagram layout persists and can be reset', async () => {
    const project = await createProject(owner)
    const saved = await expectStatus(await admin.put(`/api/projects/${project.id}/workflow-layout`, { data: { positions: { 'To Do': { x: 10, y: 20 } } } }), 200)
    expect(saved.positions['To Do']).toEqual({ x: 10, y: 20 })
    const got = await expectStatus(await member.get(`/api/projects/${project.id}/workflow-layout`), 200)
    expect(got.positions['To Do']).toEqual({ x: 10, y: 20 })
    const reset = await expectStatus(await admin.put(`/api/projects/${project.id}/workflow-layout`, { data: { positions: {} } }), 200)
    expect(reset.positions).toEqual({})
  })
})

test.describe('audit log', () => {
  test('A-053 the audit verify endpoint answers with a well-formed result', async () => {
    const res = await expectStatus(await admin.get('/api/audit-log/verify'), 200)
    expect(typeof res.ok).toBe('boolean')
    expect(res.count).toBeGreaterThan(0)
  })

  test('A-050 member actions appear in the user audit trail and the tamper-evident log', async () => {
    const email = freshEmail('aud')
    const m = await createMember(admin, { role: 'Viewer', email })
    createdMemberIds.push(m.id)
    await rawLogin(email) // successful login → audit_log 'login'
    await rawLogin(email, 'wrong-password-1') // failure → 'auth.login.failed'
    const trail = await expectStatus(await admin.get(`/api/members/audit?target=${encodeURIComponent(email)}`), 200)
    expect(trail.find((a) => a.action === 'member_created')).toMatchObject({ actor: 'admin@e2e.example.com', after_value: 'Viewer / Active' })
    // safeAppendAudit is fire-and-forget; poll briefly
    await expect.poll(async () => {
      const log = await expectStatus(await admin.get(`/api/audit-log?actor=${encodeURIComponent(email)}&limit=50`), 200)
      return log.entries.map((e) => e.action).sort()
    }, { timeout: 5000 }).toEqual(expect.arrayContaining(['auth.login.failed', 'login']))
  })

  test('A-051 the audit hash chain verifies', async () => {
    test.fail(true, 'DEFECT: verify recomputes hashes with created_at as a pg Date object, but append hashed the ISO string, so every chain reports broken at seq 1')
    const res = await expectStatus(await admin.get('/api/audit-log/verify'), 200)
    expect(res.ok).toBe(true)
    expect(res.brokenAt ?? null).toBeNull()
    expect(res.count).toBeGreaterThan(0)
  })

  test('A-052 audit log list paginates and filters by action; export returns CSV', async () => {
    const page = await expectStatus(await admin.get('/api/audit-log?action=login&limit=2'), 200)
    expect(page.limit).toBe(2)
    expect(page.entries.length).toBeLessThanOrEqual(2)
    expect(page.entries.every((e) => e.action === 'login')).toBe(true)
    expect(page.entries.every((e) => /^[0-9a-f]{64}$/.test(e.hash))).toBe(true)
    const csv = await admin.get('/api/audit-log/export?format=csv&action=login')
    expect(csv.status()).toBe(200)
    expect(csv.headers()['content-type']).toMatch(/text\/csv/)
    expect((await csv.text()).split('\n')[0]).toContain('seq')
  })
})
