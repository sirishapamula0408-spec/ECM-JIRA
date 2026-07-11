import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { all, get } from '../db.js'
import gadgetRoutes, {
  getGadgetCatalog,
  validateGadgetConfig,
  computeGadgetData,
  GADGET_CATALOG,
} from '../routes/dashboardGadgets.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api', gadgetRoutes)
  app.use(errorHandler)
  return app
}

// Sample issue rows shared across breakdown tests. Includes null/empty values
// that must be ignored by the aggregation.
const SAMPLE_ISSUES = [
  { status: 'To Do', assignee: 'alice', priority: 'High' },
  { status: 'To Do', assignee: 'bob', priority: 'Low' },
  { status: 'In Progress', assignee: 'alice', priority: 'High' },
  { status: 'Done', assignee: null, priority: 'Medium' },
  { status: null, assignee: '', priority: null },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getGadgetCatalog', () => {
  it('returns the known gadget types including issue_count and issues_by_status', () => {
    const catalog = getGadgetCatalog()
    expect(Array.isArray(catalog)).toBe(true)
    const types = catalog.map((g) => g.type)
    expect(types).toContain('issue_count')
    expect(types).toContain('issues_by_status')
    expect(types).toContain('issues_by_assignee')
    expect(types).toContain('issues_by_priority')
    expect(types).toContain('recent_activity')
    expect(types).toContain('filter_results')
  })

  it('every catalog entry has name, description, category and configSchema', () => {
    for (const g of getGadgetCatalog()) {
      expect(typeof g.name).toBe('string')
      expect(typeof g.description).toBe('string')
      expect(typeof g.category).toBe('string')
      expect(g.configSchema).toBeTypeOf('object')
    }
  })

  it('returns a copy that does not mutate the source catalog', () => {
    const catalog = getGadgetCatalog()
    catalog[0].type = 'mutated'
    expect(GADGET_CATALOG[0].type).toBe('issue_count')
  })
})

describe('validateGadgetConfig', () => {
  it('rejects an unknown gadget type', () => {
    const result = validateGadgetConfig('nope', {})
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toMatch(/unknown gadget type/i)
  })

  it('accepts a known gadget with empty config', () => {
    expect(validateGadgetConfig('issue_count', {}).ok).toBe(true)
    expect(validateGadgetConfig('issues_by_status', {}).ok).toBe(true)
  })

  it('rejects a non-numeric value for a number-typed field', () => {
    const result = validateGadgetConfig('issue_count', { projectId: 'abc' })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/projectId/)
  })
})

describe('computeGadgetData', () => {
  it('issue_count returns a count of the rows', () => {
    expect(computeGadgetData('issue_count', SAMPLE_ISSUES)).toEqual({ count: 5 })
    expect(computeGadgetData('issue_count', [])).toEqual({ count: 0 })
  })

  it('issues_by_status breaks down by status, ignoring nulls', () => {
    const data = computeGadgetData('issues_by_status', SAMPLE_ISSUES)
    const map = Object.fromEntries(data.map((d) => [d.status, d.count]))
    expect(map).toEqual({ 'To Do': 2, 'In Progress': 1, Done: 1 })
    // the null-status row is excluded
    expect(data.find((d) => d.status === null)).toBeUndefined()
  })

  it('issues_by_assignee breaks down by assignee, ignoring null and empty', () => {
    const data = computeGadgetData('issues_by_assignee', SAMPLE_ISSUES)
    const map = Object.fromEntries(data.map((d) => [d.assignee, d.count]))
    expect(map).toEqual({ alice: 2, bob: 1 })
  })

  it('issues_by_priority breaks down by priority, ignoring nulls', () => {
    const data = computeGadgetData('issues_by_priority', SAMPLE_ISSUES)
    const map = Object.fromEntries(data.map((d) => [d.priority, d.count]))
    expect(map).toEqual({ High: 2, Low: 1, Medium: 1 })
  })
})

describe('GET /api/dashboards/gadgets/catalog', () => {
  it('returns the gadget catalog', async () => {
    const res = await request(createApp()).get('/api/dashboards/gadgets/catalog')
    expect(res.status).toBe(200)
    expect(res.body.gadgets.map((g) => g.type)).toContain('issue_count')
  })
})

describe('POST /api/dashboards/gadgets/data', () => {
  it('returns { count } for issue_count', async () => {
    get.mockResolvedValue({ count: '7' })
    const res = await request(createApp())
      .post('/api/dashboards/gadgets/data')
      .send({ type: 'issue_count', config: {} })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ type: 'issue_count', data: { count: 7 } })
  })

  it('returns a status breakdown for issues_by_status', async () => {
    all.mockResolvedValue(SAMPLE_ISSUES)
    const res = await request(createApp())
      .post('/api/dashboards/gadgets/data')
      .send({ type: 'issues_by_status', config: {} })
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('issues_by_status')
    const map = Object.fromEntries(res.body.data.map((d) => [d.status, d.count]))
    expect(map).toEqual({ 'To Do': 2, 'In Progress': 1, Done: 1 })
  })

  it('returns 400 for an unknown gadget type', async () => {
    const res = await request(createApp())
      .post('/api/dashboards/gadgets/data')
      .send({ type: 'bogus', config: {} })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown gadget type/i)
  })
})
