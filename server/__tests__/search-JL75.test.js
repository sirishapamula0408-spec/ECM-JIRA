import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — capture SQL + params passed to all()
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { buildIssueSearch, parseJql } from '../services/jqlSearch.js'

function createApp(routeModule) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/issues', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  all.mockResolvedValue([])
  const mod = await import('../routes/issues.js')
  app = createApp(mod)
})

/* ==================================================================
   Pure builder: buildIssueSearch
   ================================================================== */
describe('buildIssueSearch — free-text q', () => {
  it('builds ILIKE across key/title/description with 3 bound params', () => {
    const { where, params, orderBy } = buildIssueSearch({ q: 'login' })
    expect(where).toBe('WHERE (issue_key ILIKE ? OR title ILIKE ? OR description ILIKE ?)')
    expect(params).toEqual(['%login%', '%login%', '%login%'])
    expect(orderBy).toBe('id DESC')
  })

  it('keeps legacy status filter working', () => {
    const { where, params } = buildIssueSearch({ status: 'Done' })
    expect(where).toBe('WHERE status = ?')
    expect(params).toEqual(['Done'])
  })

  it('combines status + q with AND', () => {
    const { where, params } = buildIssueSearch({ status: 'To Do', q: 'bug' })
    expect(where).toBe(
      'WHERE status = ? AND (issue_key ILIKE ? OR title ILIKE ? OR description ILIKE ?)',
    )
    expect(params).toEqual(['To Do', '%bug%', '%bug%', '%bug%'])
  })

  it('returns empty where and no params when nothing supplied', () => {
    const { where, params, orderBy } = buildIssueSearch({})
    expect(where).toBe('')
    expect(params).toEqual([])
    expect(orderBy).toBe('id DESC')
  })
})

/* ==================================================================
   Pure parser: parseJql
   ================================================================== */
