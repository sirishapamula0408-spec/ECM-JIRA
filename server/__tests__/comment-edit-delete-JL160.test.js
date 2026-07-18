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

// Mock helpers used by the comments route so imports resolve cleanly
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, createNotification: vi.fn().mockResolvedValue(1) }
})
vi.mock('../services/automation.js', () => ({
  runCommentAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Build an app with a stubbed auth/role middleware. `user` overrides identity.
function createApp(routeModule, user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      email: 'author@test.com',
      memberId: 1,
      workspaceRole: 'Member',
      isOwner: false,
      ...user,
    }
    next()
  })
  app.use('/api/issues', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let commentsModule
beforeEach(async () => {
  vi.clearAllMocks()
  commentsModule = await import('../routes/comments.js')
})

const existingComment = {
  id: 5,
  issue_id: 10,
  author: 'author@test.com',
  text: 'original text',
  created_at: '2026-01-01T00:00:00Z',
  edited_at: null,
}

describe('PATCH /api/issues/:issueId/comments/:commentId — edit', () => {
  it('updates the comment for the author', async () => {
    const app = createApp(commentsModule, { email: 'author@test.com' })
    // JL-226: the project-access write guard first resolves the issue's project
    // (project-less here → workspace Member+ fallback allows the mutation).
    // 1st get: fetch existing comment; 2nd get: return updated row
    get
      .mockResolvedValueOnce({ project_id: null })
      .mockResolvedValueOnce(existingComment)
      .mockResolvedValueOnce({ ...existingComment, text: 'fixed typo', edited_at: '2026-01-02T00:00:00Z' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app)
      .patch('/api/issues/10/comments/5')
      .send({ text: 'fixed typo' })

    expect(res.status).toBe(200)
    expect(res.body.text).toBe('fixed typo')
    expect(res.body.edited_at).toBeTruthy()
    expect(run).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE comments SET text = \?, edited_at = NOW\(\) WHERE id = \?/),
      ['fixed typo', 5],
    )
  })

  it('allows a non-author Admin to edit', async () => {
    const app = createApp(commentsModule, { email: 'admin@test.com', workspaceRole: 'Admin' })
    get
      .mockResolvedValueOnce(existingComment)
      .mockResolvedValueOnce({ ...existingComment, text: 'admin edit', edited_at: '2026-01-02T00:00:00Z' })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app)
      .patch('/api/issues/10/comments/5')
      .send({ text: 'admin edit' })

    expect(res.status).toBe(200)
    expect(res.body.text).toBe('admin edit')
  })

  it('returns 403 for a non-author non-admin', async () => {
    const app = createApp(commentsModule, { email: 'stranger@test.com', workspaceRole: 'Member' })
    // fetch existing comment, then member lookup returns a different name
    get
      .mockResolvedValueOnce(existingComment)
      .mockResolvedValueOnce({ name: 'Stranger' })

    const res = await request(app)
      .patch('/api/issues/10/comments/5')
      .send({ text: 'hijack' })

    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing comment', async () => {
    const app = createApp(commentsModule, { email: 'author@test.com' })
    get.mockResolvedValueOnce(undefined)

    const res = await request(app)
      .patch('/api/issues/10/comments/999')
      .send({ text: 'anything' })

    expect(res.status).toBe(404)
  })

  it('returns 400 when text is empty', async () => {
    const app = createApp(commentsModule, { email: 'author@test.com' })
    const res = await request(app)
      .patch('/api/issues/10/comments/5')
      .send({ text: '   ' })

    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/issues/:issueId/comments/:commentId — delete', () => {
  it('removes the comment for the author', async () => {
    const app = createApp(commentsModule, { email: 'author@test.com' })
    // JL-226: project-access write guard resolves the issue's project first.
    get.mockResolvedValueOnce({ project_id: null }).mockResolvedValueOnce(existingComment)
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).delete('/api/issues/10/comments/5')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(run).toHaveBeenCalledWith('DELETE FROM comments WHERE id = ?', [5])
  })

  it('allows an Owner (admin) to delete another user\'s comment', async () => {
    const app = createApp(commentsModule, { email: 'owner@test.com', isOwner: true })
    get.mockResolvedValueOnce(existingComment)
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).delete('/api/issues/10/comments/5')

    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith('DELETE FROM comments WHERE id = ?', [5])
  })

  it('returns 403 for a non-author non-admin', async () => {
    const app = createApp(commentsModule, { email: 'stranger@test.com', workspaceRole: 'Member' })
    get
      .mockResolvedValueOnce(existingComment)
      .mockResolvedValueOnce({ name: 'Stranger' })

    const res = await request(app).delete('/api/issues/10/comments/5')

    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing comment', async () => {
    const app = createApp(commentsModule, { email: 'author@test.com' })
    get.mockResolvedValueOnce(undefined)

    const res = await request(app).delete('/api/issues/10/comments/999')

    expect(res.status).toBe(404)
  })
})
