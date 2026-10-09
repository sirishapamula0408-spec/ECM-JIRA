// JL-157 Track B — Issues API: create/validate/edit, workflow transitions,
// sub-tasks, labels, links, attachments, comments + @mentions, watchers,
// worklogs/estimates, custom fields, votes, delete cascade, key addressing.
import { test, expect } from '@playwright/test'
import { apiAs, expectStatus, uniq } from '../support/api.mjs'
import { ACCOUNTS } from '../support/env.mjs'
import { createProject, createIssue, addToProject, b64 } from '../support/track-b.mjs'

let owner, member, viewer
let project // owner Lead, member = project Member, viewer = project Viewer

test.beforeAll(async () => {
  owner = await apiAs('owner')
  member = await apiAs('member')
  viewer = await apiAs('viewer')
  project = await createProject(owner)
  await addToProject(owner, project.id, member, 'Member')
  await addToProject(owner, project.id, viewer, 'Viewer')
})
test.afterAll(async () => {
  await Promise.all([owner, member, viewer].map((a) => a?.dispose()))
})

const newIssue = (overrides) => createIssue(owner, project.id, overrides)

test.describe('create', () => {
  for (const type of ['Epic', 'Story', 'Bug', 'Task']) {
    test(`creates a ${type} with a project-scoped key`, async () => {
      const issue = await newIssue({ issueType: type, status: 'Backlog' })
      expect(issue.issueType).toBe(type)
      expect(issue.key).toMatch(new RegExp(`^${project.key}-\\d+$`))
      expect(issue.projectId).toBe(project.id)
      expect(issue.reporter).toBe(ACCOUNTS.owner.email)
    })
  }

  test('keys are allocated sequentially within the project', async () => {
    const a = await newIssue({ status: 'Backlog' })
    const b = await newIssue({ status: 'Backlog' })
    const n = (k) => Number(k.split('-').pop())
    expect(n(b.key)).toBe(n(a.key) + 1)
  })

  test('a Story can be attached to an Epic and appears as its child', async () => {
    const epic = await newIssue({ issueType: 'Epic', status: 'Backlog' })
    const story = await newIssue({ issueType: 'Story', status: 'Backlog', epicId: epic.id })
    expect(story.epicId).toBe(epic.id)
    const kids = await expectStatus(await owner.get(`/api/issues/${epic.id}/epic-children`), 200)
    expect(kids.children.map((c) => c.id)).toContain(story.id)
    const notEpic = await expectStatus(await owner.post('/api/issues', {
      data: { title: 't', description: 'd', assignee: 'a', priority: 'Low', status: 'Backlog', issueType: 'Task', projectId: project.id, epicId: story.id },
    }), 400)
    expect(notEpic.error).toBe('Referenced issue is not an Epic')
  })

  for (const field of ['title', 'description', 'assignee']) {
    test(`missing ${field} is rejected with 400`, async () => {
      const data = { title: 'T', description: 'D', assignee: 'A', priority: 'Low', status: 'Backlog', issueType: 'Task', projectId: project.id }
      data[field] = '   '
      const body = await expectStatus(await owner.post('/api/issues', { data }), 400)
      expect(body.error).toBe('title, description, and assignee are required')
    })
  }

  test('invalid priority, status and type are each rejected', async () => {
    const base = { title: 'T', description: 'D', assignee: 'A', priority: 'Low', status: 'Backlog', issueType: 'Task', projectId: project.id }
    const p = await expectStatus(await owner.post('/api/issues', { data: { ...base, priority: 'Urgent' } }), 400)
    expect(p.error).toBe('priority must be Low, Medium, or High')
    const s = await expectStatus(await owner.post('/api/issues', { data: { ...base, status: 'Doing' } }), 400)
    expect(s.error).toBe('status is invalid')
    const t = await expectStatus(await owner.post('/api/issues', { data: { ...base, issueType: 'Feature' } }), 400)
    expect(t.error).toMatch(/^issueType must be/)
  })

  test('title over 255 characters and negative story points are rejected', async () => {
    const base = { title: 'T', description: 'D', assignee: 'A', priority: 'Low', status: 'Backlog', issueType: 'Task', projectId: project.id }
    const long = await expectStatus(await owner.post('/api/issues', { data: { ...base, title: 'x'.repeat(256) } }), 400)
    expect(long.error).toBe('title must be at most 255 characters')
    const sp = await expectStatus(await owner.post('/api/issues', { data: { ...base, storyPoints: -3 } }), 400)
    expect(sp.error).toBe('storyPoints must be a non-negative integer')
  })

  test('a project Viewer cannot create issues; a project Member can', async () => {
    const data = { title: uniq('V'), description: 'D', assignee: 'A', priority: 'Low', status: 'Backlog', issueType: 'Task', projectId: project.id }
    await expectStatus(await viewer.post('/api/issues', { data }), 403)
    await expectStatus(await member.post('/api/issues', { data }), 201)
  })

  test('an issue created outside Backlog without a sprint is not dropped into an unrelated sprint', async () => {
    // A sprint that belongs to a different project (JL-165).
    const sprint = await expectStatus(await owner.post('/api/sprints', { data: { projectId: project.id, name: uniq('Foreign') } }), 201)
    try {
      const other = await createProject(owner)
      const issue = await createIssue(owner, other.id, { status: 'To Do' })
      expect(issue.sprintId).toBeNull()
    } finally {
      await owner.delete(`/api/sprints/${sprint.id}`)
    }
  })
})

