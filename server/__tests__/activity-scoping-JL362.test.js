import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

/*
 * JL-362 — cross-workspace data leak in GET /api/activity.
 *
 * The route selected straight out of the `activity` table with no tenant
 * predicate whatsoever, so any authenticated user could page the whole feed and
 * read every other workspace's issue keys, titles, status transitions and
 * member add/remove/role-change events. `GET /api/dashboard` performed the same
 * unscoped read.
 *
 * The complication (and why this was not a one-line filter): before this ticket
 * NO writer set `activity.project_id`, so 100% of rows were project_id IS NULL
 * and a naive `project_id IN (...)` filter would have blanked the feed instead
 * of securing it. JL-356 hit the same wall and deliberately left NULL rows
 * visible in the recent_activity gadget. The fix therefore writes attribution
 * at insert time (project_id/issue_id for issue events, workspace_id for member
 * events) plus a backfill, and reads apply:
 *
 *   project_id NOT NULL              -> must be in the caller's accessible set
 *   project_id NULL, workspace NOT   -> must be the caller's workspace
 *   project_id NULL, workspace NULL  -> unattributable: hidden, unless the
 *                                       install has <= 1 workspace
 *
 * Like dashboard-gadget-scoping-JL356.test.js, these tests drive the REAL route
 * through a fake database that actually honours the generated WHERE clause and
 * LIMIT/OFFSET, so they fail against the pre-fix code (the victim workspace's
 * rows come back) rather than merely asserting on mock call shapes.
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
import activityRoutes from '../routes/activity.js'
import dashboardRoutes from '../routes/dashboard.js'
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

// Newest first, as the route orders them (id DESC).
const ACTIVITY = [
  // --- victim tenant (workspace 2) — none of these may ever be returned ---
  { id: 30, actor: 'victim@beta.test', action: 'created SECRET-3 (Layoff plan)', happened_at: 't30', activity_type: 'general', project_id: 99, issue_id: 903, workspace_id: 2, created_at: '2026-01-30' },
  { id: 29, actor: 'victim@beta.test', action: 'moved SECRET-2 to DONE', happened_at: 't29', activity_type: 'general', project_id: 99, issue_id: 902, workspace_id: 2, created_at: '2026-01-29' },
  { id: 28, actor: 'boss@beta.test', action: 'removed member spy@beta.test', happened_at: 't28', activity_type: 'member', project_id: null, issue_id: null, workspace_id: 2, created_at: '2026-01-28' },
  // --- caller's tenant (workspace 1) ---
  { id: 27, actor: 'alice@alpha.test', action: 'created ALPHA-5 (Alpha five)', happened_at: 't27', activity_type: 'general', project_id: 1, issue_id: 105, workspace_id: 1, created_at: '2026-01-27' },
  { id: 26, actor: 'bob@alpha.test', action: 'created BETA-1 (Beta one)', happened_at: 't26', activity_type: 'general', project_id: 2, issue_id: 201, workspace_id: 1, created_at: '2026-01-26' },
  { id: 25, actor: 'admin@alpha.test', action: 'changed bob@alpha.test role from Member to Admin', happened_at: 't25', activity_type: 'member', project_id: null, issue_id: null, workspace_id: 1, created_at: '2026-01-25' },
  { id: 24, actor: 'alice@alpha.test', action: 'moved ALPHA-4 to DONE', happened_at: 't24', activity_type: 'general', project_id: 1, issue_id: 104, workspace_id: 1, created_at: '2026-01-24' },
  { id: 23, actor: 'alice@alpha.test', action: 'created ALPHA-3 (Alpha three)', happened_at: 't23', activity_type: 'general', project_id: 1, issue_id: 103, workspace_id: 1, created_at: '2026-01-23' },
  { id: 22, actor: 'alice@alpha.test', action: 'created ALPHA-2 (Alpha two)', happened_at: 't22', activity_type: 'general', project_id: 1, issue_id: 102, workspace_id: 1, created_at: '2026-01-22' },
  { id: 21, actor: 'alice@alpha.test', action: 'created ALPHA-1 (Alpha one)', happened_at: 't21', activity_type: 'general', project_id: 1, issue_id: 101, workspace_id: 1, created_at: '2026-01-21' },
  // --- legacy, unattributable: no project, no workspace ---
  { id: 20, actor: 'Linda Wu', action: 'created a new project Marketing Automation', happened_at: 't20', activity_type: 'general', project_id: null, issue_id: null, workspace_id: null, created_at: '2026-01-20' },
]

// alice is a member of project 1 only.
const MEMBERSHIP = { 10: [1] }

// How many workspaces the fake install has. Two by default so the
// single-tenant carve-out is OFF and the scoping is genuinely exercised.
let workspaceCount = 2

/* ------------------------------------------------------------------
   A fake `activity` table that really evaluates the generated WHERE.

   The route emits predicates in a fixed left-to-right order and pushes their
   params in the same order, so we can tokenize the SQL and consume `params`
   positionally. Anything we do not recognise throws, so a future clause cannot
   silently slip past these tests.
   ------------------------------------------------------------------ */
