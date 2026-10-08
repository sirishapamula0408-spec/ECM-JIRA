// JL-157 Track C — Tracking, API layer: dashboard + gadgets, reports, saved
// filters + JQL, activity feed, notifications.
import { test, expect } from '@playwright/test'
import { apiAs, uniq } from '../support/api.mjs'
import { ACCOUNTS } from '../support/env.mjs'
import { freshUser, expectStatus, createIssue, createProject } from '../support/track-c.mjs'

const ALL_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'In Testing', 'In Rework', 'In UAT', 'Done', 'Cancelled']

let owner
let member
let project
let issues // keyed by status
let doneViaTransition

test.beforeAll(async () => {
  owner = await apiAs('owner')
  member = await apiAs('member')
  project = await createProject(owner)
  issues = {}
  for (const status of ['To Do', 'In Progress', 'In Testing', 'Cancelled', 'Backlog']) {
    issues[status] = await createIssue(owner, project.id, { status, priority: status === 'In Progress' ? 'High' : 'Medium' })
  }
  // One issue reaches Done through a real transition so it has history
  // (created-vs-resolved and CFD lead time read issue_history).
  doneViaTransition = await createIssue(owner, project.id, { status: 'In UAT', issueType: 'Bug' })
  await expectStatus(await owner.patch(`/api/issues/${doneViaTransition.id}/status`, { data: { status: 'Done' } }), 200)
})

test.afterAll(async () => {
  await owner?.dispose()
  await member?.dispose()
})

// ───────────────────────────── Dashboard ─────────────────────────────
test.describe('dashboard', () => {
  test('GET /api/dashboard returns metrics, activities and team', async () => {
    const body = await expectStatus(await owner.get('/api/dashboard'), 200)
    for (const k of ['totalTasks', 'inProgress', 'completed', 'critical']) {
      expect(Number(body.metrics[k]), k).toBeGreaterThanOrEqual(0)
    }
    expect(Number(body.metrics.totalTasks)).toBeGreaterThanOrEqual(6)
    expect(Array.isArray(body.activities)).toBe(true)
    expect(body.activities.length).toBeLessThanOrEqual(5)
    expect(Array.isArray(body.team)).toBe(true)
  })

  test('dashboard total grows when an issue is created', async () => {
    const before = await expectStatus(await owner.get('/api/dashboard'), 200)
    await createIssue(owner, project.id)
    const after = await expectStatus(await owner.get('/api/dashboard'), 200)
    expect(Number(after.metrics.totalTasks)).toBeGreaterThan(Number(before.metrics.totalTasks))
  })

  test('gadget catalog lists the six gadget types', async () => {
    const body = await expectStatus(await owner.get('/api/dashboards/gadgets/catalog'), 200)
    const types = body.gadgets.map((g) => g.type).sort()
    expect(types).toEqual(['filter_results', 'issue_count', 'issues_by_assignee', 'issues_by_priority', 'issues_by_status', 'recent_activity'])
  })

  test('issues_by_status gadget counts every status in the project, incl. In Testing and Cancelled', async () => {
    const body = await expectStatus(await owner.post('/api/dashboards/gadgets/data', {
      data: { type: 'issues_by_status', config: { projectId: project.id } },
    }), 200)
    const counts = Object.fromEntries(body.data.map((r) => [r.status, r.count]))
    expect(counts['In Testing']).toBe(1)
    expect(counts.Cancelled).toBe(1)
    expect(counts['In Progress']).toBe(1)
    expect(counts.Done).toBe(1)
  })

  test('issue_count gadget honours a status filter', async () => {
    const body = await expectStatus(await owner.post('/api/dashboards/gadgets/data', {
      data: { type: 'issue_count', config: { projectId: project.id, status: 'In Testing' } },
    }), 200)
    expect(body.data.count).toBe(1)
  })

  test('filter_results gadget lists the project issues by key', async () => {
    const body = await expectStatus(await owner.post('/api/dashboards/gadgets/data', {
      data: { type: 'filter_results', config: { projectId: project.id, priority: 'High' } },
    }), 200)
    expect(body.data.issues.map((i) => i.issue_key)).toEqual([issues['In Progress'].key])
  })

  test('unknown gadget type is rejected with 400', async () => {
    const res = await owner.post('/api/dashboards/gadgets/data', { data: { type: 'nope', config: {} } })
    const body = await expectStatus(res, 400)
    expect(body.error).toContain('Unknown gadget type')
  })

  test('gadgets do not reveal a project the caller is not a member of', async () => {
    const body = await expectStatus(await member.post('/api/dashboards/gadgets/data', {
      data: { type: 'issue_count', config: { projectId: project.id } },
    }), 200)
    expect(body.data.count).toBe(0)
  })
})