describe('parseJql — clauses & operators', () => {
  it('parses a single equality clause into whitelisted column + bound param', () => {
    const { where, params } = parseJql('status = Done')
    expect(where).toBe('status = ?')
    expect(params).toEqual(['Done'])
  })

  it('maps type -> issue_type', () => {
    const { where, params } = parseJql('type = Bug')
    expect(where).toBe('issue_type = ?')
    expect(params).toEqual(['Bug'])
  })

  it('maps project -> project_id', () => {
    const { where, params } = parseJql('project = 5')
    expect(where).toBe('project_id = ?')
    expect(params).toEqual(['5'])
  })

  it('handles != operator', () => {
    const { where, params } = parseJql('status != Done')
    expect(where).toBe('status != ?')
    expect(params).toEqual(['Done'])
  })

  it('handles ~ (contains) as ILIKE with wildcards', () => {
    const { where, params } = parseJql('title ~ login')
    expect(where).toBe('title ILIKE ?')
    expect(params).toEqual(['%login%'])
  })

  it('parses multiple clauses joined by AND', () => {
    const { where, params } = parseJql('status = Done AND priority = High')
    expect(where).toBe('status = ? AND priority = ?')
    expect(params).toEqual(['Done', 'High'])
  })

  it('parses OR connective', () => {
    const { where, params } = parseJql('priority = High OR priority = Low')
    expect(where).toBe('priority = ? OR priority = ?')
    expect(params).toEqual(['High', 'Low'])
  })

  it('parses quoted values containing spaces', () => {
    const { where, params } = parseJql('status = "Code Review" AND assignee = bob')
    expect(where).toBe('status = ? AND assignee = ?')
    expect(params).toEqual(['Code Review', 'bob'])
  })

  it('parses bare multi-word values', () => {
    const { params } = parseJql('status = Code Review')
    expect(params).toEqual(['Code Review'])
  })

  it('handles ORDER BY with direction', () => {
    const { where, params, orderBy } = parseJql('status = Done ORDER BY priority DESC')
    expect(where).toBe('status = ?')
    expect(params).toEqual(['Done'])
    expect(orderBy).toBe('priority DESC')
  })

  it('defaults ORDER BY direction to ASC', () => {
    const { orderBy } = parseJql('status = Done ORDER BY created')
    expect(orderBy).toBe('created_at ASC')
  })

  it('rejects unknown field with status 400', () => {
    let thrown
    try {
      parseJql('drop_table = x')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(thrown.status).toBe(400)
  })

  it('rejects unknown field in ORDER BY with status 400', () => {
    let thrown
    try {
      parseJql('status = Done ORDER BY secret_column')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(thrown.status).toBe(400)
  })
})

/* ==================================================================
   SQL-injection safety
   ================================================================== */
describe('parseJql — injection is neutralized', () => {
  it('binds a malicious value instead of interpolating it', () => {
    const evil = "x'; DROP TABLE issues;--"
    const { where, params } = parseJql(`status = "${evil}"`)
    // The SQL fragment contains only the placeholder, never the payload.
    expect(where).toBe('status = ?')
    expect(where).not.toContain('DROP TABLE')
    // The payload survives verbatim as a *bound* parameter.
    expect(params).toEqual([evil])
  })

  it('never interpolates value text into the WHERE string', () => {
    const { where } = parseJql("assignee = 1 OR 1=1")
    // "1 OR 1=1" would be a classic injection if interpolated; here the whole
    // value after the operator is captured/bound, not turned into SQL logic.
    expect(where).not.toMatch(/1\s*=\s*1/)
    expect(where.split('?').length - 1).toBeGreaterThanOrEqual(1)
  })
})

/* ==================================================================
   Endpoint: GET /api/issues
   ================================================================== */
describe('GET /api/issues — search endpoint', () => {
  it('passes ILIKE SQL + bound params to db for ?q=', async () => {
    const res = await request(app).get('/api/issues?q=login')
    expect(res.status).toBe(200)
    const [sql, params] = all.mock.calls[0]
    expect(sql).toContain('ILIKE ?')
    expect(params).toEqual(['%login%', '%login%', '%login%'])
  })

  it('passes parsed JQL WHERE + bound params to db for ?jql=', async () => {
    const res = await request(app).get(
      '/api/issues?jql=' + encodeURIComponent('status = Done AND priority = High'),
    )
    expect(res.status).toBe(200)
    const [sql, params] = all.mock.calls[0]
    expect(sql).toContain('status = ? AND priority = ?')
    expect(params).toEqual(['Done', 'High'])
  })

  it('applies ORDER BY from JQL into the SQL', async () => {
    const res = await request(app).get(
      '/api/issues?jql=' + encodeURIComponent('status = Done ORDER BY priority DESC'),
    )
    expect(res.status).toBe(200)
    const [sql] = all.mock.calls[0]
    expect(sql).toMatch(/ORDER BY priority DESC$/)
  })

  it('returns 400 for unknown JQL field and does not hit the db', async () => {
    const res = await request(app).get(
      '/api/issues?jql=' + encodeURIComponent('bogus = 1'),
    )
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Unknown field/i)
    expect(all).not.toHaveBeenCalled()
  })

  it('injection payload is bound, not interpolated, at the endpoint', async () => {
    const res = await request(app).get(
      '/api/issues?jql=' + encodeURIComponent(`status = "x'; DROP TABLE issues;--"`),
    )
    expect(res.status).toBe(200)
    const [sql, params] = all.mock.calls[0]
    expect(sql).not.toContain('DROP TABLE')
    expect(params).toEqual(["x'; DROP TABLE issues;--"])
  })

  it('keeps legacy ?status= filter working', async () => {
    const res = await request(app).get('/api/issues?status=Done')
    expect(res.status).toBe(200)
    const [sql, params] = all.mock.calls[0]
    expect(sql).toContain('status = ?')
    expect(params).toEqual(['Done'])
  })
})
