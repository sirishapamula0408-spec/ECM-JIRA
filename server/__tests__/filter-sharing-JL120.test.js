import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import filterRoutes from '../routes/filters.js'

const OWNER = 'owner@test.com'
const OTHER = 'other@test.com'

// Build an app with a stubbed auth middleware for a given user email.
function createApp(email = OWNER) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email }
    next()
  })
  app.use('/api/filters', filterRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Create — visibility validation
   ================================================================ */
describe('POST /api/filters — visibility validation', () => {
  it('rejects an invalid visibility value with 400', async () => {
    const res = await request(createApp())
      .post('/api/filters')
      .send({ name: 'Bad', visibility: 'public' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('accepts a valid shared visibility and persists it', async () => {
    run.mockResolvedValue({ lastID: 5 })
    get.mockResolvedValue({
      id: 5, name: 'Shared one', description: '', owner_email: OWNER,
      criteria: {}, is_starred: false, visibility: 'shared',
    })
    const res = await request(createApp())
      .post('/api/filters')
      .send({ name: 'Shared one', visibility: 'shared' })
    expect(res.status).toBe(201)
    expect(res.body.visibility).toBe('shared')
    expect(res.body.isOwner).toBe(true)
    // visibility param passed through to INSERT
    const insertArgs = run.mock.calls[0]
    expect(insertArgs[0]).toContain('visibility')
    expect(insertArgs[1]).toContain('shared')
  })

  it('defaults visibility to private when omitted', async () => {
    run.mockResolvedValue({ lastID: 6 })
    get.mockResolvedValue({
      id: 6, name: 'Def', description: '', owner_email: OWNER,
      criteria: {}, is_starred: false, visibility: 'private',
    })
    const res = await request(createApp())
      .post('/api/filters')
      .send({ name: 'Def' })
    expect(res.status).toBe(201)
    expect(run.mock.calls[0][1]).toContain('private')
  })
})

/* ================================================================
   List — own + shared (not others' private)
   ================================================================ */
describe('GET /api/filters — own + shared', () => {
  it("queries for own filters plus shared ones and maps ownership/favourite", async () => {
    all.mockResolvedValue([
      { id: 1, name: 'Mine', description: '', owner_email: OWNER, criteria: {}, is_starred: false, visibility: 'private', is_favorite: true },
      { id: 2, name: 'Theirs shared', description: '', owner_email: OTHER, criteria: {}, is_starred: false, visibility: 'shared', is_favorite: false },
    ])
    const res = await request(createApp(OWNER)).get('/api/filters')
    expect(res.status).toBe(200)
    // SQL restricts to owner OR shared — never others' private
    const sql = all.mock.calls[0][0]
    expect(sql).toContain("visibility = 'shared'")
    expect(sql).toContain('owner_email')

    expect(res.body).toHaveLength(2)
    const mine = res.body.find((f) => f.id === 1)
    const theirs = res.body.find((f) => f.id === 2)
    expect(mine.isOwner).toBe(true)
    expect(mine.isFavorite).toBe(true)
    expect(theirs.isOwner).toBe(false)
    expect(theirs.visibility).toBe('shared')
    expect(theirs.isFavorite).toBe(false)
  })
})

/* ================================================================
   Favourite toggle — insert then delete
   ================================================================ */
describe('POST /api/filters/:id/favorite — toggle', () => {
  it('inserts a favourite when none exists (isFavorite true)', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM filters')) return { id: 3, owner_email: OWNER, visibility: 'private' }
      if (sql.includes('filter_favorites')) return null // no existing favourite
      return null
    })
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(createApp(OWNER)).post('/api/filters/3/favorite')
    expect(res.status).toBe(200)
    expect(res.body.isFavorite).toBe(true)
    expect(run.mock.calls[0][0]).toContain('INSERT INTO filter_favorites')
  })

  it('deletes an existing favourite (isFavorite false)', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM filters')) return { id: 3, owner_email: OWNER, visibility: 'private' }
      if (sql.includes('filter_favorites')) return { id: 99 } // existing favourite
      return null
    })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp(OWNER)).post('/api/filters/3/favorite')
    expect(res.status).toBe(200)
    expect(res.body.isFavorite).toBe(false)
    expect(run.mock.calls[0][0]).toContain('DELETE FROM filter_favorites')
  })

  it('lets a user favourite a shared filter owned by someone else', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM filters')) return { id: 4, owner_email: OTHER, visibility: 'shared' }
      if (sql.includes('filter_favorites')) return null
      return null
    })
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(createApp(OWNER)).post('/api/filters/4/favorite')
    expect(res.status).toBe(200)
    expect(res.body.isFavorite).toBe(true)
  })
})

/* ================================================================
   Owner-only guards — non-owner edit/delete/visibility → 403
   ================================================================ */
describe('Owner-only guards', () => {
  it('403s when a non-owner tries to edit', async () => {
    get.mockResolvedValue({ id: 1, owner_email: OTHER, visibility: 'shared', name: 'x', criteria: {}, is_starred: false })
    const res = await request(createApp(OWNER))
      .put('/api/filters/1')
      .send({ name: 'Hacked' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('403s when a non-owner tries to change visibility', async () => {
    get.mockResolvedValue({ id: 1, owner_email: OTHER, visibility: 'shared', name: 'x', criteria: {}, is_starred: false })
    const res = await request(createApp(OWNER))
      .put('/api/filters/1')
      .send({ visibility: 'private' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('403s when a non-owner tries to delete', async () => {
    get.mockResolvedValue({ id: 1, owner_email: OTHER, visibility: 'shared' })
    const res = await request(createApp(OWNER)).delete('/api/filters/1')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('allows the owner to change visibility', async () => {
    get.mockResolvedValueOnce({ id: 1, owner_email: OWNER, visibility: 'private', name: 'x', criteria: {}, is_starred: false })
    run.mockResolvedValue({ changes: 1 })
    get.mockResolvedValueOnce({ id: 1, owner_email: OWNER, visibility: 'shared', name: 'x', criteria: {}, is_starred: false })
    const res = await request(createApp(OWNER))
      .put('/api/filters/1')
      .send({ visibility: 'shared' })
    expect(res.status).toBe(200)
    expect(res.body.visibility).toBe('shared')
    expect(run).toHaveBeenCalled()
  })

  it('rejects an invalid visibility on update with 400', async () => {
    get.mockResolvedValue({ id: 1, owner_email: OWNER, visibility: 'private', name: 'x', criteria: {}, is_starred: false })
    const res = await request(createApp(OWNER))
      .put('/api/filters/1')
      .send({ visibility: 'nope' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})
