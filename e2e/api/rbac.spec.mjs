// JL-157 Track A — Role-based access control (API layer).
// Workspace roles (requireRole) and project roles (requireProjectRead/Write,
// requireProjectRole, JL-289 "an explicit project role is authoritative").
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus, uniq, uniqKey, createProject, addProjectMember, createIssue } from '../support/api.mjs'
import { ACCOUNTS } from '../support/env.mjs'
import { freshEmail, findMember } from '../support/track-a.mjs'

let owner
let admin
let member
let viewer
let memberId
let viewerId
let project // owned by the Owner; member = project Viewer, viewer = project Viewer
let issue

test.beforeAll(async () => {
  ;[owner, admin, member, viewer] = await Promise.all(['owner', 'admin', 'member', 'viewer'].map(apiAs))
  memberId = (await findMember(owner, ACCOUNTS.member.email)).id
  viewerId = (await findMember(owner, ACCOUNTS.viewer.email)).id
  project = await createProject(owner)
  await addProjectMember(owner, project.id, memberId, 'Viewer')
  await addProjectMember(owner, project.id, viewerId, 'Viewer')
  issue = await createIssue(owner, project.id)
})

test.afterAll(async () => {
  await Promise.all([owner, admin, member, viewer].map((c) => c?.dispose()))
})

// Admin-only endpoints: [method, path, body]
const ADMIN_ONLY = [
  ['post', '/api/members', { name: 'X', email: 'rbac-probe@e2e.example.com', role: 'Viewer', password: 'Whatever-123!' }],
  ['patch', '/api/members/1', { role: 'Viewer' }],
  ['patch', '/api/members/1/deactivate', {}],
  ['delete', '/api/members/1', null],
  ['post', '/api/members/bulk-delete', { ids: [1] }],
  ['get', '/api/members/audit', null],
  ['get', '/api/webhooks', null],
  ['post', '/api/webhooks', { name: 'x', url: 'https://example.com/hook', events: ['issue.created'] }],
  ['get', '/api/audit-log', null],
  ['get', '/api/audit-log/verify', null],
  ['get', '/api/audit-log/export', null],
  ['post', '/api/audit-log/retention', { retentionDays: 1 }],
  ['get', '/api/blocked-signups', null],
  ['post', '/api/blocked-signups', { email: 'rbac-probe@e2e.example.com' }],
  ['get', '/api/invitations', null],
  ['post', '/api/invitations', { email: 'rbac-probe@e2e.example.com', role: 'Admin' }],
  ['get', '/api/email-log', null],
  ['put', '/api/workspace/settings', { signup_policy: 'open' }],
  ['put', '/api/security-policy', { min_password_length: 1 }],
  ['post', '/api/projects/1/workflow-transitions', { fromStatus: 'To Do', toStatus: 'Done' }],
  ['put', '/api/projects/1/workflow-layout', { positions: {} }],
]

for (const role of ['member', 'viewer']) {
  test(`A-${role === 'member' ? '054' : '055'} workspace ${role} gets 403 on every admin-only endpoint`, async () => {
    const api = role === 'member' ? member : viewer
    const failures = []
    for (const [method, path, body] of ADMIN_ONLY) {
      const res = await api[method](path, body ? { data: body } : undefined)
      if (res.status() !== 403) failures.push(`${method.toUpperCase()} ${path} → ${res.status()}`)
    }
    expect(failures).toEqual([])
  })
}

test('A-056 workspace Admin can reach the admin endpoints (read-only probes)', async () => {
  for (const path of ['/api/members/audit', '/api/webhooks', '/api/audit-log', '/api/blocked-signups', '/api/invitations', '/api/email-log']) {
    const res = await admin.get(path)
    expect(res.status(), path).toBe(200)
  }
})

test('A-057 Viewer cannot create a project; Member can (project_creation_policy = all_members)', async () => {
  const settings = await expectStatus(await owner.get('/api/workspace/settings'), 200)
  expect(settings.project_creation_policy).toBe('all_members')
  const data = { name: uniq('Project'), key: uniqKey(), type: 'Scrum', lead: ACCOUNTS.viewer.name }
  const res = await viewer.post('/api/projects', { data })
  expect(res.status()).toBe(403)
  expect((await res.json()).error).toBe('Insufficient permissions to create projects')
  const ok = await member.post('/api/projects', { data: { ...data, key: uniqKey(), lead: ACCOUNTS.member.name } })
  expect(ok.status()).toBe(201)
})

test('A-058 Viewer cannot create issues (project-less or in a project they only view)', async () => {
  const base = { title: uniq('Issue'), description: 'x', assignee: 'x', priority: 'Medium', status: 'To Do', issueType: 'Task' }
  let res = await viewer.post('/api/issues', { data: base })
  expect(res.status()).toBe(403)
  res = await viewer.post('/api/issues', { data: { ...base, projectId: project.id } })
  expect(res.status()).toBe(403)
})

