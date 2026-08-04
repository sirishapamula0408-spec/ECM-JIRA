// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

/* ------------------------------------------------------------------ *
 * JL-361 — the invitation email must carry the invitation token.
 *
 * The invite flow generates a token, stores it with an expiry and validates it
 * in GET /api/invitations/:token and POST /api/invitations/:token/accept — but
 * buildInviteEmail linked to the bare app URL, so the recipient never received
 * the token and that entire path was unreachable from the actual email.
 *
 * These tests pin: the token is in the link, in BOTH the html and text parts,
 * URL-encoded, built from the configured APP_URL, and identical to the token on
 * the invitations row that was just written (create AND resend).
 * ------------------------------------------------------------------ */

// --- db mock (no live database) ---
const { dbGet, dbRun, dbAll } = vi.hoisted(() => ({
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  dbAll: vi.fn(),
}))
vi.mock('../db.js', () => ({
  get: dbGet,
  run: dbRun,
  all: dbAll,
  withTransaction: vi.fn(async (fn) => fn({ run: dbRun, all: dbAll, get: dbGet })),
  getSetting: vi.fn(async (_key, fallback = null) => fallback),
  setSetting: vi.fn(),
}))

// --- nodemailer mock (never touch the network) ---
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn(), verify: vi.fn() })) },
}))

// --- config mock: mutable so APP_URL can be driven per test ---
const configState = vi.hoisted(() => ({
  PORT: 4000,
  DATABASE_URL: 'postgresql://x',
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '7d',
  APP_URL: 'https://jira.example.com',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_FROM: 'noreply@ecm-jira.local',
}))
vi.mock('../config.js', () => configState)

// --- mailer: keep the REAL builders (that is what is under test) but capture
//     sendMail so the rendered email body can be inspected. ---
const { sendMailSpy } = vi.hoisted(() => ({
  sendMailSpy: vi.fn().mockResolvedValue({ ok: true, messageId: 'test' }),
}))
vi.mock('../utils/mailer.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    sendMail: sendMailSpy,
    getLatestEmailStatuses: vi.fn().mockResolvedValue(new Map()),
  }
})

import { errorHandler } from '../middleware/errorHandler.js'

const DEFAULT_APP_URL = 'https://jira.example.com'

/** Re-import the mailer so it picks up the current APP_URL snapshot. */
async function loadMailer() {
  vi.resetModules()
  return import('../utils/mailer.js')
}

async function createInvitationsApp() {
  vi.resetModules()
  const mod = await import('../routes/invitations.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/invitations', mod.default)
  app.use(errorHandler)
  return app
}

/** The token the route actually persisted (INSERT INTO invitations, param 3). */
function storedToken() {
  const insert = dbRun.mock.calls.find((c) => /INSERT INTO invitations/.test(c[0]))
  return insert?.[1]?.[2]
}

/** The email body handed to sendMail. */
function sentEmail() {
  expect(sendMailSpy).toHaveBeenCalledTimes(1)
  return sendMailSpy.mock.calls[0][0]
}

beforeEach(() => {
  vi.clearAllMocks()
  configState.APP_URL = DEFAULT_APP_URL
  sendMailSpy.mockResolvedValue({ ok: true, messageId: 'test' })
})

/* ================================================================
   buildInviteEmail — the link itself
   ================================================================ */
