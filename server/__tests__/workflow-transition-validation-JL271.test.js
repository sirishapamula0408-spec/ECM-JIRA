// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module used by the workflowTransitions route.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Bypass the Admin role guard — auth is orthogonal to this ticket.
vi.mock('../middleware/authorize.js', () => ({
  requireRole: () => (req, _res, next) => next(),
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
  app.use('/api', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

// Wire the db so effectiveStatusNames() sees the standard project statuses and
// the duplicate SELECT / INSERT / read-back behave realistically.
function wireDb({ existingTransition = null, statuses = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done'] } = {}) {
  all.mockImplementation(async (sql) => {
    if (/FROM issue_statuses/.test(sql)) return statuses.map((name, i) => ({ name, position: i }))
    return []
  })
  get.mockImplementation(async (sql) => {
    if (/SELECT id FROM workflow_transitions WHERE project_id/.test(sql)) return existingTransition
    if (/FROM workflow_transitions WHERE id/.test(sql)) {
      return { id: 99, project_id: 1, from_status: 'To Do', to_status: 'In Progress', validators: [], post_functions: [], created_at: 'now' }
    }
    return null
  })
  run.mockResolvedValue({ lastID: 99, changes: 1 })
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/workflowTransitions.js')
  app = createApp(mod)
})

describe('POST /api/projects/:projectId/workflow-transitions — JL-271 validation', () => {
  it('creates a valid new transition (201) and inserts a row', async () => {
    wireDb({ existingTransition: null })
    const res = await request(app)
      .post('/api/projects/1/workflow-transitions')
      .send({ fromStatus: 'To Do', toStatus: 'In Progress' })

    expect(res.status).toBe(201)
    expect(res.body.fromStatus).toBe('To Do')
    expect(res.body.toStatus).toBe('In Progress')
    expect(run).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO workflow_transitions/),
      expect.arrayContaining([1, 'To Do', 'In Progress']),
    )
  })

  it('rejects a duplicate (projectId, fromStatus, toStatus) with 409', async () => {
    wireDb({ existingTransition: { id: 7 } })
    const res = await request(app)
      .post('/api/projects/1/workflow-transitions')
      .send({ fromStatus: 'To Do', toStatus: 'In Progress' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already exists/i)
    expect(run).not.toHaveBeenCalled() // no insert on duplicate
  })

  it('rejects an invalid status name with 400 naming the offending status', async () => {
    wireDb({ existingTransition: null })
    const res = await request(app)
      .post('/api/projects/1/workflow-transitions')
      .send({ fromStatus: 'To Do', toStatus: 'In Progres' }) // typo

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/In Progres/)
    expect(run).not.toHaveBeenCalled() // no insert on invalid status
  })

  it('still rejects empty / identical statuses (400)', async () => {
    wireDb({ existingTransition: null })
    const r1 = await request(app).post('/api/projects/1/workflow-transitions').send({ fromStatus: '', toStatus: 'Done' })
    expect(r1.status).toBe(400)
    const r2 = await request(app).post('/api/projects/1/workflow-transitions').send({ fromStatus: 'Done', toStatus: 'Done' })
    expect(r2.status).toBe(400)
  })
})