test.describe('read and edit', () => {
  test('the canonical key addresses an issue (any case); bad refs are 400/404', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const byKey = await expectStatus(await owner.get(`/api/issues/${issue.key}`), 200)
    expect(byKey.id).toBe(issue.id)
    const lower = await expectStatus(await owner.get(`/api/issues/${issue.key.toLowerCase()}`), 200)
    expect(lower.id).toBe(issue.id)
    await expectStatus(await owner.get(`/api/issues/${project.key}-999999`), 404)
    await expectStatus(await owner.get('/api/issues/not a key!'), 400)
  })

  test('edit title, priority, assignee and story points; the change is recorded in history', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const title = uniq('Edited')
    const updated = await expectStatus(await owner.patch(`/api/issues/${issue.id}`, {
      data: { title, priority: 'High', assignee: ACCOUNTS.member.name, storyPoints: 5 },
    }), 200)
    expect(updated).toMatchObject({ title, priority: 'High', assignee: ACCOUNTS.member.name, storyPoints: 5 })
    const history = await expectStatus(await owner.get(`/api/issues/${issue.id}/history`), 200)
    const fields = history.map((h) => h.field)
    expect(fields).toEqual(expect.arrayContaining(['title', 'priority', 'assignee']))
  })

  test('edit validation: empty title, bad priority, bad flag value', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    expect((await expectStatus(await owner.patch(`/api/issues/${issue.id}`, { data: { title: ' ' } }), 400)).error).toBe('title cannot be empty')
    expect((await expectStatus(await owner.patch(`/api/issues/${issue.id}`, { data: { priority: 'P1' } }), 400)).error).toBe('priority must be Low, Medium, or High')
    expect((await expectStatus(await owner.patch(`/api/issues/${issue.id}`, { data: { flagged: 'yes' } }), 400)).error).toBe('flagged must be a boolean')
  })

  test('flag an issue as an impediment and clear it', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    expect((await expectStatus(await owner.patch(`/api/issues/${issue.id}`, { data: { flagged: true } }), 200)).flagged).toBe(true)
    expect((await expectStatus(await owner.patch(`/api/issues/${issue.id}`, { data: { flagged: false } }), 200)).flagged).toBe(false)
  })

  test('a project Viewer can read but not edit; a non-member Member cannot read', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    await expectStatus(await viewer.get(`/api/issues/${issue.id}`), 200)
    await expectStatus(await viewer.patch(`/api/issues/${issue.id}`, { data: { title: 'x' } }), 403)
    const other = await createProject(owner)
    const hidden = await createIssue(owner, other.id, { status: 'Backlog' })
    await expectStatus(await member.get(`/api/issues/${hidden.id}`), 403)
  })
})

