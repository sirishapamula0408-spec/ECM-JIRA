// @vitest-environment node
/* ================================================================
   JL-473 — an invite must say whether its email actually went out.

   Reported as "inviting a user sends no email". The send path turned
   out to be intact; what was missing was any way to KNOW. The member
   record is written whatever happens to the mail, and the UI reported
   "Invited" for a delivered invite, a rejected one and one that was
   never attempted alike.

   What is pinned down here:
     • an invite triggers a send, with the stored token in the link;
     • a send failure is reported on the response, not swallowed;
     • SMTP-not-configured is reported as its own state, distinct
       from a failure;
     • the member is still created when the mail fails — the email is
       not allowed to fail the request;
     • both invite entry points behave the same way (POST /api/members
       and POST /api/invitations), which they did not before: the
       invitations path fired its send unawaited and returned nothing
       about it.
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// ── db ────────────────────────────────────────────────────────────
const db = { run: vi.fn(), get: vi.fn(), all: vi.fn(), tableExists: vi.fn(), columnExists: vi.fn() }
vi.mock('../db.js', () => db)

// ── mailer: real builders, stubbed transport ──────────────────────
const sendMail = vi.fn()
const getLatestEmailStatuses = vi.fn(async () => new Map())
vi.mock('../utils/mailer.js', async () => {
  const actual = await vi.importActual('../utils/mailer.js')
  return {
    ...actual,
    // buildInviteEmail stays REAL — the token-in-the-link assertion below is
    // worthless against a stub of the thing that builds the link.
    sendMail: (...args) => sendMail(...args),
    getLatestEmailStatuses: (...args) => getLatestEmailStatuses(...args),
  }
})

// ── auth/authorisation: the route logic is what is under test ─────
vi.mock('../middleware/authorize.js', () => ({
  requireRole: () => (req, _res, next) => next(),
  loadProjectRole: () => (req, _res, next) => next(),
  requireProjectRole: () => (req, _res, next) => next(),
  loadUserRoles: (req, _res, next) => next(),
}))

vi.mock('../services/signupPolicy.js', () => ({
  blockSignup: vi.fn(async () => false),
  unblockSignup: vi.fn(async () => false),
  checkSignupAllowed: vi.fn(async () => ({ allowed: true })),
}))

const issueInvitation = vi.fn()
vi.mock('../services/invitations.js', async () => {
  const actual = await vi.importActual('../services/invitations.js')
  return { ...actual, issueInvitation: (...a) => issueInvitation(...a) }
})

const STORED_TOKEN = 'a'.repeat(64)

async function buildApp(routerPath) {
  const mod = await import(routerPath)
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { id: 1, email: 'admin@example.com' }; next() })
  app.use('/', mod.default)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  db.tableExists.mockResolvedValue(true)
  db.columnExists.mockResolvedValue(true)
  db.all.mockResolvedValue([])
  getLatestEmailStatuses.mockResolvedValue(new Map())
  issueInvitation.mockResolvedValue({
    id: 42, email: 'new@example.com', role: 'Member', token: STORED_TOKEN,
    invited_by: 'admin@example.com', status: 'pending',
    created_at: '2026-09-23T00:00:00Z', expires_at: '2026-09-30T00:00:00Z',
  })
  sendMail.mockResolvedValue({ ok: true, messageId: 'msg-1', accepted: ['new@example.com'] })
})

/* ---------------------------------------------------------------- *
 * POST /api/members
 * ---------------------------------------------------------------- */
