import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// JL-342: DELETE /api/shared-dashboards/:id discarded the `changes` count from
// the DELETE query, so deleting someone else's dashboard (or a non-existent id)
// still reported { success: true }. The UI dropped the row and it reappeared on
// the next refresh. The handler must mirror PATCH /:id: load the row first,
// 404 when missing, 403 when the caller is not the owner — and only then delete.

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

// Parametrized app builder mirroring shared-dashboards-JL287.test.js so we can
// exercise owner vs non-owner (and Admin non-owner) identities.
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

describe('Shared Dashboards — DELETE authorization (JL-342)', () => {
  it('returns 403 for a non-owner and never issues the DELETE query', async () => {
    const app = createApp({ email: OTHER })
    get.mockResolvedValue({
      id: 1, name: 'Owner Dash', owner_email: OWNER, visibility: 'public', layout: [],
    })

    const res = await request(app).delete('/api/1')
    expect(res.status).toBe(403)
    // Same error shape as PATCH /:id so the API stays internally consistent.
    expect(res.body).toEqual({ error: 'Only the owner can delete this dashboard' })
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-existent id and never issues the DELETE query', async () => {
    const app = createApp({ email: OTHER })
    get.mockResolvedValue(null)

    const res = await request(app).delete('/api/999')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Dashboard not found' })
    expect(run).not.toHaveBeenCalled()
  })

  it('lets the owner delete and issues exactly one DELETE query', async () => {
    const app = createApp({ email: OWNER })
    get.mockResolvedValue({
      id: 1, name: 'My Dash', owner_email: OWNER, visibility: 'private', layout: [],
    })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).delete('/api/1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toMatch(/DELETE FROM shared_dashboards/)
    expect(run.mock.calls[0][1]).toContain(1)
  })

  it('gives workspace Admins no bypass — PATCH has none, so DELETE must not either', async () => {
    const app = createApp({ email: OTHER, workspaceRole: 'Admin' })
    get.mockResolvedValue({
      id: 1, name: 'Owner Dash', owner_email: OWNER, visibility: 'public', layout: [],
    })

    const res = await request(app).delete('/api/1')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})
