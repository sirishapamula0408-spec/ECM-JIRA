// @vitest-environment node
// JL-290: the audit-log router used a path-less router.use(requireRole('Admin')).
// Mounted broadly at /api, that gate ran for EVERY request entering the router and
// shadowed later-mounted /api routes (labels, worklogs, attachments, ...), Admin-
// gating them for non-admin members. The fix scopes the gate to '/audit-log'.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { Router } from 'express'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(() => Promise.resolve([])),
  get: vi.fn(() => Promise.resolve(null)),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
}))

import { errorHandler } from '../middleware/errorHandler.js'

// Build an app that reproduces server/index.js mount order: auditLogRoutes at /api,
// FOLLOWED by another /api router (stand-in for labels/worklogs/etc.).
async function createApp(role = 'Member', isOwner = false) {
  const auditMod = await import('../routes/auditLog.js')
  const later = Router()
  // Simulates e.g. PUT /api/issues/:id/labels — reachable by any authenticated user
  // in this stub (the real route has its own project-role gate downstream).
  later.get('/issues/:id/labels', (_req, res) => res.json({ ok: true }))

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { email: `${role}@test.com`, memberId: 2, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api', auditMod.default) // audit-log mounted FIRST (as in index.js)
  app.use('/api', later)            // labels/worklogs/etc. mounted AFTER
  app.use(errorHandler)
  return app
}

beforeEach(() => vi.clearAllMocks())

describe('JL-290: audit-log Admin gate is scoped and does not shadow later /api routes', () => {
  it('lets a non-admin Member reach a later-mounted /api route (not shadowed by the audit gate)', async () => {
    const app = await createApp('Member')
    const res = await request(app).get('/api/issues/5/labels')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('lets a Viewer reach a later-mounted /api route too', async () => {
    const app = await createApp('Viewer')
    const res = await request(app).get('/api/issues/5/labels')
    expect(res.status).toBe(200)
  })

  it('still blocks a non-admin from GET /api/audit-log (Admin-only preserved)', async () => {
    const app = await createApp('Member')
    const res = await request(app).get('/api/audit-log')
    expect(res.status).toBe(403)
  })

  it('still allows an Admin into the audit-log router', async () => {
    const app = await createApp('Admin')
    const res = await request(app).get('/api/audit-log')
    expect(res.status).not.toBe(403)
  })
})
