import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// JL-287: POST / (create) and POST /:id/clone had no role gate, and clone had
// no owner-or-public visibility check (unlike GET /:id), so any authenticated
// user could clone someone else's PRIVATE dashboard and read its layout.

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import sharedDashboards from '../routes/shared-dashboards.js'

// Build an app stubbed with a given user identity/role, mirroring the
// createApp() helper used in collaboration-modules.test.js but parametrized
// so we can exercise Member vs Viewer role gating.
function createApp(user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, memberId: 1, isOwner: false, workspaceRole: 'Member', ...user }
    next()
  })
  app.use('/api', sharedDashboards.default || sharedDashboards)
  app.use(errorHandler)
  return app
}

const OWNER = 'owner@test.com'
const OTHER = 'other@test.com'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Shared Dashboards — role gating and clone visibility (JL-287)', () => {
  describe('POST /api — create requires Member+', () => {
    it('rejects a Viewer', async () => {
      const app = createApp({ email: OTHER, workspaceRole: 'Viewer' })
      const res = await request(app).post('/api').send({ name: 'New Dashboard' })
      expect(res.status).toBe(403)
      expect(run).not.toHaveBeenCalled()
    })

    it('allows a Member', async () => {
      const app = createApp({ email: OTHER, workspaceRole: 'Member' })
      run.mockResolvedValue({ lastID: 1 })
      get.mockResolvedValue({ id: 1, name: 'New Dashboard', owner_email: OTHER })

      const res = await request(app).post('/api').send({ name: 'New Dashboard' })
      expect(res.status).toBe(201)
    })
  })

  describe('POST /api/:id/clone — requires Member+', () => {
    it('rejects a Viewer before ever loading the dashboard', async () => {
      const app = createApp({ email: OTHER, workspaceRole: 'Viewer' })
      const res = await request(app).post('/api/1/clone')
      expect(res.status).toBe(403)
      expect(get).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/:id/clone — owner-or-public visibility (mirrors GET /:id)', () => {
    it('rejects cloning a PRIVATE dashboard owned by someone else', async () => {
      const app = createApp({ email: OTHER, workspaceRole: 'Member' })
      get.mockResolvedValue({
        id: 1, name: 'Private Dash', owner_email: OWNER, visibility: 'private', layout: [],
      })

      const res = await request(app).post('/api/1/clone')
      expect(res.status).toBe(403)
      expect(run).not.toHaveBeenCalled()
    })

    it('returns 404 when the dashboard does not exist', async () => {
      const app = createApp({ email: OTHER, workspaceRole: 'Member' })
      get.mockResolvedValue(null)

      const res = await request(app).post('/api/999/clone')
      expect(res.status).toBe(404)
    })

    it('allows cloning a PUBLIC dashboard owned by someone else', async () => {
      const app = createApp({ email: OTHER, workspaceRole: 'Member' })
      get
        .mockResolvedValueOnce({
          id: 1, name: 'Public Dash', owner_email: OWNER, visibility: 'public',
          project_id: null, description: '', layout: [{ w: 1 }],
        })
        .mockResolvedValueOnce({
          id: 2, name: 'Public Dash (Copy)', owner_email: OTHER, visibility: 'private',
        })
      run.mockResolvedValue({ lastID: 2 })

      const res = await request(app).post('/api/1/clone')
      expect(res.status).toBe(201)
      expect(run).toHaveBeenCalledTimes(1)
      // Clone always lands as private under the cloning user, regardless of source visibility.
      expect(run.mock.calls[0][1]).toContain('private')
      expect(run.mock.calls[0][1]).toContain(OTHER)
    })

    it('allows cloning your own PRIVATE dashboard', async () => {
      const app = createApp({ email: OWNER, workspaceRole: 'Member' })
      get
        .mockResolvedValueOnce({
          id: 1, name: 'My Dash', owner_email: OWNER, visibility: 'private',
          project_id: null, description: '', layout: [],
        })
        .mockResolvedValueOnce({
          id: 2, name: 'My Dash (Copy)', owner_email: OWNER, visibility: 'private',
        })
      run.mockResolvedValue({ lastID: 2 })

      const res = await request(app).post('/api/1/clone')
      expect(res.status).toBe(201)
    })

    it('workspace Owner bypasses the role gate but still respects clone visibility', async () => {
      const app = createApp({ email: 'boss@test.com', isOwner: true, workspaceRole: 'Viewer' })
      get.mockResolvedValue({
        id: 1, name: 'Private Dash', owner_email: OWNER, visibility: 'private', layout: [],
      })

      const res = await request(app).post('/api/1/clone')
      // requireRole('Member') passes (isOwner bypass), but the handler's
      // owner-or-public visibility check still blocks the clone.
      expect(res.status).toBe(403)
      expect(run).not.toHaveBeenCalled()
    })
  })
})