test.describe('workflow transitions', () => {
  test('allowed transitions follow the QA lifecycle', async () => {
    const issue = await newIssue({ status: 'To Do' })
    const moved = await expectStatus(await owner.patch(`/api/issues/${issue.id}/status`, { data: { status: 'In Progress' } }), 200)
    expect(moved.status).toBe('In Progress')
  })

  test('a transition the workflow forbids is refused with 409', async () => {
    const issue = await newIssue({ status: 'To Do' })
    const body = await expectStatus(await owner.patch(`/api/issues/${issue.id}/status`, { data: { status: 'Done' } }), 409)
    expect(body.error).toBe('Transition from "To Do" to "Done" is not allowed by the workflow')
  })

  test('cancel is allowed from any active state; Done is terminal', async () => {
    const a = await newIssue({ status: 'In Progress' })
    expect((await expectStatus(await owner.patch(`/api/issues/${a.id}/status`, { data: { status: 'Cancelled' } }), 200)).status).toBe('Cancelled')
    const b = await newIssue({ status: 'In UAT' })
    await expectStatus(await owner.patch(`/api/issues/${b.id}/status`, { data: { status: 'Done' } }), 200)
    await expectStatus(await owner.patch(`/api/issues/${b.id}/status`, { data: { status: 'In Progress' } }), 409)
  })

  test('an unknown status value is rejected with 400', async () => {
    const issue = await newIssue({ status: 'To Do' })
    const body = await expectStatus(await owner.patch(`/api/issues/${issue.id}/status`, { data: { status: 'Shipped' } }), 400)
    expect(body.error).toBe('Invalid status value')
  })
})

test.describe('sub-tasks', () => {
  test('create a sub-task under a parent; it inherits the project and is listed with progress', async () => {
    const parent = await newIssue({ status: 'Backlog' })
    const sub = await expectStatus(await owner.post(`/api/issues/${parent.id}/subtasks`, { data: { title: uniq('Sub') } }), 201)
    expect(sub).toMatchObject({ issueType: 'Sub-task', parentId: parent.id, projectId: project.id, status: 'To Do' })
    const list = await expectStatus(await owner.get(`/api/issues/${parent.id}/subtasks`), 200)
    expect(list.subtasks.map((s) => s.id)).toEqual([sub.id])
    expect(list.progress).toEqual({ total: 1, done: 0, percent: 0 })
    const detail = await expectStatus(await owner.get(`/api/issues/${sub.id}`), 200)
    expect(detail.parentKey).toBe(parent.key)
  })

  test('a nested sub-task is refused with 400; a missing title too', async () => {
    const parent = await newIssue({ status: 'Backlog' })
    const sub = await expectStatus(await owner.post(`/api/issues/${parent.id}/subtasks`, { data: { title: 'child' } }), 201)
    const nested = await expectStatus(await owner.post(`/api/issues/${sub.id}/subtasks`, { data: { title: 'grandchild' } }), 400)
    expect(nested.error).toBe('Cannot create a sub-task under another sub-task.')
    const noTitle = await expectStatus(await owner.post(`/api/issues/${parent.id}/subtasks`, { data: {} }), 400)
    expect(noTitle.error).toBe('title is required')
  })

  test('a parent with an open sub-task cannot be closed (409) until the sub-task is done', async () => {
    const parent = await newIssue({ status: 'In UAT' })
    const sub = await expectStatus(await owner.post(`/api/issues/${parent.id}/subtasks`, { data: { title: 'open child', status: 'In UAT' } }), 201)
    const blocked = await expectStatus(await owner.patch(`/api/issues/${parent.id}/status`, { data: { status: 'Done' } }), 409)
    expect(blocked.error).toBe('Cannot close issue with open sub-tasks')
    expect(blocked.openSubtasks.map((s) => s.id)).toEqual([sub.id])
    await expectStatus(await owner.patch(`/api/issues/${sub.id}/status`, { data: { status: 'Done' } }), 200)
    await expectStatus(await owner.patch(`/api/issues/${parent.id}/status`, { data: { status: 'Done' } }), 200)
  })
})

