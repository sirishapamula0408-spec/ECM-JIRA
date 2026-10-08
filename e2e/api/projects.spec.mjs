// JL-157 Track B — Projects API: create/validate/read/update/delete, project
// membership and project roles, and project-scoped access control.
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus, uniq } from '../support/api.mjs'
import { ACCOUNTS } from '../support/env.mjs'
import { createProject, createIssue, memberIdOf, addToProject, randomKey } from '../support/track-b.mjs'

let owner, member, viewer

test.beforeAll(async () => {
  owner = await apiAs('owner')
  member = await apiAs('member')
  viewer = await apiAs('viewer')
})
test.afterAll(async () => {
  await Promise.all([owner, member, viewer].map((a) => a?.dispose()))
})

test.describe('create', () => {
  test('owner creates a Scrum project and becomes its Lead', async () => {
    const key = randomKey()
    const p = await createProject(owner, { key, type: 'Scrum' })
    expect(p).toMatchObject({ key, type: 'Scrum', lead: ACCOUNTS.owner.name })
    expect(p.id).toBeGreaterThan(0)
    const members = await expectStatus(await owner.get(`/api/projects/${p.id}/members`), 200)
    const me = members.find((m) => m.email === ACCOUNTS.owner.email)
    expect(me?.project_role).toBe('Lead')
  })

  test('owner creates a Kanban project', async () => {
    const p = await createProject(owner, { type: 'Kanban' })
    const fetched = await expectStatus(await owner.get(`/api/projects/${p.id}`), 200)
    expect(fetched.type).toBe('Kanban')
  })

  test('a new project is seeded with the default workflow statuses', async () => {
    const p = await createProject(owner)
    const statuses = await expectStatus(await owner.get(`/api/projects/${p.id}/statuses`), 200)
    const names = (Array.isArray(statuses) ? statuses : statuses.statuses || []).map((s) => s.name)
    expect(names).toEqual(expect.arrayContaining(['To Do', 'In Progress', 'Done']))
  })

  for (const missing of ['name', 'key', 'lead']) {
    test(`missing ${missing} is rejected with 400`, async () => {
      const data = { name: uniq('P'), key: randomKey(), type: 'Scrum', lead: ACCOUNTS.owner.name }
      delete data[missing]
      const body = await expectStatus(await owner.post('/api/projects', { data }), 400)
      expect(body.error).toBe('name, key, type, and lead are required')
    })
  }

  test('name over 120 characters and key over 10 characters are rejected', async () => {
    const longName = await expectStatus(await owner.post('/api/projects', {
      data: { name: 'N'.repeat(121), key: randomKey(), type: 'Scrum', lead: 'x' },
    }), 400)
    expect(longName.error).toBe('name must be at most 120 characters')
    const longKey = await expectStatus(await owner.post('/api/projects', {
      data: { name: uniq('P'), key: 'ABCDEFGHIJK', type: 'Scrum', lead: 'x' },
    }), 400)
    expect(longKey.error).toBe('key must be at most 10 characters')
  })

  test('a duplicate project key is refused with a client error, not a 500', async () => {
    test.fail(true, 'DEFECT: duplicate project key hits the UNIQUE constraint and returns 500 Internal server error')
    const key = randomKey()
    await createProject(owner, { key })
    const res = await owner.post('/api/projects', { data: { name: uniq('Dup'), key, type: 'Scrum', lead: 'x' } })
    expect([400, 409]).toContain(res.status())
  })

  test('a workspace Viewer cannot create a project', async () => {
    const res = await viewer.post('/api/projects', { data: { name: uniq('P'), key: randomKey(), type: 'Scrum', lead: 'x' } })
    expect(res.status()).toBe(403)
  })
})