// ───────────────────────────── Reports ─────────────────────────────
test.describe('reports', () => {
  test('project report reflects completion and priority mix', async () => {
    const body = await expectStatus(await owner.get(`/api/reports?projectId=${project.id}`), 200)
    // 1 Done out of 6 or 7 issues (one test above may add one).
    expect(body.completionRate).toBeGreaterThanOrEqual(14)
    expect(body.completionRate).toBeLessThanOrEqual(17)
    expect(body.priorityDistribution.critical).toBeGreaterThan(0)
    expect(body.totalPoints).toBeGreaterThan(0)
  })

  test('CFD bands cover every workflow status and count today\'s issues in each', async () => {
    const body = await expectStatus(await owner.get(`/api/reports/cfd?projectId=${project.id}&days=7`), 200)
    expect(body.statuses).toEqual(ALL_STATUSES)
    const today = body.days[body.days.length - 1].counts
    expect(today['In Testing']).toBe(1)
    expect(today.Cancelled).toBe(1)
    expect(today.Done).toBe(1)
    expect(today.Backlog).toBe(1)
  })

  test('CFD current WIP excludes terminal statuses (Done and Cancelled) and Backlog', async () => {
    test.fail(true, 'DEFECT: CFD currentWip counts Cancelled issues as work in progress')
    const body = await expectStatus(await owner.get(`/api/reports/cfd?projectId=${project.id}&days=7`), 200)
    const today = body.days[body.days.length - 1].counts
    const expected = ALL_STATUSES
      .filter((s) => !['Done', 'Cancelled', 'Backlog'].includes(s))
      .reduce((sum, s) => sum + (today[s] || 0), 0)
    expect(body.metrics.currentWip).toBe(expected)
  })

  test('created-vs-resolved counts created and resolved issues for the project', async () => {
    const body = await expectStatus(await owner.get(`/api/reports/created-resolved?projectId=${project.id}&days=7`), 200)
    expect(body.series).toHaveLength(7)
    expect(body.totals.created).toBeGreaterThanOrEqual(6)
    expect(body.totals.resolved).toBe(1)
  })

  test('CFD CSV export is a text/csv download with a column per status', async () => {
    const res = await owner.get(`/api/reports/cfd?projectId=${project.id}&days=7&format=csv`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('text/csv')
    expect(res.headers()['content-disposition']).toContain('cfd.csv')
    const header = (await res.text()).split(/\r?\n/)[0]
    expect(header).toContain('In Testing')
    expect(header).toContain('Cancelled')
  })

  test('burndown requires a sprintId', async () => {
    const body = await expectStatus(await owner.get('/api/reports/burndown'), 400)
    expect(body.error).toBe('sprintId is required')
  })

  test('reports do not disclose a project the caller cannot access', async () => {
    test.fail(true, 'DEFECT: /api/reports?projectId= is not scoped to the caller\'s projects')
    const res = await member.get(`/api/reports?projectId=${project.id}`)
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.totalPoints).toBe(0)
    } else {
      expect([403, 404]).toContain(res.status())
    }
  })
})

