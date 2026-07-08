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
import goalRoutes from '../routes/goals.js'

// Build an app with a configurable stub user (for role-gating tests).
function createApp(user = { workspaceRole: 'Admin', isOwner: false }) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, isOwner: false, workspaceRole: 'Member', ...user }
    next()
  })
  app.use('/api', goalRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('JL-54 Goals / OKR API', () => {
  describe('POST /api/projects/:projectId/goals — create objective', () => {
    it('creates a goal (Member+) and returns it with empty key results + 0 progress', async () => {
      run.mockResolvedValue({ lastID: 10, changes: 1 })
      get.mockResolvedValue({
        id: 10, project_id: 1, objective: 'Improve onboarding', description: 'desc',
        owner: 'alice', status: 'on_track', due_date: '2026-12-31', created_at: 't',
      })

      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app)
        .post('/api/projects/1/goals')
        .send({ objective: 'Improve onboarding', description: 'desc', owner: 'alice', dueDate: '2026-12-31' })

      expect(res.status).toBe(201)
      expect(res.body.id).toBe(10)
      expect(res.body.objective).toBe('Improve onboarding')
      expect(res.body.keyResults).toEqual([])
      expect(res.body.progress).toBe(0)
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO goals'),
        expect.arrayContaining([1, 'Improve onboarding']),
      )
    })

    it('rejects missing objective with 400', async () => {
      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app).post('/api/projects/1/goals').send({ objective: '' })
      expect(res.status).toBe(400)
      expect(run).not.toHaveBeenCalled()
    })

    it('rejects an invalid status with 400', async () => {
      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app).post('/api/projects/1/goals').send({ objective: 'X', status: 'bogus' })
      expect(res.status).toBe(400)
    })

    it('forbids a Viewer from creating a goal (403)', async () => {
      const app = createApp({ workspaceRole: 'Viewer' })
      const res = await request(app).post('/api/projects/1/goals').send({ objective: 'X' })
      expect(res.status).toBe(403)
      expect(run).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/goals/:goalId/key-results — add a key result', () => {
    it('adds a key result and returns its computed progress', async () => {
      get
        .mockResolvedValueOnce({ id: 10 }) // goal lookup
        .mockResolvedValueOnce({ id: 5, goal_id: 10, title: 'Signups', target_value: 200, current_value: 50, unit: 'users', issue_id: null }) // created row
      run.mockResolvedValue({ lastID: 5, changes: 1 })

      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app)
        .post('/api/goals/10/key-results')
        .send({ title: 'Signups', targetValue: 200, currentValue: 50, unit: 'users' })

      expect(res.status).toBe(201)
      expect(res.body.id).toBe(5)
      expect(res.body.targetValue).toBe(200)
      expect(res.body.currentValue).toBe(50)
      expect(res.body.progress).toBe(25) // 50/200 = 25%
    })

    it('returns 404 if the goal does not exist', async () => {
      get.mockResolvedValueOnce(undefined)
      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app).post('/api/goals/999/key-results').send({ title: 'X' })
      expect(res.status).toBe(404)
    })

    it('rejects a key result without a title (400)', async () => {
      get.mockResolvedValueOnce({ id: 10 })
      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app).post('/api/goals/10/key-results').send({ title: '' })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/projects/:projectId/goals — list with KRs + progress %', () => {
    it('returns goals each with their key results and averaged progress', async () => {
      all
        .mockResolvedValueOnce([
          { id: 10, project_id: 1, objective: 'Obj A', description: '', owner: '', status: 'on_track', due_date: null, created_at: 't' },
        ]) // goals
        .mockResolvedValueOnce([
          { id: 1, goal_id: 10, title: 'KR1', target_value: 100, current_value: 50, unit: '', issue_id: null }, // 50%
          { id: 2, goal_id: 10, title: 'KR2', target_value: 100, current_value: 100, unit: '', issue_id: null }, // 100%
        ]) // key results

      const app = createApp()
      const res = await request(app).get('/api/projects/1/goals')

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
      expect(res.body[0].keyResults).toHaveLength(2)
      // avg(50, 100) = 75
      expect(res.body[0].progress).toBe(75)
    })

    it('reports 0 progress for a goal with no key results', async () => {
      all
        .mockResolvedValueOnce([
          { id: 11, project_id: 1, objective: 'Empty', description: '', owner: '', status: 'at_risk', due_date: null, created_at: 't' },
        ])
        .mockResolvedValueOnce([])

      const app = createApp()
      const res = await request(app).get('/api/projects/1/goals')
      expect(res.status).toBe(200)
      expect(res.body[0].progress).toBe(0)
      expect(res.body[0].keyResults).toEqual([])
    })
  })

  describe('PATCH /api/key-results/:id — updating current_value changes progress', () => {
    it('recomputes progress after raising current_value', async () => {
      get
        .mockResolvedValueOnce({ id: 5, goal_id: 10, title: 'KR', target_value: 200, current_value: 50, unit: '', issue_id: null }) // existing
        .mockResolvedValueOnce({ id: 5, goal_id: 10, title: 'KR', target_value: 200, current_value: 150, unit: '', issue_id: null }) // updated
      run.mockResolvedValue({ changes: 1 })

      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app).patch('/api/key-results/5').send({ currentValue: 150 })

      expect(res.status).toBe(200)
      expect(res.body.currentValue).toBe(150)
      expect(res.body.progress).toBe(75) // 150/200
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE key_results'),
        expect.arrayContaining([150]),
      )
    })

    it('caps progress at 100% when current exceeds target', async () => {
      get
        .mockResolvedValueOnce({ id: 5, goal_id: 10, title: 'KR', target_value: 100, current_value: 0, unit: '', issue_id: null })
        .mockResolvedValueOnce({ id: 5, goal_id: 10, title: 'KR', target_value: 100, current_value: 250, unit: '', issue_id: null })
      run.mockResolvedValue({ changes: 1 })

      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app).patch('/api/key-results/5').send({ currentValue: 250 })
      expect(res.body.progress).toBe(100)
    })

    it('returns 404 for a missing key result', async () => {
      get.mockResolvedValueOnce(undefined)
      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app).patch('/api/key-results/999').send({ currentValue: 1 })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE — permission gating + cascade', () => {
    it('lets an Admin delete a goal (cascade removes key results)', async () => {
      run.mockResolvedValue({ changes: 1 })
      const app = createApp({ workspaceRole: 'Admin' })
      const res = await request(app).delete('/api/goals/10')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM goals'),
        [10],
      )
    })

    it('forbids a Member from deleting a goal (403)', async () => {
      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app).delete('/api/goals/10')
      expect(res.status).toBe(403)
      expect(run).not.toHaveBeenCalled()
    })

    it('lets a Member delete a key result', async () => {
      run.mockResolvedValue({ changes: 1 })
      const app = createApp({ workspaceRole: 'Member' })
      const res = await request(app).delete('/api/key-results/5')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })
})
