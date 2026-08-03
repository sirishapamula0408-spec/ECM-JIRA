// @vitest-environment node
// JL-324 — backend half of the Workflow Editor fixes:
//   - upsertWorkflowMeta genuinely upserts (it used to always INSERT, so every
//     Apply-template / Publish click appended a duplicate row)
//   - the QA Lifecycle template stores light Atlassian SURFACE tokens, because
//     `color` is painted as the node fill in the editor
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

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { QA_LIFECYCLE_STATES } from '../services/workflowTemplates.js'

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

const WORKFLOW_ROW = {
  id: 42, project_id: 7, name: 'QA Lifecycle', initial_status: 'Backlog',
  terminal_statuses: ['Done', 'Cancelled'], cancel_from_any: true,
  cancel_status: 'Cancelled', is_default: true,
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../routes/workflowDefinitions.js')
  app = createApp(mod)
  run.mockResolvedValue({ lastID: 1, changes: 1 })
  all.mockResolvedValue([])
})

/* ── Duplicate workflow rows ───────────────────────────────────────────── */

describe('JL-324 — upsertWorkflowMeta no longer duplicates rows', () => {
  it('UPDATEs in place when a workflow of the same name already exists', async () => {
    get.mockImplementation(async (sql) => {
      // The dedupe lookup finds an existing "QA Lifecycle" for this project.
      if (/FROM project_workflows WHERE project_id = .* LOWER\(name\)/is.test(sql)) {
        return { id: 42 }
      }
      if (/FROM project_workflows WHERE id/.test(sql)) return WORKFLOW_ROW
      return null
    })

    const res = await request(app)
      .post('/api/projects/7/workflow-definitions/apply-template')
      .send({ template: 'qa-lifecycle' })

    expect(res.status).toBe(201)

    const workflowInserts = run.mock.calls.filter(
      ([sql]) => /INSERT INTO project_workflows/.test(sql),
    )
    const workflowUpdates = run.mock.calls.filter(
      ([sql]) => /UPDATE project_workflows\s+SET initial_status/is.test(sql),
    )
    // The bug: this used to be 1 insert every time, stacking duplicates.
    expect(workflowInserts).toHaveLength(0)
    expect(workflowUpdates).toHaveLength(1)
    expect(workflowUpdates[0][1]).toContain(42) // updated the existing row id
  })

  it('still INSERTs when no workflow of that name exists yet', async () => {
    get.mockImplementation(async (sql) => {
      if (/FROM project_workflows WHERE project_id = .* LOWER\(name\)/is.test(sql)) return null
      if (/FROM project_workflows WHERE id/.test(sql)) return WORKFLOW_ROW
      return null
    })

    const res = await request(app)
      .post('/api/projects/7/workflow-definitions/apply-template')
      .send({ template: 'qa-lifecycle' })

    expect(res.status).toBe(201)
    expect(run.mock.calls.filter(([sql]) => /INSERT INTO project_workflows/.test(sql)))
      .toHaveLength(1)
  })

  it('matches an existing name case-insensitively', async () => {
    const seen = []
    get.mockImplementation(async (sql, params) => {
      if (/FROM project_workflows WHERE project_id = .* LOWER\(name\)/is.test(sql)) {
        seen.push(params)
        return { id: 7 }
      }
      if (/FROM project_workflows WHERE id/.test(sql)) return WORKFLOW_ROW
      return null
    })

    await request(app)
      .post('/api/projects/7/workflow-definitions')
      .send({ name: 'qa lifecycle', initialStatus: 'Backlog' })

    expect(seen.length).toBeGreaterThan(0)
    // LOWER() on both sides means 'qa lifecycle' matches a stored 'QA Lifecycle'.
    expect(run.mock.calls.filter(([sql]) => /INSERT INTO project_workflows/.test(sql)))
      .toHaveLength(0)
  })

  it('still clears is_default on the project’s other workflows', async () => {
    get.mockImplementation(async (sql) => {
      if (/FROM project_workflows WHERE project_id = .* LOWER\(name\)/is.test(sql)) return { id: 42 }
      if (/FROM project_workflows WHERE id/.test(sql)) return WORKFLOW_ROW
      return null
    })

    await request(app)
      .post('/api/projects/7/workflow-definitions/apply-template')
      .send({ template: 'qa-lifecycle' })

    expect(run.mock.calls.some(
      ([sql]) => /UPDATE project_workflows SET is_default = FALSE/.test(sql),
    )).toBe(true)
  })
})

/* ── Status colours are light surfaces ─────────────────────────────────── */

describe('JL-324 — QA Lifecycle template uses light surface colours', () => {
  // WCAG relative luminance; a "surface" token should be near-white.
  function luminance(hex) {
    const m = hex.replace('#', '')
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255)
    const ch = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
  }

  it('stores no dark text tokens as status fills', () => {
    const LEGACY_DARK = ['#42526E', '#0052CC', '#FF8B00', '#FF7452', '#6554C0', '#36B37E', '#97A0AF']
    for (const state of QA_LIFECYCLE_STATES) {
      expect(LEGACY_DARK).not.toContain(state.color.toUpperCase())
    }
  })

  it('every template colour is a light surface', () => {
    for (const state of QA_LIFECYCLE_STATES) {
      expect(luminance(state.color)).toBeGreaterThan(0.6)
    }
  })

  it('every template colour clears WCAG AA against Atlassian body text', () => {
    const textLum = luminance('#172B4D')
    for (const state of QA_LIFECYCLE_STATES) {
      const bgLum = luminance(state.color)
      const ratio = (Math.max(bgLum, textLum) + 0.05) / (Math.min(bgLum, textLum) + 0.05)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('defaults a state with no colour to a light surface, not #42526E', async () => {
    get.mockImplementation(async (sql) => {
      if (/FROM project_workflows WHERE id/.test(sql)) return WORKFLOW_ROW
      return null
    })
    all.mockResolvedValue([]) // project has no statuses yet

    await request(app)
      .post('/api/projects/7/workflow-definitions')
      .send({ name: 'Custom', states: [{ name: 'Triage', category: 'todo' }] })

    const statusInsert = run.mock.calls.find(
      ([sql]) => /INSERT INTO issue_statuses/.test(sql),
    )
    expect(statusInsert).toBeTruthy()
    expect(statusInsert[1]).toContain('#F4F5F7')
    expect(statusInsert[1]).not.toContain('#42526E')
  })
})
