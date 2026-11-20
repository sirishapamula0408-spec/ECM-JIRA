// @vitest-environment node
// JL-483: the Create / Edit sprint dialog sends planned dates. POST and PATCH
// /api/sprints accept startDate / endDate (YYYY-MM-DD), refuse bad ones,
// store them as UTC midnight in start_date / end_date, and derive the display
// range from them. Omitting them on PATCH leaves the stored dates alone.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(), all: vi.fn(), get: vi.fn(), columnExists: vi.fn(), tableExists: vi.fn(), withTransaction: vi.fn(),
}))
vi.mock('../services/events.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import sprintRoutes, { parseSprintDay, formatSprintRange, readSprintDates } from '../routes/sprints.js'

const ADMIN = { id: 1, email: 'admin@x.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
let stored

beforeEach(() => {
  vi.clearAllMocks()
  stored = { id: 11, project_id: 4, name: 'ECM Sprint 1', date_range: '19 Jan - 2 Feb', is_started: false, start_date: new Date('2026-01-19T00:00:00Z'), end_date: new Date('2026-02-02T00:00:00Z'), goal: null }
  get.mockImplementation(async (sql, params = []) => {
    if (/SELECT id, key FROM projects/.test(sql)) return { id: 4, key: 'ECM' }
    if (/COUNT\(\*\)/.test(sql)) return { count: 1 }
    if (/SELECT project_id FROM sprints WHERE id/.test(sql)) return { project_id: 4 }
    if (/SELECT start_date, end_date FROM sprints/.test(sql)) return { start_date: stored.start_date, end_date: stored.end_date }
    if (/FROM sprints WHERE id/.test(sql)) return { ...stored, id: Number(params[0]) }
    return undefined
  })
  run.mockResolvedValue({ lastID: 12, changes: 1 })
})

function app() {
  const a = express()
  a.use(express.json())
  a.use((req, _res, next) => { req.user = { ...ADMIN }; next() })
  a.use('/api/sprints', sprintRoutes)
  a.use(errorHandler)
  return a
}

const insert = () => run.mock.calls.find(([sql]) => /INSERT INTO sprints/.test(sql))
const update = () => run.mock.calls.find(([sql]) => /^UPDATE sprints SET name/.test(sql))

describe('helpers', () => {
  it('parseSprintDay accepts real calendar days only', () => {
    expect(parseSprintDay('2026-01-19')).toBe('2026-01-19')
    expect(parseSprintDay('')).toBeNull()
    expect(parseSprintDay(null)).toBeNull()
    for (const bad of ['2026-02-30', '19/01/2026', '2026-1-19', 'tomorrow']) expect(parseSprintDay(bad)).toBeUndefined()
  })

  it('formatSprintRange matches the existing "19 Jan - 2 Feb" style', () => {
    expect(formatSprintRange('2026-01-19', '2026-02-02')).toBe('19 Jan - 2 Feb')
    expect(formatSprintRange('2026-12-28', '2027-01-11')).toBe('28 Dec - 11 Jan')
    expect(formatSprintRange('2026-01-19', null)).toBe('From 19 Jan')
    expect(formatSprintRange(null, null)).toBeNull()
  })

  it('readSprintDates checks end against the stored start when only one changes', () => {
    expect(readSprintDates({ endDate: '2026-01-10' }, { start_date: '2026-01-19' }).error).toMatch(/on or after/)
    expect(readSprintDates({}, {}).dates).toEqual({})
  })
})

describe('POST /api/sprints', () => {
  it('stores the planned dates and derives the range', async () => {
    const res = await request(app()).post('/api/sprints').send({ projectId: 4, name: 'ECM Sprint 2', startDate: '2026-03-02', endDate: '2026-03-16', goal: 'Payments' })
    expect(res.status).toBe(201)
    const [sql, params] = insert()
    expect(sql).toContain('start_date, end_date')
    expect(params).toEqual([4, 'ECM Sprint 2', '2 Mar - 16 Mar', false, 'Payments', '2026-03-02T00:00:00Z', '2026-03-16T00:00:00Z'])
  })

  it('without dates behaves as before ("Upcoming", no dates)', async () => {
    await request(app()).post('/api/sprints').send({ projectId: 4 })
    const [, params] = insert()
    expect(params).toEqual([4, 'ECM Sprint 2', 'Upcoming', false, null, null, null])
  })

  it('refuses a bad date or an end before the start (400), creating nothing', async () => {
    for (const body of [{ startDate: '2026-02-30' }, { startDate: '2026-03-16', endDate: '2026-03-02' }]) {
      const res = await request(app()).post('/api/sprints').send({ projectId: 4, ...body })
      expect(res.status).toBe(400)
    }
    expect(insert()).toBeUndefined()
  })
})

describe('PATCH /api/sprints/:id', () => {
  it('updates dates and re-derives the range from them', async () => {
    const res = await request(app()).patch('/api/sprints/11').send({ name: 'ECM Sprint 1', dateRange: '19 Jan - 2 Feb', startDate: '2026-01-19', endDate: '2026-02-09', goal: 'Login' })
    expect(res.status).toBe(200)
    const [sql, params] = update()
    expect(sql).toMatch(/start_date = \?, end_date = \?/)
    expect(params).toEqual(['ECM Sprint 1', '19 Jan - 9 Feb', '2026-01-19T00:00:00Z', '2026-02-09T00:00:00Z', 'Login', 11])
  })

  it('leaves the stored dates alone when the body has none (e.g. other callers that only rename)', async () => {
    await request(app()).patch('/api/sprints/11').send({ name: 'Renamed', dateRange: '19 Jan - 2 Feb' })
    const [sql, params] = update()
    expect(sql).not.toMatch(/start_date|end_date/)
    expect(params).toEqual(['Renamed', '19 Jan - 2 Feb', 11])
  })

  it('refuses an end date before the stored start', async () => {
    const res = await request(app()).patch('/api/sprints/11').send({ name: 'X', endDate: '2026-01-01' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/on or after the start date/)
    expect(update()).toBeUndefined()
  })
})
