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

// Mock notifications helper imported by the comments route
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, createNotification: vi.fn().mockResolvedValue(1) }
})

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import commentRoutes, { REACTION_EMOJIS } from '../routes/comments.js'

// Mount the comments router at /api/comments (matching server/index.js) with a
// stubbed authenticated user.
function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'me@test.com', workspaceRole: 'Admin' }
    next()
  })
  app.use('/api/comments', commentRoutes)
  app.use('/api/issues', commentRoutes)
  app.use(errorHandler)
  return app
}

let app
beforeEach(() => {
  vi.clearAllMocks()
  app = createApp()
})

describe('JL-139 — Comment reactions', () => {
  describe('POST /api/comments/:id/reactions — toggle', () => {
    it('adds a reaction when none exists yet', async () => {
      get
        .mockResolvedValueOnce({ id: 5 }) // comment exists
        .mockResolvedValueOnce(null) // no existing reaction
      run.mockResolvedValue({ lastID: 1, changes: 1 })
      // aggregated summary after insert
      all.mockResolvedValue([{ comment_id: 5, emoji: '👍', count: '1', mine: '1' }])

      const res = await request(app).post('/api/comments/5/reactions').send({ emoji: '👍' })

      expect(res.status).toBe(200)
      expect(res.body.commentId).toBe(5)
      expect(res.body.reactions).toEqual([{ emoji: '👍', count: 1, reactedByMe: true }])
      // an INSERT was performed (not a delete)
      const insert = run.mock.calls.find((c) => /INSERT INTO comment_reactions/i.test(c[0]))
      expect(insert).toBeTruthy()
      expect(run.mock.calls.some((c) => /DELETE FROM comment_reactions/i.test(c[0]))).toBe(false)
    })

    it('removes the reaction when it already exists (toggle off)', async () => {
      get
        .mockResolvedValueOnce({ id: 5 }) // comment exists
        .mockResolvedValueOnce({ id: 99 }) // existing reaction row
      run.mockResolvedValue({ changes: 1 })
      all.mockResolvedValue([]) // none left after delete

      const res = await request(app).post('/api/comments/5/reactions').send({ emoji: '👍' })

      expect(res.status).toBe(200)
      expect(res.body.reactions).toEqual([])
      const del = run.mock.calls.find((c) => /DELETE FROM comment_reactions/i.test(c[0]))
      expect(del).toBeTruthy()
      expect(del[1]).toEqual([99])
      expect(run.mock.calls.some((c) => /INSERT INTO comment_reactions/i.test(c[0]))).toBe(false)
    })

    it('rejects an emoji outside the allow-list with 400', async () => {
      const res = await request(app).post('/api/comments/5/reactions').send({ emoji: '💩' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/invalid emoji/i)
      // never touched the db
      expect(get).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
    })

    it('rejects a missing emoji with 400', async () => {
      const res = await request(app).post('/api/comments/5/reactions').send({})
      expect(res.status).toBe(400)
    })

    it('returns 404 when the comment does not exist', async () => {
      get.mockResolvedValueOnce(null) // comment lookup misses
      const res = await request(app).post('/api/comments/123/reactions').send({ emoji: '❤️' })
      expect(res.status).toBe(404)
      expect(res.body.error).toMatch(/not found/i)
      expect(run).not.toHaveBeenCalled()
    })

    it('exposes a non-empty allow-list including the core emoji', () => {
      expect(Array.isArray(REACTION_EMOJIS)).toBe(true)
      expect(REACTION_EMOJIS).toEqual(expect.arrayContaining(['👍', '❤️', '🎉', '😄', '👀']))
    })
  })

  describe('GET comment list — aggregated reactions', () => {
    it('attaches a reactions array with count + reactedByMe per comment', async () => {
      all
        .mockResolvedValueOnce([
          { id: 1, issue_id: 7, author: 'A', text: 'hi', created_at: 't' },
          { id: 2, issue_id: 7, author: 'B', text: 'yo', created_at: 't' },
        ]) // comments
        .mockResolvedValueOnce([
          { comment_id: 1, emoji: '👍', count: '2', mine: '1' },
          { comment_id: 1, emoji: '🎉', count: '1', mine: '0' },
        ]) // reactions aggregate

      const res = await request(app).get('/api/issues/7/comments')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(2)
      const c1 = res.body.find((c) => c.id === 1)
      expect(c1.reactions).toEqual([
        { emoji: '👍', count: 2, reactedByMe: true },
        { emoji: '🎉', count: 1, reactedByMe: false },
      ])
      // comment with no reactions gets an empty array
      const c2 = res.body.find((c) => c.id === 2)
      expect(c2.reactions).toEqual([])
    })

    it('does not query reactions when there are no comments', async () => {
      all.mockResolvedValueOnce([]) // comments
      const res = await request(app).get('/api/issues/7/comments')
      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
      // only the single comments query ran
      expect(all).toHaveBeenCalledTimes(1)
    })
  })
})
