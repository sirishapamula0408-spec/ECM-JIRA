// @vitest-environment node
// JL-363 — bulk import must reserve its issue-key block from the monotonic
// per-project counter (projects.issue_counter, JL-92), not from COUNT(*).
//
// The old commit path seeded a JS counter from
// `SELECT COUNT(*) FROM issues WHERE project_id = ?` and incremented it per row.
// Two defects:
//   1. Same collision-after-delete bug JL-352 fixed for cloning: a project that
//      has ever had an issue deleted has COUNT(*) < issue_counter, so imported
//      keys collide with live keys (unique index idx_issues_issue_key → 500).
//   2. Worse, it never advanced projects.issue_counter — so the *next* normal
//      create re-used the numbers the import had just handed out, and collided,
//      even on a project that never had a delete.
//
// The db mock below is keyed on SQL shape (not call order) and models real
// counter state, so the same scenarios are meaningful against both the buggy
// and the fixed implementation.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

import { makeDbMock } from './helpers/mockDb.js'

vi.mock('../db.js', () => makeDbMock())

// Keep issue-create side effects inert (the "normal create after import" case
// exercises the real issues router).
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/realtime.js', () => ({
  publish: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

const ADMIN = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }

// A project whose counter sits at 5 while only 3 issue rows survive: TP-2 and
// TP-4 were deleted. COUNT(*)-based keys (TP-4, TP-5, TP-6) would therefore
// collide with the live TP-5 (and re-use the freed TP-4).
function makeState() {
  return {
    project: { id: 5, key: 'TP', issue_counter: 5 },
    liveKeys: new Set(['TP-1', 'TP-3', 'TP-5']),
    surviving: 3,
    nextIssueId: 100,
  }
}

let state

// Emulates the two counter statements the app issues:
//   UPDATE projects SET issue_counter = issue_counter + ? ...  (bulk reservation)
//   UPDATE projects SET issue_counter = issue_counter + 1 ...  (nextIssueKey)
// Returns the value AFTER the bump, exactly like PostgreSQL's RETURNING.
function bumpCounter(sql, params) {
  const by = /\+\s*\?/.test(sql) ? Number(params[0]) : 1
  state.project.issue_counter += by
  return { issue_counter: state.project.issue_counter }
}

function installDbMock() {
  get.mockImplementation(async (sql, params = []) => {
    if (sql.includes('UPDATE projects SET issue_counter')) return bumpCounter(sql, params)
    if (sql.includes('COUNT(*)')) return { count: state.surviving }
    if (/FROM projects/.test(sql)) return { ...state.project }
    if (/FROM sprints/.test(sql)) return null
    // Row read back after an issue insert (issues router create path)
    if (/FROM issues WHERE id = \?/.test(sql)) {
      return { id: params[0], issue_key: state.lastInsertedKey, project_id: 5, status: 'Backlog' }
    }
    return undefined
  })
  all.mockResolvedValue([])
  run.mockImplementation(async (sql, params = []) => {
    if (typeof sql === 'string' && sql.startsWith('INSERT INTO issues')) {
      state.lastInsertedKey = params[0]
      state.liveKeys.add(params[0])
      state.surviving += 1
    }
    return { lastID: state.nextIssueId++, changes: 1 }
  })
}

function createApp(routers) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = ADMIN; next() })
  for (const [base, mod] of routers) app.use(base, mod.default || mod)
  app.use(errorHandler)
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  state = makeState()
  installDbMock()
  const importExportMod = await import('../routes/importExport.js')
  const issuesMod = await import('../routes/issues.js')
  app = createApp([['/api', importExportMod], ['/api/issues', issuesMod]])
})

const CSV_3 = 'title,description\nFirst,a\nSecond,b\nThird,c\n'

function counterUpdateCalls() {
  return get.mock.calls.filter(
    (c) => typeof c[0] === 'string' && c[0].includes('UPDATE projects SET issue_counter'),
  )
}

