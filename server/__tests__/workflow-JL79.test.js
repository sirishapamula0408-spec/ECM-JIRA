import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module (shared by the service + issues route under test)
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  isTransitionAllowed,
  findTransition,
  runValidators,
  applyPostFunctions,
} from '../services/workflow.js'

function createApp(routeModule, mountPath = '/api/issues') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
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
   Pure helper: isTransitionAllowed
   ================================================================ */
describe('isTransitionAllowed', () => {
  it('allows all changes when no transitions are configured (backward compat)', () => {
    expect(isTransitionAllowed([], 'To Do', 'Done')).toBe(true)
    expect(isTransitionAllowed(undefined, 'To Do', 'Done')).toBe(true)
    expect(isTransitionAllowed(null, 'To Do', 'Done')).toBe(true)
  })

  it('allows a configured transition and denies an unconfigured one', () => {
    const transitions = [{ from_status: 'To Do', to_status: 'In Progress' }]
    expect(isTransitionAllowed(transitions, 'To Do', 'In Progress')).toBe(true)
    expect(isTransitionAllowed(transitions, 'To Do', 'Done')).toBe(false)
  })

  it('always allows a no-op (from === to)', () => {
    const transitions = [{ from_status: 'To Do', to_status: 'In Progress' }]
    expect(isTransitionAllowed(transitions, 'Done', 'Done')).toBe(true)
  })
})

/* ================================================================
   Pure helper: runValidators
   ================================================================ */
describe('runValidators', () => {
  it('returns no errors when there is no transition or no validators', () => {
    expect(runValidators(null, {}, {})).toEqual([])
    expect(runValidators({ to_status: 'Done', validators: [] }, {}, {})).toEqual([])
  })

  it('reports an error when a required field is missing', () => {
    const transition = {
      to_status: 'Done',
      validators: [{ type: 'required_field', field: 'assignee' }],
    }
    const errors = runValidators(transition, { assignee: '' }, {})
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('assignee')
  })

  it('passes when the required field is present (from issue or patch)', () => {
    const transition = {
      to_status: 'Done',
      validators: [{ type: 'required_field', field: 'assignee' }],
    }
    expect(runValidators(transition, { assignee: 'a@a.com' }, {})).toEqual([])
    // patch value satisfies the requirement even if the issue is blank
    expect(runValidators(transition, { assignee: '' }, { assignee: 'b@b.com' })).toEqual([])
  })
})

/* ================================================================
   Pure helper: applyPostFunctions (writes to injected db)
   ================================================================ */
describe('applyPostFunctions', () => {
  it('applies set_field and add_comment directly to the db', async () => {
    const db = { run: vi.fn().mockResolvedValue({ lastID: 1 }) }
    const transition = {
      post_functions: [
        { type: 'set_field', field: 'assignee', value: 'lead@x.com' },
        { type: 'add_comment', text: 'Auto note' },
      ],
    }
    const applied = await applyPostFunctions(transition, 42, db)

    expect(db.run).toHaveBeenCalledTimes(2)
    expect(db.run).toHaveBeenNthCalledWith(1, 'UPDATE issues SET assignee = ? WHERE id = ?', ['lead@x.com', 42])
    expect(db.run).toHaveBeenNthCalledWith(2, 'INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)', [42, 'Workflow', 'Auto note'])
    expect(applied).toEqual(['set assignee', 'added comment'])
  })

  it('ignores non-whitelisted set_field targets (SQL-injection guard)', async () => {
    const db = { run: vi.fn().mockResolvedValue({}) }
    const transition = { post_functions: [{ type: 'set_field', field: 'id', value: 9 }] }
    const applied = await applyPostFunctions(transition, 1, db)
    expect(db.run).not.toHaveBeenCalled()
    expect(applied).toEqual([])
  })
})

/* ================================================================
   findTransition
   ================================================================ */
describe('findTransition', () => {
  it('returns the matching transition or null', () => {
    const transitions = [{ id: 1, from_status: 'To Do', to_status: 'Done' }]
    expect(findTransition(transitions, 'To Do', 'Done')).toEqual(transitions[0])
    expect(findTransition(transitions, 'To Do', 'In Progress')).toBeNull()
  })
})

/* ================================================================
   Integration: issues status PATCH honoring the workflow
   ================================================================ */
describe('PATCH /api/issues/:id/status — workflow enforcement', () => {
  let app

  // Build a mutable issue whose status/assignee change as `run` UPDATEs execute,
  // so that "read before update" and "read after update" behave realistically.
  function wireDb(issue, transitions) {
    get.mockImplementation(async (sql) => {
      if (/FROM issues WHERE id/.test(sql)) return { ...issue }
      if (/FROM sprints/.test(sql)) return { id: issue.sprint_id }
      return null
    })
    all.mockImplementation(async (sql) => {
      if (/workflow_transitions/.test(sql)) return transitions
      // open-subtask check, automation rules, webhook lookups → none
      return []
    })
    run.mockImplementation(async (sql, params) => {
      if (/UPDATE issues SET status/.test(sql)) {
        issue.status = params[0]
        issue.sprint_id = params[1]
      } else if (/UPDATE issues SET assignee/.test(sql)) {
        issue.assignee = params[0]
      }
      return { lastID: issue.id, changes: 1 }
    })
  }

  beforeEach(async () => {
    const mod = await import('../routes/issues.js')
    app = createApp(mod)
  })

  it('allows any transition when the project has no workflow configured (backward compat)', async () => {
    const issue = { id: 1, issue_key: 'P-1', sprint_id: 5, status: 'To Do', project_id: 1, assignee: 'a@a.com', priority: 'Medium' }
    wireDb(issue, []) // no transitions

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('Done')
  })

  it('returns 409 when the transition is not allowed by the workflow', async () => {
    const issue = { id: 1, issue_key: 'P-1', sprint_id: 5, status: 'To Do', project_id: 1, assignee: 'a@a.com', priority: 'Medium' }
    wireDb(issue, [{ id: 1, from_status: 'To Do', to_status: 'In Progress', validators: [], post_functions: [] }])

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/not allowed/i)
    expect(issue.status).toBe('To Do') // unchanged
  })

  it('returns 400 when a validator fails (required field missing)', async () => {
    const issue = { id: 1, issue_key: 'P-1', sprint_id: 5, status: 'To Do', project_id: 1, assignee: '', priority: 'Medium' }
    wireDb(issue, [{
      id: 2,
      from_status: 'To Do',
      to_status: 'Done',
      validators: [{ type: 'required_field', field: 'assignee' }],
      post_functions: [],
    }])

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/assignee/)
    expect(issue.status).toBe('To Do') // unchanged
  })

  it('allows a configured transition and applies its post-functions', async () => {
    const issue = { id: 1, issue_key: 'P-1', sprint_id: 5, status: 'To Do', project_id: 1, assignee: 'a@a.com', priority: 'Medium' }
    wireDb(issue, [{
      id: 3,
      from_status: 'To Do',
      to_status: 'In Progress',
      validators: [],
      post_functions: [
        { type: 'set_field', field: 'assignee', value: 'lead@x.com' },
        { type: 'add_comment', text: 'Started work' },
      ],
    }])

    const res = await request(app).patch('/api/issues/1/status').send({ status: 'In Progress' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('In Progress')
    // post-functions applied directly to the DB
    expect(run).toHaveBeenCalledWith('UPDATE issues SET assignee = ? WHERE id = ?', ['lead@x.com', 1])
    expect(run).toHaveBeenCalledWith('INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)', [1, 'Workflow', 'Started work'])
  })
})
