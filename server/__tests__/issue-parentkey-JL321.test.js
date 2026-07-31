// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
}))
vi.mock('../services/automation.js', () => ({ runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/events.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))

import { all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

const adminUser = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }

function createApp(mod) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = adminUser; next() })
  app.use('/api/issues', mod.default || mod)
  app.use(errorHandler)
  return app
}

function issueRow(overrides = {}) {
  return {
    id: 15, issue_key: 'OICL-6', title: 'Write tests', description: '', priority: 'High',
    assignee: 'a@test.com', status: 'Done', issue_type: 'Sub-task', sprint_id: null,
    project_id: 4, parent_id: 14, epic_id: null, story_points: null, created_at: '2026-01-01',
    reporter: null, due_date: null, start_date: null, resolution: null, environment: null,
    components: null, updated_at: null, security_level_id: null, ...overrides,
  }
}

/* JL-321: GET /api/issues/:id must include parentKey so a sub-task's breadcrumb
   can link to its parent (Project / PARENT-KEY / SUBTASK-KEY). Admin bypasses the
   read-guard's project lookup, so the first get() is the issue row itself. */
describe('JL-321 — GET /api/issues/:id parentKey', () => {
  let mod
  beforeEach(async () => { vi.clearAllMocks(); mod = await import('../routes/issues.js') })

  it('includes the parent issue_key when the issue has a parent', async () => {
    get.mockResolvedValueOnce(issueRow())               // the issue row (parent_id 14)
    get.mockResolvedValueOnce({ issue_key: 'OICL-41' }) // JL-321 parent key lookup
    all.mockResolvedValue([])                            // versions (best-effort)

    const res = await request(createApp(mod)).get('/api/issues/15')

    expect(res.status).toBe(200)
    expect(res.body.parentId).toBe(14)
    expect(res.body.parentKey).toBe('OICL-41')
  })

  it('returns parentKey null for a top-level issue (no parent)', async () => {
    get.mockResolvedValueOnce(issueRow({ parent_id: null, issue_type: 'Story' }))
    all.mockResolvedValue([])

    const res = await request(createApp(mod)).get('/api/issues/15')

    expect(res.status).toBe(200)
    expect(res.body.parentKey).toBe(null)
  })
})
