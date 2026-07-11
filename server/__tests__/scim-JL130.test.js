import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// --- Mock the db layer so no live PostgreSQL is needed ---
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import scimRoutes, { toScimUser, toScimGroup, parseScimFilter, buildListResponse } from '../routes/scim.js'

// JL-184: SCIM has no in-code default token. scimAuth reads process.env.SCIM_TOKEN
// at request time, so these suites configure a token before each test.
const TEST_SCIM_TOKEN = 'test-scim-token-abc123'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/scim/v2', scimRoutes)
  app.use(errorHandler)
  return app
}

const auth = (token = TEST_SCIM_TOKEN) => `Bearer ${token}`

const userRow = (over = {}) => ({
  id: 1,
  email: 'jane.doe@gmail.com',
  display_name: 'Jane Doe',
  active: true,
  scim_external_id: 'ext-123',
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SCIM_TOKEN = TEST_SCIM_TOKEN
})

afterEach(() => {
  delete process.env.SCIM_TOKEN
})

/* ================================================================
   1. Pure helpers — toScimUser / parseScimFilter / envelope
   ================================================================ */
describe('toScimUser', () => {
  it('maps a db row to a SCIM 2.0 User resource', () => {
    const u = toScimUser(userRow())
    expect(u.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User'])
    expect(u.id).toBe('1')
    expect(u.userName).toBe('jane.doe@gmail.com')
    expect(u.name).toEqual({ formatted: 'Jane Doe', givenName: 'Jane', familyName: 'Doe' })
    expect(u.emails).toEqual([{ value: 'jane.doe@gmail.com', primary: true, type: 'work' }])
    expect(u.active).toBe(true)
    expect(u.externalId).toBe('ext-123')
    expect(u.meta.resourceType).toBe('User')
    expect(u.meta.location).toBe('/scim/v2/Users/1')
  })

  it('treats active=false as inactive and falls back to email for the name', () => {
    const u = toScimUser({ id: 5, email: 'bob@corp.com', active: false })
    expect(u.active).toBe(false)
    expect(u.name.givenName).toBe('bob')
    expect(u.externalId).toBeUndefined()
  })

  it('returns null for a null row', () => {
    expect(toScimUser(null)).toBeNull()
  })
})

describe('toScimGroup', () => {
  it('maps a group row + members', () => {
    const g = toScimGroup({ id: 2, display_name: 'Engineers' }, [{ user_id: 1 }, { user_id: 3 }])
    expect(g.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:Group'])
    expect(g.displayName).toBe('Engineers')
    expect(g.members).toEqual([
      { value: '1', $ref: '/scim/v2/Users/1' },
      { value: '3', $ref: '/scim/v2/Users/3' },
    ])
    expect(g.meta.resourceType).toBe('Group')
  })
})

describe('parseScimFilter', () => {
  it('parses userName eq "a@b.com"', () => {
    expect(parseScimFilter('userName eq "a@b.com"')).toEqual({
      attribute: 'userName',
      operator: 'eq',
      value: 'a@b.com',
    })
  })

  it('parses active eq false into a boolean', () => {
    expect(parseScimFilter('active eq false')).toEqual({
      attribute: 'active',
      operator: 'eq',
      value: false,
    })
  })

  it('returns null for empty or unparseable input', () => {
    expect(parseScimFilter('')).toBeNull()
    expect(parseScimFilter(null)).toBeNull()
    expect(parseScimFilter('garbage')).toBeNull()
  })
})

describe('buildListResponse', () => {
  it('wraps resources in a ListResponse envelope', () => {
    const env = buildListResponse([{ id: '1' }], 1, 1, 1)
    expect(env.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse'])
    expect(env.totalResults).toBe(1)
    expect(env.startIndex).toBe(1)
    expect(env.itemsPerPage).toBe(1)
    expect(env.Resources).toHaveLength(1)
  })
})

/* ================================================================
   2. Auth middleware
   ================================================================ */
describe('SCIM bearer auth', () => {
  it('rejects requests with no Authorization header (401)', async () => {
    const res = await request(makeApp()).get('/scim/v2/Users')
    expect(res.status).toBe(401)
    expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error'])
  })

  it('rejects a wrong token (401)', async () => {
    const res = await request(makeApp()).get('/scim/v2/Users').set('Authorization', auth('nope'))
    expect(res.status).toBe(401)
  })

  it('passes with the correct token', async () => {
    get.mockResolvedValueOnce({ total: 0 })
    all.mockResolvedValueOnce([])
    const res = await request(makeApp()).get('/scim/v2/Users').set('Authorization', auth())
    expect(res.status).toBe(200)
  })

  // JL-184: config-gated. With SCIM_TOKEN unset, SCIM is disabled entirely.
  it('returns 501 for every request when SCIM_TOKEN is not configured', async () => {
    delete process.env.SCIM_TOKEN
    const res = await request(makeApp()).get('/scim/v2/Users').set('Authorization', auth())
    expect(res.status).toBe(501)
    expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error'])
    // No DB access should occur when SCIM is not configured.
    expect(get).not.toHaveBeenCalled()
    expect(all).not.toHaveBeenCalled()
  })

  it('rejects the old repo-visible default token once configured (401)', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/Users')
      .set('Authorization', auth('dev-scim-token-change-me'))
    expect(res.status).toBe(401)
  })

  // JL-184: safeEqual must reject a wrong-length token without throwing.
  it('rejects a wrong-length token (401)', async () => {
    const res = await request(makeApp())
      .get('/scim/v2/Users')
      .set('Authorization', auth('short'))
    expect(res.status).toBe(401)
  })
})

/* ================================================================
   3. Users endpoints
   ================================================================ */
describe('GET /scim/v2/Users (list)', () => {
  it('returns a ListResponse envelope with pagination', async () => {
    get.mockResolvedValueOnce({ total: 2 })
    all.mockResolvedValueOnce([userRow(), userRow({ id: 2, email: 'x@y.com', display_name: 'X Y' })])

    const res = await request(makeApp())
      .get('/scim/v2/Users?startIndex=1&count=10')
      .set('Authorization', auth())

    expect(res.status).toBe(200)
    expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse'])
    expect(res.body.totalResults).toBe(2)
    expect(res.body.startIndex).toBe(1)
    expect(res.body.itemsPerPage).toBe(2)
    expect(res.body.Resources).toHaveLength(2)
    expect(res.body.Resources[0].userName).toBe('jane.doe@gmail.com')
  })

  it('applies a userName eq filter', async () => {
    get.mockResolvedValueOnce({ total: 1 })
    all.mockResolvedValueOnce([userRow()])

    const res = await request(makeApp())
      .get('/scim/v2/Users?filter=' + encodeURIComponent('userName eq "jane.doe@gmail.com"'))
      .set('Authorization', auth())

    expect(res.status).toBe(200)
    expect(res.body.totalResults).toBe(1)
    // The count query WHERE clause targets email.
    expect(get.mock.calls[0][0]).toMatch(/WHERE LOWER\(email\) = LOWER/i)
    expect(get.mock.calls[0][1]).toEqual(['jane.doe@gmail.com'])
  })
})

describe('GET /scim/v2/Users/:id', () => {
  it('returns a single SCIM user', async () => {
    get.mockResolvedValueOnce(userRow())
    const res = await request(makeApp()).get('/scim/v2/Users/1').set('Authorization', auth())
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('1')
    expect(res.body.userName).toBe('jane.doe@gmail.com')
  })

  it('404s for an unknown id', async () => {
    get.mockResolvedValueOnce(null)
    const res = await request(makeApp()).get('/scim/v2/Users/999').set('Authorization', auth())
    expect(res.status).toBe(404)
    expect(res.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error'])
  })
})

describe('POST /scim/v2/Users', () => {
  it('creates a user (run called) and returns the SCIM user', async () => {
    // 1) existing-by-email check -> null; 2) fetch created row
    get.mockResolvedValueOnce(null).mockResolvedValueOnce(userRow({ id: 42 }))
    run.mockResolvedValue({ lastID: 42, changes: 1 })

    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set('Authorization', auth())
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'jane.doe@gmail.com',
        name: { givenName: 'Jane', familyName: 'Doe' },
        active: true,
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe('42')
    expect(res.body.userName).toBe('jane.doe@gmail.com')
    // A user INSERT ran.
    const insertCall = run.mock.calls.find((c) => /INSERT INTO users/i.test(c[0]))
    expect(insertCall).toBeTruthy()
    expect(insertCall[1][0]).toBe('jane.doe@gmail.com')
  })

  it('409s when the userName already exists', async () => {
    get.mockResolvedValueOnce({ id: 1 })
    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set('Authorization', auth())
      .send({ userName: 'jane.doe@gmail.com' })
    expect(res.status).toBe(409)
    expect(res.body.scimType).toBe('uniqueness')
  })

  it('400s when userName is missing', async () => {
    const res = await request(makeApp())
      .post('/scim/v2/Users')
      .set('Authorization', auth())
      .send({ name: { givenName: 'No' } })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /scim/v2/Users/:id (active=false)', () => {
  it('deactivates the user', async () => {
    // existing check, member email lookup, final fetch
    get
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ email: 'jane.doe@gmail.com' })
      .mockResolvedValueOnce(userRow({ active: false }))
    run.mockResolvedValue({ lastID: null, changes: 1 })

    const res = await request(makeApp())
      .patch('/scim/v2/Users/1')
      .set('Authorization', auth())
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      })

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(false)
    const updateCall = run.mock.calls.find((c) => /UPDATE users SET/i.test(c[0]) && /active/i.test(c[0]))
    expect(updateCall).toBeTruthy()
    expect(updateCall[1]).toContain(false)
  })

  it('handles Azure-style pathless value objects', async () => {
    get
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ email: 'jane.doe@gmail.com' })
      .mockResolvedValueOnce(userRow({ active: false }))
    run.mockResolvedValue({ lastID: null, changes: 1 })

    const res = await request(makeApp())
      .patch('/scim/v2/Users/1')
      .set('Authorization', auth())
      .send({ Operations: [{ op: 'replace', value: { active: false } }] })

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(false)
  })
})

