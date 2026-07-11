// @vitest-environment node
// Backend route tests run in the node environment so node: builtins (used by
// attachments.js: node:url/fs/path) resolve natively instead of being
// browser-externalized by the default jsdom environment.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mock the db module — no real database is touched.
vi.mock('../db.js', () => ({
  run: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
  columnExists: vi.fn(),
  tableExists: vi.fn(),
}))

// Mock notifications helper (imported transitively by automation.js / issues.js)
vi.mock('../routes/notifications.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    createNotification: vi.fn().mockResolvedValue(1),
  }
})

import { run, all, get } from '../db.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { parseTimeToMinutes, formatMinutes } from '../routes/worklogs.js'

// Helper: create an app that stubs auth as a workspace Admin (passes requireRole).
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

/* ================================================================
   JL-31: Sub-tasks + JL-39: Bulk delete (issues.js)
   ================================================================ */
describe('Sub-tasks & Bulk delete (issues.js)', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/issues.js')
    app = createApp(mod)
  })

  describe('POST /api/:parentId/subtasks', () => {
    it('creates a sub-task under a parent (happy path)', async () => {
      get.mockImplementation(async (sql) => {
        if (sql.includes('parent_id FROM issues')) return { id: 1, assignee: 'Alice', status: 'To Do', sprint_id: 3, project_id: 7, parent_id: null }
        if (sql.includes('key FROM projects')) return { key: 'TP' }
        if (sql.includes('COUNT(*)')) return { count: '4' }
        // final re-read of the created row
        return { id: 99, issue_key: 'TP-5', title: 'Child', description: '', priority: 'Medium', assignee: 'Alice', status: 'To Do', issue_type: 'Sub-task', sprint_id: 3, project_id: 7, parent_id: 1 }
      })
      run.mockResolvedValue({ lastID: 99 })

      const res = await request(app).post('/api/1/subtasks').send({ title: 'Child' })
      expect(res.status).toBe(201)
      expect(res.body.issueType).toBe('Sub-task')
      expect(res.body.parentId).toBe(1)
    })

    it('rejects nesting a sub-task under another sub-task (400)', async () => {
      get.mockResolvedValue({ id: 2, assignee: 'Bob', status: 'To Do', sprint_id: null, project_id: 7, parent_id: 1 })

      const res = await request(app).post('/api/2/subtasks').send({ title: 'Nested' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/sub-task/i)
    })

    it('returns 404 when the parent issue does not exist', async () => {
      get.mockResolvedValue(null)
      const res = await request(app).post('/api/999/subtasks').send({ title: 'Orphan' })
      expect(res.status).toBe(404)
    })

    it('rejects a sub-task with no title (400)', async () => {
      get.mockResolvedValue({ id: 1, assignee: 'A', status: 'To Do', sprint_id: 3, project_id: 7, parent_id: null })
      const res = await request(app).post('/api/1/subtasks').send({})
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/:parentId/subtasks', () => {
    it('returns sub-tasks with a progress summary', async () => {
      all.mockResolvedValue([
        { id: 10, issue_key: 'TP-10', title: 'A', status: 'Done', issue_type: 'Sub-task', parent_id: 1 },
        { id: 11, issue_key: 'TP-11', title: 'B', status: 'To Do', issue_type: 'Sub-task', parent_id: 1 },
      ])
      const res = await request(app).get('/api/1/subtasks')
      expect(res.status).toBe(200)
      expect(res.body.subtasks).toHaveLength(2)
      expect(res.body.progress).toEqual({ total: 2, done: 1, percent: 50 })
    })
  })

  describe('PATCH /api/:id/status — closing a parent with open sub-tasks', () => {
    it('rejects closing (Done) a parent that has open sub-tasks (409)', async () => {
      get.mockResolvedValue({ id: 1, sprint_id: 3 })
      all.mockResolvedValue([{ id: 11, issue_key: 'TP-11', title: 'B', status: 'To Do' }])

      const res = await request(app).patch('/api/1/status').send({ status: 'Done' })
      expect(res.status).toBe(409)
      expect(res.body.error).toMatch(/open sub-tasks/i)
      expect(res.body.openSubtasks).toHaveLength(1)
    })
  })

  describe('DELETE /api/:id — bulk/single delete', () => {
    it('deletes an issue and cascades dependents (happy path)', async () => {
      get.mockResolvedValue({ id: 5, issue_key: 'TP-5' })
      run.mockResolvedValue({ changes: 1 })

      const res = await request(app).delete('/api/5')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.id).toBe(5)
      // the single DELETE relies on ON DELETE CASCADE FKs
      expect(run).toHaveBeenCalledWith('DELETE FROM issues WHERE id = ?', [5])
    })

    it('returns 404 when deleting a non-existent issue', async () => {
      get.mockResolvedValue(null)
      const res = await request(app).delete('/api/999')
      expect(res.status).toBe(404)
    })
  })
})

