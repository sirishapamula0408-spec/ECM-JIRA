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

// Mock side-effect helpers so the comments route stays self-contained
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

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import commentsRouter from '../routes/comments.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api/issues', commentsRouter)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  all.mockResolvedValue([]) // default: no watchers
})

describe('JL-99 — comment author resolution', () => {
  describe('GET /api/issues/:id/comments', () => {
    it('resolves an email-based author to the member display name', async () => {
      all.mockImplementation(async (sql) => {
        if (/FROM comments/.test(sql)) {
          return [{ id: 1, issue_id: 7, author: 'alice@x.com', text: 'hi', created_at: 't' }]
        }
        return []
      })
      get.mockImplementation(async (sql, params) => {
        if (/FROM members/.test(sql) && params[0] === 'alice@x.com') {
          return { name: 'Alice Anderson' }
        }
        return null
      })

      const res = await request(createApp()).get('/api/issues/7/comments')
      expect(res.status).toBe(200)
      expect(res.body[0].author).toBe('Alice Anderson')
      expect(res.body[0].author).not.toBe('Unknown')
    })

    it('leaves a plain-name author unchanged and never mislabels it', async () => {
      all.mockImplementation(async (sql) => {
        if (/FROM comments/.test(sql)) {
          return [
            { id: 1, issue_id: 7, author: 'Bob Builder', text: 'a', created_at: 't' },
            { id: 2, issue_id: 7, author: 'Unknown', text: 'b', created_at: 't' },
          ]
        }
        return []
      })
      get.mockResolvedValue(null)

      const res = await request(createApp()).get('/api/issues/7/comments')
      expect(res.status).toBe(200)
      expect(res.body[0].author).toBe('Bob Builder')
      // A legacy 'Unknown' with no matching member stays as a sensible fallback
      expect(res.body[1].author).toBe('Unknown')
    })
  })

  describe('POST /api/issues/:id/comments', () => {
    function wireInsert(memberRow) {
      let insertedAuthor
      run.mockImplementation(async (sql, params) => {
        if (/INSERT INTO comments/.test(sql)) {
          insertedAuthor = params[1]
          return { lastID: 5 }
        }
        return { lastID: 1 }
      })
      get.mockImplementation(async (sql) => {
        if (/FROM members/.test(sql)) return memberRow
        if (/FROM comments WHERE id/.test(sql)) {
          return { id: 5, issue_id: 7, author: insertedAuthor, text: 'hello', created_at: 't' }
        }
        if (/FROM issues/.test(sql)) return { id: 7, issue_key: 'ECM-7', project_id: 1, assignee: 'x' }
        return null
      })
    }

    it('keeps an explicitly supplied author', async () => {
      wireInsert({ name: 'Should Not Be Used' })
      const res = await request(createApp())
        .post('/api/issues/7/comments')
        .send({ author: 'Carol Client', text: 'hello' })
      expect(res.status).toBe(201)
      expect(res.body.author).toBe('Carol Client')
    })

    it('resolves a blank author to the authenticated member name (not Unknown)', async () => {
      wireInsert({ name: 'Test User' })
      const res = await request(createApp())
        .post('/api/issues/7/comments')
        .send({ author: '', text: 'hello' })
      expect(res.status).toBe(201)
      expect(res.body.author).toBe('Test User')
      expect(res.body.author).not.toBe('Unknown')
    })

    it('falls back to the authenticated email when no member record exists', async () => {
      wireInsert(null)
      const res = await request(createApp())
        .post('/api/issues/7/comments')
        .send({ text: 'hello' })
      expect(res.status).toBe(201)
      expect(res.body.author).toBe('test@test.com')
      expect(res.body.author).not.toBe('Unknown')
    })
  })
})