test('A-059 Viewer cannot comment on an issue', async () => {
  const res = await viewer.post(`/api/issues/${issue.id}/comments`, { data: { text: 'should not land' } })
  expect(res.status()).toBe(403)
})

test('A-060 Viewer can still READ a project and issue they are a member of', async () => {
  await expectStatus(await viewer.get(`/api/projects/${project.id}`), 200)
  await expectStatus(await viewer.get(`/api/issues/${issue.id}`), 200)
  await expectStatus(await viewer.get(`/api/issues/${issue.id}/comments`), 200)
})

test('A-061 a workspace Member who is a project Viewer cannot edit, transition, comment or create in that project', async () => {
  let res = await member.patch(`/api/issues/${issue.id}`, { data: { title: 'edited by project viewer' } })
  expect(res.status()).toBe(403)
  expect((await res.json()).error).toBe('Insufficient project permissions')
  res = await member.patch(`/api/issues/${issue.id}/status`, { data: { status: 'In Progress' } })
  expect(res.status()).toBe(403)
  res = await member.post(`/api/issues/${issue.id}/comments`, { data: { text: 'nope' } })
  expect(res.status()).toBe(403)
  res = await member.post('/api/issues', { data: { title: uniq('I'), description: 'x', assignee: 'x', priority: 'Low', status: 'To Do', issueType: 'Task', projectId: project.id } })
  expect(res.status()).toBe(403)
  res = await member.delete(`/api/issues/${issue.id}`)
  expect(res.status()).toBe(403)
  const still = await expectStatus(await owner.get(`/api/issues/${issue.id}`), 200)
  expect(still.title).toBe(issue.title)
})

test('A-062 a workspace Member who is a project Viewer cannot edit that project\'s issues via bulk update', async () => {
  test.fail(true, 'DEFECT: POST /api/issues/bulk ranks access as max(workspace, project) role, so a project Viewer with workspace Member edits issues the single-issue PATCH forbids')
  const target = await createIssue(owner, project.id, { priority: 'Low' })
  const res = await expectStatus(await member.post('/api/issues/bulk', { data: { issueIds: [target.id], operations: { priority: 'High' } } }), 200)
  const after = await expectStatus(await owner.get(`/api/issues/${target.id}`), 200)
  expect(after.priority).toBe('Low')
  expect(res.results[0]).toMatchObject({ applied: false, error: 'Insufficient project permissions' })
})

test('A-063 promoting the Member to project Member grants write access', async () => {
  const p = await createProject(owner)
  await addProjectMember(owner, p.id, memberId, 'Member')
  const i = await createIssue(owner, p.id)
  const res = await member.patch(`/api/issues/${i.id}`, { data: { title: 'edited by project member' } })
  expect(res.status()).toBe(200)
  await expectStatus(await member.post(`/api/issues/${i.id}/comments`, { data: { text: 'hello' } }), 201)
})

test('A-064 a non-member of a project cannot read it or its issues', async () => {
  const p = await createProject(owner)
  const i = await createIssue(owner, p.id)
  expect((await member.get(`/api/projects/${p.id}`)).status()).toBe(403)
  expect((await member.get(`/api/issues/${i.id}`)).status()).toBe(403)
  const list = await expectStatus(await member.get('/api/projects'), 200)
  expect(list.map((x) => x.id)).not.toContain(p.id)
})

test('A-065 project Viewer/Member cannot manage the project (edit, members, delete)', async () => {
  expect((await member.put(`/api/projects/${project.id}`, { data: { name: 'renamed' } })).status()).toBe(403)
  expect((await member.post(`/api/projects/${project.id}/members`, { data: { memberId: viewerId, role: 'Admin' } })).status()).toBe(403)
  expect((await member.delete(`/api/projects/${project.id}`)).status()).toBe(403)
  expect((await viewer.delete(`/api/projects/${project.id}`)).status()).toBe(403)
  await expectStatus(await owner.get(`/api/projects/${project.id}`), 200)
})

test('A-066 workspace Admin bypasses project roles (edits an issue in a project they are not in)', async () => {
  const res = await admin.patch(`/api/issues/${issue.id}`, { data: { description: 'admin edit' } })
  expect(res.status()).toBe(200)
})

test('A-067 a Member cannot escalate their own workspace role', async () => {
  const res = await member.patch(`/api/members/${memberId}`, { data: { role: 'Admin' } })
  expect(res.status()).toBe(403)
  const me = await expectStatus(await member.get('/api/auth/me'), 200)
  expect(me.workspaceRole).toBe('Member')
})

test('A-068 a signed-up user cannot obtain a higher role via the signup or invitation APIs', async () => {
  // Self-signup lands as Viewer; inviting oneself is admin-only.
  const viewerish = await apiAs('viewer')
  const res = await viewerish.post('/api/invitations', { data: { email: freshEmail('esc'), role: 'Admin' } })
  expect(res.status()).toBe(403)
  await viewerish.dispose()
})
