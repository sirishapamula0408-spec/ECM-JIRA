import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

/*
 * JL-356 — cross-workspace data leak in POST /api/dashboards/gadgets/data.
 *
 * The gadget WHERE builder treated a caller-supplied `config.projectId` as an
 * ALTERNATIVE to workspace scoping (`else if`), and the route performed no
 * membership check, so any authenticated user could iterate project ids and
 * read issue counts, status/assignee/priority breakdowns and — via
 * filter_results — issue keys, titles, assignees and priorities belonging to
 * projects in other workspaces.
 *
 * These tests drive the real route through a fake database that actually
 * honours the generated WHERE clause, so they fail against the pre-fix code
 * (the victim workspace's rows come back) and pass once the project clause is
 * intersected with loadAccessibleProjectIds().
 */

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { all, get } from '../db.js'
import gadgetRoutes from '../routes/dashboardGadgets.js'
import { errorHandler } from '../middleware/errorHandler.js'

/* ------------------------------------------------------------------
   Fixture: two tenants.
     workspace 1 — project 1 (alice is a member), project 2 (she is not)
     workspace 2 — project 99, the victim tenant alice must never read
   ------------------------------------------------------------------ */
const PROJECTS = [
  { id: 1, workspace_id: 1 },
  { id: 2, workspace_id: 1 },
  { id: 99, workspace_id: 2 },
]

const ISSUES = [
  { id: 1, project_id: 1, issue_key: 'ALPHA-1', title: 'Alpha one', status: 'To Do', assignee: 'alice', priority: 'High' },
  { id: 2, project_id: 1, issue_key: 'ALPHA-2', title: 'Alpha two', status: 'Done', assignee: 'alice', priority: 'Low' },
  { id: 3, project_id: 2, issue_key: 'BETA-1', title: 'Beta one', status: 'To Do', assignee: 'bob', priority: 'High' },
  { id: 4, project_id: 99, issue_key: 'SECRET-1', title: 'Merger terms', status: 'To Do', assignee: 'victim', priority: 'High' },
  { id: 5, project_id: 99, issue_key: 'SECRET-2', title: 'Payroll migration', status: 'Done', assignee: 'victim', priority: 'Medium' },
  { id: 6, project_id: 99, issue_key: 'SECRET-3', title: 'Layoff plan', status: 'In Progress', assignee: 'victim', priority: 'Highest' },
]

const ACTIVITY = [
  { id: 10, actor: 'victim', action: 'created SECRET-3', happened_at: 't3', project_id: 99 },
  { id: 9, actor: 'alice', action: 'created ALPHA-1', happened_at: 't2', project_id: 1 },
  { id: 8, actor: 'system', action: 'legacy row', happened_at: 't1', project_id: null },
]

// alice is a member of project 1 only.
const MEMBERSHIP = { 10: [1] }

// Count the `?` placeholders inside a `project_id IN (...)` list.
function inListSize(sql) {
  const m = sql.match(/project_id IN \(([?,\s]+)\)/)
  return m ? (m[1].match(/\?/g) || []).length : null
}

// A fake `issues` table that honours the WHERE clause the route generated.
function queryIssues(sql, params = []) {
  let rows = ISSUES
  let i = 0
  if (sql.includes('project_id IN (SELECT id FROM projects WHERE workspace_id = ?)')) {
    // pre-fix workspace branch
    const ws = params[i++]
    const ids = PROJECTS.filter((p) => p.workspace_id === ws).map((p) => p.id)
    rows = rows.filter((r) => ids.includes(r.project_id))
  } else {
    const n = inListSize(sql)
    if (n !== null) {
      const ids = params.slice(i, i + n).map(Number)
      i += n
      rows = rows.filter((r) => ids.includes(r.project_id))
    } else if (sql.includes('project_id = ?')) {
      // pre-fix "trust the client's project id" branch
      const id = Number(params[i++])
      rows = rows.filter((r) => r.project_id === id)
    }
  }
  for (const f of ['status', 'assignee', 'priority']) {
    if (new RegExp(`\\b${f} = \\?`).test(sql)) {
      const value = params[i++]
      rows = rows.filter((r) => r[f] === value)
    }
  }
  if (/LIMIT \?/.test(sql)) rows = rows.slice(0, Number(params[i++]))
  return rows
}

