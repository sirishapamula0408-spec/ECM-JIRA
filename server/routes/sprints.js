import { Router } from 'express'
import { get, run, all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { emitEvent } from '../services/events.js'
import { maxLengthError, SPRINT_NAME_MAX, SPRINT_GOAL_MAX } from '../utils/validation.js'

const router = Router()

// JL-124: project-scoped sprint endpoints (mounted at /api → /api/projects/:id/...).
// Sprints are global in this schema, so these read the *governing project's*
// parallel-sprints setting and expose all currently-active sprints.
export const projectSprintRouter = Router()

/**
 * JL-124 — Pure, unit-testable guard for whether a sprint may be started.
 * A project's first sprint can always start; a second concurrent active sprint
 * is only allowed when the project has opted into parallel sprints.
 *
 * @param {{ activeCount: number, allowParallel: boolean }} params
 *   activeCount = number of OTHER sprints already in the started/active state.
 * @returns {boolean}
 */
export function canStartSprint({ activeCount, allowParallel } = {}) {
  const count = Number(activeCount)
  const active = Number.isFinite(count) && count > 0 ? count : 0
  if (allowParallel) return true
  return active < 1
}

function mapSprint(row) {
  return {
    id: row.id,
    name: row.name,
    dateRange: row.date_range,
    isStarted: Boolean(row.is_started),
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    completedAt: row.completed_at ?? null,
    goal: row.goal ?? null,
  }
}

const RETRO_CATEGORIES = ['well', 'improve', 'action']

function mapRetro(row) {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    category: row.category,
    text: row.text,
    author: row.author ?? '',
    createdAt: row.created_at ?? null,
  }
}

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all('SELECT id, name, date_range, is_started, start_date, end_date, completed_at, goal FROM sprints ORDER BY id ASC')
  res.json(rows.map(mapSprint))
}))

router.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, dateRange, goal } = req.body || {}

  const count = await get('SELECT COUNT(*) AS count FROM sprints')
  const fallbackName = `SCRUM Sprint ${count.count + 1}`
  const nextName = String(name || '').trim() || fallbackName
  const nextDateRange = String(dateRange || '').trim() || 'Upcoming'
  const nextGoal = goal == null ? null : String(goal).trim() || null

  // JL-204: server-side length caps (checked after trim)
  const lengthErr =
    maxLengthError('name', nextName, SPRINT_NAME_MAX) ||
    maxLengthError('goal', nextGoal, SPRINT_GOAL_MAX)
  if (lengthErr) {
    res.status(400).json({ error: lengthErr })
    return
  }

  const created = await run('INSERT INTO sprints (name, date_range, is_started, goal) VALUES (?, ?, ?, ?)', [
    nextName,
    nextDateRange,
    false,
    nextGoal,
  ])

  const row = await get('SELECT id, name, date_range, is_started, start_date, end_date, completed_at, goal FROM sprints WHERE id = ?', [created.lastID])
  res.status(201).json(mapSprint(row))
}))

router.patch('/:id/start', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  // JL-124: enforce single-active-sprint by default. A project may opt into
  // parallel sprints via `projects.allow_parallel_sprints`; the governing
  // project is passed as `projectId` (body or query). Absent that setting the
  // default (single active) applies, preserving prior behavior.
  const projectId = Number(req.body?.projectId ?? req.query?.projectId)
  let allowParallel = false
  if (Number.isInteger(projectId)) {
    const proj = await get('SELECT allow_parallel_sprints FROM projects WHERE id = ?', [projectId])
    allowParallel = Boolean(proj?.allow_parallel_sprints)
  }
  const activeRow = await get('SELECT COUNT(*) AS count FROM sprints WHERE is_started = TRUE AND id != ?', [id])
  const activeCount = Number(activeRow?.count ?? 0)
  if (!canStartSprint({ activeCount, allowParallel })) {
    res.status(409).json({
      error: 'Another sprint is already active. Enable parallel sprints for this project to run more than one at a time.',
    })
    return
  }

  // JL-86: record the real start timestamp when the sprint begins
  const update = await run('UPDATE sprints SET is_started = TRUE, start_date = NOW() WHERE id = ?', [id])
  if (update.changes === 0) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  // JL-86: snapshot the sprint's current issues (id + story points) into
  // sprint_scope so burndown/burnup have a committed baseline to chart against.
  const issues = await all('SELECT id, story_points FROM issues WHERE sprint_id = ?', [id])
  for (const issue of issues) {
    await run(
      'INSERT INTO sprint_scope (sprint_id, issue_id, points) VALUES (?, ?, ?)',
      [id, issue.id, issue.story_points ?? null],
    )
  }

  const row = await get('SELECT id, name, date_range, is_started, start_date, end_date, completed_at, goal FROM sprints WHERE id = ?', [id])

  // JL-59: emit sprint.started event to subscribed webhooks (fire-and-forget)
  emitEvent('sprint.started', mapSprint(row)).catch(() => {})

  res.json(mapSprint(row))
}))

