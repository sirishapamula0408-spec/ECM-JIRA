import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — no live DB (same pattern as queues-JL141.test.js).
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
}))

// Mock notifications (sla.js imports it transitively).
vi.mock('../routes/notifications.js', () => ({
  createNotification: vi.fn().mockResolvedValue(1),
}))

import { all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import queueRouter from '../routes/queues.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'u@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api', queueRouter)
  app.use(errorHandler)
  return app
}

const HOUR = 1000 * 60 * 60
const hoursAgo = (h) => new Date(Date.now() - h * HOUR).toISOString()

// Standard mock queue row (empty filter -> all issues match).
const QUEUE = { id: 3, project_id: 7, name: 'Support', order_by: 'created_at', filter: {} }

const issueRow = (over) => ({
  id: 1,
  issue_key: 'P-1',
  title: 't',
  priority: 'High',
  status: 'Done',
  assignee: 'Alice',
  project_id: 7,
  due_date: null,
  created_at: hoursAgo(100),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   JL-347: the queue SLA column must measure Done issues from
   created_at to the FIRST time they reached Done (issue_history),
   not to their own created_at (which always yielded 0h / 'ok').
   ================================================================ */
describe('JL-347 GET /api/queues/:id/issues — Done-issue SLA resolution time', () => {
  it('reports a Done issue that blew its target as breached with real elapsed hours', async () => {
    // Created 100h ago, first reached Done 10h ago -> 90h elapsed vs a 4h
    // target => massively breached. Pre-JL-347 this reported 0h / 'ok'.
    get.mockResolvedValueOnce(QUEUE)
    all
      .mockResolvedValueOnce([issueRow({ id: 10, issue_key: 'P-10', created_at: hoursAgo(100) })]) // issues
      .mockResolvedValueOnce([{ priority: 'High', target_hours: 4 }]) // policies
      .mockResolvedValueOnce([{ issue_id: 10, done_at: hoursAgo(10) }]) // issue_history first-Done

    const res = await request(createApp()).get('/api/queues/3/issues')
    expect(res.status).toBe(200)
    const sla = res.body.issues[0].sla
    expect(sla.status).toBe('breached')
    expect(sla.elapsedHours).toBeCloseTo(90, 0)
    expect(sla.percent).toBeGreaterThan(100)
  })

  it('still measures an open issue to now', async () => {
    get.mockResolvedValueOnce(QUEUE)
    all
      .mockResolvedValueOnce([issueRow({ id: 11, status: 'In Progress', created_at: hoursAgo(2) })])
      .mockResolvedValueOnce([{ priority: 'High', target_hours: 4 }])
    // no Done issues -> no issue_history query

    const res = await request(createApp()).get('/api/queues/3/issues')
    expect(res.status).toBe(200)
    const sla = res.body.issues[0].sla
    expect(sla.status).toBe('ok') // 2h of a 4h budget = 50%
    expect(sla.elapsedHours).toBeCloseTo(2, 0)
  })

  it('falls back to NOW (not created_at) for a Done issue with no history row', async () => {
    // Imported/pruned-history issue: created 100h ago, marked Done, but no
    // issue_history row. Falling back to created_at would report 0h / 'ok' —
    // the exact false-pass JL-347 removes — so the fallback is `now`, which
    // surfaces the data gap loudly instead of hiding a possible breach.
    get.mockResolvedValueOnce(QUEUE)
    all
      .mockResolvedValueOnce([issueRow({ id: 12, created_at: hoursAgo(100) })])
      .mockResolvedValueOnce([{ priority: 'High', target_hours: 4 }])
      .mockResolvedValueOnce([]) // history queried but empty

    const res = await request(createApp()).get('/api/queues/3/issues')
    expect(res.status).toBe(200)
    const sla = res.body.issues[0].sla
    expect(sla.status).toBe('breached')
    expect(sla.elapsedHours).toBeCloseTo(100, 0)
  })

  it('batch-loads first-Done timestamps in ONE query, only for policy-tracked Done issues', async () => {
    get.mockResolvedValueOnce(QUEUE)
    all
      .mockResolvedValueOnce([
        issueRow({ id: 20, issue_key: 'P-20', created_at: hoursAgo(100) }), // Done, High (tracked)
        issueRow({ id: 21, issue_key: 'P-21', created_at: hoursAgo(50) }), // Done, High (tracked)
        issueRow({ id: 22, issue_key: 'P-22', priority: 'Low' }), // Done but no Low policy
        issueRow({ id: 23, issue_key: 'P-23', status: 'To Do' }), // open
      ])
      .mockResolvedValueOnce([{ priority: 'High', target_hours: 200 }])
      .mockResolvedValueOnce([
        { issue_id: 20, done_at: hoursAgo(90) },
        { issue_id: 21, done_at: hoursAgo(40) },
      ])

    const res = await request(createApp()).get('/api/queues/3/issues')
    expect(res.status).toBe(200)

    // Exactly one issue_history query, covering both Done ids at once —
    // never one query per issue.
    const historyCalls = all.mock.calls.filter(([sql]) => sql.includes('issue_history'))
    expect(historyCalls).toHaveLength(1)
    expect(historyCalls[0][1]).toEqual([20, 21])
    expect(historyCalls[0][0]).toContain('MIN(changed_at)')

    const byKey = Object.fromEntries(res.body.issues.map((i) => [i.issue_key, i.sla]))
    expect(byKey['P-20'].elapsedHours).toBeCloseTo(10, 0) // 100h old, done at 90h-ago => 10h
    expect(byKey['P-20'].status).toBe('ok')
    expect(byKey['P-21'].elapsedHours).toBeCloseTo(10, 0)
    expect(byKey['P-22']).toBeNull() // no policy, Done -> no due-date fallback either
  })
})