/* ================================================================
   JL-32: Labels / Tags (labels.js)
   ================================================================ */
describe('Labels API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/labels.js')
    app = createApp(mod)
  })

  it('GET /api/projects/:id/labels returns labels with issue counts', async () => {
    all.mockResolvedValue([{ id: 1, project_id: 1, name: 'bug', color: '#FF5630', issueCount: 3 }])
    const res = await request(app).get('/api/projects/1/labels')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].issueCount).toBe(3)
  })

  it('POST /api/projects/:id/labels creates a label (happy path)', async () => {
    get.mockResolvedValue(null) // no existing label
    run.mockResolvedValue({ lastID: 5 })
    get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 5, project_id: 1, name: 'frontend', color: '#0052CC' })

    const res = await request(app).post('/api/projects/1/labels').send({ name: 'frontend', color: '#0052CC' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('frontend')
    expect(res.body.issueCount).toBe(0)
  })

  it('POST returns existing label (200 + existed) on duplicate name', async () => {
    get.mockResolvedValue({ id: 1, name: 'bug', color: '#FF5630' })
    const res = await request(app).post('/api/projects/1/labels').send({ name: 'bug' })
    expect(res.status).toBe(200)
    expect(res.body.existed).toBe(true)
  })

  it('POST rejects an empty label name (400)', async () => {
    const res = await request(app).post('/api/projects/1/labels').send({ name: '' })
    expect(res.status).toBe(400)
  })

  it('POST rejects an invalid hex color (400)', async () => {
    const res = await request(app).post('/api/projects/1/labels').send({ name: 'x', color: 'red' })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/projects/:id/labels/:labelId removes a label', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/projects/1/labels/2')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('PUT /api/issues/:id/labels replaces the issue label set', async () => {
    run.mockResolvedValue({ changes: 1 })
    all.mockResolvedValue([{ id: 1, project_id: 1, name: 'bug', color: '#FF5630' }])
    const res = await request(app).put('/api/issues/1/labels').send({ labelIds: [1, 2] })
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    // first run() call clears existing labels
    expect(run).toHaveBeenCalledWith('DELETE FROM issue_labels WHERE issue_id = ?', [1])
  })
})

/* ================================================================
   JL-33: Attachments (attachments.js) — list + delete + validation
   ================================================================ */
