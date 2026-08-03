// @vitest-environment node
// JL-331 — Publish must not wipe cancel_from_any / cancel_status.
// JL-334 — every project gets a default workflow (seed on create + backfill).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => {
  const run = vi.fn()
  const all = vi.fn()
  const get = vi.fn()
  return {
    run, all, get,
    withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
    getSetting: vi.fn(async (_k, fallback = null) => fallback),
    setSetting: vi.fn(),
    columnExists: vi.fn(),
    tableExists: vi.fn(async () => true),
  }
})

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { QA_LIFECYCLE } from '../services/workflowTemplates.js'
import { seedDefaultWorkflow, backfillDefaultWorkflows } from '../services/workflowSeed.js'

function createApp(routeModule, { role = 'Admin' } = {}) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', memberId: 1, workspaceRole: role, isOwner: false }
    next()
  })
  app.use('/api', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

const EXISTING_ROW = {
  id: 42, project_id: 7, name: 'QA Lifecycle', initial_status: 'Backlog',
  terminal_statuses: ['Done', 'Cancelled'], cancel_from_any: true,
  cancel_status: 'Cancelled', is_default: true,
}

/** The SET clause of the UPDATE issued against project_workflows, if any. */
function workflowUpdate() {
  return run.mock.calls.find(([sql]) => /UPDATE project_workflows SET (?!is_default = FALSE)/is.test(sql))
}

beforeEach(() => {
  vi.clearAllMocks()
  run.mockResolvedValue({ lastID: 1, changes: 1 })
  all.mockResolvedValue([])
  get.mockResolvedValue(undefined)
})

/* ── JL-331: partial update ────────────────────────────────────────────── */

describe('JL-331 — upsertWorkflowMeta only writes supplied fields', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/workflowDefinitions.js')
    app = createApp(mod)
    get.mockImplementation(async (sql) => {
      if (/FROM project_workflows WHERE project_id = .* LOWER\(name\)/is.test(sql)) return { id: 42 }
      if (/FROM project_workflows WHERE id/.test(sql)) return EXISTING_ROW
      return undefined
    })
  })

  it('leaves cancel settings alone when Publish omits them', async () => {
    // This is the regression: the original UPDATE wrote every column, so an
    // omitted cancelFromAny became false and cancelStatus became null —
    // silently disabling cancel-from-any and making cancellation impossible.
    const res = await request(app)
      .post('/api/projects/7/workflow-definitions')
      .send({ name: 'QA Lifecycle', initialStatus: 'Backlog', terminalStatuses: ['Done'] })

    expect(res.status).toBe(201)
    const update = workflowUpdate()
    expect(update).toBeTruthy()
    expect(update[0]).not.toMatch(/cancel_from_any/)
    expect(update[0]).not.toMatch(/cancel_status/)
    expect(update[0]).toMatch(/initial_status/)
    expect(update[0]).toMatch(/terminal_statuses/)
  })

  it('does update the cancel settings when they ARE supplied', async () => {
    const res = await request(app)
      .post('/api/projects/7/workflow-definitions')
      .send({ name: 'QA Lifecycle', cancelFromAny: true, cancelStatus: 'Cancelled' })

    expect(res.status).toBe(201)
    const update = workflowUpdate()
    expect(update[0]).toMatch(/cancel_from_any/)
    expect(update[0]).toMatch(/cancel_status/)
    expect(update[1]).toContain(true)
    expect(update[1]).toContain('Cancelled')
  })

  it('apply-template still writes the full template metadata', async () => {
    const res = await request(app)
      .post('/api/projects/7/workflow-definitions/apply-template')
      .send({ template: 'qa-lifecycle' })

    expect(res.status).toBe(201)
    const update = workflowUpdate()
    // The template supplies every field, so all of them are written.
    expect(update[0]).toMatch(/cancel_from_any/)
    expect(update[1]).toContain(QA_LIFECYCLE.cancelStatus)
  })

  it('issues no UPDATE at all when nothing but the name is sent', async () => {
    const res = await request(app)
      .post('/api/projects/7/workflow-definitions')
      .send({ name: 'QA Lifecycle' })

    expect(res.status).toBe(201)
    expect(workflowUpdate()).toBeUndefined()
  })
})

