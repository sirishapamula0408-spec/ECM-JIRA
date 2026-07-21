// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module used by both routers (and the issues route's services).
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
}))

// Keep automation / events side-effects inert (imported transitively by issues.js).
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { canViewIssue } from '../services/issueSecurity.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Build an app that injects a configurable req.user, then mounts a route module.
function createApp(routeModule, user, mountPath = '/api') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

const adminUser = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
const viewerUser = { id: 2, email: 'viewer@test.com', memberId: 2, workspaceRole: 'Viewer', isOwner: false }

// ---------------------------------------------------------------------------
// Pure helper — canViewIssue
// ---------------------------------------------------------------------------
describe('JL-131 — canViewIssue (pure helper)', () => {
  it('returns true when the issue has no security level (public / backward compatible)', () => {
    expect(canViewIssue({ security_level_id: null }, viewerUser)).toBe(true)
    expect(canViewIssue({ securityLevelId: null }, viewerUser)).toBe(true)
    expect(canViewIssue({}, viewerUser)).toBe(true) // column absent → undefined → public
  })

  it('returns true for workspace Admins and Owners on a restricted issue', () => {
    const issue = { security_level_id: 5, assignee: 'someone@else.com', reporter: 'r@else.com' }
    expect(canViewIssue(issue, adminUser)).toBe(true)
    expect(canViewIssue(issue, { email: 'owner@test.com', workspaceRole: 'Member', isOwner: true })).toBe(true)
  })

  it('returns true for the assignee and reporter of a restricted issue', () => {
    expect(
      canViewIssue({ security_level_id: 5, assignee: 'alice@test.com', reporter: 'bob@test.com' }, {
        email: 'alice@test.com',
        workspaceRole: 'Member',
        isOwner: false,
      }),
    ).toBe(true)
    expect(
      canViewIssue({ securityLevelId: 5, assigneeEmail: 'x@test.com', reporter: 'bob@test.com' }, {
        email: 'BOB@test.com', // case-insensitive
        workspaceRole: 'Member',
        isOwner: false,
      }),
    ).toBe(true)
  })

  it('returns false for an unrelated member on a restricted issue', () => {
    expect(
      canViewIssue({ security_level_id: 5, assignee: 'alice@test.com', reporter: 'bob@test.com' }, {
        email: 'nobody@test.com',
        workspaceRole: 'Member',
        isOwner: false,
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Security-level CRUD
// ---------------------------------------------------------------------------
describe('JL-131 — security-level CRUD (Admin-gated)', () => {
  let mod
  beforeEach(async () => {
    vi.clearAllMocks()
    mod = await import('../routes/securityLevels.js')
  })

  it('GET /api/security-levels lists levels', async () => {
    all.mockResolvedValueOnce([
      { id: 1, name: 'Confidential', description: 'secret', created_at: '2026-01-01' },
    ])
    const app = createApp(mod, adminUser)
    const res = await request(app).get('/api/security-levels')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: 1, name: 'Confidential', description: 'secret', createdAt: '2026-01-01' },
    ])
  })

  it('POST /api/security-levels creates a level as Admin (201)', async () => {
    run.mockResolvedValueOnce({ lastID: 7, changes: 1 })
    get.mockResolvedValueOnce({ id: 7, name: 'Confidential', description: null, created_at: '2026-01-01' })
    const app = createApp(mod, adminUser)
    const res = await request(app).post('/api/security-levels').send({ name: 'Confidential' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ id: 7, name: 'Confidential', description: null, createdAt: '2026-01-01' })
    const insert = run.mock.calls.find((c) => String(c[0]).startsWith('INSERT INTO security_levels'))
    expect(insert).toBeTruthy()
  })

  it('POST /api/security-levels is 403 for a non-Admin', async () => {
    const app = createApp(mod, viewerUser)
    const res = await request(app).post('/api/security-levels').send({ name: 'Confidential' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('POST /api/security-levels 400s without a name', async () => {
    const app = createApp(mod, adminUser)
    const res = await request(app).post('/api/security-levels').send({})
    expect(res.status).toBe(400)
  })

  it('DELETE /api/security-levels/:id is 403 for a non-Admin', async () => {
    const app = createApp(mod, viewerUser)
    const res = await request(app).delete('/api/security-levels/1')
    expect(res.status).toBe(403)
  })

  it('DELETE /api/security-levels/:id clears references and deletes as Admin', async () => {
    get.mockResolvedValueOnce({ id: 3 }) // existing level
    run.mockResolvedValue({ changes: 1 })
    const app = createApp(mod, adminUser)
    const res = await request(app).delete('/api/security-levels/3')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, id: 3 })
    const clear = run.mock.calls.find((c) => String(c[0]).startsWith('UPDATE issues SET security_level_id = NULL'))
    const del = run.mock.calls.find((c) => String(c[0]).startsWith('DELETE FROM security_levels'))
    expect(clear).toBeTruthy()
    expect(del).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// PUT /api/issues/:id/security-level
// ---------------------------------------------------------------------------
describe('JL-131 — set an issue security level', () => {
  let mod
  beforeEach(async () => {
    vi.clearAllMocks()
    mod = await import('../routes/securityLevels.js')
  })

  it('PUT sets an issue level as Admin', async () => {
    get
      .mockResolvedValueOnce({ id: 1 }) // issue exists
      .mockResolvedValueOnce({ id: 5 }) // level exists
      .mockResolvedValueOnce({ id: 1, issue_key: 'PROJ-1', security_level_id: 5 }) // reload
    run.mockResolvedValue({ changes: 1 })
    const app = createApp(mod, adminUser)
    const res = await request(app).put('/api/issues/1/security-level').send({ securityLevelId: 5 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 1, key: 'PROJ-1', securityLevelId: 5 })
    const upd = run.mock.calls.find((c) => String(c[0]).startsWith('UPDATE issues SET security_level_id = ?'))
    expect(upd[1]).toEqual([5, 1])
  })

  it('PUT clears an issue level when securityLevelId is null', async () => {
    get
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 1, issue_key: 'PROJ-1', security_level_id: null })
    run.mockResolvedValue({ changes: 1 })
    const app = createApp(mod, adminUser)
    const res = await request(app).put('/api/issues/1/security-level').send({ securityLevelId: null })
    expect(res.status).toBe(200)
    expect(res.body.securityLevelId).toBe(null)
  })

  it('PUT is 403 for a non-Admin', async () => {
    const app = createApp(mod, viewerUser)
    const res = await request(app).put('/api/issues/1/security-level').send({ securityLevelId: 5 })
    expect(res.status).toBe(403)
  })

  it('PUT 404s for a missing issue', async () => {
    get.mockResolvedValueOnce(undefined)
    const app = createApp(mod, adminUser)
    const res = await request(app).put('/api/issues/999/security-level').send({ securityLevelId: 5 })
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Enforcement on GET /api/issues/:id
// ---------------------------------------------------------------------------
describe('JL-131 — GET /api/issues/:id enforcement', () => {
  let mod
  beforeEach(async () => {
    vi.clearAllMocks()
    mod = await import('../routes/issues.js')
  })

  function issueRow(overrides = {}) {
    return {
      id: 1,
      issue_key: 'PROJ-1',
      title: 'Secret work',
      description: 'd',
      priority: 'High',
      assignee: 'alice@test.com',
      status: 'To Do',
      issue_type: 'Bug',
      sprint_id: null,
      project_id: null,
      parent_id: null,
      epic_id: null,
      story_points: null,
      created_at: '2026-01-01',
      reporter: 'bob@test.com',
      due_date: null,
      start_date: null,
      resolution: null,
      environment: null,
      components: null,
      updated_at: null,
      security_level_id: null,
      ...overrides,
    }
  }

  it('returns the issue when it has no security level (backward compatible)', async () => {
    get.mockResolvedValueOnce({ project_id: null }) // JL-226: read guard project resolve
    get.mockResolvedValueOnce(issueRow())
    all.mockResolvedValue([]) // versions best-effort
    const app = createApp(mod, viewerUser, '/api/issues')
    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(200)
    expect(res.body.key).toBe('PROJ-1')
  })

  it('returns 403 for a non-viewer on a restricted issue', async () => {
    get.mockResolvedValueOnce({ project_id: null }) // JL-226: read guard project resolve
    get.mockResolvedValueOnce(issueRow({ security_level_id: 5 }))
    const app = createApp(mod, viewerUser, '/api/issues') // viewer, not assignee/reporter
    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(403)
  })

  it('returns the restricted issue for its assignee', async () => {
    get.mockResolvedValueOnce({ project_id: null }) // JL-226: read guard project resolve
    get.mockResolvedValueOnce(issueRow({ security_level_id: 5 }))
    all.mockResolvedValue([])
    const app = createApp(mod, { email: 'alice@test.com', workspaceRole: 'Member', isOwner: false }, '/api/issues')
    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(200)
    expect(res.body.securityLevelId).toBe(5)
  })

  it('returns the restricted issue for an Admin', async () => {
    get.mockResolvedValueOnce(issueRow({ security_level_id: 5 }))
    all.mockResolvedValue([])
    const app = createApp(mod, adminUser, '/api/issues')
    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Enforcement on GET /api/issues (list filtering)
// ---------------------------------------------------------------------------
describe('JL-131 — GET /api/issues list filtering', () => {
  let mod
  beforeEach(async () => {
    vi.clearAllMocks()
    mod = await import('../routes/issues.js')
  })

  function listRow(id, overrides = {}) {
    return {
      id,
      issue_key: `PROJ-${id}`,
      title: `t${id}`,
      description: 'd',
      priority: 'Low',
      assignee: 'alice@test.com',
      status: 'To Do',
      issue_type: 'Task',
      sprint_id: null,
      project_id: null,
      parent_id: null,
      epic_id: null,
      story_points: null,
      created_at: '2026-01-01',
      reporter: 'bob@test.com',
      due_date: null,
      start_date: null,
      resolution: null,
      environment: null,
      components: null,
      updated_at: null,
      security_level_id: null,
      watcher_count: 0,
      ...overrides,
    }
  }

  it('excludes restricted issues the caller cannot view; keeps public ones', async () => {
    // JL-225: non-admin list scoping first resolves the caller's accessible
    // projects; stub a membership so the security-level filtering is exercised.
    all.mockResolvedValueOnce([{ id: 1 }])
    all.mockResolvedValueOnce([
      listRow(1), // public → visible
      listRow(2, { security_level_id: 9, assignee: 'someone@else.com', reporter: 'x@else.com' }), // hidden
      listRow(3, { security_level_id: 9, assignee: 'viewer@test.com' }), // assignee match → visible
    ])
    const app = createApp(mod, viewerUser, '/api/issues')
    const res = await request(app).get('/api/issues')
    expect(res.status).toBe(200)
    const keys = res.body.map((i) => i.key)
    expect(keys).toContain('PROJ-1')
    expect(keys).toContain('PROJ-3')
    expect(keys).not.toContain('PROJ-2')
  })

  it('returns all issues unchanged when none are secured (backward compatible)', async () => {
    all.mockResolvedValueOnce([{ id: 1 }]) // JL-225: accessible-projects scoping
    all.mockResolvedValueOnce([listRow(1), listRow(2), listRow(3)])
    const app = createApp(mod, viewerUser, '/api/issues')
    const res = await request(app).get('/api/issues')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// JL-185 — enforcement on JQL / search / ai-search (filters.js)
// ---------------------------------------------------------------------------
describe('JL-185 — filters JQL/search/ai-search enforcement', () => {
  let mod
  beforeEach(async () => {
    vi.clearAllMocks()
    mod = await import('../routes/filters.js')
  })

  function searchRow(id, overrides = {}) {
    return {
      id,
      issue_key: `PROJ-${id}`,
      title: `t${id}`,
      description: 'd',
      priority: 'Low',
      assignee: 'alice@test.com',
      status: 'To Do',
      issue_type: 'Task',
      sprint_id: null,
      project_id: null,
      created_at: '2026-01-01',
      reporter: 'bob@test.com',
      security_level_id: null,
      ...overrides,
    }
  }

  // Public + restricted-hidden + restricted-assignee-visible mix.
  const mixedRows = [
    searchRow(1), // public
    searchRow(2, { security_level_id: 9, assignee: 'someone@else.com', reporter: 'x@else.com' }), // hidden
    searchRow(3, { security_level_id: 9, assignee: 'viewer@test.com' }), // assignee match → visible
  ]

  it('POST /api/filters/jql excludes restricted issues a non-viewer cannot see', async () => {
    all.mockResolvedValueOnce(mixedRows)
    const app = createApp(mod, viewerUser, '/api/filters')
    const res = await request(app).post('/api/filters/jql').send({ jql: 'status = "To Do"' })
    expect(res.status).toBe(200)
    const keys = res.body.map((i) => i.key)
    expect(keys).toEqual(['PROJ-1', 'PROJ-3'])
    expect(keys).not.toContain('PROJ-2')
  })

  it('POST /api/filters/jql returns the restricted issue to an Admin', async () => {
    all.mockResolvedValueOnce(mixedRows)
    const app = createApp(mod, adminUser, '/api/filters')
    const res = await request(app).post('/api/filters/jql').send({ jql: 'status = "To Do"' })
    expect(res.status).toBe(200)
    expect(res.body.map((i) => i.key)).toEqual(['PROJ-1', 'PROJ-2', 'PROJ-3'])
  })

  it('POST /api/filters/search excludes restricted issues for a non-viewer', async () => {
    all.mockResolvedValueOnce(mixedRows)
    const app = createApp(mod, viewerUser, '/api/filters')
    const res = await request(app).post('/api/filters/search').send({ status: 'To Do' })
    expect(res.status).toBe(200)
    const keys = res.body.map((i) => i.key)
    expect(keys).toContain('PROJ-1')
    expect(keys).toContain('PROJ-3')
    expect(keys).not.toContain('PROJ-2')
  })

  it('POST /api/filters/ai-search excludes restricted issues for a non-viewer', async () => {
    all.mockResolvedValueOnce(mixedRows)
    const app = createApp(mod, viewerUser, '/api/filters')
    const res = await request(app).post('/api/filters/ai-search').send({ query: 'to do tasks' })
    expect(res.status).toBe(200)
    const keys = res.body.issues.map((i) => i.key)
    expect(keys).toContain('PROJ-1')
    expect(keys).toContain('PROJ-3')
    expect(keys).not.toContain('PROJ-2')
  })

  it('leaves results unchanged when no issue is secured (backward compatible)', async () => {
    all.mockResolvedValue([searchRow(1), searchRow(2), searchRow(3)])
    const app = createApp(mod, viewerUser, '/api/filters')
    const jql = await request(app).post('/api/filters/jql').send({ jql: 'status = "To Do"' })
    expect(jql.body).toHaveLength(3)
    const search = await request(app).post('/api/filters/search').send({ status: 'To Do' })
    expect(search.body).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// JL-185 — enforcement on attachment list / download (attachments.js)
// ---------------------------------------------------------------------------
describe('JL-185 — attachment access enforcement', () => {
  let mod
  beforeEach(async () => {
    vi.clearAllMocks()
    mod = await import('../routes/attachments.js')
  })

  const restrictedIssue = { id: 1, assignee: 'alice@test.com', reporter: 'bob@test.com', security_level_id: 9 }
  const publicIssue = { id: 1, assignee: 'alice@test.com', reporter: 'bob@test.com', security_level_id: null }
  const attachmentRow = { id: 7, issue_id: 1, filename: 'secret.png', mime_type: 'image/png', size_bytes: 10, storage_path: 'k', thumbnail_key: null }

  it('GET issue attachments → 403 for a non-viewer of a restricted issue', async () => {
    // JL-286: the requireProjectRead guard also looks up the issue (no project_id
    // on these fixtures → guard passes through), so return the row for every get.
    get.mockResolvedValue(restrictedIssue) // parent issue lookup (guard + handler)
    const app = createApp(mod, viewerUser, '/api')
    const res = await request(app).get('/api/issues/1/attachments')
    expect(res.status).toBe(403)
    expect(all).not.toHaveBeenCalled()
  })

  it('GET issue attachments → 200 for an Admin on a restricted issue', async () => {
    get.mockResolvedValueOnce(restrictedIssue)
    all.mockResolvedValueOnce([attachmentRow])
    const app = createApp(mod, adminUser, '/api')
    const res = await request(app).get('/api/issues/1/attachments')
    expect(res.status).toBe(200)
    expect(res.body[0].filename).toBe('secret.png')
  })

  it('GET issue attachments → 200 unchanged for a non-restricted issue', async () => {
    get.mockResolvedValue(publicIssue) // JL-286: guard + handler both read the issue
    all.mockResolvedValueOnce([attachmentRow])
    const app = createApp(mod, viewerUser, '/api')
    const res = await request(app).get('/api/issues/1/attachments')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('GET download → 403 for a non-viewer of a restricted issue (IDOR blocked)', async () => {
    // JL-286: requireProjectRead resolves attachment → issue before the handler,
    // so route by SQL shape (no project_id → guard passes; canViewIssue blocks).
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM attachments')) return attachmentRow
      if (sql.includes('FROM issues')) return restrictedIssue
      return null
    })
    const app = createApp(mod, viewerUser, '/api')
    const res = await request(app).get('/api/attachments/7/download')
    expect(res.status).toBe(403)
  })

  it('GET download → 403 for the issue assignee is allowed (200)', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM attachments')) return attachmentRow
      if (sql.includes('FROM issues')) return restrictedIssue
      return null
    })
    const app = createApp(mod, { email: 'alice@test.com', workspaceRole: 'Member', isOwner: false }, '/api')
    const res = await request(app).get('/api/attachments/7/download')
    // Assignee may view → passes the guard (storage.get then resolves/404s on missing data, not 403).
    expect(res.status).not.toBe(403)
  })
})
