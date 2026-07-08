import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — no live DB (same pattern as cycle-time-JL51.test.js).
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Mock notifications so alertBreach never touches a real createNotification.
vi.mock('../routes/notifications.js', () => ({
  createNotification: vi.fn().mockResolvedValue(1),
}))

import { all, get, run } from '../db.js'
import { createNotification } from '../routes/notifications.js'
import { errorHandler } from '../middleware/errorHandler.js'
import slaRouter, { slaStatus, elapsedHoursBetween } from '../routes/sla.js'

// Build an app whose fake auth injects the given workspace role.
function createApp(role = 'Admin', isOwner = false) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api', slaRouter)
  app.use(errorHandler)
  return app
}

const HOUR = 1000 * 60 * 60
// ISO timestamp for an issue that is `h` hours old relative to now.
const hoursAgo = (h) => new Date(Date.now() - h * HOUR).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Pure helper: slaStatus classification
   ================================================================ */
describe('JL-52 slaStatus helper', () => {
  it('returns ok below 75% of the target', () => {
    expect(slaStatus(0, 100)).toBe('ok')
    expect(slaStatus(74, 100)).toBe('ok')
    expect(slaStatus(74.9, 100)).toBe('ok')
  })

  it('returns at_risk between 75% and 100% inclusive', () => {
    expect(slaStatus(75, 100)).toBe('at_risk')
    expect(slaStatus(90, 100)).toBe('at_risk')
    expect(slaStatus(100, 100)).toBe('at_risk')
  })

  it('returns breached above 100%', () => {
    expect(slaStatus(100.1, 100)).toBe('breached')
    expect(slaStatus(240, 100)).toBe('breached')
  })

  it('returns null for a missing/invalid target', () => {
    expect(slaStatus(10, 0)).toBeNull()
    expect(slaStatus(10, undefined)).toBeNull()
    expect(slaStatus(10, -5)).toBeNull()
    expect(slaStatus(-1, 100)).toBeNull()
  })

  it('elapsedHoursBetween computes rounded hours and guards bad input', () => {
    const base = Date.parse('2026-01-01T00:00:00.000Z')
    expect(elapsedHoursBetween('2026-01-01T00:00:00.000Z', base + 5 * HOUR)).toBe(5)
    expect(elapsedHoursBetween(null, base)).toBeNull()
    expect(elapsedHoursBetween('not-a-date', base)).toBeNull()
  })
})

/* ================================================================
   Policy CRUD + admin gating
   ================================================================ */
