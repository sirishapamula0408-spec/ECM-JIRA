// @vitest-environment node
// JL-316: POST /api/issues/:id/assets and DELETE /api/issues/:id/assets/:assetId
// previously carried no role guard at all, unlike every other asset write.
// They are now gated at requireRole('Member') — NOT Admin — because linking an
// existing asset to an issue is ordinary project work, matching the codebase
// convention for issue-scoped attach/detach routes (PUT /issues/:id/components,
// git-links). Asset catalog CRUD stays Admin-only (asserted in assets-JL142).
// Mocked-db style, modelled on viewer-mutation-gates-JL229.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — no real database is touched (shared helper, JL-178).
import { makeDbMock } from './helpers/mockDb.js'
vi.mock('../db.js', () => makeDbMock())

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import assetRoutes from '../routes/assets.js'

// Build an app with a stubbed authenticated user of the given workspace role.
function createApp(role) {
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

/* ================================================================
   POST /api/issues/:id/assets — link an asset to an issue
   ================================================================ */
describe('JL-316 — issue-asset linking is gated at Member', () => {
  it('Viewer gets 403 linking an asset to an issue', async () => {
    const res = await request(createApp('Viewer')).post('/api/issues/3/assets').send({ assetId: 7 })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/insufficient/i)
    expect(run).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('Member can still link an asset to an issue', async () => {
    get.mockResolvedValue({ id: 7 }) // asset exists
    run.mockResolvedValue({ changes: 1 })
    all.mockResolvedValue([{ id: 7, name: 'Web-01' }])
    const res = await request(createApp('Member')).post('/api/issues/3/assets').send({ assetId: 7 })
    expect(res.status).toBe(201)
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/INSERT INTO issue_assets/i), [3, 7])
    expect(res.body[0].id).toBe(7)
  })

  it('Admin can still link an asset to an issue', async () => {
    get.mockResolvedValue({ id: 7 })
    run.mockResolvedValue({ changes: 1 })
    all.mockResolvedValue([{ id: 7, name: 'Web-01' }])
    const res = await request(createApp('Admin')).post('/api/issues/3/assets').send({ assetId: 7 })
    expect(res.status).toBe(201)
  })
})

/* ================================================================
   DELETE /api/issues/:id/assets/:assetId — unlink an asset
   ================================================================ */
describe('JL-316 — issue-asset unlinking is gated at Member', () => {
  it('Viewer gets 403 unlinking an asset from an issue', async () => {
    const res = await request(createApp('Viewer')).delete('/api/issues/3/assets/7')
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/insufficient/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('Member can still unlink an asset from an issue', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp('Member')).delete('/api/issues/3/assets/7')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(run).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM issue_assets/i), [3, 7])
  })

  it('Admin can still unlink an asset from an issue', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp('Admin')).delete('/api/issues/3/assets/7')
    expect(res.status).toBe(200)
  })
})

/* ================================================================
   Reads stay open — the gate is on writes only
   ================================================================ */
describe('JL-316 — issue-asset reads stay open to Viewers', () => {
  it('Viewer can still LIST an issue\'s linked assets', async () => {
    all.mockResolvedValue([{ id: 7, name: 'Web-01' }])
    const res = await request(createApp('Viewer')).get('/api/issues/3/assets')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })
})
