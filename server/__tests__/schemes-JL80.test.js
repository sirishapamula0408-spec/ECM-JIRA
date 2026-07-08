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
import schemeRoutes, {
  roleHasPermission,
  resolveEffectivePermissions,
  PERMISSION_KEYS,
} from '../routes/schemes.js'

// Build an app with a stubbed auth middleware for a given workspace role.
function createApp(role = 'Admin', isOwner = false) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: role, isOwner }
    next()
  })
  app.use('/api', schemeRoutes)
  app.use(errorHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ================================================================
   Pure helper: roleHasPermission
   ================================================================ */
describe('roleHasPermission helper', () => {
  const grants = [
    { permission_key: 'issue.create', role: 'Member' },
    { permission_key: 'issue.edit', role: 'Member' },
    { permission_key: 'issue.delete', role: 'Admin' },
    { permission_key: 'members.manage', role: 'Admin' },
  ]

  it('grants a capability to the exact role', () => {
    expect(roleHasPermission(grants, 'Member', 'issue.create')).toBe(true)
    expect(roleHasPermission(grants, 'Admin', 'issue.delete')).toBe(true)
  })

  it('lets higher roles inherit lower-role grants (hierarchy)', () => {
    // Admin outranks Member, so Admin also has member-level capabilities
    expect(roleHasPermission(grants, 'Admin', 'issue.create')).toBe(true)
  })

  it('denies lower roles a higher-role capability', () => {
    expect(roleHasPermission(grants, 'Member', 'issue.delete')).toBe(false)
    expect(roleHasPermission(grants, 'Viewer', 'issue.create')).toBe(false)
  })

  it('treats Lead as an Admin-equivalent project role', () => {
    expect(roleHasPermission(grants, 'Lead', 'issue.delete')).toBe(true)
  })

  it('returns false for unknown permission keys, roles, or bad input', () => {
    expect(roleHasPermission(grants, 'Member', 'nonexistent.key')).toBe(false)
    expect(roleHasPermission(grants, 'Ghost', 'issue.create')).toBe(false)
    expect(roleHasPermission(null, 'Member', 'issue.create')).toBe(false)
  })
})

describe('resolveEffectivePermissions', () => {
  it('builds a role → capability map across all permission keys', () => {
    const grants = [
      { permission_key: 'issue.create', role: 'Member' },
      { permission_key: 'issue.delete', role: 'Admin' },
    ]
    const map = resolveEffectivePermissions(grants)
    expect(map.Member['issue.create']).toBe(true)
    expect(map.Member['issue.delete']).toBe(false)
    expect(map.Admin['issue.delete']).toBe(true)
    expect(map.Viewer['issue.create']).toBe(false)
    // every resolvable role has every permission key present (boolean)
    expect(Object.keys(map.Member).sort()).toEqual([...PERMISSION_KEYS].sort())
  })
})

/* ================================================================
   Permission scheme CRUD + Admin gating
   ================================================================ */
describe('Permission scheme CRUD', () => {
  it('lists schemes', async () => {
    all.mockResolvedValue([{ id: 1, name: 'Default Permission Scheme', is_default: true }])
    const res = await request(createApp('Admin')).get('/api/schemes/permission')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('returns a scheme with its grants', async () => {
    get.mockResolvedValue({ id: 1, name: 'Default', is_default: true })
    all.mockResolvedValue([{ id: 10, scheme_id: 1, permission_key: 'issue.create', role: 'Member' }])
    const res = await request(createApp('Admin')).get('/api/schemes/permission/1')
    expect(res.status).toBe(200)
    expect(res.body.grants).toHaveLength(1)
  })

  it('creates a scheme (Admin)', async () => {
    run.mockResolvedValue({ lastID: 5, changes: 1 })
    get.mockResolvedValue({ id: 5, name: 'QA Scheme', is_default: false })
    const res = await request(createApp('Admin'))
      .post('/api/schemes/permission')
      .send({ name: 'QA Scheme' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(5)
  })

  it('rejects scheme creation without a name', async () => {
    const res = await request(createApp('Admin'))
      .post('/api/schemes/permission')
      .send({})
    expect(res.status).toBe(400)
  })

  it('blocks a non-Admin (Member) from creating a scheme', async () => {
    const res = await request(createApp('Member'))
      .post('/api/schemes/permission')
      .send({ name: 'Sneaky' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses to delete the default scheme', async () => {
    get.mockResolvedValue({ id: 1, is_default: true })
    const res = await request(createApp('Admin')).delete('/api/schemes/permission/1')
    expect(res.status).toBe(400)
  })

  it('deletes a non-default scheme (Admin)', async () => {
    get.mockResolvedValue({ id: 2, is_default: false })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp('Admin')).delete('/api/schemes/permission/2')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

/* ================================================================
   Grants
   ================================================================ */
describe('Permission grants', () => {
  it('adds a valid grant (Admin)', async () => {
    get
      .mockResolvedValueOnce({ id: 1 }) // scheme exists
      .mockResolvedValueOnce({ id: 20, scheme_id: 1, permission_key: 'issue.delete', role: 'Admin' })
    run.mockResolvedValue({ lastID: 20, changes: 1 })
    const res = await request(createApp('Admin'))
      .post('/api/schemes/permission/1/grants')
      .send({ permissionKey: 'issue.delete', role: 'Admin' })
    expect(res.status).toBe(201)
    expect(res.body.permission_key).toBe('issue.delete')
  })

  it('rejects an invalid permission key', async () => {
    const res = await request(createApp('Admin'))
      .post('/api/schemes/permission/1/grants')
      .send({ permissionKey: 'bogus', role: 'Admin' })
    expect(res.status).toBe(400)
  })

  it('blocks a Viewer from adding a grant', async () => {
    const res = await request(createApp('Viewer'))
      .post('/api/schemes/permission/1/grants')
      .send({ permissionKey: 'issue.create', role: 'Member' })
    expect(res.status).toBe(403)
  })

  it('deletes a grant (Admin)', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp('Admin')).delete('/api/schemes/permission/grants/20')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

/* ================================================================
   Assign scheme to a project
   ================================================================ */
describe('Assign scheme to project', () => {
  it('assigns a scheme to a project (Admin)', async () => {
    get
      .mockResolvedValueOnce({ id: 7 }) // project exists
      .mockResolvedValueOnce({ id: 3 }) // scheme exists
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp('Admin'))
      .put('/api/projects/7/permission-scheme')
      .send({ schemeId: 3 })
    expect(res.status).toBe(200)
    expect(res.body.permissionSchemeId).toBe(3)
  })

  it('clears the assignment when schemeId is null', async () => {
    get.mockResolvedValueOnce({ id: 7 }) // project exists
    run.mockResolvedValue({ changes: 1 })
    const res = await request(createApp('Admin'))
      .put('/api/projects/7/permission-scheme')
      .send({ schemeId: null })
    expect(res.status).toBe(200)
    expect(res.body.permissionSchemeId).toBe(null)
  })

  it('404s when the project does not exist', async () => {
    get.mockResolvedValueOnce(null)
    const res = await request(createApp('Admin'))
      .put('/api/projects/999/permission-scheme')
      .send({ schemeId: 3 })
    expect(res.status).toBe(404)
  })

  it('blocks a Member from assigning a scheme', async () => {
    const res = await request(createApp('Member'))
      .put('/api/projects/7/permission-scheme')
      .send({ schemeId: 3 })
    expect(res.status).toBe(403)
  })
})

/* ================================================================
   Effective permissions resolution
   ================================================================ */
describe('GET effective-permissions', () => {
  it('resolves grants from the project-assigned scheme', async () => {
    get
      .mockResolvedValueOnce({ id: 7, permission_scheme_id: 3 }) // project
      .mockResolvedValueOnce({ id: 3, name: 'Custom', is_default: false }) // scheme
    all.mockResolvedValue([
      { permission_key: 'issue.create', role: 'Member' },
      { permission_key: 'issue.delete', role: 'Admin' },
    ])
    const res = await request(createApp('Admin')).get('/api/projects/7/effective-permissions')
    expect(res.status).toBe(200)
    expect(res.body.schemeId).toBe(3)
    expect(res.body.fallback).toBe(false)
    expect(res.body.permissions.Member['issue.create']).toBe(true)
    expect(res.body.permissions.Member['issue.delete']).toBe(false)
    expect(res.body.permissions.Admin['issue.delete']).toBe(true)
  })

  it('falls back to the default scheme when the project has none', async () => {
    get
      .mockResolvedValueOnce({ id: 7, permission_scheme_id: null }) // project, unassigned
      .mockResolvedValueOnce({ id: 1, name: 'Default Permission Scheme', is_default: true }) // default
    all.mockResolvedValue([{ permission_key: 'issue.create', role: 'Member' }])
    const res = await request(createApp('Admin')).get('/api/projects/7/effective-permissions')
    expect(res.status).toBe(200)
    expect(res.body.fallback).toBe(true)
    expect(res.body.isDefault).toBe(true)
    expect(res.body.permissions.Member['issue.create']).toBe(true)
  })

  it('404s for a missing project', async () => {
    get.mockResolvedValueOnce(null)
    const res = await request(createApp('Admin')).get('/api/projects/999/effective-permissions')
    expect(res.status).toBe(404)
  })
})
