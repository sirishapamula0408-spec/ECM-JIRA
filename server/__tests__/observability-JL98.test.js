// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// --- Mock the db layer so no live PostgreSQL is needed ---
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { get } from '../db.js'
import { shouldLog, formatLine, logger, LEVELS } from '../services/logger.js'
import { requestLogger } from '../middleware/requestLogger.js'
import { livenessHandler, readinessHandler } from '../routes/health.js'

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   1. shouldLog — threshold gating
   ================================================================ */
describe('shouldLog', () => {
  it('emits when level >= threshold', () => {
    expect(shouldLog('error', 'info')).toBe(true)
    expect(shouldLog('warn', 'warn')).toBe(true)
    expect(shouldLog('info', 'debug')).toBe(true)
  })

  it('suppresses when level < threshold', () => {
    expect(shouldLog('debug', 'info')).toBe(false)
    expect(shouldLog('info', 'warn')).toBe(false)
    expect(shouldLog('warn', 'error')).toBe(false)
  })

  it('orders severities debug < info < warn < error', () => {
    expect(LEVELS.debug).toBeLessThan(LEVELS.info)
    expect(LEVELS.info).toBeLessThan(LEVELS.warn)
    expect(LEVELS.warn).toBeLessThan(LEVELS.error)
  })

  it('defaults unknown level/threshold to info severity', () => {
    expect(shouldLog('bogus', 'info')).toBe(true) // info >= info
    expect(shouldLog('debug', 'bogus')).toBe(false) // debug < info
  })
})

/* ================================================================
   2. formatLine — valid single-line JSON with ts/level/msg/fields
   ================================================================ */
describe('formatLine', () => {
  it('emits valid JSON with ts, level, msg first and extra fields merged', () => {
    const line = formatLine({
      ts: '2026-07-10T00:00:00.000Z',
      level: 'info',
      msg: 'hello',
      requestId: 'abc',
      status: 200,
    })
    expect(line).not.toContain('\n')
    const parsed = JSON.parse(line)
    expect(parsed).toEqual({
      ts: '2026-07-10T00:00:00.000Z',
      level: 'info',
      msg: 'hello',
      requestId: 'abc',
      status: 200,
    })
  })

  it('produces parseable JSON even with no extra fields', () => {
    const parsed = JSON.parse(formatLine({ ts: 't', level: 'warn', msg: 'm' }))
    expect(parsed.level).toBe('warn')
    expect(parsed.msg).toBe('m')
  })
})

/* ================================================================
   3. requestLogger — req.id, X-Request-Id header, logs on finish
   ================================================================ */
describe('requestLogger', () => {
  let infoSpy
  beforeEach(() => {
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    infoSpy.mockRestore()
  })

  function fakeRes() {
    const res = new EventEmitter()
    res.headers = {}
    res.statusCode = 200
    res.setHeader = (k, v) => { res.headers[k] = v }
    return res
  }

  it('generates a request id and sets the X-Request-Id response header', () => {
    const req = { headers: {}, method: 'GET', url: '/api/x' }
    const res = fakeRes()
    const next = vi.fn()
    requestLogger(req, res, next)
    expect(req.id).toBeTruthy()
    expect(res.headers['X-Request-Id']).toBe(req.id)
    expect(next).toHaveBeenCalledOnce()
  })

  it('reuses an incoming X-Request-Id header', () => {
    const req = { headers: { 'x-request-id': 'client-123' }, method: 'POST', url: '/api/y' }
    const res = fakeRes()
    requestLogger(req, res, vi.fn())
    expect(req.id).toBe('client-123')
    expect(res.headers['X-Request-Id']).toBe('client-123')
  })

  it('logs one structured line on res finish', () => {
    const req = { headers: {}, method: 'GET', url: '/api/z', originalUrl: '/api/z' }
    const res = fakeRes()
    res.statusCode = 201
    requestLogger(req, res, vi.fn())
    expect(infoSpy).not.toHaveBeenCalled()
    res.emit('finish')
    expect(infoSpy).toHaveBeenCalledOnce()
    const [msg, fields] = infoSpy.mock.calls[0]
    expect(msg).toBe('request')
    expect(fields).toMatchObject({
      requestId: req.id,
      method: 'GET',
      path: '/api/z',
      status: 201,
    })
    expect(typeof fields.durationMs).toBe('number')
  })
})

/* ================================================================
   4. Readiness + liveness handlers
   ================================================================ */
describe('health probes', () => {
  function fakeRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this },
      json(payload) { this.body = payload; return this },
    }
  }

  it('liveness always returns 200 with status ok and uptime', () => {
    const res = fakeRes()
    livenessHandler({}, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.uptime).toBe('number')
  })

  it('readiness returns 200 when the DB SELECT 1 resolves', async () => {
    get.mockResolvedValueOnce({ ok: 1 })
    const res = fakeRes()
    await readinessHandler({}, res)
    expect(get).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('readiness returns 503 when the DB ping rejects', async () => {
    get.mockRejectedValueOnce(new Error('connection refused'))
    const res = fakeRes()
    await readinessHandler({}, res)
    expect(res.statusCode).toBe(503)
    expect(res.body.status).toBe('unavailable')
  })
})
