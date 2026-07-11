import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import router, {
  groupIssuesForBoard,
  accessibleProjectIds,
  ISSUE_STATUSES,
} from '../routes/crossProjectBoards.js'

// Build an app whose stubbed user email is configurable per-test.
function createApp(email = 'owner@test.com') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email, memberId: 1, workspaceRole: 'Admin' }
    next()
  })
  app.use('/api/cross-project-boards', router)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   PURE HELPER: groupIssuesForBoard
   ================================================================ */
describe('groupIssuesForBoard', () => {
  const statuses = ISSUE_STATUSES
  const issues = [
    { id: 1, status: 'To Do', project_id: 10, assignee: 'a@x.com' },
    { id: 2, status: 'To Do', project_id: 20, assignee: null },
    { id: 3, status: 'In Progress', project_id: 10, assignee: 'a@x.com' },
    { id: 4, status: 'Done', project_id: 20, assignee: 'b@x.com' },
  ]

  it('buckets issues into status columns (flat)', () => {
    const { columns } = groupIssuesForBoard(issues, statuses, 'none')
    const byStatus = Object.fromEntries(columns.map((c) => [c.status, c.issues.map((i) => i.id)]))
    expect(byStatus['To Do']).toEqual([1, 2])
    expect(byStatus['In Progress']).toEqual([3])
    expect(byStatus['Done']).toEqual([4])
    expect(byStatus['Backlog']).toEqual([])
  })

  it('swimlaneBy "none" produces no swimlanes', () => {
    const { swimlanes } = groupIssuesForBoard(issues, statuses, 'none')
    expect(swimlanes).toEqual([])
  })

  it('swimlaneBy "project" groups by project_id', () => {
    const { swimlanes } = groupIssuesForBoard(issues, statuses, 'project')
    expect(swimlanes.map((s) => s.key)).toEqual([10, 20])
    const lane10 = swimlanes.find((s) => s.key === 10)
    const todo10 = lane10.columns.find((c) => c.status === 'To Do')
    const prog10 = lane10.columns.find((c) => c.status === 'In Progress')
    expect(todo10.issues.map((i) => i.id)).toEqual([1])
    expect(prog10.issues.map((i) => i.id)).toEqual([3])
    const lane20 = swimlanes.find((s) => s.key === 20)
    expect(lane20.columns.find((c) => c.status === 'Done').issues.map((i) => i.id)).toEqual([4])
  })

  it('swimlaneBy "assignee" groups by assignee, null → Unassigned', () => {
    const { swimlanes } = groupIssuesForBoard(issues, statuses, 'assignee')
    const keys = swimlanes.map((s) => s.key)
    expect(keys).toContain('a@x.com')
    expect(keys).toContain('Unassigned')
    expect(keys).toContain('b@x.com')
    const laneA = swimlanes.find((s) => s.key === 'a@x.com')
    expect(laneA.columns.find((c) => c.status === 'To Do').issues.map((i) => i.id)).toEqual([1])
    expect(laneA.columns.find((c) => c.status === 'In Progress').issues.map((i) => i.id)).toEqual([3])
    const laneU = swimlanes.find((s) => s.key === 'Unassigned')
    expect(laneU.columns.find((c) => c.status === 'To Do').issues.map((i) => i.id)).toEqual([2])
  })

  it('handles empty issues array', () => {
    const { columns, swimlanes } = groupIssuesForBoard([], statuses, 'project')
    expect(columns.every((c) => c.issues.length === 0)).toBe(true)
    expect(swimlanes).toEqual([])
  })
})

/* ================================================================
   PURE HELPER: accessibleProjectIds
   ================================================================ */
describe('accessibleProjectIds', () => {
  it('intersects requested with allowed, dropping disallowed', () => {
    expect(accessibleProjectIds([1, 2, 3], [2, 3, 4])).toEqual([2, 3])
  })
  it('drops all when none allowed', () => {
    expect(accessibleProjectIds([1, 2], [5, 6])).toEqual([])
  })
  it('preserves requested order and de-duplicates', () => {
    expect(accessibleProjectIds([3, 1, 3, 2], [1, 2, 3])).toEqual([3, 1, 2])
  })
  it('normalises string ids and ignores non-numeric', () => {
    expect(accessibleProjectIds(['1', 'x', 2], [1, 2])).toEqual([1, 2])
  })
  it('handles empty inputs', () => {
    expect(accessibleProjectIds([], [1, 2])).toEqual([])
    expect(accessibleProjectIds([1, 2], [])).toEqual([])
  })
})

/* ================================================================
   CRUD — owner scoped
   ================================================================ */
