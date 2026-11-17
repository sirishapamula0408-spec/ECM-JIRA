// @vitest-environment node
// Import with `preserveKeys: true` keeps the Atlassian Jira issue key (ECM-1042
// stays ECM-1042) instead of minting a new one from projects.issue_counter.
//
// The db mock is keyed on SQL shape and models real state (live keys and the
// counter), so the "normal create after import" case exercises the real issues
// router against the counter the import left behind.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

import { makeDbMock } from './helpers/mockDb.js'

vi.mock('../db.js', () => makeDbMock())
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/realtime.js', () => ({
  publish: vi.fn(),
}))

import { run, all, get, withTransaction } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

const ADMIN = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }

let state

function installDbMock() {
  get.mockImplementation(async (sql, params = []) => {
    if (sql.includes('GREATEST(issue_counter')) {
      state.project.issue_counter = Math.max(state.project.issue_counter, Number(params[0]))
      return { issue_counter: state.project.issue_counter }
    }
    if (sql.includes('UPDATE projects SET issue_counter')) {
      state.project.issue_counter += /\+\s*\?/.test(sql) ? Number(params[0]) : 1
      return { issue_counter: state.project.issue_counter }
    }
    if (/FROM projects/.test(sql)) return { ...state.project }
    if (/FROM sprints/.test(sql)) return null
    if (/FROM issues WHERE id = \?/.test(sql)) {
      return { id: params[0], issue_key: state.lastInsertedKey, project_id: 5, status: 'Backlog' }
    }
    return undefined
  })
  all.mockImplementation(async (sql, params = []) => {
    if (sql.includes('issue_key = ANY(?)')) {
      return params[0].filter((k) => state.liveKeys.has(k)).map((issue_key) => ({ issue_key }))
    }
    return []
  })
  run.mockImplementation(async (sql, params = []) => {
    if (typeof sql === 'string' && sql.startsWith('INSERT INTO issues')) {
      state.lastInsertedKey = params[0]
      state.liveKeys.add(params[0])
    }
    return { lastID: state.nextIssueId++, changes: 1 }
  })
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  state = {
    project: { id: 5, key: 'ECM', issue_counter: 0 },
    liveKeys: new Set(),
    nextIssueId: 100,
  }
  installDbMock()
  const importExportMod = await import('../routes/importExport.js')
  const issuesMod = await import('../routes/issues.js')
  app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = ADMIN; next() })
  app.use('/api', importExportMod.default)
  app.use('/api/issues', issuesMod.default)
  app.use(errorHandler)
})

// The shape of an Atlassian Jira Cloud CSV export (subset of its columns).
const JIRA_CSV = [
  'Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee',
  'Login fails,ECM-12,10012,Bug,In Progress,Highest,Asha',
  'Add SSO,ECM-40,10040,Story,To Do,Medium,',
  'Write docs,ECM-7,10007,Task,Done,Low,Ravi',
].join('\n')