// ───────────────────────────── Filters + JQL ─────────────────────────────
test.describe('saved filters', () => {
  test('create a filter, then it is listed as owned by the creator', async () => {
    const name = uniq('Filter')
    const created = await expectStatus(await owner.post('/api/filters', {
      data: { name, description: 'd', criteria: { status: 'In Testing', projectId: project.id } },
    }), 201)
    expect(created.visibility).toBe('private')
    expect(created.isOwner).toBe(true)
    const list = await expectStatus(await owner.get('/api/filters'), 200)
    expect(list.find((f) => f.id === created.id)?.criteria.status).toBe('In Testing')
  })

  test('a filter needs a name', async () => {
    const body = await expectStatus(await owner.post('/api/filters', { data: { name: '  ' } }), 400)
    expect(body.error).toBe('Filter name is required')
  })

  test('invalid visibility is rejected', async () => {
    const body = await expectStatus(await owner.post('/api/filters', { data: { name: uniq('F'), visibility: 'public' } }), 400)
    expect(body.error).toContain('visibility')
  })

  test('owner can rename and star a filter', async () => {
    const created = await expectStatus(await owner.post('/api/filters', { data: { name: uniq('Filter') } }), 201)
    const newName = uniq('Renamed')
    const updated = await expectStatus(await owner.put(`/api/filters/${created.id}`, { data: { name: newName, isStarred: true } }), 200)
    expect(updated.name).toBe(newName)
    expect(updated.isStarred).toBe(true)
  })

  test('a private filter is hidden from, and read-only to, other users', async () => {
    const created = await expectStatus(await owner.post('/api/filters', { data: { name: uniq('Private') } }), 201)
    const theirs = await expectStatus(await member.get('/api/filters'), 200)
    expect(theirs.some((f) => f.id === created.id)).toBe(false)
    const put = await expectStatus(await member.put(`/api/filters/${created.id}`, { data: { name: 'hijack' } }), 403)
    expect(put.error).toBe('Only the owner can edit this filter')
    await expectStatus(await member.delete(`/api/filters/${created.id}`), 403)
  })

  test('a shared filter is visible to others and can be favourited by them', async () => {
    const created = await expectStatus(await owner.post('/api/filters', { data: { name: uniq('Shared'), visibility: 'shared' } }), 201)
    const theirs = await expectStatus(await member.get('/api/filters'), 200)
    const row = theirs.find((f) => f.id === created.id)
    expect(row?.isOwner).toBe(false)
    const fav = await expectStatus(await member.post(`/api/filters/${created.id}/favorite`), 200)
    expect(fav.isFavorite).toBe(true)
    const unfav = await expectStatus(await member.post(`/api/filters/${created.id}/favorite`), 200)
    expect(unfav.isFavorite).toBe(false)
    await expectStatus(await owner.delete(`/api/filters/${created.id}`), 200)
  })

  test('delete a filter; a second delete is 404', async () => {
    const created = await expectStatus(await owner.post('/api/filters', { data: { name: uniq('Gone') } }), 201)
    await expectStatus(await owner.delete(`/api/filters/${created.id}`), 200)
    const list = await expectStatus(await owner.get('/api/filters'), 200)
    expect(list.some((f) => f.id === created.id)).toBe(false)
    await expectStatus(await owner.delete(`/api/filters/${created.id}`), 404)
  })

  test('basic search by project + status returns the matching issue', async () => {
    const rows = await expectStatus(await owner.post('/api/filters/search', { data: { projectId: project.id, status: 'In Testing' } }), 200)
    expect(rows.map((r) => r.id)).toEqual([issues['In Testing'].id])
  })
})

