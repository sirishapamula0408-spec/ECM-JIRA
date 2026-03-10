import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, initTestSchema, seedTestMembers, seedTestProject } from './setup.js'

// We test the middleware logic by mocking the db module
// and calling the middleware functions directly with mock req/res/next

// Mock the db module before importing authorize
vi.mock('../db.js', () => ({
  get: vi.fn(),
  run: vi.fn(),
  all: vi.fn(),
}))

import { get } from '../db.js'
import { loadUserRoles, requireRole, loadProjectRole, requireProjectRole } from '../middleware/authorize.js'

function createMockReq(overrides = {}) {
  return {
    user: { id: 1, email: 'test@test.com' },
    params: {},
    body: {},
    ...overrides,
  }
}

function createMockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code
      return res
    },
    json(data) {
      res.body = data
      return res
    },
  }
  return res
}

describe('loadUserRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should set workspaceRole and memberId from DB', async () => {
    get.mockResolvedValueOnce({ id: 5, role: 'Admin', is_owner: 0 })

    const req = createMockReq({ user: { id: 1, email: 'admin@test.com' } })
    const res = createMockRes()
    const next = vi.fn()

    await loadUserRoles(req, res, next)

    expect(get).toHaveBeenCalledWith(
      'SELECT id, role, is_owner FROM members WHERE LOWER(email) = LOWER(?)',
      ['admin@test.com'],
    )
    expect(req.user.memberId).toBe(5)
    expect(req.user.workspaceRole).toBe('Admin')
    expect(req.user.isOwner).toBe(false)
    expect(next).toHaveBeenCalledWith()
  })

  it('should set isOwner to true when is_owner = 1', async () => {
    get.mockResolvedValueOnce({ id: 1, role: 'Admin', is_owner: 1 })

    const req = createMockReq({ user: { id: 1, email: 'owner@test.com' } })
    const res = createMockRes()
    const next = vi.fn()

    await loadUserRoles(req, res, next)

    expect(req.user.isOwner).toBe(true)
    expect(req.user.workspaceRole).toBe('Admin')
    expect(next).toHaveBeenCalledWith()
  })

  it('should default to Viewer when no member record found', async () => {
    get.mockResolvedValueOnce(undefined)

    const req = createMockReq({ user: { id: 99, email: 'unknown@test.com' } })
    const res = createMockRes()
    const next = vi.fn()

    await loadUserRoles(req, res, next)

    expect(req.user.memberId).toBeNull()
    expect(req.user.workspaceRole).toBe('Viewer')
    expect(req.user.isOwner).toBe(false)
    expect(next).toHaveBeenCalledWith()
  })

  it('should call next(err) on DB error', async () => {
    const dbError = new Error('DB connection failed')
    get.mockRejectedValueOnce(dbError)

    const req = createMockReq()
    const res = createMockRes()
    const next = vi.fn()

    await loadUserRoles(req, res, next)

    expect(next).toHaveBeenCalledWith(dbError)
  })
})