const insertedKeys = () => run.mock.calls
  .filter((c) => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO issues'))
  .map((c) => c[1][0])

const importCsv = (csv, extra = {}) =>
  request(app).post('/api/projects/5/import').send({ csv, preserveKeys: true, dryRun: false, ...extra })

describe('import with preserveKeys — keys from Atlassian Jira are kept', () => {
  it('keeps every key and maps Jira headers (Summary, Issue key, Issue Type)', async () => {
    const res = await importCsv(JIRA_CSV)
    expect(res.status).toBe(201)
    expect(res.body.created).toBe(3)
    expect(insertedKeys()).toEqual(['ECM-12', 'ECM-40', 'ECM-7'])
    const titles = run.mock.calls.filter((c) => c[0].startsWith('INSERT INTO issues')).map((c) => c[1][1])
    expect(titles).toEqual(['Login fails', 'Add SSO', 'Write docs'])
  })

  it('raises the counter to the highest imported number, so the next create is ECM-41', async () => {
    const res = await importCsv(JIRA_CSV)
    expect(res.body.nextKey).toBe('ECM-41')
    expect(state.project.issue_counter).toBe(40)

    const created = await request(app).post('/api/issues').send({
      title: 'Made after the import', description: 'after', assignee: 'admin@test.com',
      priority: 'Medium', projectId: 5, status: 'Backlog', issueType: 'Task',
    })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(insertedKeys().at(-1)).toBe('ECM-41')
  })

  it('never lowers the counter (importing low numbers into a project already at 50)', async () => {
    state.project.issue_counter = 50
    const res = await importCsv('Summary,Issue key\nOld one,ECM-3\n')
    expect(res.status).toBe(201)
    expect(state.project.issue_counter).toBe(50)
    expect(res.body.nextKey).toBe('ECM-51')
  })

  it('commits inside one transaction that locks the project row first', async () => {
    await importCsv(JIRA_CSV)
    expect(withTransaction).toHaveBeenCalledTimes(1)
    const sqls = [...get.mock.calls, ...all.mock.calls, ...run.mock.calls]
      .map((c) => c[0])
    expect(sqls.some((s) => /FROM projects WHERE id = \? FOR UPDATE/.test(s))).toBe(true)
    // No block reservation — the minting path is not used.
    expect(sqls.some((s) => s.includes('issue_counter = issue_counter + ?'))).toBe(false)
  })

  it('canonicalises the key to the project spelling without leading zeros', async () => {
    await importCsv('Summary,Issue key\nA,ecm-007\n')
    expect(insertedKeys()).toEqual(['ECM-7'])
  })

  it('rejects a key from a different project, naming the fix', async () => {
    const res = await importCsv('Summary,Issue key\nA,OPS-4\n', { dryRun: true })
    expect(res.body.valid).toBe(0)
    expect(res.body.errors[0].errors[0]).toMatch(/belongs to project "OPS".*change this project's key to OPS/)
  })

  it('rejects malformed and missing keys', async () => {
    const res = await importCsv('Summary,Issue key\nA,not-a-key\nB,\nC,ECM-0\n', { dryRun: true })
    expect(res.body.valid).toBe(0)
    expect(res.body.errors.map((e) => e.row)).toEqual([2, 3, 4])
    expect(res.body.errors[1].errors[0]).toMatch(/missing/)
  })

  it('rejects a key repeated within the file', async () => {
    const res = await importCsv('Summary,Issue key\nA,ECM-5\nB,ECM-5\n', { dryRun: true })
    expect(res.body.valid).toBe(1)
    expect(res.body.errors).toEqual([{ row: 3, errors: ['issue key ECM-5 repeats row 2'] }])
  })

  it('reports a key that already exists in the preview, before anything is written', async () => {
    state.liveKeys.add('ECM-40')
    const res = await importCsv(JIRA_CSV, { dryRun: true })
    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(2)
    expect(res.body.errors).toEqual([{ row: 3, errors: ['issue key ECM-40 already exists'] }])
    expect(res.body.preview.map((p) => p.issue_key)).toEqual(['ECM-12', 'ECM-7'])
    expect(insertedKeys()).toEqual([])
  })

  it('returns 409 and writes nothing when a key appears between preview and commit', async () => {
    // Pass the pre-lock check, then have the key exist under the lock.
    let calls = 0
    const base = all.getMockImplementation()
    all.mockImplementation(async (sql, params) => {
      if (sql.includes('issue_key = ANY(?)') && ++calls === 2) return [{ issue_key: 'ECM-12' }]
      return base(sql, params)
    })
    const res = await importCsv(JIRA_CSV)
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/ECM-12.*Nothing was imported/)
    expect(insertedKeys()).toEqual([])
  })

  it('maps a unique-violation during the insert to 409', async () => {
    run.mockImplementationOnce(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })
    const res = await importCsv(JIRA_CSV)
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/Nothing was imported/)
  })

  it('400s when preserveKeys is set but the CSV has no key column', async () => {
    const res = await importCsv('Summary\nA\n')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Issue key/)
  })

  it('without preserveKeys a Jira CSV still imports, with freshly minted keys', async () => {
    const res = await importCsv(JIRA_CSV, { preserveKeys: false })
    expect(res.status).toBe(201)
    expect(insertedKeys()).toEqual(['ECM-1', 'ECM-2', 'ECM-3'])
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('an explicit mapping still wins over the Jira header aliases', async () => {
    const res = await importCsv('Summary,Headline,Issue key\nIgnored,Used,ECM-9\n', {
      mapping: { title: 'Headline' },
    })
    expect(res.status).toBe(201)
    const insert = run.mock.calls.find((c) => c[0].startsWith('INSERT INTO issues'))
    expect(insert[1][1]).toBe('Used')
  })
})
