import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module used by webhooks.js / events.js
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { emitEvent } from '../services/events.js'
import webhooksRouter from '../routes/webhooks.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Build an app mounting the real webhooks router with a stubbed auth user.
function createApp(role = 'Admin', isOwner = false) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api/webhooks', webhooksRouter)
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
   emitEvent — event-type subscription routing
   ================================================================ */
describe('emitEvent (JL-59 event system)', () => {
  it('fires only webhooks subscribed to the event type or the "*" wildcard', async () => {
    all.mockResolvedValue([
      { id: 1, name: 'exact', url: 'https://exact', secret: '', events: ['issue.created'] },
      { id: 2, name: 'wildcard', url: 'https://wildcard', secret: '', events: ['*'] },
      { id: 3, name: 'other', url: 'https://other', secret: '', events: ['comment.created'] },
    ])
    run.mockResolvedValue({ lastID: 1 })
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    await emitEvent('issue.created', { key: 'IT-1' })

    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toContain('https://exact')
    expect(urls).toContain('https://wildcard')
    expect(urls).not.toContain('https://other')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skips a webhook whose subscription list does not include the event', async () => {
    all.mockResolvedValue([
      { id: 3, name: 'other', url: 'https://other', secret: '', events: ['comment.created'] },
    ])
    run.mockResolvedValue({ lastID: 1 })
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    await emitEvent('issue.created', { key: 'IT-2' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delivers to a webhook with an empty subscription list (treated as all events)', async () => {
    all.mockResolvedValue([
      { id: 4, name: 'catchall', url: 'https://catchall', secret: '', events: [] },
    ])
    run.mockResolvedValue({ lastID: 1 })
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    await emitEvent('sprint.started', { id: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://catchall')
  })

  it('signs the payload with HMAC when the webhook has a secret', async () => {
    all.mockResolvedValue([
      { id: 5, name: 'signed', url: 'https://signed', secret: 'topsecret', events: ['*'] },
    ])
    run.mockResolvedValue({ lastID: 1 })
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    await emitEvent('issue.updated', { key: 'IT-3' })

    const opts = fetchMock.mock.calls[0][1]
    expect(opts.headers['X-Hub-Signature-256']).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('never throws even if delivery lookup fails (fire-and-forget)', async () => {
    // A DB failure while selecting subscribed webhooks must be swallowed.
    all.mockRejectedValue(new Error('db down'))

    await expect(emitEvent('issue.created', { key: 'IT-4' })).resolves.toBeUndefined()
  })
})

/* ================================================================
   Manual replay — POST /api/webhooks/logs/:logId/replay
   ================================================================ */
describe('POST /api/webhooks/logs/:logId/replay (JL-59)', () => {
  it('re-sends a past delivery from webhook_logs (Admin)', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('webhook_logs')) {
        return { id: 5, webhook_id: 2, event: 'issue.created', payload: { event: 'issue.created', data: { key: 'IT-1' } } }
      }
      if (sql.includes('FROM webhooks')) {
        return { id: 2, name: 'hook', url: 'https://replay-target', secret: 'sec' }
      }
      return null
    })
    run.mockResolvedValue({ lastID: 1 })
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const res = await request(createApp('Admin')).post('/api/webhooks/logs/5/replay')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.replayedFrom).toBe(5)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://replay-target',
      expect.objectContaining({ method: 'POST' }),
    )
    // A new delivery log row is written for the replay
    expect(run).toHaveBeenCalled()
  })

  it('returns 404 when the delivery log does not exist', async () => {
    get.mockResolvedValue(null)

    const res = await request(createApp('Admin')).post('/api/webhooks/logs/999/replay')

    expect(res.status).toBe(404)
  })

  it('returns 404 when the parent webhook no longer exists', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('webhook_logs')) {
        return { id: 5, webhook_id: 2, event: 'issue.created', payload: {} }
      }
      return null // webhook lookup returns null
    })

    const res = await request(createApp('Admin')).post('/api/webhooks/logs/5/replay')

    expect(res.status).toBe(404)
  })

  it('rejects non-admin users with 403', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)

    const res = await request(createApp('Member')).post('/api/webhooks/logs/5/replay')

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
