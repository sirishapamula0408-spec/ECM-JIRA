import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run: vi.fn(), all: vi.fn(), get: vi.fn() })),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import advancedRoadmap, {
  detectDependencyViolations,
  detectCapacityOverload,
  topoOrderEpics,
} from '../routes/advancedRoadmap.js'

// Build an app injecting a workspace role so requireRole('Admin') gates work.
function createApp(role = 'Admin') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = {
      id: 1,
      email: 'lead@test.com',
      memberId: 1,
      workspaceRole: role,
      isOwner: false,
    }
    req.workspaceId = null
    next()
  })
  app.use('/api', advancedRoadmap)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ---------------- pure helpers ---------------- */

describe('detectDependencyViolations (JL-125)', () => {
  const epics = [
    { id: 1, startDate: '2026-01-01', dueDate: '2026-02-01' },
    { id: 2, startDate: '2026-01-15', dueDate: '2026-03-01' }, // starts before epic 1 ends
    { id: 3, startDate: '2026-02-10', dueDate: '2026-03-10' }, // starts after epic 1 ends
  ]

  it('flags a to-epic that starts before the from-epic finishes', () => {
    const deps = [{ id: 10, from_epic_id: 1, to_epic_id: 2, type: 'finish_to_start' }]
    const v = detectDependencyViolations(epics, deps)
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ dependencyId: 10, fromEpicId: 1, toEpicId: 2 })
  })

  it('returns none for a valid schedule', () => {
    const deps = [{ id: 11, from_epic_id: 1, to_epic_id: 3, type: 'finish_to_start' }]
    expect(detectDependencyViolations(epics, deps)).toEqual([])
  })

  it('skips dependencies with missing dates gracefully', () => {
    const partial = [{ id: 1, dueDate: null }, { id: 2, startDate: null }]
    const deps = [{ id: 12, from_epic_id: 1, to_epic_id: 2 }]
    expect(detectDependencyViolations(partial, deps)).toEqual([])
  })
})

describe('detectCapacityOverload (JL-125)', () => {
  const epics = [
    { id: 1, projectId: 5, points: 8, startDate: '2026-01-05', dueDate: '2026-01-20' },
    { id: 2, projectId: 5, points: 5, startDate: '2026-01-10', dueDate: '2026-01-25' },
  ]

  it('flags over-allocation when planned points exceed capacity', () => {
    const caps = [{ teamName: 'Alpha', projectId: 5, capacityPoints: 10, periodStart: '2026-01-01', periodEnd: '2026-01-31' }]
    const load = detectCapacityOverload(epics, caps)
    expect(load).toHaveLength(1)
    expect(load[0].plannedPoints).toBe(13)
    expect(load[0].overloaded).toBe(true)
  })

  it('passes when planned points are within capacity', () => {
    const caps = [{ teamName: 'Alpha', projectId: 5, capacityPoints: 20, periodStart: '2026-01-01', periodEnd: '2026-01-31' }]
    const load = detectCapacityOverload(epics, caps)
    expect(load[0].plannedPoints).toBe(13)
    expect(load[0].overloaded).toBe(false)
  })

  it('excludes epics outside the capacity period', () => {
    const caps = [{ teamName: 'Alpha', projectId: 5, capacityPoints: 4, periodStart: '2026-06-01', periodEnd: '2026-06-30' }]
    const load = detectCapacityOverload(epics, caps)
    expect(load[0].plannedPoints).toBe(0)
    expect(load[0].overloaded).toBe(false)
  })
})

describe('topoOrderEpics (JL-125)', () => {
  it('returns a dependency-respecting order', () => {
    const epics = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const deps = [
      { from_epic_id: 1, to_epic_id: 2 },
      { from_epic_id: 2, to_epic_id: 3 },
    ]
    const { order, cycle } = topoOrderEpics(epics, deps)
    expect(cycle).toBeNull()
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(2))
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(3))
  })

  it('detects a cycle', () => {
    const epics = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const deps = [
      { from_epic_id: 1, to_epic_id: 2 },
      { from_epic_id: 2, to_epic_id: 3 },
      { from_epic_id: 3, to_epic_id: 1 },
    ]
    const { cycle } = topoOrderEpics(epics, deps)
    expect(cycle).not.toBeNull()
    expect(cycle.sort()).toEqual([1, 2, 3])
  })
})

/* ---------------- routes ---------------- */

