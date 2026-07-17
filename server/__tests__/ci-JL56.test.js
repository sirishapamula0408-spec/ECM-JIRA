import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import ciRoutes, { parseIssueKey, CI_STATUSES } from '../routes/cicd.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api', ciRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseIssueKey', () => {
  it('extracts a key from a branch name', () => {
    expect(parseIssueKey('feature/JL-56-cicd-pipeline')).toBe('JL-56')
  })

  it('extracts a key from a commit ref/message', () => {
    expect(parseIssueKey('ABC-123: fix the thing')).toBe('ABC-123')
    expect(parseIssueKey('Merge PR for PROJ2-9 into main')).toBe('PROJ2-9')
  })

  it('returns null when no key is present', () => {
    expect(parseIssueKey('just some text')).toBeNull()
    expect(parseIssueKey('')).toBeNull()
    expect(parseIssueKey(null)).toBeNull()
    expect(parseIssueKey(undefined)).toBeNull()
  })

  it('exposes the valid status list', () => {
    expect(CI_STATUSES).toEqual(['pending', 'running', 'success', 'failed', 'canceled'])
  })
})

describe('POST /api/ci/status', () => {
  it('links a build to the issue referenced in the branch', async () => {
    get.mockResolvedValueOnce({ id: 42 }) // issue lookup by key
    run.mockResolvedValueOnce({ lastID: 7, changes: 1 })

    const res = await request(createApp())
      .post('/api/ci/status')
      .send({ pipeline: 'ci', branch: 'feature/JL-56-cicd', status: 'success', url: 'http://ci/1', duration_seconds: 90 })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 7, issueId: 42, status: 'success' })
    // resolved by issue_key
    expect(get).toHaveBeenCalledWith('SELECT id FROM issues WHERE issue_key = ?', ['JL-56'])
    // inserted with resolved issue id and status
    expect(run.mock.calls[0][1][0]).toBe(42)
    expect(run.mock.calls[0][1][4]).toBe('success')
  })

  it('resolves the issue from the commit message when branch has no key', async () => {
    get.mockResolvedValueOnce({ id: 5 })
    run.mockResolvedValueOnce({ lastID: 1, changes: 1 })

    const res = await request(createApp())
      .post('/api/ci/status')
      .send({ branch: 'main', message: 'closes ABC-9', status: 'failed' })

    expect(res.status).toBe(201)
    expect(get).toHaveBeenCalledWith('SELECT id FROM issues WHERE issue_key = ?', ['ABC-9'])
  })

  it('rejects an invalid status', async () => {
    const res = await request(createApp())
      .post('/api/ci/status')
      .send({ branch: 'feature/JL-56', status: 'exploded' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/status must be one of/)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 when no matching issue can be resolved', async () => {
    get.mockResolvedValueOnce(undefined) // key resolved but no issue
    const res = await request(createApp())
      .post('/api/ci/status')
      .send({ branch: 'feature/ZZ-99', status: 'running' })

    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('GET /api/issues/:id/ci-builds', () => {
  it('returns builds newest-first for the issue', async () => {
    const rows = [
      { id: 3, issue_id: 1, status: 'success', pipeline: 'ci', created_at: '2026-07-08T10:00:00Z' },
      { id: 2, issue_id: 1, status: 'failed', pipeline: 'ci', created_at: '2026-07-08T09:00:00Z' },
    ]
    all.mockResolvedValueOnce(rows)

    const res = await request(createApp()).get('/api/issues/1/ci-builds')

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].id).toBe(3)
    const sql = all.mock.calls[0][0]
    expect(sql).toMatch(/ORDER BY created_at DESC/i)
    expect(all.mock.calls[0][1]).toEqual([1])
  })
})
