import { Router } from 'express'
import { get, run, all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { emitEvent } from '../services/events.js'

const router = Router()

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

  // JL-127: goal is optional on patch — only update it when the key is present.
  const setClauses = ['name = ?', 'date_range = ?']
  const params = [nextName, nextDateRange || 'Upcoming']
  if (Object.prototype.hasOwnProperty.call(body, 'goal')) {
    const nextGoal = body.goal == null ? null : String(body.goal).trim() || null
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

router.post('/:id/retros', asyncHandler(async (req, res) => {
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

router.delete('/:sprintId/retros/:retroId', asyncHandler(async (req, res) => {
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
