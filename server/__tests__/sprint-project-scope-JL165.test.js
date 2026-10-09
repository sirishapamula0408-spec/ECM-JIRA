/* ================================================================
   JL-165 (fosasoft) — a sprint belongs to a project.

   Before: sprints had no project, so every project saw every sprint, a new
   "To Do" issue was dropped into the first sprint in the whole system, and
   one active sprint anywhere blocked starting one everywhere else.
   ================================================================ */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(), all: vi.fn(), get: vi.fn(), columnExists: vi.fn(), tableExists: vi.fn(), withTransaction: vi.fn(),
}))
vi.mock('../services/automation.js', () => ({ runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/events.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))

import { run, all, get } from '../db.js'
import { sprintFitsProject } from '../routes/sprints.js'
import { errorHandler } from '../middleware/errorHandler.js'

const ADMIN = { id: 1, email: 'admin@x.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }

async function appFor(modulePath, mount) {
  const mod = await import(modulePath)
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { ...ADMIN }; next() })
  app.use(mount, mod.default)
  app.use(errorHandler)
  return app
}

/** Answer db.get by the SQL it is asked, so call order does not matter. */
function getBySql(table) {
  get.mockImplementation(async (sql, params = []) => {
    for (const [pattern, answer] of table) {
      if (pattern.test(sql)) return typeof answer === 'function' ? answer(params) : answer
    }
    return undefined
  })
}

const sqlOf = (mockFn, re) => mockFn.mock.calls.filter((c) => re.test(c[0]))

beforeEach(() => {
  vi.clearAllMocks()
  run.mockResolvedValue({ lastID: 9, changes: 1 })
  all.mockResolvedValue([])
})

describe('sprintFitsProject', () => {
  it('accepts the project\'s own sprint and a shared legacy one', () => {
    expect(sprintFitsProject({ project_id: 4 }, 4)).toBe(true)
    expect(sprintFitsProject({ project_id: null }, 4)).toBe(true)
  })
  it('rejects another project\'s sprint, and a missing sprint', () => {
    expect(sprintFitsProject({ project_id: 5 }, 4)).toBe(false)
    expect(sprintFitsProject(null, 4)).toBe(false)
  })
  it('lets a project-less (legacy) issue use any sprint', () => {
    expect(sprintFitsProject({ project_id: 5 }, null)).toBe(true)
  })
})

describe('GET /api/sprints', () => {
  it('?projectId returns that project\'s sprints plus shared ones', async () => {
    all.mockResolvedValue([{ id: 1, project_id: 4, name: 'A', date_range: 'x', is_started: false }])
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).get('/api/sprints?projectId=4')
    expect(res.status).toBe(200)
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/WHERE project_id = \? OR project_id IS NULL/)
    expect(params).toEqual([4])
    expect(res.body[0].projectId).toBe(4)
  })

  it('without projectId returns every sprint, each naming its project', async () => {
    all.mockResolvedValue([{ id: 1, project_id: null, name: 'Shared', date_range: 'x', is_started: false }])
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).get('/api/sprints')
    expect(all.mock.calls[0][0]).not.toMatch(/WHERE/)
    expect(res.body[0].projectId).toBeNull()
  })
})

