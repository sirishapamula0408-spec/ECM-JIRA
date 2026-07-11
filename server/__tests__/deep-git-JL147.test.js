// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (shared by gitIntegration.js and worklogs.js)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import gitRoutes, {
  gitWebhookRouter,
  parseSmartCommit,
  extractIssueKeysFromRef,
  applySmartCommit,
} from '../routes/gitIntegration.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'dev@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api', gitWebhookRouter) // public webhook
  app.use('/api', gitRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  delete process.env.GIT_WEBHOOK_SECRET
})

/* ================================================================
   parseSmartCommit (pure)
   ================================================================ */
describe('parseSmartCommit', () => {
  it('extracts issue key + #time / #comment / #transition', () => {
    const p = parseSmartCommit('JL-42 #time 2h #comment fixed the bug #transition Done')
    expect(p.issueKey).toBe('JL-42')
    expect(p.time).toBe('2h')
    expect(p.comment).toBe('fixed the bug')
    expect(p.transition).toBe('Done')
  })

  it('parses #done style transition token', () => {
    const p = parseSmartCommit('JL-1 #done')
    expect(p.transition).toBe('Done')
  })

  it('returns issueKey with all-null commands for a plain message', () => {
    const p = parseSmartCommit('JL-7 just a normal commit')
    expect(p.issueKey).toBe('JL-7')
    expect(p.time).toBeNull()
    expect(p.comment).toBeNull()
    expect(p.transition).toBeNull()
  })

  it('returns null issueKey when no key present', () => {
    expect(parseSmartCommit('no keys here').issueKey).toBeNull()
  })
})

/* ================================================================
   extractIssueKeysFromRef (pure)
   ================================================================ */
describe('extractIssueKeysFromRef', () => {
  it('finds keys in a branch name', () => {
    expect(extractIssueKeysFromRef('feature/JL-42_login-form')).toEqual(['JL-42'])
  })

  it('finds keys in a PR title', () => {
    expect(extractIssueKeysFromRef('JL-1 and AB-22: refactor')).toEqual(['JL-1', 'AB-22'])
  })

  it('returns [] when no key present', () => {
    expect(extractIssueKeysFromRef('feature/login')).toEqual([])
  })
})

/* ================================================================
   applySmartCommit (pure, injected actions)
   ================================================================ */
describe('applySmartCommit', () => {
  it('invokes the right injected action for each command', async () => {
    const addWorklog = vi.fn()
    const addComment = vi.fn()
    const transitionIssue = vi.fn()
    const applied = await applySmartCommit(
      { issueKey: 'JL-1', time: '3h', comment: 'done', transition: 'Done' },
      { addWorklog, addComment, transitionIssue },
    )
    expect(addWorklog).toHaveBeenCalledWith('3h')
    expect(addComment).toHaveBeenCalledWith('done')
    expect(transitionIssue).toHaveBeenCalledWith('Done')
    expect(applied).toEqual(['worklog', 'comment', 'transition'])
  })

  it('skips actions with no matching command', async () => {
    const addWorklog = vi.fn()
    const addComment = vi.fn()
    const transitionIssue = vi.fn()
    const applied = await applySmartCommit(
      { issueKey: 'JL-1', time: null, comment: 'only a comment', transition: null },
      { addWorklog, addComment, transitionIssue },
    )
    expect(addWorklog).not.toHaveBeenCalled()
    expect(transitionIssue).not.toHaveBeenCalled()
    expect(addComment).toHaveBeenCalledWith('only a comment')
    expect(applied).toEqual(['comment'])
  })

  it('does not throw when action fns are missing', async () => {
    const applied = await applySmartCommit({ issueKey: 'JL-1', comment: 'x' }, {})
    expect(applied).toEqual([])
  })
})

/* ================================================================
   POST /api/git/webhook — pull_request
   ================================================================ */
describe('webhook pull_request', () => {
  it('merged PR upserts a git_links row with state=merged (INSERT path)', async () => {
    get.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM issues WHERE issue_key')) {
        return params[0] === 'JL-42' ? { id: 5 } : null
      }
      if (sql.includes("link_type = 'pull_request'")) return null // no existing link
      return null
    })
    run.mockResolvedValue({ lastID: 77 })

    const res = await request(createApp())
      .post('/api/git/webhook')
      .send({
        event: 'pull_request',
        action: 'closed',
        pull_request: {
          number: 12,
          title: 'JL-42 add login form',
          merged: true,
          merged_at: '2026-07-01T00:00:00Z',
          html_url: 'https://gh/pr/12',
          head: { ref: 'feature/JL-42' },
        },
      })

    expect(res.status).toBe(200)
    expect(res.body.state).toBe('merged')
    const inserts = run.mock.calls.filter((c) => c[0].includes('INSERT INTO git_links'))
    expect(inserts).toHaveLength(1)
    // params: [issueId, ref, url, title, author, state, mergedAt]
    expect(inserts[0][1][0]).toBe(5)
    expect(inserts[0][1][1]).toBe('#12')
    expect(inserts[0][1][5]).toBe('merged')
  })

  it('opened PR updates state on an existing link (UPDATE path)', async () => {
    get.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM issues WHERE issue_key')) return { id: 5 }
      if (sql.includes("link_type = 'pull_request'")) return { id: 99 }
      return null
    })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(createApp())
      .post('/api/git/webhook')
      .send({
        event: 'pull_request',
        action: 'opened',
        pull_request: { number: 3, title: 'JL-1 wip', head: { ref: 'feature/JL-1' } },
      })

    expect(res.status).toBe(200)
    expect(res.body.state).toBe('open')
    const updates = run.mock.calls.filter((c) => c[0].includes('UPDATE git_links SET state'))
    expect(updates).toHaveLength(1)
    expect(updates[0][1][0]).toBe('open')
  })
})

