// @vitest-environment node
//
// JL-236 — Webhook SSRF hardening + event-name validation.
// Covers the POST/PATCH validation added to server/routes/webhooks.js:
//   - non-http(s) schemes (file:/ftp:/javascript:) → 400
//   - unknown/typo'd event names → 400 listing the allowed events
//   - over-long URLs (> 2000 chars) → 400
//   - WEBHOOK_BLOCK_PRIVATE gating of loopback/private hosts → 400
//   - a valid https URL + valid events → success
// Uses the mocked-db + supertest pattern from collaboration-modules.test.js;
// the auth stub sets an Admin workspace role to satisfy requireRole('Admin').

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  isPrivateHost,
  validateWebhookUrl,
  validateWebhookEvents,
} from '../routes/webhooks.js'
import { EVENT_TYPES } from '../services/events.js'

function createApp(routeModule, mountPath = '/api') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  delete process.env.WEBHOOK_BLOCK_PRIVATE
  const mod = await import('../routes/webhooks.js')
  app = createApp(mod)
})

afterEach(() => {
  delete process.env.WEBHOOK_BLOCK_PRIVATE
})

/* ---------------------------------------------------------------- */
/* Pure helpers                                                     */
/* ---------------------------------------------------------------- */
describe('JL-236 pure helpers', () => {
  describe('isPrivateHost', () => {
    it('flags localhost and loopback/private/link-local literals', () => {
      for (const h of [
        'localhost', 'app.localhost', '127.0.0.1', '127.5.6.7', '::1', '::',
        '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.2',
        '0.0.0.0', 'fe80::1', 'fc00::1', 'fd12:3456::1', '',
      ]) {
        expect(isPrivateHost(h)).toBe(true)
      }
    })

    it('allows public hosts and public IPs', () => {
      for (const h of [
        'hooks.slack.com', 'example.com', '8.8.8.8', '1.1.1.1',
        '172.15.0.1', '172.32.0.1', '11.0.0.1', '2606:4700:4700::1111',
      ]) {
        expect(isPrivateHost(h)).toBe(false)
      }
    })
  })

  describe('validateWebhookUrl', () => {
    it('accepts a normal https URL', () => {
      expect(validateWebhookUrl('https://hooks.slack.com/services/x')).toBeNull()
    })

    it('rejects non-http(s) schemes', () => {
      expect(validateWebhookUrl('file:///etc/passwd')).toMatch(/scheme/i)
      expect(validateWebhookUrl('ftp://example.com')).toMatch(/scheme/i)
      expect(validateWebhookUrl('javascript:alert(1)')).toMatch(/scheme/i)
    })

    it('rejects a malformed URL', () => {
      expect(validateWebhookUrl('not a url')).toBeTruthy()
    })

    it('rejects over-long URLs', () => {
      const longUrl = `https://example.com/${'a'.repeat(2100)}`
      expect(validateWebhookUrl(longUrl)).toMatch(/at most 2000/i)
    })

    it('only blocks private hosts when blockPrivate=true', () => {
      expect(validateWebhookUrl('http://127.0.0.1/hook', false)).toBeNull()
      expect(validateWebhookUrl('http://127.0.0.1/hook', true)).toMatch(/not allowed/i)
      expect(validateWebhookUrl('http://localhost:4000/hook', true)).toMatch(/not allowed/i)
      expect(validateWebhookUrl('https://hooks.slack.com/x', true)).toBeNull()
    })
  })

  describe('validateWebhookEvents', () => {
    it('accepts catalog events and the wildcard', () => {
      expect(validateWebhookEvents(['*'])).toBeNull()
      expect(validateWebhookEvents([EVENT_TYPES[0], EVENT_TYPES[1]])).toBeNull()
      expect(validateWebhookEvents([])).toBeNull()
      expect(validateWebhookEvents(undefined)).toBeNull()
    })

    it('rejects unknown events and lists the allowed ones', () => {
      const err = validateWebhookEvents(['issue.craeted'])
      expect(err).toMatch(/issue\.craeted/)
      expect(err).toMatch(/Allowed events/i)
      expect(err).toContain(EVENT_TYPES[0])
    })

    it('rejects a non-array events value', () => {
      expect(validateWebhookEvents('issue.created')).toMatch(/must be an array/i)
    })
  })
})