describe('POST /api/sprints', () => {
  it('refuses a sprint with no project', async () => {
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).post('/api/sprints').send({ name: 'S' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/projectId is required/)
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses an unknown project', async () => {
    getBySql([[/FROM projects/, undefined]])
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).post('/api/sprints').send({ projectId: 99 })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('stores the project, and numbers the default name within it', async () => {
    getBySql([
      [/FROM projects/, { id: 4, key: 'PMP' }],
      [/COUNT\(\*\) AS count FROM sprints WHERE project_id = \?/, { count: 2 }],
      [/FROM sprints WHERE id = \?/, { id: 9, project_id: 4, name: 'PMP Sprint 3', date_range: 'Upcoming', is_started: false }],
    ])
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).post('/api/sprints').send({ projectId: 4 })
    expect(res.status).toBe(201)
    const [sql, params] = sqlOf(run, /INSERT INTO sprints/)[0]
    expect(sql).toMatch(/\(project_id, name/)
    expect(params.slice(0, 2)).toEqual([4, 'PMP Sprint 3'])
    expect(res.body.projectId).toBe(4)
  })
})

describe('PATCH /api/sprints/:id/start — one active sprint PER PROJECT', () => {
  it('counts only the sprint\'s own project\'s active sprints', async () => {
    getBySql([
      [/SELECT id, project_id FROM sprints WHERE id = \?/, { id: 7, project_id: 4 }],
      [/allow_parallel_sprints/, { allow_parallel_sprints: false }],
      [/COUNT\(\*\) AS count FROM sprints WHERE is_started/, { count: 0 }],
      [/FROM sprints WHERE id = \?/, { id: 7, project_id: 4, name: 'S', date_range: 'x', is_started: true }],
    ])
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).patch('/api/sprints/7/start')
    expect(res.status).toBe(200)
    const [countSql, countParams] = sqlOf(get, /COUNT\(\*\) AS count FROM sprints WHERE is_started/)[0]
    expect(countSql).toMatch(/AND project_id = \?/)
    expect(countParams).toEqual([7, 4])
  })

  it('404s an unknown sprint before touching anything', async () => {
    getBySql([[/SELECT id, project_id FROM sprints WHERE id = \?/, undefined]])
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).patch('/api/sprints/7/start')
    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/sprints/:id { projectId } — assigning a shared sprint', () => {
  const body = { name: 'Legacy', projectId: 4 }

  it('assigns a shared sprint whose issues are all in that project', async () => {
    getBySql([
      [/SELECT project_id FROM sprints WHERE id = \?/, { project_id: null }],
      [/FROM projects WHERE id = \?/, { id: 4 }],
      [/FROM issues WHERE sprint_id = \? AND project_id IS NOT NULL AND project_id != \?/, { count: 0 }],
      [/FROM sprints WHERE id = \?/, { id: 3, project_id: 4, name: 'Legacy', date_range: 'x', is_started: false }],
    ])
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).patch('/api/sprints/3').send(body)
    expect(res.status).toBe(200)
    const [sql, params] = sqlOf(run, /UPDATE sprints SET/)[0]
    expect(sql).toMatch(/project_id = \?/)
    expect(params).toContain(4)
  })

  it('refuses while it still holds other projects\' issues', async () => {
    getBySql([
      [/SELECT project_id FROM sprints WHERE id = \?/, { project_id: null }],
      [/FROM projects WHERE id = \?/, { id: 4 }],
      [/FROM issues WHERE sprint_id = \?/, { count: 3 }],
    ])
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).patch('/api/sprints/3').send(body)
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/3 issue\(s\) from other projects/)
    expect(sqlOf(run, /UPDATE sprints SET/)).toHaveLength(0)
  })

  it('refuses to move a sprint from one project to another', async () => {
    getBySql([
      [/SELECT project_id FROM sprints WHERE id = \?/, { project_id: 5 }],
      [/FROM projects WHERE id = \?/, { id: 4 }],
    ])
    const res = await request(await appFor('../routes/sprints.js', '/api/sprints')).patch('/api/sprints/3').send(body)
    expect(res.status).toBe(409)
  })
})

describe('GET /api/projects/:id/sprints/active', () => {
  it('lists only that project\'s active sprints (and shared ones)', async () => {
    const mod = await import('../routes/sprints.js')
    const app = express()
    app.use((req, _res, next) => { req.user = { ...ADMIN }; next() })
    app.use('/api', mod.projectSprintRouter)
    await request(app).get('/api/projects/4/sprints/active')
    const [sql, params] = all.mock.calls[0]
    expect(sql).toMatch(/is_started = TRUE AND \(project_id = \? OR project_id IS NULL\)/)
    expect(params).toEqual([4])
  })
})

describe('POST /api/issues/bulk — a sprint from another project', () => {
  const issueRow = (over) => ({ id: 1, issue_key: 'A-1', title: 'X', priority: 'Medium', assignee: 'A', status: 'To Do', sprint_id: null, project_id: 4, ...over })

  it('moves only the issues the sprint belongs to', async () => {
    all.mockResolvedValueOnce([issueRow({ id: 1, project_id: 4 }), issueRow({ id: 2, issue_key: 'B-1', project_id: 5 })])
    getBySql([[/SELECT id, project_id FROM sprints WHERE id = \?/, { id: 30, project_id: 4 }]])
    const res = await request(await appFor('../routes/issues.js', '/api/issues'))
      .post('/api/issues/bulk')
      .send({ issueIds: [1, 2], operations: { sprintId: 30 }, dryRun: false })
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(1)
    expect(res.body.errors).toEqual([{ issueId: 2, error: 'That sprint belongs to another project' }])
  })

  it('the dry run shows the same refusal', async () => {
    all.mockResolvedValueOnce([issueRow({ id: 2, issue_key: 'B-1', project_id: 5 })])
    getBySql([[/SELECT id, project_id FROM sprints WHERE id = \?/, { id: 30, project_id: 4 }]])
    const res = await request(await appFor('../routes/issues.js', '/api/issues'))
      .post('/api/issues/bulk')
      .send({ issueIds: [2], operations: { sprintId: 30 }, dryRun: true })
    expect(res.body.preview[0].error).toBe('That sprint belongs to another project')
  })
})