/* ================================================================
   POST /api/git/webhook — push (smart commits)
   ================================================================ */
describe('webhook push', () => {
  it('applies a smart commit: comment + transition + worklog', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM issues WHERE issue_key')) return { id: 8 }
      return null
    })
    run.mockResolvedValue({ lastID: 1 })

    const res = await request(createApp())
      .post('/api/git/webhook')
      .send({
        event: 'push',
        ref: 'refs/heads/feature/JL-9',
        commits: [
          { id: 'abcdef1234567890', message: 'JL-9 #time 1h #comment shipped #done', author: { name: 'dev' } },
        ],
      })

    expect(res.status).toBe(200)
    const commentInserts = run.mock.calls.filter((c) => c[0].includes('INSERT INTO comments'))
    expect(commentInserts).toHaveLength(1)
    const worklogInserts = run.mock.calls.filter((c) => c[0].includes('INSERT INTO worklogs'))
    expect(worklogInserts).toHaveLength(1)
    expect(worklogInserts[0][1][2]).toBe(60) // 1h → 60 minutes
    const statusUpdates = run.mock.calls.filter((c) => c[0].includes('UPDATE issues SET status'))
    expect(statusUpdates).toHaveLength(1)
    expect(statusUpdates[0][1]).toEqual(['Done', 8])
    const commitLinks = run.mock.calls.filter((c) => c[0].includes("link_type, ref") && c[0].includes("'commit'"))
    expect(commitLinks.length).toBeGreaterThanOrEqual(1)
  })
})

/* ================================================================
   POST /api/git/webhook — deployment
   ================================================================ */
describe('webhook deployment', () => {
  it('records a deployments row', async () => {
    get.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM issues WHERE issue_key')) return params[0] === 'JL-5' ? { id: 4 } : null
      return null
    })
    run.mockResolvedValue({ lastID: 55 })

    const res = await request(createApp())
      .post('/api/git/webhook')
      .send({
        event: 'deployment',
        deployment: {
          environment: 'production',
          status: 'success',
          version: 'v1.2.3',
          ref: 'JL-5',
          url: 'https://deploy/1',
        },
      })

    expect(res.status).toBe(201)
    const depInserts = run.mock.calls.filter((c) => c[0].includes('INSERT INTO deployments'))
    expect(depInserts).toHaveLength(1)
    // params: [issueId, environment, status, version, url]
    expect(depInserts[0][1]).toEqual([4, 'production', 'success', 'v1.2.3', 'https://deploy/1'])
    expect(res.body.issueId).toBe(4)
  })

  it('records a deployment with null issue_id when no key referenced', async () => {
    get.mockResolvedValue(null)
    run.mockResolvedValue({ lastID: 56 })

    const res = await request(createApp())
      .post('/api/git/webhook')
      .send({ event: 'deployment', deployment: { environment: 'staging', status: 'success' } })

    expect(res.status).toBe(201)
    const depInserts = run.mock.calls.filter((c) => c[0].includes('INSERT INTO deployments'))
    expect(depInserts[0][1][0]).toBeNull()
  })
})

/* ================================================================
   GET /api/issues/:id/deployments
   ================================================================ */
describe('GET /api/issues/:id/deployments', () => {
  it('returns deployment rows for an issue', async () => {
    all.mockResolvedValue([
      { id: 1, issue_id: 4, environment: 'production', status: 'success', version: 'v1', url: '', deployed_at: new Date().toISOString() },
    ])
    const res = await request(createApp()).get('/api/issues/4/deployments')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].environment).toBe('production')
  })
})

/* ================================================================
   Webhook secret gate
   ================================================================ */
describe('webhook secret gate', () => {
  it('rejects a bad token when GIT_WEBHOOK_SECRET is set', async () => {
    process.env.GIT_WEBHOOK_SECRET = 'topsecret'
    const res = await request(createApp())
      .post('/api/git/webhook')
      .set('X-Webhook-Token', 'wrong')
      .send({ event: 'deployment', deployment: { environment: 'prod', status: 'ok' } })
    expect(res.status).toBe(401)
  })

  // JL-184: constant-time compare must still reject a same-length wrong token.
  it('rejects a same-length wrong token (constant-time compare)', async () => {
    process.env.GIT_WEBHOOK_SECRET = 'topsecret'
    const res = await request(createApp())
      .post('/api/git/webhook')
      .set('X-Webhook-Token', 'topsecre7')
      .send({ event: 'deployment', deployment: { environment: 'prod', status: 'ok' } })
    expect(res.status).toBe(401)
  })

  it('accepts a matching shared token when GIT_WEBHOOK_SECRET is set', async () => {
    process.env.GIT_WEBHOOK_SECRET = 'topsecret'
    get.mockResolvedValue(null)
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(createApp())
      .post('/api/git/webhook')
      .set('X-Webhook-Token', 'topsecret')
      .send({ event: 'deployment', deployment: { environment: 'prod', status: 'ok' } })
    expect(res.status).toBe(201)
  })

  it('is open when GIT_WEBHOOK_SECRET is unset', async () => {
    get.mockResolvedValue(null)
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(createApp())
      .post('/api/git/webhook')
      .send({ event: 'deployment', deployment: { environment: 'prod', status: 'ok' } })
    expect(res.status).toBe(201)
  })
})