test.describe('labels', () => {
  test('create project labels, assign them to an issue and read them back', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const name = uniq('lbl')
    const label = await expectStatus(await owner.post(`/api/projects/${project.id}/labels`, { data: { name, color: '#FF5630' } }), 201)
    const again = await expectStatus(await owner.post(`/api/projects/${project.id}/labels`, { data: { name: name.toUpperCase() } }), 200)
    expect(again.existed).toBe(true)
    const set = await expectStatus(await owner.put(`/api/issues/${issue.id}/labels`, { data: { labelIds: [label.id] } }), 200)
    expect(set.map((l) => l.name)).toEqual([name])
    const catalog = await expectStatus(await owner.get(`/api/projects/${project.id}/labels?search=${name}`), 200)
    expect(catalog.find((l) => l.id === label.id).issueCount).toBe(1)
  })

  test('label validation: name required, bad colour, over 60 characters', async () => {
    const url = `/api/projects/${project.id}/labels`
    expect((await expectStatus(await owner.post(url, { data: { name: '' } }), 400)).error).toBe('Label name is required')
    expect((await expectStatus(await owner.post(url, { data: { name: uniq('c'), color: 'red' } }), 400)).error).toBe('color must be a hex value like #FF5630')
    expect((await expectStatus(await owner.post(url, { data: { name: 'L'.repeat(61) } }), 400)).error).toBe('name must be at most 60 characters')
  })
})

test.describe('links', () => {
  test('blocks link is visible from both sides with the inverse name', async () => {
    const a = await newIssue({ status: 'Backlog' })
    const b = await newIssue({ status: 'Backlog' })
    await expectStatus(await owner.post(`/api/issues/${a.id}/links`, { data: { type: 'blocks', targetIssueId: b.id } }), 201)
    const fromA = await expectStatus(await owner.get(`/api/issues/${a.id}/links`), 200)
    expect(fromA).toEqual([expect.objectContaining({ type: 'blocks', issue: expect.objectContaining({ id: b.id, key: b.key }) })])
    const fromB = await expectStatus(await owner.get(`/api/issues/${b.id}/links`), 200)
    expect(fromB).toEqual([expect.objectContaining({ type: 'is blocked by', issue: expect.objectContaining({ id: a.id }) })])
  })

  test('duplicates and relates-to links; removing a link', async () => {
    const a = await newIssue({ status: 'Backlog' })
    const b = await newIssue({ status: 'Backlog' })
    const c = await newIssue({ status: 'Backlog' })
    const dup = await expectStatus(await owner.post(`/api/issues/${a.id}/links`, { data: { type: 'duplicates', targetIssueId: b.id } }), 201)
    await expectStatus(await owner.post(`/api/issues/${a.id}/links`, { data: { type: 'relates to', targetIssueId: c.id } }), 201)
    const fromB = await expectStatus(await owner.get(`/api/issues/${b.id}/links`), 200)
    expect(fromB[0].type).toBe('is duplicated by')
    await expectStatus(await owner.delete(`/api/links/${dup.id}`), 200)
    expect(await expectStatus(await owner.get(`/api/issues/${b.id}/links`), 200)).toEqual([])
  })

  test('self-links, duplicate links (either direction) and unknown types are refused', async () => {
    const a = await newIssue({ status: 'Backlog' })
    const b = await newIssue({ status: 'Backlog' })
    await expectStatus(await owner.post(`/api/issues/${a.id}/links`, { data: { type: 'blocks', targetIssueId: a.id } }), 400)
    await expectStatus(await owner.post(`/api/issues/${a.id}/links`, { data: { type: 'blocks', targetIssueId: b.id } }), 201)
    expect((await expectStatus(await owner.post(`/api/issues/${a.id}/links`, { data: { type: 'blocks', targetIssueId: b.id } }), 409)).error).toBe('This link already exists')
    await expectStatus(await owner.post(`/api/issues/${b.id}/links`, { data: { type: 'is blocked by', targetIssueId: a.id } }), 409)
    await expectStatus(await owner.post(`/api/issues/${a.id}/links`, { data: { type: 'causes', targetIssueId: b.id } }), 400)
  })
})

