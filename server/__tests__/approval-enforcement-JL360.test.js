import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// JL-360: the approval feature was inert — approval_rules were configurable but
// nothing consulted them on a status change, and anyone could record an approval
// regardless of the rule's approver_role. These tests pin the enforcement.

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, createNotification: vi.fn().mockResolvedValue(1) }
})

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { collectDecisions, isSelfApproval, findApprovalRule } from '../services/approvals.js'

function createApp(routeModule, mountPath, user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false, ...user }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

// Emulates the precedence the SQL expresses (project-specific rule before the
// global project_id IS NULL fallback) over an in-memory rule list.
function pickRule(rules, projectId, from, to) {
  const matches = rules.filter(
    (r) => r.from_status === from && r.to_status === to && (r.project_id === projectId || r.project_id === null),
  )
  matches.sort((a, b) => (b.project_id ?? -1) - (a.project_id ?? -1))
  return matches[0] || null
}

const T0 = '2026-01-01T00:00:00.000Z' // rule created / issue history baseline

/**
 * Wire the mocked db for the issues status route.
 *  - `rules`     : approval_rules rows
 *  - `approvals` : approvals rows ({ approver_email, decision, created_at })
 *  - `lastStatusChangeAt` : issue_history timestamp (null = never transitioned)
 */
function wireIssueDb(issue, { rules = [], approvals = [], lastStatusChangeAt = null } = {}) {
  get.mockImplementation(async (sql, params) => {
    if (/FROM approval_rules/.test(sql)) return pickRule(rules, params[0], params[1], params[2])
    if (/FROM issue_history/.test(sql)) return lastStatusChangeAt ? { changed_at: lastStatusChangeAt } : null
    if (/FROM issues WHERE id/.test(sql)) return { ...issue }
    if (/FROM sprints/.test(sql)) return { id: issue.sprint_id }
    return null
  })
  all.mockImplementation(async (sql, params) => {
    if (/FROM approvals/.test(sql)) {
      const since = params[3]
      return approvals
        .filter((a) => !since || new Date(a.created_at).getTime() >= new Date(since).getTime())
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    }
    return []
  })
  run.mockImplementation(async (sql, params) => {
    if (/UPDATE issues SET status/.test(sql)) {
      issue.status = params[0]
      issue.sprint_id = params[1]
    }
    return { lastID: issue.id, changes: 1 }
  })
}

function newIssue(overrides = {}) {
  return {
    id: 1,
    issue_key: 'P-1',
    sprint_id: 5,
    status: 'In Progress',
    project_id: 7,
    assignee: 'a@a.com',
    priority: 'Medium',
    reporter: 'r@r.com',
    ...overrides,
  }
}

