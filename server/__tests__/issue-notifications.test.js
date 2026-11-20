// @vitest-environment node
// Issue notifications: who hears about a create, an assignment and a status
// change. createNotification (which stores the in-app row and sends the email
// per the recipient's preferences) is mocked, so these tests pin the recipient
// rules: never the actor, never a deactivated or unknown person, never someone
// who cannot read the issue, and one message per person even when a person is
// assignee, reporter and watcher at once.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ issues: {}, members: [], watchers: {}, access: {} }))

vi.mock('../db.js', () => ({
  run: vi.fn(),
  get: vi.fn(async (sql, params) => {
    if (sql.includes('FROM issues WHERE id')) return state.issues[params[0]]
    if (sql.includes('FROM projects WHERE id')) return { name: 'Proj' }
    if (sql.startsWith('SELECT name FROM members')) {
      return state.members.find((m) => m.email.toLowerCase() === String(params[0]).toLowerCase())
    }
    if (sql.includes('FROM members')) {
      const v = params[0]
      return state.members.find((m) => m.email.toLowerCase() === v)
        || state.members.find((m) => m.name.toLowerCase() === v)
    }
    return undefined
  }),
  all: vi.fn(async (sql, params) => (sql.includes('FROM watchers') ? (state.watchers[params[0]] || []) : [])),
}))
vi.mock('../routes/notifications.js', () => ({ createNotification: vi.fn().mockResolvedValue(1) }))
vi.mock('../middleware/authorize.js', () => ({
  canAccessProject: vi.fn(async (user) => state.access[user.email] !== false),
}))

import { get } from '../db.js'
import { createNotification } from '../routes/notifications.js'
import {
  notifyIssueCreated, notifyIssueAssigned, notifyStatusChanged, notifyBulkChanges,
} from '../services/issueNotifications.js'

const member = (id, name, email, extra = {}) => ({ id, name, email, role: 'Member', is_owner: false, status: 'Active', ...extra })
const issue = (id, extra = {}) => ({
  id, issue_key: `PROJ-${id}`, title: `Issue ${id}`, status: 'To Do', priority: 'High', issue_type: 'Bug',
  project_id: 1, assignee: 'Bob', reporter: 'alice@x.com', security_level_id: null, ...extra,
})
const sent = () => createNotification.mock.calls.map(([n]) => n)
const to = () => sent().map((n) => n.recipientEmail).sort()

beforeEach(() => {
  vi.clearAllMocks()
  state.members = [
    member(1, 'Alice', 'alice@x.com'),
    member(2, 'Bob', 'bob@x.com'),
    member(3, 'Carol', 'carol@x.com'),
    member(4, 'Dave', 'dave@x.com', { status: 'Deactivated' }),
    member(5, 'Erin', 'erin@x.com'),
  ]
  state.issues = { 10: issue(10) }
  state.watchers = {}
  state.access = {}
})

describe('issue created', () => {
  it('tells the assignee (resolved from a name) with a link to the issue, and not the creator', async () => {
    await notifyIssueCreated({ issueId: 10, actorEmail: 'alice@x.com' }) // Alice is reporter + creator
    expect(sent()).toHaveLength(1)
    const [n] = sent()
    expect(n).toMatchObject({ recipientEmail: 'bob@x.com', type: 'issue_assigned', issueId: 10, projectId: 1, link: '/browse/PROJ-10' })
    expect(n.title).toBe('PROJ-10 assigned to you: Issue 10')
    expect(n.message).toContain('Alice created this bug and assigned it to you.')
    expect(n.message).toContain('Status: To Do · Priority: High')
  })

  it('also tells a reporter who is not the creator', async () => {
    await notifyIssueCreated({ issueId: 10, actorEmail: 'carol@x.com' })
    expect(to()).toEqual(['alice@x.com', 'bob@x.com'])
    expect(sent().find((n) => n.recipientEmail === 'alice@x.com').type).toBe('issue_created')
  })

  it('sends one message when the assignee is also the reporter', async () => {
    state.issues[10] = issue(10, { assignee: 'bob@x.com', reporter: 'Bob' })
    await notifyIssueCreated({ issueId: 10, actorEmail: 'carol@x.com' })
    expect(to()).toEqual(['bob@x.com'])
  })

  it('skips an assignee who is not a member, or is deactivated', async () => {
    state.issues[10] = issue(10, { assignee: 'Nobody Known', reporter: 'Dave' })
    await notifyIssueCreated({ issueId: 10, actorEmail: 'carol@x.com' })
    expect(sent()).toHaveLength(0)
  })
})