describe('JL-361 buildInviteEmail embeds the invitation token', () => {
  const token = 'a1b2c3'.padEnd(64, 'f')

  it('puts an accept URL carrying the token in BOTH the html and the text part', async () => {
    const { buildInviteEmail } = await loadMailer()
    const { html, text } = buildInviteEmail({
      recipientName: 'newbie',
      invitedBy: 'admin@test.com',
      role: 'Member',
      token,
    })

    const expected = `${DEFAULT_APP_URL}/accept-invite?token=${token}`
    expect(html).toContain(expected)
    // A text-only client must still be able to accept.
    expect(text).toContain(expected)
    // And the link has to be clickable, not just printed.
    expect(html).toContain(`href="${expected}"`)
  })

  it('URL-encodes the token', async () => {
    const { buildInviteEmail } = await loadMailer()
    const awkward = 'tok en+with/reserved=chars&more'
    const { html, text } = buildInviteEmail({
      recipientName: 'newbie',
      invitedBy: 'admin@test.com',
      role: 'Member',
      token: awkward,
    })

    const encoded = encodeURIComponent(awkward)
    expect(encoded).not.toBe(awkward) // guard: the fixture really needs encoding
    expect(html).toContain(`token=${encoded}`)
    expect(text).toContain(`token=${encoded}`)
    expect(html).not.toContain(`token=${awkward}`)
  })

  it('builds the link from the configured APP_URL (and trims a trailing slash)', async () => {
    configState.APP_URL = 'https://team.example.org/'
    const { buildInviteEmail } = await loadMailer()
    const { html, text } = buildInviteEmail({
      recipientName: 'newbie',
      invitedBy: 'admin@test.com',
      role: 'Member',
      token,
    })

    const expected = `https://team.example.org/accept-invite?token=${token}`
    expect(html).toContain(expected)
    expect(text).toContain(expected)
    expect(html).not.toContain('//accept-invite')
  })

  it('falls back to the dev app URL when APP_URL is blank — same as the reset email', async () => {
    configState.APP_URL = ''
    const { buildInviteEmail } = await loadMailer()
    const { html, text } = buildInviteEmail({
      recipientName: 'newbie',
      invitedBy: 'admin@test.com',
      role: 'Member',
      token,
    })

    const expected = `http://localhost:5173/accept-invite?token=${token}`
    expect(html).toContain(expected)
    expect(text).toContain(expected)
  })

  it('leaves the tokenless (members.js) invite email pointing at the bare app URL', async () => {
    // JL-329: the other invite path creates the member row directly and has no
    // token to redeem — it must not gain a link that cannot work.
    const { buildInviteEmail } = await loadMailer()
    const { html, text } = buildInviteEmail({
      recipientName: 'newbie',
      invitedBy: 'admin@test.com',
      role: 'Member',
    })

    expect(html).not.toContain('/accept-invite')
    expect(text).not.toContain('/accept-invite')
    expect(text).toContain(DEFAULT_APP_URL)
  })
})

/* ================================================================
   The routes must pass the stored token to the builder
   ================================================================ */
describe('JL-361 POST /api/invitations sends the stored token', () => {
  beforeEach(() => {
    dbRun.mockResolvedValue({ lastID: 1, changes: 1 })
    dbGet.mockImplementation(async (sql) => {
      if (sql.includes('FROM members WHERE LOWER(email)')) return undefined
      if (sql.includes('FROM invitations WHERE id')) {
        // Echo back the token the route just persisted, as the DB would.
        return {
          id: 1,
          email: 'newbie@test.com',
          role: 'Member',
          token: storedToken(),
          invited_by: 'admin@test.com',
          status: 'pending',
          created_at: 'now',
          expires_at: '2099-01-01',
        }
      }
      return undefined
    })
  })

  it('emails a link whose token matches the row written to invitations', async () => {
    const app = await createInvitationsApp()
    const res = await request(app)
      .post('/api/invitations')
      .send({ email: 'newbie@test.com', role: 'Member' })

    expect(res.status).toBe(201)
    const token = storedToken()
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(res.body.token).toBe(token)

    const mail = sentEmail()
    const expected = `${DEFAULT_APP_URL}/accept-invite?token=${token}`
    expect(mail.to).toBe('newbie@test.com')
    expect(mail.html).toContain(expected)
    expect(mail.text).toContain(expected)
  })
})

describe('JL-361 POST /api/invitations/:id/resend sends the re-issued token', () => {
  beforeEach(() => {
    dbRun.mockResolvedValue({ lastID: 6, changes: 1 })
    dbGet.mockImplementation(async (sql) => {
      if (sql.includes('FROM invitations WHERE id')) {
        if (!sql.includes('token')) {
          // The pending invite being resent.
          return { id: 5, email: 'stale@test.com', role: 'Member', status: 'pending' }
        }
        return {
          id: 6,
          email: 'stale@test.com',
          role: 'Member',
          token: storedToken(),
          invited_by: 'admin@test.com',
          status: 'pending',
          created_at: 'now',
          expires_at: '2099-01-01',
        }
      }
      return undefined
    })
  })

  it('emails a link for the token that is now valid, not a tokenless URL', async () => {
    // Resend deliberately mints a fresh token and revokes the previous one
    // (JL-251), so "the same token" here means the token on the row the
    // endpoint returns — the only one that can still be redeemed.
    const app = await createInvitationsApp()
    const res = await request(app).post('/api/invitations/5/resend')

    expect(res.status).toBe(200)
    const token = storedToken()
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(res.body.token).toBe(token)

    const mail = sentEmail()
    const expected = `${DEFAULT_APP_URL}/accept-invite?token=${token}`
    expect(mail.to).toBe('stale@test.com')
    expect(mail.html).toContain(expected)
    expect(mail.text).toContain(expected)
  })
})
