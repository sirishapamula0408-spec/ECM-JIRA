import { Router } from 'express'
import { get, run, all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'
import { emitEvent } from '../services/events.js'
import { maxLengthError, SPRINT_NAME_MAX, SPRINT_GOAL_MAX } from '../utils/validation.js'

const router = Router()

// JL-124: project-scoped sprint endpoints (mounted at /api → /api/projects/:id/...).
// JL-165: sprints now carry project_id. A sprint with project_id NULL is a
// "shared" legacy sprint from before JL-165 (see the db.js migration): it is
// visible to every project, exactly as all sprints used to be, until an Admin
// assigns it to one. Every sprint created from here on names its project.
export const projectSprintRouter = Router()

const SPRINT_COLUMNS = 'id, project_id, name, date_range, is_started, start_date, end_date, completed_at, goal'

/**
 * JL-165 — may an issue in `issueProjectId` be put in `sprint`?
 * Yes when the sprint is that project's own, or a shared legacy sprint, or the
 * issue has no project (the pre-projects legacy path).
 */
export function sprintFitsProject(sprint, issueProjectId) {
  if (!sprint) return false
  if (sprint.project_id == null || issueProjectId == null) return true
  return Number(sprint.project_id) === Number(issueProjectId)
}

/** A positive integer project id from a request value, or null. */
function parseProjectId(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

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
    projectId: row.project_id ?? null,
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

// JL-165: ?projectId=N → that project's sprints plus shared legacy ones.
// Without it, every sprint (each row says which project it belongs to), which
// is what a cross-project screen such as the dashboard needs.
router.get('/', asyncHandler(async (req, res) => {
  const projectId = parseProjectId(req.query?.projectId)
  const rows = projectId
    ? await all(`SELECT ${SPRINT_COLUMNS} FROM sprints WHERE project_id = ? OR project_id IS NULL ORDER BY id ASC`, [projectId])
    : await all(`SELECT ${SPRINT_COLUMNS} FROM sprints ORDER BY id ASC`)
  res.json(rows.map(mapSprint))
}))

router.post('/', requireRole('Admin'), asyncHandler(async (req, res) => {
  const { name, dateRange, goal } = req.body || {}

  // JL-165: a new sprint must belong to a project.
  const projectId = parseProjectId(req.body?.projectId)
  if (!projectId) {
    res.status(400).json({ error: 'projectId is required: a sprint belongs to a project' })
    return
  }
  const project = await get('SELECT id, key FROM projects WHERE id = ?', [projectId])
  if (!project) {
    res.status(400).json({ error: 'Project not found' })
    return
  }

  // Numbered within the project, and named after it, so two teams' "Sprint 3"
  // are not one shared counter.
  const count = await get('SELECT COUNT(*) AS count FROM sprints WHERE project_id = ?', [projectId])
  const fallbackName = `${project.key} Sprint ${Number(count.count) + 1}`
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

  const created = await run('INSERT INTO sprints (project_id, name, date_range, is_started, goal) VALUES (?, ?, ?, ?, ?)', [
    projectId,
    nextName,
    nextDateRange,
    false,
    nextGoal,
  ])

  const row = await get(`SELECT ${SPRINT_COLUMNS} FROM sprints WHERE id = ?`, [created.lastID])
  res.status(201).json(mapSprint(row))
}))

router.patch('/:id/start', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const target = await get('SELECT id, project_id FROM sprints WHERE id = ?', [id])
  if (!target) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  // JL-124: enforce single-active-sprint by default. A project may opt into
  // parallel sprints via `projects.allow_parallel_sprints`.
  // JL-165: the governing project is the sprint's OWN project, and only that
  // project's active sprints count. Before, one active sprint anywhere in the
  // system stopped every other project starting one. A shared legacy sprint
  // (no project) keeps the old rule: the caller's projectId decides the
  // setting, and active sprints are counted across the system.
  const projectId = target.project_id ?? parseProjectId(req.body?.projectId ?? req.query?.projectId)
  let allowParallel = false
  if (projectId) {
    const proj = await get('SELECT allow_parallel_sprints FROM projects WHERE id = ?', [projectId])
    allowParallel = Boolean(proj?.allow_parallel_sprints)
  }
  const activeRow = target.project_id != null
    ? await get('SELECT COUNT(*) AS count FROM sprints WHERE is_started = TRUE AND id != ? AND project_id = ?', [id, target.project_id])
    : await get('SELECT COUNT(*) AS count FROM sprints WHERE is_started = TRUE AND id != ?', [id])
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

  const row = await get(`SELECT ${SPRINT_COLUMNS} FROM sprints WHERE id = ?`, [id])

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

  /*
   * JL-165: `projectId` assigns a shared legacy sprint to a project. A sprint
   * that already belongs to a project cannot be moved to another: its issues
   * belong to that project, and moving the sprint would leave them in a
   * sprint their own project cannot see.
   */
  if (Object.prototype.hasOwnProperty.call(body, 'projectId')) {
    const nextProject = parseProjectId(body.projectId)
    const current = await get('SELECT project_id FROM sprints WHERE id = ?', [id])
    if (!current) {
      res.status(404).json({ error: 'Sprint not found' })
      return
    }
    if (!nextProject || !(await get('SELECT id FROM projects WHERE id = ?', [nextProject]))) {
      res.status(400).json({ error: 'Project not found' })
      return
    }
    if (current.project_id != null && Number(current.project_id) !== nextProject) {
      res.status(409).json({ error: 'A sprint cannot be moved to another project' })
      return
    }
    const foreign = await get(
      'SELECT COUNT(*) AS count FROM issues WHERE sprint_id = ? AND project_id IS NOT NULL AND project_id != ?',
      [id, nextProject],
    )
    if (Number(foreign?.count ?? 0) > 0) {
      res.status(409).json({ error: `This sprint holds ${foreign.count} issue(s) from other projects; move them out first` })
      return
    }
    setClauses.push('project_id = ?')
    params.push(nextProject)
  }
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

  const row = await get(`SELECT ${SPRINT_COLUMNS} FROM sprints WHERE id = ?`, [id])
  res.json(mapSprint(row))
}))

