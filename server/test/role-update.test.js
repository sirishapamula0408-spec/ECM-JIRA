import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db module
const mockGet = vi.fn()
const mockRun = vi.fn()
const mockAll = vi.fn()
vi.mock('../db.js', () => ({ get: (...a) => mockGet(...a), run: (...a) => mockRun(...a), all: (...a) => mockAll(...a) }))
vi.mock('../utils/mailer.js', () => ({ sendMail: vi.fn(), buildInviteEmail: vi.fn(() => ({ subject: '', html: '', text: '' })) }))

const { default: membersRouter } = await import('../routes/members.js')
const { default: projectsRouter } = await import('../routes/projects.js')

function mockRes() {
  const res = { statusCode: 200, body: null }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (data) => { res.body = data; return res }
  return res
}

// Run all handlers in a route layer sequentially (middleware + handler)
async function runRoute(router, method, path, req, res) {
  const layer = router.stack.find((l) => l.route && l.route.methods[method] && l.route.path === path)
  if (!layer) throw new Error(`Route ${method} ${path} not found`)
  for (const s of layer.route.stack) {
    let nextCalled = false
    await new Promise((resolve, reject) => {
      const next = (err) => { nextCalled = true; if (err) reject(err); else resolve() }
      const result = s.handle(req, res, next)
      if (result && typeof result.then === 'function') {
        result.then(() => { if (!nextCalled) resolve() }).catch(reject)
      } else if (!nextCalled) {
        // Sync handler that didn't call next — could be asyncHandler which fire-and-forgets
        // Wait a tick to let any dangling promises settle
        Promise.resolve().then(() => Promise.resolve()).then(resolve)
      }
    })
    // Let any remaining microtasks flush (for asyncHandler pattern)
    await new Promise((r) => setTimeout(r, 10))
    // If response was sent (json called), stop
    if (res.body !== null) break
  }
}

describe('PUT /api/members/:id/role', () => {
  beforeEach(() => vi.clearAllMocks())

  function makeReq(params, body) {
    return {
      params, body,
      user: { email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false },
    }
  }

  it('rejects invalid role', async () => {
    const res = mockRes()
    await runRoute(membersRouter, 'put', '/:id/role', makeReq({ id: '2' }, { role: 'SuperAdmin' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/role must be one of/)
  })

  it('returns 404 for non-existent member', async () => {
    mockGet.mockResolvedValueOnce(null)
    const res = mockRes()
    await runRoute(membersRouter, 'put', '/:id/role', makeReq({ id: '999' }, { role: 'Admin' }), res)
    expect(res.statusCode).toBe(404)
  })

  it('rejects changing Owner role', async () => {
    mockGet.mockResolvedValueOnce({ id: 1, role: 'Admin', is_owner: 1 })
    const res = mockRes()
    await runRoute(membersRouter, 'put', '/:id/role', makeReq({ id: '1' }, { role: 'Viewer' }), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toMatch(/Owner/)
  })

  it('prevents demoting last Admin', async () => {
    mockGet.mockResolvedValueOnce({ id: 2, role: 'Admin', is_owner: 0 })
    mockGet.mockResolvedValueOnce({ cnt: 1 })
    const res = mockRes()
    await runRoute(membersRouter, 'put', '/:id/role', makeReq({ id: '2' }, { role: 'Member' }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toMatch(/last Admin/)
  })

  it('successfully updates role', async () => {
    const updated = { id: 2, name: 'Jane', email: 'jane@test.com', role: 'Admin', status: 'Active', task_count: 0, invited_by: null }
    mockGet.mockResolvedValueOnce({ id: 2, role: 'Member', is_owner: 0 })
    mockRun.mockResolvedValueOnce({})
    mockGet.mockResolvedValueOnce(updated)
    const res = mockRes()
    await runRoute(membersRouter, 'put', '/:id/role', makeReq({ id: '2' }, { role: 'Admin' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.role).toBe('Admin')
  })

  it('non-Admin gets 403', async () => {
    const req = {
      params: { id: '2' }, body: { role: 'Admin' },
      user: { email: 'viewer@test.com', memberId: 3, workspaceRole: 'Viewer', isOwner: false },
    }
    const res = mockRes()
    await runRoute(membersRouter, 'put', '/:id/role', req, res)
    expect(res.statusCode).toBe(403)
  })
})

describe('PUT /api/projects/:id/members/:memberId/role', () => {
  beforeEach(() => vi.clearAllMocks())

  function makeReq(params, body) {
    return {
      params, body,
      user: { email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false, projectRole: null },
    }
  }

  it('rejects invalid role', async () => {
    const res = mockRes()
    await runRoute(projectsRouter, 'put', '/:id/members/:memberId/role', makeReq({ id: '1', memberId: '2' }, { role: 'Boss' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('prevents changing project lead role', async () => {
    mockGet.mockResolvedValueOnce(null) // loadProjectRole: no pm row
    mockGet.mockResolvedValueOnce({ lead: 'Alice' })
    mockGet.mockResolvedValueOnce({ name: 'Alice' })
    const res = mockRes()
    await runRoute(projectsRouter, 'put', '/:id/members/:memberId/role', makeReq({ id: '1', memberId: '2' }, { role: 'Viewer' }), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toMatch(/Lead/)
  })

  it('returns 404 when member not in project', async () => {
    mockGet.mockResolvedValueOnce(null) // loadProjectRole
    mockGet.mockResolvedValueOnce({ lead: 'Alice' })
    mockGet.mockResolvedValueOnce({ name: 'Bob' })
    mockGet.mockResolvedValueOnce(null) // not assigned
    const res = mockRes()
    await runRoute(projectsRouter, 'put', '/:id/members/:memberId/role', makeReq({ id: '1', memberId: '2' }, { role: 'Admin' }), res)
    expect(res.statusCode).toBe(404)
  })

  it('successfully updates project member role', async () => {
    const updated = { id: 2, name: 'Bob', email: 'bob@test.com', project_role: 'Admin', pm_id: 5 }
    mockGet.mockResolvedValueOnce(null) // loadProjectRole
    mockGet.mockResolvedValueOnce({ lead: 'Alice' })
    mockGet.mockResolvedValueOnce({ name: 'Bob' })
    mockGet.mockResolvedValueOnce({ id: 5 }) // existing pm row
    mockRun.mockResolvedValueOnce({})
    mockGet.mockResolvedValueOnce(updated)
    const res = mockRes()
    await runRoute(projectsRouter, 'put', '/:id/members/:memberId/role', makeReq({ id: '1', memberId: '2' }, { role: 'Admin' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.project_role).toBe('Admin')
  })
})