test.describe('attachments', () => {
  test('upload, list, download and delete a text attachment', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const content = `hello from ${uniq('att')}`
    const att = await expectStatus(await owner.post(`/api/issues/${issue.id}/attachments`, {
      data: { filename: 'notes.txt', mime: 'text/plain', dataBase64: b64(content) },
    }), 201)
    expect(att).toMatchObject({ filename: 'notes.txt', size: Buffer.byteLength(content), uploadedBy: ACCOUNTS.owner.email })
    const list = await expectStatus(await owner.get(`/api/issues/${issue.id}/attachments`), 200)
    expect(list.map((a) => a.id)).toContain(att.id)
    const dl = await owner.get(`/api/attachments/${att.id}/download`)
    expect(dl.status()).toBe(200)
    expect(dl.headers()['content-disposition']).toContain('notes.txt')
    expect(await dl.text()).toBe(content)
    await expectStatus(await owner.delete(`/api/attachments/${att.id}`), 200)
    expect(await expectStatus(await owner.get(`/api/issues/${issue.id}/attachments`), 200)).toEqual([])
  })

  test('an executable is refused with 415', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const body = await expectStatus(await owner.post(`/api/issues/${issue.id}/attachments`, {
      data: { filename: 'setup.exe', mime: 'application/octet-stream', dataBase64: b64('MZ') },
    }), 415)
    expect(body.error).toBe('Executable files are not allowed. ".exe" cannot be uploaded.')
  })

  test('a file over 10 MB is refused with 413', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const big = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x61).toString('base64')
    const body = await expectStatus(await owner.post(`/api/issues/${issue.id}/attachments`, {
      data: { filename: 'big.txt', mime: 'text/plain', dataBase64: big },
    }), 413)
    expect(body.error).toMatch(/Maximum allowed size is 10 MB/)
  })

  test('a project Viewer cannot upload', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    await expectStatus(await viewer.post(`/api/issues/${issue.id}/attachments`, {
      data: { filename: 'a.txt', mime: 'text/plain', dataBase64: b64('x') },
    }), 403)
  })
})

test.describe('comments, mentions and watchers', () => {
  test('a comment with an @mention notifies the mentioned member', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const text = `Please review @${ACCOUNTS.member.email} ${uniq('ping')}`
    const comment = await expectStatus(await owner.post(`/api/issues/${issue.id}/comments`, { data: { text } }), 201)
    expect(comment.text).toBe(text)
    const comments = await expectStatus(await owner.get(`/api/issues/${issue.id}/comments`), 200)
    expect(comments.map((c) => c.id)).toContain(comment.id)
    const inbox = await expectStatus(await member.get('/api/notifications?limit=100'), 200)
    const hit = inbox.notifications.find((n) => n.type === 'mention' && n.issue_id === issue.id)
    expect(hit).toBeTruthy()
    expect(hit.title).toBe(`Mentioned in ${issue.key}`)
  })

  test('empty and over-long comments are rejected; a Viewer cannot comment', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    expect((await expectStatus(await owner.post(`/api/issues/${issue.id}/comments`, { data: { text: '  ' } }), 400)).error).toBe('Comment text is required')
    expect((await expectStatus(await owner.post(`/api/issues/${issue.id}/comments`, { data: { text: 'x'.repeat(10001) } }), 400)).error).toBe('text must be at most 10000 characters')
    await expectStatus(await viewer.post(`/api/issues/${issue.id}/comments`, { data: { text: 'hi' } }), 403)
  })

  test('the creator auto-watches on create and a commenter auto-watches on comment', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    let w = await expectStatus(await owner.get(`/api/issues/${issue.id}/watchers`), 200)
    expect(w.isWatching).toBe(true)
    expect(w.watchers.map((x) => x.user_email)).toEqual([ACCOUNTS.owner.email])
    await expectStatus(await member.post(`/api/issues/${issue.id}/comments`, { data: { text: 'on it' } }), 201)
    w = await expectStatus(await member.get(`/api/issues/${issue.id}/watchers`), 200)
    expect(w.isWatching).toBe(true)
    expect(w.count).toBe(2)
  })

  test('watchers are notified of new comments', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    await expectStatus(await member.post(`/api/issues/${issue.id}/watchers`), 201)
    const text = uniq('watched-comment')
    await expectStatus(await owner.post(`/api/issues/${issue.id}/comments`, { data: { text } }), 201)
    const inbox = await expectStatus(await member.get('/api/notifications?limit=100'), 200)
    expect(inbox.notifications.some((n) => n.type === 'comment' && n.issue_id === issue.id)).toBe(true)
  })

  test('watch and unwatch are idempotent', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    expect((await expectStatus(await member.post(`/api/issues/${issue.id}/watchers`), 201)).action).toBe('watching')
    expect((await expectStatus(await member.post(`/api/issues/${issue.id}/watchers`), 200)).action).toBe('already_watching')
    await expectStatus(await member.delete(`/api/issues/${issue.id}/watchers`), 200)
    expect((await expectStatus(await member.get(`/api/issues/${issue.id}/watchers`), 200)).isWatching).toBe(false)
  })

  test("a non-member cannot list or join the watchers of a project's issue", async () => {
    test.fail(true, 'DEFECT: watcher routes (server/routes/watchers.js) have no project-access guard — any signed-in user can read and add watchers on any issue')
    const other = await createProject(owner)
    const hidden = await createIssue(owner, other.id, { status: 'Backlog' })
    const read = await member.get(`/api/issues/${hidden.id}/watchers`)
    expect(read.status()).toBe(403)
  })
})