describe('DELETE /scim/v2/Users/:id', () => {
  it('deprovisions (deactivates) and returns 204', async () => {
    get.mockResolvedValueOnce({ id: 1, email: 'jane.doe@gmail.com' })
    run.mockResolvedValue({ lastID: null, changes: 1 })
    const res = await request(makeApp()).delete('/scim/v2/Users/1').set('Authorization', auth())
    expect(res.status).toBe(204)
    const call = run.mock.calls.find((c) => /UPDATE users SET active = FALSE/i.test(c[0]))
    expect(call).toBeTruthy()
  })
})

/* ================================================================
   4. Groups endpoints (smoke)
   ================================================================ */
describe('Groups', () => {
  it('lists groups in a ListResponse envelope', async () => {
    get.mockResolvedValueOnce({ total: 1 })
    all
      .mockResolvedValueOnce([{ id: 1, display_name: 'Engineers' }]) // groups
      .mockResolvedValueOnce([{ user_id: 1 }]) // members for group 1
    const res = await request(makeApp()).get('/scim/v2/Groups').set('Authorization', auth())
    expect(res.status).toBe(200)
    expect(res.body.Resources[0].displayName).toBe('Engineers')
    expect(res.body.Resources[0].members).toEqual([{ value: '1', $ref: '/scim/v2/Users/1' }])
  })

  it('creates a group', async () => {
    get.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 7, display_name: 'QA' })
    all.mockResolvedValueOnce([])
    run.mockResolvedValue({ lastID: 7, changes: 1 })
    const res = await request(makeApp())
      .post('/scim/v2/Groups')
      .set('Authorization', auth())
      .send({ displayName: 'QA', members: [] })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('7')
    expect(res.body.displayName).toBe('QA')
  })
})
