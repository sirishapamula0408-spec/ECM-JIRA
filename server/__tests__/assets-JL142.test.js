// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — no real database is touched.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import assetRoutes, { validateAssetPayload, ASSET_STATUSES } from '../routes/assets.js'

// Build an app with a stubbed authenticated user of the given workspace role.
function createApp(role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use('/api', assetRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ==================== validateAssetPayload (pure) ==================== */
describe('validateAssetPayload', () => {
  const known = [1, 2, 3]

  it('rejects a missing name', () => {
    const { ok, errors } = validateAssetPayload({ asset_type_id: 1 }, known)
    expect(ok).toBe(false)
    expect(errors.join(' ')).toMatch(/name is required/i)
  })

  it('rejects an unknown asset type', () => {
    const { ok, errors } = validateAssetPayload({ name: 'Web-01', asset_type_id: 99 }, known)
    expect(ok).toBe(false)
    expect(errors.join(' ')).toMatch(/asset_type/i)
  })

  it('rejects a bad status', () => {
    const { ok, errors } = validateAssetPayload({ name: 'Web-01', asset_type_id: 1, status: 'exploded' }, known)
    expect(ok).toBe(false)
    expect(errors.join(' ')).toMatch(/status/i)
  })

  it('accepts a valid payload', () => {
    const { ok, errors } = validateAssetPayload({ name: 'Web-01', asset_type_id: 1, status: 'active' }, known)
    expect(ok).toBe(true)
    expect(errors).toHaveLength(0)
  })

  it('accepts a valid payload with no status (defaults later)', () => {
    const { ok } = validateAssetPayload({ name: 'Web-01', assetTypeId: 2 }, known)
    expect(ok).toBe(true)
  })

  it('exposes the allowed status set', () => {
    expect(ASSET_STATUSES).toContain('active')
    expect(ASSET_STATUSES).toContain('retired')
  })
})

/* ============================ Asset types =========================== */
describe('Asset types', () => {
  it('GET /api/asset-types returns rows', async () => {
    all.mockResolvedValue([{ id: 1, name: 'Server', icon: '', assetCount: 2 }])
    const res = await request(createApp()).get('/api/asset-types')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Server')
  })

  it('POST /api/asset-types creates a type as Admin (run called)', async () => {
    run.mockResolvedValue({ lastID: 5 })
    get.mockResolvedValue({ id: 5, name: 'Laptop', icon: '' })
    const res = await request(createApp('Admin')).post('/api/asset-types').send({ name: 'Laptop' })
    expect(res.status).toBe(201)
    expect(run).toHaveBeenCalled()
    expect(res.body.id).toBe(5)
  })

  it('POST /api/asset-types → 403 for a non-admin (Member)', async () => {
    const res = await request(createApp('Member')).post('/api/asset-types').send({ name: 'Laptop' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('POST /api/asset-types → 400 when name missing', async () => {
    const res = await request(createApp('Admin')).post('/api/asset-types').send({})
    expect(res.status).toBe(400)
  })
})

/* ============================== Assets ============================== */
describe('Assets CRUD', () => {
  it('GET /api/assets returns a list of rows', async () => {
    all.mockResolvedValue([
      { id: 1, name: 'Web-01', asset_type_id: 1, status: 'active', attributes: {} },
    ])
    const res = await request(createApp()).get('/api/assets?search=web&type=1')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Web-01')
  })

  it('POST /api/assets creates an asset (run called)', async () => {
    all.mockResolvedValue([{ id: 1 }, { id: 2 }]) // known asset types
    run.mockResolvedValue({ lastID: 10 })
    get.mockResolvedValue({ id: 10, name: 'Web-01', asset_type_id: 1, status: 'active', attributes: {} })
    const res = await request(createApp()).post('/api/assets').send({ name: 'Web-01', asset_type_id: 1 })
    expect(res.status).toBe(201)
    expect(run).toHaveBeenCalled()
    expect(res.body.id).toBe(10)
  })

  it('POST /api/assets → 400 on unknown asset type', async () => {
    all.mockResolvedValue([{ id: 1 }, { id: 2 }])
    const res = await request(createApp()).post('/api/assets').send({ name: 'Web-01', asset_type_id: 99 })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('PATCH /api/assets/:id updates an existing asset', async () => {
    get
      .mockResolvedValueOnce({ id: 10, name: 'Web-01', status: 'active' }) // existing
      .mockResolvedValueOnce({ id: 10, name: 'Web-01', status: 'retired' }) // re-read
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp()).patch('/api/assets/10').send({ status: 'retired' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('retired')
  })

  it('PATCH /api/assets/:id → 400 on bad status', async () => {
    get.mockResolvedValue({ id: 10, name: 'Web-01', status: 'active' })
    const res = await request(createApp()).patch('/api/assets/10').send({ status: 'nope' })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/assets/:id deletes (run called)', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp()).delete('/api/assets/10')
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM assets/i), [10])
  })
})

/* ==================== Issue <-> Asset linking ====================== */
describe('Issue-asset linking', () => {
  it('POST /api/issues/:id/assets links an asset (insert)', async () => {
    get.mockResolvedValue({ id: 7 }) // asset exists
    run.mockResolvedValue({ changes: 1 })
    all.mockResolvedValue([{ id: 7, name: 'Web-01' }])
    const res = await request(createApp()).post('/api/issues/3/assets').send({ assetId: 7 })
    expect(res.status).toBe(201)
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO issue_assets/i), [3, 7])
    expect(res.body[0].id).toBe(7)
  })

  it('POST /api/issues/:id/assets → 404 when asset does not exist', async () => {
    get.mockResolvedValue(null)
    const res = await request(createApp()).post('/api/issues/3/assets').send({ assetId: 999 })
    expect(res.status).toBe(404)
  })

  it('GET /api/issues/:id/assets lists linked assets', async () => {
    all.mockResolvedValue([{ id: 7, name: 'Web-01' }])
    const res = await request(createApp()).get('/api/issues/3/assets')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('DELETE /api/issues/:id/assets/:assetId unlinks (delete)', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp()).delete('/api/issues/3/assets/7')
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM issue_assets/i), [3, 7])
  })
})
