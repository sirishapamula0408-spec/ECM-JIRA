// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

/* ================================================================
   JL-323 — Outbound email delivery is unverifiable.

   sendMail() resolves with { ok:false } on an SMTP rejection rather
   than throwing, so every caller's .catch()/try-catch was dead code
   and endpoints reported success unconditionally. Nothing was
   persisted, so "did the invite actually go out?" was unanswerable.

   These tests pin down:
     1. every send outcome writes exactly one terminal email_log row
     2. email_log logging failures never break the send
     3. the admin email-log endpoints filter/aggregate correctly
     4. callers observe { ok:false } instead of assuming success
   ================================================================ */

// --- Mock the db module ---
vi.mock('../db.js', () => {
  const run = vi.fn()
  const all = vi.fn()
  const get = vi.fn()
  return { run, all, get, withTransaction: vi.fn(async (fn) => fn({ run, all, get })) }
})

// --- Mock nodemailer so no real SMTP is touched ---
const { mockSendMail, mockVerify } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockVerify: vi.fn(),
}))
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail, verify: mockVerify })),
  },
}))

// --- Config: SMTP configured by default so the real send path is exercised ---
const { SMTP_ON, SMTP_OFF } = vi.hoisted(() => {
  const on = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    SMTP_FROM: 'noreply@example.com',
    APP_URL: 'http://localhost:5173',
  }
  return { SMTP_ON: on, SMTP_OFF: { ...on, SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '' } }
})

vi.mock('../config.js', () => ({ ...SMTP_ON }))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, { role = 'Admin' } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use('/api', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

/** Pull the email_log INSERT out of the run() mock's calls, if any. */
function emailLogInsert() {
  return run.mock.calls.find((c) => String(c[0]).includes('INSERT INTO email_log'))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  // Re-assert the SMTP-configured config for every test. Without this, the
  // doMock inside the "skipped" case below leaks into subsequent tests.
  vi.doMock('../config.js', () => ({ ...SMTP_ON }))
  run.mockResolvedValue({ lastID: 1, changes: 1 })
})

describe('JL-323 — sendMail writes a terminal email_log row', () => {
  it('records status "sent" with the provider messageId on success', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'abc-123', accepted: ['x@y.com'] })
    const { sendMail } = await import('../utils/mailer.js')

    const result = await sendMail({
      to: 'x@y.com', subject: 'Hi', text: 't',
      type: 'invite', relatedEntity: 'invitation:42',
    })

    expect(result.ok).toBe(true)
    const call = emailLogInsert()
    expect(call).toBeTruthy()
    // [recipient, subject, email_type, related_entity, status, message_id, error]
    expect(call[1]).toEqual(['x@y.com', 'Hi', 'invite', 'invitation:42', 'sent', 'abc-123', null])
  })

  it('records status "failed" with the error when SMTP rejects', async () => {
    mockSendMail.mockRejectedValue(new Error('535 Authentication failed'))
    const { sendMail } = await import('../utils/mailer.js')

    const result = await sendMail({ to: 'x@y.com', subject: 'Hi', type: 'invite' })

    // The critical regression: a rejection must NOT surface as success.
    expect(result.ok).toBe(false)
    expect(result.error).toContain('535')

    const call = emailLogInsert()
    expect(call[1][4]).toBe('failed')
    expect(call[1][6]).toContain('535 Authentication failed')
  })

  it('does not throw when the send fails — callers must read result.ok', async () => {
    mockSendMail.mockRejectedValue(new Error('nope'))
    const { sendMail } = await import('../utils/mailer.js')

    // This is exactly why a bare .catch() on the promise was dead code.
    await expect(sendMail({ to: 'x@y.com', subject: 'S' })).resolves.toMatchObject({ ok: false })
  })

  it('records status "skipped" when SMTP is not configured', async () => {
    vi.doMock('../config.js', () => ({ ...SMTP_OFF }))
    const { sendMail } = await import('../utils/mailer.js')

    const result = await sendMail({ to: 'x@y.com', subject: 'Hi', type: 'invite' })

    expect(result.ok).toBe(false)
    expect(result.skipped).toBe(true)
    expect(mockSendMail).not.toHaveBeenCalled()

    const call = emailLogInsert()
    expect(call[1][4]).toBe('skipped')
  })

  it('defaults email_type to "other" when the caller does not tag it', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'm', accepted: [] })
    const { sendMail } = await import('../utils/mailer.js')

    await sendMail({ to: 'x@y.com', subject: 'S' })

    expect(emailLogInsert()[1][2]).toBe('other')
  })

  it('still delivers when the email_log write itself fails', async () => {
    // Logging is best-effort: a broken log table must not fail the send.
    mockSendMail.mockResolvedValue({ messageId: 'm', accepted: [] })
    run.mockRejectedValue(new Error('relation "email_log" does not exist'))
    const { sendMail } = await import('../utils/mailer.js')

    await expect(sendMail({ to: 'x@y.com', subject: 'S' })).resolves.toMatchObject({ ok: true })
  })
})

