import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mocked-db style (mirrors member-role-validation-JL246.test.js)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Avoid real SMTP (members router imports the mailer at module load)
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue(true),
  buildInviteEmail: vi.fn().mockReturnValue({ subject: 's', html: 'h', text: 't' }),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath, role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   JL-313: the workspace Owner must be protected in User Management.
   Root cause was two-fold:
     1) GET /api/members omitted is_owner, so the UI could not disable
        the Owner row's controls (isOwnerRow keys off is_owner).
     2) PATCH /:id/deactivate had no Owner guard, so an Admin could
        deactivate the Owner and block their login.
   ================================================================ */
describe('JL-313 — workspace Owner protection', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/members.js')
    app = createApp(mod, '/api/members')
  })

  describe('GET /api/members exposes is_owner (so the UI can protect the Owner row)', () => {
    it('paginated list includes is_owner in the SELECT and the response', async () => {
      all.mockResolvedValueOnce([
        { id: 6, name: 'Owner', email: 'owner@test.com', role: 'Admin', status: 'Active', task_count: 0, invited_by: 'System', is_owner: true },
        { id: 9, name: 'Regular', email: 'reg@test.com', role: 'Member', status: 'Active', task_count: 0, invited_by: 'Team Admin', is_owner: false },
      ])
      get.mockResolvedValueOnce({ total: 2 }) // COUNT(*)

      const res = await request(app).get('/api/members?limit=25&offset=0')

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(2)
      expect(res.body.items[0]).toHaveProperty('is_owner', true)
      expect(res.body.items[1]).toHaveProperty('is_owner', false)
      // the query itself must select is_owner
      expect(all.mock.calls[0][0]).toMatch(/is_owner/)
    })

    it('legacy (unfiltered) list also includes is_owner', async () => {
      all.mockResolvedValueOnce([
        { id: 6, name: 'Owner', email: 'owner@test.com', role: 'Admin', status: 'Active', task_count: 0, invited_by: 'System', is_owner: true },
      ])

      const res = await request(app).get('/api/members')

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body[0]).toHaveProperty('is_owner', true)
      expect(all.mock.calls[0][0]).toMatch(/is_owner/)
    })
  })

  describe('PATCH /api/members/:id/deactivate — Owner guard', () => {
    it('blocks deactivating the workspace Owner with 403 and changes nothing', async () => {
      get.mockResolvedValueOnce({
        id: 6, name: 'Owner', email: 'owner@test.com', role: 'Admin', status: 'Active', is_owner: true,
      })

      const res = await request(app).patch('/api/members/6/deactivate')

      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/owner/i)
      // no status mutation attempted
      const statusUpdate = run.mock.calls.find((c) => /UPDATE members SET status/i.test(c[0]))
      expect(statusUpdate).toBeFalsy()
    })

    it('allows deactivating a non-owner member (200 → Deactivated, login blocked)', async () => {
      get.mockResolvedValueOnce({
        id: 42, name: 'Regular', email: 'reg@test.com', role: 'Member', status: 'Active', is_owner: false,
      })
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).patch('/api/members/42/deactivate')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('Deactivated')
      const memberUpdate = run.mock.calls.find((c) => /UPDATE members SET status/i.test(c[0]))
      const userUpdate = run.mock.calls.find((c) => /UPDATE users SET status/i.test(c[0]))
      expect(memberUpdate).toBeTruthy()   // member soft-deactivated
      expect(userUpdate).toBeTruthy()     // auth login blocked
    })
  })
})
