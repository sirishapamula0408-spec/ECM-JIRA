import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// JL-211 — configurable "Create project" workspace permission.
// Mock the db module used by both projects.js and workspaceSettings.js.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get, getSetting, setSetting } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Build an app that mounts a router with an injected req.user (workspace role).
function createApp(routeModule, mountPath, user) {
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

const MEMBER = { id: 1, email: 'member@test.com', memberId: 1, workspaceRole: 'Member', isOwner: false }
const ADMIN = { id: 2, email: 'admin@test.com', memberId: 2, workspaceRole: 'Admin', isOwner: false }
const OWNER = { id: 3, email: 'owner@test.com', memberId: 3, workspaceRole: 'Member', isOwner: true }

const VALID_BODY = { name: 'New Project', key: 'NP', type: 'Scrum', lead: 'Alice' }

let projectsMod
let workspaceSettingsMod
beforeEach(async () => {
  vi.clearAllMocks()
  projectsMod = await import('../routes/projects.js')
  workspaceSettingsMod = await import('../routes/workspaceSettings.js')
  // Default DB behaviour for a successful project insert.
  get.mockResolvedValue({ id: 1 }) // member lookup
  run.mockResolvedValue({ lastID: 42, changes: 1 })
})

describe('JL-211 — POST /api/projects creation policy enforcement', () => {
  describe("policy 'admins_only'", () => {
    beforeEach(() => getSetting.mockResolvedValue('admins_only'))

    it('rejects a workspace Member with 403', async () => {
      const app = createApp(projectsMod, '/api/projects', MEMBER)
      const res = await request(app).post('/api/projects').send(VALID_BODY)
      expect(res.status).toBe(403)
      expect(run).not.toHaveBeenCalled()
    })

    it('allows a workspace Admin', async () => {
      const app = createApp(projectsMod, '/api/projects', ADMIN)
      const res = await request(app).post('/api/projects').send(VALID_BODY)
      expect(res.status).toBe(201)
      expect(res.body.key).toBe('NP')
    })

    it('always allows the Owner (even with Member workspace role)', async () => {
      const app = createApp(projectsMod, '/api/projects', OWNER)
      const res = await request(app).post('/api/projects').send(VALID_BODY)
      expect(res.status).toBe(201)
    })
  })

  describe("policy 'all_members' (default)", () => {
    beforeEach(() => getSetting.mockResolvedValue('all_members'))

    it('allows a workspace Member', async () => {
      const app = createApp(projectsMod, '/api/projects', MEMBER)
      const res = await request(app).post('/api/projects').send(VALID_BODY)
      expect(res.status).toBe(201)
      expect(res.body.key).toBe('NP')
    })

    it('rejects a workspace Viewer with 403', async () => {
      const app = createApp(projectsMod, '/api/projects', { ...MEMBER, workspaceRole: 'Viewer' })
      const res = await request(app).post('/api/projects').send(VALID_BODY)
      expect(res.status).toBe(403)
    })
  })

  it('defaults to all_members when the setting is unset (fallback preserves legacy behaviour)', async () => {
    // getSetting returns its fallback arg when unset — simulate by echoing it.
    getSetting.mockImplementation(async (_key, fallback) => fallback)
    const app = createApp(projectsMod, '/api/projects', MEMBER)
    const res = await request(app).post('/api/projects').send(VALID_BODY)
    expect(res.status).toBe(201)
  })
})

describe('JL-211 — workspace settings endpoints', () => {
  it('GET /api/workspace/settings returns the effective policy', async () => {
    getSetting.mockResolvedValue('admins_only')
    const app = createApp(workspaceSettingsMod, '/api/workspace', MEMBER)
    const res = await request(app).get('/api/workspace/settings')
    expect(res.status).toBe(200)
    expect(res.body.project_creation_policy).toBe('admins_only')
  })

  it('PUT /api/workspace/settings rejects a workspace Member (Admin-only)', async () => {
    const app = createApp(workspaceSettingsMod, '/api/workspace', MEMBER)
    const res = await request(app)
      .put('/api/workspace/settings')
      .send({ project_creation_policy: 'admins_only' })
    expect(res.status).toBe(403)
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('PUT /api/workspace/settings allows an Admin and persists the value', async () => {
    const app = createApp(workspaceSettingsMod, '/api/workspace', ADMIN)
    const res = await request(app)
      .put('/api/workspace/settings')
      .send({ project_creation_policy: 'admins_only' })
    expect(res.status).toBe(200)
    expect(res.body.project_creation_policy).toBe('admins_only')
    expect(setSetting).toHaveBeenCalledWith('project_creation_policy', 'admins_only')
  })

  it('PUT rejects an invalid policy value with 400', async () => {
    const app = createApp(workspaceSettingsMod, '/api/workspace', ADMIN)
    const res = await request(app)
      .put('/api/workspace/settings')
      .send({ project_creation_policy: 'nobody' })
    expect(res.status).toBe(400)
    expect(setSetting).not.toHaveBeenCalled()
  })
})
