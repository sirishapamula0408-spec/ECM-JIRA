/**
 * JL-204 — Server-side length caps + trim for user-facing text fields.
 *
 * Mocked-db route tests (model: collaboration-modules.test.js) covering:
 *  - issues.js  : title (255) / description (20000) on create, patch, sub-task
 *  - projects.js: name (120) / key (10) on create
 *  - sprints.js : name (120) / goal (1000) on create + patch
 *  - trim-before-persist: the trimmed value is what reaches the INSERT/UPDATE
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — no real database is touched.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(),
  // JL-211: projects create now consults the workspace project-creation policy
  // via getSetting(); undefined → the 'all_members' default (Admin stub passes).
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}))

// Mock notifications helper (imported transitively by automation.js / issues.js)
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    createNotification: vi.fn().mockResolvedValue(1),
  }
})

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  ISSUE_TITLE_MAX,
  ISSUE_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  PROJECT_KEY_MAX,
  SPRINT_NAME_MAX,
  SPRINT_GOAL_MAX,
  maxLengthError,
} from '../utils/validation.js'

// Helper: create an app that stubs auth as a workspace Admin (passes requireRole).
function createApp(routeModule, mountPath = '/api') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

const over = (n) => 'x'.repeat(n + 1)

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   maxLengthError helper (pure)
   ================================================================ */
describe('maxLengthError helper', () => {
  it('returns null when value is within the cap', () => {
    expect(maxLengthError('title', 'x'.repeat(255), 255)).toBeNull()
    expect(maxLengthError('title', '', 255)).toBeNull()
    expect(maxLengthError('goal', null, 1000)).toBeNull()
  })

  it('names the field and the limit when over the cap', () => {
    const msg = maxLengthError('title', over(255), 255)
    expect(msg).toContain('title')
    expect(msg).toContain('255')
  })
})

/* ================================================================
   issues.js — title / description caps + trim
   ================================================================ */