function queryActivity(sql, params = []) {
  let rows = ACTIVITY
  let i = 0
  const n = inListSize(sql)
  const ids = n === null ? [] : params.slice(0, n).map(Number)
  if (n !== null) i += n
  if (sql.includes('WHERE')) {
    rows = rows.filter((r) => r.project_id === null || ids.includes(r.project_id))
  }
  if (/LIMIT \?/.test(sql)) rows = rows.slice(0, Number(params[i++]))
  return rows
}

function installDb() {
  get.mockImplementation(async (sql, params = []) => {
    if (/FROM members/.test(sql)) {
      const email = String(params[0] || '').toLowerCase()
      if (email === 'alice@alpha.test') return { id: 10, name: 'Alice' }
      if (email === 'admin@alpha.test') return { id: 11, name: 'Admin' }
      return null
    }
    if (/COUNT\(\*\) AS count FROM issues/.test(sql)) {
      return { count: String(queryIssues(sql, params).length) }
    }
    return null
  })

  all.mockImplementation(async (sql, params = []) => {
    // loadAccessibleProjectIds — membership/lead resolution
    if (/FROM projects p/.test(sql)) {
      const memberId = Number(params[0])
      const workspaceId = params.length > 2 ? Number(params[2]) : null
      const ids = MEMBERSHIP[memberId] || []
      return PROJECTS
        .filter((p) => ids.includes(p.id))
        .filter((p) => workspaceId == null || p.workspace_id === workspaceId || p.workspace_id === null)
        .map((p) => ({ id: p.id }))
    }
    // workspace Owner/Admin branch — every project in the workspace
    if (/SELECT id FROM projects/.test(sql)) {
      const workspaceId = params.length ? Number(params[0]) : null
      return PROJECTS
        .filter((p) => workspaceId == null || p.workspace_id === workspaceId || p.workspace_id === null)
        .map((p) => ({ id: p.id }))
    }
    if (/FROM activity/.test(sql)) return queryActivity(sql, params)
    if (/FROM issues/.test(sql)) return queryIssues(sql, params)
    return []
  })
}

// A caller: alice is a plain Member of workspace 1; admin is its workspace Admin.
function createApp(user = {}, workspaceId = 1) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      email: 'alice@alpha.test',
      memberId: 10,
      workspaceRole: 'Member',
      isOwner: false,
      ...user,
    }
    req.workspaceId = workspaceId
    next()
  })
  app.use('/api', gadgetRoutes)
  app.use(errorHandler)
  return app
}

const postGadget = (app, type, config = {}) =>
  request(app).post('/api/dashboards/gadgets/data').send({ type, config })

beforeEach(() => {
  vi.clearAllMocks()
  installDb()
})

