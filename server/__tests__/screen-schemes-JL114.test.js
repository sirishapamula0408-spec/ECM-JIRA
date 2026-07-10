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
import screenSchemeRoutes, {
  BUILTIN_FIELD_KEYS,
  SCREEN_ISSUE_TYPES,
  normalizeFieldEntry,
} from '../routes/screenSchemes.js'

// Build an app with a stubbed auth middleware for a given workspace role.
function createApp(role = 'Admin', isOwner = false) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api', screenSchemeRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Pure helper: normalizeFieldEntry
   ================================================================ */
describe('normalizeFieldEntry helper', () => {
  it('accepts a builtin field key and defaults booleans to true', () => {
    const entry = normalizeFieldEntry({ fieldKey: 'priority' }, new Set())
    expect(entry).toEqual({ fieldKey: 'priority', showOnCreate: true, showOnEdit: true })
  })

  it('honors explicit show flags', () => {
    const entry = normalizeFieldEntry({ fieldKey: 'assignee', showOnCreate: false, showOnEdit: true }, new Set())
    expect(entry.showOnCreate).toBe(false)
    expect(entry.showOnEdit).toBe(true)
  })

  it('accepts a known custom field key', () => {
    const entry = normalizeFieldEntry({ fieldKey: 'custom:7' }, new Set(['custom:7']))
    expect(entry.fieldKey).toBe('custom:7')
  })

  it('rejects an empty field key', () => {
    expect(() => normalizeFieldEntry({}, new Set())).toThrowError(/fieldKey/)
  })

  it('rejects an unknown builtin key', () => {
    expect(() => normalizeFieldEntry({ fieldKey: 'nonsense' }, new Set())).toThrowError(/Unknown field key/)
  })

  it('rejects a custom key not in the project', () => {
    expect(() => normalizeFieldEntry({ fieldKey: 'custom:99' }, new Set(['custom:1']))).toThrowError(/Custom field not found/)
  })
})

/* ================================================================
   PUT /api/projects/:id/screen-schemes/:issueType — replace
   ================================================================ */
