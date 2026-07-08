import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import gitRoutes, { parseIssueKeys, parseSmartCommands } from '../routes/gitIntegration.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'dev@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api', gitRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   parseIssueKeys helper
   ================================================================ */
describe('parseIssueKeys', () => {
  it('extracts a single issue key', () => {
    expect(parseIssueKeys('Fixes TP-12 in the login flow')).toEqual(['TP-12'])
  })

  it('extracts multiple keys', () => {
    expect(parseIssueKeys('TP-1 and AB-22 relate to XYZ-3')).toEqual(['TP-1', 'AB-22', 'XYZ-3'])
  })

  it('dedups repeated keys preserving order', () => {
    expect(parseIssueKeys('TP-5 again TP-5 and AB-1 TP-5')).toEqual(['TP-5', 'AB-1'])
  })

  it('ignores lowercase and non-key tokens', () => {
    expect(parseIssueKeys('fixed tp-3, bug 42, version-1, and abc')).toEqual([])
  })

  it('returns [] for empty / non-string input', () => {
    expect(parseIssueKeys('')).toEqual([])
    expect(parseIssueKeys(null)).toEqual([])
    expect(parseIssueKeys(undefined)).toEqual([])
  })
})

/* ================================================================
   parseSmartCommands helper
   ================================================================ */
describe('parseSmartCommands', () => {
  it('parses #comment text', () => {
    expect(parseSmartCommands('TP-1 #comment fixed the bug').comment).toBe('fixed the bug')
  })

  it('parses #time', () => {
    expect(parseSmartCommands('TP-1 #time 2h #comment done').time).toBe('2h')
  })

  it('parses a #status transition token', () => {
    expect(parseSmartCommands('TP-1 #done').transition).toBe('Done')
    expect(parseSmartCommands('TP-1 #in-progress').transition).toBe('In Progress')
  })

  it('returns nulls when no directives present', () => {
    expect(parseSmartCommands('just a normal message TP-1')).toEqual({ comment: null, time: null, transition: null })
  })
})

/* ================================================================
   GET /api/issues/:id/git-links
   ================================================================ */
describe('GET /api/issues/:id/git-links', () => {
  it('returns the git links for an issue', async () => {
    all.mockResolvedValue([
      { id: 1, issue_id: 1, link_type: 'branch', ref: 'feature/TP-1', url: '', title: '', author: 'dev', created_at: new Date().toISOString() },
    ])
    const res = await request(createApp()).get('/api/issues/1/git-links')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].link_type).toBe('branch')
  })
})

/* ================================================================
   POST /api/issues/:id/git-links (manual add)
   ================================================================ */
describe('POST /api/issues/:id/git-links', () => {
  it('creates a git link manually', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM issues')) return { id: 1 }
      if (sql.includes('FROM git_links')) return { id: 9, issue_id: 1, link_type: 'pull_request', ref: 'PR-3' }
      return null
    })
    run.mockResolvedValue({ lastID: 9 })

    const res = await request(createApp())
      .post('/api/issues/1/git-links')
      .send({ linkType: 'pull_request', ref: 'PR-3', url: 'https://gh/pr/3', title: 'My PR' })
    expect(res.status).toBe(201)
    expect(res.body.link_type).toBe('pull_request')
  })

  it('rejects an invalid link type', async () => {
    const res = await request(createApp())
      .post('/api/issues/1/git-links')
      .send({ linkType: 'tag', ref: 'v1' })
    expect(res.status).toBe(400)
  })

  it('rejects a missing ref', async () => {
    const res = await request(createApp())
      .post('/api/issues/1/git-links')
      .send({ linkType: 'branch' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when issue does not exist', async () => {
    get.mockResolvedValue(null)
    const res = await request(createApp())
      .post('/api/issues/999/git-links')
      .send({ linkType: 'branch', ref: 'feature/x' })
    expect(res.status).toBe(404)
  })
})

/* ================================================================
   DELETE /api/git-links/:id
   ================================================================ */
describe('DELETE /api/git-links/:id', () => {
  it('deletes a git link', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp()).delete('/api/git-links/5')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

/* ================================================================
   POST /api/git/ingest
   ================================================================ */
describe('POST /api/git/ingest', () => {
  it('creates links for each referenced existing issue', async () => {
    // TP-1 exists, AB-2 does not
    get.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM issues WHERE issue_key')) {
        return params[0] === 'TP-1' ? { id: 1, issue_key: 'TP-1', status: 'To Do' } : null
      }
      return null
    })
    run.mockResolvedValue({ lastID: 100 })

    const res = await request(createApp())
      .post('/api/git/ingest')
      .send({ type: 'commit', ref: 'abc123', message: 'TP-1 and AB-2 work', author: 'dev' })

    expect(res.status).toBe(201)
    expect(res.body.referencedKeys).toEqual(['TP-1', 'AB-2'])
    expect(res.body.links).toHaveLength(1)
    expect(res.body.links[0].issueKey).toBe('TP-1')
    // one INSERT into git_links for the existing issue
    const inserts = run.mock.calls.filter((c) => c[0].includes('INSERT INTO git_links'))
    expect(inserts).toHaveLength(1)
  })

  it('smart-commit #comment creates a comment on the referenced issue', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM issues WHERE issue_key')) return { id: 1, issue_key: 'TP-1', status: 'To Do' }
      return null
    })
    run.mockResolvedValue({ lastID: 1 })

    const res = await request(createApp())
      .post('/api/git/ingest')
      .send({ type: 'commit', ref: 'abc123', message: 'TP-1 #comment fixed via commit #done', author: 'dev' })

    expect(res.status).toBe(201)
    expect(res.body.smartCommit).not.toBeNull()
    expect(res.body.smartCommit.comment).toBe('fixed via commit')
    expect(res.body.smartCommit.transition).toBe('Done')

    // a comment INSERT happened
    const commentInserts = run.mock.calls.filter((c) => c[0].includes('INSERT INTO comments'))
    expect(commentInserts).toHaveLength(1)
    expect(commentInserts[0][1]).toEqual([1, 'dev', 'fixed via commit'])
    // and a status transition UPDATE happened
    const statusUpdates = run.mock.calls.filter((c) => c[0].includes('UPDATE issues SET status'))
    expect(statusUpdates).toHaveLength(1)
    expect(statusUpdates[0][1]).toEqual(['Done', 1])
  })

  it('returns empty links when no keys are referenced', async () => {
    const res = await request(createApp())
      .post('/api/git/ingest')
      .send({ type: 'commit', ref: 'abc123', message: 'no keys here' })
    expect(res.status).toBe(200)
    expect(res.body.links).toEqual([])
  })

  it('rejects an invalid ingest type', async () => {
    const res = await request(createApp())
      .post('/api/git/ingest')
      .send({ type: 'tag', ref: 'v1', message: 'TP-1' })
    expect(res.status).toBe(400)
  })
})
