import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Unit tests — the db module is mocked, no real Postgres.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, get } from '../db.js'
import { requireProjectRole } from '../middleware/authorize.js'
import { errorHandler } from '../middleware/errorHandler.js'
import projectRoutes from '../routes/projects.js'

beforeEach(() => { vi.clearAllMocks() })

/* ================================================================
   requireProjectRole — Lead is the top project tier (>= Admin)
   ================================================================ */
describe('requireProjectRole with Lead role (JL-210)', () => {
  function invoke(projectRole, required) {
    const req = {
      user: {
        isOwner: false,
        workspaceRole: 'Member', // not a workspace admin — force project-level check
        projectRole,
      },
    }
    const next = vi.fn()
    const res = {
      status: vi.fn(function () { return this }),
      json: vi.fn(function () { return this }),
    }
    requireProjectRole(required)(req, res, next)
    return { next, res }
  }

  it('a project Lead passes requireProjectRole("Admin")', () => {
    const { next, res } = invoke('Lead', 'Admin')
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('a project Lead passes requireProjectRole("Lead")', () => {
    const { next } = invoke('Lead', 'Lead')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('a project Member is rejected by requireProjectRole("Admin")', () => {
    const { next, res } = invoke('Member', 'Admin')
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('a project Admin does NOT reach Lead-only gating semantics but still >= Admin', () => {
    // sanity: Admin still passes Admin gate
    const { next } = invoke('Admin', 'Admin')
    expect(next).toHaveBeenCalledTimes(1)
  })
})

/* ================================================================
   POST /api/projects — creator is assigned the Lead role
   ================================================================ */
describe('create project assigns creator as Lead (JL-210)', () => {
  function projectsApp(user) {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.user = user
      next()
    })
    app.use('/api/projects', projectRoutes)
    app.use(errorHandler)
    return app
  }

  it('inserts the creator into project_members with role "Lead"', async () => {
    // member lookup (resolve lead → member_id)
    get.mockResolvedValueOnce({ id: 7 })
    // INSERT INTO projects → returns lastID
    run.mockResolvedValueOnce({ lastID: 42, changes: 1 })
    // INSERT INTO project_members → ok
    run.mockResolvedValueOnce({ lastID: 1, changes: 1 })

    const user = { id: 7, email: 'creator@test.com', isOwner: true, workspaceRole: 'Admin' }
    const res = await request(projectsApp(user))
      .post('/api/projects')
      .send({ name: 'New Project', key: 'NP', type: 'Scrum', lead: 'creator@test.com' })

    expect(res.status).toBe(201)

    // Find the project_members insert call and assert the role is 'Lead'
    const memberInsert = run.mock.calls.find(
      ([sql]) => /INSERT INTO project_members/i.test(sql),
    )
    expect(memberInsert).toBeTruthy()
    expect(memberInsert[1]).toEqual([42, 7, 'Lead'])
  })
})