describe('PUT screen-schemes/:issueType (replace ordered field list)', () => {
  it('creates the scheme and inserts fields in order (delete + insert)', async () => {
    // custom_fields lookup (allowed custom keys)
    all.mockImplementation((sql) => {
      if (sql.includes('FROM custom_fields')) return Promise.resolve([{ id: 5 }])
      if (sql.includes('FROM screen_scheme_fields')) {
        return Promise.resolve([
          { id: 1, scheme_id: 10, field_key: 'summary', position: 0, show_on_create: true, show_on_edit: true },
          { id: 2, scheme_id: 10, field_key: 'priority', position: 1, show_on_create: true, show_on_edit: false },
          { id: 3, scheme_id: 10, field_key: 'custom:5', position: 2, show_on_create: false, show_on_edit: true },
        ])
      }
      return Promise.resolve([])
    })
    // no existing scheme
    get.mockResolvedValue(null)
    // INSERT screen_schemes returns id 10; other runs succeed
    run.mockImplementation((sql) => {
      if (/INSERT INTO screen_schemes/.test(sql)) return Promise.resolve({ lastID: 10, changes: 1 })
      return Promise.resolve({ lastID: null, changes: 1 })
    })

    const res = await request(createApp('Admin'))
      .put('/api/projects/3/screen-schemes/Story')
      .send({ fields: [
        { fieldKey: 'summary' },
        { fieldKey: 'priority', showOnEdit: false },
        { fieldKey: 'custom:5', showOnCreate: false },
      ] })

    expect(res.status).toBe(200)
    expect(res.body.issueType).toBe('Story')
    expect(res.body.fields.map((f) => f.fieldKey)).toEqual(['summary', 'priority', 'custom:5'])

    // A DELETE preceded the ordered INSERTs.
    const runSqls = run.mock.calls.map((c) => c[0])
    const deleteIdx = runSqls.findIndex((s) => /DELETE FROM screen_scheme_fields/.test(s))
    const fieldInserts = run.mock.calls.filter((c) => /INSERT INTO screen_scheme_fields/.test(c[0]))
    expect(deleteIdx).toBeGreaterThanOrEqual(0)
    expect(fieldInserts).toHaveLength(3)
    // Positions are 0,1,2 in payload order.
    expect(fieldInserts.map((c) => c[1][2])).toEqual([0, 1, 2])
    expect(fieldInserts.map((c) => c[1][1])).toEqual(['summary', 'priority', 'custom:5'])
  })

  it('rejects an invalid issue type (400)', async () => {
    const res = await request(createApp('Admin'))
      .put('/api/projects/3/screen-schemes/Nonsense')
      .send({ fields: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/issueType/)
  })

  it('rejects a non-array fields payload (400)', async () => {
    const res = await request(createApp('Admin'))
      .put('/api/projects/3/screen-schemes/Story')
      .send({ fields: 'nope' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/fields must be an array/)
  })

  it('rejects an unknown field key (400)', async () => {
    all.mockResolvedValue([]) // no custom fields
    const res = await request(createApp('Admin'))
      .put('/api/projects/3/screen-schemes/Story')
      .send({ fields: [{ fieldKey: 'bogus' }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Unknown field key/)
  })

  it('rejects duplicate field keys (400)', async () => {
    all.mockResolvedValue([])
    const res = await request(createApp('Admin'))
      .put('/api/projects/3/screen-schemes/Story')
      .send({ fields: [{ fieldKey: 'summary' }, { fieldKey: 'summary' }] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Duplicate/)
  })

  it('rejects a non-admin (403)', async () => {
    const res = await request(createApp('Member'))
      .put('/api/projects/3/screen-schemes/Story')
      .send({ fields: [] })
    expect(res.status).toBe(403)
  })
})

/* ================================================================
   GET resolved
   ================================================================ */
describe('GET screen-schemes/:issueType/resolved', () => {
  it('returns configured fields in position order', async () => {
    get.mockResolvedValue({ id: 10 }) // scheme exists
    all.mockImplementation((sql) => {
      if (sql.includes('FROM screen_scheme_fields')) {
        return Promise.resolve([
          { field_key: 'summary', position: 0, show_on_create: true, show_on_edit: true },
          { field_key: 'priority', position: 1, show_on_create: false, show_on_edit: true },
        ])
      }
      return Promise.resolve([])
    })

    const res = await request(createApp('Member'))
      .get('/api/projects/3/screen-schemes/Story/resolved')

    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(true)
    expect(res.body.fields.map((f) => f.fieldKey)).toEqual(['summary', 'priority'])
    expect(res.body.fields[1].showOnCreate).toBe(false)
  })

  it('falls back to the all-fields default when no scheme is configured', async () => {
    get.mockResolvedValue(null) // no scheme
    all.mockImplementation((sql) => {
      if (sql.includes('FROM custom_fields')) return Promise.resolve([{ id: 8 }])
      return Promise.resolve([])
    })

    const res = await request(createApp('Member'))
      .get('/api/projects/3/screen-schemes/Bug/resolved')

    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(false)
    // all builtin fields + the one custom field
    expect(res.body.fields).toHaveLength(BUILTIN_FIELD_KEYS.length + 1)
    expect(res.body.fields.map((f) => f.fieldKey)).toContain('custom:8')
    expect(res.body.fields[0].fieldKey).toBe(BUILTIN_FIELD_KEYS[0])
  })

  it('rejects an invalid issue type (400)', async () => {
    const res = await request(createApp('Member'))
      .get('/api/projects/3/screen-schemes/Nope/resolved')
    expect(res.status).toBe(400)
  })
})

/* ================================================================
   GET list (grouped by issue type)
   ================================================================ */
describe('GET screen-schemes (list)', () => {
  it('groups schemes with their fields by issue type (Admin only)', async () => {
    all.mockImplementation((sql) => {
      if (sql.includes('FROM screen_schemes')) {
        return Promise.resolve([{ id: 10, project_id: 3, issue_type: 'Story', created_at: 'now' }])
      }
      if (sql.includes('FROM screen_scheme_fields')) {
        return Promise.resolve([{ id: 1, scheme_id: 10, field_key: 'summary', position: 0, show_on_create: true, show_on_edit: true }])
      }
      return Promise.resolve([])
    })

    const res = await request(createApp('Admin')).get('/api/projects/3/screen-schemes')
    expect(res.status).toBe(200)
    expect(res.body.schemes.Story.fields).toHaveLength(1)
    expect(res.body.schemes.Story.issueType).toBe('Story')
  })

  it('rejects a non-admin (403)', async () => {
    const res = await request(createApp('Viewer')).get('/api/projects/3/screen-schemes')
    expect(res.status).toBe(403)
  })
})

describe('exported constants', () => {
  it('SCREEN_ISSUE_TYPES matches the app issue types', () => {
    expect(SCREEN_ISSUE_TYPES).toEqual(['Epic', 'Story', 'Bug', 'Task', 'Sub-task'])
  })
})
