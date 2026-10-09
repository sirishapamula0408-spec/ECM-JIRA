// JL-157 Track B — Planning API: sprints (create/start/complete, single-active
// rule, parallel opt-in), bulk change, CSV/JSON export, CSV import.
//
// Sprints are workspace-global in this schema. Every sprint a test starts is
// retired in a finally block so it can never block another suite's sprint.
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus, uniq } from '../support/api.mjs'
import { ACCOUNTS } from '../support/env.mjs'
import {
  createProject, createIssue, addToProject, createSprint, allowParallel, startSprint, retireSprint,
} from '../support/track-b.mjs'

let owner, member, viewer
let project

test.beforeAll(async () => {
  owner = await apiAs('owner')
  member = await apiAs('member')
  viewer = await apiAs('viewer')
  project = await createProject(owner)
  await addToProject(owner, project.id, member, 'Member')
  await addToProject(owner, project.id, viewer, 'Viewer')
  await allowParallel(owner, project.id, true)
})
test.afterAll(async () => {
  await Promise.all([owner, member, viewer].map((a) => a?.dispose()))
})

test.describe('sprints', () => {
  test('create a sprint with a goal; name falls back when blank', async () => {
    const name = uniq('Sprint')
    const s = await createSprint(owner, project.id, { name, goal: 'Ship it' })
    try {
      expect(s).toMatchObject({ name, goal: 'Ship it', isStarted: false, dateRange: 'Upcoming', projectId: project.id })
      const blank = await createSprint(owner, project.id, { name: '' })
      // JL-165: the fallback name is numbered within the project, after its key.
      expect(blank.name).toMatch(new RegExp(`^${project.key} Sprint \\d+$`))
      await retireSprint(owner, blank.id)
    } finally {
      await retireSprint(owner, s.id)
    }
  })

  test('sprint name over 120 characters is rejected; a Member cannot create sprints', async () => {
    const body = await expectStatus(await owner.post('/api/sprints', { data: { projectId: project.id, name: 'S'.repeat(121) } }), 400)
    expect(body.error).toBe('name must be at most 120 characters')
    await expectStatus(await member.post('/api/sprints', { data: { projectId: project.id, name: uniq('nope') } }), 403)
  })

  test('JL-165: a sprint must name its project, and lists are scoped by it', async () => {
    const missing = await expectStatus(await owner.post('/api/sprints', { data: { name: uniq('Orphan') } }), 400)
    expect(missing.error).toMatch(/projectId is required/)
    const other = await createProject(owner)
    const ours = await createSprint(owner, project.id)
    const theirs = await createSprint(owner, other.id)
    try {
      const listed = (await expectStatus(await owner.get(`/api/sprints?projectId=${project.id}`), 200)).map((s) => s.id)
      expect(listed).toContain(ours.id)
      expect(listed).not.toContain(theirs.id)
      // An issue cannot be put in another project's sprint.
      const issue = await createIssue(owner, project.id, { status: 'Backlog' })
      const refused = await expectStatus(await owner.patch(`/api/issues/${issue.id}/status`, { data: { status: 'To Do', sprintId: theirs.id } }), 400)
      expect(refused.error).toBe('That sprint belongs to another project')
    } finally {
      await retireSprint(owner, ours.id)
      await retireSprint(owner, theirs.id)
    }
  })

  test('add issues to a sprint, start it, then complete it: unfinished work returns to the backlog', async () => {
    const sprint = await createSprint(owner, project.id)
    try {
      const open = await createIssue(owner, project.id, { status: 'To Do', sprintId: sprint.id })
      const done = await createIssue(owner, project.id, { status: 'In UAT', sprintId: sprint.id })
      const moved = await createIssue(owner, project.id, { status: 'Backlog' })
      // Add a backlog issue to the sprint the way the backlog does it.
      const added = await expectStatus(await owner.patch(`/api/issues/${moved.id}/status`, { data: { status: 'To Do', sprintId: sprint.id } }), 200)
      expect(added.sprintId).toBe(sprint.id)

      const started = await expectStatus(await startSprint(owner, sprint.id, project.id), 200)
      expect(started.isStarted).toBe(true)
      expect(started.startDate).toBeTruthy()
      const active = await expectStatus(await owner.get(`/api/projects/${project.id}/sprints/active`), 200)
      expect(active.map((s) => s.id)).toContain(sprint.id)

      await expectStatus(await owner.patch(`/api/issues/${done.id}/status`, { data: { status: 'Done' } }), 200)
      const completed = await expectStatus(await owner.patch(`/api/sprints/${sprint.id}/complete`), 200)
      expect(completed.isStarted).toBe(false)
      expect(completed.completedAt).toBeTruthy()

      const openAfter = await expectStatus(await owner.get(`/api/issues/${open.id}`), 200)
      expect(openAfter).toMatchObject({ status: 'Backlog', sprintId: null })
      const doneAfter = await expectStatus(await owner.get(`/api/issues/${done.id}`), 200)
      expect(doneAfter).toMatchObject({ status: 'Done', sprintId: sprint.id })
    } finally {
      await retireSprint(owner, sprint.id)
    }
  })

  test('only one active sprint per project unless parallel sprints are enabled', async () => {
    const p = await createProject(owner)
    await allowParallel(owner, p.id, true)
    const first = await createSprint(owner, p.id)
    const second = await createSprint(owner, p.id)
    try {
      await expectStatus(await startSprint(owner, first.id, p.id), 200)
      await allowParallel(owner, p.id, false)
      const refused = await expectStatus(await startSprint(owner, second.id, p.id), 409)
      expect(refused.error).toMatch(/^Another sprint is already active/)
      await allowParallel(owner, p.id, true)
      expect((await expectStatus(await startSprint(owner, second.id, p.id), 200)).isStarted).toBe(true)
      const settings = await expectStatus(await owner.get(`/api/projects/${p.id}/sprints/settings`), 200)
      expect(settings.allowParallelSprints).toBe(true)
    } finally {
      await retireSprint(owner, first.id)
      await retireSprint(owner, second.id)
    }
  })

  test("an active sprint in one project does not block starting a sprint in another", async () => {
    const a = await createProject(owner)
    const b = await createProject(owner) // parallel sprints left OFF (the default)
    await allowParallel(owner, a.id, true)
    const sa = await createSprint(owner, a.id)
    const sb = await createSprint(owner, b.id)
    try {
      await expectStatus(await startSprint(owner, sa.id, a.id), 200)
      const res = await startSprint(owner, sb.id, b.id)
      expect(res.status()).toBe(200)
    } finally {
      await retireSprint(owner, sa.id)
      await retireSprint(owner, sb.id)
    }
  })

  test('starting, completing or deleting an unknown sprint is 404', async () => {
    await expectStatus(await startSprint(owner, 99999999, project.id), 404)
    await expectStatus(await owner.patch('/api/sprints/99999999/complete'), 404)
    await expectStatus(await owner.delete('/api/sprints/99999999'), 404)
  })

  test('deleting a sprint returns its issues to the backlog', async () => {
    const sprint = await createSprint(owner, project.id)
    const issue = await createIssue(owner, project.id, { status: 'To Do', sprintId: sprint.id })
    await expectStatus(await owner.delete(`/api/sprints/${sprint.id}`), 200)
    expect(await expectStatus(await owner.get(`/api/issues/${issue.id}`), 200)).toMatchObject({ status: 'Backlog', sprintId: null })
  })

  test('a Member cannot start or complete a sprint', async () => {
    const sprint = await createSprint(owner, project.id)
    try {
      await expectStatus(await member.patch(`/api/sprints/${sprint.id}/start`, { data: { projectId: project.id } }), 403)
      await expectStatus(await member.patch(`/api/sprints/${sprint.id}/complete`), 403)
    } finally {
      await retireSprint(owner, sprint.id)
    }
  })
})

