import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

/* ------------------------------------------------------------------ *
 * JL-83 — Real SMTP email delivery (notifications & password reset)
 *
 * These tests use NO live SMTP server and NO live DB. nodemailer and
 * db.js are mocked. We toggle the mocked SMTP config per test to verify
 * both the "configured" (real send) and "unconfigured" (graceful no-op)
 * code paths.
 * ------------------------------------------------------------------ */

// nodemailer mock — stable references shared across module resets.
const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn()
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }))
  return { sendMailMock, createTransportMock }
})
vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}))

// db.js mock — stable references so they survive vi.resetModules().
const { dbGet, dbRun, dbAll } = vi.hoisted(() => ({
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  dbAll: vi.fn(),
}))
vi.mock('../db.js', () => ({ get: dbGet, run: dbRun, all: dbAll }))

// config.js mock — mutable object whose SMTP_* values we set per test.
const configState = vi.hoisted(() => ({
  PORT: 4000,
  DATABASE_URL: 'postgresql://x',
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '7d',
  APP_URL: 'http://localhost:5173',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_FROM: 'noreply@ecm-jira.local',
}))
vi.mock('../config.js', () => configState)

function configureSmtp() {
  configState.SMTP_HOST = 'smtp.test.com'
  configState.SMTP_USER = 'mailer@test.com'
  configState.SMTP_PASS = 'secret'
  configState.SMTP_FROM = 'noreply@test.com'
}
function unconfigureSmtp() {
  configState.SMTP_HOST = ''
  configState.SMTP_USER = ''
  configState.SMTP_PASS = ''
}

// Build a fresh auth app AFTER config + module reset so the mailer picks up
// the current SMTP config snapshot.
async function loadAuthApp() {
  vi.resetModules()
  const authRoutes = (await import('../routes/auth.js')).default
  const { errorHandler } = await import('../middleware/errorHandler.js')
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  sendMailMock.mockResolvedValue({ messageId: 'msg-123', accepted: ['to@test.com'] })
  unconfigureSmtp()
})

/* ================================================================
   mailer.sendMail — transport creation + graceful no-op
   ================================================================ */
describe('mailer.sendMail', () => {
  it('builds a transport and sends when SMTP is configured', async () => {
    configureSmtp()
    vi.resetModules()
    const { sendMail, isSmtpConfigured } = await import('../utils/mailer.js')

    expect(isSmtpConfigured()).toBe(true)

    const result = await sendMail({ to: 'user@test.com', subject: 'Hi', text: 'body' })

    expect(createTransportMock).toHaveBeenCalledTimes(1)
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.test.com', auth: { user: 'mailer@test.com', pass: 'secret' } }),
    )
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com', subject: 'Hi', from: 'noreply@test.com' }),
    )
    expect(result.ok).toBe(true)
    expect(result.messageId).toBe('msg-123')
  })

  it('no-ops gracefully (no transport, no throw) when SMTP is unconfigured', async () => {
    unconfigureSmtp()
    vi.resetModules()
    const { sendMail, isSmtpConfigured } = await import('../utils/mailer.js')

    expect(isSmtpConfigured()).toBe(false)

    const result = await sendMail({ to: 'user@test.com', subject: 'Hi', text: 'body' })

    expect(createTransportMock).not.toHaveBeenCalled()
    expect(sendMailMock).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.skipped).toBe(true)
  })

  it('never throws even when the transport send fails', async () => {
    configureSmtp()
    sendMailMock.mockRejectedValueOnce(new Error('smtp down'))
    vi.resetModules()
    const { sendMail } = await import('../utils/mailer.js')

    const result = await sendMail({ to: 'user@test.com', subject: 'Hi', text: 'body' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('smtp down')
  })
})

/* ================================================================
   POST /api/auth/forgot-password — sends reset email
   ================================================================ */
describe('POST /api/auth/forgot-password', () => {
  it('sends the reset email and HIDES the token when SMTP is configured', async () => {
    configureSmtp()
    dbGet.mockResolvedValue({ id: 7, email: 'known@gmail.com' })
    dbRun.mockResolvedValue({ lastID: 1, changes: 1 })

    const app = await loadAuthApp()
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'known@gmail.com' })

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/reset link/i)
    // Token must NOT leak in the response when email delivery is active.
    expect(res.body.resetToken).toBeUndefined()

    // Email was actually dispatched via the transport.
    expect(createTransportMock).toHaveBeenCalled()
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'known@gmail.com', subject: expect.stringMatching(/reset/i) }),
    )
  })

  it('returns the token (dev fallback) and does NOT send when SMTP is unconfigured', async () => {
    unconfigureSmtp()
    dbGet.mockResolvedValue({ id: 7, email: 'known@gmail.com' })
    dbRun.mockResolvedValue({ lastID: 1, changes: 1 })

    const app = await loadAuthApp()
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'known@gmail.com' })

    expect(res.status).toBe(200)
    // Dev fallback: token exposed so testing works without a mail server.
    expect(res.body.resetToken).toBeDefined()
    expect(typeof res.body.resetToken).toBe('string')

    // No real transport built, but the request still succeeds.
    expect(createTransportMock).not.toHaveBeenCalled()
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('still succeeds (generic message, no email) when the account does not exist', async () => {
    configureSmtp()
    dbGet.mockResolvedValue(null) // no user

    const app = await loadAuthApp()
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'ghost@gmail.com' })

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/reset link/i)
    expect(res.body.resetToken).toBeUndefined()
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})

/* ================================================================
   createNotification — best-effort email on opt-in
   ================================================================ */
describe('createNotification email delivery', () => {
  async function loadNotifications() {
    vi.resetModules()
    return import('../routes/notifications.js')
  }

  it('sends an email when the recipient has email_enabled', async () => {
    configureSmtp()
    // INSERT notification returns id; then prefs lookup returns email_enabled.
    dbRun.mockResolvedValue({ lastID: 42, changes: 1 })
    dbGet.mockResolvedValue({ email_enabled: true, muted_types: [] })

    const { createNotification } = await loadNotifications()
    const id = await createNotification({
      recipientEmail: 'recip@test.com',
      type: 'mention',
      title: 'You were mentioned',
      message: 'hello there',
      actorEmail: 'actor@test.com',
    })

    // Allow the fire-and-forget email promise to settle.
    await new Promise((r) => setImmediate(r))

    expect(id).toBe(42)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'recip@test.com', subject: 'You were mentioned' }),
    )
  })

  it('does NOT email when email is disabled in preferences', async () => {
    configureSmtp()
    dbRun.mockResolvedValue({ lastID: 43, changes: 1 })
    dbGet.mockResolvedValue({ email_enabled: false, muted_types: [] })

    const { createNotification } = await loadNotifications()
    await createNotification({
      recipientEmail: 'recip@test.com',
      type: 'mention',
      title: 'Ping',
      actorEmail: 'actor@test.com',
    })
    await new Promise((r) => setImmediate(r))

    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('does NOT email when the notification type is muted', async () => {
    configureSmtp()
    dbRun.mockResolvedValue({ lastID: 44, changes: 1 })
    dbGet.mockResolvedValue({ email_enabled: true, muted_types: ['mention'] })

    const { createNotification } = await loadNotifications()
    await createNotification({
      recipientEmail: 'recip@test.com',
      type: 'mention',
      title: 'Ping',
      actorEmail: 'actor@test.com',
    })
    await new Promise((r) => setImmediate(r))

    expect(sendMailMock).not.toHaveBeenCalled()
  })
})
