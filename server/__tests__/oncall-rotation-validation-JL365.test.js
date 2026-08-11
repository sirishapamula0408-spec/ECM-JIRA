// @vitest-environment node
// JL-365: POST /api/oncall/schedules wrote `rotationType` into
// oncall_schedules.rotation_type with no whitelist, unlike severity, status
// and (since JL-348) timeline kind on this same router. The value is now
// validated against ROTATION_TYPES (daily/weekly/fortnightly/custom) with the
// existing 'weekly' default preserved when the field is omitted.
// Modelled on incident-write-guards-JL348.test.js (db-mock shape + app setup).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

import { makeDbMock } from './helpers/mockDb.js'
vi.mock('../db.js', () => makeDbMock())

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import router, { ROTATION_TYPES, isValidRotationType } from '../routes/incidents.js'

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

/* ================= Legal rotation types are accepted ================= */

describe('JL-365 — legal rotation types are accepted', () => {
  it('accepts every whitelisted rotation type (201)', async () => {
    for (const rotationType of ROTATION_TYPES) {
      vi.clearAllMocks()
      run.mockResolvedValueOnce({ lastID: 5, changes: 1 })
      get.mockResolvedValueOnce({ id: 5, name: 'Primary', rotation_type: rotationType })
      const res = await request(createApp())
        .post('/api/oncall/schedules')
        .send({ name: 'Primary', rotationType })
      expect(res.status).toBe(201)
      expect(res.body.rotation_type).toBe(rotationType)
      expect(run).toHaveBeenCalledWith(
        'INSERT INTO oncall_schedules (name, rotation_type) VALUES (?, ?)',
        ['Primary', rotationType],
      )
    }
  })

  it('defaults to weekly when rotationType is omitted (201)', async () => {
    run.mockResolvedValueOnce({ lastID: 6, changes: 1 })
    get.mockResolvedValueOnce({ id: 6, name: 'Primary', rotation_type: 'weekly' })
    const res = await request(createApp())
      .post('/api/oncall/schedules')
      .send({ name: 'Primary' })
    expect(res.status).toBe(201)
    expect(res.body.rotation_type).toBe('weekly')
    expect(run).toHaveBeenCalledWith(
      'INSERT INTO oncall_schedules (name, rotation_type) VALUES (?, ?)',
      ['Primary', 'weekly'],
    )
  })
})

/* ================= Unknown / malformed values are rejected ================= */

describe('JL-365 — unknown rotation types are rejected', () => {
  it('rejects an unknown rotation type with 400 and issues no insert', async () => {
    const res = await request(createApp())
      .post('/api/oncall/schedules')
      .send({ name: 'Primary', rotationType: 'hourly' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid rotationtype/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a non-string rotation type (number) with 400 rather than coercing', async () => {
    const res = await request(createApp())
      .post('/api/oncall/schedules')
      .send({ name: 'Primary', rotationType: 7 })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a non-string rotation type (object) with 400 rather than coercing', async () => {
    const res = await request(createApp())
      .post('/api/oncall/schedules')
      .send({ name: 'Primary', rotationType: { sneaky: 'weekly' } })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('the 400 body names the allowed values', async () => {
    const res = await request(createApp())
      .post('/api/oncall/schedules')
      .send({ name: 'Primary', rotationType: 'hourly' })
    expect(res.status).toBe(400)
    for (const rotationType of ROTATION_TYPES) {
      expect(res.body.error).toContain(rotationType)
    }
  })
})

/* ================= Predicate mirrors the whitelist ================= */

describe('JL-365 — isValidRotationType mirrors the whitelist', () => {
  it('accepts each legal value and rejects everything else', () => {
    expect(ROTATION_TYPES).toEqual(['daily', 'weekly', 'fortnightly', 'custom'])
    for (const rotationType of ROTATION_TYPES) {
      expect(isValidRotationType(rotationType)).toBe(true)
    }
    expect(isValidRotationType('hourly')).toBe(false)
    expect(isValidRotationType('')).toBe(false)
    expect(isValidRotationType(null)).toBe(false)
    expect(isValidRotationType(7)).toBe(false)
  })
})
