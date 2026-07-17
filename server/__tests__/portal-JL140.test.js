// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => {
  const run = vi.fn()
  const all = vi.fn()
  const get = vi.fn()
  return {
    run,
    all,
    get,
    withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
  }
})

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import portalRoutes, { validateRequestSubmission } from '../routes/portal.js'

// Build an app with a stubbed user of the given workspace role.
function createApp(role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use('/api', portalRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   validateRequestSubmission (pure unit)
   ================================================================ */
describe('validateRequestSubmission', () => {
  const enabledType = { id: 1, project_id: 2, enabled: true }

  it('rejects a missing email', () => {
    const r = validateRequestSubmission({ summary: 'Hi' }, enabledType)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/requesterEmail is required/i)
  })

  it('rejects an invalid email shape', () => {
    const r = validateRequestSubmission({ requesterEmail: 'not-an-email', summary: 'Hi' }, enabledType)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/valid email/i)
  })

  it('rejects a missing summary', () => {
    const r = validateRequestSubmission({ requesterEmail: 'a@b.com' }, enabledType)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/summary is required/i)
  })

  it('rejects an unknown request type', () => {
    const r = validateRequestSubmission({ requesterEmail: 'a@b.com', summary: 'Hi' }, null)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/not found/i)
  })

  it('rejects a disabled request type', () => {
    const r = validateRequestSubmission(
      { requesterEmail: 'a@b.com', summary: 'Hi' },
      { id: 1, project_id: 2, enabled: false },
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/not enabled/i)
  })

  it('accepts a valid submission', () => {
    const r = validateRequestSubmission({ requesterEmail: 'a@b.com', summary: 'Hi' }, enabledType)
    expect(r.ok).toBe(true)
    expect(r.errors).toHaveLength(0)
  })
})

/* ================================================================
   POST /api/portal/requests
   ================================================================ */
describe('POST /api/portal/requests', () => {
  it('creates an issue + portal_requests row and returns an issue key', async () => {
    const app = createApp()
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM request_types')) {
        return { id: 5, project_id: 7, name: 'Bug report', default_issue_type: 'Bug', enabled: true, fields: [] }
      }
      if (sql.includes('key FROM projects')) return { id: 7, key: 'SUP' }
      if (sql.includes('issue_counter')) return { issue_counter: 42 }
      if (sql.includes('FROM issues')) return { id: 99, issue_key: 'SUP-42', status: 'Backlog' }
      return null
    })
    run.mockResolvedValue({ lastID: 99 })

    const res = await request(app).post('/api/portal/requests').send({
      requestTypeId: 5,
      requesterEmail: 'customer@acme.com',
      summary: 'App crashes on login',
      description: 'Details here',
    })

    expect(res.status).toBe(201)
    expect(res.body.issueKey).toBe('SUP-42')
    expect(res.body.status).toBe('Backlog')

    // an issue insert happened
    const issueInsert = run.mock.calls.find((c) => /INSERT INTO issues/.test(c[0]))
    expect(issueInsert).toBeTruthy()
    // a portal_requests insert happened
    const prInsert = run.mock.calls.find((c) => /INSERT INTO portal_requests/.test(c[0]))
    expect(prInsert).toBeTruthy()
    expect(prInsert[1]).toContain('customer@acme.com')
  })

  it('rejects an invalid submission (400)', async () => {
    const app = createApp()
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM request_types')) return { id: 5, project_id: 7, enabled: true }
      return null
    })
    const res = await request(app).post('/api/portal/requests').send({
      requestTypeId: 5,
      requesterEmail: 'bad',
      summary: '',
    })
    expect(res.status).toBe(400)
  })
})

/* ================================================================
   GET /api/portal/requests?email=
   ================================================================ */
describe('GET /api/portal/requests', () => {
  it('filters by requester email', async () => {
    const app = createApp()
    all.mockResolvedValue([
      { id: 1, requester_email: 'customer@acme.com', request_type_id: 5, created_at: 'now', issue_key: 'SUP-42', title: 'App crash', status: 'In Progress', issue_type: 'Bug', request_type_name: 'Bug report' },
    ])
    const res = await request(app).get('/api/portal/requests?email=customer@acme.com')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].issueKey).toBe('SUP-42')
    expect(res.body[0].status).toBe('In Progress')
    // the query bound the email param
    const call = all.mock.calls[0]
    expect(call[1]).toContain('customer@acme.com')
  })

  it('requires an email param (400)', async () => {
    const app = createApp()
    const res = await request(app).get('/api/portal/requests')
    expect(res.status).toBe(400)
  })
})

/* ================================================================
   Request-type admin gating
   ================================================================ */
describe('POST /api/request-types (Admin gate)', () => {
  it('rejects a non-admin (403)', async () => {
    const app = createApp('Member')
    const res = await request(app).post('/api/request-types').send({ projectId: 7, name: 'Bug report' })
    expect(res.status).toBe(403)
  })

  it('creates a request type for an Admin', async () => {
    const app = createApp('Admin')
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM projects')) return { id: 7 }
      if (sql.includes('FROM request_types')) {
        return { id: 3, project_id: 7, name: 'Bug report', description: '', icon: '', fields: [], default_issue_type: 'Bug', enabled: true, created_at: 'now' }
      }
      return null
    })
    run.mockResolvedValue({ lastID: 3 })

    const res = await request(app).post('/api/request-types').send({
      projectId: 7,
      name: 'Bug report',
      defaultIssueType: 'Bug',
      fields: [{ name: 'severity', type: 'text' }],
    })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(3)
    expect(res.body.name).toBe('Bug report')
  })
})
