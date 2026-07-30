// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

/* ------------------------------------------------------------------ *
 * Mocks
 * ------------------------------------------------------------------ */

// db is unused by the mail-test route but imported by the notifications module.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Mock nodemailer so verify()/sendMail never touch the network. Used by the
// REAL mailer (imported via importActual) in the verifyMailer() unit tests.
const transporterMock = {
  verify: vi.fn(),
  sendMail: vi.fn(),
}
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => transporterMock) },
}))

// Configured SMTP for the verifyMailer() unit tests.
vi.mock('../config.js', () => ({
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_USER: 'user@example.com',
  SMTP_PASS: 'secret',
  SMTP_FROM: 'ECM-JIRA <no-reply@example.com>',
  APP_URL: 'http://localhost:5173',
}))

// Mock the mailer module for the ROUTE tests so we can drive the reported
// configured/ok/sent/console-fallback state deterministically.
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn(),
  verifyMailer: vi.fn(),
  isSmtpConfigured: vi.fn(),
}))

import { sendMail, verifyMailer, isSmtpConfigured } from '../utils/mailer.js'
import { errorHandler } from '../middleware/errorHandler.js'

/**
 * Build an app mounting the notifications router with a stubbed auth user.
 * requireRole('Admin') (the real middleware) reads workspaceRole/isOwner.
 */
async function createApp(user) {
  const mod = await import('../routes/notifications.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = user
    next()
  })
  app.use('/api/notifications', mod.default)
  app.use(errorHandler)
  return app
}

const adminUser = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
const memberUser = { id: 2, email: 'member@test.com', memberId: 2, workspaceRole: 'Member', isOwner: false }

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   POST /api/notifications/mail-test — admin SMTP test endpoint
   ================================================================ */
describe('POST /api/notifications/mail-test', () => {
  it('returns 403 for a non-admin user', async () => {
    const app = await createApp(memberUser)
    const res = await request(app).post('/api/notifications/mail-test')
    expect(res.status).toBe(403)
    // The mailer must not be exercised when access is denied.
    expect(verifyMailer).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('success path: configured + verified + sent', async () => {
    verifyMailer.mockResolvedValue({ configured: true, ok: true })
    isSmtpConfigured.mockReturnValue(true)
    sendMail.mockResolvedValue({ ok: true, messageId: 'abc', accepted: ['admin@test.com'] })

    const app = await createApp(adminUser)
    const res = await request(app).post('/api/notifications/mail-test')

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      configured: true,
      ok: true,
      sent: true,
      consoleFallback: false,
      to: 'admin@test.com',
      error: null,
    })
    // Test email goes to the requesting admin's own address.
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@test.com' }))
  })

  it('failure path: verify fails → ok:false with error, not sent', async () => {
    verifyMailer.mockResolvedValue({ configured: true, ok: false, error: 'ECONNREFUSED' })
    isSmtpConfigured.mockReturnValue(true)
    sendMail.mockResolvedValue({ ok: false, error: 'ECONNREFUSED' })

    const app = await createApp(adminUser)
    const res = await request(app).post('/api/notifications/mail-test')

    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(true)
    expect(res.body.ok).toBe(false)
    expect(res.body.sent).toBe(false)
    expect(res.body.error).toBe('ECONNREFUSED')
  })

  it('console-fallback path: SMTP unset → configured:false, consoleFallback:true', async () => {
    verifyMailer.mockResolvedValue({ configured: false, ok: false })
    isSmtpConfigured.mockReturnValue(false)
    // sendMail console-fallback returns skipped:true.
    sendMail.mockResolvedValue({ ok: false, skipped: true, accepted: ['admin@test.com'], messageId: 'console-fallback' })

    const app = await createApp(adminUser)
    const res = await request(app).post('/api/notifications/mail-test')

    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(false)
    expect(res.body.ok).toBe(false)
    expect(res.body.sent).toBe(false)
    expect(res.body.consoleFallback).toBe(true)
  })
})

/* ================================================================
   verifyMailer() — real implementation over mocked nodemailer/config
   ================================================================ */
describe('verifyMailer()', () => {
  it('returns { configured:true, ok:true } when transporter.verify() succeeds', async () => {
    const actual = await vi.importActual('../utils/mailer.js')
    transporterMock.verify.mockResolvedValueOnce(true)

    const result = await actual.verifyMailer()
    expect(result).toEqual({ configured: true, ok: true })
  })

  it('returns { configured:true, ok:false, error } when verify() throws', async () => {
    const actual = await vi.importActual('../utils/mailer.js')
    transporterMock.verify.mockRejectedValueOnce(new Error('auth failed'))

    const result = await actual.verifyMailer()
    expect(result.configured).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('auth failed')
  })
})
