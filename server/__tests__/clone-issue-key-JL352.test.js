import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module used by the issues route (and its imported services)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Keep automation / events side-effects inert
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/issues', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/issues.js')
  app = createApp(mod)
})

function issueRow(overrides = {}) {
  return {
    id: 1,
    issue_key: 'ECM-1',
    title: 'Original title',
    description: 'the description',
    priority: 'High',
    assignee: 'Alice',
    status: 'To Do',
    issue_type: 'Bug',
    sprint_id: 5,
    project_id: 3,
    parent_id: null,
    epic_id: null,
    story_points: 3,
    created_at: '2026-01-01T00:00:00Z',
    reporter: 'reporter@test.com',
    due_date: null,
    start_date: null,
    resolution: null,
    environment: 'prod',
    components: 'api',
    updated_at: null,
    ...overrides,
  }
}

// JL-352: clone must allocate its key from the monotonic per-project counter
// (projects.issue_counter, JL-92), NOT from COUNT(*). Any project that ever
// had an issue deleted has COUNT(*) < issue_counter, so a count-based key
// collides with an existing issue_key (unique index idx_issues_issue_key)
// and the clone request 500s.
//
// The db mock is keyed on SQL shape (not call order) so the same scenario is
// meaningful against both the buggy and the fixed implementation: it models a
// project whose counter is at 5 while only 3 issue rows survive.
describe('JL-352 — clone allocates keys from the project counter, not COUNT(*)', () => {
  it('uses issue_counter (key -6), not COUNT(*)+1 (collision-prone -4), and issues the counter UPDATE', async () => {
    const source = issueRow({ id: 1, project_id: 3 })

    get.mockImplementation(async (sql, params = []) => {
      if (sql.startsWith('SELECT key FROM projects')) return { key: 'ECM' }
      // The atomic counter bump: 5 existing allocations → RETURNING 6
      if (sql.includes('UPDATE projects SET issue_counter = issue_counter + 1')) {
        return { issue_counter: 6 }
      }
      // Only 3 rows survive (2 were deleted) → COUNT-based key would be ECM-4,
      // which already exists and violates idx_issues_issue_key
      if (sql.includes('COUNT(*)')) return { count: 3 }
      if (sql.startsWith('SELECT id, issue_key')) {
        // source lookup vs freshly-inserted-row lookup, by id param
        if (params[0] === 1) return source
        return issueRow({ id: 42, issue_key: 'ECM-6', title: 'CLONE - Original title' })
      }
      return undefined
    })
    all.mockResolvedValue([])
    run.mockResolvedValue({ lastID: 42, changes: 1 })

    const res = await request(app).post('/api/issues/1/clone').send({})

    expect(res.status).toBe(201)

    // The key actually written to the unique column comes from the counter
    const insertCall = run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO issues'),
    )
    expect(insertCall).toBeTruthy()
    expect(insertCall[1][0]).toBe('ECM-6')
    expect(insertCall[1][0]).not.toBe('ECM-4')

    // The atomic counter UPDATE was actually issued for the source's project
    const counterCall = get.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('UPDATE projects SET issue_counter = issue_counter + 1'),
    )
    expect(counterCall).toBeTruthy()
    expect(counterCall[1]).toEqual([3])
  })

  it('falls back to the global COUNT(*) path for a project-less source (no counter UPDATE)', async () => {
    const source = issueRow({ id: 1, project_id: null, issue_key: 'PROJ-1' })

    get.mockImplementation(async (sql, params = []) => {
      if (sql.includes('UPDATE projects SET issue_counter')) {
        throw new Error('counter UPDATE must not run for a project-less issue')
      }
      if (sql.includes('COUNT(*)')) return { count: 7 }
      if (sql.startsWith('SELECT id, issue_key')) {
        if (params[0] === 1) return source
        return issueRow({
          id: 42,
          issue_key: 'PROJ-8',
          title: 'CLONE - Original title',
          project_id: null,
        })
      }
      return undefined
    })
    all.mockResolvedValue([])
    run.mockResolvedValue({ lastID: 42, changes: 1 })

    const res = await request(app).post('/api/issues/1/clone').send({})

    expect(res.status).toBe(201)
    const insertCall = run.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO issues'),
    )
    expect(insertCall).toBeTruthy()
    // Legacy project-less fallback: global COUNT(*)+1 under the default key
    expect(insertCall[1][0]).toBe('PROJ-8')
  })
})
