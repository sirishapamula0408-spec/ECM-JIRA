// @vitest-environment node
//
// JL-281: server-side pagination + search/filtering for GET /api/members.
// Uses a mocked db so we can assert the exact SQL/params the handler builds and
// the response shape it returns (legacy array vs. paginated envelope).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Mailer is pulled in transitively by members.js — stub it so no SMTP happens.
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
  buildInviteEmail: vi.fn(() => ({ subject: '', html: '', text: '' })),
}))

import { all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/members', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  all.mockResolvedValue([])
  get.mockResolvedValue({ total: 0 })
  const mod = await import('../routes/members.js')
  app = createApp(mod)
})

describe('GET /api/members — backward compatibility (no params)', () => {
  it('returns a plain array and never runs a count query', async () => {
    all.mockResolvedValueOnce([
      { id: 1, name: 'Alice', email: 'a@x.com', role: 'Admin', status: 'Active', task_count: 0, invited_by: null },
    ])
    const res = await request(app).get('/api/members')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(1)

    const [sql, params] = all.mock.calls[0]
    expect(sql).not.toMatch(/LIMIT/i)
    expect(sql).not.toMatch(/OFFSET/i)
    expect(sql).not.toMatch(/ILIKE/i)
    // Legacy path binds no params and never fires the COUNT query.
    expect(params).toBeUndefined()
    expect(get).not.toHaveBeenCalled()
  })
})

describe('GET /api/members — paginated envelope', () => {
  it('returns { items, total, limit, offset } when ?limit is present', async () => {
    all.mockResolvedValueOnce([{ id: 1, name: 'Alice', email: 'a@x.com', role: 'Admin', status: 'Active' }])
    get.mockResolvedValueOnce({ total: 137 })

    const res = await request(app).get('/api/members?limit=10&offset=20')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(false)
    expect(res.body).toMatchObject({ total: 137, limit: 10, offset: 20 })
    expect(Array.isArray(res.body.items)).toBe(true)

    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/LIMIT \? OFFSET \?/)
    // limit + offset are the last two bound params.
    expect(params.slice(-2)).toEqual([10, 20])
    // A COUNT query was issued for the total.
    expect(get).toHaveBeenCalled()
  })

  it('computes offset from a 1-based page', async () => {
    await request(app).get('/api/members?page=3&limit=10')
    const [, params] = all.mock.calls[0]
    expect(params.slice(-2)).toEqual([10, 20])
  })

  it('caps an absurd limit at 200 (DoS guard)', async () => {
    await request(app).get('/api/members?limit=100000')
    const [, params] = all.mock.calls[0]
    expect(params.slice(-2)).toEqual([200, 0])
  })

  it('reports the total count from the COUNT query', async () => {
    get.mockResolvedValueOnce({ total: 42 })
    const res = await request(app).get('/api/members?limit=5')
    expect(res.body.total).toBe(42)
  })
})

describe('GET /api/members — search filter', () => {
  it('matches name/email with ILIKE and binds %term% twice', async () => {
    const res = await request(app).get('/api/members?search=bob')

    // A filter param alone switches to the envelope shape.
    expect(Array.isArray(res.body)).toBe(false)
    expect(res.body).toHaveProperty('items')

    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/name ILIKE \? OR email ILIKE \?/)
    expect(params[0]).toBe('%bob%')
    expect(params[1]).toBe('%bob%')

    // The COUNT query uses the same WHERE (same leading params, no limit/offset).
    const [countSql, countParams] = get.mock.calls[0]
    expect(countSql).toMatch(/COUNT\(\*\)/i)
    expect(countSql).toMatch(/ILIKE/)
    expect(countParams).toEqual(['%bob%', '%bob%'])
  })

  it('trims whitespace-only search into no filter', async () => {
    await request(app).get('/api/members?search=%20%20')
    const [sql] = all.mock.calls[0]
    expect(sql).not.toMatch(/ILIKE/)
  })
})

describe('GET /api/members — role & status filters', () => {
  it('filters by role', async () => {
    await request(app).get('/api/members?role=Admin')
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/role = \?/)
    expect(params).toContain('Admin')
  })

  it('filters by status', async () => {
    await request(app).get('/api/members?status=Invited')
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/status = \?/)
    expect(params).toContain('Invited')
  })

  it('combines search + role + status + pagination, binding all params in order', async () => {
    await request(app).get('/api/members?search=jo&role=Member&status=Active&limit=5&offset=10')
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/ILIKE/)
    expect(sql).toMatch(/role = \?/)
    expect(sql).toMatch(/status = \?/)
    expect(sql).toMatch(/LIMIT \? OFFSET \?/)
    // WHERE params first, then limit + offset last.
    expect(params).toEqual(['%jo%', '%jo%', 'Member', 'Active', 5, 10])
  })
})