describe('Issues text length caps (issues.js)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/issues.js')
    app = createApp(mod)
  })

  it(`POST /api rejects a title over ${ISSUE_TITLE_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api').send({
      title: over(ISSUE_TITLE_MAX),
      description: 'valid description',
      assignee: 'Alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('title')
    expect(res.body.error).toContain(String(ISSUE_TITLE_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it(`POST /api rejects a description over ${ISSUE_DESCRIPTION_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api').send({
      title: 'valid title',
      description: over(ISSUE_DESCRIPTION_MAX),
      assignee: 'Alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('description')
    expect(res.body.error).toContain(String(ISSUE_DESCRIPTION_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it('POST /api accepts a title exactly at the cap (whitespace does not count against it)', async () => {
    // Padded title trims down to exactly the cap → passes the length gate and
    // proceeds past validation (fails later on priority, NOT on length).
    const res = await request(app).post('/api').send({
      title: `   ${'x'.repeat(ISSUE_TITLE_MAX)}   `,
      description: 'valid description',
      assignee: 'Alice',
      priority: 'Bogus',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('priority')
  })

  it(`PATCH /api/:id rejects a title over ${ISSUE_TITLE_MAX} chars with 400`, async () => {
    get.mockResolvedValue({ id: 1, issue_key: 'PROJ-1', title: 'Old', description: 'd', priority: 'Medium', assignee: 'Alice', status: 'To Do', issue_type: 'Task' })

    const res = await request(app).patch('/api/1').send({ title: over(ISSUE_TITLE_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('title')
    expect(res.body.error).toContain(String(ISSUE_TITLE_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it(`PATCH /api/:id rejects a description over ${ISSUE_DESCRIPTION_MAX} chars with 400`, async () => {
    get.mockResolvedValue({ id: 1, issue_key: 'PROJ-1', title: 'Old', description: 'd', priority: 'Medium', assignee: 'Alice', status: 'To Do', issue_type: 'Task' })

    const res = await request(app).patch('/api/1').send({ description: over(ISSUE_DESCRIPTION_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('description')
    expect(run).not.toHaveBeenCalled()
  })

  it('PATCH /api/:id trims the title before persisting (trimmed value in UPDATE params)', async () => {
    get.mockResolvedValue({ id: 1, issue_key: 'PROJ-1', title: 'Old title', description: 'd', priority: 'Medium', assignee: 'Alice', status: 'To Do', issue_type: 'Task' })
    run.mockResolvedValue({ changes: 1 })
    all.mockResolvedValue([])

    const res = await request(app).patch('/api/1').send({ title: '   Trimmed title   ' })
    expect(res.status).toBe(200)

    const updateCall = run.mock.calls.find(([sql]) => sql.startsWith('UPDATE issues'))
    expect(updateCall).toBeTruthy()
    expect(updateCall[1][0]).toBe('Trimmed title')
  })

  it('POST /api/:parentId/subtasks trims title/description before the INSERT', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('parent_id FROM issues')) return { id: 1, assignee: 'Alice', status: 'To Do', sprint_id: 3, project_id: 7, parent_id: null }
      if (sql.includes('key FROM projects')) return { key: 'TP' }
      if (sql.includes('issue_counter')) return { issue_counter: 5 }
      if (sql.includes('COUNT(*)')) return { count: '4' }
      return { id: 99, issue_key: 'TP-5', title: 'Child', description: 'Child desc', priority: 'Medium', assignee: 'Alice', status: 'To Do', issue_type: 'Sub-task', sprint_id: 3, project_id: 7, parent_id: 1 }
    })
    run.mockResolvedValue({ lastID: 99, changes: 1 })

    const res = await request(app).post('/api/1/subtasks').send({
      title: '  Child  ',
      description: '  Child desc  ',
    })
    expect(res.status).toBe(201)

    const insertCall = run.mock.calls.find(([sql]) => sql.includes('INSERT INTO issues'))
    expect(insertCall).toBeTruthy()
    expect(insertCall[1][1]).toBe('Child')       // title
    expect(insertCall[1][2]).toBe('Child desc')  // description
  })

  it(`POST /api/:parentId/subtasks rejects an over-cap title with 400`, async () => {
    get.mockResolvedValue({ id: 1, assignee: 'Alice', status: 'To Do', sprint_id: 3, project_id: 7, parent_id: null })

    const res = await request(app).post('/api/1/subtasks').send({ title: over(ISSUE_TITLE_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('title')
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   projects.js — name / key caps + trim
   ================================================================ */
describe('Projects text length caps (projects.js)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/projects.js')
    app = createApp(mod)
  })

  it(`POST /api rejects a name over ${PROJECT_NAME_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api').send({
      name: over(PROJECT_NAME_MAX),
      key: 'TP',
      type: 'Scrum',
      lead: 'Alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('name')
    expect(res.body.error).toContain(String(PROJECT_NAME_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it(`POST /api rejects a key over ${PROJECT_KEY_MAX} chars with 400`, async () => {
    const res = await request(app).post('/api').send({
      name: 'Test Project',
      key: over(PROJECT_KEY_MAX),
      type: 'Scrum',
      lead: 'Alice',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('key')
    expect(res.body.error).toContain(String(PROJECT_KEY_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it('POST /api trims name/key before the INSERT (trimmed values in params)', async () => {
    get.mockResolvedValue({ id: 1 }) // member lookup
    run.mockResolvedValue({ lastID: 3, changes: 1 })

    const res = await request(app).post('/api').send({
      name: '  Test Project  ',
      key: '  TP  ',
      type: 'Scrum',
      lead: '  Alice  ',
    })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Test Project')
    expect(res.body.key).toBe('TP')

    const insertCall = run.mock.calls.find(([sql]) => sql.includes('INSERT INTO projects'))
    expect(insertCall).toBeTruthy()
    expect(insertCall[1][0]).toBe('Test Project')
    expect(insertCall[1][1]).toBe('TP')
    expect(insertCall[1][3]).toBe('Alice')
  })
})

/* ================================================================
   sprints.js — name / goal caps + trim
   ================================================================ */
describe('Sprints text length caps (sprints.js)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/sprints.js')
    app = createApp(mod)
  })

  it(`POST /api rejects a name over ${SPRINT_NAME_MAX} chars with 400`, async () => {
    get.mockResolvedValue({ count: '0' })

    const res = await request(app).post('/api').send({ name: over(SPRINT_NAME_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('name')
    expect(res.body.error).toContain(String(SPRINT_NAME_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it(`POST /api rejects a goal over ${SPRINT_GOAL_MAX} chars with 400`, async () => {
    get.mockResolvedValue({ count: '0' })

    const res = await request(app).post('/api').send({ name: 'Sprint 1', goal: over(SPRINT_GOAL_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('goal')
    expect(res.body.error).toContain(String(SPRINT_GOAL_MAX))
    expect(run).not.toHaveBeenCalled()
  })

  it('POST /api trims name/goal before the INSERT (trimmed values in params)', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('COUNT(*)')) return { count: '4' }
      return { id: 7, name: 'Sprint Alpha', date_range: 'Upcoming', is_started: false, goal: 'Ship the thing' }
    })
    run.mockResolvedValue({ lastID: 7, changes: 1 })

    const res = await request(app).post('/api').send({
      name: '  Sprint Alpha  ',
      goal: '  Ship the thing  ',
    })
    expect(res.status).toBe(201)

    const insertCall = run.mock.calls.find(([sql]) => sql.includes('INSERT INTO sprints'))
    expect(insertCall).toBeTruthy()
    expect(insertCall[1][0]).toBe('Sprint Alpha')     // name (trimmed)
    expect(insertCall[1][3]).toBe('Ship the thing')   // goal (trimmed)
  })

  it(`PATCH /api/:id rejects a name over ${SPRINT_NAME_MAX} chars with 400`, async () => {
    const res = await request(app).patch('/api/5').send({ name: over(SPRINT_NAME_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('name')
    expect(run).not.toHaveBeenCalled()
  })

  it(`PATCH /api/:id rejects a goal over ${SPRINT_GOAL_MAX} chars with 400`, async () => {
    const res = await request(app).patch('/api/5').send({ name: 'Sprint 1', goal: over(SPRINT_GOAL_MAX) })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('goal')
    expect(run).not.toHaveBeenCalled()
  })
})
