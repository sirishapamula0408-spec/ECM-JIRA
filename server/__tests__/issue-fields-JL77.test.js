import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB — matches collaboration-modules.test.js pattern)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Automation service pulls from db too; stub the status-change hook to a no-op.
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath = '/api/issues') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'reporter@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

// A representative issue row as returned by the DB SELECT (JL-77 columns included)
function issueRow(overrides = {}) {
  return {
    id: 1,
    issue_key: 'PROJ-1',
    title: 'Sample',
    description: 'Desc',
    priority: 'Medium',
    assignee: 'Alice',
    status: 'Backlog',
    issue_type: 'Story',
    sprint_id: null,
    project_id: null,
    parent_id: null,
    created_at: '2026-07-08T00:00:00.000Z',
    reporter: 'reporter@test.com',
    due_date: '2026-07-20',
    start_date: '2026-07-10',
    resolution: null,
    environment: 'Production',
    components: 'API, UI',
    updated_at: '2026-07-08T00:00:00.000Z',
    ...overrides,
  }
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/issues.js')
  app = createApp(mod)
})

describe('JL-77 — mapIssue returns expanded fields', () => {
  it('GET /:id maps reporter/dueDate/startDate/resolution/environment/components/updatedAt', async () => {
    get.mockResolvedValueOnce(issueRow())

    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(200)
    expect(res.body.reporter).toBe('reporter@test.com')
    expect(res.body.dueDate).toBe('2026-07-20')
    expect(res.body.startDate).toBe('2026-07-10')
    expect(res.body.environment).toBe('Production')
    expect(res.body.components).toBe('API, UI')
    expect(res.body.resolution).toBeNull()
    expect(res.body.updatedAt).toBe('2026-07-08T00:00:00.000Z')
  })
})

describe('JL-77 — POST create accepts & persists expanded fields', () => {
  it('inserts the new columns and defaults reporter from req.user when omitted', async () => {
    // getDefaultSprintId not needed (status Backlog). get calls: count, then re-read row.
    get.mockResolvedValueOnce({ count: 0 }) // COUNT(*)
    get.mockResolvedValueOnce(issueRow()) // re-read of created row
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app)
      .post('/api/issues')
      .send({
        title: 'Sample',
        description: 'Desc',
        assignee: 'Alice',
        priority: 'Medium',
        status: 'Backlog',
        issueType: 'Story',
        dueDate: '2026-07-20',
        startDate: '2026-07-10',
        environment: 'Production',
        components: 'API, UI',
        resolution: 'Fixed',
        // reporter intentionally omitted -> should default to req.user.email
      })

    expect(res.status).toBe(201)

    // Find the INSERT INTO issues call and assert new columns + values are passed
    const insertCall = run.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.startsWith('INSERT INTO issues'),
    )
    expect(insertCall).toBeTruthy()
    const [sql, params] = insertCall
    expect(sql).toContain('reporter')
    expect(sql).toContain('due_date')
    expect(sql).toContain('start_date')
    expect(sql).toContain('resolution')
    expect(sql).toContain('environment')
    expect(sql).toContain('components')
    expect(sql).toContain('updated_at')
    expect(sql).toContain('NOW()')
    // reporter defaulted to the authenticated user's email
    expect(params).toContain('reporter@test.com')
    expect(params).toContain('2026-07-20')
    expect(params).toContain('2026-07-10')
    expect(params).toContain('Production')
    expect(params).toContain('API, UI')
    expect(params).toContain('Fixed')
  })

  it('accepts an explicit reporter override', async () => {
    get.mockResolvedValueOnce({ count: 0 })
    get.mockResolvedValueOnce(issueRow({ reporter: 'boss@test.com' }))
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app)
      .post('/api/issues')
      .send({
        title: 'Sample',
        description: 'Desc',
        assignee: 'Alice',
        priority: 'Medium',
        status: 'Backlog',
        issueType: 'Story',
        reporter: 'boss@test.com',
      })

    expect(res.status).toBe(201)
    const insertCall = run.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO issues'))
    expect(insertCall[1]).toContain('boss@test.com')
  })
})

describe('JL-77 — PATCH edit updates expanded fields & bumps updated_at', () => {
  it('persists dueDate/startDate/environment/resolution/components and sets updated_at=NOW()', async () => {
    get.mockResolvedValueOnce(issueRow()) // existing lookup
    get.mockResolvedValueOnce(issueRow({ environment: 'Staging', resolution: 'Fixed' })) // re-read
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app)
      .patch('/api/issues/1')
      .send({
        dueDate: '2026-08-01',
        startDate: '2026-07-15',
        environment: 'Staging',
        resolution: 'Fixed',
        components: 'DB',
      })

    expect(res.status).toBe(200)

    const updateCall = run.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE issues SET'),
    )
    expect(updateCall).toBeTruthy()
    const [sql, params] = updateCall
    expect(sql).toContain('due_date = ?')
    expect(sql).toContain('start_date = ?')
    expect(sql).toContain('environment = ?')
    expect(sql).toContain('resolution = ?')
    expect(sql).toContain('components = ?')
    expect(sql).toContain('updated_at = NOW()')
    expect(params).toContain('2026-08-01')
    expect(params).toContain('2026-07-15')
    expect(params).toContain('Staging')
    expect(params).toContain('Fixed')
    expect(params).toContain('DB')
  })

  it('clears a field when passed an empty string (stored as null)', async () => {
    get.mockResolvedValueOnce(issueRow())
    get.mockResolvedValueOnce(issueRow({ environment: null }))
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app)
      .patch('/api/issues/1')
      .send({ environment: '' })

    expect(res.status).toBe(200)
    const updateCall = run.mock.calls.find(([sql]) => sql.startsWith('UPDATE issues SET'))
    const [sql, params] = updateCall
    expect(sql).toContain('environment = ?')
    // empty string normalized to null
    expect(params[0]).toBeNull()
  })

  it('does not touch expanded columns when none are supplied (only base edit)', async () => {
    get.mockResolvedValueOnce(issueRow())
    get.mockResolvedValueOnce(issueRow({ priority: 'High' }))
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app)
      .patch('/api/issues/1')
      .send({ priority: 'High' })

    expect(res.status).toBe(200)
    const updateCall = run.mock.calls.find(([sql]) => sql.startsWith('UPDATE issues SET'))
    const [sql] = updateCall
    expect(sql).toContain('priority = ?')
    expect(sql).not.toContain('environment = ?')
    // still bumps updated_at on any edit
    expect(sql).toContain('updated_at = NOW()')
  })
})