describe('JL-52 SLA policy CRUD', () => {
  it('lists policies scoped by projectId (parameterized)', async () => {
    all.mockResolvedValueOnce([
      { id: 1, project_id: 7, priority: 'High', target_hours: 24, applies_to: 'resolution' },
    ])
    const res = await request(createApp()).get('/api/sla-policies?projectId=7')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    const call = all.mock.calls[0]
    expect(call[0]).toContain('project_id = ?')
    expect(call[1]).toEqual([7])
  })

  it('creates a policy as Admin', async () => {
    run.mockResolvedValueOnce({ lastID: 42, changes: 1 })
    get.mockResolvedValueOnce({ id: 42, project_id: 7, priority: 'High', target_hours: 24, applies_to: 'resolution' })
    const res = await request(createApp('Admin')).post('/api/sla-policies').send({
      projectId: 7, priority: 'High', targetHours: 24,
    })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(42)
    const insert = run.mock.calls[0]
    expect(insert[0]).toMatch(/INSERT INTO sla_policies/)
    expect(insert[1]).toEqual([7, 'High', 24, 'resolution'])
  })

  it('rejects policy creation from a non-Admin (403)', async () => {
    const res = await request(createApp('Member')).post('/api/sla-policies').send({
      projectId: 7, priority: 'High', targetHours: 24,
    })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('validates targetHours must be positive (400)', async () => {
    const res = await request(createApp('Admin')).post('/api/sla-policies').send({
      priority: 'High', targetHours: 0,
    })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('validates appliesTo enum (400)', async () => {
    const res = await request(createApp('Admin')).post('/api/sla-policies').send({
      priority: 'High', targetHours: 24, appliesTo: 'nonsense',
    })
    expect(res.status).toBe(400)
  })

  it('updates a policy as Admin', async () => {
    get
      .mockResolvedValueOnce({ id: 5 }) // existence check
      .mockResolvedValueOnce({ id: 5, project_id: 7, priority: 'High', target_hours: 12, applies_to: 'resolution' })
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(createApp('Admin')).put('/api/sla-policies/5').send({ targetHours: 12 })
    expect(res.status).toBe(200)
    expect(res.body.target_hours).toBe(12)
  })

  it('returns 404 updating a missing policy', async () => {
    get.mockResolvedValueOnce(undefined)
    const res = await request(createApp('Admin')).put('/api/sla-policies/999').send({ targetHours: 12 })
    expect(res.status).toBe(404)
  })

  it('deletes a policy as Admin (parameterized)', async () => {
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(createApp('Admin')).delete('/api/sla-policies/5')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(run.mock.calls[0][1]).toEqual([5])
  })

  it('blocks delete for a Viewer (403)', async () => {
    const res = await request(createApp('Viewer')).delete('/api/sla-policies/5')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   GET /api/reports/sla — status computation
   ================================================================ */
describe('JL-52 GET /api/reports/sla', () => {
  it('requires projectId (400)', async () => {
    const res = await request(createApp()).get('/api/reports/sla')
    expect(res.status).toBe(400)
  })

  it('classifies open issues ok / at_risk / breached from age vs target', async () => {
    all
      // policies (High target = 24h)
      .mockResolvedValueOnce([
        { id: 1, project_id: 7, priority: 'High', target_hours: 24, applies_to: 'resolution' },
      ])
      // issues: one ok (1h), one at_risk (20h = 83%), one breached (48h)
      .mockResolvedValueOnce([
        { id: 10, issue_key: 'P-10', title: 'ok one', priority: 'High', status: 'In Progress', assignee: 'Alice', project_id: 7, created_at: hoursAgo(1) },
        { id: 11, issue_key: 'P-11', title: 'risky', priority: 'High', status: 'To Do', assignee: 'Bob', project_id: 7, created_at: hoursAgo(20) },
        { id: 12, issue_key: 'P-12', title: 'late', priority: 'High', status: 'In Progress', assignee: null, project_id: 7, created_at: hoursAgo(48) },
      ])
    // alertBreach -> get(member) for the breached open issue (assignee null -> not reached, but issue 12 assignee null)
    get.mockResolvedValue(undefined)

    const res = await request(createApp()).get('/api/reports/sla?projectId=7')
    expect(res.status).toBe(200)
    expect(res.body.summary).toMatchObject({ ok: 1, atRisk: 1, breached: 1, noPolicy: 0, total: 3 })
    expect(res.body.ok[0].key).toBe('P-10')
    expect(res.body.atRisk[0].key).toBe('P-11')
    expect(res.body.breached[0].key).toBe('P-12')
    expect(res.body.breached[0].slaStatus).toBe('breached')
    expect(res.body.breached[0].targetHours).toBe(24)
  })

  it('measures Done issues from created_at to first Done (from issue_history)', async () => {
    all
      .mockResolvedValueOnce([
        { id: 1, project_id: 7, priority: 'Medium', target_hours: 100, applies_to: 'resolution' },
      ])
      .mockResolvedValueOnce([
        { id: 20, issue_key: 'P-20', title: 'closed fast', priority: 'Medium', status: 'Done', assignee: 'Alice', project_id: 7, created_at: hoursAgo(500) },
      ])
      // issue_history: done 490h ago -> took 10h -> ok (10% of 100h target)
      .mockResolvedValueOnce([
        { issue_id: 20, done_at: hoursAgo(490) },
      ])

    const res = await request(createApp()).get('/api/reports/sla?projectId=7')
    expect(res.status).toBe(200)
    // Despite being 500h old, time-to-Done was ~10h => ok, not breached.
    expect(res.body.summary).toMatchObject({ ok: 1, breached: 0 })
    expect(res.body.ok[0].key).toBe('P-20')
    expect(res.body.ok[0].elapsedHours).toBeCloseTo(10, 0)
  })

  it('puts issues without a matching policy in noPolicy and does not flag them', async () => {
    all
      .mockResolvedValueOnce([
        { id: 1, project_id: 7, priority: 'High', target_hours: 24, applies_to: 'resolution' },
      ])
      .mockResolvedValueOnce([
        { id: 30, issue_key: 'P-30', title: 'low pri', priority: 'Low', status: 'To Do', assignee: 'Bob', project_id: 7, created_at: hoursAgo(1000) },
      ])

    const res = await request(createApp()).get('/api/reports/sla?projectId=7')
    expect(res.status).toBe(200)
    expect(res.body.summary).toMatchObject({ ok: 0, atRisk: 0, breached: 0, noPolicy: 1, total: 1 })
    expect(res.body.noPolicy[0].key).toBe('P-30')
    // no issue_history query needed (no Done issues) and no notifications
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('creates a best-effort notification for an OPEN breached issue', async () => {
    all
      .mockResolvedValueOnce([
        { id: 1, project_id: 7, priority: 'High', target_hours: 10, applies_to: 'resolution' },
      ])
      .mockResolvedValueOnce([
        { id: 40, issue_key: 'P-40', title: 'breach', priority: 'High', status: 'In Progress', assignee: 'Alice', project_id: 7, created_at: hoursAgo(50) },
      ])
    get.mockResolvedValue({ email: 'alice@test.com' })

    const res = await request(createApp()).get('/api/reports/sla?projectId=7')
    expect(res.status).toBe(200)
    expect(res.body.summary.breached).toBe(1)
    // alert fired (fire-and-forget) — allow the microtask to run
    await new Promise((r) => setTimeout(r, 0))
    expect(createNotification).toHaveBeenCalledTimes(1)
    expect(createNotification.mock.calls[0][0]).toMatchObject({
      recipientEmail: 'alice@test.com',
      type: 'sla_breach',
      issueId: 40,
    })
  })
})
