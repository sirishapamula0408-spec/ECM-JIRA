import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mutable holder so tests can flip the shared inbound token on/off. Hoisted so
// it exists before the vi.mock factory (which is hoisted above imports) runs.
const state = vi.hoisted(() => ({ token: '' }))

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Preserve the real config but override INBOUND_EMAIL_TOKEN with a live getter
// so a test can enable the token gate at will.
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    get INBOUND_EMAIL_TOKEN() {
      return state.token
    },
  }
})

import { run, all, get } from '../db.js'
import inboundEmailRoutes, {
  parseInboundEmail,
  extractIssueKey,
} from '../routes/inboundEmail.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/inbound-email', inboundEmailRoutes)
  app.use(errorHandler)
  return app
}

let app
beforeEach(() => {
  vi.clearAllMocks()
  state.token = ''
  app = createApp()
})

describe('JL-148 — parseInboundEmail (pure)', () => {
  it('normalizes SendGrid-style fields (from/to/subject/text)', () => {
    const out = parseInboundEmail({
      from: 'alice@corp.com',
      to: 'support@ecm.io',
      subject: 'Login broken',
      text: 'Cannot log in',
    })
    expect(out).toEqual({
      from: 'alice@corp.com',
      to: 'support@ecm.io',
      subject: 'Login broken',
      body: 'Cannot log in',
    })
  })

  it('normalizes Mailgun-style variants (sender/recipient/body-plain)', () => {
    const out = parseInboundEmail({
      sender: 'bob@corp.com',
      recipient: 'help@ecm.io',
      subject: 'Feature request',
      'body-plain': 'Please add dark mode',
    })
    expect(out.from).toBe('bob@corp.com')
    expect(out.to).toBe('help@ecm.io')
    expect(out.body).toBe('Please add dark mode')
  })

  it('falls back to html when no plain text body is present', () => {
    const out = parseInboundEmail({ from: 'a@b.com', html: '<p>hi</p>' })
    expect(out.body).toBe('<p>hi</p>')
  })

  it('returns empty strings for missing fields and tolerates junk input', () => {
    expect(parseInboundEmail({})).toEqual({ from: '', to: '', subject: '', body: '' })
    expect(parseInboundEmail(null)).toEqual({ from: '', to: '', subject: '', body: '' })
    expect(parseInboundEmail(undefined)).toEqual({ from: '', to: '', subject: '', body: '' })
  })
})

describe('JL-148 — extractIssueKey (pure)', () => {
  it('finds an issue key in a reply subject', () => {
    expect(extractIssueKey('Re: [PROJ-42] still broken')).toBe('PROJ-42')
    expect(extractIssueKey('ABC1-7 needs work')).toBe('ABC1-7')
  })

  it('is case-insensitive and upper-cases the result', () => {
    expect(extractIssueKey('re: proj-9')).toBe('PROJ-9')
  })

  it('returns null when there is no key', () => {
    expect(extractIssueKey('New bug report')).toBeNull()
    expect(extractIssueKey('')).toBeNull()
    expect(extractIssueKey(null)).toBeNull()
  })
})

describe('JL-148 — POST /api/inbound-email', () => {
  it('appends a comment when the subject carries an existing issue key', async () => {
    get.mockResolvedValueOnce({ id: 5, issue_key: 'PROJ-5' }) // issue lookup
    run.mockResolvedValue({ lastID: 11, changes: 1 })

    const res = await request(app).post('/api/inbound-email').send({
      to: 'support@ecm.io',
      from: 'alice@corp.com',
      subject: 'Re: PROJ-5 still failing',
      text: 'It is still broken',
    })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ action: 'commented', issueKey: 'PROJ-5' })

    const commentInsert = run.mock.calls.find((c) =>
      /INSERT INTO comments/i.test(c[0]),
    )
    expect(commentInsert).toBeTruthy()
    // author = from, text = body, on the matched issue id
    expect(commentInsert[1]).toEqual([5, 'alice@corp.com', 'It is still broken'])
  })

  it('creates a new issue when the subject has no key, mapping mailbox → project', async () => {
    get
      .mockResolvedValueOnce({ id: 1, project_id: 2, default_issue_type: 'Bug' }) // mailbox mapping
      .mockResolvedValueOnce({ key: 'SUP' }) // project key
      .mockResolvedValueOnce({ issue_counter: 8 }) // atomic counter bump
    run.mockResolvedValue({ lastID: 99, changes: 1 })

    const res = await request(app).post('/api/inbound-email').send({
      to: 'support@ecm.io',
      from: 'carol@corp.com',
      subject: 'Cannot upload files',
      text: 'Upload spins forever',
    })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ action: 'created', issueKey: 'SUP-8' })

    const issueInsert = run.mock.calls.find((c) => /INSERT INTO issues/i.test(c[0]))
    expect(issueInsert).toBeTruthy()
    const params = issueInsert[1]
    expect(params[0]).toBe('SUP-8') // issue_key
    expect(params[1]).toBe('Cannot upload files') // title
    expect(params).toContain('Bug') // default_issue_type from the mapping
  })

  it('returns 404 when no mailbox mapping matches and no key is present', async () => {
    get.mockResolvedValueOnce(undefined) // no mapping
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app).post('/api/inbound-email').send({
      to: 'unknown@ecm.io',
      from: 'dave@corp.com',
      subject: 'Hello there',
      text: 'body',
    })

    expect(res.status).toBe(404)
  })

  it('rejects with 401 when INBOUND_EMAIL_TOKEN is set and none is provided', async () => {
    state.token = 'super-secret'

    const res = await request(app).post('/api/inbound-email').send({
      to: 'support@ecm.io',
      from: 'alice@corp.com',
      subject: 'Re: PROJ-5',
      text: 'hi',
    })

    expect(res.status).toBe(401)
    // Gate rejects before any DB work happens
    expect(run).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('rejects with 401 when a wrong token is provided', async () => {
    state.token = 'super-secret'

    const res = await request(app)
      .post('/api/inbound-email')
      .set('x-inbound-token', 'nope')
      .send({ to: 'support@ecm.io', from: 'a@b.com', subject: 'Re: PROJ-5', text: 'hi' })

    expect(res.status).toBe(401)
  })

  it('accepts a matching token via header and processes the email', async () => {
    state.token = 'super-secret'
    get.mockResolvedValueOnce({ id: 5, issue_key: 'PROJ-5' })
    run.mockResolvedValue({ lastID: 12, changes: 1 })

    const res = await request(app)
      .post('/api/inbound-email')
      .set('x-inbound-token', 'super-secret')
      .send({ to: 'support@ecm.io', from: 'a@b.com', subject: 'Re: PROJ-5', text: 'hi' })

    expect(res.status).toBe(201)
    expect(res.body.action).toBe('commented')
  })
})
