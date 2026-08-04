import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// JL-364: DELETE /api/notifications/:id discarded the `changes` count from the
// DELETE query, so deleting someone else's notification (or a non-existent id)
// still reported { success: true }. The handler must mirror the JL-342
// shared-dashboards fix: load the row first, then delete only the caller's own.
//
// Deliberate divergence from JL-342: a foreign id returns 404, not 403.
// Notifications are strictly per-user and private (every read endpoint scopes
// to recipient_email), so a 403 would confirm that the probed id exists in
// someone else's inbox. Foreign ids must be indistinguishable from missing ones.

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import notifications from '../routes/notifications.js'

// Parametrized app builder mirroring shared-dashboard-delete-JL342.test.js so
// we can exercise owner vs non-owner identities.
function createApp(user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, memberId: 1, isOwner: false, workspaceRole: 'Member', ...user }
    next()
  })
  app.use('/api', notifications.default || notifications)
  app.use(errorHandler)
  return app
}

const OWNER = 'owner@test.com'
const OTHER = 'other@test.com'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Notifications — DELETE authorization (JL-364)', () => {
  it("returns 404 for another user's notification and never issues the DELETE query", async () => {
    const app = createApp({ email: OTHER })
    get.mockResolvedValue({ id: 1, recipient_email: OWNER })

    const res = await request(app).delete('/api/1')
    // 404, not 403 — a foreign id must look exactly like a missing one so the
    // endpoint never confirms that someone else's notification id exists.
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Notification not found' })
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-existent id and never issues the DELETE query', async () => {
    const app = createApp({ email: OTHER })
    get.mockResolvedValue(null)

    const res = await request(app).delete('/api/999')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Notification not found' })
    expect(run).not.toHaveBeenCalled()
  })

  it('lets the recipient delete their own notification and issues exactly one DELETE query', async () => {
    const app = createApp({ email: OWNER })
    get.mockResolvedValue({ id: 1, recipient_email: OWNER })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).delete('/api/1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toMatch(/DELETE FROM notifications/)
    expect(run.mock.calls[0][1]).toContain(1)
  })

  it('gives workspace Admins no bypass — notifications are personal, not administrable', async () => {
    const app = createApp({ email: OTHER, workspaceRole: 'Admin' })
    get.mockResolvedValue({ id: 1, recipient_email: OWNER })

    const res = await request(app).delete('/api/1')
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('Notifications — mark-read authorization (JL-364)', () => {
  // PATCH /:id/read had the identical discarded-`changes` shape: filtering by
  // recipient_email and reporting success for foreign/missing ids. Same fix,
  // same 404-for-both contract.
  it("returns 404 for another user's notification and never issues the UPDATE", async () => {
    const app = createApp({ email: OTHER })
    get.mockResolvedValue({ id: 1, recipient_email: OWNER })

    const res = await request(app).patch('/api/1/read')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Notification not found' })
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-existent id and never issues the UPDATE', async () => {
    const app = createApp({ email: OTHER })
    get.mockResolvedValue(null)

    const res = await request(app).patch('/api/999/read')
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })

  it('lets the recipient mark their own notification read', async () => {
    const app = createApp({ email: OWNER })
    get.mockResolvedValue({ id: 1, recipient_email: OWNER })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).patch('/api/1/read')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toMatch(/UPDATE notifications SET is_read = TRUE/)
  })
})
