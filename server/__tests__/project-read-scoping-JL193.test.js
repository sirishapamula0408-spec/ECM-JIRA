// @vitest-environment node
// JL-193 — project data must not reach users outside the project.
//
// Workspace Owner/Admin see every project; everyone else (workspace Member or
// Viewer — including the Admin of some OTHER project) reads only projects they
// are a member or the lead of. Project detail, issue detail and the issue list
// already enforced that (JL-224/225). These endpoints did not: reports, the
// dashboard metrics, the roadmap, the wiki, and the issue side-panels
// (watchers, votes, labels, components, approvals, git, CI, custom fields).
//
// The authorize middleware is deliberately NOT mocked, so the real gate runs
// against a small in-memory model of who belongs to which project.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  withTransaction: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))
vi.mock('../services/auditLog.js', () => ({ safeAppendAudit: vi.fn(), appendAudit: vi.fn() }))

import { all, get, run } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { projectScope, accessibleProjectIds } from '../middleware/authorize.js'

/* ── the world ───────────────────────────────────────────────────────────── */

// The caller (member 1) is a Member of project 4 (OWN) and of nothing else.
const OWN = 4
const FOREIGN = 1
const PROJECT_ROLES = { [OWN]: 'Member', [FOREIGN]: null }
const ISSUE_PROJECT = { 10: OWN, 11: FOREIGN }
const SPRINT_PROJECT = { 20: OWN, 21: FOREIGN, 22: null } // 22: shared legacy sprint
const OWN_ISSUE = 10
const FOREIGN_ISSUE = 11
const WIKI_PAGES = {
  100: { id: 100, project_id: FOREIGN, space_id: null, status: 'published', title: 'Foreign', created_by: 'x@x.com', deleted_at: null },
  101: { id: 101, project_id: OWN, space_id: null, status: 'published', title: 'Own', created_by: 'x@x.com', deleted_at: null },
  102: { id: 102, project_id: null, space_id: null, status: 'published', title: 'Shared', created_by: 'x@x.com', deleted_at: null },
}

function wireDb() {
  get.mockImplementation(async (sql, params = []) => {
    // resolveProjectAccess
    if (/FROM projects p\s+LEFT JOIN project_members pm/.test(sql)) {
      const projectId = Number(params[1])
      if (!(projectId in PROJECT_ROLES)) return null
      return { id: projectId, lead_member_id: null, project_role: PROJECT_ROLES[projectId] }
    }
    if (/SELECT project_id FROM issues WHERE id = \?/.test(sql)) {
      const projectId = ISSUE_PROJECT[Number(params[0])]
      return projectId === undefined ? null : { project_id: projectId }
    }
    if (/SELECT project_id FROM sprints WHERE id = \?/.test(sql)) {
      const id = Number(params[0])
      return id in SPRINT_PROJECT ? { project_id: SPRINT_PROJECT[id] } : null
    }
    if (/FROM wiki_pages/.test(sql)) return WIKI_PAGES[Number(params[params.length - 1])] ?? null
    if (/COUNT\(\*\)/.test(sql)) return { count: 0 }
    return null
  })
  all.mockImplementation(async (sql) => {
    // accessibleProjectIds, and wikiVisibility's visibleProjectIds
    if (/SELECT (DISTINCT )?p\.id\s+FROM projects p/.test(sql)) {
      return Object.entries(PROJECT_ROLES).filter(([, r]) => r).map(([id]) => ({ id: Number(id) }))
    }
    return []
  })
  run.mockResolvedValue({ lastID: 1, changes: 1 })
}

let currentUser
const asRole = (workspaceRole, extra = {}) => ({
  id: 1, email: 'caller@test.com', memberId: 1, workspaceRole, isOwner: false, ...extra,
})

async function createApp() {
  const mod = (name) => import(`../routes/${name}.js`).then((m) => m.default)
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { ...currentUser }; next() })
  app.use('/api/issues', await mod('watchers'))
  app.use('/api/issues', await mod('votes'))
  app.use('/api/reports', await mod('reports'))
  app.use('/api/dashboard', await mod('dashboard'))
  app.use('/api/roadmap', await mod('roadmap'))
  app.use('/api/approvals', await mod('approvals'))
  app.use('/api/wiki', await mod('wiki'))
  for (const name of [
    'automation', 'boardConfig', 'cicd', 'components', 'customFields', 'dependencies',
    'favorites', 'fieldConfig', 'gitIntegration', 'issueConfig', 'issueTypeSchemes',
    'labels', 'schemes', 'screenSchemes', 'timeInStatusReports', 'workflowDefinitions',
    'workflowLayout', 'workflowTransitions',
  ]) {
    app.use('/api', await mod(name))
  }
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  wireDb()
  currentUser = asRole('Member')
  app ??= await createApp()
})

const send = (method, url) => {
  const r = request(app)[method](url)
  return method === 'get' || method === 'delete' ? r : r.send({})
}

/* ── the shared helpers ──────────────────────────────────────────────────── */

