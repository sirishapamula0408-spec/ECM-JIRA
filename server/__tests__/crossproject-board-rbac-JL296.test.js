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
  withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import router from '../routes/crossProjectBoards.js'

// Build an app whose stubbed user role is configurable per-test. This mirrors
// what `loadUserRoles` sets on req.user in production (workspaceRole/isOwner),
// so the router's `requireRole('Member')` guard runs against real values.
function createApp({ email = 'user@test.com', workspaceRole = 'Viewer', isOwner = false } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email, memberId: 1, workspaceRole, isOwner }
    next()
  })
  app.use('/api/cross-project-boards', router)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('JL-296: cross-project board write RBAC (Member+ required)', () => {
  describe('Viewer is blocked from mutating', () => {
    it('POST / → 403 for a workspace Viewer (handler never runs)', async () => {
      const res = await request(createApp({ workspaceRole: 'Viewer' }))
        .post('/api/cross-project-boards')
        .send({ name: 'Board', projectIds: [], swimlaneBy: 'project' })
      expect(res.status).toBe(403)
      // Guard short-circuits before any DB write.
      expect(run).not.toHaveBeenCalled()
    })

    it('PATCH /:id → 403 for a workspace Viewer', async () => {
      const res = await request(createApp({ workspaceRole: 'Viewer' }))
        .patch('/api/cross-project-boards/1')
        .send({ name: 'x' })
      expect(res.status).toBe(403)
      expect(get).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
    })

    it('DELETE /:id → 403 for a workspace Viewer', async () => {
      const res = await request(createApp({ workspaceRole: 'Viewer' }))
        .delete('/api/cross-project-boards/1')
      expect(res.status).toBe(403)
      expect(run).not.toHaveBeenCalled()
    })
  })

  describe('Viewer can still read', () => {
    it('GET / → 200 for a workspace Viewer', async () => {
      all.mockResolvedValueOnce([
        { id: 1, name: 'B', owner_email: 'user@test.com', project_ids: [1], swimlane_by: 'project', filter: {}, created_at: 'now' },
      ])
      const res = await request(createApp({ workspaceRole: 'Viewer' }))
        .get('/api/cross-project-boards')
      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })

    it('GET /:id → 200 for a Viewer who owns the board', async () => {
      get.mockResolvedValueOnce({ id: 1, name: 'B', owner_email: 'user@test.com', project_ids: [1], swimlane_by: 'project', filter: {}, created_at: 'now' })
      const res = await request(createApp({ workspaceRole: 'Viewer' }))
        .get('/api/cross-project-boards/1')
      expect(res.status).toBe(200)
      expect(res.body.id).toBe(1)
    })
  })

  describe('Member and above can mutate', () => {
    it('POST / → 201 for a workspace Member', async () => {
      get.mockResolvedValueOnce({ id: 1, name: 'Member' }) // member lookup
      all.mockResolvedValueOnce([{ id: 10 }]) // allowed project ids
      run.mockResolvedValueOnce({ lastID: 5 })
      get.mockResolvedValueOnce({ id: 5, name: 'Board', owner_email: 'user@test.com', project_ids: [10], swimlane_by: 'project', filter: {}, created_at: 'now' })

      const res = await request(createApp({ workspaceRole: 'Member' }))
        .post('/api/cross-project-boards')
        .send({ name: 'Board', projectIds: [10], swimlaneBy: 'project' })
      expect(res.status).toBe(201)
      expect(run).toHaveBeenCalled()
    })

    it('PATCH /:id → 200 for a workspace Member who owns the board', async () => {
      get.mockResolvedValueOnce({ id: 1, owner_email: 'user@test.com', name: 'Old', project_ids: [], swimlane_by: 'project', filter: {} })
      run.mockResolvedValueOnce({ changes: 1 })
      get.mockResolvedValueOnce({ id: 1, owner_email: 'user@test.com', name: 'New', project_ids: [], swimlane_by: 'project', filter: {}, created_at: 'now' })

      const res = await request(createApp({ workspaceRole: 'Member' }))
        .patch('/api/cross-project-boards/1')
        .send({ name: 'New' })
      expect(res.status).toBe(200)
      expect(res.body.name).toBe('New')
    })

    it('DELETE /:id → 200 for a workspace Member who owns the board', async () => {
      get.mockResolvedValueOnce({ owner_email: 'user@test.com' })
      run.mockResolvedValueOnce({ changes: 1 })
      const res = await request(createApp({ workspaceRole: 'Member' }))
        .delete('/api/cross-project-boards/1')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('DELETE /:id → 200 for the workspace Owner (bypass)', async () => {
      get.mockResolvedValueOnce({ owner_email: 'user@test.com' })
      run.mockResolvedValueOnce({ changes: 1 })
      const res = await request(createApp({ workspaceRole: 'Viewer', isOwner: true }))
        .delete('/api/cross-project-boards/1')
      expect(res.status).toBe(200)
    })
  })
})
