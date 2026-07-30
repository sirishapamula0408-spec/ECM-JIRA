// @vitest-environment node
// JL-306 — Configurable workflow engine: QA lifecycle states + transitions +
// custom workflows. Covers:
//  - the QA Lifecycle template definition,
//  - the transition-validation MATRIX (pure isTransitionAllowed, incl. cancel-from-any
//    and terminal states),
//  - server-side enforcement on PATCH /api/issues/:id/status (valid / illegal /
//    rework loops / UAT branches / cancel-from-any),
//  - named-workflow CRUD (apply template, create custom, set default).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// realtime.js imports the optional `ws` package at module load; stub it so the
// issues route (which imports `publish`) loads in the test environment.
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import {
  isTransitionAllowed,
  cancelOptionsFromMeta,
} from '../services/workflow.js'
import {
  QA_LIFECYCLE,
  QA_LIFECYCLE_TRANSITIONS,
  listTemplates,
  getTemplate,
} from '../services/workflowTemplates.js'

// QA graph as the engine sees it (from_status/to_status rows).
const QA_ROWS = QA_LIFECYCLE_TRANSITIONS.map(([from_status, to_status]) => ({ from_status, to_status }))
const QA_META = {
  cancel_from_any: true,
  cancel_status: 'Cancelled',
  terminal_statuses: ['Done', 'Cancelled'],
}
const QA_OPTS = cancelOptionsFromMeta(QA_META)

function createApp(routeModule, mountPath) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: 'Admin', isOwner: false }
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
   QA Lifecycle template definition
   ================================================================ */
describe('QA Lifecycle template', () => {
  it('defines the 8 QA states, Backlog initial, Done/Cancelled terminal, cancel-from-any', () => {
    const names = QA_LIFECYCLE.states.map((s) => s.name)
    expect(names).toEqual([
      'Backlog', 'To Do', 'In Progress', 'In Testing', 'In Rework', 'In UAT', 'Done', 'Cancelled',
    ])
    expect(QA_LIFECYCLE.initialStatus).toBe('Backlog')
    expect(QA_LIFECYCLE.terminalStatuses).toEqual(['Done', 'Cancelled'])
    expect(QA_LIFECYCLE.cancelFromAny).toBe(true)
    expect(QA_LIFECYCLE.cancelStatus).toBe('Cancelled')
  })

  it('exposes the QA branches: Testing→UAT / Testing→Rework and UAT→Done / UAT→Rework', () => {
    const pairs = QA_LIFECYCLE_TRANSITIONS.map((t) => t.join('->'))
    expect(pairs).toContain('In Testing->In UAT')
    expect(pairs).toContain('In Testing->In Rework')
    expect(pairs).toContain('In Rework->In Progress')
    expect(pairs).toContain('In UAT->Done')
    expect(pairs).toContain('In UAT->In Rework')
    // Cancel edges are NOT explicit — expressed by cancelFromAny.
    expect(pairs.some((p) => p.endsWith('->Cancelled'))).toBe(false)
  })

  it('listTemplates() / getTemplate() surface the QA Lifecycle', () => {
    const templates = listTemplates()
    expect(templates.map((t) => t.name)).toContain('QA Lifecycle')
    expect(getTemplate('qa-lifecycle')?.name).toBe('QA Lifecycle')
    expect(getTemplate('QA Lifecycle')?.key).toBe('qa-lifecycle')
    expect(getTemplate('nope')).toBeNull()
  })
})

/* ================================================================
   Transition-validation MATRIX (pure engine)
   ================================================================ */
describe('isTransitionAllowed — QA lifecycle matrix', () => {
  const allow = [
    ['Backlog', 'To Do'],
    ['To Do', 'In Progress'],
    ['In Progress', 'In Testing'],
    ['In Testing', 'In UAT'],
    ['In Testing', 'In Rework'],
    ['In Rework', 'In Progress'],
    ['In UAT', 'Done'],
    ['In UAT', 'In Rework'],
  ]
  const deny = [
    ['Backlog', 'In Progress'],
    ['To Do', 'Done'],
    ['In Progress', 'Done'],
    ['In Progress', 'In UAT'],
    ['In Testing', 'Done'],
    ['In Rework', 'In Testing'],
    ['In UAT', 'In Progress'],
  ]

  it.each(allow)('ALLOWS %s -> %s', (from, to) => {
    expect(isTransitionAllowed(QA_ROWS, from, to, QA_OPTS)).toBe(true)
  })

  it.each(deny)('DENIES %s -> %s', (from, to) => {
    expect(isTransitionAllowed(QA_ROWS, from, to, QA_OPTS)).toBe(false)
  })

  it('allows Cancel from EVERY non-terminal state (cancel-from-any)', () => {
    for (const s of ['Backlog', 'To Do', 'In Progress', 'In Testing', 'In Rework', 'In UAT']) {
      expect(isTransitionAllowed(QA_ROWS, s, 'Cancelled', QA_OPTS)).toBe(true)
    }
  })

  it('does NOT allow leaving a terminal state (Done / Cancelled)', () => {
    expect(isTransitionAllowed(QA_ROWS, 'Done', 'Cancelled', QA_OPTS)).toBe(false)
    expect(isTransitionAllowed(QA_ROWS, 'Done', 'In Progress', QA_OPTS)).toBe(false)
    expect(isTransitionAllowed(QA_ROWS, 'Cancelled', 'To Do', QA_OPTS)).toBe(false)
  })

  it('models the Testing→Rework→In Progress→Testing loop and the UAT→Rework loop', () => {
    expect(isTransitionAllowed(QA_ROWS, 'In Testing', 'In Rework', QA_OPTS)).toBe(true)
    expect(isTransitionAllowed(QA_ROWS, 'In Rework', 'In Progress', QA_OPTS)).toBe(true)
    expect(isTransitionAllowed(QA_ROWS, 'In Progress', 'In Testing', QA_OPTS)).toBe(true)
    expect(isTransitionAllowed(QA_ROWS, 'In UAT', 'In Rework', QA_OPTS)).toBe(true)
  })

  it('remains backward compatible: no options + no transitions ⇒ allow all', () => {
    expect(isTransitionAllowed([], 'To Do', 'Done')).toBe(true)
    expect(isTransitionAllowed(undefined, 'In Progress', 'Done')).toBe(true)
  })

  it('cancelOptionsFromMeta(null) yields no restrictions', () => {
    expect(cancelOptionsFromMeta(null)).toEqual({})
  })
})