test.describe('bulk change', () => {
  test('dry run previews changes without writing', async () => {
    const a = await createIssue(owner, project.id, { status: 'Backlog', priority: 'Low' })
    const res = await expectStatus(await owner.post('/api/issues/bulk', {
      data: { issueIds: [a.id], operations: { priority: 'High' }, dryRun: true },
    }), 200)
    expect(res.dryRun).toBe(true)
    expect(res.preview[0]).toMatchObject({ issueId: a.id, willChange: true, changes: [{ field: 'priority', from: 'Low', to: 'High' }] })
    expect((await expectStatus(await owner.get(`/api/issues/${a.id}`), 200)).priority).toBe('Low')
  })

  test('bulk status, priority and assignee apply to every selected issue', async () => {
    const a = await createIssue(owner, project.id, { status: 'Backlog', priority: 'Low' })
    const b = await createIssue(owner, project.id, { status: 'Backlog', priority: 'Low' })
    const res = await expectStatus(await owner.post('/api/issues/bulk', {
      data: { issueIds: [a.id, b.id], operations: { status: 'To Do', priority: 'High', assignee: ACCOUNTS.member.name } },
    }), 200)
    expect(res).toMatchObject({ updated: 2, skipped: 0 })
    for (const id of [a.id, b.id]) {
      expect(await expectStatus(await owner.get(`/api/issues/${id}`), 200))
        .toMatchObject({ status: 'To Do', priority: 'High', assignee: ACCOUNTS.member.name })
    }
  })

  test('bulk move to a sprint and back to no sprint', async () => {
    const sprint = await createSprint(owner, project.id)
    try {
      const a = await createIssue(owner, project.id, { status: 'Backlog' })
      await expectStatus(await owner.post('/api/issues/bulk', { data: { issueIds: [a.id], operations: { sprintId: sprint.id } } }), 200)
      expect((await expectStatus(await owner.get(`/api/issues/${a.id}`), 200)).sprintId).toBe(sprint.id)
      await expectStatus(await owner.post('/api/issues/bulk', { data: { issueIds: [a.id], operations: { sprintId: null } } }), 200)
      expect((await expectStatus(await owner.get(`/api/issues/${a.id}`), 200)).sprintId).toBeNull()
    } finally {
      await retireSprint(owner, sprint.id)
    }
  })

  test('bulk delete removes the issues', async () => {
    const a = await createIssue(owner, project.id, { status: 'Backlog' })
    const b = await createIssue(owner, project.id, { status: 'Backlog' })
    const res = await expectStatus(await owner.post('/api/issues/bulk', { data: { issueIds: [a.id, b.id], operations: { delete: true } } }), 200)
    expect(res.updated).toBe(2)
    await expectStatus(await owner.get(`/api/issues/${a.id}`), 404)
    await expectStatus(await owner.get(`/api/issues/${b.id}`), 404)
  })

  test('invalid values, unknown assignees and missing issues are reported per issue', async () => {
    const a = await createIssue(owner, project.id, { status: 'Backlog' })
    const badStatus = await expectStatus(await owner.post('/api/issues/bulk', { data: { issueIds: [a.id], operations: { status: 'Shipped' } } }), 200)
    expect(badStatus.errors).toEqual([{ issueId: a.id, error: 'Invalid status "Shipped"' }])
    const badAssignee = await expectStatus(await owner.post('/api/issues/bulk', { data: { issueIds: [a.id, 99999999], operations: { assignee: 'Nobody Atall' } } }), 200)
    expect(badAssignee.updated).toBe(0)
    expect(badAssignee.errors).toEqual(expect.arrayContaining([
      { issueId: a.id, error: 'Assignee not found' },
      { issueId: 99999999, error: 'Issue not found' },
    ]))
    expect((await expectStatus(await owner.post('/api/issues/bulk', { data: { issueIds: [] } }), 400)).error).toBe('issueIds must be a non-empty array')
  })

  test('a project Viewer cannot bulk-edit issues', async () => {
    const a = await createIssue(owner, project.id, { status: 'Backlog', priority: 'Low' })
    const res = await expectStatus(await viewer.post('/api/issues/bulk', { data: { issueIds: [a.id], operations: { priority: 'High' } } }), 200)
    expect(res.errors).toEqual([{ issueId: a.id, error: 'Insufficient project permissions' }])
    expect((await expectStatus(await owner.get(`/api/issues/${a.id}`), 200)).priority).toBe('Low')
  })

  test('bulk status change respects the workflow like a single transition does', async () => {
    test.fail(true, 'DEFECT: POST /api/issues/bulk writes status directly, bypassing workflow transitions (and the open-sub-task rule) that PATCH /:id/status enforces')
    const a = await createIssue(owner, project.id, { status: 'To Do' })
    await expectStatus(await owner.patch(`/api/issues/${a.id}/status`, { data: { status: 'Done' } }), 409)
    const res = await expectStatus(await owner.post('/api/issues/bulk', { data: { issueIds: [a.id], operations: { status: 'Done' } } }), 200)
    expect(res.updated).toBe(0)
  })
})

