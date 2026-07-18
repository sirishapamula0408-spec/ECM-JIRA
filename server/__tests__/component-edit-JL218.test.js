import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

/**
 * Build an app with a stubbed auth middleware. `role` controls the workspace
 * role injected onto req.user so requireRole('Admin') can be exercised.
 */
function createApp(routeModule, role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      email: 'test@test.com',
      memberId: 1,
      workspaceRole: role,
      isOwner: false,
    }
    next()
  })
  app.use('/api', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

const EXISTING = { id: 7, project_id: 5, name: 'API', description: 'Backend', lead: 'alice' }

let mod
beforeEach(async () => {
  vi.clearAllMocks()
  mod = await import('../routes/components.js')
})

describe('PATCH /api/projects/:projectId/components/:componentId (JL-218)', () => {
  it('updates name, description and lead and returns the updated component', async () => {
    const app = createApp(mod, 'Admin')
    get
      .mockResolvedValueOnce({ ...EXISTING }) // load existing → found
      .mockResolvedValueOnce(undefined) // duplicate check → none
      .mockResolvedValueOnce({ id: 7, project_id: 5, name: 'Platform API', description: 'Core backend', lead: 'bob', issueCount: 3 }) // reload
    run.mockResolvedValueOnce({ changes: 1 })

    const res = await request(app)
      .patch('/api/projects/5/components/7')
      .send({ name: 'Platform API', description: 'Core backend', lead: 'bob' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: 7,
      projectId: 5,
      name: 'Platform API',
      description: 'Core backend',
      lead: 'bob',
      issueCount: 3,
    })
    expect(run).toHaveBeenCalledWith(
      'UPDATE components SET name = ?, description = ?, lead = ? WHERE id = ? AND project_id = ?',
      ['Platform API', 'Core backend', 'bob', 7, 5],
    )
  })

  it('supports partial updates — omitted fields keep their current values', async () => {
    const app = createApp(mod, 'Admin')
    get
      .mockResolvedValueOnce({ ...EXISTING })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...EXISTING, name: 'Renamed', issueCount: 0 })
    run.mockResolvedValueOnce({ changes: 1 })

    const res = await request(app)
      .patch('/api/projects/5/components/7')
      .send({ name: 'Renamed' })

    expect(res.status).toBe(200)
    // description/lead carried over from the existing row
    expect(run).toHaveBeenCalledWith(
      'UPDATE components SET name = ?, description = ?, lead = ? WHERE id = ? AND project_id = ?',
      ['Renamed', 'Backend', 'alice', 7, 5],
    )
  })

  it('returns 404 when the component does not exist in the project', async () => {
    const app = createApp(mod, 'Admin')
    get.mockResolvedValueOnce(undefined) // load existing → not found

    const res = await request(app)
      .patch('/api/projects/5/components/999')
      .send({ name: 'Whatever' })

    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 409 for a duplicate name within the project (case-insensitive)', async () => {
    const app = createApp(mod, 'Admin')
    get
      .mockResolvedValueOnce({ ...EXISTING })
      .mockResolvedValueOnce({ id: 8 }) // duplicate check → another component has that name

    const res = await request(app)
      .patch('/api/projects/5/components/7')
      .send({ name: 'ui' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already exists/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 400 when the name is set to empty/whitespace', async () => {
    const app = createApp(mod, 'Admin')
    get.mockResolvedValueOnce({ ...EXISTING })

    const res = await request(app)
      .patch('/api/projects/5/components/7')
      .send({ name: '   ' })

    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-admin (Member)', async () => {
    const app = createApp(mod, 'Member')
    const res = await request(app)
      .patch('/api/projects/5/components/7')
      .send({ name: 'Renamed' })

    expect(res.status).toBe(403)
    expect(get).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
