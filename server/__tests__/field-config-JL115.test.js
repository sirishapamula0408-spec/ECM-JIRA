import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (no live DB — matches the other __tests__ suites)
import { makeDbMock } from './helpers/mockDb.js'
vi.mock('../db.js', () => makeDbMock())

// issues.js pulls the automation status-change hook from db too; stub it.
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import fieldConfigRoutes, {
  validateRequiredFields,
  isValidFieldKey,
  isEmptyValue,
} from '../routes/fieldConfig.js'

// Build an app with a stubbed auth middleware for a given workspace role.
function createApp(routeModule, role = 'Admin', mountPath = '/api') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Pure helpers
   ================================================================ */
describe('isValidFieldKey / isEmptyValue', () => {
  it('accepts built-in keys and custom:<id>, rejects junk', () => {
    expect(isValidFieldKey('priority')).toBe(true)
    expect(isValidFieldKey('custom:12')).toBe(true)
    expect(isValidFieldKey('custom:abc')).toBe(false)
    expect(isValidFieldKey('bogus')).toBe(false)
    expect(isValidFieldKey('')).toBe(false)
  })

  it('treats undefined/null/blank as empty', () => {
    expect(isEmptyValue(undefined)).toBe(true)
    expect(isEmptyValue(null)).toBe(true)
    expect(isEmptyValue('   ')).toBe(true)
    expect(isEmptyValue('x')).toBe(false)
    expect(isEmptyValue(0)).toBe(false)
  })
})

/* ================================================================
   validateRequiredFields (unit, injected loader)
   ================================================================ */
describe('validateRequiredFields', () => {
  const load = async () => [
    { field_key: 'dueDate', is_required: true, is_hidden: false },
    { field_key: 'components', is_required: true, is_hidden: false },
    { field_key: 'environment', is_required: true, is_hidden: true }, // hidden -> not enforced
    { field_key: 'priority', is_required: false, is_hidden: false },
  ]

  it('returns missing required keys when absent', async () => {
    const missing = await validateRequiredFields(5, 'Story', { components: 'API' }, load)
    expect(missing).toEqual(['dueDate'])
  })

  it('returns [] when every required field is present', async () => {
    const missing = await validateRequiredFields(
      5,
      'Story',
      { dueDate: '2026-01-01', components: 'API' },
      load,
    )
    expect(missing).toEqual([])
  })

  it('ignores hidden required fields and non-required fields', async () => {
    const missing = await validateRequiredFields(
      5,
      'Story',
      { dueDate: 'x', components: 'y' },
      load,
    )
    // environment is required-but-hidden, priority is not required
    expect(missing).not.toContain('environment')
    expect(missing).not.toContain('priority')
  })

  it('returns [] when there is no project id (no query)', async () => {
    const loader = vi.fn()
    const missing = await validateRequiredFields(null, 'Story', {}, loader)
    expect(missing).toEqual([])
    expect(loader).not.toHaveBeenCalled()
  })

  it('returns [] when the project has no config rows', async () => {
    const missing = await validateRequiredFields(5, 'Story', {}, async () => [])
    expect(missing).toEqual([])
  })
})

/* ================================================================
   Field-config route CRUD + Admin gating
   ================================================================ */
describe('GET /api/projects/:id/field-config', () => {
  it('returns the mapped config list', async () => {
    all.mockResolvedValue([
      {
        id: 1,
        project_id: 7,
        issue_type: null,
        field_key: 'dueDate',
        is_required: true,
        is_hidden: false,
        default_value: null,
      },
    ])
    const res = await request(createApp(fieldConfigRoutes)).get('/api/projects/7/field-config')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].fieldKey).toBe('dueDate')
    expect(res.body[0].isRequired).toBe(true)
  })
})

