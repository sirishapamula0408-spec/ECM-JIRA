// @vitest-environment node
// JL-199: label edit (rename/recolor) — PUT /api/projects/:id/labels/:labelId.
// Mocked-db style, modelled on theme1-core-pm-JL27.test.js.
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

function createApp(routeModule, mountPath = '/api') {
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

describe('Label edit API (JL-199) — PUT /api/projects/:id/labels/:labelId', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/labels.js')
    app = createApp(mod)
  })

  it('renames a label (happy path)', async () => {
    get
      .mockResolvedValueOnce({ id: 5, project_id: 1, name: 'frontend', color: '#0052CC' }) // ownership lookup
      .mockResolvedValueOnce(null) // duplicate-name check → no clash
      .mockResolvedValueOnce({ id: 5, project_id: 1, name: 'ui', color: '#0052CC', issueCount: 2 }) // final row
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).put('/api/projects/1/labels/5').send({ name: 'ui' })

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('ui')
    expect(res.body.color).toBe('#0052CC')
    expect(run).toHaveBeenCalledWith(
      'UPDATE labels SET name = ?, color = ? WHERE id = ? AND project_id = ?',
      ['ui', '#0052CC', 5, 1],
    )
  })

  it('recolors a label (happy path)', async () => {
    get
      .mockResolvedValueOnce({ id: 5, project_id: 1, name: 'frontend', color: '#0052CC' }) // ownership lookup
      .mockResolvedValueOnce({ id: 5, project_id: 1, name: 'frontend', color: '#FF5630', issueCount: 0 }) // final row
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).put('/api/projects/1/labels/5').send({ color: '#FF5630' })

    expect(res.status).toBe(200)
    expect(res.body.color).toBe('#FF5630')
    // color-only update keeps the existing name and skips the duplicate-name check
    expect(run).toHaveBeenCalledWith(
      'UPDATE labels SET name = ?, color = ? WHERE id = ? AND project_id = ?',
      ['frontend', '#FF5630', 5, 1],
    )
  })

  it('rejects a duplicate name within the project (409)', async () => {
    get
      .mockResolvedValueOnce({ id: 5, project_id: 1, name: 'frontend', color: '#0052CC' }) // ownership lookup
      .mockResolvedValueOnce({ id: 9 }) // duplicate-name check → clash
    const res = await request(app).put('/api/projects/1/labels/5').send({ name: 'backend' })

    expect(res.status).toBe(409)
    expect(run).not.toHaveBeenCalled()
  })

  it('returns 404 when the label does not belong to the project', async () => {
    get.mockResolvedValueOnce(null) // ownership lookup fails
    const res = await request(app).put('/api/projects/1/labels/999').send({ name: 'x' })

    expect(res.status).toBe(404)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an empty name (400)', async () => {
    get.mockResolvedValueOnce({ id: 5, project_id: 1, name: 'frontend', color: '#0052CC' })
    const res = await request(app).put('/api/projects/1/labels/5').send({ name: '   ' })

    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects an invalid hex color (400)', async () => {
    get.mockResolvedValueOnce({ id: 5, project_id: 1, name: 'frontend', color: '#0052CC' })
    const res = await request(app).put('/api/projects/1/labels/5').send({ color: 'red' })

    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a request with neither name nor color (400)', async () => {
    get.mockResolvedValueOnce({ id: 5, project_id: 1, name: 'frontend', color: '#0052CC' })
    const res = await request(app).put('/api/projects/1/labels/5').send({})

    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})
