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

import { run } from '../db.js'
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

describe('Notification cleanup (JL-201)', () => {
  let app
  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../routes/notifications.js')
    app = createApp(mod)
  })

  describe('DELETE /api/read — bulk-clear read notifications', () => {
    it('deletes only the current user\'s read notifications', async () => {
      run.mockResolvedValue({ changes: 3 })

      const res = await request(app).delete('/api/read')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.deleted).toBe(3)

      expect(run).toHaveBeenCalledTimes(1)
      const [sql, params] = run.mock.calls[0]
      expect(sql).toContain('DELETE FROM notifications')
      expect(sql).toContain('recipient_email = ?')
      expect(sql).toContain('is_read = TRUE')
      // Not matched by the /:id route — no id param involved
      expect(sql).not.toContain('id = ?')
      expect(params).toEqual(['test@test.com'])
    })

    it('succeeds with zero deletions when there are no read notifications', async () => {
      run.mockResolvedValue({ changes: 0 })

      const res = await request(app).delete('/api/read')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.deleted).toBe(0)
    })
  })

  describe('DELETE /api/:id — single dismiss', () => {
    it('deletes a single notification scoped to the current user', async () => {
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).delete('/api/42')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      const [sql, params] = run.mock.calls[0]
      expect(sql).toContain('DELETE FROM notifications')
      expect(sql).toContain('id = ?')
      expect(params).toEqual([42, 'test@test.com'])
    })
  })
})
