// @vitest-environment node
// JL-286 — close project-role write/read gaps in backend routes.
//
// Several mutating endpoints were only workspace-gated (requireRole), so a
// workspace-Viewer who is a project Member was wrongly blocked, while a
// workspace-Member with no project access could write cross-project. This suite
// asserts the retrofitted requireProjectWrite / requireProjectRead guards on
// labels, custom-field values, comment reactions, import, and a sub-resource GET.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => {
  const run = vi.fn()
  const all = vi.fn()
  const get = vi.fn()
  return { run, all, get, columnExists: vi.fn(), tableExists: vi.fn() }
})

// Keep comments.js's transitive side-effecting services inert.
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, createNotification: vi.fn().mockResolvedValue(1) }
})
vi.mock('../services/automation.js', () => ({
  runStatusChangeAutomations: vi.fn().mockResolvedValue(undefined),
  runCommentAutomations: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/events.js', () => ({ emitEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/mentions.js', () => ({
  extractMentions: () => [],
  processMentions: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../services/realtime.js', () => ({ publish: vi.fn() }))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

// Workspace users. requireProjectWrite/Read fast-path only Admin/Owner; everyone
// else is resolved against project_members (the 'pm.role AS project_role' join).
const WS_VIEWER = { id: 40, email: 'viewer@test.com', memberId: 40, workspaceRole: 'Viewer', isOwner: false }
const WS_MEMBER = { id: 30, email: 'member@test.com', memberId: 30, workspaceRole: 'Member', isOwner: false }

// Access-join row shape produced by resolveProjectAccess's query.
const accessRow = (projectRole) => ({ id: 5, lead_member_id: 999, project_role: projectRole })

function createApp(routeModule, mountPath, user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = user; next() })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

let labelsMod, customFieldsMod, commentsMod, importExportMod, worklogsMod
beforeEach(async () => {
  vi.clearAllMocks()
  labelsMod = await import('../routes/labels.js')
  customFieldsMod = await import('../routes/customFields.js')
  commentsMod = await import('../routes/comments.js')
  importExportMod = await import('../routes/importExport.js')
  worklogsMod = await import('../routes/worklogs.js')
})

/* ============================================================
   Writes — project Viewer (effective rank 1) is denied;
   project Member (incl. a workspace Viewer holding it) passes.
   ============================================================ */
describe('JL-286 — labels write gating', () => {
  it('403 — PUT /issues/:id/labels for a project Viewer', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('project_id FROM issues')) return { project_id: 5 }
      if (sql.includes('pm.role AS project_role')) return accessRow('Viewer')
      return null
    })
    const app = createApp(labelsMod, '/api', WS_VIEWER)
    const res = await request(app).put('/api/issues/1/labels').send({ labelIds: [] })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('200 — PUT /issues/:id/labels for a workspace Viewer who is a project Member', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('project_id FROM issues')) return { project_id: 5 }
      if (sql.includes('pm.role AS project_role')) return accessRow('Member')
      return null
    })
    all.mockResolvedValue([])
    run.mockResolvedValue({ changes: 1 })
    const app = createApp(labelsMod, '/api', WS_VIEWER)
    const res = await request(app).put('/api/issues/1/labels').send({ labelIds: [] })
    expect(res.status).toBe(200)
  })

  it('403 — POST /projects/:id/labels (project route) for a project Viewer', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('pm.role AS project_role')) return accessRow('Viewer')
      return null
    })
    const app = createApp(labelsMod, '/api', WS_VIEWER)
    const res = await request(app).post('/api/projects/5/labels').send({ name: 'bug' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('JL-286 — custom-field value write gating', () => {
  it('403 — PUT /issues/:id/custom-fields/:fid for a project Viewer', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('project_id FROM issues')) return { project_id: 5 }
      if (sql.includes('pm.role AS project_role')) return accessRow('Viewer')
      return null
    })
    const app = createApp(customFieldsMod, '/api', WS_VIEWER)
    const res = await request(app).put('/api/issues/1/custom-fields/2').send({ value: 'x' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('200 — PUT /issues/:id/custom-fields/:fid for a project Member', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('project_id FROM issues')) return { project_id: 5 }
      if (sql.includes('pm.role AS project_role')) return accessRow('Member')
      if (sql.includes('FROM custom_fields')) return { id: 2, field_type: 'text', options: null, config: null }
      return null
    })
    run.mockResolvedValue({ lastID: 1 })
    const app = createApp(customFieldsMod, '/api', WS_MEMBER)
    const res = await request(app).put('/api/issues/1/custom-fields/2').send({ value: 'hello' })
    expect(res.status).toBe(200)
    expect(res.body.value).toBe('hello')
  })
})

