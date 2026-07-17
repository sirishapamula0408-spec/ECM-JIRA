import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB — follows watchers-JL36.test.js pattern)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { all } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import depRoutes, { buildDependencyGraph } from '../routes/dependencies.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
    next()
  })
  app.use('/api', depRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   JL-128: buildDependencyGraph — pure logic (no db)
   ================================================================ */
describe('JL-128 buildDependencyGraph', () => {
  const issues = [
    { id: 1, key: 'P-1', title: 'A', status: 'To Do' },
    { id: 2, key: 'P-2', title: 'B', status: 'In Progress' },
    { id: 3, key: 'P-3', title: 'C', status: 'Done' },
  ]

  it('flags isBlocked when a blocker is NOT Done (blocks edge)', () => {
    // Issue 1 blocks Issue 2  → 2 is blocked by 1 (1 is To Do, not Done)
    const links = [{ source_issue_id: 1, target_issue_id: 2, link_type: 'blocks' }]
    const { issues: out } = buildDependencyGraph(issues, links)
    const b = out.find((i) => i.id === 2)
    const a = out.find((i) => i.id === 1)
    expect(b.isBlocked).toBe(true)
    expect(b.blockedBy).toEqual(['P-1'])
    expect(a.blocking).toEqual(['P-2'])
    expect(a.isBlocked).toBe(false)
  })

  it('normalizes "is blocked by" to the same directed edge', () => {
    // Issue 2 "is blocked by" Issue 1 → blocker=1, blocked=2
    const links = [{ source_issue_id: 2, target_issue_id: 1, link_type: 'is blocked by' }]
    const { issues: out, edges } = buildDependencyGraph(issues, links)
    const b = out.find((i) => i.id === 2)
    expect(b.isBlocked).toBe(true)
    expect(b.blockedBy).toEqual(['P-1'])
    expect(edges).toEqual([{ from: 'P-1', to: 'P-2', fromId: 1, toId: 2 }])
  })

  it('does NOT flag isBlocked when the only blocker is Done', () => {
    // Issue 3 (Done) blocks Issue 2 → 2 has a blocker but it is Done
    const links = [{ source_issue_id: 3, target_issue_id: 2, link_type: 'blocks' }]
    const { issues: out } = buildDependencyGraph(issues, links)
    const b = out.find((i) => i.id === 2)
    expect(b.isBlocked).toBe(false)
    expect(b.blockedBy).toEqual(['P-3']) // still listed as a (resolved) blocker
  })

  it('flags isBlocked if ANY blocker is not Done (mixed blockers)', () => {
    const links = [
      { source_issue_id: 3, target_issue_id: 2, link_type: 'blocks' }, // Done blocker
      { source_issue_id: 1, target_issue_id: 2, link_type: 'blocks' }, // To Do blocker
    ]
    const { issues: out } = buildDependencyGraph(issues, links)
    const b = out.find((i) => i.id === 2)
    expect(b.isBlocked).toBe(true)
    expect(b.blockedBy.sort()).toEqual(['P-1', 'P-3'])
  })

  it('deduplicates a blocks + inverse is-blocked-by describing the same pair', () => {
    const links = [
      { source_issue_id: 1, target_issue_id: 2, link_type: 'blocks' },
      { source_issue_id: 2, target_issue_id: 1, link_type: 'is blocked by' },
    ]
    const { edges } = buildDependencyGraph(issues, links)
    expect(edges).toHaveLength(1)
  })

  it('detects a dependency cycle (A blocks B, B blocks A)', () => {
    const links = [
      { source_issue_id: 1, target_issue_id: 2, link_type: 'blocks' },
      { source_issue_id: 2, target_issue_id: 1, link_type: 'blocks' },
    ]
    const { cycles } = buildDependencyGraph(issues, links)
    expect(cycles).toHaveLength(1)
    expect(cycles[0].sort()).toEqual(['P-1', 'P-2'])
  })

  it('reports no cycles for an acyclic graph', () => {
    const links = [
      { source_issue_id: 1, target_issue_id: 2, link_type: 'blocks' },
      { source_issue_id: 2, target_issue_id: 3, link_type: 'blocks' },
    ]
    const { cycles } = buildDependencyGraph(issues, links)
    expect(cycles).toEqual([])
  })

  it('ignores links referencing issues outside the set and self-links', () => {
    const links = [
      { source_issue_id: 1, target_issue_id: 99, link_type: 'blocks' }, // 99 unknown
      { source_issue_id: 1, target_issue_id: 1, link_type: 'blocks' }, // self
    ]
    const { edges, issues: out } = buildDependencyGraph(issues, links)
    expect(edges).toEqual([])
    expect(out.every((i) => !i.isBlocked)).toBe(true)
  })
})

/* ================================================================
   JL-128: GET /api/projects/:id/dependencies — endpoint shape
   ================================================================ */
describe('JL-128 GET /api/projects/:id/dependencies', () => {
  it('returns issues with flags, edges, cycles, and summary', async () => {
    const app = createApp()
    // 1st all() call → issues; 2nd all() call → links
    all
      .mockResolvedValueOnce([
        { id: 1, issue_key: 'P-1', title: 'A', status: 'To Do', issue_type: 'Story' },
        { id: 2, issue_key: 'P-2', title: 'B', status: 'In Progress', issue_type: 'Task' },
      ])
      .mockResolvedValueOnce([
        { source_issue_id: 1, target_issue_id: 2, link_type: 'blocks' },
      ])

    const res = await request(app).get('/api/projects/5/dependencies')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('issues')
    expect(res.body).toHaveProperty('edges')
    expect(res.body).toHaveProperty('cycles')
    expect(res.body.summary).toMatchObject({ totalIssues: 2, blockedCount: 1, edgeCount: 1, cycleCount: 0 })

    const blocked = res.body.issues.find((i) => i.id === 2)
    expect(blocked.isBlocked).toBe(true)
    expect(blocked.blockedBy).toEqual(['P-1'])
    expect(res.body.edges).toEqual([{ from: 'P-1', to: 'P-2', fromId: 1, toId: 2 }])
  })

  it('returns empty structures for a project with no issues', async () => {
    const app = createApp()
    all.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const res = await request(app).get('/api/projects/9/dependencies')
    expect(res.status).toBe(200)
    expect(res.body.issues).toEqual([])
    expect(res.body.edges).toEqual([])
    expect(res.body.cycles).toEqual([])
    expect(res.body.summary.blockedCount).toBe(0)
  })
})
