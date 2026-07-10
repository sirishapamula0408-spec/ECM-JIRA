import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module used by webhooks.js
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { getEventCatalog, EVENT_CATALOG } from '../services/events.js'
import webhooksRouter, { buildReplayPayload } from '../routes/webhooks.js'
import eventsRouter from '../routes/events.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(role = 'Admin', isOwner = false) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api/webhooks', webhooksRouter)
  app.use('/api/events', eventsRouter)
  app.use(errorHandler)
  return app
}

function okFetch() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ================================================================
   Event catalog
   ================================================================ */
describe('getEventCatalog (JL-150)', () => {
  it('returns a non-empty catalog including issue.created', () => {
    const catalog = getEventCatalog()
    expect(Array.isArray(catalog)).toBe(true)
    expect(catalog.length).toBeGreaterThan(0)
    const types = catalog.map((e) => e.type)
    expect(types).toContain('issue.created')
    expect(types).toContain('comment.created')
    // Each entry has type/description/category
    for (const e of catalog) {
      expect(typeof e.type).toBe('string')
      expect(typeof e.description).toBe('string')
      expect(typeof e.category).toBe('string')
    }
  })

  it('returns a fresh copy (callers cannot mutate the shared constant)', () => {
    const a = getEventCatalog()
    a[0].type = 'MUTATED'
    expect(EVENT_CATALOG[0].type).not.toBe('MUTATED')
  })

  it('GET /api/events/catalog returns the catalog', async () => {
    const res = await request(createApp('Member')).get('/api/events/catalog')
    expect(res.status).toBe(200)
    expect(res.body.map((e) => e.type)).toContain('issue.created')
  })
})

/* ================================================================
   buildReplayPayload — pure helper
   ================================================================ */
describe('buildReplayPayload (JL-150)', () => {
  it('reconstructs the payload from a stringified JSONB log row', () => {
    const log = { event: 'issue.created', payload: JSON.stringify({ event: 'issue.created', data: { key: 'IT-1' } }) }
    const { event, payload, headers } = buildReplayPayload(log)
    expect(event).toBe('issue.created')
    expect(payload).toEqual({ event: 'issue.created', data: { key: 'IT-1' } })
    expect(headers['Content-Type']).toBe('application/json')
    // No secret -> no signature header
    expect(headers['X-Hub-Signature-256']).toBeUndefined()
  })

  it('accepts an already-parsed object payload', () => {
    const log = { event: 'comment.created', payload: { data: { id: 9 } } }
    const { payload } = buildReplayPayload(log)
    expect(payload).toEqual({ data: { id: 9 } })
  })

  it('adds an HMAC signature header when a secret is provided', () => {
    const log = { event: 'issue.updated', payload: { data: {} } }
    const { headers } = buildReplayPayload(log, 'topsecret')
    expect(headers['X-Hub-Signature-256']).toMatch(/^sha256=[a-f0-9]{64}$/)
  })
})

/* ================================================================
   Delivery console — GET /api/webhooks/deliveries
   ================================================================ */
describe('GET /api/webhooks/deliveries (JL-150)', () => {
  it('returns rows for an admin', async () => {
    all.mockResolvedValue([
      { id: 1, webhook_id: 2, event: 'issue.created', success: true, response_status: 200, webhook_name: 'hook' },
    ])
    const res = await request(createApp('Admin')).get('/api/webhooks/deliveries')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(all).toHaveBeenCalled()
  })

  it('applies webhookId, status and event filters (params passed to query)', async () => {
    all.mockResolvedValue([])
    await request(createApp('Admin')).get('/api/webhooks/deliveries?webhookId=7&status=failed&event=issue.created')
    const [sql, params] = all.mock.calls[0]
    expect(sql).toContain('WHERE')
    expect(sql).toContain('l.success = FALSE')
    // webhookId 7 and event filter value are in params (plus limit/offset)
    expect(params).toContain(7)
    expect(params).toContain('issue.created')
  })

  it('rejects non-admin with 403', async () => {
    const res = await request(createApp('Member')).get('/api/webhooks/deliveries')
    expect(res.status).toBe(403)
  })
})

/* ================================================================
   Replay — POST /api/webhooks/deliveries/:id/replay
   ================================================================ */
describe('POST /api/webhooks/deliveries/:id/replay (JL-150)', () => {
  it('re-sends the payload and writes a NEW delivery log row', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('webhook_logs')) {
        return { id: 5, webhook_id: 2, event: 'issue.created', payload: { event: 'issue.created', data: { key: 'IT-1' } } }
      }
      if (sql.includes('FROM webhooks')) {
        return { id: 2, name: 'hook', url: 'https://replay-target', secret: 'sec' }
      }
      return null
    })
    run.mockResolvedValue({ lastID: 99 })
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const res = await request(createApp('Admin')).post('/api/webhooks/deliveries/5/replay')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.replayedFrom).toBe(5)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://replay-target',
      expect.objectContaining({ method: 'POST' }),
    )
    // A new webhook_logs row is inserted for the replay
    expect(run).toHaveBeenCalled()
    expect(run.mock.calls.some((c) => String(c[0]).includes('INSERT INTO webhook_logs'))).toBe(true)
  })

  it('returns 404 when the delivery does not exist', async () => {
    get.mockResolvedValue(null)
    const res = await request(createApp('Admin')).post('/api/webhooks/deliveries/999/replay')
    expect(res.status).toBe(404)
  })

  it('returns 404 when the parent webhook was deleted', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('webhook_logs')) {
        return { id: 5, webhook_id: 2, event: 'issue.created', payload: {} }
      }
      return null // webhook lookup returns null
    })
    const res = await request(createApp('Admin')).post('/api/webhooks/deliveries/5/replay')
    expect(res.status).toBe(404)
  })

  it('rejects non-admin with 403 and never sends', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await request(createApp('Member')).post('/api/webhooks/deliveries/5/replay')
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/* ================================================================
   Delivery detail — GET /api/webhooks/deliveries/:id
   ================================================================ */
describe('GET /api/webhooks/deliveries/:id (JL-150)', () => {
  it('returns the delivery detail with payload + response', async () => {
    get.mockResolvedValue({
      id: 5, webhook_id: 2, event: 'issue.created',
      payload: { data: {} }, response_status: 200, response_body: 'ok', success: true, webhook_name: 'hook',
    })
    const res = await request(createApp('Admin')).get('/api/webhooks/deliveries/5')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(5)
    expect(res.body.response_body).toBe('ok')
  })

  it('returns 404 for a missing delivery', async () => {
    get.mockResolvedValue(null)
    const res = await request(createApp('Admin')).get('/api/webhooks/deliveries/404')
    expect(res.status).toBe(404)
  })
})