describe('PUT /api/projects/:id/field-config', () => {
  it('upserts the full list (Admin) and returns the stored rows', async () => {
    run.mockResolvedValue({ lastID: 1, changes: 1 })
    all.mockResolvedValue([
      {
        id: 1,
        project_id: 7,
        issue_type: 'Bug',
        field_key: 'components',
        is_required: true,
        is_hidden: false,
        default_value: 'API',
      },
    ])
    const res = await request(createApp(fieldConfigRoutes))
      .put('/api/projects/7/field-config')
      .send({
        fields: [
          { field_key: 'components', issue_type: 'Bug', is_required: true, default_value: 'API' },
          { field_key: 'priority', issue_type: null, is_hidden: true },
        ],
      })
    expect(res.status).toBe(200)
    // one DELETE + two INSERTs
    const deletes = run.mock.calls.filter(([sql]) => sql.startsWith('DELETE FROM field_configurations'))
    const inserts = run.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO field_configurations'))
    expect(deletes).toHaveLength(1)
    expect(inserts).toHaveLength(2)
    expect(res.body[0].fieldKey).toBe('components')
  })

  it('accepts a bare array body', async () => {
    run.mockResolvedValue({ lastID: 1, changes: 1 })
    all.mockResolvedValue([])
    const res = await request(createApp(fieldConfigRoutes))
      .put('/api/projects/7/field-config')
      .send([{ field_key: 'dueDate', is_required: true }])
    expect(res.status).toBe(200)
    expect(run.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO field_configurations'))).toBe(true)
  })

  it('rejects an invalid field_key with 400', async () => {
    const res = await request(createApp(fieldConfigRoutes))
      .put('/api/projects/7/field-config')
      .send({ fields: [{ field_key: 'not_a_real_field', is_required: true }] })
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a non-array body with 400', async () => {
    const res = await request(createApp(fieldConfigRoutes))
      .put('/api/projects/7/field-config')
      .send({ nope: true })
    expect(res.status).toBe(400)
  })

  it('blocks a non-Admin (Member) from writing config -> 403', async () => {
    const res = await request(createApp(fieldConfigRoutes, 'Member'))
      .put('/api/projects/7/field-config')
      .send({ fields: [{ field_key: 'dueDate', is_required: true }] })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ================================================================
   Enforcement in the issue create route
   ================================================================ */
describe('Issue create enforcement (JL-115)', () => {
  async function loadIssuesApp() {
    const mod = await import('../routes/issues.js')
    return createApp(mod, 'Admin', '/api/issues')
  }

  const baseBody = {
    title: 'Sample',
    description: 'Desc',
    assignee: 'Alice',
    priority: 'Medium',
    status: 'Backlog',
    issueType: 'Story',
    projectId: 7,
  }

  it('returns 400 with missing fields when a required field is absent', async () => {
    const app = await loadIssuesApp()
    // get sequence: project lookup, then COUNT(*)
    get
      .mockResolvedValueOnce({ id: 7, key: 'PROJ' }) // project
      .mockResolvedValueOnce({ count: 0 }) // COUNT(*)
    // validateRequiredFields -> all() returns a required config row
    all.mockResolvedValue([{ field_key: 'dueDate', is_required: true, is_hidden: false }])

    const res = await request(app).post('/api/issues').send(baseBody)
    expect(res.status).toBe(400)
    expect(res.body.missingFields).toContain('dueDate')
    // never inserted the issue
    expect(run.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO issues'))).toBe(false)
  })

  it('succeeds when the required field is provided', async () => {
    const app = await loadIssuesApp()
    get
      .mockResolvedValueOnce({ id: 7, key: 'PROJ' }) // project
      .mockResolvedValueOnce({ count: 0 }) // COUNT(*)
      .mockResolvedValueOnce({ id: 1, issue_key: 'PROJ-1', title: 'Sample', status: 'Backlog', issue_type: 'Story', project_id: 7 }) // re-read
    all.mockResolvedValue([{ field_key: 'dueDate', is_required: true, is_hidden: false }])
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app).post('/api/issues').send({ ...baseBody, dueDate: '2026-09-01' })
    expect(res.status).toBe(201)
    expect(run.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO issues'))).toBe(true)
  })

  it('succeeds unchanged when the project has no field config (empty)', async () => {
    const app = await loadIssuesApp()
    get
      .mockResolvedValueOnce({ id: 7, key: 'PROJ' }) // project
      .mockResolvedValueOnce({ count: 0 }) // COUNT(*)
      .mockResolvedValueOnce({ id: 1, issue_key: 'PROJ-1', title: 'Sample', status: 'Backlog', issue_type: 'Story', project_id: 7 }) // re-read
    all.mockResolvedValue([]) // no config rows
    run.mockResolvedValue({ lastID: 1, changes: 1 })

    const res = await request(app).post('/api/issues').send(baseBody)
    expect(res.status).toBe(201)
    expect(run.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO issues'))).toBe(true)
  })
})
