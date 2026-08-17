// @vitest-environment node
//
// JL-402 — a date-only `dateTo` must cover the whole day.
//
// The page's From/To pickers send YYYY-MM-DD. Compared directly,
// `created_at <= '2026-08-14'` means `<= 2026-08-14 00:00:00`, so every entry
// recorded ON the To date is excluded and From == To returns nothing at all.
// These assertions read the SQL the route actually builds, because that is where
// the bug would live — the page cannot see it and neither can a DOM test.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
}))

import { all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

async function createApp() {
  const mod = await import('../routes/auditLog.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: true }
    next()
  })
  app.use('/api', mod.default ?? mod.router)
  app.use(errorHandler)
  return app
}

/** The SQL + params of the SELECT that fetched rows (not the COUNT). */
function listQuery() {
  const call = all.mock.calls.find(([sql]) => /SELECT/i.test(sql) && !/COUNT/i.test(sql))
  return { sql: call?.[0] ?? '', params: call?.[1] ?? [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  // First call = rows, second = COUNT.
  all.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0 }])
})

describe('JL-402 — date-only bounds cover the whole day', () => {
  it('widens a date-only dateTo to an exclusive next-day bound', async () => {
    const app = await createApp()
    await request(app).get('/api/audit-log?dateTo=2026-08-14').expect(200)

    const { sql, params } = listQuery()
    // The whole point: NOT a bare `created_at <= '2026-08-14'`, which would drop
    // every entry recorded during that day.
    expect(sql).toMatch(/created_at\s*<\s*\(.*INTERVAL '1 day'\)/)
    expect(sql).not.toMatch(/created_at\s*<=\s*\?/)
    expect(params).toContain('2026-08-14')
  })

  it('keeps the inclusive form when the bound carries a time', async () => {
    // Any caller passing a full timestamp keeps the original semantics.
    const app = await createApp()
    await request(app).get('/api/audit-log?dateTo=2026-08-14T09:30').expect(200)

    const { sql, params } = listQuery()
    expect(sql).toMatch(/created_at\s*<=\s*\?/)
    expect(sql).not.toMatch(/INTERVAL '1 day'/)
    expect(params).toContain('2026-08-14T09:30')
  })

  it('leaves dateFrom inclusive, so From == To spans exactly that day', async () => {
    const app = await createApp()
    await request(app).get('/api/audit-log?dateFrom=2026-08-14&dateTo=2026-08-14').expect(200)

    const { sql } = listQuery()
    expect(sql).toMatch(/created_at\s*>=\s*\?/)
    expect(sql).toMatch(/INTERVAL '1 day'/)
  })

  it('applies the same widening to the export, not just the table', async () => {
    // buildFilters is shared by the list and the export; fixing only the page
    // would leave a CSV that disagrees with the table on screen.
    all.mockReset()
    all.mockResolvedValue([])
    const app = await createApp()
    await request(app).get('/api/audit-log/export?format=json&dateTo=2026-08-14').expect(200)

    const sql = all.mock.calls.map(([s]) => s).join('\n')
    expect(sql).toMatch(/INTERVAL '1 day'/)
  })

  it('still filters on actor and action alongside the dates', async () => {
    const app = await createApp()
    await request(app)
      .get('/api/audit-log?actor=a@test.com&action=login&dateTo=2026-08-14')
      .expect(200)

    const { sql, params } = listQuery()
    expect(sql).toMatch(/actor = \?/)
    expect(sql).toMatch(/action = \?/)
    expect(params).toEqual(expect.arrayContaining(['a@test.com', 'login', '2026-08-14']))
  })
})