describe('Attachments API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/attachments.js')
    app = createApp(mod)
  })

  it('GET /api/issues/:id/attachments lists attachment metadata', async () => {
    all.mockResolvedValue([
      { id: 1, issue_id: 1, filename: 'a.png', mime_type: 'image/png', size_bytes: 100, uploaded_by: 'test@test.com', created_at: 'now' },
    ])
    const res = await request(app).get('/api/issues/1/attachments')
    expect(res.status).toBe(200)
    expect(res.body[0].isImage).toBe(true)
    expect(res.body[0].filename).toBe('a.png')
  })

  it('DELETE /api/attachments/:id removes the row (file I/O best-effort)', async () => {
    get.mockResolvedValue({ id: 1, storage_path: 'nope-does-not-exist.bin' })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/attachments/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.id).toBe(1)
  })

  it('DELETE returns 404 for a missing attachment', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).delete('/api/attachments/999')
    expect(res.status).toBe(404)
  })

  it('POST upload rejects missing filename/dataBase64 (400) without writing to disk', async () => {
    // Issue exists, but body lacks filename & data → validation 400 before any file write.
    get.mockResolvedValue({ id: 1 })
    const res = await request(app).post('/api/issues/1/attachments').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/filename and dataBase64/i)
  })

  it('POST upload returns 404 when the issue does not exist', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).post('/api/issues/999/attachments').send({ filename: 'a.txt', dataBase64: 'aGk=' })
    expect(res.status).toBe(404)
  })
})

/* ================================================================
   JL-34: Issue Linking (issueLinks.js)
   ================================================================ */