describe('Cross-project boards CRUD', () => {
  it('GET / lists only the owner\'s boards', async () => {
    all.mockResolvedValueOnce([
      { id: 1, name: 'B', owner_email: 'owner@test.com', project_ids: [1], swimlane_by: 'project', filter: {}, created_at: 'now' },
    ])
    const res = await request(createApp()).get('/api/cross-project-boards')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    // scoped by owner_email in the query
    const sql = all.mock.calls[0][0]
    expect(sql).toMatch(/owner_email = \?/)
    expect(all.mock.calls[0][1]).toEqual(['owner@test.com'])
  })

  it('POST / clamps project ids to accessible ones', async () => {
    // loadAllowedProjectIds: member lookup then allowed ids
    get.mockResolvedValueOnce({ id: 1, name: 'Owner' }) // member
    all.mockResolvedValueOnce([{ id: 10 }, { id: 20 }]) // allowed project ids
    run.mockResolvedValueOnce({ lastID: 5 })
    get.mockResolvedValueOnce({ id: 5, name: 'Board', owner_email: 'owner@test.com', project_ids: [10], swimlane_by: 'project', filter: {}, created_at: 'now' })

    const res = await request(createApp())
      .post('/api/cross-project-boards')
      .send({ name: 'Board', projectIds: [10, 99], swimlaneBy: 'project' })
    expect(res.status).toBe(201)
    // insert received clamped ids [10] (99 not allowed)
    const insertParams = run.mock.calls[0][1]
    expect(JSON.parse(insertParams[2])).toEqual([10])
  })

  it('POST / rejects missing name', async () => {
    const res = await request(createApp()).post('/api/cross-project-boards').send({ projectIds: [] })
    expect(res.status).toBe(400)
  })

  it('PATCH /:id 403 for non-owner', async () => {
    get.mockResolvedValueOnce({ id: 1, owner_email: 'someoneelse@test.com' })
    const res = await request(createApp('owner@test.com'))
      .patch('/api/cross-project-boards/1')
      .send({ name: 'x' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('DELETE /:id 403 for non-owner', async () => {
    get.mockResolvedValueOnce({ owner_email: 'someoneelse@test.com' })
    const res = await request(createApp('owner@test.com')).delete('/api/cross-project-boards/1')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('DELETE /:id succeeds for owner', async () => {
    get.mockResolvedValueOnce({ owner_email: 'owner@test.com' })
    run.mockResolvedValueOnce({ changes: 1 })
    const res = await request(createApp('owner@test.com')).delete('/api/cross-project-boards/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

/* ================================================================
   GET :id/issues — scoped to accessible projects
   ================================================================ */
describe('GET /:id/issues scopes to accessible projects', () => {
  it('drops disallowed project ids and never queries them', async () => {
    // board owned by caller, references projects 10 (allowed) and 99 (not)
    get.mockResolvedValueOnce({ id: 1, name: 'B', owner_email: 'owner@test.com', project_ids: [10, 99], swimlane_by: 'project', filter: {}, created_at: 'now' })
    get.mockResolvedValueOnce({ id: 1, name: 'Owner' }) // member lookup
    all.mockResolvedValueOnce([{ id: 10 }]) // allowed project ids (only 10)
    all.mockResolvedValueOnce([
      { id: 1, issue_key: 'A-1', status: 'To Do', project_id: 10, assignee: null, project_name: 'Alpha' },
    ]) // issues query

    const res = await request(createApp('owner@test.com')).get('/api/cross-project-boards/1/issues')
    expect(res.status).toBe(200)
    expect(res.body.board.projectIds).toEqual([10])

    // The issues query must have been called with only the accessible id [10].
    const issuesCall = all.mock.calls[1]
    expect(issuesCall[1]).toEqual([10])
    // and 99 must not appear in the param list
    expect(issuesCall[1]).not.toContain(99)
    // columns present
    expect(res.body.columns.find((c) => c.status === 'To Do').issues).toHaveLength(1)
  })

  it('returns empty issues when no accessible projects (no issues query fired)', async () => {
    get.mockResolvedValueOnce({ id: 2, name: 'B', owner_email: 'owner@test.com', project_ids: [99], swimlane_by: 'none', filter: {}, created_at: 'now' })
    get.mockResolvedValueOnce({ id: 1, name: 'Owner' })
    all.mockResolvedValueOnce([{ id: 10 }]) // allowed does not include 99

    const res = await request(createApp('owner@test.com')).get('/api/cross-project-boards/2/issues')
    expect(res.status).toBe(200)
    expect(res.body.board.projectIds).toEqual([])
    // only the allowed-ids query fired, no issues query
    expect(all).toHaveBeenCalledTimes(1)
    expect(res.body.columns.every((c) => c.issues.length === 0)).toBe(true)
  })

  it('403 for non-owner requesting issues', async () => {
    get.mockResolvedValueOnce({ id: 3, owner_email: 'other@test.com', project_ids: [10], swimlane_by: 'project', filter: {} })
    const res = await request(createApp('owner@test.com')).get('/api/cross-project-boards/3/issues')
    expect(res.status).toBe(403)
  })
})
