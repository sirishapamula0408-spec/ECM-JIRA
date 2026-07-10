// @vitest-environment node
// JL-156: Data warehouse / BI export connector — pure helpers + route behavior.
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
import biExportRoutes, {
  toFactRow,
  toCsv,
  toNdjson,
  parseSince,
  csvCell,
  FACT_COLUMNS,
} from '../routes/biExport.js'

// App stubbing an Admin caller (passes requireRole('Admin')).
function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: true }
    req.workspaceId = null
    next()
  })
  app.use('/api', biExportRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ---------------- PURE HELPERS ---------------- */
describe('toFactRow', () => {
  it('flattens a raw joined issue row (key/project/status/points)', () => {
    const fact = toFactRow({
      id: 42,
      issue_key: 'TP-12',
      project_id: 7,
      project_key: 'TP',
      status: 'In Progress',
      priority: 'High',
      issue_type: 'Bug',
      assignee: 'alice@x.com',
      reporter: 'bob@x.com',
      story_points: '5',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    })
    expect(fact.id).toBe(42)
    expect(fact.key).toBe('TP-12')
    expect(fact.project_key).toBe('TP')
    expect(fact.status).toBe('In Progress')
    expect(fact.story_points).toBe(5) // coerced to number
    expect(fact.resolved_at).toBeNull()
    expect(Object.keys(fact)).toEqual(FACT_COLUMNS)
  })

  it('prefers key over issue_key and tolerates missing fields', () => {
    const fact = toFactRow({ id: 1, key: 'AB-1' })
    expect(fact.key).toBe('AB-1')
    expect(fact.story_points).toBeNull()
    expect(fact.priority).toBeNull()
  })
})

describe('toCsv', () => {
  it('emits a header row and escapes commas/quotes/newlines', () => {
    const rows = [
      { a: 'plain', b: 'has,comma' },
      { a: 'quote"x', b: 'line\nbreak' },
    ]
    const csv = toCsv(rows, ['a', 'b'])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('a,b') // header
    expect(csv).toContain('"has,comma"')
    expect(csv).toContain('"quote""x"')
    expect(csv).toContain('"line\nbreak"')
  })

  it('csvCell leaves plain values unquoted', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(null)).toBe('')
    expect(csvCell(5)).toBe('5')
  })
})

describe('toNdjson', () => {
  it('emits one JSON object per line', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const out = toNdjson(rows)
    const lines = out.split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0])).toEqual({ id: 1 })
    expect(JSON.parse(lines[2])).toEqual({ id: 3 })
  })
})

describe('parseSince', () => {
  it('accepts a valid ISO date and normalizes it', () => {
    expect(parseSince('2026-01-15T00:00:00.000Z')).toBe('2026-01-15T00:00:00.000Z')
    expect(parseSince('2026-01-15')).toBe('2026-01-15T00:00:00.000Z')
  })
  it('returns null for garbage / empty input (=> full export)', () => {
    expect(parseSince('not-a-date')).toBeNull()
    expect(parseSince('')).toBeNull()
    expect(parseSince(undefined)).toBeNull()
    expect(parseSince(null)).toBeNull()
  })
})

/* ---------------- ROUTES ---------------- */
describe('GET /api/bi/schema', () => {
  it('returns the dataset description', async () => {
    const app = createApp()
    const res = await request(app).get('/api/bi/schema')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.datasets)).toBe(true)
    const issues = res.body.datasets.find((d) => d.name === 'issues')
    expect(issues.type).toBe('fact')
    expect(issues.columns.map((c) => c.name)).toEqual(FACT_COLUMNS)
  })
})

describe('GET /api/bi/export/issues', () => {
  it('applies the updated_at filter for incremental pulls and returns rows', async () => {
    all.mockResolvedValue([
      { id: 1, key: 'TP-1', project_id: 7, project_key: 'TP', status: 'Done', priority: 'Low', issue_type: 'Task', assignee: 'a', reporter: 'b', story_points: 3, created_at: 'c', updated_at: 'u' },
    ])
    const app = createApp()
    const res = await request(app).get('/api/bi/export/issues?since=2026-01-01T00:00:00.000Z')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].key).toBe('TP-1')

    // Assert the query used the updated_at filter and the since value was bound.
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/updated_at\s*>=\s*\?/)
    expect(params).toContain('2026-01-01T00:00:00.000Z')
  })

  it('format=csv sets a CSV content-type with a header row', async () => {
    all.mockResolvedValue([
      { id: 1, key: 'TP-1', project_id: 7, project_key: 'TP', status: 'Done', priority: 'Low', issue_type: 'Task', assignee: 'a', reporter: 'b', story_points: 3, created_at: 'c', updated_at: 'u' },
    ])
    const app = createApp()
    const res = await request(app).get('/api/bi/export/issues?format=csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/attachment/)
    expect(res.text.split('\n')[0]).toBe(FACT_COLUMNS.join(','))
  })
})

describe('GET /api/bi/export/dimensions/:name', () => {
  it('returns rows for a known dimension', async () => {
    all.mockResolvedValue([{ id: 1, key: 'TP', name: 'Test Proj', lead: 'alice' }])
    const app = createApp()
    const res = await request(app).get('/api/bi/export/dimensions/projects')
    expect(res.status).toBe(200)
    expect(res.body[0].key).toBe('TP')
  })

  it('returns static rows for statuses without hitting the db', async () => {
    const app = createApp()
    const res = await request(app).get('/api/bi/export/dimensions/statuses')
    expect(res.status).toBe(200)
    expect(res.body.map((r) => r.value)).toContain('Done')
  })

  it('returns 400 for an unknown dimension name', async () => {
    const app = createApp()
    const res = await request(app).get('/api/bi/export/dimensions/bogus')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown dimension/i)
  })
})