describe('projectScope / accessibleProjectIds', () => {
  it('is unrestricted for workspace Admin and Owner', async () => {
    expect(await accessibleProjectIds(asRole('Admin'))).toBeNull()
    expect(await accessibleProjectIds(asRole('Viewer', { isOwner: true }))).toBeNull()
    expect(await projectScope(asRole('Admin'))).toEqual({ clause: 'TRUE', params: [] })
  })

  it('narrows anyone else to their projects plus project-less rows', async () => {
    const scope = await projectScope(asRole('Member'), 'i.project_id')
    expect(scope.clause).toBe('(i.project_id IN (?) OR i.project_id IS NULL)')
    expect(scope.params).toEqual([OWN])
  })

  it('a caller in no project gets FALSE, never an empty IN ()', async () => {
    all.mockResolvedValueOnce([])
    const scope = await projectScope(asRole('Viewer'))
    expect(scope.clause).toBe('(FALSE OR project_id IS NULL)')
    expect(scope.params).toEqual([])
  })
})

/* ── project-addressed endpoints ─────────────────────────────────────────── */

const PROJECT_ROUTES = [
  ['get', (p) => `/api/projects/${p}/reports/time-in-status`],
  ['get', (p) => `/api/projects/${p}/reports/control-chart`],
  ['get', (p) => `/api/projects/${p}/board-config`],
  ['get', (p) => `/api/projects/${p}/estimation-summary`],
  ['get', (p) => `/api/projects/${p}/labels`],
  ['get', (p) => `/api/projects/${p}/components`],
  ['get', (p) => `/api/projects/${p}/automation-rules`],
  ['get', (p) => `/api/projects/${p}/automation-logs`],
  ['get', (p) => `/api/projects/${p}/custom-fields`],
  ['get', (p) => `/api/projects/${p}/dependencies`],
  ['get', (p) => `/api/projects/${p}/field-config`],
  ['get', (p) => `/api/projects/${p}/priorities`],
  ['get', (p) => `/api/projects/${p}/statuses`],
  ['get', (p) => `/api/projects/${p}/issue-types`],
  ['get', (p) => `/api/projects/${p}/effective-permissions`],
  ['get', (p) => `/api/projects/${p}/screen-schemes/Story/resolved`],
  ['get', (p) => `/api/projects/${p}/workflow-definitions`],
  ['get', (p) => `/api/projects/${p}/workflow-layout`],
  ['get', (p) => `/api/projects/${p}/workflow-transitions`],
  ['post', (p) => `/api/projects/${p}/favorite`],
  ['get', (p) => `/api/reports?projectId=${p}`],
  ['get', (p) => `/api/reports/cfd?projectId=${p}`],
  ['get', (p) => `/api/reports/created-resolved?projectId=${p}`],
  ['get', (p) => `/api/reports/cycle-time?projectId=${p}`],
  ['get', (p) => `/api/approvals/rules?projectId=${p}`],
  ['get', (p) => `/api/wiki?projectId=${p}`],
  ['get', (p) => `/api/wiki/tree?projectId=${p}`],
  ['get', (p) => `/api/wiki/trash?projectId=${p}`],
  ['get', (p) => `/api/wiki/search?q=a&projectId=${p}`],
]

describe.each(PROJECT_ROUTES)('%s project route', (method, url) => {
  it(`${url('<id>')} — 403 for a non-member`, async () => {
    const res = await send(method, url(FOREIGN))
    expect(res.status).toBe(403)
  })

  it(`${url('<id>')} — open to a project member`, async () => {
    const res = await send(method, url(OWN))
    expect(res.status).not.toBe(403)
  })

  it(`${url('<id>')} — open to a workspace Admin who is in no project`, async () => {
    currentUser = asRole('Admin')
    const res = await send(method, url(FOREIGN))
    expect(res.status).not.toBe(403)
  })
})

/* ── issue-addressed endpoints ───────────────────────────────────────────── */

const ISSUE_ROUTES = [
  ['get', (i) => `/api/issues/${i}/watchers`],
  ['post', (i) => `/api/issues/${i}/watchers`],
  ['get', (i) => `/api/issues/${i}/votes`],
  ['post', (i) => `/api/issues/${i}/votes`],
  ['get', (i) => `/api/issues/${i}/labels`],
  ['get', (i) => `/api/issues/${i}/components`],
  ['put', (i) => `/api/issues/${i}/components`],
  ['get', (i) => `/api/issues/${i}/custom-fields`],
  ['get', (i) => `/api/issues/${i}/ci-builds`],
  ['get', (i) => `/api/issues/${i}/git-links`],
  ['post', (i) => `/api/issues/${i}/git-links`],
  ['get', (i) => `/api/issues/${i}/deployments`],
  ['get', (i) => `/api/approvals/issue/${i}`],
  ['post', (i) => `/api/approvals/issue/${i}`],
  ['get', (i) => `/api/approvals/check/${i}`],
]