const TOKEN = new RegExp(
  [
    /\(project_id IS NOT NULL AND project_id IN \(([?,\s]+)\)\)/, // scope: accessible projects
    /\(project_id IS NULL AND workspace_id = \?\)/,               // scope: caller's workspace
    /\(project_id IS NULL AND workspace_id IS NULL\)/,            // scope: unattributable
    /\bid < \?/,                                                  // cursor
    /\bactivity_type = \?/,
    /(?<!IS NULL AND )\bproject_id = \?/,                         // ?projectId filter
    /\bactor = \?/,
    /\bcreated_at >= \?/,
    /\bcreated_at <= \?/,
  ].map((r) => r.source).join('|'),
  'g',
)

function queryActivity(sql, params = []) {
  let rows = ACTIVITY
  let i = 0

  const whereMatch = sql.match(/WHERE ([\s\S]*?)(?: ORDER BY | LIMIT |$)/)
  const where = whereMatch ? whereMatch[1] : ''

  if (where) {
    const scopeBranches = []
    const andPredicates = []
    let seenToken = false

    for (const m of where.matchAll(TOKEN)) {
      seenToken = true
      const text = m[0]
      if (text.startsWith('(project_id IS NOT NULL')) {
        const n = (m[1].match(/\?/g) || []).length
        const ids = params.slice(i, i + n).map(Number)
        i += n
        scopeBranches.push((r) => r.project_id !== null && ids.includes(r.project_id))
      } else if (text.startsWith('(project_id IS NULL AND workspace_id = ')) {
        const ws = Number(params[i++])
        scopeBranches.push((r) => r.project_id === null && r.workspace_id === ws)
      } else if (text.startsWith('(project_id IS NULL AND workspace_id IS NULL')) {
        scopeBranches.push((r) => r.project_id === null && r.workspace_id === null)
      } else if (text.startsWith('id <')) {
        const cursor = Number(params[i++])
        andPredicates.push((r) => r.id < cursor)
      } else if (text.startsWith('activity_type')) {
        const v = params[i++]
        andPredicates.push((r) => r.activity_type === v)
      } else if (text.startsWith('project_id =')) {
        const v = Number(params[i++])
        andPredicates.push((r) => r.project_id === v)
      } else if (text.startsWith('actor')) {
        const v = params[i++]
        andPredicates.push((r) => r.actor === v)
      } else if (text.startsWith('created_at >=')) {
        const v = params[i++]
        andPredicates.push((r) => r.created_at >= v)
      } else if (text.startsWith('created_at <=')) {
        const v = params[i++]
        andPredicates.push((r) => r.created_at <= v)
      }
    }

    if (/\bFALSE\b/.test(where)) {
      // fail-closed branch: the caller can reach nothing
      rows = []
    } else {
      if (!seenToken) throw new Error(`fake db: unrecognised WHERE clause: ${where}`)
      if (scopeBranches.length) rows = rows.filter((r) => scopeBranches.some((f) => f(r)))
      for (const f of andPredicates) rows = rows.filter(f)
    }
  }

  if (/LIMIT \?/.test(sql)) {
    const limit = Number(params[i++])
    const offset = /OFFSET \?/.test(sql) ? Number(params[i++]) : 0
    rows = rows.slice(offset, offset + limit)
  } else {
    // dashboard.js uses a literal `LIMIT 5`
    const literal = sql.match(/LIMIT (\d+)/)
    if (literal) rows = rows.slice(0, Number(literal[1]))
  }
  return rows
}