describe('JL-473 — POST /api/members reports the invite email outcome', () => {
  // members POST: existing member lookup, existing user lookup, then the row
  // read back after insert, then the workspace name.
  function stubMemberCreate() {
    db.run.mockResolvedValue({ lastID: 7, changes: 1 })
    db.get
      .mockResolvedValueOnce(undefined) // no existing member
      .mockResolvedValueOnce(undefined) // no existing user
      .mockResolvedValueOnce({          // the inserted member row
        id: 7, name: 'New Person', email: 'new@example.com', role: 'Member',
        status: 'Invited', task_count: 0, invited_by: 'admin@example.com',
        workspace_id: 1,
      })
      .mockResolvedValue({ name: 'Acme Workspace' }) // resolveWorkspaceName
  }

  const post = async (app) => request(app).post('/').send({
    name: 'New Person', email: 'new@example.com', role: 'Member',
  })

  it('sends an invite email and reports email_status:"sent"', async () => {
    stubMemberCreate()
    const res = await post(await buildApp('../routes/members.js'))

    expect(res.status).toBe(201)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(res.body.email_status).toBe('sent')
    expect(res.body.email_error).toBeNull()
  })

  it('puts the STORED token in the accept link, in both html and text', async () => {
    stubMemberCreate()
    await post(await buildApp('../routes/members.js'))

    const [{ html, text }] = sendMail.mock.calls[0]
    const expected = `/accept-invite?token=${STORED_TOKEN}`
    expect(html).toContain(expected)
    expect(text).toContain(expected)
    // The token in the link is the one issueInvitation stored, not a new one.
    expect(issueInvitation).toHaveBeenCalledTimes(1)
  })

  it('names the recipient, the inviter, the role and the workspace', async () => {
    stubMemberCreate()
    await post(await buildApp('../routes/members.js'))

    const [{ html, text, subject }] = sendMail.mock.calls[0]
    expect(html).toContain('New Person')
    expect(html).toContain('Member')
    expect(html).toContain('Acme Workspace')
    expect(subject).toContain('Acme Workspace')
    expect(text).toContain('Acme Workspace')
  })

  it('reports a provider rejection instead of swallowing it', async () => {
    stubMemberCreate()
    sendMail.mockResolvedValue({ ok: false, error: '550 mailbox unavailable' })

    const res = await post(await buildApp('../routes/members.js'))

    expect(res.status).toBe(201)
    expect(res.body.email_status).toBe('failed')
    expect(res.body.email_error).toBe('550 mailbox unavailable')
  })

  it('distinguishes "SMTP not configured" from an actual failure', async () => {
    stubMemberCreate()
    sendMail.mockResolvedValue({ ok: false, skipped: true })

    const res = await post(await buildApp('../routes/members.js'))

    expect(res.body.email_status).toBe('skipped')
    expect(res.body.email_error).toBe('SMTP not configured')
  })

  it('still creates the member when the email fails — mail must not fail the request', async () => {
    stubMemberCreate()
    sendMail.mockResolvedValue({ ok: false, error: 'connection timeout' })

    const res = await post(await buildApp('../routes/members.js'))

    expect(res.status).toBe(201)
    expect(res.body.id).toBe(7)
    expect(res.body.status).toBe('Invited')
  })

  it('survives a mailer that throws, rather than 500ing the invite', async () => {
    stubMemberCreate()
    sendMail.mockRejectedValue(new Error('boom'))

    const res = await post(await buildApp('../routes/members.js'))

    expect(res.status).toBe(201)
    expect(res.body.email_status).toBe('failed')
    expect(res.body.email_error).toBe('boom')
  })

  it('sends no invite at all when a temporary password activates the account', async () => {
    db.run.mockResolvedValue({ lastID: 8, changes: 1 })
    db.get
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 8, name: 'Direct', email: 'direct@example.com', role: 'Member',
        status: 'Active', task_count: 0, invited_by: 'admin@example.com', workspace_id: 1,
      })
      .mockResolvedValue({ name: 'Acme Workspace' })

    const app = await buildApp('../routes/members.js')
    const res = await request(app).post('/').send({
      name: 'Direct', email: 'direct@example.com', role: 'Member', password: 'hunter2',
    })

    expect(res.status).toBe(201)
    expect(sendMail).not.toHaveBeenCalled()
    expect(res.body.email_status).toBe('not_applicable')
  })
})

/* ---------------------------------------------------------------- *
 * GET /api/members — delivery state on the list
 * ---------------------------------------------------------------- */
