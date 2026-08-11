// @vitest-environment node
// JL-330 — server-side Workflow Editor layout.
//
// The layout used to live only in the browser's localStorage. These tests cover
// the new project-scoped endpoint: reading a layout, upserting one, input
// validation, and — the important one — that WRITING a layout is gated by
// exactly the same permission that gates editing a workflow (workspace Admin,
// what `requireRole('Admin')` enforces and what the frontend's
// `canEditWorkflows` resolves to). The authorize middleware is deliberately NOT
// mocked here so the real gate is exercised.
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

import { run, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import layoutRoutes, { sanitizePositions } from '../routes/workflowLayout.js'
import transitionRoutes from '../routes/workflowTransitions.js'

// Mutated per test so one app can act as any workspace role.
let currentUser

function createApp() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { ...currentUser }; next() })
  app.use('/api', layoutRoutes)
  app.use('/api', transitionRoutes)
  app.use(errorHandler)
  return app
}

const asRole = (workspaceRole, extra = {}) => ({
  id: 1, email: 'test@test.com', memberId: 1, workspaceRole, isOwner: false, ...extra,
})

let app
beforeEach(() => {
  vi.clearAllMocks()
  currentUser = asRole('Admin')
  run.mockResolvedValue({ lastID: 1, changes: 1 })
  get.mockResolvedValue(null)
  app = createApp()
})

/* ── GET ────────────────────────────────────────────────────────────────── */

describe('GET /api/projects/:projectId/workflow-layout', () => {
  it('returns an empty layout (not a 404) for a project that has never saved one', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).get('/api/projects/7/workflow-layout')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ projectId: 7, positions: {}, updatedAt: null })
  })

  it('returns the stored positions map', async () => {
    get.mockResolvedValue({ positions: { 'To Do': { x: 300, y: 200 } }, updated_at: '2026-08-10T00:00:00Z' })
    const res = await request(app).get('/api/projects/1/workflow-layout')

    expect(res.status).toBe(200)
    expect(res.body.positions).toEqual({ 'To Do': { x: 300, y: 200 } })
    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(/FROM workflow_layouts WHERE project_id/),
      [1],
    )
  })

  it('is readable by a Viewer — the whole canvas already is', async () => {
    currentUser = asRole('Viewer')
    get.mockResolvedValue({ positions: { 'To Do': { x: 20, y: 20 } }, updated_at: null })
    const res = await request(app).get('/api/projects/1/workflow-layout')

    expect(res.status).toBe(200)
    expect(res.body.positions).toEqual({ 'To Do': { x: 20, y: 20 } })
  })
})

/* ── PUT ────────────────────────────────────────────────────────────────── */

describe('PUT /api/projects/:projectId/workflow-layout', () => {
  it('upserts the layout for the project and returns what was stored', async () => {
    const positions = { 'To Do': { x: 340, y: 240 }, Done: { x: 600, y: 240 } }
    get.mockResolvedValue({ positions, updated_at: 'now' })

    const res = await request(app).put('/api/projects/1/workflow-layout').send({ positions })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ projectId: 1, positions, updatedAt: 'now' })
    expect(run).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO workflow_layouts[\s\S]*ON CONFLICT \(project_id\) DO UPDATE/),
      [1, JSON.stringify(positions)],
    )
  })

  it('accepts an empty map — that is how Reset layout clears the shared layout', async () => {
    get.mockResolvedValue({ positions: {}, updated_at: 'now' })
    const res = await request(app).put('/api/projects/1/workflow-layout').send({ positions: {} })

    expect(res.status).toBe(200)
    expect(res.body.positions).toEqual({})
    expect(run).toHaveBeenCalledWith(expect.any(String), [1, '{}'])
  })

  it('rounds fractional coordinates and clamps negatives to 0', async () => {
    get.mockResolvedValue({ positions: {}, updated_at: null })
    await request(app)
      .put('/api/projects/1/workflow-layout')
      .send({ positions: { 'To Do': { x: 12.4, y: -30 } } })

    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      [1, JSON.stringify({ 'To Do': { x: 12, y: 0 } })],
    )
  })

  it('rejects a non-object positions payload with 400', async () => {
    const res = await request(app).put('/api/projects/1/workflow-layout').send({ positions: [1, 2] })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/must be an object/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a missing positions payload with 400', async () => {
    const res = await request(app).put('/api/projects/1/workflow-layout').send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/required/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a coordinate that is not numeric with 400 naming the status', async () => {
    const res = await request(app)
      .put('/api/projects/1/workflow-layout')
      .send({ positions: { 'To Do': { x: 'left', y: 10 } } })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/To Do/)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an absurd number of nodes with 400', async () => {
    const positions = {}
    for (let i = 0; i < 501; i += 1) positions[`S${i}`] = { x: i, y: i }
    const res = await request(app).put('/api/projects/1/workflow-layout').send({ positions })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at most 500/)
    expect(run).not.toHaveBeenCalled()
  })
})

/* ── Permissions ────────────────────────────────────────────────────────── */

describe('JL-330 — layout writes use the same gate as workflow editing', () => {
  const body = { positions: { 'To Do': { x: 20, y: 20 } } }

  it('rejects a workspace Member with 403', async () => {
    currentUser = asRole('Member')
    const res = await request(app).put('/api/projects/1/workflow-layout').send(body)

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/Insufficient permissions/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a workspace Viewer with 403', async () => {
    currentUser = asRole('Viewer')
    const res = await request(app).put('/api/projects/1/workflow-layout').send(body)

    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('allows the workspace Owner (who bypasses the role rank)', async () => {
    currentUser = asRole('Viewer', { isOwner: true })
    get.mockResolvedValue({ positions: body.positions, updated_at: 'now' })
    const res = await request(app).put('/api/projects/1/workflow-layout').send(body)

    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalled()
  })

  it('matches the transition-write gate exactly: the role rejected there is rejected here', async () => {
    currentUser = asRole('Member')

    const transitionRes = await request(app)
      .post('/api/projects/1/workflow-transitions')
      .send({ fromStatus: 'To Do', toStatus: 'Done' })
    const layoutRes = await request(app).put('/api/projects/1/workflow-layout').send(body)

    // Editing a workflow and editing its layout are the same privilege.
    expect(transitionRes.status).toBe(403)
    expect(layoutRes.status).toBe(403)
  })
})

/* ── Unit: sanitizePositions ────────────────────────────────────────────── */

describe('sanitizePositions', () => {
  it('normalises a valid map', () => {
    expect(sanitizePositions({ A: { x: '40', y: 60.7 } })).toEqual({ positions: { A: { x: 40, y: 61 } } })
  })

  it('reports the offending key', () => {
    expect(sanitizePositions({ A: 5 }).error).toMatch(/"A"/)
    expect(sanitizePositions({ A: { x: Infinity, y: 0 } }).error).toMatch(/numeric/)
  })

  it('refuses arrays, strings and null', () => {
    expect(sanitizePositions([]).error).toBeTruthy()
    expect(sanitizePositions('x').error).toBeTruthy()
    expect(sanitizePositions(null).error).toBeTruthy()
  })
})
