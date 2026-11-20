// @vitest-environment node
// POST /api/issues without a project used to create a project-less PROJ-n
// issue. requireProjectWrite cannot check a project that is not there, so it
// fell back to "any workspace Member", and the issue was then readable and
// editable by everyone. Every issue must now name a project.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { makeDbMock } from './helpers/mockDb.js'

vi.mock('../db.js', () => makeDbMock())
vi.mock('../services/automation.js', () => ({ runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/events.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))

import { run, get, all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

const BODY = { title: 'T', description: 'D', assignee: 'a@test.com', priority: 'Low', status: 'Backlog', issueType: 'Task' }

let app
beforeEach(async () => {
  vi.clearAllMocks()
  get.mockResolvedValue(undefined)
  all.mockResolvedValue([])
  run.mockResolvedValue({ lastID: 1, changes: 1 })
  const { default: issues } = await import('../routes/issues.js')
  app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 3, email: 'member@test.com', memberId: 3, workspaceRole: 'Member', isOwner: false }
    next()
  })
  app.use('/api/issues', issues)
  app.use(errorHandler)
})

const inserts = () => run.mock.calls.filter((c) => String(c[0]).startsWith('INSERT INTO issues'))

describe('POST /api/issues requires a project', () => {
  for (const [label, extra] of [['omitted', {}], ['null', { projectId: null }], ['empty', { projectId: '' }]]) {
    it(`400s and writes nothing when projectId is ${label}`, async () => {
      const res = await request(app).post('/api/issues').send({ ...BODY, ...extra })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/projectId is required/)
      expect(inserts()).toHaveLength(0)
      // No key was minted either — the old path read COUNT(*) for a PROJ-n key.
      expect(get.mock.calls.some((c) => /COUNT\(\*\)|issue_counter/.test(c[0]))).toBe(false)
    })
  }
})