describe('JL-356 — a foreign projectId cannot escape the caller\'s scope', () => {
  it('filter_results leaks no rows from a project in another workspace', async () => {
    const res = await postGadget(createApp(), 'filter_results', { projectId: 99 })
    expect(res.status).toBe(200)
    expect(res.body.data.issues).toEqual([])
    expect(res.body.data.count).toBe(0)
    // belt and braces: none of the victim tenant's text made it into the body
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET|Merger|Payroll|Layoff|victim/)
  })

  it('issue_count returns 0 for a project in another workspace', async () => {
    const res = await postGadget(createApp(), 'issue_count', { projectId: 99 })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ count: 0 })
  })

  it('issue_count + status filter returns 0 for a project in another workspace', async () => {
    const res = await postGadget(createApp(), 'issue_count', { projectId: 99, status: 'To Do' })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ count: 0 })
  })

  it('issues_by_status returns an empty breakdown for a project in another workspace', async () => {
    const res = await postGadget(createApp(), 'issues_by_status', { projectId: 99 })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('issues_by_assignee returns an empty breakdown for a project in another workspace', async () => {
    const res = await postGadget(createApp(), 'issues_by_assignee', { projectId: 99 })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('issues_by_priority returns an empty breakdown for a project in another workspace', async () => {
    const res = await postGadget(createApp(), 'issues_by_priority', { projectId: 99 })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('answers 200 + empty rather than 403 so the endpoint is not a project-existence oracle', async () => {
    const existsElsewhere = await postGadget(createApp(), 'filter_results', { projectId: 99 })
    const doesNotExist = await postGadget(createApp(), 'filter_results', { projectId: 4242 })
    expect(existsElsewhere.status).toBe(200)
    expect(doesNotExist.status).toBe(200)
    // indistinguishable: an attacker learns nothing about other tenants' ids
    expect(existsElsewhere.body).toEqual(doesNotExist.body)
  })

  it('also blocks a same-workspace project the caller is not a member of', async () => {
    const res = await postGadget(createApp(), 'filter_results', { projectId: 2 })
    expect(res.body.data.issues).toEqual([])
  })
})

describe('JL-356 — legitimate scoping keeps working', () => {
  it('the caller\'s own projectId still returns that project\'s rows', async () => {
    const res = await postGadget(createApp(), 'filter_results', { projectId: 1 })
    expect(res.status).toBe(200)
    expect(res.body.data.count).toBe(2)
    expect(res.body.data.issues.map((i) => i.issue_key).sort()).toEqual(['ALPHA-1', 'ALPHA-2'])
  })

  it('a numeric-string projectId (as the frontend sends it) still narrows correctly', async () => {
    const res = await postGadget(createApp(), 'issue_count', { projectId: '1' })
    expect(res.body.data).toEqual({ count: 2 })
  })

  it('issues_by_status for the caller\'s own project still breaks down', async () => {
    const res = await postGadget(createApp(), 'issues_by_status', { projectId: 1 })
    const map = Object.fromEntries(res.body.data.map((d) => [d.status, d.count]))
    expect(map).toEqual({ 'To Do': 1, Done: 1 })
  })

  it('omitting projectId scopes to the caller\'s accessible projects, never another workspace', async () => {
    const res = await postGadget(createApp(), 'filter_results', {})
    const keys = res.body.data.issues.map((i) => i.issue_key)
    expect(keys).toContain('ALPHA-1')
    expect(keys.some((k) => k.startsWith('SECRET'))).toBe(false)
    // project 2 is in the same workspace but alice is not a member of it
    expect(keys).not.toContain('BETA-1')
  })

  it('a workspace Admin still reads any project in their own workspace', async () => {
    const app = createApp({ email: 'admin@alpha.test', memberId: 11, workspaceRole: 'Admin' })
    const res = await postGadget(app, 'filter_results', { projectId: 2 })
    expect(res.body.data.issues.map((i) => i.issue_key)).toEqual(['BETA-1'])
  })

  it('a workspace Admin still cannot reach another workspace\'s project', async () => {
    const app = createApp({ email: 'admin@alpha.test', memberId: 11, workspaceRole: 'Admin' })
    const res = await postGadget(app, 'filter_results', { projectId: 99 })
    expect(res.body.data.issues).toEqual([])
  })
})

describe('JL-356 — recent_activity is scoped too', () => {
  it('hides activity attributed to another workspace\'s project', async () => {
    const res = await postGadget(createApp(), 'recent_activity', {})
    expect(res.status).toBe(200)
    const actions = res.body.data.map((r) => r.action)
    expect(actions).not.toContain('created SECRET-3')
    // own project + unattributed legacy rows stay visible
    expect(actions).toContain('created ALPHA-1')
    expect(actions).toContain('legacy row')
  })
})