test.describe('export', () => {
  test('CSV export has the header row and one line per issue', async () => {
    const p = await createProject(owner)
    const i1 = await createIssue(owner, p.id, { status: 'Backlog', title: 'Alpha, with comma' })
    await createIssue(owner, p.id, { status: 'Backlog', title: 'Beta' })
    const res = await owner.get(`/api/projects/${p.id}/export?format=csv`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/csv')
    expect(res.headers()['content-disposition']).toContain(`${p.key}-issues.csv`)
    const text = await res.text()
    const lines = text.trim().split(/\r?\n/)
    expect(lines[0]).toBe('issue_key,title,description,priority,assignee,status,issue_type,sprint_id')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain(`${i1.key},"Alpha, with comma"`)
  })

  test('JSON export carries the project and its issues', async () => {
    const p = await createProject(owner)
    const i1 = await createIssue(owner, p.id, { status: 'Backlog' })
    const body = await expectStatus(await owner.get(`/api/projects/${p.id}/export?format=json`), 200)
    expect(body.project).toMatchObject({ id: p.id, key: p.key })
    expect(body.issues.map((i) => i.issue_key)).toEqual([i1.key])
  })

  test('a project Viewer can export; a non-member cannot', async () => {
    await expectStatus(await viewer.get(`/api/projects/${project.id}/export?format=json`), 200)
    const other = await createProject(owner)
    await expectStatus(await member.get(`/api/projects/${other.id}/export?format=json`), 403)
  })
})

test.describe('import', () => {
  const csv = [
    'Summary,Priority,State,Type',
    'Imported one,High,To Do,Bug',
    ',Low,To Do,Task',
    'Imported three,Highest,in progress,Story',
    'Imported four,Medium,Teleported,Task',
  ].join('\n')
  const mapping = { title: 'Summary', priority: 'Priority', status: 'State', issue_type: 'Type' }

  test('dry run (the default) previews valid rows, reports invalid rows and alias warnings, writes nothing', async () => {
    const p = await createProject(owner)
    const res = await expectStatus(await owner.post(`/api/projects/${p.id}/import`, { data: { csv, mapping } }), 200)
    expect(res).toMatchObject({ dryRun: true, totalRows: 4, valid: 2, invalid: 2 })
    expect(res.errors).toEqual([
      { row: 3, errors: ['title is required'] },
      { row: 5, errors: [expect.stringContaining('invalid status "Teleported"')] },
    ])
    expect(res.warnings).toEqual([{ row: 4, field: 'priority', from: 'Highest', to: 'High' }])
    expect(res.preview.map((r) => r.status)).toEqual(['To Do', 'In Progress'])
    const exported = await expectStatus(await owner.get(`/api/projects/${p.id}/export?format=json`), 200)
    expect(exported.issues).toEqual([])
  })

  test('commit creates the valid rows with sequential keys and later issues continue the sequence', async () => {
    const p = await createProject(owner)
    const res = await expectStatus(await owner.post(`/api/projects/${p.id}/import`, { data: { csv, mapping, dryRun: false } }), 201)
    expect(res).toMatchObject({ dryRun: false, created: 2, invalid: 2 })
    expect(res.keys.map((k) => k.issue_key)).toEqual([`${p.key}-1`, `${p.key}-2`])
    const imported = await expectStatus(await owner.get(`/api/issues/${p.key}-1`), 200)
    expect(imported).toMatchObject({ title: 'Imported one', priority: 'High', issueType: 'Bug', projectId: p.id })
    const next = await createIssue(owner, p.id, { status: 'Backlog' })
    expect(next.key).toBe(`${p.key}-3`)
  })

  test('empty or header-only CSV is rejected; a Viewer cannot import', async () => {
    const p = await createProject(owner)
    expect((await expectStatus(await owner.post(`/api/projects/${p.id}/import`, { data: { csv: '' } }), 400)).error).toBe('csv content is required')
    expect((await expectStatus(await owner.post(`/api/projects/${p.id}/import`, { data: { csv: 'title\n' } }), 400)).error)
      .toBe('CSV must have a header row and at least one data row')
    await expectStatus(await viewer.post(`/api/projects/${project.id}/import`, { data: { csv: 'title\nx' } }), 403)
  })

  test('a row naming a sprint that does not exist is reported as invalid, not a 500', async () => {
    const p = await createProject(owner)
    const bad = 'title,sprint_id\nGhost sprint row,99999999'
    const dry = await expectStatus(await owner.post(`/api/projects/${p.id}/import`, { data: { csv: bad } }), 200)
    expect(dry.invalid).toBe(1)
    const commit = await owner.post(`/api/projects/${p.id}/import`, { data: { csv: bad, dryRun: false } })
    expect(commit.status()).not.toBe(500)
  })
})
