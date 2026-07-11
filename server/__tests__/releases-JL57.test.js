import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import releaseRoutes from '../routes/releases.js'

// Build an app with a stubbed auth middleware for a given workspace role.
function createApp(role = 'Admin', isOwner = false) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api', releaseRoutes)
  app.use(errorHandler)
  return app
}

let app
beforeEach(() => {
  vi.clearAllMocks()
  app = createApp('Admin')
})

/* ================================================================
   JL-57 Release Management
   ================================================================ */
describe('Releases API — list & get', () => {
  it('lists releases for a project with issue counts', async () => {
    all.mockResolvedValue([
      { id: 1, project_id: 1, name: 'v1.0', description: '', release_date: '2026-08-01', status: 'unreleased', created_at: 'now', issueCount: 3 },
    ])
    const res = await request(app).get('/api/projects/1/releases')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('v1.0')
    expect(res.body[0].issueCount).toBe(3)
  })

  it('returns a single release', async () => {
    get.mockResolvedValue({ id: 5, project_id: 1, name: 'v2.0', description: 'big', release_date: null, status: 'released', created_at: 'now' })
    const res = await request(app).get('/api/releases/5')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('released')
  })

  it('404s for a missing release', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).get('/api/releases/999')
    expect(res.status).toBe(404)
  })
})

describe('Releases API — create', () => {
  it('creates a release', async () => {
    run.mockResolvedValue({ lastID: 10 })
    get.mockResolvedValue({ id: 10, project_id: 1, name: 'v1.2.0', description: '', release_date: '2026-09-01', status: 'unreleased', created_at: 'now' })
    const res = await request(app).post('/api/projects/1/releases').send({ name: 'v1.2.0', releaseDate: '2026-09-01' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(10)
    expect(run).toHaveBeenCalled()
  })

  it('rejects a missing name', async () => {
    const res = await request(app).post('/api/projects/1/releases').send({ name: '' })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an invalid status', async () => {
    const res = await request(app).post('/api/projects/1/releases').send({ name: 'v1', status: 'shipped' })
    expect(res.status).toBe(400)
  })

  it('forbids a Viewer from creating', async () => {
    const viewerApp = createApp('Viewer')
    const res = await request(viewerApp).post('/api/projects/1/releases').send({ name: 'v1' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('Releases API — update & delete', () => {
  it('updates a release status', async () => {
    get.mockResolvedValueOnce({ id: 1, project_id: 1, name: 'v1', description: '', release_date: null, status: 'unreleased' })
      .mockResolvedValueOnce({ id: 1, project_id: 1, name: 'v1', description: '', release_date: null, status: 'released', created_at: 'now' })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).patch('/api/releases/1').send({ status: 'released' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('released')
  })

  it('404s when updating a missing release', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).patch('/api/releases/999').send({ name: 'x' })
    expect(res.status).toBe(404)
  })

  it('deletes a release (Admin)', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/releases/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('forbids a Member from deleting', async () => {
    const memberApp = createApp('Member')
    const res = await request(memberApp).delete('/api/releases/1')
    expect(res.status).toBe(403)
  })
})

describe('Releases API — assign issue', () => {
  it('assigns an issue to a release', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM issues')) return { id: 7, project_id: 1 }
      if (sql.includes('FROM releases')) return { id: 2, project_id: 1 }
      return null
    })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).put('/api/issues/7/release').send({ releaseId: 2 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ issueId: 7, releaseId: 2 })
  })

  it('unassigns an issue when releaseId is null', async () => {
    get.mockResolvedValue({ id: 7, project_id: 1 })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).put('/api/issues/7/release').send({ releaseId: null })
    expect(res.status).toBe(200)
    expect(res.body.releaseId).toBeNull()
  })

  it('404s when the issue does not exist', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).put('/api/issues/999/release').send({ releaseId: 1 })
    expect(res.status).toBe(404)
  })

  it('rejects cross-project assignment', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM issues')) return { id: 7, project_id: 1 }
      if (sql.includes('FROM releases')) return { id: 2, project_id: 99 }
      return null
    })
    const res = await request(app).put('/api/issues/7/release').send({ releaseId: 2 })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('Releases API — progress & readiness', () => {
  it('computes progress, percent complete and unresolved issues', async () => {
    get.mockResolvedValue({ id: 1, project_id: 1, name: 'v1', status: 'unreleased' })
    all.mockImplementation(async (sql) => {
      if (sql.includes('GROUP BY status')) {
        return [{ status: 'Done', count: 3 }, { status: 'In Progress', count: 1 }]
      }
      // unresolved issues query
      return [{ id: 5, issue_key: 'TP-5', title: 'Fix bug', issue_type: 'Bug', status: 'In Progress', assignee: 'Ann' }]
    })
    const res = await request(app).get('/api/releases/1/progress')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(4)
    expect(res.body.done).toBe(3)
    expect(res.body.unresolvedCount).toBe(1)
    expect(res.body.percentComplete).toBe(75)
    expect(res.body.ready).toBe(false)
    expect(res.body.unresolvedIssues).toHaveLength(1)
  })

  it('reports ready=true when all issues are resolved', async () => {
    get.mockResolvedValue({ id: 1, project_id: 1, name: 'v1', status: 'unreleased' })
    all.mockImplementation(async (sql) => {
      if (sql.includes('GROUP BY status')) return [{ status: 'Done', count: 2 }]
      return []
    })
    const res = await request(app).get('/api/releases/1/progress')
    expect(res.status).toBe(200)
    expect(res.body.percentComplete).toBe(100)
    expect(res.body.ready).toBe(true)
  })

  it('404s progress for a missing release', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).get('/api/releases/999/progress')
    expect(res.status).toBe(404)
  })
})

describe('Releases API — release notes', () => {
  it('groups issues by type', async () => {
    get.mockResolvedValue({ id: 1, project_id: 1, name: 'v1', description: '', release_date: null, status: 'released', created_at: 'now' })
    all.mockResolvedValue([
      { id: 1, issue_key: 'TP-1', title: 'Login', issue_type: 'Story', status: 'Done' },
      { id: 2, issue_key: 'TP-2', title: 'Crash', issue_type: 'Bug', status: 'Done' },
      { id: 3, issue_key: 'TP-3', title: 'Signup', issue_type: 'Story', status: 'Done' },
    ])
    const res = await request(app).get('/api/releases/1/notes')
    expect(res.status).toBe(200)
    expect(res.body.totalIssues).toBe(3)
    expect(res.body.groups.Story).toHaveLength(2)
    expect(res.body.groups.Bug).toHaveLength(1)
  })

  it('404s notes for a missing release', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).get('/api/releases/999/notes')
    expect(res.status).toBe(404)
  })
})
