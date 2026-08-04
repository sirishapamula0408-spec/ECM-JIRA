// @vitest-environment node
// JL-348: close incident write-endpoint leaks — POST /incidents,
// PATCH /incidents/:id and POST /incidents/:id/timeline carried no role
// middleware (the router mount only authenticates), so a read-only workspace
// Viewer could open SEV1 incidents, resolve any incident, or reassign the
// commander. They now carry requireRole('Member'); the timeline `kind` field
// (previously written unvalidated) is now whitelisted against TIMELINE_KINDS.
// Modelled on viewer-mutation-gates-JL229.test.js (Viewer gating assertions)
// and incidents-JL143.test.js (db-mock shape).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

import { makeDbMock } from './helpers/mockDb.js'
vi.mock('../db.js', () => makeDbMock())

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import router, { TIMELINE_KINDS, isValidTimelineKind } from '../routes/incidents.js'

function createApp(role) {
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

/* ============== Viewer is blocked on all three write routes ============== */

describe('JL-348 — incident write routes are gated at Member', () => {
  it('Viewer gets 403 opening an incident (POST /api/incidents)', async () => {
    const res = await request(createApp('Viewer'))
      .post('/api/incidents')
      .send({ title: 'DB down', severity: 'SEV1' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/insufficient/i)
    // No db write (or read) must have been issued
    expect(run).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('Viewer gets 403 updating an incident (PATCH /api/incidents/:id)', async () => {
    const res = await request(createApp('Viewer'))
      .patch('/api/incidents/3')
      .send({ status: 'resolved', commanderEmail: 'attacker@x.com' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('Viewer gets 403 adding a timeline entry (POST /api/incidents/:id/timeline)', async () => {
    const res = await request(createApp('Viewer'))
      .post('/api/incidents/3/timeline')
      .send({ note: 'sneaky' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
})

/* ================= Member (and above) is unaffected ================= */

describe('JL-348 — Member can still perform incident writes', () => {
  it('Member can open an incident (201)', async () => {
    run.mockResolvedValueOnce({ lastID: 7, changes: 1 }) // insert incident
    run.mockResolvedValueOnce({ lastID: 1, changes: 1 }) // insert timeline
    get.mockResolvedValueOnce({ id: 7, title: 'DB down', severity: 'SEV1', status: 'open' })
    all.mockResolvedValueOnce([{ id: 1, kind: 'created' }])

    const res = await request(createApp('Member'))
      .post('/api/incidents')
      .send({ title: 'DB down', severity: 'SEV1' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(7)
  })

  it('Member can update an incident (200)', async () => {
    get.mockResolvedValueOnce({ id: 3, status: 'open', severity: 'SEV2' }) // existing
    run.mockResolvedValueOnce({ changes: 1 }) // update
    run.mockResolvedValueOnce({ lastID: 9, changes: 1 }) // timeline
    get.mockResolvedValueOnce({ id: 3, status: 'resolved', resolved_at: '2026-01-01T00:00:00Z' })

    const res = await request(createApp('Member'))
      .patch('/api/incidents/3')
      .send({ status: 'resolved' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('resolved')
  })

  it('Member can add a timeline note (201)', async () => {
    get.mockResolvedValueOnce({ id: 3 }) // incident exists
    run.mockResolvedValueOnce({ lastID: 11, changes: 1 })
    get.mockResolvedValueOnce({ id: 11, incident_id: 3, kind: 'note', note: 'mitigation applied' })

    const res = await request(createApp('Member'))
      .post('/api/incidents/3/timeline')
      .send({ note: 'mitigation applied' })
    expect(res.status).toBe(201)
    expect(res.body.kind).toBe('note')
  })
})

/* ================= Timeline `kind` is whitelisted ================= */

describe('JL-348 — timeline kind validation', () => {
  it('rejects an unknown kind with 400 and issues no insert', async () => {
    get.mockResolvedValueOnce({ id: 3 }) // incident exists
    const res = await request(createApp('Member'))
      .post('/api/incidents/3/timeline')
      .send({ note: 'x', kind: '<script>alert(1)</script>' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid kind/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('accepts every whitelisted kind', async () => {
    for (const kind of TIMELINE_KINDS) {
      vi.clearAllMocks()
      get.mockResolvedValueOnce({ id: 3 })
      run.mockResolvedValueOnce({ lastID: 5, changes: 1 })
      get.mockResolvedValueOnce({ id: 5, incident_id: 3, kind, note: 'x' })
      const res = await request(createApp('Member'))
        .post('/api/incidents/3/timeline')
        .send({ note: 'x', kind })
      expect(res.status).toBe(201)
    }
  })

  it('isValidTimelineKind mirrors the whitelist', () => {
    expect(isValidTimelineKind('note')).toBe(true)
    expect(isValidTimelineKind('resolved')).toBe(true)
    expect(isValidTimelineKind('bogus')).toBe(false)
  })
})
