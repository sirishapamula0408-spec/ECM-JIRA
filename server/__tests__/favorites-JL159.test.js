import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

import { run, all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath = '/api') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/favorites.js')
  app = createApp(mod)
})

describe('JL-159 Star / favorite projects API', () => {
  describe('GET /api/favorites', () => {
    it("returns the caller's favorite project ids", async () => {
      all.mockResolvedValue([{ project_id: 5 }, { project_id: 2 }])

      const res = await request(app).get('/api/favorites')

      expect(res.status).toBe(200)
      expect(res.body.projectIds).toEqual([5, 2])
      // Scoped to the authenticated user's email
      expect(all).toHaveBeenCalledWith(expect.any(String), ['test@test.com'])
    })

    it('returns an empty list when the user has no favorites', async () => {
      all.mockResolvedValue([])

      const res = await request(app).get('/api/favorites')

      expect(res.status).toBe(200)
      expect(res.body.projectIds).toEqual([])
    })
  })

  describe('POST /api/projects/:id/favorite', () => {
    it('stars a project (inserts a favorite row)', async () => {
      run.mockResolvedValue({ lastID: 1, changes: 1 })

      const res = await request(app).post('/api/projects/7/favorite')

      expect(res.status).toBe(201)
      expect(res.body.favorited).toBe(true)
      expect(run).toHaveBeenCalledTimes(1)
      const [sql, params] = run.mock.calls[0]
      expect(sql).toMatch(/INSERT INTO project_favorites/i)
      expect(sql).toMatch(/ON CONFLICT/i)
      expect(params).toEqual([7, 'test@test.com'])
    })

    it('is idempotent — a double-star does not error (ON CONFLICT DO NOTHING)', async () => {
      run.mockResolvedValue({ lastID: null, changes: 0 })

      const res1 = await request(app).post('/api/projects/7/favorite')
      const res2 = await request(app).post('/api/projects/7/favorite')

      expect(res1.status).toBe(201)
      expect(res2.status).toBe(201)
      expect(res2.body.favorited).toBe(true)
      expect(run).toHaveBeenCalledTimes(2)
    })
  })

  describe('DELETE /api/projects/:id/favorite', () => {
    it('unstars a project (deletes the favorite row)', async () => {
      run.mockResolvedValue({ lastID: null, changes: 1 })

      const res = await request(app).delete('/api/projects/7/favorite')

      expect(res.status).toBe(200)
      expect(res.body.favorited).toBe(false)
      const [sql, params] = run.mock.calls[0]
      expect(sql).toMatch(/DELETE FROM project_favorites/i)
      expect(params).toEqual([7, 'test@test.com'])
    })
  })
})
