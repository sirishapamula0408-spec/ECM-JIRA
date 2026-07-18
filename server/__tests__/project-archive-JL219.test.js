import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Build an app with a stubbed authenticated user. Defaults mirror the JL-197/JL-213
// harness: workspaceRole 'Admin' bypasses requireProjectRole; override per-test.
function createApp(routeModule, user = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      email: 'admin@test.com',
      memberId: null,
      workspaceRole: 'Admin',
      isOwner: false,
      ...user,
    }
    next()
  })
  app.use('/api/projects', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let mod
beforeEach(async () => {
  vi.clearAllMocks()
  mod = await import('../routes/projects.js')
})

describe('JL-219 — POST /api/projects/:id/archive', () => {
  it('sets archived_at and returns the archived project (workspace Admin)', async () => {
    const app = createApp(mod)
    get
      .mockResolvedValueOnce({ id: 7, name: 'Apollo', archived_at: null }) // existence check
      .mockResolvedValueOnce({ id: 7, name: 'Apollo', archived_at: '2026-07-18T00:00:00Z', archived: true }) // reload
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).post('/api/projects/7/archive')
    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(true)

    const archiveUpdate = run.mock.calls.find((c) => /UPDATE projects SET archived_at = NOW\(\)/i.test(c[0]))
    expect(archiveUpdate).toBeTruthy()
    expect(archiveUpdate[1]).toEqual([7])
  })

  it('returns 404 when the project does not exist', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce(undefined)

    const res = await request(app).post('/api/projects/999/archive')
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalledWith(expect.stringMatching(/archived_at = NOW/i), expect.anything())
  })

  it('rejects a non-admin (project Viewer/Member) with 403', async () => {
    const app = createApp(mod, { workspaceRole: 'Member', memberId: 5, isOwner: false })
    // loadProjectRole looks up the project role → none → requireProjectRole 403
    get.mockResolvedValueOnce(undefined)

    const res = await request(app).post('/api/projects/7/archive')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalledWith(expect.stringMatching(/archived_at = NOW/i), expect.anything())
  })
})

describe('JL-219 — POST /api/projects/:id/unarchive', () => {
  it('clears archived_at and returns the restored project', async () => {
    const app = createApp(mod)
    get
      .mockResolvedValueOnce({ id: 7, name: 'Apollo', archived_at: '2026-07-18T00:00:00Z' })
      .mockResolvedValueOnce({ id: 7, name: 'Apollo', archived_at: null, archived: false })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).post('/api/projects/7/unarchive')
    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(false)

    const clearUpdate = run.mock.calls.find((c) => /UPDATE projects SET archived_at = NULL/i.test(c[0]))
    expect(clearUpdate).toBeTruthy()
    expect(clearUpdate[1]).toEqual([7])
  })

  it('rejects a non-admin with 403', async () => {
    const app = createApp(mod, { workspaceRole: 'Viewer', memberId: 5, isOwner: false })
    get.mockResolvedValueOnce(undefined)

    const res = await request(app).post('/api/projects/7/unarchive')
    expect(res.status).toBe(403)
  })
})

describe('JL-219 — GET /api/projects archived filter', () => {
  it('excludes archived projects by default (archived_at IS NULL clause)', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({ id: 5, name: 'Admin User' }) // member lookup
    all.mockResolvedValueOnce([{ id: 1, name: 'Active', archived: false }])

    const res = await request(app).get('/api/projects')
    expect(res.status).toBe(200)

    const listCall = all.mock.calls[0]
    expect(listCall[0]).toMatch(/archived_at IS NULL/i)
  })

  it('includes archived projects when ?includeArchived=true (no archived filter)', async () => {
    const app = createApp(mod)
    get.mockResolvedValueOnce({ id: 5, name: 'Admin User' })
    all.mockResolvedValueOnce([
      { id: 1, name: 'Active', archived: false },
      { id: 2, name: 'Retired', archived: true },
    ])

    const res = await request(app).get('/api/projects?includeArchived=true')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)

    const listCall = all.mock.calls[0]
    expect(listCall[0]).not.toMatch(/archived_at IS NULL/i)
    // the computed archived flag is always projected
    expect(listCall[0]).toMatch(/archived_at IS NOT NULL\) AS archived/i)
  })
})