describe('Issue Links API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/issueLinks.js')
    app = createApp(mod)
  })

  it('POST /api/issues/:id/links creates a directed link (happy path)', async () => {
    get
      .mockResolvedValueOnce({ id: 2 }) // target exists
      .mockResolvedValueOnce(null)      // no existing duplicate
    run.mockResolvedValue({ lastID: 10 })

    const res = await request(app).post('/api/issues/1/links').send({ type: 'blocks', targetIssueId: 2 })
    expect(res.status).toBe(201)
    expect(res.body.type).toBe('blocks')
    expect(res.body.targetIssueId).toBe(2)
  })

  it('GET /api/issues/:id/links returns links from the issue perspective (inverse-aware)', async () => {
    all.mockResolvedValue([
      // incoming link: source=2 blocks target=1 → from issue 1's view this is "is blocked by"
      {
        id: 5, link_type: 'blocks', source_issue_id: 2, target_issue_id: 1,
        source_id: 2, source_key: 'TP-2', source_title: 'Blocker', source_status: 'To Do', source_type: 'Bug',
        target_id: 1, target_key: 'TP-1', target_title: 'Me', target_status: 'To Do', target_type: 'Task',
      },
    ])
    const res = await request(app).get('/api/issues/1/links')
    expect(res.status).toBe(200)
    expect(res.body[0].type).toBe('is blocked by')
    expect(res.body[0].issue.key).toBe('TP-2')
  })

  it('POST rejects a self-link (400)', async () => {
    const res = await request(app).post('/api/issues/1/links').send({ type: 'blocks', targetIssueId: 1 })
    expect(res.status).toBe(400)
  })

  it('POST rejects an unknown link type (400)', async () => {
    const res = await request(app).post('/api/issues/1/links').send({ type: 'wat', targetIssueId: 2 })
    expect(res.status).toBe(400)
  })

  it('POST guards against a duplicate link (409)', async () => {
    get
      .mockResolvedValueOnce({ id: 2 }) // target exists
      .mockResolvedValueOnce({ id: 7 }) // existing link found
    const res = await request(app).post('/api/issues/1/links').send({ type: 'blocks', targetIssueId: 2 })
    expect(res.status).toBe(409)
  })

  it('DELETE /api/links/:id removes a link', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/links/5')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

/* ================================================================
   JL-35: Time Tracking (worklogs.js)
   ================================================================ */
describe('Time Tracking — parseTimeToMinutes helper', () => {
  it('parses "1d 4h" as 8h + 4h = 720 minutes', () => {
    expect(parseTimeToMinutes('1d 4h')).toBe(720)
  })
  it('parses "45m" as 45 minutes', () => {
    expect(parseTimeToMinutes('45m')).toBe(45)
  })
  it('parses "2h 30m" as 150 minutes', () => {
    expect(parseTimeToMinutes('2h 30m')).toBe(150)
  })
  it('treats a bare number as minutes', () => {
    expect(parseTimeToMinutes('90')).toBe(90)
  })
  it('returns null for empty / invalid input', () => {
    expect(parseTimeToMinutes('')).toBeNull()
    expect(parseTimeToMinutes('abc')).toBeNull()
    expect(parseTimeToMinutes(null)).toBeNull()
  })
  it('formatMinutes round-trips to a human string', () => {
    expect(formatMinutes(720)).toBe('1d 4h')
    expect(formatMinutes(45)).toBe('45m')
  })
})

describe('Worklogs API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/worklogs.js')
    app = createApp(mod)
  })

  // buildSummary issues two gets: estimate row + summed spent row.
  function summaryGets(estimate = 480, spent = 120) {
    return async (sql) => {
      if (sql.includes('original_estimate_minutes')) return { original_estimate_minutes: estimate }
      if (sql.includes('SUM(time_spent_minutes)')) return { spent }
      return { id: 1 } // issue existence check
    }
  }

  it('GET /api/issues/:id/worklogs returns worklogs + summary', async () => {
    all.mockResolvedValue([{ id: 1, issue_id: 1, author: 'test@test.com', time_spent_minutes: 120, description: 'work', created_at: 'now' }])
    get.mockImplementation(summaryGets(480, 120))
    const res = await request(app).get('/api/issues/1/worklogs')
    expect(res.status).toBe(200)
    expect(res.body.worklogs).toHaveLength(1)
    expect(res.body.summary.estimateMinutes).toBe(480)
    expect(res.body.summary.spentMinutes).toBe(120)
    expect(res.body.summary.remainingMinutes).toBe(360)
  })

  it('POST /api/issues/:id/worklogs logs time and returns summary', async () => {
    get.mockImplementation(summaryGets(480, 150))
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(app).post('/api/issues/1/worklogs').send({ timeSpent: '2h 30m', description: 'dev' })
    expect(res.status).toBe(201)
    expect(res.body.spentMinutes).toBe(150)
    expect(run).toHaveBeenCalled()
  })

  it('POST rejects invalid timeSpent (400)', async () => {
    get.mockResolvedValue({ id: 1 }) // issue exists
    const res = await request(app).post('/api/issues/1/worklogs').send({ timeSpent: 'garbage' })
    expect(res.status).toBe(400)
  })

  it('POST returns 404 for a missing issue', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).post('/api/issues/999/worklogs').send({ timeSpent: '1h' })
    expect(res.status).toBe(404)
  })

  it('PUT /api/issues/:id/estimate sets the original estimate', async () => {
    get.mockImplementation(summaryGets(240, 0))
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).put('/api/issues/1/estimate').send({ estimate: '4h' })
    expect(res.status).toBe(200)
    expect(res.body.estimateMinutes).toBe(240)
    expect(run).toHaveBeenCalledWith('UPDATE issues SET original_estimate_minutes = ? WHERE id = ?', [240, 1])
  })

  it('PUT estimate rejects an invalid value (400)', async () => {
    get.mockResolvedValue({ id: 1 })
    const res = await request(app).put('/api/issues/1/estimate').send({ estimate: 'nope' })
    expect(res.status).toBe(400)
  })
})

/* ================================================================
   JL-37: Custom Fields (customFields.js)
   ================================================================ */
