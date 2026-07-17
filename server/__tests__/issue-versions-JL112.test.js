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

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import releaseRoutes from '../routes/releases.js'

// Build an app with a stubbed auth middleware for a given workspace role.
function createApp(role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use('/api', releaseRoutes)
  app.use(errorHandler)
  return app
}

let app
beforeEach(() => {
  vi.clearAllMocks()
  app = createApp('Admin')
})

/* ================================================================
   JL-112 Fix/Affects Versions
   ================================================================ */
describe('Issue Versions API — GET', () => {
  it('returns fix + affects versions grouped by type', async () => {
    get.mockResolvedValue({ id: 7 })
    all.mockResolvedValue([
      { link_id: 1, type: 'fix', id: 10, name: 'v1.0', status: 'unreleased', release_date: '2026-09-01' },
      { link_id: 2, type: 'affects', id: 11, name: 'v0.9', status: 'released', release_date: '2026-01-01' },
      { link_id: 3, type: 'fix', id: 12, name: 'v1.1', status: 'unreleased', release_date: '2026-10-01' },
    ])
    const res = await request(app).get('/api/issues/7/versions')
    expect(res.status).toBe(200)
    expect(res.body.issueId).toBe(7)
    expect(res.body.fix).toHaveLength(2)
    expect(res.body.affects).toHaveLength(1)
    expect(res.body.fix.map((v) => v.id)).toEqual([10, 12])
    expect(res.body.affects[0].name).toBe('v0.9')
  })

  it('404s when the issue does not exist', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).get('/api/issues/999/versions')
    expect(res.status).toBe(404)
  })
})

describe('Issue Versions API — PUT (replace-all)', () => {
  it('inserts the right rows with correct type', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM issues')) return { id: 7, project_id: 1 }
      if (sql.includes('FROM releases')) return { id: 1, project_id: 1 }
      return null
    })
    run.mockResolvedValue({ changes: 1, lastID: 1 })

    const res = await request(app)
      .put('/api/issues/7/versions')
      .send({ fix: [10, 11], affects: [20] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ issueId: 7, fix: [10, 11], affects: [20] })

    // One DELETE (replace-all) + three INSERTs
    const deleteCalls = run.mock.calls.filter((c) => c[0].includes('DELETE FROM issue_versions'))
    const insertCalls = run.mock.calls.filter((c) => c[0].includes('INSERT INTO issue_versions'))
    expect(deleteCalls).toHaveLength(1)
    expect(insertCalls).toHaveLength(3)
    // Verify the type argument is correct per row
    expect(insertCalls[0][1]).toEqual([7, 10, 'fix'])
    expect(insertCalls[1][1]).toEqual([7, 11, 'fix'])
    expect(insertCalls[2][1]).toEqual([7, 20, 'affects'])
  })

  it('clears all versions when given empty arrays', async () => {
    get.mockResolvedValue({ id: 7, project_id: 1 })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).put('/api/issues/7/versions').send({ fix: [], affects: [] })
    expect(res.status).toBe(200)
    const insertCalls = run.mock.calls.filter((c) => c[0].includes('INSERT INTO issue_versions'))
    expect(insertCalls).toHaveLength(0)
    const deleteCalls = run.mock.calls.filter((c) => c[0].includes('DELETE FROM issue_versions'))
    expect(deleteCalls).toHaveLength(1)
  })

  it('deduplicates repeated version ids within a type', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM issues')) return { id: 7, project_id: 1 }
      if (sql.includes('FROM releases')) return { id: 1, project_id: 1 }
      return null
    })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).put('/api/issues/7/versions').send({ fix: [10, 10, 10] })
    expect(res.status).toBe(200)
    const insertCalls = run.mock.calls.filter((c) => c[0].includes('INSERT INTO issue_versions'))
    expect(insertCalls).toHaveLength(1)
  })

  it('rejects an invalid version type key', async () => {
    get.mockResolvedValue({ id: 7, project_id: 1 })
    const res = await request(app).put('/api/issues/7/versions').send({ fix: [10], affect: [20] })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a non-array value', async () => {
    get.mockResolvedValue({ id: 7, project_id: 1 })
    const res = await request(app).put('/api/issues/7/versions').send({ fix: 10 })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an invalid (non-positive) version id', async () => {
    get.mockResolvedValue({ id: 7, project_id: 1 })
    const res = await request(app).put('/api/issues/7/versions').send({ fix: [0] })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('404s when a referenced version does not exist', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM issues')) return { id: 7, project_id: 1 }
      if (sql.includes('FROM releases')) return null
      return null
    })
    const res = await request(app).put('/api/issues/7/versions').send({ fix: [999] })
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a cross-project version', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM issues')) return { id: 7, project_id: 1 }
      if (sql.includes('FROM releases')) return { id: 10, project_id: 99 }
      return null
    })
    const res = await request(app).put('/api/issues/7/versions').send({ fix: [10] })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('404s when the issue does not exist', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).put('/api/issues/999/versions').send({ fix: [10] })
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })

  it('forbids a Viewer from writing (consistent with other issue writes)', async () => {
    const viewerApp = createApp('Viewer')
    const res = await request(viewerApp).put('/api/issues/7/versions').send({ fix: [10] })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})