describe('GET /api/advanced-roadmap (JL-125)', () => {
  it('returns epics + dependencies scoped to accessible projects', async () => {
    // accessibleProjects: member lookup (get), then projects (all)
    get.mockResolvedValueOnce({ id: 1, name: 'Lead' })
    all
      .mockResolvedValueOnce([{ id: 5, key: 'ALP', name: 'Alpha' }]) // accessible projects
      .mockResolvedValueOnce([ // epics
        { id: 100, issue_key: 'ALP-1', title: 'Epic A', status: 'In Progress', project_id: 5, start_date: '2026-01-01', due_date: '2026-02-01', story_points: null },
        { id: 101, issue_key: 'ALP-2', title: 'Epic B', status: 'To Do', project_id: 5, start_date: '2026-01-15', due_date: '2026-03-01', story_points: null },
      ])
      .mockResolvedValueOnce([ // children
        { epic_id: 100, status: 'Done', story_points: 3 },
        { epic_id: 100, status: 'To Do', story_points: 2 },
      ])
      .mockResolvedValueOnce([ // dependencies
        { id: 9, from_epic_id: 100, to_epic_id: 101, type: 'finish_to_start', created_at: 't' },
      ])
      .mockResolvedValueOnce([]) // capacities

    const res = await request(createApp('Member')).get('/api/advanced-roadmap')
    expect(res.status).toBe(200)
    expect(res.body.projects).toHaveLength(1)
    expect(res.body.epics).toHaveLength(2)
    expect(res.body.epics[0].rollup).toMatchObject({ childCount: 2, doneCount: 1, points: 5, donePct: 50 })
    expect(res.body.dependencies).toHaveLength(1)
    // Epic B (101) starts 01-15, before Epic A (100) finishes 02-01 -> violation
    expect(res.body.violations).toHaveLength(1)
    expect(res.body.violations[0]).toMatchObject({ fromEpicId: 100, toEpicId: 101 })
  })

  it('returns empty payload when the caller has no accessible projects', async () => {
    get.mockResolvedValueOnce({ id: 1, name: 'Lead' })
    all.mockResolvedValueOnce([]) // no accessible projects
    const res = await request(createApp('Member')).get('/api/advanced-roadmap')
    expect(res.status).toBe(200)
    expect(res.body.epics).toEqual([])
    expect(res.body.projects).toEqual([])
  })
})

describe('Dependency / capacity create authorization (JL-125)', () => {
  it('forbids a Member from creating a dependency (403)', async () => {
    const res = await request(createApp('Member'))
      .post('/api/roadmap-dependencies')
      .send({ fromEpicId: 1, toEpicId: 2 })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('forbids a Viewer from creating team capacity (403)', async () => {
    const res = await request(createApp('Viewer'))
      .post('/api/team-capacity')
      .send({ teamName: 'Alpha', capacityPoints: 10 })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('lets an Admin create a dependency between two epics', async () => {
    get
      .mockResolvedValueOnce({ id: 1, issue_type: 'Epic' }) // from
      .mockResolvedValueOnce({ id: 2, issue_type: 'Epic' }) // to
      .mockResolvedValueOnce({ id: 7, from_epic_id: 1, to_epic_id: 2, type: 'finish_to_start', created_at: 't' }) // reload
    run.mockResolvedValueOnce({ lastID: 7, changes: 1 })

    const res = await request(createApp('Admin'))
      .post('/api/roadmap-dependencies')
      .send({ fromEpicId: 1, toEpicId: 2 })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 7, fromEpicId: 1, toEpicId: 2, type: 'finish_to_start' })
  })

  it('rejects a self-dependency', async () => {
    const res = await request(createApp('Admin'))
      .post('/api/roadmap-dependencies')
      .send({ fromEpicId: 3, toEpicId: 3 })
    expect(res.status).toBe(400)
  })

  it('lets an Admin create team capacity', async () => {
    run.mockResolvedValueOnce({ lastID: 12, changes: 1 })
    get.mockResolvedValueOnce({ id: 12, team_name: 'Alpha', project_id: 5, capacity_points: 10, period_start: null, period_end: null, created_at: 't' })

    const res = await request(createApp('Admin'))
      .post('/api/team-capacity')
      .send({ teamName: 'Alpha', projectId: 5, capacityPoints: 10 })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ id: 12, teamName: 'Alpha', projectId: 5, capacityPoints: 10 })
  })

  it('rejects team capacity with a missing team name', async () => {
    const res = await request(createApp('Admin'))
      .post('/api/team-capacity')
      .send({ capacityPoints: 10 })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})
