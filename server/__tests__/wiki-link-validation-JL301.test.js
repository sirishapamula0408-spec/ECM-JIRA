// @vitest-environment node
// JL-301: linking an issue to a wiki page must validate that the issue exists
// and return a clear error instead of silently linking nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/wiki', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/wiki.js')
  app = createApp(mod)
})

describe('POST /api/wiki/:id/link-issue validation (JL-301)', () => {
  it('links by numeric issueId when the issue exists', async () => {
    get.mockResolvedValue({ id: 5, issue_key: 'ECM-5' })
    run.mockResolvedValue({ lastID: 1 })

    const res = await request(app).post('/api/wiki/1/link-issue').send({ issueId: 5 })
    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.issueKey).toBe('ECM-5')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('links by issue key (case-insensitive) when the issue exists', async () => {
    get.mockResolvedValue({ id: 7, issue_key: 'ECM-7' })
    run.mockResolvedValue({ lastID: 2 })

    const res = await request(app).post('/api/wiki/1/link-issue').send({ issueKey: 'ecm-7' })
    expect(res.status).toBe(201)
    expect(res.body.issueId).toBe(7)
    expect(res.body.issueKey).toBe('ECM-7')
    // Lookup used a case-insensitive match on issue_key
    expect(get).toHaveBeenCalledWith(expect.stringContaining('UPPER(issue_key)'), ['ecm-7'])
  })

  it('returns 404 with a clear error for a non-existent issue key', async () => {
    get.mockResolvedValue(null)

    const res = await request(app).post('/api/wiki/1/link-issue').send({ issueKey: 'tp1' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Issue tp1 not found')
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 for a non-existent numeric issueId', async () => {
    get.mockResolvedValue(null)

    const res = await request(app).post('/api/wiki/1/link-issue').send({ issueId: 9999 })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Issue 9999 not found')
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 400 when neither issueId nor issueKey is provided', async () => {
    const res = await request(app).post('/api/wiki/1/link-issue').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/issueId or issueKey/)
  })

  it('returns 400 for a non-numeric issueId', async () => {
    const res = await request(app).post('/api/wiki/1/link-issue').send({ issueId: 'abc' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/valid issue id/)
    expect(run).not.toHaveBeenCalled()
  })
})
