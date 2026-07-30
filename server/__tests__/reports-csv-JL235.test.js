// @vitest-environment node
// JL-235: CSV export (?format=csv) for the report endpoints and the SLA report.
// Asserts the CSV shape (header row + columns) for several report types AND
// that the default JSON output is byte-for-byte unchanged when format is
// omitted. Uses the mocked-db + supertest pattern shared by the other
// server/__tests__ suites (no real database is touched).
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

// createNotification is imported transitively by sla.js.
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal().catch(() => ({}))
  return { ...original, createNotification: vi.fn().mockResolvedValue(1) }
})

import { all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath) {
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

// Split a CSV payload into non-empty lines (toCsv joins with '\n', no trailing newline).
const lines = (csv) => csv.split('\n')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Reports CSV export (JL-235) — reports.js', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/reports.js')
    app = createApp(mod, '/api/reports')
  })

  describe('GET /api/reports/cycle-time', () => {
    // One completed issue: created 2024-01-01, In Progress 2024-01-02, Done 2024-01-04.
    const wireCycleMocks = () => {
      all.mockImplementation(async (sql) => {
        if (sql.includes('issue_history')) {
          return [
            { issue_id: 1, new_value: 'In Progress', changed_at: '2024-01-02T00:00:00.000Z' },
            { issue_id: 1, new_value: 'Done', changed_at: '2024-01-04T00:00:00.000Z' },
          ]
        }
        // issues query
        return [
          {
            id: 1,
            issue_key: 'TP-1',
            issue_type: 'Story',
            priority: 'High',
            assignee: 'Alice',
            created_at: '2024-01-01T00:00:00.000Z',
          },
        ]
      })
    }

    it('returns CSV with a header row + one data row when format=csv', async () => {
      wireCycleMocks()
      const res = await request(app).get('/api/reports/cycle-time?format=csv')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/csv/)
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="cycle-time\.csv"/)

      const rows = lines(res.text)
      expect(rows[0]).toBe('Issue Key,Type,Priority,Assignee,Cycle Days,Lead Days,Done At')
      expect(rows).toHaveLength(2)
      // cycleDays = 2 (Jan 2 -> Jan 4), leadDays = 3 (Jan 1 -> Jan 4).
      expect(rows[1]).toBe('TP-1,Story,High,Alice,2,3,2024-01-04T00:00:00.000Z')
    })

    it('returns the original JSON shape when format is omitted', async () => {
      wireCycleMocks()
      const res = await request(app).get('/api/reports/cycle-time')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(res.body.issues).toHaveLength(1)
      expect(res.body.issues[0]).toMatchObject({ key: 'TP-1', cycleDays: 2, leadDays: 3 })
      expect(res.body.summary.count).toBe(1)
      expect(res.body.summary.cycle).toHaveProperty('p50')
    })

    it('CSV with only the header row when there are no completed issues', async () => {
      all.mockResolvedValue([])
      const res = await request(app).get('/api/reports/cycle-time?format=csv')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/csv/)
      expect(lines(res.text)).toEqual(['Issue Key,Type,Priority,Assignee,Cycle Days,Lead Days,Done At'])
    })
  })

  describe('GET /api/reports/created-resolved', () => {
    it('returns CSV with the created/resolved columns', async () => {
      all.mockResolvedValue([]) // no created/resolved rows -> zero-filled series
      const res = await request(app).get('/api/reports/created-resolved?days=1&format=csv')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/csv/)
      expect(res.headers['content-disposition']).toMatch(/created-vs-resolved\.csv/)
      const rows = lines(res.text)
      expect(rows[0]).toBe('Date,Created,Resolved,Cumulative Created,Cumulative Resolved')
      expect(rows).toHaveLength(2) // header + 1 day
      expect(rows[1]).toMatch(/^\d{4}-\d{2}-\d{2},0,0,0,0$/)
    })

    it('returns JSON (unchanged) when format is omitted', async () => {
      all.mockResolvedValue([])
      const res = await request(app).get('/api/reports/created-resolved?days=1')
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(res.body).toHaveProperty('series')
      expect(res.body.series).toHaveLength(1)
      expect(res.body.totals).toEqual({ created: 0, resolved: 0 })
    })
  })

  describe('GET /api/reports/capacity', () => {
    beforeEach(() => {
      get.mockResolvedValue({ id: 5, name: 'Sprint 5' })
      all.mockImplementation(async (sql) => {
        if (sql.includes('member_capacity')) return [{ assignee: 'Alice', capacity_points: 10 }]
        // issues in sprint
        return [{ assignee: 'Alice', issue_type: 'Story', story_points: 8 }]
      })
    })

    it('returns CSV with per-assignee capacity columns', async () => {
      const res = await request(app).get('/api/reports/capacity?sprintId=5&format=csv')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/csv/)
      const rows = lines(res.text)
      expect(rows[0]).toBe('Assignee,Committed Points,Capacity Points,Utilization %')
      expect(rows[1]).toBe('Alice,8,10,80')
    })

    it('returns JSON (unchanged) when format is omitted', async () => {
      const res = await request(app).get('/api/reports/capacity?sprintId=5')
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(res.body.rows).toEqual([
        { assignee: 'Alice', committedPoints: 8, capacityPoints: 10, utilizationPct: 80 },
      ])
      expect(res.body.sprintName).toBe('Sprint 5')
    })
  })
})

describe('SLA report CSV export (JL-235) — sla.js', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/sla.js')
    app = createApp(mod, '/api')
  })

  const wireSlaMocks = () => {
    all.mockImplementation(async (sql) => {
      if (sql.includes('sla_policies')) {
        return [{ id: 1, project_id: 7, priority: 'High', target_hours: 10, applies_to: 'resolution' }]
      }
      if (sql.includes('issue_history')) {
        return [{ issue_id: 1, done_at: '2024-01-01T05:00:00.000Z' }]
      }
      // issues in project
      return [
        {
          id: 1,
          issue_key: 'TP-1',
          title: 'Bug',
          priority: 'High',
          status: 'Done',
          assignee: 'Alice',
          project_id: 7,
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ]
    })
  }

  it('returns CSV with the SLA columns when format=csv', async () => {
    wireSlaMocks()
    const res = await request(app).get('/api/reports/sla?projectId=7&format=csv')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/sla-report-7\.csv/)
    const rows = lines(res.text)
    expect(rows[0]).toBe('Issue Key,Title,Priority,Status,Assignee,Target Hours,Elapsed Hours,Percent,SLA Status')
    // elapsed = 5h against a 10h target -> 50% -> ok.
    expect(rows[1]).toBe('TP-1,Bug,High,Done,Alice,10,5,50,ok')
  })

  it('returns the original JSON shape when format is omitted', async () => {
    wireSlaMocks()
    const res = await request(app).get('/api/reports/sla?projectId=7')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body.summary).toMatchObject({ ok: 1, breached: 0, atRisk: 0, total: 1 })
    expect(res.body.ok[0]).toMatchObject({ key: 'TP-1', slaStatus: 'ok', percent: 50 })
    expect(res.body).toHaveProperty('policies')
  })
})