router.patch('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const body = req.body || {}
  const { name, dateRange } = body

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const nextName = String(name || '').trim()
  const nextDateRange = String(dateRange || '').trim()
  if (!nextName) {
    res.status(400).json({ error: 'Sprint name is required' })
    return
  }

  // JL-204: length cap (checked after trim)
  const nameErr = maxLengthError('name', nextName, SPRINT_NAME_MAX)
  if (nameErr) {
    res.status(400).json({ error: nameErr })
    return
  }

  // JL-127: goal is optional on patch — only update it when the key is present.
  const setClauses = ['name = ?', 'date_range = ?']
  const params = [nextName, nextDateRange || 'Upcoming']
  if (Object.prototype.hasOwnProperty.call(body, 'goal')) {
    const nextGoal = body.goal == null ? null : String(body.goal).trim() || null
    // JL-204: length cap (checked after trim)
    const goalErr = maxLengthError('goal', nextGoal, SPRINT_GOAL_MAX)
    if (goalErr) {
      res.status(400).json({ error: goalErr })
      return
    }
    setClauses.push('goal = ?')
    params.push(nextGoal)
  }
  params.push(id)

  const update = await run(`UPDATE sprints SET ${setClauses.join(', ')} WHERE id = ?`, params)
  if (update.changes === 0) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  const row = await get('SELECT id, name, date_range, is_started, start_date, end_date, completed_at, goal FROM sprints WHERE id = ?', [id])
  res.json(mapSprint(row))
}))

router.patch('/:id/complete', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const sprint = await get('SELECT id, name, date_range, is_started, start_date, end_date, completed_at, goal FROM sprints WHERE id = ?', [id])
  if (!sprint) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  await run("UPDATE issues SET status = 'Backlog', sprint_id = NULL WHERE sprint_id = ? AND status != 'Done'", [id])
  // JL-86: record the real completion timestamp when the sprint is closed
  await run('UPDATE sprints SET is_started = FALSE, completed_at = NOW() WHERE id = ?', [id])

  const row = await get('SELECT id, name, date_range, is_started, start_date, end_date, completed_at, goal FROM sprints WHERE id = ?', [id])

  // JL-59: emit sprint.completed event to subscribed webhooks (fire-and-forget)
  emitEvent('sprint.completed', mapSprint(row)).catch(() => {})

  res.json(mapSprint(row))
}))

router.delete('/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const sprint = await get('SELECT id, name, date_range, is_started, start_date, end_date, completed_at, goal FROM sprints WHERE id = ?', [id])
  if (!sprint) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  await run("UPDATE issues SET status = 'Backlog', sprint_id = NULL WHERE sprint_id = ?", [id])
  await run('DELETE FROM sprints WHERE id = ?', [id])
  res.json({ ok: true, deleted: mapSprint(sprint) })
}))

/* ===================== JL-124: project-scoped endpoints ===================== */

// GET /api/projects/:id/sprints/active → ALL currently-active sprints (array).
projectSprintRouter.get('/projects/:id/sprints/active', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  if (!Number.isInteger(projectId)) {
    res.status(400).json({ error: 'Invalid project id' })
    return
  }
  const rows = await all(
    'SELECT id, name, date_range, is_started, start_date, end_date, completed_at FROM sprints WHERE is_started = TRUE ORDER BY start_date ASC NULLS LAST, id ASC',
  )
  res.json(rows.map(mapSprint))
}))

// GET /api/projects/:id/sprints/settings → parallel-sprints opt-in state.
projectSprintRouter.get('/projects/:id/sprints/settings', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  if (!Number.isInteger(projectId)) {
    res.status(400).json({ error: 'Invalid project id' })
    return
  }
  const proj = await get('SELECT allow_parallel_sprints FROM projects WHERE id = ?', [projectId])
  if (!proj) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  res.json({ allowParallelSprints: Boolean(proj.allow_parallel_sprints) })
}))

// PUT /api/projects/:id/sprints/settings (Admin) → toggle parallel sprints.
projectSprintRouter.put('/projects/:id/sprints/settings', requireRole('Admin'), asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  if (!Number.isInteger(projectId)) {
    res.status(400).json({ error: 'Invalid project id' })
    return
  }
  const allow = Boolean(req.body?.allowParallelSprints)
  const update = await run('UPDATE projects SET allow_parallel_sprints = ? WHERE id = ?', [allow, projectId])
  if (update.changes === 0) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  res.json({ allowParallelSprints: allow })
}))