describe.each(ISSUE_ROUTES)('%s issue route', (method, url) => {
  it(`${url('<id>')} — 403 for an issue in a project the caller is not in`, async () => {
    const res = await send(method, url(FOREIGN_ISSUE))
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it(`${url('<id>')} — open for an issue in the caller's project`, async () => {
    const res = await send(method, url(OWN_ISSUE))
    expect(res.status).not.toBe(403)
  })
})

it('a project Viewer may read an issue side-panel but not write it', async () => {
  PROJECT_ROLES[OWN] = 'Viewer'
  try {
    expect((await send('get', `/api/issues/${OWN_ISSUE}/components`)).status).not.toBe(403)
    expect((await send('put', `/api/issues/${OWN_ISSUE}/components`)).status).toBe(403)
  } finally {
    PROJECT_ROLES[OWN] = 'Member'
  }
})

/* ── sprint-addressed reports ────────────────────────────────────────────── */

describe.each([
  (s) => `/api/reports/burndown?sprintId=${s}`,
  (s) => `/api/reports/burnup?sprintId=${s}`,
  (s) => `/api/reports/capacity?sprintId=${s}`,
  (s) => `/api/reports/sprint/${s}`,
])('sprint report %#', (url) => {
  it(`${url('<id>')} — 403 for another project's sprint`, async () => {
    expect((await send('get', url(21))).status).toBe(403)
  })

  it(`${url('<id>')} — open for the caller's own sprint and for a shared legacy sprint`, async () => {
    expect((await send('get', url(20))).status).not.toBe(403)
    expect((await send('get', url(22))).status).not.toBe(403)
  })
})

it('PUT /api/reports/capacity refuses another project’s sprint', async () => {
  const res = await request(app).put('/api/reports/capacity')
    .send({ sprintId: 21, assignee: 'a', capacityPoints: 5 })
  expect(res.status).toBe(403)
  expect(run).not.toHaveBeenCalled()
})

/* ── workspace-wide reads are narrowed, not refused ──────────────────────── */

const sqlOf = (mock) => mock.mock.calls.map(([sql, params]) => ({ sql, params }))

describe('workspace-wide reads', () => {
  it('dashboard metrics count only the caller’s projects', async () => {
    const res = await request(app).get('/api/dashboard')
    expect(res.status).toBe(200)
    const counts = sqlOf(get).filter((c) => /COUNT\(\*\) AS count FROM issues/.test(c.sql))
    expect(counts).toHaveLength(4)
    for (const c of counts) {
      expect(c.sql).toContain('(project_id IN (?) OR project_id IS NULL)')
      expect(c.params).toEqual([OWN])
    }
  })

  it('dashboard metrics stay unscoped for a workspace Admin', async () => {
    currentUser = asRole('Admin')
    await request(app).get('/api/dashboard')
    const counts = sqlOf(get).filter((c) => /COUNT\(\*\) AS count FROM issues/.test(c.sql))
    for (const c of counts) expect(c.sql).not.toContain('IN (')
  })

  it('the roadmap lists only the caller’s projects', async () => {
    await request(app).get('/api/roadmap')
    const q = sqlOf(all).find((c) => /FROM roadmap_epics/.test(c.sql))
    expect(q.sql).toContain('(project_id IN (?) OR project_id IS NULL)')
    expect(q.params).toEqual([OWN])
  })

  it.each([
    ['/api/reports', /FROM issues WHERE/],
    ['/api/reports/cfd', /FROM issues i WHERE/],
    ['/api/reports/created-resolved', /FROM issues i WHERE/],
    ['/api/reports/cycle-time', /FROM issues WHERE/],
    ['/api/approvals/rules', /FROM approval_rules/],
  ])('%s without a projectId is narrowed to the caller’s projects', async (url, pattern) => {
    const res = await request(app).get(url)
    expect(res.status).toBe(200)
    const q = sqlOf(all).find((c) => pattern.test(c.sql))
    expect(q.sql).toMatch(/project_id IN \(\?\) OR (i\.)?project_id IS NULL/)
    expect(q.params).toContain(OWN)
  })
})

/* ── wiki pages ──────────────────────────────────────────────────────────── */

describe('wiki pages', () => {
  it('a page in another project is a 404, as if it did not exist', async () => {
    expect((await request(app).get('/api/wiki/100')).status).toBe(404)
    expect((await request(app).get('/api/wiki/100/versions')).status).toBe(404)
  })

  it('pages in the caller’s project, and project-less pages, still load', async () => {
    expect((await request(app).get('/api/wiki/101')).status).toBe(200)
    expect((await request(app).get('/api/wiki/102')).status).toBe(200)
  })

  it('search applies the visibility filter (drafts, trash and other projects)', async () => {
    await request(app).get('/api/wiki/search?q=plan')
    const q = sqlOf(all).find((c) => /ILIKE/.test(c.sql))
    expect(q.sql).toContain('deleted_at IS NULL')
    expect(q.sql).toContain("status <> 'draft'")
    expect(q.sql).toMatch(/project_id IS NULL OR project_id IN \(\?\)/)
    expect(q.params).toContain(OWN)
  })
})
