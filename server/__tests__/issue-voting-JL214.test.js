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

function createApp(routeModule) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Member', isOwner: false }
    next()
  })
  app.use('/api/issues', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/votes.js')
  app = createApp(mod)
})

/* ================================================================
   JL-214: Issue voting
   ================================================================ */
describe('GET /api/issues/:issueId/votes', () => {
  it('returns voters, count, and hasVoted=true when current user voted', async () => {
    all.mockResolvedValue([
      { issue_id: 1, user_email: 'test@test.com', created_at: new Date().toISOString(), voter_name: 'Test' },
      { issue_id: 1, user_email: 'other@test.com', created_at: new Date().toISOString(), voter_name: 'Other' },
    ])

    const res = await request(app).get('/api/issues/1/votes')
    expect(res.status).toBe(200)
    expect(res.body.voters).toHaveLength(2)
    expect(res.body.count).toBe(2)
    expect(res.body.hasVoted).toBe(true)
  })

  it('returns hasVoted=false when current user has not voted', async () => {
    all.mockResolvedValue([
      { issue_id: 1, user_email: 'other@test.com', created_at: new Date().toISOString(), voter_name: 'Other' },
    ])

    const res = await request(app).get('/api/issues/1/votes')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
    expect(res.body.hasVoted).toBe(false)
  })

  it('returns empty state for an issue with no votes', async () => {
    all.mockResolvedValue([])

    const res = await request(app).get('/api/issues/1/votes')
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(0)
    expect(res.body.voters).toEqual([])
    expect(res.body.hasVoted).toBe(false)
  })
})

describe('POST /api/issues/:issueId/votes — vote', () => {
  it('inserts a vote and returns 201 with updated count + hasVoted', async () => {
    run.mockResolvedValue({ lastID: null, changes: 1 })
    get.mockResolvedValue({ count: '3' })

    const res = await request(app).post('/api/issues/1/votes')
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ success: true, action: 'voted', hasVoted: true, count: 3 })

    // Insert uses ON CONFLICT DO NOTHING + explicit RETURNING issue_id
    // (composite-PK convention — the run() wrapper must not inject RETURNING id)
    const [sql, params] = run.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO issue_votes/i)
    expect(sql).toMatch(/ON CONFLICT \(issue_id, user_email\) DO NOTHING/i)
    expect(sql).toMatch(/RETURNING issue_id/i)
    expect(params).toEqual([1, 'test@test.com'])
  })

  it('is idempotent: voting twice returns 200 already_voted without duplicating', async () => {
    // ON CONFLICT DO NOTHING → 0 rows affected
    run.mockResolvedValue({ lastID: null, changes: 0 })
    get.mockResolvedValue({ count: '3' })

    const res = await request(app).post('/api/issues/1/votes')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, action: 'already_voted', hasVoted: true, count: 3 })
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE /api/issues/:issueId/votes — unvote', () => {
  it('deletes the current user vote and returns updated count', async () => {
    run.mockResolvedValue({ lastID: null, changes: 1 })
    get.mockResolvedValue({ count: '2' })

    const res = await request(app).delete('/api/issues/1/votes')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, action: 'unvoted', hasVoted: false, count: 2 })

    const [sql, params] = run.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM issue_votes/i)
    expect(params).toEqual([1, 'test@test.com'])
  })

  it('unvoting when not voted is a no-op 200', async () => {
    run.mockResolvedValue({ lastID: null, changes: 0 })
    get.mockResolvedValue({ count: '0' })

    const res = await request(app).delete('/api/issues/1/votes')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, hasVoted: false, count: 0 })
  })
})