test.describe('JQL', () => {
  test('a valid query by key returns exactly that issue', async () => {
    const key = issues['To Do'].key
    const rows = await expectStatus(await owner.post('/api/filters/jql', { data: { jql: `key = "${key}"` } }), 200)
    expect(rows.map((r) => r.key)).toEqual([key])
  })

  test('project + status clauses combine with AND', async () => {
    const rows = await expectStatus(await owner.post('/api/filters/jql', {
      data: { jql: `project = ${project.id} AND status = "Cancelled"` },
    }), 200)
    expect(rows.map((r) => r.id)).toEqual([issues.Cancelled.id])
  })

  test('IN and ORDER BY work together', async () => {
    const rows = await expectStatus(await owner.post('/api/filters/jql', {
      data: { jql: `project = ${project.id} AND status IN ("In Testing", "Backlog") ORDER BY id ASC` },
    }), 200)
    expect(rows.map((r) => r.id)).toEqual([issues['In Testing'].id, issues.Backlog.id])
  })

  test('an unknown field is a 400 with a helpful message', async () => {
    const body = await expectStatus(await owner.post('/api/filters/jql', { data: { jql: 'colour = red' } }), 400)
    expect(body.error).toBe('Unknown field: "colour"')
  })

  test('an unparseable clause is a 400', async () => {
    const body = await expectStatus(await owner.post('/api/filters/jql', { data: { jql: 'status' } }), 400)
    expect(body.error).toContain('Could not parse clause')
  })

  test('an empty query is a 400', async () => {
    const body = await expectStatus(await owner.post('/api/filters/jql', { data: { jql: '   ' } }), 400)
    expect(body.error).toBe('JQL query is required')
  })

  test('project = <KEY> does not surface a raw database error', async () => {
    test.fail(true, 'DEFECT: JQL "project = KEY" leaks a PostgreSQL integer-cast error instead of resolving the key')
    const res = await owner.post('/api/filters/jql', { data: { jql: `project = ${project.key}` } })
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/invalid input syntax/i)
    expect(res.status()).toBe(200)
    expect(body.length).toBeGreaterThanOrEqual(6)
  })

  test('JQL results are scoped to projects the caller can access', async () => {
    test.fail(true, 'DEFECT: /api/filters/jql returns issues from projects the caller is not a member of')
    const key = issues['To Do'].key
    const rows = await expectStatus(await member.post('/api/filters/jql', { data: { jql: `key = "${key}"` } }), 200)
    expect(rows).toEqual([])
  })
})

// ───────────────────────────── Activity ─────────────────────────────
test.describe('activity feed', () => {
  test('response carries paging metadata', async () => {
    const body = await expectStatus(await owner.get('/api/activity?limit=5'), 200)
    expect(body).toEqual(expect.objectContaining({ limit: 5, offset: 0 }))
    expect(typeof body.total).toBe('number')
    expect(typeof body.hasMore).toBe('boolean')
    expect(body.activities.length).toBeLessThanOrEqual(5)
  })

  test('creating and transitioning issues writes project-attributed rows', async () => {
    const body = await expectStatus(await owner.get(`/api/activity?projectId=${project.id}&limit=100`), 200)
    const actions = body.activities.map((a) => a.action)
    expect(actions).toContain(`created ${issues['To Do'].key} (${issues['To Do'].title})`)
    expect(actions).toContain(`moved ${doneViaTransition.key} to DONE`)
    expect(body.activities.every((a) => a.project_id === project.id)).toBe(true)
  })

  test('the actor is the person who acted, not the assignee', async () => {
    test.fail(true, 'DEFECT: activity rows record the issue assignee as the actor, not the acting user')
    const issue = await createIssue(owner, project.id, { assignee: ACCOUNTS.member.name })
    const body = await expectStatus(await owner.get(`/api/activity?projectId=${project.id}&limit=100`), 200)
    const row = body.activities.find((a) => a.issue_id === issue.id)
    expect(row).toBeTruthy()
    expect([ACCOUNTS.owner.name, ACCOUNTS.owner.email]).toContain(row.actor)
  })

  test('type filter "issue" returns issue activity', async () => {
    test.fail(true, 'DEFECT: issue activity is stored as activity_type "general", so the Issues type filter is always empty')
    const body = await expectStatus(await owner.get(`/api/activity?projectId=${project.id}&type=issue&limit=100`), 200)
    expect(body.total).toBeGreaterThanOrEqual(6)
  })

  test('actor filter returns only that actor\'s rows', async () => {
    const body = await expectStatus(await owner.get(`/api/activity?projectId=${project.id}&actor=${encodeURIComponent(ACCOUNTS.owner.name)}&limit=100`), 200)
    expect(body.activities.length).toBeGreaterThan(0)
    expect(body.activities.every((a) => a.actor === ACCOUNTS.owner.name)).toBe(true)
  })

  test('offset pagination returns disjoint consecutive pages', async () => {
    const p1 = await expectStatus(await owner.get(`/api/activity?projectId=${project.id}&limit=2&offset=0`), 200)
    const p2 = await expectStatus(await owner.get(`/api/activity?projectId=${project.id}&limit=2&offset=2`), 200)
    expect(p1.activities).toHaveLength(2)
    expect(p2.activities).toHaveLength(2)
    expect(p1.hasMore).toBe(true)
    const ids1 = p1.activities.map((a) => a.id)
    expect(p2.activities.some((a) => ids1.includes(a.id))).toBe(false)
    expect(Math.min(...ids1)).toBeGreaterThan(Math.max(...p2.activities.map((a) => a.id)))
  })

  test('cursor pagination continues after nextCursor', async () => {
    const p1 = await expectStatus(await owner.get(`/api/activity?projectId=${project.id}&limit=3`), 200)
    const p2 = await expectStatus(await owner.get(`/api/activity?projectId=${project.id}&limit=3&cursor=${p1.nextCursor}`), 200)
    expect(p2.activities.length).toBeGreaterThan(0)
    expect(p2.activities.every((a) => a.id < p1.nextCursor)).toBe(true)
  })

  test('limit is capped at 100', async () => {
    const body = await expectStatus(await owner.get('/api/activity?limit=1000'), 200)
    expect(body.limit).toBe(100)
  })

  test('a member outside the project cannot see its activity', async () => {
    const body = await expectStatus(await member.get(`/api/activity?projectId=${project.id}`), 200)
    expect(body.activities).toEqual([])
    expect(body.total).toBe(0)
  })
})

