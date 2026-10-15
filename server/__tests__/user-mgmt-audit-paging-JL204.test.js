// JL-204 — GET /api/members/audit pages through the whole trail.
//
// It returned only the newest entries (100 by default, 500 at most) with no
// offset, so anything older could not be seen at all. Asked for with offset or
// page it now answers { items, total, limit, offset }; a plain call keeps the
// newest-first list older callers expect.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  tableExists: vi.fn(),
}))
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn(),
  buildInviteEmail: vi.fn(),
  getLatestEmailStatuses: async () => new Map(),
}))

import { all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, user = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false, ...user }
    next()
  })
  app.use('/api/members', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

const ENTRY = (id) => ({ id, actor: 'admin@test.com', target_member_id: 9, target_email: 't@test.com', action: 'role_changed', before_value: 'Viewer', after_value: 'Member', created_at: '2026-10-01T00:00:00Z' })

let app
beforeEach(async () => {
  vi.clearAllMocks()
  app = createApp(await import('../routes/members.js'))
})

describe('GET /api/members/audit — paging (JL-204)', () => {
  it('returns one page and the total when an offset is given', async () => {
    all.mockResolvedValueOnce([ENTRY(197), ENTRY(196)])
    get.mockResolvedValueOnce({ total: 222 })

    const res = await request(app).get('/api/members/audit?offset=25&limit=2')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [ENTRY(197), ENTRY(196)], total: 222, limit: 2, offset: 25 })
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/ORDER BY id DESC\s+LIMIT \? OFFSET \?/)
    expect(params).toEqual([2, 25])
  })

  it('accepts page as well as offset', async () => {
    all.mockResolvedValueOnce([])
    get.mockResolvedValueOnce({ total: 222 })

    const res = await request(app).get('/api/members/audit?page=3&limit=25')

    expect(res.body).toMatchObject({ limit: 25, offset: 50, total: 222 })
  })

  it('applies the target and action filters to both the page and the total', async () => {
    all.mockResolvedValueOnce([ENTRY(10)])
    get.mockResolvedValueOnce({ total: 13 })

    const res = await request(app).get('/api/members/audit?offset=0&limit=5&action=role_changed&target=t@test.com')

    expect(res.body.total).toBe(13)
    const [pageSql, pageParams] = all.mock.calls[0]
    const [countSql, countParams] = get.mock.calls[0]
    for (const sql of [pageSql, countSql]) {
      expect(sql).toMatch(/LOWER\(target_email\) = LOWER\(\?\)/)
      expect(sql).toMatch(/action = \?/)
    }
    expect(countParams).toEqual(['t@test.com', 'role_changed'])
    expect(pageParams).toEqual(['t@test.com', 'role_changed', 5, 0])
  })

  it('caps the page size', async () => {
    all.mockResolvedValueOnce([])
    get.mockResolvedValueOnce({ total: 0 })

    const res = await request(app).get('/api/members/audit?offset=0&limit=10000')

    expect(res.body.limit).toBe(200)
  })

  it('keeps the plain newest-first list for a call without offset or page', async () => {
    all.mockResolvedValueOnce([ENTRY(222), ENTRY(221)])

    const res = await request(app).get('/api/members/audit')

    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(2)
    expect(get).not.toHaveBeenCalled()
  })

  it('stays admin-only', async () => {
    const memberApp = createApp(await import('../routes/members.js'), { workspaceRole: 'Member' })
    const res = await request(memberApp).get('/api/members/audit?offset=0')
    expect(res.status).toBe(403)
  })
})
