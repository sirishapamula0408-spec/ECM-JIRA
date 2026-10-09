/* ================================================================
   JL-188 (fosasoft) — deleting and restoring a page respect the same
   visibility rule as reading it: another author's draft is 404, live or
   deleted, so its existence is not disclosed and it cannot be removed or
   resurrected by anyone else.
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const db = { run: vi.fn(), get: vi.fn(), all: vi.fn(), tableExists: vi.fn(), columnExists: vi.fn(), withTransaction: vi.fn() }
vi.mock('../db.js', () => db)
vi.mock('../middleware/authorize.js', () => ({
  requireRole: () => (req, _res, next) => next(),
  loadProjectRole: () => (req, _res, next) => next(),
  requireProjectRole: () => (req, _res, next) => next(),
  loadUserRoles: (req, _res, next) => next(),
}))
vi.mock('../services/auditLog.js', () => ({ safeAppendAudit: vi.fn() }))

const AUTHOR = 'author@x.com'
const OTHER = 'someone@x.com'
const page = (over = {}) => ({
  id: 1, project_id: null, space_id: 7, title: 'Runbook', parent_id: null,
  status: 'published', archived: false, deleted_at: null, deleted_by: null,
  created_by: AUTHOR, updated_by: AUTHOR,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...over,
})

async function buildApp(email = AUTHOR) {
  const mod = await import('../routes/wiki.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { id: 1, email, workspaceRole: 'Member' }; next() })
  app.use('/', mod.default)
  return app
}

const softDeletes = () => db.run.mock.calls.filter((c) => /SET deleted_at = NOW\(\)/.test(c[0]))

beforeEach(() => {
  vi.clearAllMocks()
  db.all.mockResolvedValue([])
  db.run.mockResolvedValue({ lastID: 1, changes: 1 })
})

describe('JL-188 DELETE /:id', () => {
  it('moves a published page to the trash and promotes its children', async () => {
    db.get.mockResolvedValue(page())
    const res = await request(await buildApp(OTHER)).delete('/1')
    expect(res.status).toBe(200)
    expect(softDeletes()).toHaveLength(1)
    expect(db.run.mock.calls.some((c) => /SET parent_id = NULL WHERE parent_id = \?/.test(c[0]))).toBe(true)
  })

  it('lets the author delete their own draft', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp()).delete('/1')
    expect(res.status).toBe(200)
    expect(softDeletes()).toHaveLength(1)
  })

  it('404s someone else deleting that draft, and writes nothing', async () => {
    db.get.mockResolvedValue(page({ status: 'draft' }))
    const res = await request(await buildApp(OTHER)).delete('/1')
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('404s a page already in the trash rather than re-stamping who deleted it', async () => {
    db.get.mockResolvedValue(page({ deleted_at: '2026-10-01T00:00:00Z', deleted_by: AUTHOR }))
    const res = await request(await buildApp(OTHER)).delete('/1')
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })
})

describe('JL-188 POST /:id/restore', () => {
  it('restores a page from the trash', async () => {
    db.get.mockResolvedValueOnce(page({ deleted_at: '2026-10-01T00:00:00Z' })).mockResolvedValue(page())
    const res = await request(await buildApp(OTHER)).post('/1/restore')
    expect(res.status).toBe(200)
    expect(db.run.mock.calls.some((c) => /SET deleted_at = NULL/.test(c[0]))).toBe(true)
  })

  it('404s someone else restoring a deleted draft', async () => {
    db.get.mockResolvedValue(page({ status: 'draft', deleted_at: '2026-10-01T00:00:00Z' }))
    const res = await request(await buildApp(OTHER)).post('/1/restore')
    expect(res.status).toBe(404)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('still refuses a page that is not in the trash', async () => {
    db.get.mockResolvedValue(page())
    const res = await request(await buildApp()).post('/1/restore')
    expect(res.status).toBe(409)
  })
})
