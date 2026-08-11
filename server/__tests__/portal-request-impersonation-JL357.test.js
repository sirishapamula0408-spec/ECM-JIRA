// @vitest-environment node
//
// JL-357: impersonation fix for POST /api/portal/requests.
//
// Before the fix the handler took `requesterEmail` straight from the body and
// used it as the created issue's reporter AND assignee AND as the
// portal_requests key, never consulting req.user — so any authenticated user
// could file a request in anyone else's name. This is the write-side
// counterpart to JL-349 and uses the same trust model: default to the session
// user, allow an explicit self-match, and permit a differing address only for a
// workspace Owner/Admin (submit-on-behalf). A non-privileged caller supplying
// someone else's address gets 403 rather than a silent rewrite, so an attempted
// impersonation stays visible instead of being quietly recorded as their own.
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

import { run, get, withTransaction } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import portalRoutes from '../routes/portal.js'

// Build an app with a stubbed authenticated user (mirrors portal-idor-JL349).
function createApp({ email = 'member@test.com', role = 'Member', isOwner = false } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email, memberId: 1, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api', portalRoutes)
  app.use(errorHandler)
  return app
}

const REQUEST_TYPE = {
  id: 7,
  project_id: 2,
  name: 'Bug report',
  default_issue_type: 'Bug',
  enabled: true,
  fields: [],
}

// Stub the happy-path db sequence: request type → project → key counter →
// (in the transaction) issue insert → issue select → portal_requests insert.
function stubHappyPath() {
  get.mockImplementation(async (sql) => {
    if (/FROM request_types/.test(sql)) return REQUEST_TYPE
    if (/FROM projects/.test(sql)) return { id: 2, key: 'SUP' }
    if (/UPDATE projects/.test(sql)) return { issue_counter: 42 }
    if (/FROM issues/.test(sql)) return { id: 900, issue_key: 'SUP-42', status: 'Backlog' }
    return null
  })
  run.mockResolvedValue({ lastID: 900, changes: 1 })
}

// Pull the params bound to the INSERT that targets `table`.
function insertParams(table) {
  const call = run.mock.calls.find(([sql]) => new RegExp(`INSERT INTO ${table}\\b`).test(sql))
  return call ? call[1] : null
}

const BODY = { requestTypeId: 7, summary: 'Printer on fire' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/portal/requests — impersonation (JL-357)', () => {
  it('defaults requesterEmail to the session user when it is omitted', async () => {
    const app = createApp({ email: 'member@test.com', role: 'Member' })
    stubHappyPath()

    const res = await request(app).post('/api/portal/requests').send(BODY)

    expect(res.status).toBe(201)
    expect(res.body.issueKey).toBe('SUP-42')
    expect(insertParams('portal_requests')).toContain('member@test.com')
    // reporter + assignee on the created issue are the same resolved address
    const issueParams = insertParams('issues')
    expect(issueParams.filter((p) => p === 'member@test.com')).toHaveLength(2)
  })

  it('allows a Member to supply their own email (case-insensitively)', async () => {
    const app = createApp({ email: 'member@test.com', role: 'Member' })
    stubHappyPath()

    const res = await request(app)
      .post('/api/portal/requests')
      .send({ ...BODY, requesterEmail: 'MEMBER@Test.COM' })

    expect(res.status).toBe(201)
    expect(insertParams('portal_requests')).toContain('MEMBER@Test.COM')
  })

  it('rejects a Member supplying someone else email with 403 and writes nothing', async () => {
    const app = createApp({ email: 'member@test.com', role: 'Member' })
    stubHappyPath()

    const res = await request(app)
      .post('/api/portal/requests')
      .send({ ...BODY, requesterEmail: 'victim@acme.com' })

    expect(res.status).toBe(403)
    // No silent rewrite: the caller is told, and nothing is persisted.
    expect(withTransaction).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(insertParams('issues')).toBeNull()
    expect(insertParams('portal_requests')).toBeNull()
  })

  it('rejects a Viewer supplying someone else email with 403', async () => {
    const app = createApp({ email: 'viewer@test.com', role: 'Viewer' })
    stubHappyPath()

    const res = await request(app)
      .post('/api/portal/requests')
      .send({ ...BODY, requesterEmail: 'victim@acme.com' })

    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('allows a workspace Admin to submit on behalf of another user', async () => {
    const app = createApp({ email: 'admin@test.com', role: 'Admin' })
    stubHappyPath()

    const res = await request(app)
      .post('/api/portal/requests')
      .send({ ...BODY, requesterEmail: 'customer@acme.com' })

    expect(res.status).toBe(201)
    expect(insertParams('portal_requests')).toContain('customer@acme.com')
  })

  it('allows the workspace Owner to submit on behalf of another user', async () => {
    const app = createApp({ email: 'owner@test.com', role: 'Member', isOwner: true })
    stubHappyPath()

    const res = await request(app)
      .post('/api/portal/requests')
      .send({ ...BODY, requesterEmail: 'customer@acme.com' })

    expect(res.status).toBe(201)
    expect(insertParams('portal_requests')).toContain('customer@acme.com')
  })

  it('records the same email as issue reporter and portal_requests requester on-behalf', async () => {
    const app = createApp({ email: 'admin@test.com', role: 'Admin' })
    stubHappyPath()

    const res = await request(app)
      .post('/api/portal/requests')
      .send({ ...BODY, requesterEmail: 'customer@acme.com' })

    expect(res.status).toBe(201)

    // issues INSERT column order:
    // issue_key, title, description, priority, assignee, status, issue_type,
    // project_id, reporter
    const issueParams = insertParams('issues')
    const assignee = issueParams[4]
    const reporter = issueParams[8]
    const [, recordedRequester] = insertParams('portal_requests')

    expect(reporter).toBe('customer@acme.com')
    expect(assignee).toBe(reporter)
    expect(recordedRequester).toBe(reporter)
    // and never the submitting admin's own address
    expect(reporter).not.toBe('admin@test.com')
  })

  it('still rejects a malformed requesterEmail with 400 (validation unchanged)', async () => {
    const app = createApp({ email: 'admin@test.com', role: 'Admin' })
    stubHappyPath()

    const res = await request(app)
      .post('/api/portal/requests')
      .send({ ...BODY, requesterEmail: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(String(res.body.error)).toMatch(/valid email/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a malformed requesterEmail with 400 rather than 403 for a Member', async () => {
    const app = createApp({ email: 'member@test.com', role: 'Member' })
    stubHappyPath()

    const res = await request(app)
      .post('/api/portal/requests')
      .send({ ...BODY, requesterEmail: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})
