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

import { all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { rollupPortfolio, completionPct } from '../routes/portfolio.js'

function createApp(routeModule, user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user ?? { id: 1, email: 'lead@test.com', memberId: 1, workspaceRole: 'Member', isOwner: false }
    req.workspaceId = 1
    next()
  })
  app.use('/api', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/portfolio.js')
  app = createApp(mod)
})

describe('rollupPortfolio (JL-154)', () => {
  it('sums per-project totals and computes overall completionPct', () => {
    const agg = rollupPortfolio([
      { total: 10, open: 6, done: 4, overdue: 2 },
      { total: 10, open: 4, done: 6, overdue: 1 },
    ])
    expect(agg.projectCount).toBe(2)
    expect(agg.total).toBe(20)
    expect(agg.open).toBe(10)
    expect(agg.done).toBe(10)
    expect(agg.overdue).toBe(3)
    expect(agg.completionPct).toBe(50) // 10/20
  })

  it('rounds completionPct sensibly', () => {
    const agg = rollupPortfolio([{ total: 3, open: 2, done: 1, overdue: 0 }])
    expect(agg.completionPct).toBe(33) // 1/3 -> 33.33 -> 33
  })

  it('returns 0 completionPct when there are no issues', () => {
    const agg = rollupPortfolio([{ total: 0, open: 0, done: 0, overdue: 0 }])
    expect(agg.total).toBe(0)
    expect(agg.completionPct).toBe(0)
  })

  it('handles an empty/invalid input as all zeros', () => {
    expect(rollupPortfolio([])).toEqual({
      projectCount: 0, total: 0, open: 0, done: 0, overdue: 0, completionPct: 0,
    })
    expect(rollupPortfolio(null).completionPct).toBe(0)
  })

  it('completionPct helper guards divide-by-zero', () => {
    expect(completionPct(0, 0)).toBe(0)
    expect(completionPct(5, 10)).toBe(50)
  })
})

describe('GET /api/portfolio/summary (JL-154)', () => {
  it('returns a per-project array plus an aggregate roll-up', async () => {
    // member lookup
    get.mockResolvedValueOnce({ id: 1, name: 'Lead User' })
    // accessible projects
    all.mockResolvedValueOnce([
      { id: 10, key: 'ALPHA', name: 'Alpha' },
      { id: 20, key: 'BETA', name: 'Beta' },
    ])
    // issues across those projects
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
    const past = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10)
    all.mockResolvedValueOnce([
      { project_id: 10, status: 'Done', due_date: null, updated_at: new Date().toISOString() },
      { project_id: 10, status: 'To Do', due_date: past, updated_at: null }, // overdue
      { project_id: 10, status: 'In Progress', due_date: future, updated_at: null },
      { project_id: 20, status: 'Done', due_date: null, updated_at: null },
    ])

    const res = await request(app).get('/api/portfolio/summary')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.projects)).toBe(true)
    expect(res.body.projects).toHaveLength(2)

    const alpha = res.body.projects.find((p) => p.projectId === 10)
    expect(alpha).toMatchObject({
      projectKey: 'ALPHA', name: 'Alpha', total: 3, open: 2, done: 1, overdue: 1,
    })
    expect(alpha.completionPct).toBe(33)

    const beta = res.body.projects.find((p) => p.projectId === 20)
    expect(beta).toMatchObject({ total: 1, done: 1, open: 0, overdue: 0, completionPct: 100 })

    // aggregate shape
    expect(res.body.aggregate).toMatchObject({
      projectCount: 2, total: 4, open: 2, done: 2, overdue: 1,
    })
    expect(res.body.aggregate.completionPct).toBe(50)
    expect(typeof res.body.throughput30d).toBe('number')
    expect(res.body.throughput30d).toBe(1) // only Alpha's Done issue has a recent updated_at
  })

  it('returns zeros when the caller has no accessible projects', async () => {
    get.mockResolvedValueOnce({ id: 1, name: 'Lead User' })
    all.mockResolvedValueOnce([]) // no projects

    const res = await request(app).get('/api/portfolio/summary')
    expect(res.status).toBe(200)
    expect(res.body.projects).toEqual([])
    expect(res.body.aggregate).toEqual({
      projectCount: 0, total: 0, open: 0, done: 0, overdue: 0, completionPct: 0,
    })
    expect(res.body.throughput30d).toBe(0)
  })

  it('includes projects with zero issues as empty rows', async () => {
    get.mockResolvedValueOnce({ id: 1, name: 'Lead User' })
    all.mockResolvedValueOnce([{ id: 30, key: 'EMPTY', name: 'Empty' }])
    all.mockResolvedValueOnce([]) // no issues

    const res = await request(app).get('/api/portfolio/summary')
    expect(res.status).toBe(200)
    expect(res.body.projects).toHaveLength(1)
    expect(res.body.projects[0]).toMatchObject({
      projectId: 30, total: 0, open: 0, done: 0, overdue: 0, completionPct: 0,
    })
    expect(res.body.aggregate.completionPct).toBe(0)
  })

  it('scopes issues to the accessible project ids (parameterized IN clause)', async () => {
    get.mockResolvedValueOnce({ id: 1, name: 'Lead User' })
    all.mockResolvedValueOnce([{ id: 10, key: 'ALPHA', name: 'Alpha' }])
    all.mockResolvedValueOnce([])

    await request(app).get('/api/portfolio/summary')

    // second all() call = the issues query
    const [sql, params] = all.mock.calls[1]
    expect(sql).toMatch(/FROM issues/i)
    expect(sql).toMatch(/project_id IN/i)
    expect(params).toEqual([10])
  })
})