/* ================================================================
   JL-127: Sprint retrospectives (well / improve / action notes)
   ================================================================ */

router.get('/:id/retros', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const rows = await all(
    'SELECT id, sprint_id, category, text, author, created_at FROM sprint_retros WHERE sprint_id = ? ORDER BY id ASC',
    [id],
  )
  res.json(rows.map(mapRetro))
}))

router.post('/:id/retros', requireRole('Member'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const { category, text } = req.body || {}
  if (!RETRO_CATEGORIES.includes(category)) {
    res.status(400).json({ error: 'Invalid category. Must be one of: well, improve, action' })
    return
  }

  const nextText = String(text || '').trim()
  if (!nextText) {
    res.status(400).json({ error: 'Retro text is required' })
    return
  }

  const sprint = await get('SELECT id FROM sprints WHERE id = ?', [id])
  if (!sprint) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  const author = req.user?.email || ''
  const created = await run(
    'INSERT INTO sprint_retros (sprint_id, category, text, author) VALUES (?, ?, ?, ?)',
    [id, category, nextText, author],
  )

  const row = await get(
    'SELECT id, sprint_id, category, text, author, created_at FROM sprint_retros WHERE id = ?',
    [created.lastID],
  )
  res.status(201).json(mapRetro(row))
}))

router.delete('/:sprintId/retros/:retroId', requireRole('Member'), asyncHandler(async (req, res) => {
  const sprintId = Number(req.params.sprintId)
  const retroId = Number(req.params.retroId)
  if (!Number.isInteger(sprintId) || !Number.isInteger(retroId)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }

  const del = await run('DELETE FROM sprint_retros WHERE id = ? AND sprint_id = ?', [retroId, sprintId])
  if (del.changes === 0) {
    res.status(404).json({ error: 'Retro note not found' })
    return
  }
  res.json({ ok: true, deleted: retroId })
}))

export default router

/* ================================================================
   JL-127: Sprint templates (reusable name / duration / default goal)
   Mounted separately at /api/sprint-templates.
   ================================================================ */

export const templatesRouter = Router()

function mapTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    durationDays: row.duration_days,
    defaultGoal: row.default_goal ?? '',
    createdAt: row.created_at ?? null,
  }
}

templatesRouter.get('/', asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, name, duration_days, default_goal, created_at FROM sprint_templates ORDER BY id ASC',
  )
  res.json(rows.map(mapTemplate))
}))

templatesRouter.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, durationDays, defaultGoal } = req.body || {}
  const nextName = String(name || '').trim()
  if (!nextName) {
    res.status(400).json({ error: 'Template name is required' })
    return
  }
  const nextDuration = Number.isInteger(Number(durationDays)) && Number(durationDays) > 0 ? Number(durationDays) : 14
  const nextGoal = defaultGoal == null ? '' : String(defaultGoal).trim()

  const created = await run(
    'INSERT INTO sprint_templates (name, duration_days, default_goal) VALUES (?, ?, ?)',
    [nextName, nextDuration, nextGoal],
  )
  const row = await get(
    'SELECT id, name, duration_days, default_goal, created_at FROM sprint_templates WHERE id = ?',
    [created.lastID],
  )
  res.status(201).json(mapTemplate(row))
}))

// Create a new sprint from a template (name/date_range/goal seeded from template).
templatesRouter.post('/:id/create-sprint', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid template id' })
    return
  }

  const tpl = await get(
    'SELECT id, name, duration_days, default_goal FROM sprint_templates WHERE id = ?',
    [id],
  )
  if (!tpl) {
    res.status(404).json({ error: 'Template not found' })
    return
  }

  const count = await get('SELECT COUNT(*) AS count FROM sprints')
  const sprintName = String(req.body?.name || '').trim() || `${tpl.name} ${count.count + 1}`
  const dateRange = String(req.body?.dateRange || '').trim() || 'Upcoming'
  const goal = req.body?.goal != null ? String(req.body.goal).trim() || null : (tpl.default_goal || null)

  const created = await run(
    'INSERT INTO sprints (name, date_range, is_started, goal) VALUES (?, ?, ?, ?)',
    [sprintName, dateRange, false, goal],
  )
  const row = await get(
    'SELECT id, name, date_range, is_started, start_date, end_date, completed_at, goal FROM sprints WHERE id = ?',
    [created.lastID],
  )
  res.status(201).json(mapSprint(row))
}))