function installDb() {
  get.mockImplementation(async (sql, params = []) => {
    if (/COUNT\(\*\) AS count FROM workspaces/.test(sql)) {
      return { count: String(workspaceCount) }
    }
    if (/COUNT\(\*\) AS count FROM activity/.test(sql)) {
      // The count query has no LIMIT, so strip nothing — just evaluate the WHERE.
      return { count: String(queryActivity(sql, params).length) }
    }
    if (/FROM members/.test(sql)) {
      const email = String(params[0] || '').toLowerCase()
      if (email === 'alice@alpha.test') return { id: 10, name: 'Alice' }
      if (email === 'admin@alpha.test') return { id: 11, name: 'Admin' }
      return null
    }
    if (/COUNT\(\*\) AS count FROM issues/.test(sql)) return { count: '0' }
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
    if (/FROM members/.test(sql)) return []
    return []
  })
}

// alice is a plain Member of workspace 1; admin is its workspace Admin.
function createApp(user = {}, workspaceId = 1, routes = activityRoutes, mount = '/api/activity') {
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
  app.use(mount, routes)
  app.use(errorHandler)
  return app
}

const getFeed = (app, query = {}) =>
  request(app).get('/api/activity').query({ limit: 50, ...query })

const VICTIM_TEXT = /SECRET|Layoff|Payroll|victim@beta|spy@beta|boss@beta/

beforeEach(() => {
  vi.clearAllMocks()
  workspaceCount = 2
  installDb()
})