router.patch('/:id/complete', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  const sprint = await get(`SELECT ${SPRINT_COLUMNS} FROM sprints WHERE id = ?`, [id])
  if (!sprint) {
    res.status(404).json({ error: 'Sprint not found' })
    return
  }

  await run("UPDATE issues SET status = 'Backlog', sprint_id = NULL WHERE sprint_id = ? AND status != 'Done'", [id])
  // JL-86: record the real completion timestamp when the sprint is closed
  await run('UPDATE sprints SET is_started = FALSE, completed_at = NOW() WHERE id = ?', [id])

  const row = await get(`SELECT ${SPRINT_COLUMNS} FROM sprints WHERE id = ?`, [id])

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

  const sprint = await get(`SELECT ${SPRINT_COLUMNS} FROM sprints WHERE id = ?`, [id])
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
  // JL-165: this project's active sprints (and any shared legacy one), not
  // every active sprint in the system.
  const rows = await all(
    `SELECT ${SPRINT_COLUMNS} FROM sprints WHERE is_started = TRUE AND (project_id = ? OR project_id IS NULL) ORDER BY start_date ASC NULLS LAST, id ASC`,
    [projectId],
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

// JL-286: sprint retros stay on the workspace-role gate (requireRole('Member')).
// JL-165 gave sprints a project_id, but shared legacy sprints still have none,
// so project-level scoping here is a follow-up rather than part of JL-165.
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

  // JL-165: a sprint made from a template belongs to a project like any other.
  const projectId = parseProjectId(req.body?.projectId)
  if (!projectId || !(await get('SELECT id FROM projects WHERE id = ?', [projectId]))) {
    res.status(400).json({ error: 'projectId is required: a sprint belongs to a project' })
    return
  }
  const count = await get('SELECT COUNT(*) AS count FROM sprints WHERE project_id = ?', [projectId])
  const sprintName = String(req.body?.name || '').trim() || `${tpl.name} ${Number(count.count) + 1}`
  const dateRange = String(req.body?.dateRange || '').trim() || 'Upcoming'
  const goal = req.body?.goal != null ? String(req.body.goal).trim() || null : (tpl.default_goal || null)

  const created = await run(
    'INSERT INTO sprints (project_id, name, date_range, is_started, goal) VALUES (?, ?, ?, ?, ?)',
    [projectId, sprintName, dateRange, false, goal],
  )
  const row = await get(
    `SELECT ${SPRINT_COLUMNS} FROM sprints WHERE id = ?`,
    [created.lastID],
  )
  res.status(201).json(mapSprint(row))
}))