/* ================================================================
   Enforcement on PATCH /api/issues/:id/status
   ================================================================ */
describe('PATCH /api/issues/:id/status — QA workflow enforcement', () => {
  let app

  function wireDb(issue, transitions, meta) {
    get.mockImplementation(async (sql) => {
      if (/FROM issues WHERE id/.test(sql)) return { ...issue }
      if (/FROM sprints/.test(sql)) return { id: issue.sprint_id }
      if (/FROM project_workflows/.test(sql)) return meta
      return null
    })
    all.mockImplementation(async (sql) => {
      if (/workflow_transitions/.test(sql)) return transitions
      return []
    })
    run.mockImplementation(async (sql, params) => {
      if (/UPDATE issues SET status/.test(sql)) {
        issue.status = params[0]
        issue.sprint_id = params[1]
      }
      return { lastID: issue.id, changes: 1 }
    })
  }

  function makeIssue(status) {
    return { id: 1, issue_key: 'QA-1', sprint_id: 5, status, project_id: 7, assignee: 'a@a.com', priority: 'Medium' }
  }

  beforeEach(async () => {
    const mod = await import('../routes/issues.js')
    app = createApp(mod, '/api/issues')
  })

  it('allows a valid QA transition (In Progress -> In Testing)', async () => {
    const issue = makeIssue('In Progress')
    wireDb(issue, QA_ROWS, { ...QA_META })
    const res = await request(app).patch('/api/issues/1/status').send({ status: 'In Testing' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('In Testing')
  })

  it('rejects an illegal QA transition with 409 (In Progress -> Done)', async () => {
    const issue = makeIssue('In Progress')
    wireDb(issue, QA_ROWS, { ...QA_META })
    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/not allowed/i)
    expect(issue.status).toBe('In Progress')
  })

  it('allows the defect loop In Testing -> In Rework', async () => {
    const issue = makeIssue('In Testing')
    wireDb(issue, QA_ROWS, { ...QA_META })
    const res = await request(app).patch('/api/issues/1/status').send({ status: 'In Rework' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('In Rework')
  })

  it('allows In Rework -> In Progress (rework re-enters development)', async () => {
    const issue = makeIssue('In Rework')
    wireDb(issue, QA_ROWS, { ...QA_META })
    const res = await request(app).patch('/api/issues/1/status').send({ status: 'In Progress' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('In Progress')
  })

  it('allows In UAT -> In Rework (defect in UAT) and In UAT -> Done (clean)', async () => {
    const issue1 = makeIssue('In UAT')
    wireDb(issue1, QA_ROWS, { ...QA_META })
    const rework = await request(app).patch('/api/issues/1/status').send({ status: 'In Rework' })
    expect(rework.status).toBe(200)

    const issue2 = makeIssue('In UAT')
    wireDb(issue2, QA_ROWS, { ...QA_META })
    const done = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(done.status).toBe(200)
    expect(issue2.status).toBe('Done')
  })

  it('allows Cancel from any active state (In Testing -> Cancelled)', async () => {
    const issue = makeIssue('In Testing')
    wireDb(issue, QA_ROWS, { ...QA_META })
    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Cancelled' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('Cancelled')
  })

  it('rejects leaving a terminal state (Done -> Cancelled) with 409', async () => {
    const issue = makeIssue('Done')
    wireDb(issue, QA_ROWS, { ...QA_META })
    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Cancelled' })
    expect(res.status).toBe(409)
    expect(issue.status).toBe('Done')
  })

  it('backward compatible: no workflow meta + no transitions allows any change', async () => {
    const issue = makeIssue('To Do')
    wireDb(issue, [], null)
    const res = await request(app).patch('/api/issues/1/status').send({ status: 'Done' })
    expect(res.status).toBe(200)
    expect(issue.status).toBe('Done')
  })
})

/* ================================================================
   Named-workflow CRUD (apply template, create custom, set default)
   ================================================================ */
describe('workflow-definitions API', () => {
  let app

  beforeEach(async () => {
    const mod = await import('../routes/workflowDefinitions.js')
    app = createApp(mod, '/api')
  })

  it('GET /api/workflow-templates lists the QA Lifecycle', async () => {
    const res = await request(app).get('/api/workflow-templates')
    expect(res.status).toBe(200)
    expect(res.body.map((t) => t.name)).toContain('QA Lifecycle')
  })

  it('applies the QA template: seeds transitions and creates a default workflow', async () => {
    all.mockImplementation(async (sql) => {
      if (/FROM issue_statuses/.test(sql)) return [{ lname: 'backlog' }, { lname: 'to do' }]
      return []
    })
    let seq = 0
    get.mockImplementation(async (sql) => {
      if (/FROM workflow_transitions/.test(sql)) return null // no dup transitions
      if (/FROM project_workflows WHERE id/.test(sql)) {
        return {
          id: 42, project_id: 7, name: 'QA Lifecycle', initial_status: 'Backlog',
          terminal_statuses: ['Done', 'Cancelled'], cancel_from_any: true,
          cancel_status: 'Cancelled', is_default: true,
        }
      }
      return null
    })
    run.mockImplementation(async () => ({ lastID: ++seq, changes: 1 }))

    const res = await request(app)
      .post('/api/projects/7/workflow-definitions/apply-template')
      .send({ template: 'qa-lifecycle' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name: 'QA Lifecycle', initialStatus: 'Backlog', cancelFromAny: true,
      cancelStatus: 'Cancelled', isDefault: true,
    })
    // The 8 QA transitions were inserted into workflow_transitions.
    const transitionInserts = run.mock.calls.filter(
      ([sql]) => /INSERT INTO workflow_transitions/.test(sql),
    )
    expect(transitionInserts).toHaveLength(QA_LIFECYCLE_TRANSITIONS.length)
    // Missing statuses (In Progress, In Testing, In Rework, In UAT, Done, Cancelled) inserted.
    const statusInserts = run.mock.calls.filter(
      ([sql]) => /INSERT INTO issue_statuses/.test(sql),
    )
    expect(statusInserts.length).toBeGreaterThan(0)
    // The default flag on other workflows was cleared before insert.
    expect(run.mock.calls.some(([sql]) => /UPDATE project_workflows SET is_default = FALSE/.test(sql))).toBe(true)
  })

  it('rejects an unknown template with 400', async () => {
    const res = await request(app)
      .post('/api/projects/7/workflow-definitions/apply-template')
      .send({ template: 'no-such-template' })
    expect(res.status).toBe(400)
  })

  it('creates a custom workflow with states + transitions + default flag', async () => {
    all.mockResolvedValue([]) // no existing statuses
    get.mockImplementation(async (sql) => {
      if (/FROM project_workflows WHERE id/.test(sql)) {
        return {
          id: 99, project_id: 3, name: 'Bug Triage', initial_status: 'Backlog',
          terminal_statuses: ['Done'], cancel_from_any: false, cancel_status: null, is_default: true,
        }
      }
      return null
    })
    run.mockResolvedValue({ lastID: 99, changes: 1 })

    const res = await request(app).post('/api/projects/3/workflow-definitions').send({
      name: 'Bug Triage',
      states: [{ name: 'Backlog', category: 'todo' }, { name: 'Done', category: 'done' }],
      transitions: [{ fromStatus: 'Backlog', toStatus: 'Done' }],
      initialStatus: 'Backlog',
      terminalStatuses: ['Done'],
      isDefault: true,
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name: 'Bug Triage', isDefault: true })
    expect(run.mock.calls.some(([sql]) => /INSERT INTO project_workflows/.test(sql))).toBe(true)
  })

  it('rejects a custom workflow without a name (400)', async () => {
    const res = await request(app).post('/api/projects/3/workflow-definitions').send({})
    expect(res.status).toBe(400)
  })

  it('PATCH sets a workflow as the project default', async () => {
    get.mockImplementation(async (sql, params) => {
      if (/FROM project_workflows WHERE id/.test(sql)) {
        const isDefault = run.mock.calls.some(([s]) => /UPDATE project_workflows SET/.test(s))
        return {
          id: Number(params[0]) || 5, project_id: 7, name: 'QA Lifecycle',
          initial_status: 'Backlog', terminal_statuses: ['Done', 'Cancelled'],
          cancel_from_any: true, cancel_status: 'Cancelled', is_default: isDefault,
        }
      }
      return null
    })
    run.mockResolvedValue({ lastID: 5, changes: 1 })

    const res = await request(app).patch('/api/workflow-definitions/5').send({ isDefault: true })
    expect(res.status).toBe(200)
    expect(res.body.isDefault).toBe(true)
    // Clears the default flag on siblings first.
    expect(run.mock.calls.some(([sql]) => /UPDATE project_workflows SET is_default = FALSE/.test(sql))).toBe(true)
  })
})