describe('JL-362 — GET /api/activity does not leak across workspaces', () => {
  it('returns no rows belonging to another workspace\'s project', async () => {
    const res = await getFeed(createApp())
    expect(res.status).toBe(200)
    const ids = res.body.activities.map((a) => a.id)
    expect(ids).not.toContain(30)
    expect(ids).not.toContain(29)
    // belt and braces: none of the victim tenant's text made it into the body
    expect(JSON.stringify(res.body)).not.toMatch(VICTIM_TEXT)
  })

  it('returns no workspace-level (project_id IS NULL) rows from another workspace', async () => {
    const res = await getFeed(createApp())
    const ids = res.body.activities.map((a) => a.id)
    // id 28 is workspace 2's member-removal event — no project, but a tenant
    expect(ids).not.toContain(28)
  })

  it('hides unattributable legacy rows on a multi-workspace install', async () => {
    const res = await getFeed(createApp())
    expect(res.body.activities.map((a) => a.id)).not.toContain(20)
  })

  it('shows unattributable legacy rows when the install has a single workspace', async () => {
    // With one workspace there is no other tenant to leak to, so the carve-out
    // keeps single-tenant / dev installs from losing their feed.
    workspaceCount = 1
    const res = await getFeed(createApp())
    expect(res.body.activities.map((a) => a.id)).toContain(20)
    // ...and it still must not resurrect another workspace's attributed rows
    expect(JSON.stringify(res.body)).not.toMatch(VICTIM_TEXT)
  })

  it('a foreign ?projectId cannot escape the caller\'s scope', async () => {
    const res = await getFeed(createApp(), { projectId: 99 })
    expect(res.status).toBe(200)
    expect(res.body.activities).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it('a foreign ?actor cannot be used to read another tenant\'s rows', async () => {
    const res = await getFeed(createApp(), { actor: 'victim@beta.test' })
    expect(res.body.activities).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it('the reported total is scoped too, so it cannot disclose another tenant\'s volume', async () => {
    const res = await getFeed(createApp())
    // project 1 rows (27, 24, 23, 22, 21) + own-workspace member event (25)
    expect(res.body.total).toBe(6)
    expect(res.body.activities).toHaveLength(6)
  })

  it('also excludes a same-workspace project the caller is not a member of', async () => {
    const res = await getFeed(createApp())
    expect(res.body.activities.map((a) => a.id)).not.toContain(26)
  })

  it('fails closed (no rows) when the caller can reach no project and has no workspace', async () => {
    const app = createApp({ email: 'nobody@nowhere.test', memberId: 99 }, null)
    workspaceCount = 2
    const res = await getFeed(app)
    expect(res.body.activities).toEqual([])
    expect(res.body.total).toBe(0)
  })
})

describe('JL-362 — legitimate use of the feed still works', () => {
  it('returns the caller\'s own project activity and own-workspace member events', async () => {
    const res = await getFeed(createApp())
    const ids = res.body.activities.map((a) => a.id)
    expect(ids).toEqual([27, 25, 24, 23, 22, 21])
  })

  it('the ?projectId filter still narrows to the caller\'s own project', async () => {
    const res = await getFeed(createApp(), { projectId: 1 })
    expect(res.body.activities.map((a) => a.id)).toEqual([27, 24, 23, 22, 21])
  })

  it('the ?type filter still works within scope', async () => {
    const res = await getFeed(createApp(), { type: 'member' })
    expect(res.body.activities.map((a) => a.id)).toEqual([25])
  })

  it('the ?actor filter still works within scope', async () => {
    const res = await getFeed(createApp(), { actor: 'alice@alpha.test' })
    expect(res.body.activities.map((a) => a.id)).toEqual([27, 24, 23, 22, 21])
  })

  it('the ?dateFrom/?dateTo filters still work within scope', async () => {
    const res = await getFeed(createApp(), { dateFrom: '2026-01-23', dateTo: '2026-01-25' })
    expect(res.body.activities.map((a) => a.id)).toEqual([25, 24, 23])
  })

  it('a workspace Admin reads every project in their own workspace but not another\'s', async () => {
    const app = createApp({ email: 'admin@alpha.test', memberId: 11, workspaceRole: 'Admin' })
    const res = await getFeed(app)
    const ids = res.body.activities.map((a) => a.id)
    expect(ids).toContain(26) // project 2, same workspace
    expect(ids).toContain(25) // own-workspace member event
    expect(JSON.stringify(res.body)).not.toMatch(VICTIM_TEXT)
  })
})

describe('JL-362 — cursor pagination stays consistent under the new filter', () => {
  it('walking every page yields exactly the scoped set, with no gaps or repeats', async () => {
    const app = createApp()
    const seen = []
    let cursor = null
    let pages = 0

    for (;;) {
      const res = await getFeed(app, cursor ? { limit: 2, cursor } : { limit: 2 })
      expect(res.status).toBe(200)
      expect(JSON.stringify(res.body)).not.toMatch(VICTIM_TEXT)
      seen.push(...res.body.activities.map((a) => a.id))
      pages += 1
      if (!res.body.hasMore) break
      cursor = res.body.nextCursor
      expect(cursor).toBeTruthy()
      if (pages > 10) throw new Error('pagination did not terminate')
    }

    expect(seen).toEqual([27, 25, 24, 23, 22, 21])
    expect(new Set(seen).size).toBe(seen.length)
    expect(pages).toBe(3)
  })

  it('hasMore is false on the final page', async () => {
    const app = createApp()
    const first = await getFeed(app, { limit: 5 })
    expect(first.body.hasMore).toBe(true)
    const second = await getFeed(app, { limit: 5, cursor: first.body.nextCursor })
    expect(second.body.hasMore).toBe(false)
    expect(second.body.activities.map((a) => a.id)).toEqual([21])
  })

  it('offset pagination is scoped consistently too', async () => {
    const app = createApp()
    const page1 = await getFeed(app, { limit: 3, offset: 0 })
    const page2 = await getFeed(app, { limit: 3, offset: 3 })
    expect(page1.body.activities.map((a) => a.id)).toEqual([27, 25, 24])
    expect(page2.body.activities.map((a) => a.id)).toEqual([23, 22, 21])
    expect(page1.body.total).toBe(6)
    expect(page2.body.total).toBe(6)
  })
})

describe('JL-362 — GET /api/dashboard had the same unscoped activity read', () => {
  const getDashboard = (app) => request(app).get('/api/dashboard')

  it('the recent-activity strip no longer shows another workspace\'s rows', async () => {
    const app = createApp({}, 1, dashboardRoutes, '/api/dashboard')
    const res = await getDashboard(app)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body.activities)).not.toMatch(VICTIM_TEXT)
    expect(res.body.activities.map((a) => a.id)).toEqual([27, 25, 24, 23, 22])
  })
})