describe('assignee changed', () => {
  it('tells the new assignee', async () => {
    await notifyIssueAssigned({ issueId: 10, previousAssignee: 'Carol', actorEmail: 'alice@x.com' })
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toMatchObject({ recipientEmail: 'bob@x.com', type: 'issue_assigned' })
    expect(sent()[0].message).toContain('Alice assigned this bug to you.')
  })

  it('is silent when the value still names the same person', async () => {
    await notifyIssueAssigned({ issueId: 10, previousAssignee: 'bob@x.com', actorEmail: 'alice@x.com' }) // now "Bob"
    await notifyIssueAssigned({ issueId: 10, previousAssignee: 'Bob', actorEmail: 'alice@x.com' })
    expect(sent()).toHaveLength(0)
  })

  it('does not tell people who assign an issue to themselves', async () => {
    await notifyIssueAssigned({ issueId: 10, previousAssignee: 'Carol', actorEmail: 'BOB@x.com' })
    expect(sent()).toHaveLength(0)
  })
})

describe('status changed', () => {
  it('tells assignee, reporter and watchers once each — never the actor', async () => {
    state.watchers[10] = [{ user_email: 'bob@x.com' }, { user_email: 'erin@x.com' }, { user_email: 'carol@x.com' }]
    await notifyStatusChanged({ issueId: 10, fromStatus: 'To Do', toStatus: 'In Progress', actorEmail: 'carol@x.com' })
    expect(to()).toEqual(['alice@x.com', 'bob@x.com', 'erin@x.com'])
    for (const n of sent()) {
      expect(n.type).toBe('status_changed')
      expect(n.title).toBe('PROJ-10 moved to In Progress: Issue 10')
      expect(n.message).toContain('Carol changed the status from To Do to In Progress.')
    }
  })

  it('skips a watcher who no longer has access to the project', async () => {
    state.watchers[10] = [{ user_email: 'erin@x.com' }]
    state.access['erin@x.com'] = false
    await notifyStatusChanged({ issueId: 10, fromStatus: 'To Do', toStatus: 'Done', actorEmail: 'carol@x.com' })
    expect(to()).toEqual(['alice@x.com', 'bob@x.com'])
  })

  it('skips a watcher an issue security level hides the issue from', async () => {
    state.issues[10] = issue(10, { security_level_id: 3, assignee: 'bob@x.com' })
    state.watchers[10] = [{ user_email: 'erin@x.com' }]
    await notifyStatusChanged({ issueId: 10, fromStatus: 'To Do', toStatus: 'Done', actorEmail: 'carol@x.com' })
    expect(to()).toEqual(['alice@x.com', 'bob@x.com']) // reporter + assignee may still see it
  })

  it('applies exactly the issue page\'s security rule — no wider', async () => {
    // canViewIssue compares the stored assignee text with the user's email, so
    // an assignee stored by NAME cannot open a restricted issue in the app; the
    // email must not show it to them either.
    state.issues[10] = issue(10, { security_level_id: 3, assignee: 'Bob' })
    await notifyStatusChanged({ issueId: 10, fromStatus: 'To Do', toStatus: 'Done', actorEmail: 'carol@x.com' })
    expect(to()).toEqual(['alice@x.com'])
  })

  it('is silent when the status did not change', async () => {
    await notifyStatusChanged({ issueId: 10, fromStatus: 'Done', toStatus: 'Done', actorEmail: 'carol@x.com' })
    expect(sent()).toHaveLength(0)
  })
})

describe('bulk changes', () => {
  it('sends each person one summary per kind of change, not one per issue', async () => {
    state.issues = { 10: issue(10), 11: issue(11), 12: issue(12) }
    await notifyBulkChanges({
      actorEmail: 'carol@x.com',
      changes: [10, 11, 12].map((id) => ({ issueId: id, assignee: { from: 'Erin' } })),
    })
    expect(sent()).toHaveLength(1)
    const [n] = sent()
    expect(n).toMatchObject({ recipientEmail: 'bob@x.com', type: 'issue_assigned', title: '3 issues assigned to you' })
    expect(n.message).toContain('• PROJ-10: Issue 10')
    expect(n.message).toContain('• PROJ-12: Issue 12')
  })

  it('uses the ordinary single-issue message when only one issue is involved', async () => {
    await notifyBulkChanges({
      actorEmail: 'carol@x.com',
      changes: [{ issueId: 10, status: { from: 'To Do', to: 'Done' } }],
    })
    expect(to()).toEqual(['alice@x.com', 'bob@x.com'])
    expect(sent()[0].link).toBe('/browse/PROJ-10')
  })
})

describe('never breaks the caller', () => {
  it('swallows a database failure', async () => {
    get.mockRejectedValueOnce(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notifyStatusChanged({ issueId: 10, fromStatus: 'a', toStatus: 'b', actorEmail: 'x@x.com' })).resolves.toBeUndefined()
    await expect(notifyBulkChanges({ changes: null })).resolves.toBeUndefined()
    spy.mockRestore()
  })
})
