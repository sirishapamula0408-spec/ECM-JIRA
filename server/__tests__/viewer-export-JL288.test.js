// @vitest-environment node
// JL-288 — RBAC: project Viewers may export issue data (a READ operation).
//
// Export (GET /api/projects/:id/export) is gated on project READ, so a project
// Viewer passes; Import (POST /api/projects/:id/import) stays a project WRITE and
// remains denied for a Viewer. This locks in the backend contract behind the
// frontend canExportIssues capability.
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

// requireProjectWrite/Read fast-path Admin/Owner; everyone else resolves against
// project_members via the 'pm.role AS project_role' join.
const WS_VIEWER = { id: 40, email: 'viewer@test.com', memberId: 40, workspaceRole: 'Viewer', isOwner: false }
const accessRow = (projectRole) => ({ id: 5, lead_member_id: 999, project_role: projectRole })

function createApp(routeModule, user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use('/api', routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let importExportMod
beforeEach(async () => {
  vi.clearAllMocks()
  importExportMod = await import('../routes/importExport.js')
})

describe('JL-288 — Viewer export/import gating', () => {
  it('200 — GET /projects/:id/export (CSV) for a project Viewer', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('pm.role AS project_role')) return accessRow('Viewer')
      if (sql.includes('FROM projects')) return { id: 5, key: 'TP', name: 'Test Project' }
      return null
    })
    all.mockResolvedValue([
      { issue_key: 'TP-1', title: 'A', description: '', priority: 'Medium', assignee: 'x', status: 'To Do', issue_type: 'Task', sprint_id: null },
    ])
    const app = createApp(importExportMod, WS_VIEWER)
    const res = await request(app).get('/api/projects/5/export?format=csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.text).toContain('TP-1')
  })

  it('200 — GET /projects/:id/export (JSON) for a project Viewer', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('pm.role AS project_role')) return accessRow('Viewer')
      if (sql.includes('FROM projects')) return { id: 5, key: 'TP', name: 'Test Project' }
      return null
    })
    all.mockResolvedValue([])
    const app = createApp(importExportMod, WS_VIEWER)
    const res = await request(app).get('/api/projects/5/export?format=json')
    expect(res.status).toBe(200)
    expect(res.body.project.key).toBe('TP')
    expect(Array.isArray(res.body.issues)).toBe(true)
  })

  it('403 — POST /projects/:id/import for a project Viewer (import stays a write)', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('pm.role AS project_role')) return accessRow('Viewer')
      return null
    })
    const app = createApp(importExportMod, WS_VIEWER)
    const res = await request(app).post('/api/projects/5/import').send({ csv: 'title\nHi', dryRun: true })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})