const LEAD_RULE = {
  id: 10,
  project_id: 7,
  from_status: 'In Progress',
  to_status: 'Done',
  required_approvals: 2,
  approver_role: 'Lead',
  created_at: T0,
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Pure helpers
   ================================================================ */
describe('collectDecisions', () => {
  it('counts distinct approvers only', () => {
    const { approvers } = collectDecisions([
      { approver_email: 'lead@x.com', decision: 'approved' },
      { approver_email: 'LEAD@x.com', decision: 'approved' },
    ])
    expect(approvers).toEqual(['lead@x.com'])
  })

  it('lets the latest decision per approver win', () => {
    const { approvers, rejecters } = collectDecisions([
      { approver_email: 'a@x.com', decision: 'rejected' },
      { approver_email: 'a@x.com', decision: 'approved' },
      { approver_email: 'b@x.com', decision: 'approved' },
      { approver_email: 'b@x.com', decision: 'rejected' },
    ])
    expect(approvers).toEqual(['a@x.com'])
    expect(rejecters).toEqual(['b@x.com'])
  })
})

describe('isSelfApproval', () => {
  it('matches the reporter by email or display name', () => {
    expect(isSelfApproval({ reporter: 'R@R.com' }, 'r@r.com', 'Ray')).toBe(true)
    expect(isSelfApproval({ reporter: 'Ray' }, 'r@r.com', 'ray')).toBe(true)
    expect(isSelfApproval({ reporter: 'someone@else.com' }, 'r@r.com', 'Ray')).toBe(false)
    expect(isSelfApproval({ reporter: '' }, 'r@r.com', 'Ray')).toBe(false)
  })
})

describe('findApprovalRule', () => {
  it('queries with project-specific precedence over the global fallback', async () => {
    get.mockResolvedValue(null)
    await findApprovalRule(7, 'In Progress', 'Done')
    const [sql, params] = get.mock.calls[0]
    expect(sql).toMatch(/project_id = \? OR project_id IS NULL/)
    expect(sql).toMatch(/ORDER BY project_id DESC NULLS LAST/)
    expect(params).toEqual([7, 'In Progress', 'Done'])
  })

  it('never gates a no-op transition', async () => {
    expect(await findApprovalRule(7, 'Done', 'Done')).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })
})

/* ================================================================
   PATCH /api/issues/:id/status — approval enforcement
   ================================================================ */
describe('PATCH /api/issues/:id/status — approval enforcement', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/issues.js')
    app = createApp(mod, '/api/issues')
  })

  it('refuses a gated transition with 409 when no approvals are recorded', async () => {
    const issue = newIssue()
    wireIssueDb(issue, { rules: [LEAD_RULE] })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/requires 2 Lead approval/i)
    expect(res.body.approval).toMatchObject({ required: true, approvedCount: 0, remaining: 2 })
    expect(issue.status).toBe('In Progress') // unchanged
  })

  it('refuses while only part of the quorum is met', async () => {
    const issue = newIssue()
    wireIssueDb(issue, {
      rules: [LEAD_RULE],
      approvals: [{ approver_email: 'lead1@x.com', decision: 'approved', created_at: '2026-02-01T00:00:00.000Z' }],
    })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    expect(res.body.approval).toMatchObject({ approvedCount: 1, remaining: 1 })
  })

  it('permits the transition once the required approvals are recorded', async () => {
    const issue = newIssue()
    wireIssueDb(issue, {
      rules: [LEAD_RULE],
      approvals: [
        { approver_email: 'lead1@x.com', decision: 'approved', created_at: '2026-02-01T00:00:00.000Z' },
        { approver_email: 'lead2@x.com', decision: 'approved', created_at: '2026-02-02T00:00:00.000Z' },
      ],
    })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('Done')
  })

  it('does not let one person supply the whole quorum', async () => {
    const issue = newIssue()
    wireIssueDb(issue, {
      rules: [LEAD_RULE],
      approvals: [
        { approver_email: 'lead1@x.com', decision: 'approved', created_at: '2026-02-01T00:00:00.000Z' },
        { approver_email: 'Lead1@x.com', decision: 'approved', created_at: '2026-02-02T00:00:00.000Z' },
      ],
    })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    expect(res.body.approval.approvedCount).toBe(1)
    expect(issue.status).toBe('In Progress')
  })

  it('blocks on a standing rejection even when the quorum is otherwise met', async () => {
    const issue = newIssue()
    wireIssueDb(issue, {
      rules: [{ ...LEAD_RULE, required_approvals: 1 }],
      approvals: [
        { approver_email: 'lead1@x.com', decision: 'approved', created_at: '2026-02-01T00:00:00.000Z' },
        { approver_email: 'lead2@x.com', decision: 'rejected', created_at: '2026-02-02T00:00:00.000Z' },
      ],
    })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/rejected by lead2@x.com/)
  })

  it('expires approvals recorded before the issue last entered this status', async () => {
    const issue = newIssue()
    wireIssueDb(issue, {
      rules: [{ ...LEAD_RULE, required_approvals: 1 }],
      // approved during an earlier visit to In Progress, then the issue moved
      // away and came back — the old approval must not satisfy the gate again.
      approvals: [{ approver_email: 'lead1@x.com', decision: 'approved', created_at: '2026-02-01T00:00:00.000Z' }],
      lastStatusChangeAt: '2026-03-01T00:00:00.000Z',
    })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    expect(res.body.approval.approvedCount).toBe(0)
    expect(issue.status).toBe('In Progress')
  })

  it('ignores approvals recorded before the rule itself existed', async () => {
    const issue = newIssue()
    wireIssueDb(issue, {
      rules: [{ ...LEAD_RULE, required_approvals: 1, created_at: '2026-05-01T00:00:00.000Z' }],
      approvals: [{ approver_email: 'lead1@x.com', decision: 'approved', created_at: '2026-02-01T00:00:00.000Z' }],
    })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    expect(res.body.approval.approvedCount).toBe(0)
  })

  it('prefers a project-specific rule over the global fallback', async () => {
    const issue = newIssue()
    wireIssueDb(issue, {
      rules: [
        { ...LEAD_RULE, id: 99, project_id: null, required_approvals: 5, approver_role: 'Admin' },
        { ...LEAD_RULE, required_approvals: 1, approver_role: 'Member' },
      ],
      approvals: [],
    })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    // The project rule (1 Member approval), not the global rule (5 Admin).
    expect(res.body.approval).toMatchObject({ requiredApprovals: 1, approverRole: 'Member' })
  })

  it('applies the global rule when the project has none of its own', async () => {
    const issue = newIssue({ project_id: 42 })
    wireIssueDb(issue, {
      rules: [{ ...LEAD_RULE, id: 99, project_id: null, required_approvals: 1, approver_role: 'Admin' }],
    })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    expect(res.body.approval).toMatchObject({ requiredApprovals: 1, approverRole: 'Admin' })
  })

  /* --- Backward compatibility: installs with no approval_rules rows --- */

  it('leaves an ungated transition completely unaffected (no rules configured)', async () => {
    const issue = newIssue()
    wireIssueDb(issue, { rules: [] })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('Done')
    // No rule matched => the approvals table is never even read.
    expect(all.mock.calls.some(([sql]) => /FROM approvals/.test(sql))).toBe(false)
  })

  it('does not gate a transition covered by a rule for a different status pair', async () => {
    const issue = newIssue({ status: 'To Do' })
    wireIssueDb(issue, { rules: [LEAD_RULE] })

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'In Progress' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('In Progress')
  })
})