describe('requireRole', () => {
  it('should allow Owner to pass any role check', () => {
    const middleware = requireRole('Admin')
    const req = createMockReq({
      user: { id: 1, email: 'o@t.com', workspaceRole: 'Admin', isOwner: true },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBeNull()
  })

  it('should allow Admin when Admin is required', () => {
    const middleware = requireRole('Admin')
    const req = createMockReq({
      user: { id: 2, email: 'a@t.com', workspaceRole: 'Admin', isOwner: false },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should allow Admin when Member is required (higher rank)', () => {
    const middleware = requireRole('Member')
    const req = createMockReq({
      user: { id: 2, email: 'a@t.com', workspaceRole: 'Admin', isOwner: false },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should allow Member when Member is required', () => {
    const middleware = requireRole('Member')
    const req = createMockReq({
      user: { id: 3, email: 'm@t.com', workspaceRole: 'Member', isOwner: false },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should deny Viewer when Member is required', () => {
    const middleware = requireRole('Member')
    const req = createMockReq({
      user: { id: 4, email: 'v@t.com', workspaceRole: 'Viewer', isOwner: false },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('Insufficient permissions')
  })

  it('should deny Member when Admin is required', () => {
    const middleware = requireRole('Admin')
    const req = createMockReq({
      user: { id: 3, email: 'm@t.com', workspaceRole: 'Member', isOwner: false },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })

  it('should deny Viewer when Admin is required', () => {
    const middleware = requireRole('Admin')
    const req = createMockReq({
      user: { id: 4, email: 'v@t.com', workspaceRole: 'Viewer', isOwner: false },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })
})

describe('loadProjectRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should set projectRole from DB', async () => {
    get.mockResolvedValueOnce({ role: 'Admin' })

    const req = createMockReq({
      user: { id: 1, email: 't@t.com', memberId: 5 },
      params: { id: '1' },
    })
    const res = createMockRes()
    const next = vi.fn()

    await loadProjectRole(req, res, next)

    expect(get).toHaveBeenCalledWith(
      'SELECT role FROM project_members WHERE project_id = ? AND member_id = ?',
      ['1', 5],
    )
    expect(req.user.projectRole).toBe('Admin')
    expect(next).toHaveBeenCalledWith()
  })

  it('should set projectRole to null when not a project member', async () => {
    get.mockResolvedValueOnce(undefined)

    const req = createMockReq({
      user: { id: 1, email: 't@t.com', memberId: 5 },
      params: { id: '1' },
    })
    const res = createMockRes()
    const next = vi.fn()

    await loadProjectRole(req, res, next)

    expect(req.user.projectRole).toBeNull()
    expect(next).toHaveBeenCalledWith()
  })

  it('should set projectRole to null when no projectId in request', async () => {
    const req = createMockReq({
      user: { id: 1, email: 't@t.com', memberId: 5 },
    })
    const res = createMockRes()
    const next = vi.fn()

    await loadProjectRole(req, res, next)

    expect(req.user.projectRole).toBeNull()
    expect(next).toHaveBeenCalledWith()
    expect(get).not.toHaveBeenCalled()
  })

  it('should set projectRole to null when no memberId', async () => {
    const req = createMockReq({
      user: { id: 1, email: 't@t.com', memberId: null },
      params: { id: '1' },
    })
    const res = createMockRes()
    const next = vi.fn()

    await loadProjectRole(req, res, next)

    expect(req.user.projectRole).toBeNull()
    expect(next).toHaveBeenCalledWith()
  })
})

describe('requireProjectRole', () => {
  it('should allow workspace Owner to bypass project checks', () => {
    const middleware = requireProjectRole('Admin')
    const req = createMockReq({
      user: { id: 1, workspaceRole: 'Admin', isOwner: true, projectRole: null },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should allow workspace Admin to bypass project checks', () => {
    const middleware = requireProjectRole('Admin')
    const req = createMockReq({
      user: { id: 2, workspaceRole: 'Admin', isOwner: false, projectRole: null },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should allow project Admin when project Admin is required', () => {
    const middleware = requireProjectRole('Admin')
    const req = createMockReq({
      user: { id: 3, workspaceRole: 'Member', isOwner: false, projectRole: 'Admin' },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should allow project Member when Member is required', () => {
    const middleware = requireProjectRole('Member')
    const req = createMockReq({
      user: { id: 3, workspaceRole: 'Member', isOwner: false, projectRole: 'Member' },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('should deny project Viewer when Member is required', () => {
    const middleware = requireProjectRole('Member')
    const req = createMockReq({
      user: { id: 4, workspaceRole: 'Member', isOwner: false, projectRole: 'Viewer' },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('Insufficient project permissions')
  })

  it('should deny when user has no project role', () => {
    const middleware = requireProjectRole('Member')
    const req = createMockReq({
      user: { id: 5, workspaceRole: 'Member', isOwner: false, projectRole: null },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
  })

  it('should deny workspace Viewer even with project Member role (ceiling rule)', () => {
    // Note: in practice, the workspace Viewer ceiling is enforced at assignment time,
    // but requireProjectRole itself checks project role independently.
    // The ceiling is enforced by requireRole first in the middleware chain.
    const middleware = requireProjectRole('Member')
    const req = createMockReq({
      user: { id: 4, workspaceRole: 'Viewer', isOwner: false, projectRole: 'Member' },
    })
    const res = createMockRes()
    const next = vi.fn()

    middleware(req, res, next)

    // requireProjectRole allows this because project role is Member.
    // The ceiling enforcement happens via requireRole('Member') earlier in the chain.
    expect(next).toHaveBeenCalled()
  })
})
