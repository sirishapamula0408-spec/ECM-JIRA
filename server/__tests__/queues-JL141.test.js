import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — no live DB.
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

import { all, get, run } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import queueRouter, { buildQueueWhere, matchesQueue } from '../routes/queues.js'

// Build an app whose fake auth injects the given workspace role + memberId.
function createApp(role = 'Admin', { isOwner = false, memberId = 1 } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'u@test.com', memberId, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api', queueRouter)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Pure helper: buildQueueWhere
   ================================================================ */
describe('JL-141 buildQueueWhere', () => {
  it('returns an empty clause with no params for an empty filter', () => {
    expect(buildQueueWhere({})).toEqual({ clause: '', params: [] })
    expect(buildQueueWhere(null)).toEqual({ clause: '', params: [] })
    expect(buildQueueWhere(undefined)).toEqual({ clause: '', params: [] })
  })

  it('builds an IN clause for statuses', () => {
    const { clause, params } = buildQueueWhere({ statuses: ['To Do', 'In Progress'] })
    expect(clause).toBe('status IN (?, ?)')
    expect(params).toEqual(['To Do', 'In Progress'])
  })

  it('builds an IN clause for priorities', () => {
    const { clause, params } = buildQueueWhere({ priorities: ['High'] })
    expect(clause).toBe('priority IN (?)')
    expect(params).toEqual(['High'])
  })

  it('builds an equality clause for assignee', () => {
    const { clause, params } = buildQueueWhere({ assignee: 'Alice' })
    expect(clause).toBe('assignee = ?')
    expect(params).toEqual(['Alice'])
  })

  it('combines multiple criteria with AND in order', () => {
    const { clause, params } = buildQueueWhere({
      statuses: ['To Do'],
      priorities: ['High', 'Medium'],
      assignee: 'Bob',
    })
    expect(clause).toBe('status IN (?) AND priority IN (?, ?) AND assignee = ?')
    expect(params).toEqual(['To Do', 'High', 'Medium', 'Bob'])
  })

  it('ignores empty assignee and empty arrays', () => {
    expect(buildQueueWhere({ statuses: [], priorities: [], assignee: '' })).toEqual({ clause: '', params: [] })
  })

  it('builds an EXISTS clause for labels', () => {
    const { clause, params } = buildQueueWhere({ labels: ['urgent', 'vip'] })
    expect(clause).toContain('EXISTS')
    expect(clause).toContain('l.name IN (?, ?)')
    expect(params).toEqual(['urgent', 'vip'])
  })
})

/* ================================================================
   Pure predicate: matchesQueue
   ================================================================ */
describe('JL-141 matchesQueue', () => {
  const issue = { status: 'In Progress', priority: 'High', assignee: 'Alice', labels: ['vip'] }

  it('matches everything for an empty filter', () => {
    expect(matchesQueue(issue, {})).toBe(true)
  })

  it('matches on status inclusion', () => {
    expect(matchesQueue(issue, { statuses: ['In Progress', 'To Do'] })).toBe(true)
    expect(matchesQueue(issue, { statuses: ['Done'] })).toBe(false)
  })

  it('matches on priority inclusion', () => {
    expect(matchesQueue(issue, { priorities: ['High'] })).toBe(true)
    expect(matchesQueue(issue, { priorities: ['Low'] })).toBe(false)
  })

  it('matches on assignee equality', () => {
    expect(matchesQueue(issue, { assignee: 'Alice' })).toBe(true)
    expect(matchesQueue(issue, { assignee: 'Bob' })).toBe(false)
  })

  it('matches on any-of labels', () => {
    expect(matchesQueue(issue, { labels: ['vip'] })).toBe(true)
    expect(matchesQueue(issue, { labels: ['other'] })).toBe(false)
  })

  it('requires all criteria to hold (AND)', () => {
    expect(matchesQueue(issue, { statuses: ['In Progress'], assignee: 'Alice' })).toBe(true)
    expect(matchesQueue(issue, { statuses: ['In Progress'], assignee: 'Bob' })).toBe(false)
  })

  it('returns false for a null issue', () => {
    expect(matchesQueue(null, {})).toBe(false)
  })
})

/* ================================================================
   CRUD authorization
   ================================================================ */
describe('JL-141 queue CRUD', () => {
  it('lists queues scoped by project (parameterized)', async () => {
    all.mockResolvedValueOnce([
      { id: 1, project_id: 7, name: 'Triage', description: null, filter: { statuses: ['To Do'] }, order_by: 'created_at', position: 0 },
    ])
    const res = await request(createApp()).get('/api/queues?project=7')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const call = all.mock.calls[0]
    expect(call[0]).toContain('project_id = ?')
    expect(call[1]).toEqual([7])
  })

  it('creates a queue as Admin', async () => {
    run.mockResolvedValueOnce({ lastID: 5, changes: 1 })
    get.mockResolvedValueOnce({ id: 5, project_id: 7, name: 'Triage', description: null, filter: { statuses: ['To Do'] }, order_by: 'created_at', position: 0 })
    const res = await request(createApp('Admin')).post('/api/queues').send({
      name: 'Triage', projectId: 7, filter: { statuses: ['To Do'] },
    })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(5)
    expect(run.mock.calls[0][0]).toMatch(/INSERT INTO queues/)
  })

  it('rejects create from a non-Admin with no project role (403)', async () => {
    // canManageQueue -> project_members lookup returns no row
    get.mockResolvedValueOnce(undefined)
    const res = await request(createApp('Member')).post('/api/queues').send({
      name: 'Triage', projectId: 7, filter: {},
    })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('allows create from a project Lead', async () => {
    get
      .mockResolvedValueOnce({ role: 'Lead' }) // project_members lookup
      .mockResolvedValueOnce({ id: 6, project_id: 7, name: 'Q', description: null, filter: {}, order_by: 'created_at', position: 0 }) // reload
    run.mockResolvedValueOnce({ lastID: 6, changes: 1 })
    const res = await request(createApp('Member')).post('/api/queues').send({
      name: 'Q', projectId: 7, filter: {},
    })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(6)
  })

  it('validates name is required (400)', async () => {
    const res = await request(createApp('Admin')).post('/api/queues').send({ projectId: 7 })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('deletes a queue as Admin', async () => {
    get.mockResolvedValueOnce({ id: 5, project_id: 7 })
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(createApp('Admin')).delete('/api/queues/5')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('blocks delete for a Viewer (403)', async () => {
    get.mockResolvedValueOnce({ id: 5, project_id: 7 }) // queue exists
      .mockResolvedValueOnce(undefined) // no project role
    const res = await request(createApp('Viewer')).delete('/api/queues/5')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   GET /api/queues/:id/issues — applies the filter
   ================================================================ */
describe('JL-141 GET /api/queues/:id/issues', () => {
  it('applies the queue filter + project scope to the issues query (asserts params)', async () => {
    get.mockResolvedValueOnce({
      id: 3, project_id: 7, name: 'High priority', order_by: 'created_at',
      filter: { statuses: ['To Do', 'In Progress'], priorities: ['High'], assignee: 'Alice' },
    })
    all
      // issues query
      .mockResolvedValueOnce([
        { id: 10, issue_key: 'P-10', title: 'a', priority: 'High', status: 'To Do', assignee: 'Alice', project_id: 7, due_date: null, created_at: new Date().toISOString() },
      ])
      // sla policies query
      .mockResolvedValueOnce([])

    const res = await request(createApp()).get('/api/queues/3/issues')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
    expect(res.body.issues[0].issue_key).toBe('P-10')

    const issuesCall = all.mock.calls[0]
    expect(issuesCall[0]).toContain('project_id = ?')
    expect(issuesCall[0]).toContain('status IN (?, ?)')
    expect(issuesCall[0]).toContain('priority IN (?)')
    expect(issuesCall[0]).toContain('assignee = ?')
    expect(issuesCall[0]).toContain('ORDER BY created_at ASC')
    // project_id first, then filter params in buildQueueWhere order
    expect(issuesCall[1]).toEqual([7, 'To Do', 'In Progress', 'High', 'Alice'])
  })

  it('annotates issues with a policy-based SLA status', async () => {
    const created = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString() // 50h ago
    get.mockResolvedValueOnce({ id: 4, project_id: 7, name: 'Q', order_by: 'created_at', filter: {} })
    all
      .mockResolvedValueOnce([
        { id: 20, issue_key: 'P-20', title: 'late', priority: 'High', status: 'In Progress', assignee: 'Bob', project_id: 7, due_date: null, created_at: created },
      ])
      .mockResolvedValueOnce([{ priority: 'High', target_hours: 10 }]) // 50h vs 10h -> breached

    const res = await request(createApp()).get('/api/queues/4/issues')
    expect(res.status).toBe(200)
    expect(res.body.issues[0].sla).toMatchObject({ source: 'policy', status: 'breached', targetHours: 10 })
  })

  it('returns 404 for a missing queue', async () => {
    get.mockResolvedValueOnce(undefined)
    const res = await request(createApp()).get('/api/queues/999/issues')
    expect(res.status).toBe(404)
  })
})