// ───────────────────────────── Notifications ─────────────────────────────
test.describe('notifications', () => {
  let user
  test.beforeEach(async () => {
    user = await freshUser(owner)
  })
  test.afterEach(async () => {
    await user?.api.dispose()
  })

  async function inbox(api, query = '') {
    return expectStatus(await api.get(`/api/notifications${query}`), 200)
  }

  test('an @mention in a comment notifies the mentioned user', async () => {
    const issue = issues['To Do']
    await expectStatus(await owner.post(`/api/issues/${issue.id}/comments`, { data: { text: `hey @${user.email} look` } }), 201)
    const box = await inbox(user.api)
    const n = box.notifications.find((x) => x.type === 'mention' && x.issue_id === issue.id)
    expect(n).toBeTruthy()
    expect(n.is_read).toBe(false)
    expect(box.unreadCount).toBeGreaterThanOrEqual(1)
  })

  test('a comment on a watched issue notifies the watcher', async () => {
    const issue = issues['In Testing']
    await expectStatus(await user.api.post(`/api/issues/${issue.id}/watchers`), 201)
    const watchers = await expectStatus(await user.api.get(`/api/issues/${issue.id}/watchers`), 200)
    expect(watchers.isWatching).toBe(true)
    await expectStatus(await owner.post(`/api/issues/${issue.id}/comments`, { data: { text: 'a watched update' } }), 201)
    const box = await inbox(user.api)
    const n = box.notifications.find((x) => x.type === 'comment' && x.issue_id === issue.id)
    expect(n?.title).toBe(`New comment on ${issue.key}`)
  })

  test('nobody is notified of their own @mention', async () => {
    const issue = issues.Backlog
    await expectStatus(await user.api.post(`/api/issues/${issue.id}/watchers`), 201)
    // The user is not a project member, so they cannot comment; the owner
    // mentions themselves instead and must receive nothing.
    const before = await inbox(owner, '?unread=true&limit=100')
    await expectStatus(await owner.post(`/api/issues/${issue.id}/comments`, { data: { text: `note to self @${ACCOUNTS.owner.email}` } }), 201)
    const after = await inbox(owner, '?unread=true&limit=100')
    const selfMentions = after.notifications.filter((n) => n.type === 'mention' && n.issue_id === issue.id
      && !before.notifications.some((b) => b.id === n.id))
    expect(selfMentions).toEqual([])
  })

  test('mark one notification read lowers the unread count', async () => {
    await expectStatus(await owner.post(`/api/issues/${issues['To Do'].id}/comments`, { data: { text: `one @${user.email}` } }), 201)
    await expectStatus(await owner.post(`/api/issues/${issues['To Do'].id}/comments`, { data: { text: `two @${user.email}` } }), 201)
    const box = await inbox(user.api)
    expect(box.unreadCount).toBe(2)
    await expectStatus(await user.api.patch(`/api/notifications/${box.notifications[0].id}/read`), 200)
    const after = await inbox(user.api)
    expect(after.unreadCount).toBe(1)
    expect(after.notifications.find((n) => n.id === box.notifications[0].id).is_read).toBe(true)
  })

  test('another user\'s notification cannot be marked read or deleted (404)', async () => {
    await expectStatus(await owner.post(`/api/issues/${issues['To Do'].id}/comments`, { data: { text: `private @${user.email}` } }), 201)
    const box = await inbox(user.api)
    const id = box.notifications[0].id
    await expectStatus(await member.patch(`/api/notifications/${id}/read`), 404)
    await expectStatus(await member.delete(`/api/notifications/${id}`), 404)
  })

  test('mark all read clears the unread count; unread=true then lists none', async () => {
    for (let i = 0; i < 3; i += 1) {
      await expectStatus(await owner.post(`/api/issues/${issues['To Do'].id}/comments`, { data: { text: `bulk ${i} @${user.email}` } }), 201)
    }
    expect((await inbox(user.api)).unreadCount).toBe(3)
    await expectStatus(await user.api.patch('/api/notifications/read-all'), 200)
    const after = await inbox(user.api, '?unread=true')
    expect(after.unreadCount).toBe(0)
    expect(after.notifications).toEqual([])
  })

  test('dismiss one notification and clear the read ones', async () => {
    for (let i = 0; i < 2; i += 1) {
      await expectStatus(await owner.post(`/api/issues/${issues['To Do'].id}/comments`, { data: { text: `clear ${i} @${user.email}` } }), 201)
    }
    const box = await inbox(user.api)
    await expectStatus(await user.api.delete(`/api/notifications/${box.notifications[0].id}`), 200)
    await expectStatus(await user.api.patch(`/api/notifications/${box.notifications[1].id}/read`), 200)
    const cleared = await expectStatus(await user.api.delete('/api/notifications/read'), 200)
    expect(cleared.deleted).toBe(1)
    expect((await inbox(user.api)).notifications).toEqual([])
  })

  test('preferences default, save, and reject an invalid digest', async () => {
    const defaults = await expectStatus(await user.api.get('/api/notifications/preferences'), 200)
    expect(defaults).toEqual(expect.objectContaining({ in_app: true, email_enabled: false, email_digest: 'off' }))
    const saved = await expectStatus(await user.api.put('/api/notifications/preferences', {
      data: { inApp: true, emailEnabled: true, emailDigest: 'weekly', mutedTypes: ['comment'] },
    }), 200)
    expect(saved).toEqual(expect.objectContaining({ email_enabled: true, email_digest: 'weekly', muted_types: ['comment'] }))
    const reread = await expectStatus(await user.api.get('/api/notifications/preferences'), 200)
    expect(reread.email_digest).toBe('weekly')
    const bad = await expectStatus(await user.api.put('/api/notifications/preferences', { data: { emailDigest: 'hourly' } }), 400)
    expect(bad.error).toBe('emailDigest must be off, daily, or weekly')
  })

  test('turning in-app notifications off stops new in-app notifications', async () => {
    test.fail(true, 'DEFECT: the "In-app notifications" preference is saved but never consulted; notifications are still created')
    await expectStatus(await user.api.put('/api/notifications/preferences', { data: { inApp: false } }), 200)
    await expectStatus(await owner.post(`/api/issues/${issues['To Do'].id}/comments`, { data: { text: `muted @${user.email}` } }), 201)
    const box = await inbox(user.api)
    expect(box.notifications).toEqual([])
  })
})