describe('JL-473 — the member list carries the latest delivery attempt', () => {
  const ROWS = [
    { id: 1, name: 'A', email: 'a@example.com', role: 'Member', status: 'Invited' },
    { id: 2, name: 'B', email: 'b@example.com', role: 'Member', status: 'Active' },
  ]

  it('decorates the unpaginated list', async () => {
    db.all.mockResolvedValue(ROWS)
    getLatestEmailStatuses.mockResolvedValue(new Map([
      ['a@example.com', { status: 'failed', error: '550 nope', created_at: '2026-09-01T00:00:00Z' }],
    ]))

    const res = await request(await buildApp('../routes/members.js')).get('/')

    expect(res.status).toBe(200)
    expect(res.body[0]).toMatchObject({
      email_status: 'failed', email_error: '550 nope', email_sent_at: '2026-09-01T00:00:00Z',
    })
  })

  it('reports "unknown" for an address with no delivery attempt on record', async () => {
    db.all.mockResolvedValue(ROWS)
    getLatestEmailStatuses.mockResolvedValue(new Map())

    const res = await request(await buildApp('../routes/members.js')).get('/')

    expect(res.body[1].email_status).toBe('unknown')
    expect(res.body[1].email_error).toBeNull()
  })

  it('decorates the paginated list too, under `items`', async () => {
    db.all.mockResolvedValue(ROWS)
    db.get.mockResolvedValue({ total: 2 })
    getLatestEmailStatuses.mockResolvedValue(new Map([
      ['a@example.com', { status: 'sent', error: null, created_at: '2026-09-02T00:00:00Z' }],
    ]))

    const res = await request(await buildApp('../routes/members.js')).get('/?limit=25&offset=0')

    expect(res.body.items[0].email_status).toBe('sent')
    expect(res.body.total).toBe(2)
  })

  it('makes ONE delivery query for the whole page, not one per row', async () => {
    db.all.mockResolvedValue(ROWS)
    await request(await buildApp('../routes/members.js')).get('/')
    expect(getLatestEmailStatuses).toHaveBeenCalledTimes(1)
  })

  it('does not query at all for an empty list', async () => {
    db.all.mockResolvedValue([])
    await request(await buildApp('../routes/members.js')).get('/')
    expect(getLatestEmailStatuses).not.toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------------- *
 * POST /api/invitations — the previously fire-and-forget path
 * ---------------------------------------------------------------- */
describe('JL-473 — POST /api/invitations awaits its send and reports it', () => {
  beforeEach(() => {
    db.get
      .mockResolvedValueOnce(undefined)               // no existing member
      .mockResolvedValue({ name: 'Acme Workspace' })  // resolveWorkspaceName
  })

  const post = async () => request(await buildApp('../routes/invitations.js'))
    .post('/').send({ email: 'new@example.com', role: 'Member' })

  it('reports email_status:"sent" on the 201 — it used to report nothing', async () => {
    const res = await post()
    expect(res.status).toBe(201)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(res.body.email_status).toBe('sent')
  })

  it('reports a rejection rather than returning a clean 201 over a dead send', async () => {
    sendMail.mockResolvedValue({ ok: false, error: 'relay refused' })
    const res = await post()
    expect(res.status).toBe(201)
    expect(res.body.email_status).toBe('failed')
    expect(res.body.email_error).toBe('relay refused')
  })

  it('reports the unconfigured case separately', async () => {
    sendMail.mockResolvedValue({ ok: false, skipped: true })
    const res = await post()
    expect(res.body.email_status).toBe('skipped')
    expect(res.body.email_error).toBe('SMTP not configured')
  })

  it('still creates the invitation when the email fails', async () => {
    sendMail.mockResolvedValue({ ok: false, error: 'nope' })
    const res = await post()
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(42)
    expect(res.body.token).toBe(STORED_TOKEN)
  })

  it('carries the stored token and the workspace name in the email', async () => {
    await post()
    const [{ html, subject }] = sendMail.mock.calls[0]
    expect(html).toContain(`/accept-invite?token=${STORED_TOKEN}`)
    expect(subject).toContain('Acme Workspace')
  })
})