function insertedKeys() {
  return run.mock.calls
    .filter((c) => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO issues'))
    .map((c) => c[1][0])
}

describe('JL-363 — import reserves its key block from projects.issue_counter', () => {
  it('importing 3 issues at counter 5 yields TP-6/7/8 and leaves the counter at 8', async () => {
    const res = await request(app)
      .post('/api/projects/5/import')
      .send({ csv: CSV_3, dryRun: false })

    expect(res.status).toBe(201)
    expect(res.body.created).toBe(3)
    expect(res.body.keys.map((k) => k.issue_key)).toEqual(['TP-6', 'TP-7', 'TP-8'])
    // Keys that actually hit the unique column
    expect(insertedKeys()).toEqual(['TP-6', 'TP-7', 'TP-8'])
    // The counter really moved — this is the half the old code never did
    expect(state.project.issue_counter).toBe(8)
  })

  it('reserves the whole block in ONE atomic UPDATE of +N (not N single bumps)', async () => {
    await request(app).post('/api/projects/5/import').send({ csv: CSV_3, dryRun: false })

    const calls = counterUpdateCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toContain('issue_counter = issue_counter + ?')
    expect(calls[0][0]).toContain('RETURNING issue_counter')
    expect(calls[0][1]).toEqual([3, 5])
  })

  // The off-by-one guard. RETURNING gives the counter AFTER the bump, i.e. the
  // LAST number of the block. Reserving N from C returns C+N and the block is
  // [C+1 .. C+N]: first key = returned - N + 1, last key = returned.
  it('allocates exactly the N numbers ENDING at the returned counter (off-by-one)', async () => {
    await request(app).post('/api/projects/5/import').send({ csv: CSV_3, dryRun: false })

    const nums = insertedKeys().map((k) => Number(k.split('-')[1]))
    const end = state.project.issue_counter // value RETURNING produced
    expect(nums).toHaveLength(3)
    expect(nums[0]).toBe(end - 3 + 1) // 6 — not 5 (reuse) and not 7 (skip)
    expect(nums[nums.length - 1]).toBe(end) // 8 — the block ends exactly at the counter
    expect(nums).toEqual([...nums].sort((a, b) => a - b)) // contiguous, ascending
    expect(new Set(nums).size).toBe(nums.length)
  })

  it('single-row import at counter 5 yields TP-6 (not TP-5, not TP-7)', async () => {
    const res = await request(app)
      .post('/api/projects/5/import')
      .send({ csv: 'title\nOnly\n', dryRun: false })

    expect(res.status).toBe(201)
    expect(insertedKeys()).toEqual(['TP-6'])
    expect(state.project.issue_counter).toBe(6)
  })

  it('does not reuse key numbers freed by deletions (COUNT(*) < issue_counter)', async () => {
    // TP-2 / TP-4 were deleted: COUNT(*) is 3, so the old code would have
    // produced TP-4, TP-5, TP-6 — TP-5 is live and TP-4 is a resurrected key.
    const before = new Set(state.liveKeys)
    const res = await request(app)
      .post('/api/projects/5/import')
      .send({ csv: CSV_3, dryRun: false })

    expect(res.status).toBe(201)
    const keys = insertedKeys()
    for (const key of keys) expect(before.has(key)).toBe(false)
    expect(keys).not.toContain('TP-4')
    expect(keys).not.toContain('TP-5')
  })

  it('a normal create after an import gets TP-9 — no collision with imported keys', async () => {
    const imported = await request(app)
      .post('/api/projects/5/import')
      .send({ csv: CSV_3, dryRun: false })
    expect(imported.status).toBe(201)

    const created = await request(app).post('/api/issues').send({
      title: 'Created the normal way',
      description: 'after the import',
      assignee: 'admin@test.com',
      priority: 'Medium',
      projectId: 5,
      status: 'Backlog',
      issueType: 'Task',
    })

    expect(created.status).toBe(201)
    const keys = insertedKeys()
    const newKey = keys[keys.length - 1]
    expect(newKey).toBe('TP-9')
    expect(keys.slice(0, -1)).not.toContain(newKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('dry-run (the default) never touches the counter and inserts nothing', async () => {
    const res = await request(app).post('/api/projects/5/import').send({ csv: CSV_3 })

    expect(res.status).toBe(200)
    expect(res.body.dryRun).toBe(true)
    expect(res.body.valid).toBe(3)
    expect(counterUpdateCalls()).toHaveLength(0)
    expect(state.project.issue_counter).toBe(5)
    expect(insertedKeys()).toHaveLength(0)
  })

  it('an explicit dryRun:true preview also leaves the counter untouched', async () => {
    await request(app).post('/api/projects/5/import').send({ csv: CSV_3, dryRun: true })

    expect(counterUpdateCalls()).toHaveLength(0)
    expect(state.project.issue_counter).toBe(5)
  })

  it('reserves nothing when every row is invalid', async () => {
    const res = await request(app)
      .post('/api/projects/5/import')
      .send({ csv: 'title,priority\n,Nope\n', dryRun: false })

    expect(res.status).toBe(201)
    expect(res.body.created).toBe(0)
    expect(counterUpdateCalls()).toHaveLength(0)
    expect(state.project.issue_counter).toBe(5)
  })
})