/* ================================================================
   POST /api/approvals/issue/:issueId — approver_role enforcement
   ================================================================ */
describe('POST /api/issue/:issueId — approver_role enforcement', () => {
  let mod
  beforeEach(async () => {
    mod = await import('../routes/approvals.js')
  })

  // projectRole is what `project_members` would return for this caller.
  function wireApprovalDb({ rule = LEAD_RULE, projectRole = null, reporter = 'r@r.com', callerName = 'Caller' } = {}) {
    get.mockImplementation(async (sql) => {
      if (/FROM approval_rules/.test(sql)) return rule
      if (/FROM projects p/.test(sql)) return { id: 7, lead_member_id: null, project_role: projectRole }
      if (/FROM issues WHERE id/.test(sql)) {
        return { assignee: 'Assignee', issue_key: 'P-1', reporter, project_id: 7 }
      }
      if (/FROM members/.test(sql)) return { email: 'member@test.com', name: callerName }
      if (/FROM approvals/.test(sql)) return { id: 1, decision: 'approved' }
      return null
    })
    all.mockResolvedValue([])
    run.mockResolvedValue({ lastID: 1 })
  }

  it('rejects an approver who does not hold the required role', async () => {
    wireApprovalDb({ projectRole: 'Member' })
    const app = createApp(mod, '/api', { email: 'member@test.com', memberId: 2, workspaceRole: 'Member' })

    const res = await request(app).post('/api/issue/1').send({
      fromStatus: 'In Progress', toStatus: 'Done', decision: 'approved',
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/requires approval from a Lead/)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a workspace Viewer outright', async () => {
    wireApprovalDb({ projectRole: null })
    const app = createApp(mod, '/api', { email: 'viewer@test.com', memberId: 3, workspaceRole: 'Viewer' })

    const res = await request(app).post('/api/issue/1').send({
      fromStatus: 'In Progress', toStatus: 'Done', decision: 'approved',
    })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('accepts an approver holding the required project role', async () => {
    wireApprovalDb({ projectRole: 'Lead' })
    const app = createApp(mod, '/api', { email: 'lead@test.com', memberId: 4, workspaceRole: 'Member' })

    const res = await request(app).post('/api/issue/1').send({
      fromStatus: 'In Progress', toStatus: 'Done', decision: 'approved',
    })
    expect(res.status).toBe(201)
    expect(run).toHaveBeenCalled()
  })

  it('blocks the reporter from approving their own issue', async () => {
    wireApprovalDb({ projectRole: 'Lead', reporter: 'lead@test.com' })
    const app = createApp(mod, '/api', { email: 'lead@test.com', memberId: 4, workspaceRole: 'Member' })

    const res = await request(app).post('/api/issue/1').send({
      fromStatus: 'In Progress', toStatus: 'Done', decision: 'approved',
    })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/issue you reported/)
    expect(run).not.toHaveBeenCalled()
  })

  it('leaves ungated transitions open to any authenticated user (no rule)', async () => {
    wireApprovalDb({ rule: null, projectRole: null })
    const app = createApp(mod, '/api', { email: 'member@test.com', memberId: 2, workspaceRole: 'Member' })

    const res = await request(app).post('/api/issue/1').send({
      fromStatus: 'To Do', toStatus: 'In Progress', decision: 'approved',
    })
    expect(res.status).toBe(201)
  })
})

/* ================================================================
   GET /api/approvals/check/:issueId — UI-facing gate state
   ================================================================ */
describe('GET /api/check/:issueId', () => {
  let mod
  beforeEach(async () => {
    mod = await import('../routes/approvals.js')
  })

  it('reports the quorum progress and whether the caller may approve', async () => {
    get.mockImplementation(async (sql) => {
      if (/FROM approval_rules/.test(sql)) return { ...LEAD_RULE }
      if (/FROM issue_history/.test(sql)) return null
      if (/FROM issues WHERE id/.test(sql)) return { id: 1, status: 'In Progress', project_id: 7 }
      return null
    })
    all.mockResolvedValue([
      { approver_email: 'lead1@x.com', decision: 'approved', created_at: '2026-02-01T00:00:00.000Z' },
    ])
    const app = createApp(mod, '/api')

    const res = await request(app).get('/api/check/1?toStatus=Done')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      required: true,
      approvedCount: 1,
      requiredApprovals: 2,
      remaining: 1,
      satisfied: false,
      approverRole: 'Lead',
      canApprove: true, // workspace Admin
    })
  })

  it('still reports required:false when no rule exists', async () => {
    get.mockImplementation(async (sql) => {
      if (/FROM issues WHERE id/.test(sql)) return { id: 1, status: 'In Progress', project_id: 7 }
      return null
    })
    const app = createApp(mod, '/api')

    const res = await request(app).get('/api/check/1?toStatus=Done')
    expect(res.status).toBe(200)
    expect(res.body.required).toBe(false)
  })
})