/* ---------------------------------------------------------------- */
/* POST /api/webhooks                                               */
/* ---------------------------------------------------------------- */
describe('JL-236 POST /api — create webhook hardening', () => {
  it('rejects a file: scheme URL with 400', async () => {
    const res = await request(app).post('/api').send({
      name: 'Bad', url: 'file:///etc/passwd', events: ['*'],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/scheme/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an ftp: scheme URL with 400', async () => {
    const res = await request(app).post('/api').send({
      name: 'Bad', url: 'ftp://example.com/x', events: ['*'],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/scheme/i)
  })

  it('rejects an unknown/typo event with 400 + allowed list', async () => {
    const res = await request(app).post('/api').send({
      name: 'Typo', url: 'https://hooks.slack.com/x', events: ['issue.craeted'],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/issue\.craeted/)
    expect(res.body.error).toMatch(/Allowed events/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an over-long URL with 400', async () => {
    const res = await request(app).post('/api').send({
      name: 'Long', url: `https://example.com/${'a'.repeat(2100)}`, events: ['*'],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at most 2000/i)
  })

  it('rejects a private host with 400 when WEBHOOK_BLOCK_PRIVATE=true', async () => {
    process.env.WEBHOOK_BLOCK_PRIVATE = 'true'
    const res = await request(app).post('/api').send({
      name: 'Loop', url: 'http://127.0.0.1:8080/hook', events: ['*'],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not allowed/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('allows a private host when WEBHOOK_BLOCK_PRIVATE is off (default)', async () => {
    run.mockResolvedValue({ lastID: 7 })
    get.mockResolvedValue({ id: 7, name: 'Loop', url: 'http://127.0.0.1:8080/hook' })
    const res = await request(app).post('/api').send({
      name: 'Loop', url: 'http://127.0.0.1:8080/hook', events: ['*'],
    })
    expect(res.status).toBe(201)
  })

  it('creates a webhook for a valid https URL + valid events', async () => {
    run.mockResolvedValue({ lastID: 1 })
    get.mockResolvedValue({ id: 1, name: 'Slack', url: 'https://hooks.slack.com/x' })
    const res = await request(app).post('/api').send({
      name: 'Slack', url: 'https://hooks.slack.com/x', events: [EVENT_TYPES[0]],
    })
    expect(res.status).toBe(201)
    expect(run).toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------- */
/* PATCH /api/webhooks/:id                                          */
/* ---------------------------------------------------------------- */
describe('JL-236 PATCH /api/:id — update webhook hardening', () => {
  it('rejects a bad scheme on update with 400', async () => {
    get.mockResolvedValueOnce({ id: 1, name: 'Slack', url: 'https://hooks.slack.com/x' })
    const res = await request(app).patch('/api/1').send({ url: 'javascript:alert(1)' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/scheme/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an unknown event on update with 400', async () => {
    get.mockResolvedValueOnce({ id: 1, name: 'Slack', url: 'https://hooks.slack.com/x' })
    const res = await request(app).patch('/api/1').send({ events: ['nope.event'] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Allowed events/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a private host on update when WEBHOOK_BLOCK_PRIVATE=true', async () => {
    process.env.WEBHOOK_BLOCK_PRIVATE = 'true'
    get.mockResolvedValueOnce({ id: 1, name: 'Slack', url: 'https://hooks.slack.com/x' })
    const res = await request(app).patch('/api/1').send({ url: 'http://10.0.0.5/hook' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not allowed/i)
  })

  it('updates with a valid https URL + valid events', async () => {
    get
      .mockResolvedValueOnce({ id: 1, name: 'Slack', url: 'https://old.example.com' })
      .mockResolvedValueOnce({ id: 1, name: 'Slack', url: 'https://new.example.com' })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).patch('/api/1').send({
      url: 'https://new.example.com/hook', events: [EVENT_TYPES[1], '*'],
    })
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalled()
  })
})