test.describe('read and list', () => {
  test('GET /api/projects/:id returns the project; unknown id is 404', async () => {
    const p = await createProject(owner)
    const got = await expectStatus(await owner.get(`/api/projects/${p.id}`), 200)
    expect(got).toMatchObject({ id: p.id, name: p.name, key: p.key })
    await expectStatus(await owner.get('/api/projects/99999999'), 404)
  })

  test('a Member lists only projects they belong to and cannot read others', async () => {
    const mine = await createProject(owner)
    const notMine = await createProject(owner)
    await addToProject(owner, mine.id, member, 'Member')
    const list = await expectStatus(await member.get('/api/projects'), 200)
    const ids = list.map((p) => p.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(notMine.id)
    await expectStatus(await member.get(`/api/projects/${notMine.id}`), 403)
    await expectStatus(await member.get(`/api/projects/${mine.id}`), 200)
  })

  test('archived projects drop out of the default list and return with includeArchived', async () => {
    const p = await createProject(owner)
    const archived = await expectStatus(await owner.post(`/api/projects/${p.id}/archive`), 200)
    expect(archived.archived).toBe(true)
    const list = await expectStatus(await owner.get('/api/projects'), 200)
    expect(list.map((x) => x.id)).not.toContain(p.id)
    const all = await expectStatus(await owner.get('/api/projects?includeArchived=true'), 200)
    expect(all.map((x) => x.id)).toContain(p.id)
    await expectStatus(await owner.post(`/api/projects/${p.id}/unarchive`), 200)
  })
})

test.describe('update and delete', () => {
  test('a project Admin edits name and type', async () => {
    const p = await createProject(owner)
    const newName = uniq('Renamed')
    const updated = await expectStatus(await owner.put(`/api/projects/${p.id}`, { data: { name: newName, type: 'Kanban' } }), 200)
    expect(updated).toMatchObject({ name: newName, type: 'Kanban', key: p.key })
  })

  test('update enforces the name length cap', async () => {
    const p = await createProject(owner)
    const body = await expectStatus(await owner.put(`/api/projects/${p.id}`, { data: { name: 'x'.repeat(121) } }), 400)
    expect(body.error).toBe('name must be at most 120 characters')
  })

  test('a project Member cannot edit or delete the project', async () => {
    const p = await createProject(owner)
    await addToProject(owner, p.id, member, 'Member')
    await expectStatus(await member.put(`/api/projects/${p.id}`, { data: { name: 'nope' } }), 403)
    await expectStatus(await member.delete(`/api/projects/${p.id}`), 403)
  })

  test('deleting a project removes it; an unknown id is 404', async () => {
    const p = await createProject(owner)
    await expectStatus(await owner.delete(`/api/projects/${p.id}`), 200)
    await expectStatus(await owner.get(`/api/projects/${p.id}`), 404)
    await expectStatus(await owner.delete(`/api/projects/${p.id}`), 404)
  })

  test("deleting a project does not leave its issues readable by unrelated members", async () => {
    test.fail(true, 'DEFECT: project delete only NULLs issues.project_id, so the orphaned issues become readable by every workspace member')
    const p = await createProject(owner)
    const issue = await createIssue(owner, p.id, { title: uniq('Secret') })
    await expectStatus(await owner.delete(`/api/projects/${p.id}`), 200)
    // Mia is not and never was a member of this project.
    const res = await member.get(`/api/issues/${issue.id}`)
    expect([403, 404]).toContain(res.status())
  })
})

test.describe('project members and roles', () => {
  test('add a member, change their project role, then remove them', async () => {
    const p = await createProject(owner)
    const mid = await memberIdOf(member)
    const added = await expectStatus(await owner.post(`/api/projects/${p.id}/members`, { data: { memberId: mid, role: 'Viewer' } }), 201)
    expect(added).toMatchObject({ id: mid, project_role: 'Viewer', email: ACCOUNTS.member.email })
    const changed = await expectStatus(await owner.patch(`/api/projects/${p.id}/members/${mid}`, { data: { role: 'Admin' } }), 200)
    expect(changed.project_role).toBe('Admin')
    await expectStatus(await owner.delete(`/api/projects/${p.id}/members/${mid}`), 200)
    const list = await expectStatus(await owner.get(`/api/projects/${p.id}/members`), 200)
    expect(list.map((m) => m.id)).not.toContain(mid)
  })

  test('an invalid project role on PATCH is rejected', async () => {
    const p = await createProject(owner)
    const mid = await memberIdOf(member)
    await addToProject(owner, p.id, member, 'Member')
    const body = await expectStatus(await owner.patch(`/api/projects/${p.id}/members/${mid}`, { data: { role: 'Superuser' } }), 400)
    expect(body.error).toBe('role must be one of: Lead, Admin, Member, Viewer')
  })

  test('the last project admin can be neither demoted nor removed', async () => {
    const p = await createProject(owner)
    const ownerMid = await memberIdOf(owner)
    const demote = await expectStatus(await owner.patch(`/api/projects/${p.id}/members/${ownerMid}`, { data: { role: 'Member' } }), 409)
    expect(demote.error).toBe('Cannot demote the last remaining project admin')
    const remove = await expectStatus(await owner.delete(`/api/projects/${p.id}/members/${ownerMid}`), 409)
    expect(remove.error).toBe('Cannot remove the last remaining project admin')
  })

  test('memberId is required when adding a project member', async () => {
    const p = await createProject(owner)
    const body = await expectStatus(await owner.post(`/api/projects/${p.id}/members`, { data: { role: 'Member' } }), 400)
    expect(body.error).toBe('memberId is required')
  })

  test('adding someone who is already a member is refused cleanly, not with a 500', async () => {
    test.fail(true, 'DEFECT: POST /projects/:id/members has no duplicate guard; UNIQUE(project_id, member_id) surfaces as 500')
    const p = await createProject(owner)
    await addToProject(owner, p.id, member, 'Member')
    const res = await owner.post(`/api/projects/${p.id}/members`, { data: { memberId: await memberIdOf(member), role: 'Member' } })
    expect([200, 409]).toContain(res.status())
  })

  test('a project Member cannot manage project membership', async () => {
    const p = await createProject(owner)
    await addToProject(owner, p.id, member, 'Member')
    const res = await member.post(`/api/projects/${p.id}/members`, { data: { memberId: await memberIdOf(viewer), role: 'Member' } })
    expect(res.status()).toBe(403)
  })

  test('a project Admin role elevates a workspace Viewer to edit project settings', async () => {
    const p = await createProject(owner)
    await addToProject(owner, p.id, viewer, 'Admin')
    const name = uniq('ViewerEdit')
    const updated = await expectStatus(await viewer.put(`/api/projects/${p.id}`, { data: { name } }), 200)
    expect(updated.name).toBe(name)
  })
})
