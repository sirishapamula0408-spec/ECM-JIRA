import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import router, {
  currentOnCall,
  computeIncidentDuration,
  isValidSeverity,
  isValidStatus,
} from '../routes/incidents.js'

// Create an app; role defaults to workspace Admin so requireRole('Admin') passes.
function createApp(role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use('/api', router)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ============================ Pure helpers ============================ */

describe('currentOnCall', () => {
  const shifts = [
    { user_email: 'a@x.com', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-01-08T00:00:00Z' },
    { user_email: 'b@x.com', starts_at: '2026-01-08T00:00:00Z', ends_at: '2026-01-15T00:00:00Z' },
  ]

  it('picks the shift covering now', () => {
    const shift = currentOnCall(shifts, new Date('2026-01-10T12:00:00Z'))
    expect(shift).not.toBeNull()
    expect(shift.user_email).toBe('b@x.com')
  })

  it('picks the earlier shift for an earlier now', () => {
    const shift = currentOnCall(shifts, new Date('2026-01-02T00:00:00Z'))
    expect(shift.user_email).toBe('a@x.com')
  })

  it('returns null when no shift covers now', () => {
    expect(currentOnCall(shifts, new Date('2026-02-01T00:00:00Z'))).toBeNull()
  })

  it('returns null for empty/invalid input', () => {
    expect(currentOnCall([], new Date())).toBeNull()
    expect(currentOnCall(null, new Date())).toBeNull()
  })
})

describe('computeIncidentDuration', () => {
  it('computes ms/minutes for a resolved incident', () => {
    const d = computeIncidentDuration('2026-01-01T00:00:00Z', '2026-01-01T01:30:00Z')
    expect(d.ms).toBe(90 * 60 * 1000)
    expect(d.minutes).toBe(90)
    expect(d.ongoing).toBe(false)
  })

  it('uses now for an open (unresolved) incident', () => {
    const now = new Date('2026-01-01T02:00:00Z')
    const d = computeIncidentDuration('2026-01-01T00:00:00Z', null, now)
    expect(d.minutes).toBe(120)
    expect(d.ongoing).toBe(true)
  })

  it('never returns negative durations', () => {
    const d = computeIncidentDuration('2026-01-01T05:00:00Z', '2026-01-01T00:00:00Z')
    expect(d.ms).toBe(0)
  })
})

describe('validation helpers', () => {
  it('validates severity', () => {
    expect(isValidSeverity('SEV1')).toBe(true)
    expect(isValidSeverity('SEV5')).toBe(false)
  })
  it('validates status', () => {
    expect(isValidStatus('investigating')).toBe(true)
    expect(isValidStatus('closed')).toBe(false)
  })
})

/* ============================ Incident routes ============================ */

describe('POST /api/incidents', () => {
  it('creates an incident and records a timeline entry', async () => {
    run.mockResolvedValueOnce({ lastID: 7, changes: 1 }) // insert incident
    run.mockResolvedValueOnce({ lastID: 1, changes: 1 }) // insert timeline
    get.mockResolvedValueOnce({ id: 7, title: 'DB down', severity: 'SEV1', status: 'open' })
    all.mockResolvedValueOnce([{ id: 1, kind: 'created' }])

    const res = await request(createApp())
      .post('/api/incidents')
      .send({ title: 'DB down', severity: 'SEV1' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe(7)
    // Two runs: incident insert + timeline insert
    expect(run).toHaveBeenCalledTimes(2)
    const timelineInsert = run.mock.calls[1][0]
    expect(timelineInsert).toMatch(/INSERT INTO incident_timeline/i)
  })

  it('rejects a bad severity with 400', async () => {
    const res = await request(createApp())
      .post('/api/incidents')
      .send({ title: 'x', severity: 'SEV9' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a bad status with 400', async () => {
    const res = await request(createApp())
      .post('/api/incidents')
      .send({ title: 'x', status: 'closed' })
    expect(res.status).toBe(400)
  })

  it('requires a title', async () => {
    const res = await request(createApp()).post('/api/incidents').send({})
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/incidents/:id', () => {
  it('sets resolved_at and adds a timeline entry when resolving', async () => {
    get.mockResolvedValueOnce({ id: 3, status: 'open', severity: 'SEV2' }) // existing
    run.mockResolvedValueOnce({ changes: 1 }) // update
    run.mockResolvedValueOnce({ lastID: 9, changes: 1 }) // timeline
    get.mockResolvedValueOnce({ id: 3, status: 'resolved', resolved_at: '2026-01-01T00:00:00Z' })

    const res = await request(createApp())
      .patch('/api/incidents/3')
      .send({ status: 'resolved' })

    expect(res.status).toBe(200)
    const updateSql = run.mock.calls[0][0]
    expect(updateSql).toMatch(/resolved_at = NOW\(\)/i)
    expect(res.body.status).toBe('resolved')
  })

  it('rejects an invalid status with 400', async () => {
    get.mockResolvedValueOnce({ id: 3, status: 'open', severity: 'SEV2' })
    const res = await request(createApp()).patch('/api/incidents/3').send({ status: 'nope' })
    expect(res.status).toBe(400)
  })

  it('404s for a missing incident', async () => {
    get.mockResolvedValueOnce(undefined)
    const res = await request(createApp()).patch('/api/incidents/99').send({ status: 'monitoring' })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/incidents/:id', () => {
  it('returns the incident with its timeline', async () => {
    get.mockResolvedValueOnce({ id: 5, title: 'x' })
    all.mockResolvedValueOnce([{ id: 1, note: 'first' }])
    const res = await request(createApp()).get('/api/incidents/5')
    expect(res.status).toBe(200)
    expect(res.body.timeline).toHaveLength(1)
  })
})

/* ============================ On-call routes ============================ */

describe('GET /api/oncall/current', () => {
  it('returns the user covering now', async () => {
    const now = Date.now()
    all.mockResolvedValueOnce([
      { user_email: 'onduty@x.com', starts_at: new Date(now - 3600000).toISOString(), ends_at: new Date(now + 3600000).toISOString() },
    ])
    const res = await request(createApp()).get('/api/oncall/current?scheduleId=1')
    expect(res.status).toBe(200)
    expect(res.body.onCall).toBe('onduty@x.com')
  })

  it('returns null when nobody is on call', async () => {
    all.mockResolvedValueOnce([])
    const res = await request(createApp()).get('/api/oncall/current')
    expect(res.status).toBe(200)
    expect(res.body.onCall).toBeNull()
  })
})

describe('POST /api/oncall/schedules (Admin gate)', () => {
  it('creates a schedule as Admin', async () => {
    run.mockResolvedValueOnce({ lastID: 2, changes: 1 })
    get.mockResolvedValueOnce({ id: 2, name: 'Primary', rotation_type: 'weekly' })
    const res = await request(createApp('Admin')).post('/api/oncall/schedules').send({ name: 'Primary' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Primary')
  })

  it('rejects a non-Admin with 403', async () => {
    const res = await request(createApp('Member')).post('/api/oncall/schedules').send({ name: 'Primary' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})