describe('JL-323 — getLatestEmailStatuses', () => {
  it('returns the newest attempt per address, keyed lower-case', async () => {
    all.mockResolvedValue([
      { recipient: 'a@x.com', status: 'sent', error: null, message_id: 'm1', created_at: '2026-08-01' },
      { recipient: 'b@x.com', status: 'failed', error: 'bounced', message_id: null, created_at: '2026-08-02' },
    ])
    const { getLatestEmailStatuses } = await import('../utils/mailer.js')

    const map = await getLatestEmailStatuses(['A@X.com', 'b@x.com'])

    expect(map.get('a@x.com').status).toBe('sent')
    expect(map.get('b@x.com').error).toBe('bounced')
  })

  it('short-circuits on an empty list without querying', async () => {
    const { getLatestEmailStatuses } = await import('../utils/mailer.js')
    const map = await getLatestEmailStatuses([])
    expect(map.size).toBe(0)
    expect(all).not.toHaveBeenCalled()
  })

  it('degrades to an empty Map if the query fails', async () => {
    all.mockRejectedValue(new Error('no such table'))
    const { getLatestEmailStatuses } = await import('../utils/mailer.js')
    await expect(getLatestEmailStatuses(['a@x.com'])).resolves.toEqual(new Map())
  })
})

describe('JL-323 — GET /api/email-log', () => {
  it('returns rows plus a total, newest first', async () => {
    all.mockResolvedValue([{ id: 2, recipient: 'a@x.com', status: 'failed' }])
    get.mockResolvedValue({ count: 1 })
    const routes = await import('../routes/emailLog.js')

    const res = await request(createApp(routes)).get('/api/email-log')

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.rows).toHaveLength(1)
    expect(all.mock.calls[0][0]).toContain('ORDER BY created_at DESC')
  })

  it('filters by status', async () => {
    all.mockResolvedValue([])
    get.mockResolvedValue({ count: 0 })
    const routes = await import('../routes/emailLog.js')

    const res = await request(createApp(routes)).get('/api/email-log?status=failed')

    expect(res.status).toBe(200)
    expect(all.mock.calls[0][0]).toContain('status = ')
    expect(all.mock.calls[0][1]).toContain('failed')
  })

  it('rejects an unknown status (400)', async () => {
    const routes = await import('../routes/emailLog.js')
    const res = await request(createApp(routes)).get('/api/email-log?status=bogus')
    expect(res.status).toBe(400)
  })

  it('caps limit at 200 so a huge log cannot be dumped in one request', async () => {
    all.mockResolvedValue([])
    get.mockResolvedValue({ count: 0 })
    const routes = await import('../routes/emailLog.js')

    await request(createApp(routes)).get('/api/email-log?limit=99999')

    const params = all.mock.calls[0][1]
    expect(params[params.length - 2]).toBe(200)
  })

  it('is Admin-only', async () => {
    const routes = await import('../routes/emailLog.js')
    const res = await request(createApp(routes, { role: 'Member' })).get('/api/email-log')
    expect(res.status).toBe(403)
  })
})

describe('JL-323 — GET /api/email-log/summary', () => {
  it('aggregates counts and lists recent failures', async () => {
    all
      .mockResolvedValueOnce([{ status: 'sent', count: 5 }, { status: 'failed', count: 2 }])
      .mockResolvedValueOnce([{ id: 9, recipient: 'a@x.com', error: 'bounced' }])
    const routes = await import('../routes/emailLog.js')

    const res = await request(createApp(routes)).get('/api/email-log/summary')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ sent: 5, failed: 2, skipped: 0, total: 7 })
    expect(res.body.recentFailures).toHaveLength(1)
  })
})