describe('Custom Fields API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/customFields.js')
    app = createApp(mod)
  })

  it('GET /api/projects/:id/custom-fields lists definitions', async () => {
    all.mockResolvedValue([{ id: 1, project_id: 1, name: 'Severity', field_type: 'dropdown', options: ['Low', 'High'] }])
    const res = await request(app).get('/api/projects/1/custom-fields')
    expect(res.status).toBe(200)
    expect(res.body[0].fieldType).toBe('dropdown')
    expect(res.body[0].options).toEqual(['Low', 'High'])
  })

  it('POST creates a text field definition (happy path)', async () => {
    run.mockResolvedValue({ lastID: 3 })
    get.mockResolvedValue({ id: 3, project_id: 1, name: 'Team', field_type: 'text', options: [] })
    const res = await request(app).post('/api/projects/1/custom-fields').send({ name: 'Team', fieldType: 'text' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Team')
  })

  it('POST rejects an invalid fieldType (400)', async () => {
    const res = await request(app).post('/api/projects/1/custom-fields').send({ name: 'X', fieldType: 'bogus' })
    expect(res.status).toBe(400)
  })

  it('POST rejects a dropdown with no options (400)', async () => {
    const res = await request(app).post('/api/projects/1/custom-fields').send({ name: 'Sev', fieldType: 'dropdown', options: [] })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/custom-fields/:id removes a definition', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/custom-fields/3')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('GET /api/issues/:id/custom-fields returns each field + its value', async () => {
    get.mockResolvedValue({ project_id: 1 })
    all.mockResolvedValue([{ id: 1, project_id: 1, name: 'Team', field_type: 'text', options: [], field_value: 'Core' }])
    const res = await request(app).get('/api/issues/1/custom-fields')
    expect(res.status).toBe(200)
    expect(res.body[0].value).toBe('Core')
  })

  it('PUT /api/issues/:id/custom-fields/:fieldId sets a value', async () => {
    get.mockResolvedValue({ id: 1 }) // field exists
    run.mockResolvedValue({ lastID: 1 })
    const res = await request(app).put('/api/issues/1/custom-fields/1').send({ value: 'Platform' })
    expect(res.status).toBe(200)
    expect(res.body.value).toBe('Platform')
  })

  it('PUT returns 404 for an unknown field', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).put('/api/issues/1/custom-fields/999').send({ value: 'x' })
    expect(res.status).toBe(404)
  })
})

/* ================================================================
   JL-38: Automation Rules (automation.js routes)
   ================================================================ */
describe('Automation API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/automation.js')
    app = createApp(mod)
  })

  it('GET /api/projects/:id/automation-rules lists rules', async () => {
    all.mockResolvedValue([{ id: 1, project_id: 1, name: 'Auto assign', trigger_type: 'status_changed', action_type: 'assign', action_value: 'bob@x.com', enabled: true }])
    const res = await request(app).get('/api/projects/1/automation-rules')
    expect(res.status).toBe(200)
    expect(res.body[0].triggerType).toBe('status_changed')
  })

  it('POST creates an automation rule (happy path)', async () => {
    run.mockResolvedValue({ lastID: 2 })
    get.mockResolvedValue({ id: 2, project_id: 1, name: 'Notify', trigger_type: 'comment_added', action_type: 'notify', action_value: '', enabled: true })
    const res = await request(app).post('/api/projects/1/automation-rules').send({
      name: 'Notify', triggerType: 'comment_added', actionType: 'notify',
    })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Notify')
  })

  it('POST rejects an invalid triggerType (400)', async () => {
    const res = await request(app).post('/api/projects/1/automation-rules').send({
      name: 'X', triggerType: 'bogus', actionType: 'notify',
    })
    expect(res.status).toBe(400)
  })

  it('POST rejects assign/transition/comment without an actionValue (400)', async () => {
    const res = await request(app).post('/api/projects/1/automation-rules').send({
      name: 'X', triggerType: 'status_changed', actionType: 'assign', actionValue: '',
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/automation-rules/:id toggles enabled', async () => {
    get
      .mockResolvedValueOnce({ id: 1, project_id: 1, name: 'R', trigger_type: 'status_changed', action_type: 'notify', action_value: '', enabled: true })
      .mockResolvedValueOnce({ id: 1, project_id: 1, name: 'R', trigger_type: 'status_changed', action_type: 'notify', action_value: '', enabled: false })
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).patch('/api/automation-rules/1').send({ enabled: false })
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
  })

  it('PATCH returns 404 for a missing rule', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).patch('/api/automation-rules/999').send({ enabled: false })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/automation-rules/:id removes a rule', async () => {
    run.mockResolvedValue({ changes: 1 })
    const res = await request(app).delete('/api/automation-rules/1')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('GET /api/projects/:id/automation-logs lists execution logs', async () => {
    all.mockResolvedValue([{ id: 1, rule_id: 1, issue_id: 5, status: 'success', message: 'Assigned', created_at: 'now', rule_name: 'Auto assign' }])
    const res = await request(app).get('/api/projects/1/automation-logs')
    expect(res.status).toBe(200)
    expect(res.body[0].rule_name).toBe('Auto assign')
  })
})

