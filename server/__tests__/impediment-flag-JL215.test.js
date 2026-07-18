// JL-215 — Flag issue as impediment: `flagged` boolean on issues, toggled via
// the existing PATCH /api/issues/:id field whitelist and returned by the issue
// read endpoints. Mocked-db suite (same pattern as issue-fields-JL77.test.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => {
  const run = vi.fn()
  const all = vi.fn()
  const get = vi.fn()
  return {
    run,
    all,
    get,
    columnExists: vi.fn(),
    tableExists: vi.fn(),
    withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
  }
})

vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath = '/api/issues') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'member@test.com', memberId: 1, workspaceRole: 'Member', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

function issueRow(overrides = {}) {
  return {
    id: 1,
    issue_key: 'PROJ-1',
    title: 'Sample',
    description: 'Desc',
    priority: 'Medium',
    assignee: 'Alice',
    status: 'To Do',
    issue_type: 'Story',
    sprint_id: null,
    project_id: null,
    parent_id: null,
    epic_id: null,
    story_points: null,
    created_at: '2026-07-10T00:00:00.000Z',
    reporter: 'member@test.com',
    due_date: null,
    start_date: null,
    resolution: null,
    environment: null,
    components: null,
    updated_at: '2026-07-10T00:00:00.000Z',
    flagged: false,
    ...overrides,
  }
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/issues.js')
  app = createApp(mod)
})

describe('JL-215 — GET returns the flagged state', () => {
  it('GET /:id maps flagged=true from the row', async () => {
    get.mockResolvedValueOnce(issueRow({ flagged: true }))

    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(200)
    expect(res.body.flagged).toBe(true)
  })

  it('GET /:id defaults flagged to false', async () => {
    get.mockResolvedValueOnce(issueRow())

    const res = await request(app).get('/api/issues/1')
    expect(res.status).toBe(200)
    expect(res.body.flagged).toBe(false)
  })
})

describe('JL-215 — PATCH toggles the flag', () => {
  it('sets flagged=true and returns the new state', async () => {
    get.mockResolvedValueOnce(issueRow()) // existing lookup
    get.mockResolvedValueOnce(issueRow({ flagged: true })) // re-read after UPDATE
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/issues/1').send({ flagged: true })

    expect(res.status).toBe(200)
    expect(res.body.flagged).toBe(true)

    const updateCall = run.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.startsWith('UPDATE issues SET'),
    )
    expect(updateCall).toBeTruthy()
    const [sql, params] = updateCall
    expect(sql).toContain('flagged = ?')
    expect(sql).toContain('updated_at = NOW()')
    expect(params).toContain(true)
  })

  it('clears flagged=false and returns the new state', async () => {
    get.mockResolvedValueOnce(issueRow({ flagged: true }))
    get.mockResolvedValueOnce(issueRow({ flagged: false }))
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/issues/1').send({ flagged: false })

    expect(res.status).toBe(200)
    expect(res.body.flagged).toBe(false)

    const updateCall = run.mock.calls.find(([sql]) => sql.startsWith('UPDATE issues SET'))
    const [sql, params] = updateCall
    expect(sql).toContain('flagged = ?')
    expect(params).toContain(false)
  })

  it('records the change in the issue history audit log', async () => {
    get.mockResolvedValueOnce(issueRow())
    get.mockResolvedValueOnce(issueRow({ flagged: true }))
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/issues/1').send({ flagged: true })
    expect(res.status).toBe(200)

    const historyCall = run.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.startsWith('INSERT INTO issue_history'),
    )
    expect(historyCall).toBeTruthy()
    const [, params] = historyCall
    expect(params).toContain('flagged')
    expect(params).toContain('false')
    expect(params).toContain('true')
  })

  it('rejects a non-boolean flagged value with 400', async () => {
    get.mockResolvedValueOnce(issueRow())

    const res = await request(app).patch('/api/issues/1').send({ flagged: 'yes' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/boolean/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an invalid issue id with 400', async () => {
    const res = await request(app).patch('/api/issues/abc').send({ flagged: true })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid issue id')
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown issue id', async () => {
    get.mockResolvedValueOnce(undefined)

    const res = await request(app).patch('/api/issues/999').send({ flagged: true })

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Issue not found')
    expect(run).not.toHaveBeenCalled()
  })
})
