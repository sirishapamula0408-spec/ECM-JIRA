// @vitest-environment node
// JL-229: close Viewer mutation leaks — previously-ungated write routes
// (labels CRUD, issue-label assignment, comment reactions, sprint retros)
// now carry requireRole('Member'), so a workspace Viewer gets 403 while a
// Member (and above) is unaffected. Mocked-db style, modelled on
// label-edit-JL199.test.js / comment-reactions-JL139.test.js / sprint-retros-JL127.test.js.
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

// comments.js pulls in the notifications helper — stub it out.
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, createNotification: vi.fn().mockResolvedValue(1) }
})

// sprints.js (and comments.js) emit webhook events — stub the emitter.
vi.mock('../services/events.js', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}))

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'

function createApp(routeModule, mountPath, user) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { id: 1, email: 'test@test.com', memberId: 1, isOwner: false, ...user }
    next()
  })
  app.use(mountPath, routeModule.default || routeModule)
  app.use(errorHandler)
  return app
}

const asViewer = { workspaceRole: 'Viewer' }
const asMember = { workspaceRole: 'Member' }

// JL-383: labels + comment-reaction writes moved off the flat requireRole('Member')
// workspace gate onto requireProjectWrite() in JL-286. That guard is no longer a
// pure in-memory role comparison: for a non-Admin caller it resolves the target
// project and loads the caller's project role from the db before deciding. So
//   * a Viewer is still rejected, but the guard makes db reads on the way there;
//   * a Member now needs PROJECT access too — a workspace Member with no
//     project_members row is denied by design (the JL-224/225/226 model).
// This is the row resolveProjectAccess() expects: an existing project on which
// the caller holds a Member role.
const PROJECT_ACCESS_AS_MEMBER = { id: 1, lead_member_id: null, project_role: 'Member' }

// The `SELECT p.id, p.lead_member_id, ...` access lookup performed by
// resolveProjectAccess() in server/middleware/authorize.js.
const isProjectAccessLookup = (sql) => /FROM projects p/.test(sql)

beforeEach(() => {
  vi.clearAllMocks()
  // JL-383: clearAllMocks() does NOT drain a queued mockResolvedValueOnce chain.
  // With the guard now consuming db calls, any value a previous test left
  // unconsumed would be served to the next test's guard and silently change the
  // outcome. Reset the db mocks outright so every test starts from empty.
  run.mockReset()
  all.mockReset()
  get.mockReset()
})

/* ================================================================
   Labels — POST/PUT/DELETE /api/projects/:id/labels(+/:labelId)
   and PUT /api/issues/:id/labels
   ================================================================ */