/* ================================================================
   JL-40: Import / Export (importExport.js)
   ================================================================ */
describe('Import / Export API', () => {
  let app
  beforeEach(async () => {
    const mod = await import('../routes/importExport.js')
    app = createApp(mod)
  })

  it('GET /api/projects/:id/export?format=csv returns CSV text', async () => {
    get.mockResolvedValue({ id: 1, key: 'TP', name: 'Test Project' })
    all.mockResolvedValue([
      { issue_key: 'TP-1', title: 'First', description: '', priority: 'High', assignee: 'a@x.com', status: 'To Do', issue_type: 'Task', sprint_id: null },
    ])
    const res = await request(app).get('/api/projects/1/export?format=csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.text).toContain('issue_key,title')
    expect(res.text).toContain('TP-1')
  })

  it('GET export?format=json returns structured JSON', async () => {
    get.mockResolvedValue({ id: 1, key: 'TP', name: 'Test Project' })
    all.mockResolvedValue([{ issue_key: 'TP-1', title: 'First', description: '', priority: 'High', assignee: 'a@x.com', status: 'To Do', issue_type: 'Task', sprint_id: null }])
    const res = await request(app).get('/api/projects/1/export?format=json')
    expect(res.status).toBe(200)
    expect(res.body.project.key).toBe('TP')
    expect(res.body.issues).toHaveLength(1)
  })

  it('GET export returns 404 for an unknown project', async () => {
    get.mockResolvedValue(null)
    const res = await request(app).get('/api/projects/999/export')
    expect(res.status).toBe(404)
  })

  it('POST import (dry-run) previews valid + invalid rows', async () => {
    get.mockResolvedValue({ id: 1, key: 'TP' })
    const csv = 'title,priority,status,issue_type\nGood row,High,To Do,Task\n,Low,To Do,Task'
    const res = await request(app).post('/api/projects/1/import').send({ csv, dryRun: true })
    expect(res.status).toBe(200)
    expect(res.body.dryRun).toBe(true)
    expect(res.body.valid).toBe(1)
    expect(res.body.invalid).toBe(1) // second row missing title
    expect(res.body.preview).toHaveLength(1)
  })

  it('POST import commits and creates issues with sequential keys', async () => {
    get.mockImplementation(async (sql) => {
      if (sql.includes('FROM projects')) return { id: 1, key: 'TP' }
      if (sql.includes('COUNT(*)')) return { count: '2' }
      return null
    })
    run.mockResolvedValue({ lastID: 10 })
    const csv = 'title,priority,status,issue_type\nNew A,High,To Do,Task'
    const res = await request(app).post('/api/projects/1/import').send({ csv, dryRun: false })
    expect(res.status).toBe(201)
    expect(res.body.created).toBe(1)
    expect(res.body.keys[0].issue_key).toBe('TP-3')
  })

  it('POST import rejects empty csv content (400)', async () => {
    get.mockResolvedValue({ id: 1, key: 'TP' })
    const res = await request(app).post('/api/projects/1/import').send({ csv: '' })
    expect(res.status).toBe(400)
  })
})