test.describe('time tracking', () => {
  test('estimate "1d 4h" parses to 720 minutes; logging "45m" updates spent and remaining', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const est = await expectStatus(await owner.put(`/api/issues/${issue.id}/estimate`, { data: { estimate: '1d 4h' } }), 200)
    expect(est).toMatchObject({ estimateMinutes: 720, spentMinutes: 0, remainingMinutes: 720, estimateText: '1d 4h' })
    const after = await expectStatus(await owner.post(`/api/issues/${issue.id}/worklogs`, { data: { timeSpent: '45m', description: 'investigation' } }), 201)
    expect(after).toMatchObject({ spentMinutes: 45, remainingMinutes: 675, spentText: '45m', remainingText: '1d 3h 15m' })
    const list = await expectStatus(await owner.get(`/api/issues/${issue.id}/worklogs`), 200)
    expect(list.worklogs).toHaveLength(1)
    expect(list.worklogs[0]).toMatchObject({ time_spent_minutes: 45, author: ACCOUNTS.owner.email, timeSpentText: '45m' })
  })

  test('deleting a worklog restores the remaining time', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    await owner.put(`/api/issues/${issue.id}/estimate`, { data: { estimate: '2h' } })
    await expectStatus(await owner.post(`/api/issues/${issue.id}/worklogs`, { data: { timeSpent: '1h 30m' } }), 201)
    const { worklogs } = await expectStatus(await owner.get(`/api/issues/${issue.id}/worklogs`), 200)
    const del = await expectStatus(await owner.delete(`/api/worklogs/${worklogs[0].id}`), 200)
    expect(del.summary).toMatchObject({ spentMinutes: 0, remainingMinutes: 120 })
  })

  test('unparseable time is rejected', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    expect((await expectStatus(await owner.post(`/api/issues/${issue.id}/worklogs`, { data: { timeSpent: 'soon' } }), 400)).error)
      .toBe('timeSpent must be like "2h 30m", "45m", or a number of minutes')
    await expectStatus(await owner.put(`/api/issues/${issue.id}/estimate`, { data: { estimate: 'lots' } }), 400)
  })
})

test.describe('custom fields', () => {
  test('an admin defines a dropdown field and a member sets a value on an issue', async () => {
    const name = uniq('Severity')
    const field = await expectStatus(await owner.post(`/api/projects/${project.id}/custom-fields`, {
      data: { name, fieldType: 'dropdown', options: ['S1', 'S2', 'S3'] },
    }), 201)
    expect(field).toMatchObject({ name, fieldType: 'dropdown', options: ['S1', 'S2', 'S3'] })
    const issue = await newIssue({ status: 'Backlog' })
    const set = await expectStatus(await member.put(`/api/issues/${issue.id}/custom-fields/${field.id}`, { data: { value: 'S2' } }), 200)
    expect(set).toEqual({ fieldId: field.id, value: 'S2' })
    const values = await expectStatus(await owner.get(`/api/issues/${issue.id}/custom-fields`), 200)
    expect(values.find((f) => f.id === field.id).value).toBe('S2')
    expect((await expectStatus(await owner.put(`/api/issues/${issue.id}/custom-fields/${field.id}`, { data: { value: 'S9' } }), 400)).error)
      .toBe('Value must be one of the field options')
  })

  test('a workspace Member cannot define fields; bad definitions are rejected', async () => {
    await expectStatus(await member.post(`/api/projects/${project.id}/custom-fields`, { data: { name: 'x', fieldType: 'text' } }), 403)
    await expectStatus(await owner.post(`/api/projects/${project.id}/custom-fields`, { data: { name: 'x', fieldType: 'colour' } }), 400)
    expect((await expectStatus(await owner.post(`/api/projects/${project.id}/custom-fields`, { data: { name: 'x', fieldType: 'dropdown' } }), 400)).error)
      .toBe('dropdown fields need at least one option')
  })

  test('a number field rejects non-numeric values', async () => {
    const field = await expectStatus(await owner.post(`/api/projects/${project.id}/custom-fields`, { data: { name: uniq('Cost'), fieldType: 'number' } }), 201)
    const issue = await newIssue({ status: 'Backlog' })
    await expectStatus(await owner.put(`/api/issues/${issue.id}/custom-fields/${field.id}`, { data: { value: 'ten' } }), 400)
    expect((await expectStatus(await owner.put(`/api/issues/${issue.id}/custom-fields/${field.id}`, { data: { value: '10' } }), 200)).value).toBe('10')
  })
})

