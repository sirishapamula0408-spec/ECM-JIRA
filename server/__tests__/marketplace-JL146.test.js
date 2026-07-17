import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

import { makeDbMock } from './helpers/mockDb.js'
vi.mock('../db.js', () => makeDbMock())

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import marketplaceRoutes, { validateAppListing } from '../routes/marketplace.js'

// Build an app with a stub auth/role context. `role` controls workspaceRole.
function createApp({ role = 'Admin', isOwner = false, workspaceId = 7 } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner }
    req.workspaceId = workspaceId
    next()
  })
  app.use('/api', marketplaceRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('validateAppListing (pure helper)', () => {
  it('rejects missing key', () => {
    const r = validateAppListing({ name: 'Slack' })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/key is required/)
  })

  it('rejects missing name', () => {
    const r = validateAppListing({ key: 'slack' })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/name is required/)
  })

  it('rejects bad key format (uppercase / spaces / symbols)', () => {
    expect(validateAppListing({ key: 'Slack App', name: 'x' }).ok).toBe(false)
    expect(validateAppListing({ key: 'slack_app', name: 'x' }).ok).toBe(false)
    expect(validateAppListing({ key: 'slack!', name: 'x' }).ok).toBe(false)
  })

  it('accepts a valid slug-like key + name', () => {
    const r = validateAppListing({ key: 'slack-connector', name: 'Slack Connector' })
    expect(r.ok).toBe(true)
    expect(r.errors).toHaveLength(0)
  })
})

describe('GET /api/marketplace/apps — catalog', () => {
  it('returns rows', async () => {
    all.mockResolvedValue([{ id: 1, key: 'slack', name: 'Slack' }])
    const res = await request(createApp()).get('/api/marketplace/apps')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(all).toHaveBeenCalled()
  })

  it('passes search + category params to the query', async () => {
    all.mockResolvedValue([])
    const res = await request(createApp()).get('/api/marketplace/apps?search=chat&category=comms')
    expect(res.status).toBe(200)
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/ILIKE/)
    expect(sql).toMatch(/category = \?/)
    expect(params).toContain('%chat%')
    expect(params).toContain('comms')
  })
})

describe('POST /api/marketplace/apps — register listing', () => {
  it('403 for non-Admin', async () => {
    const res = await request(createApp({ role: 'Member' }))
      .post('/api/marketplace/apps')
      .send({ key: 'slack', name: 'Slack' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('400 on invalid listing', async () => {
    const res = await request(createApp())
      .post('/api/marketplace/apps')
      .send({ key: 'Bad Key', name: '' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('201 creates a listing when Admin + valid', async () => {
    run.mockResolvedValue({ lastID: 42, changes: 1 })
    get.mockResolvedValue({ id: 42, key: 'slack', name: 'Slack' })
    const res = await request(createApp())
      .post('/api/marketplace/apps')
      .send({ key: 'slack', name: 'Slack', category: 'comms' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(42)
    expect(run).toHaveBeenCalled()
  })
})

describe('install / uninstall', () => {
  it('install creates an installed_apps row via ON CONFLICT (idempotent)', async () => {
    get.mockResolvedValueOnce({ id: 5 }) // app exists
    run.mockResolvedValue({ changes: 1 })
    get.mockResolvedValueOnce({ id: 99, app_id: 5, workspace_id: 7, enabled: true })
    const res = await request(createApp())
      .post('/api/marketplace/apps/5/install')
      .send({ config: { token: 'x' } })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(99)
    const [sql] = run.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT/)
  })

  it('install 404 when app missing', async () => {
    get.mockResolvedValueOnce(null)
    const res = await request(createApp()).post('/api/marketplace/apps/5/install').send({})
    expect(res.status).toBe(404)
  })

  it('install 403 for non-Admin', async () => {
    const res = await request(createApp({ role: 'Viewer' })).post('/api/marketplace/apps/5/install').send({})
    expect(res.status).toBe(403)
  })

  it('uninstall deletes the row', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp()).post('/api/marketplace/apps/5/uninstall')
    expect(res.status).toBe(204)
    const [sql] = run.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM installed_apps/)
  })

  it('uninstall 404 when not installed', async () => {
    run.mockResolvedValue({ changes: 0 })
    const res = await request(createApp()).post('/api/marketplace/apps/5/uninstall')
    expect(res.status).toBe(404)
  })
})

describe('GET /api/marketplace/installed', () => {
  it('lists installed apps for the workspace', async () => {
    all.mockResolvedValue([{ id: 99, app_id: 5, enabled: true, key: 'slack' }])
    const res = await request(createApp()).get('/api/marketplace/installed')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })
})

describe('PATCH /api/marketplace/installed/:id', () => {
  it('toggles enabled', async () => {
    get.mockResolvedValueOnce({ id: 99, enabled: true })
    run.mockResolvedValue({ changes: 1 })
    get.mockResolvedValueOnce({ id: 99, enabled: false })
    const res = await request(createApp())
      .patch('/api/marketplace/installed/99')
      .send({ enabled: false })
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
    const [sql] = run.mock.calls[0]
    expect(sql).toMatch(/enabled = \?/)
  })

  it('404 when installed app missing', async () => {
    get.mockResolvedValueOnce(null)
    const res = await request(createApp()).patch('/api/marketplace/installed/99').send({ enabled: false })
    expect(res.status).toBe(404)
  })

  it('403 for non-Admin', async () => {
    const res = await request(createApp({ role: 'Member' })).patch('/api/marketplace/installed/99').send({ enabled: false })
    expect(res.status).toBe(403)
  })
})
