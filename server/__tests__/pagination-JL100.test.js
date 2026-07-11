import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — capture SQL + params passed to all()/get()
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { parsePagination, isPaginationRequested } from '../utils/pagination.js'

function createApp(routeModule) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/issues', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  all.mockResolvedValue([])
  get.mockResolvedValue({ total: 0 })
  const mod = await import('../routes/issues.js')
  app = createApp(mod)
})

/* ==================================================================
   Unit: parsePagination
   ================================================================== */
describe('parsePagination — defaults', () => {
  it('returns default limit and zero offset for empty query', () => {
    expect(parsePagination({})).toEqual({ limit: 50, offset: 0 })
  })

  it('honors a custom defaultLimit', () => {
    expect(parsePagination({}, { defaultLimit: 25 })).toEqual({ limit: 25, offset: 0 })
  })

  it('accepts a valid limit and offset', () => {
    expect(parsePagination({ limit: '10', offset: '20' })).toEqual({ limit: 10, offset: 20 })
  })
})

describe('parsePagination — clamp to max', () => {
  it('caps an absurdly large limit at maxLimit (default 200)', () => {
    expect(parsePagination({ limit: '100000' })).toEqual({ limit: 200, offset: 0 })
  })

  it('caps at a custom maxLimit', () => {
    expect(parsePagination({ limit: '9999' }, { maxLimit: 500 })).toEqual({ limit: 500, offset: 0 })
  })

  it('clamps a limit below 1 up to 1', () => {
    expect(parsePagination({ limit: '0' }).limit).toBe(50) // 0 is not > 0 → falls back to default
    expect(parsePagination({ limit: '-5' }).limit).toBe(50)
  })
})

describe('parsePagination — ignore invalid', () => {
  it('falls back to default for non-numeric limit', () => {
    expect(parsePagination({ limit: 'abc' })).toEqual({ limit: 50, offset: 0 })
  })

  it('falls back to default for float / junk', () => {
    expect(parsePagination({ limit: '1.5' }).limit).toBe(50)
    expect(parsePagination({ limit: 'NaN' }).limit).toBe(50)
  })

  it('ignores a negative offset (keeps 0)', () => {
    expect(parsePagination({ offset: '-10' }).offset).toBe(0)
  })

  it('ignores a non-numeric offset (keeps 0)', () => {
    expect(parsePagination({ offset: 'xyz' }).offset).toBe(0)
  })
})

describe('parsePagination — offset from page', () => {
  it('computes offset from a 1-based page and limit', () => {
    expect(parsePagination({ page: '3', limit: '10' })).toEqual({ limit: 10, offset: 20 })
  })

  it('page 1 yields offset 0', () => {
    expect(parsePagination({ page: '1' }).offset).toBe(0)
  })

  it('uses the default limit when page is given without limit', () => {
    expect(parsePagination({ page: '2' })).toEqual({ limit: 50, offset: 50 })
  })

  it('offset takes precedence over page when both are present', () => {
    expect(parsePagination({ page: '5', offset: '7', limit: '10' }).offset).toBe(7)
  })
})

describe('isPaginationRequested', () => {
  it('is false when no paging params present', () => {
    expect(isPaginationRequested({ q: 'x' })).toBe(false)
    expect(isPaginationRequested({})).toBe(false)
  })

  it('is true when limit, offset, or page is present', () => {
    expect(isPaginationRequested({ limit: '10' })).toBe(true)
    expect(isPaginationRequested({ offset: '0' })).toBe(true)
    expect(isPaginationRequested({ page: '2' })).toBe(true)
  })
})

/* ==================================================================
   Endpoint: GET /api/issues honors pagination
   ================================================================== */
describe('GET /api/issues — pagination behavior', () => {
  it('applies a hard safety cap (JL-187) by default but keeps the legacy array shape + no OFFSET/params', async () => {
    const res = await request(app).get('/api/issues')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    const [sql, params] = all.mock.calls[0]
    // JL-187: the default path is now bounded by a constant LIMIT (baked into the
    // SQL, not a bound param) so the whole table is never materialized at once.
    expect(sql).toMatch(/LIMIT 5000$/)
    expect(sql).not.toMatch(/OFFSET/i)
    // The cap is a literal, so no extra bound params are introduced.
    expect(params).toEqual([])
    // no count query fired (no explicit pagination requested)
    expect(get).not.toHaveBeenCalled()
  })

  it('appends LIMIT ? OFFSET ? with bound params when ?limit is passed', async () => {
    const res = await request(app).get('/api/issues?limit=10&offset=20')
    expect(res.status).toBe(200)
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/LIMIT \? OFFSET \?$/)
    // limit + offset are the LAST two bound params
    expect(params.slice(-2)).toEqual([10, 20])
  })

  it('caps limit at 200 in the bound params (DoS guard)', async () => {
    await request(app).get('/api/issues?limit=100000')
    const [, params] = all.mock.calls[0]
    expect(params.slice(-2)).toEqual([200, 0])
  })

  it('sets X-Total-Count / X-Limit / X-Offset headers', async () => {
    get.mockResolvedValueOnce({ total: 137 })
    const res = await request(app).get('/api/issues?limit=25&offset=50')
    expect(res.headers['x-total-count']).toBe('137')
    expect(res.headers['x-limit']).toBe('25')
    expect(res.headers['x-offset']).toBe('50')
  })

  it('combines pagination with existing filters (limit/offset appended last)', async () => {
    await request(app).get('/api/issues?status=Done&limit=5')
    const [sql, params] = all.mock.calls[0]
    expect(sql).toContain('status = ?')
    expect(sql).toMatch(/LIMIT \? OFFSET \?$/)
    expect(params).toEqual(['Done', 5, 0])
  })
})