test.describe('votes', () => {
  test('vote, vote again (idempotent), read the count, unvote', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    expect(await expectStatus(await member.post(`/api/issues/${issue.id}/votes`), 201)).toMatchObject({ action: 'voted', count: 1 })
    expect(await expectStatus(await member.post(`/api/issues/${issue.id}/votes`), 200)).toMatchObject({ action: 'already_voted', count: 1 })
    await expectStatus(await owner.post(`/api/issues/${issue.id}/votes`), 201)
    const got = await expectStatus(await member.get(`/api/issues/${issue.id}/votes`), 200)
    expect(got).toMatchObject({ count: 2, hasVoted: true })
    expect(await expectStatus(await member.delete(`/api/issues/${issue.id}/votes`), 200)).toMatchObject({ hasVoted: false, count: 1 })
  })
})

test.describe('delete', () => {
  test('deleting an issue cascades to its sub-tasks, comments, labels, links and worklogs', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const other = await newIssue({ status: 'Backlog' })
    const sub = await expectStatus(await owner.post(`/api/issues/${issue.id}/subtasks`, { data: { title: 'child' } }), 201)
    await expectStatus(await owner.post(`/api/issues/${issue.id}/comments`, { data: { text: 'bye' } }), 201)
    await expectStatus(await owner.post(`/api/issues/${issue.id}/links`, { data: { type: 'relates to', targetIssueId: other.id } }), 201)
    await expectStatus(await owner.post(`/api/issues/${issue.id}/worklogs`, { data: { timeSpent: '1h' } }), 201)
    const label = await expectStatus(await owner.post(`/api/projects/${project.id}/labels`, { data: { name: uniq('gone') } }), 201)
    await owner.put(`/api/issues/${issue.id}/labels`, { data: { labelIds: [label.id] } })

    const del = await expectStatus(await owner.delete(`/api/issues/${issue.id}`), 200)
    expect(del).toEqual({ success: true, id: issue.id })
    await expectStatus(await owner.get(`/api/issues/${issue.id}`), 404)
    await expectStatus(await owner.get(`/api/issues/${sub.id}`), 404)
    expect(await expectStatus(await owner.get(`/api/issues/${other.id}/links`), 200)).toEqual([])
    expect(await expectStatus(await owner.get(`/api/issues/${issue.id}/comments`), 200)).toEqual([])
    const catalog = await expectStatus(await owner.get(`/api/projects/${project.id}/labels?search=${label.name}`), 200)
    expect(catalog[0].issueCount).toBe(0)
    await expectStatus(await owner.delete(`/api/issues/${issue.id}`), 404)
  })

  test('a project Viewer cannot delete an issue', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    await expectStatus(await viewer.delete(`/api/issues/${issue.id}`), 403)
  })

  test('cloning an issue allocates a fresh key and copies its labels', async () => {
    const issue = await newIssue({ status: 'Backlog' })
    const label = await expectStatus(await owner.post(`/api/projects/${project.id}/labels`, { data: { name: uniq('cl') } }), 201)
    await owner.put(`/api/issues/${issue.id}/labels`, { data: { labelIds: [label.id] } })
    const clone = await expectStatus(await owner.post(`/api/issues/${issue.id}/clone`), 201)
    expect(clone.title).toBe(`CLONE - ${issue.title}`)
    expect(clone.key).not.toBe(issue.key)
    const labels = await expectStatus(await owner.get(`/api/issues/${clone.id}/labels`), 200)
    expect(labels.map((l) => l.id)).toEqual([label.id])
  })
})