describe('JL-286 — comment reaction write gating', () => {
  it('403 — POST /comments/:id/reactions for a project Viewer', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('JOIN issues i')) return { project_id: 5 }
      if (sql.includes('pm.role AS project_role')) return accessRow('Viewer')
      return null
    })
    const app = createApp(commentsMod, '/api/comments', WS_VIEWER)
    const res = await request(app).post('/api/comments/7/reactions').send({ emoji: '👍' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('200 — POST /comments/:id/reactions for a project Member', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('JOIN issues i')) return { project_id: 5 }
      if (sql.includes('pm.role AS project_role')) return accessRow('Member')
      if (sql.includes('SELECT id FROM comments')) return { id: 7 }
      if (sql.includes('FROM comment_reactions WHERE')) return null // no existing reaction
      return null
    })
    all.mockResolvedValue([]) // loadReactions summary
    run.mockResolvedValue({ changes: 1 })
    const app = createApp(commentsMod, '/api/comments', WS_MEMBER)
    const res = await request(app).post('/api/comments/7/reactions').send({ emoji: '👍' })
    expect(res.status).toBe(200)
    expect(res.body.commentId).toBe(7)
  })
})

describe('JL-286 — project import write gating', () => {
  it('403 — POST /projects/:id/import for a project Viewer', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('pm.role AS project_role')) return accessRow('Viewer')
      return null
    })
    const app = createApp(importExportMod, '/api', WS_VIEWER)
    const res = await request(app).post('/api/projects/5/import').send({ csv: 'title\nHi', dryRun: true })
    expect(res.status).toBe(403)
  })

  it('200 — POST /projects/:id/import (dry-run) for a project Member', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('pm.role AS project_role')) return accessRow('Member')
      if (sql.includes('FROM projects')) return { id: 5, key: 'TP' }
      return null
    })
    const app = createApp(importExportMod, '/api', WS_MEMBER)
    const res = await request(app)
      .post('/api/projects/5/import')
      .send({ csv: 'title\nHello', dryRun: true })
    expect(res.status).toBe(200)
    expect(res.body.dryRun).toBe(true)
  })
})

/* ============================================================
   Read — a sub-resource GET now requires project access.
   ============================================================ */
describe('JL-286 — sub-resource GET read gating (worklogs)', () => {
  it('403 — GET /issues/:id/worklogs for a workspace Member NOT in the project', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('project_id FROM issues')) return { project_id: 5 }
      if (sql.includes('pm.role AS project_role')) return accessRow(null) // no membership
      return null
    })
    const app = createApp(worklogsMod, '/api', WS_MEMBER)
    const res = await request(app).get('/api/issues/1/worklogs')
    expect(res.status).toBe(403)
    expect(all).not.toHaveBeenCalled()
  })

  it('200 — GET /issues/:id/worklogs for a project member', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('project_id FROM issues')) return { project_id: 5 }
      if (sql.includes('pm.role AS project_role')) return accessRow('Viewer')
      if (sql.includes('original_estimate_minutes')) return { original_estimate_minutes: null }
      if (sql.includes('SUM(time_spent_minutes)')) return { spent: 0 }
      return null
    })
    all.mockResolvedValue([])
    const app = createApp(worklogsMod, '/api', WS_MEMBER)
    const res = await request(app).get('/api/issues/1/worklogs')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('worklogs')
  })
})
