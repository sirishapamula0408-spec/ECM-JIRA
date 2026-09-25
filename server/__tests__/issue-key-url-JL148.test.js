// @vitest-environment node
/* ================================================================
   JL-148 — an issue can be addressed by its key, not just its id.

   Clicking an issue navigated to /issues/402. 402 is the issues.id
   primary key: global across every project and unrelated to the
   per-project key sequence, which is why it reads as a random number
   (id 305 is DM-266, id 487 is JL-148). Atlassian uses /browse/JL-63.

   The contract pinned down here:
     • a numeric ref is always an id — every existing link keeps working
     • a key-shaped ref resolves through issue_key
     • malformed is 400, well-formed but absent is 404
     • matching is case-insensitive
     • the authorization guard resolves refs the same way the route
       does, or it decides permissions on a project it failed to find
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const db = { run: vi.fn(), get: vi.fn(), all: vi.fn(), tableExists: vi.fn(), columnExists: vi.fn() }
vi.mock('../db.js', () => db)

vi.mock('../middleware/authorize.js', () => ({
  requireRole: () => (req, _res, next) => next(),
  loadProjectRole: () => (req, _res, next) => next(),
  requireProjectRole: () => (req, _res, next) => next(),
  loadUserRoles: (req, _res, next) => next(),
  // The route wraps GET /:id in requireProjectRead(issueParamProject('id')).
  // Stubbed to a pass-through: this suite is about ref RESOLUTION, and the
  // guard's own ref handling is asserted separately below.
  requireProjectRead: () => (req, _res, next) => next(),
  requireProjectWrite: () => (req, _res, next) => next(),
  ROLE_RANK: { Viewer: 1, Member: 2, Admin: 3, Owner: 4 },
}))
vi.mock('../services/issueSecurity.js', () => ({ canViewIssue: () => true }))
vi.mock('../utils/mailer.js', () => ({
  sendMail: vi.fn(), buildInviteEmail: vi.fn(() => ({ subject: '', html: '', text: '' })),
  getLatestEmailStatuses: vi.fn(async () => new Map()),
}))

const { parseIssueRef } = await import('../routes/issues.js')

const ISSUE_ROW = {
  id: 402, issue_key: 'JL-63', title: 'Confluence-Lite Implementation', description: '',
  priority: 'Medium', assignee: 'a@x.com', status: 'Backlog', issue_type: 'Epic',
  sprint_id: null, project_id: 6, parent_id: null, epic_id: null, story_points: null,
  created_at: '2026-09-25T00:00:00Z', reporter: null, due_date: null, start_date: null,
  resolution: null, environment: null, components: null, updated_at: null,
  security_level_id: null, flagged: false,
}

async function buildApp() {
  const mod = await import('../routes/issues.js')
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { id: 1, email: 'a@x.com' }; next() })
  app.use('/', mod.default)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  db.all.mockResolvedValue([])
  db.tableExists.mockResolvedValue(false)
  db.columnExists.mockResolvedValue(false)
})

/* ---------------------------------------------------------------- */
describe('JL-148 parseIssueRef — classify without touching the database', () => {
  it('reads a bare number as an id', () => {
    expect(parseIssueRef('402')).toEqual({ kind: 'id', id: 402 })
  })

  it('reads a key-shaped string as a key', () => {
    expect(parseIssueRef('JL-63')).toEqual({ kind: 'key', key: 'JL-63' })
  })

  it('allows digits inside the prefix — TP1-11 is a real key here', () => {
    expect(parseIssueRef('TP1-11')).toEqual({ kind: 'key', key: 'TP1-11' })
  })

  it('requires a leading letter, so a number can never be mistaken for a key', () => {
    // This is what keeps every existing /issues/<id> link unambiguous.
    expect(parseIssueRef('12-34')).toBeNull()
  })

  it('accepts lower case — a hand-typed or pasted link should still resolve', () => {
    expect(parseIssueRef('jl-63')).toEqual({ kind: 'key', key: 'jl-63' })
  })

  it('trims surrounding whitespace', () => {
    expect(parseIssueRef('  JL-63 ')).toEqual({ kind: 'key', key: 'JL-63' })
  })

  it('rejects malformed refs', () => {
    for (const bad of ['', '   ', 'JL-', '-63', 'JL63', 'JL-63-1', 'abc', '../etc', null, undefined]) {
      expect(parseIssueRef(bad), String(bad)).toBeNull()
    }
  })

  it('rejects zero, negatives and non-safe integers', () => {
    expect(parseIssueRef('0')).toBeNull()
    expect(parseIssueRef('-5')).toBeNull()
    expect(parseIssueRef('99999999999999999999')).toBeNull()
  })
})

/* ---------------------------------------------------------------- */
describe('JL-148 GET /api/issues/:idOrKey', () => {
  it('resolves a numeric id, exactly as before', async () => {
    db.get.mockResolvedValue(ISSUE_ROW)
    const res = await request(await buildApp()).get('/402')

    expect(res.status).toBe(200)
    expect(res.body.key).toBe('JL-63')
    // No key LOOKUP was needed — a numeric ref short-circuits before the
    // database is asked to resolve anything. Asserted against the UPPER()
    // comparison rather than the bare column name, because the issue SELECT
    // quite legitimately selects issue_key as one of its columns.
    expect(db.get.mock.calls[0][0]).not.toMatch(/UPPER\(issue_key\)/)
    expect(db.get).toHaveBeenCalledTimes(1)
  })

  it('resolves a key through issue_key', async () => {
    db.get
      .mockResolvedValueOnce({ id: 402 })   // the key -> id lookup
      .mockResolvedValue(ISSUE_ROW)          // then the issue itself
    const res = await request(await buildApp()).get('/JL-63')

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(402)
    expect(res.body.key).toBe('JL-63')
    expect(db.get.mock.calls[0][0]).toMatch(/UPPER\(issue_key\)/)
  })

  it('matches a key case-insensitively', async () => {
    db.get.mockResolvedValueOnce({ id: 402 }).mockResolvedValue(ISSUE_ROW)
    const res = await request(await buildApp()).get('/jl-63')

    expect(res.status).toBe(200)
    // The comparison is done in SQL, so the bound param is passed through as-is
    // and UPPER() on both sides does the work.
    expect(db.get.mock.calls[0][0]).toMatch(/UPPER\(issue_key\) = UPPER\(\?\)/)
  })

  it('404s a well-formed key that does not exist — it is a missing resource, not a bad request', async () => {
    db.get.mockResolvedValue(undefined)
    const res = await request(await buildApp()).get('/JL-9999')

    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('400s a malformed ref', async () => {
    const res = await request(await buildApp()).get('/not-a-ref!')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid issue id or key/)
  })

  it('404s a numeric id that does not exist', async () => {
    db.get.mockResolvedValue(undefined)
    const res = await request(await buildApp()).get('/999999')
    expect(res.status).toBe(404)
  })

  it('never interpolates the ref into SQL — it is always a bound parameter', async () => {
    db.get.mockResolvedValue(undefined)
    await request(await buildApp()).get('/JL-63')
    const [sql, params] = db.get.mock.calls[0]
    expect(sql).not.toContain('JL-63')
    expect(params).toEqual(['JL-63'])
  })
})