/* ── JL-334: seeding ───────────────────────────────────────────────────── */

describe('JL-334 — seedDefaultWorkflow', () => {
  it('seeds statuses, transitions and a default workflow row', async () => {
    const result = await seedDefaultWorkflow(1)

    expect(result.seeded).toBe(true)
    const statusInserts = run.mock.calls.filter(([sql]) => /INSERT INTO issue_statuses/.test(sql))
    const transitionInserts = run.mock.calls.filter(([sql]) => /INSERT INTO workflow_transitions/.test(sql))
    const workflowInsert = run.mock.calls.find(([sql]) => /INSERT INTO project_workflows/.test(sql))

    expect(statusInserts).toHaveLength(QA_LIFECYCLE.states.length)
    expect(transitionInserts).toHaveLength(QA_LIFECYCLE.transitions.length)
    expect(workflowInsert).toBeTruthy()
    // The seeded row must carry the template's cancel config (see JL-331).
    expect(workflowInsert[1]).toContain(QA_LIFECYCLE.cancelStatus)
    expect(workflowInsert[1]).toContain(true) // cancel_from_any
  })

  it('is a no-op when the project already has a workflow', async () => {
    get.mockImplementation(async (sql) =>
      /FROM project_workflows WHERE project_id/.test(sql) ? { id: 5 } : undefined)

    const result = await seedDefaultWorkflow(1)

    expect(result.seeded).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('copies the globals down first so seeding cannot hide existing statuses', async () => {
    // JL-332 interaction: a project with no rows of its own is displaying the
    // globals; seeding must carry those across, not replace them.
    all.mockImplementation(async (sql) => {
      if (/project_id IS NULL/.test(sql)) {
        return [{ name: 'Code Review', position: 3, color: '#EAE6FF', category: 'inprogress' }]
      }
      return []
    })

    await seedDefaultWorkflow(1)

    const names = run.mock.calls
      .filter(([sql]) => /INSERT INTO issue_statuses/.test(sql))
      .map(([, p]) => p[1])
    // Code Review survives alongside the template's states.
    expect(names).toContain('Code Review')
    expect(names).toContain('In Testing')
  })

  it('does not duplicate a status the project already has', async () => {
    all.mockImplementation(async (sql) =>
      /project_id = /.test(sql) ? [{ lname: 'backlog' }] : [])

    await seedDefaultWorkflow(1)

    const names = run.mock.calls
      .filter(([sql]) => /INSERT INTO issue_statuses/.test(sql))
      .map(([, p]) => p[1])
    expect(names).not.toContain('Backlog')
    expect(names).toContain('To Do')
  })
})

describe('JL-334 — backfillDefaultWorkflows', () => {
  it('seeds only projects that have none', async () => {
    all.mockImplementation(async (sql) => {
      if (/FROM projects p/.test(sql)) return [{ id: 2 }, { id: 4 }]
      return []
    })

    const seeded = await backfillDefaultWorkflows()

    expect(seeded).toBe(2)
    expect(all.mock.calls[0][0]).toMatch(/NOT EXISTS/)
  })

  it('returns 0 when every project already has one', async () => {
    all.mockResolvedValue([])
    expect(await backfillDefaultWorkflows()).toBe(0)
  })

  it('keeps going when one project fails', async () => {
    all.mockImplementation(async (sql) => {
      if (/FROM projects p/.test(sql)) return [{ id: 2 }, { id: 4 }]
      return []
    })
    let call = 0
    run.mockImplementation(async () => {
      call += 1
      if (call === 1) throw new Error('boom')
      return { lastID: 1, changes: 1 }
    })

    // One project throws; the other must still be seeded.
    await expect(backfillDefaultWorkflows()).resolves.toBe(1)
  })
})