describe('JL-229 — labels routes are gated at Member', () => {
  let labelsModule
  beforeEach(async () => {
    labelsModule = await import('../routes/labels.js')
  })

  it('Viewer gets 403 on label create (POST /projects/:id/labels)', async () => {
    const app = createApp(labelsModule, '/api', asViewer)
    const res = await request(app).post('/api/projects/1/labels').send({ name: 'ui' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/insufficient/i)
    expect(run).not.toHaveBeenCalled()
    // JL-383: `expect(get).not.toHaveBeenCalled()` here was asserting that the
    // gate rejected without touching the db — true of the JL-229 requireRole
    // gate, no longer true of the JL-286 requireProjectWrite one. Pin the
    // stronger property instead: the ONLY read is the guard's own access
    // lookup, so the handler body never ran.
    expect(get).toHaveBeenCalledTimes(1)
    expect(isProjectAccessLookup(get.mock.calls[0][0])).toBe(true)
  })

  it('Member can still create a label', async () => {
    const app = createApp(labelsModule, '/api', asMember)
    get
      .mockResolvedValueOnce(PROJECT_ACCESS_AS_MEMBER) // JL-286 write-guard access lookup
      .mockResolvedValueOnce(null) // no existing label with that name
      .mockResolvedValueOnce({ id: 7, project_id: 1, name: 'ui', color: '#42526E' })
    run.mockResolvedValue({ lastID: 7, changes: 1 })

    const res = await request(app).post('/api/projects/1/labels').send({ name: 'ui' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('ui')
  })

  it('Viewer gets 403 on label update (PUT /projects/:id/labels/:labelId)', async () => {
    const app = createApp(labelsModule, '/api', asViewer)
    const res = await request(app).put('/api/projects/1/labels/5').send({ name: 'renamed' })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('Member can still rename a label', async () => {
    const app = createApp(labelsModule, '/api', asMember)
    get
      .mockResolvedValueOnce(PROJECT_ACCESS_AS_MEMBER) // JL-286 write-guard access lookup
      .mockResolvedValueOnce({ id: 5, project_id: 1, name: 'frontend', color: '#0052CC' })
      .mockResolvedValueOnce(null) // no duplicate-name clash
      .mockResolvedValueOnce({ id: 5, project_id: 1, name: 'ui', color: '#0052CC', issueCount: 2 })
    run.mockResolvedValue({ changes: 1 })

    const res = await request(app).put('/api/projects/1/labels/5').send({ name: 'ui' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('ui')
  })

  it('Viewer gets 403 on label delete (DELETE /projects/:id/labels/:labelId)', async () => {
    const app = createApp(labelsModule, '/api', asViewer)
    const res = await request(app).delete('/api/projects/1/labels/5')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('Member can still delete a label', async () => {
    const app = createApp(labelsModule, '/api', asMember)
    get.mockResolvedValueOnce(PROJECT_ACCESS_AS_MEMBER) // JL-286 write-guard access lookup
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/projects/1/labels/5')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('Viewer gets 403 assigning labels to an issue (PUT /issues/:id/labels)', async () => {
    const app = createApp(labelsModule, '/api', asViewer)
    const res = await request(app).put('/api/issues/9/labels').send({ labelIds: [1, 2] })
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('Member can still assign labels to an issue', async () => {
    const app = createApp(labelsModule, '/api', asMember)
    run.mockResolvedValue({ changes: 1 })
    all.mockResolvedValue([{ id: 1, project_id: 1, name: 'ui', color: '#0052CC' }])
    const res = await request(app).put('/api/issues/9/labels').send({ labelIds: [1] })
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('Viewer can still LIST labels (read stays open)', async () => {
    const app = createApp(labelsModule, '/api', asViewer)
    all.mockResolvedValue([])
    const res = await request(app).get('/api/projects/1/labels')
    expect(res.status).toBe(200)
  })
})

/* ================================================================
   Comment reactions — POST /api/comments/:id/reactions
   ================================================================ */
describe('JL-229 — comment reactions are gated at Member', () => {
  let commentsModule
  beforeEach(async () => {
    commentsModule = await import('../routes/comments.js')
  })

  it('Viewer gets 403 toggling a reaction', async () => {
    const app = createApp(commentsModule, '/api/comments', asViewer)
    const res = await request(app).post('/api/comments/5/reactions').send({ emoji: '👍' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/insufficient/i)
    expect(run).not.toHaveBeenCalled()
    // JL-383: as above — the JL-286 guard reads before it rejects. Here the only
    // read is reactionCommentProject()'s comment → issue → project resolution;
    // it finds nothing, so the guard falls back to the workspace gate and never
    // reaches the handler.
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0][0]).toMatch(/FROM comments c JOIN issues i/)
  })

  it('Member can still toggle a reaction', async () => {
    const app = createApp(commentsModule, '/api/comments', asMember)
    get
      // JL-286 write guard: resolve the comment's project, then the caller's access to it.
      .mockResolvedValueOnce({ project_id: 1 })
      .mockResolvedValueOnce(PROJECT_ACCESS_AS_MEMBER)
      .mockResolvedValueOnce({ id: 5 }) // comment exists
      .mockResolvedValueOnce(null) // no existing reaction
    run.mockResolvedValue({ lastID: 1, changes: 1 })
    all.mockResolvedValue([{ comment_id: 5, emoji: '👍', count: '1', mine: '1' }])

    const res = await request(app).post('/api/comments/5/reactions').send({ emoji: '👍' })
    expect(res.status).toBe(200)
    expect(res.body.reactions).toEqual([{ emoji: '👍', count: 1, reactedByMe: true }])
  })
})

/* ================================================================
   Sprint retros — POST /:id/retros and DELETE /:sprintId/retros/:retroId
   ================================================================ */
describe('JL-229 — sprint retro writes are gated at Member', () => {
  let sprintsModule
  beforeEach(async () => {
    sprintsModule = await import('../routes/sprints.js')
  })

  it('Viewer gets 403 adding a retro note', async () => {
    const app = createApp(sprintsModule, '/api/sprints', asViewer)
    const res = await request(app).post('/api/sprints/3/retros').send({ category: 'well', text: 'good pace' })
    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/insufficient/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('Member can still add a retro note', async () => {
    const app = createApp(sprintsModule, '/api/sprints', asMember)
    get
      .mockResolvedValueOnce({ id: 3 }) // sprint exists
      .mockResolvedValueOnce({ id: 9, sprint_id: 3, category: 'well', text: 'good pace', author: 'test@test.com', created_at: 't' })
    run.mockResolvedValue({ lastID: 9, changes: 1 })

    const res = await request(app).post('/api/sprints/3/retros').send({ category: 'well', text: 'good pace' })
    expect(res.status).toBe(201)
    expect(res.body.text).toBe('good pace')
  })

  it('Viewer gets 403 deleting a retro note', async () => {
    const app = createApp(sprintsModule, '/api/sprints', asViewer)
    const res = await request(app).delete('/api/sprints/3/retros/9')
    expect(res.status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })

  it('Member can still delete a retro note', async () => {
    const app = createApp(sprintsModule, '/api/sprints', asMember)
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/sprints/3/retros/9')
    expect(res.status).toBe(200)
    expect(res.body.deleted).toBe(9)
  })

  it('Viewer can still READ retro notes (GET stays open)', async () => {
    const app = createApp(sprintsModule, '/api/sprints', asViewer)
    all.mockResolvedValue([])
    const res = await request(app).get('/api/sprints/3/retros')
    expect(res.status).toBe(200)
  })
})
