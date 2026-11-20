import { Router } from 'express'
import { get, run, all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole, requireProjectAdmin, projectParam } from '../middleware/authorize.js'
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

/*
 * JL-483: a sprint's planned dates, set from the Create / Edit sprint dialog.
 * Dates travel as calendar days (YYYY-MM-DD) and are stored as UTC midnight in
 * start_date / end_date, which the burndown and sprint reports already read.
 * The display string (date_range, e.g. "19 Jan - 2 Feb") is derived from them,
 * so the two can never disagree.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A YYYY-MM-DD string that is a real calendar day → that string; '' or null → null; anything else → undefined. */
export function parseSprintDay(value) {
  if (value == null || value === '') return null
  const text = String(value).trim()
  if (!ISO_DAY.test(text)) return undefined
  const date = new Date(`${text}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? undefined : text
}

/** "19 Jan - 2 Feb" from two YYYY-MM-DD days (either may be missing). */
export function formatSprintRange(startDay, endDay) {
  const label = (day) => {
    const [, m, d] = day.split('-').map(Number)
    return `${d} ${MONTHS[m - 1]}`
  }
  if (startDay && endDay) return `${label(startDay)} - ${label(endDay)}`
  if (startDay) return `From ${label(startDay)}`
  if (endDay) return `Until ${label(endDay)}`
  return null
}

/**
 * Read startDate / endDate from a request body. Only keys that are present are
 * returned, so a PATCH that omits them leaves the stored dates alone.
 * Returns { error } on a bad date or an end before the start.
 */
export function readSprintDates(body, current = {}) {
  const out = {}
  for (const [key, column] of [['startDate', 'start_date'], ['endDate', 'end_date']]) {
    if (!Object.prototype.hasOwnProperty.call(body || {}, key)) continue
    const day = parseSprintDay(body[key])
    if (day === undefined) return { error: `${key} must be a date (YYYY-MM-DD)` }
    out[column] = day
  }
  const start = 'start_date' in out ? out.start_date : current.start_date
  const end = 'end_date' in out ? out.end_date : current.end_date
  if (start && end && end < start) return { error: 'The end date must be on or after the start date' }
  return { dates: out, start, end }
}

/** A stored timestamp → its UTC calendar day, or null. */
function toDay(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

const dayToTimestamp = (day) => (day ? `${day}T00:00:00Z` : null)

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

/*
 * JL-481: sprint management (create, start, edit, complete, delete, the
 * parallel-sprints setting, create-from-template) is a PROJECT-admin action:
 * workspace Owner/Admin, or the project's Lead or Admin. It used to be
 * requireRole('Admin'), a workspace gate, so a project Lead who is a workspace
 * Member saw "Create sprint" (canManageSprints) and got a 403. The resolvers
 * below follow requireProjectAdmin's contract: a project id gates on that
 * project, null (a shared legacy sprint) means workspace Admin only, and
 * undefined lets the handler answer its own 400/404.
 */
function bodyProject(req) {
  return parseProjectId(req.body?.projectId) ?? undefined
}

async function sprintProject(req) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return undefined
  const sprint = await get('SELECT project_id FROM sprints WHERE id = ?', [id])
  if (!sprint) return undefined
  return sprint.project_id ?? null
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

router.post('/', requireProjectAdmin(bodyProject), asyncHandler(async (req, res) => {
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
  const nextGoal = goal == null ? null : String(goal).trim() || null

  // JL-483: planned dates from the Create sprint dialog (optional).
  const planned = readSprintDates(req.body)
  if (planned.error) {
    res.status(400).json({ error: planned.error })
    return
  }
  const nextDateRange = formatSprintRange(planned.start, planned.end) || String(dateRange || '').trim() || 'Upcoming'

  // JL-204: server-side length caps (checked after trim)
  const lengthErr =
    maxLengthError('name', nextName, SPRINT_NAME_MAX) ||
    maxLengthError('goal', nextGoal, SPRINT_GOAL_MAX)
  if (lengthErr) {
    res.status(400).json({ error: lengthErr })
    return
  }

  const created = await run('INSERT INTO sprints (project_id, name, date_range, is_started, goal, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    projectId,
    nextName,
    nextDateRange,
    false,
    nextGoal,
    dayToTimestamp(planned.start),
    dayToTimestamp(planned.end),
  ])

  const row = await get(`SELECT ${SPRINT_COLUMNS} FROM sprints WHERE id = ?`, [created.lastID])
  res.status(201).json(mapSprint(row))
}))

router.patch('/:id/start', requireProjectAdmin(sprintProject), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid sprint id' })
    return
  }

  // end_date is read here (not in a second query) for the JL-483 range update below.
  const target = await get('SELECT id, project_id, end_date FROM sprints WHERE id = ?', [id])
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

  // JL-86: record the real start timestamp when the sprint begins.
  // JL-483: the display range is derived from the dates, so re-derive it from
  // the new start (today) and the planned end — otherwise the row kept saying
  // the planned "7 Dec - 21 Dec" while Edit sprint showed today as the start.
  // A planned end already in the past cannot follow a start of today; drop it
  // rather than show a backwards range like "20 Nov - 14 Oct". It can be set
  // again with Edit sprint.
  const today = new Date().toISOString().slice(0, 10)
  const plannedEnd = toDay(target.end_date)
  const keepEnd = plannedEnd && plannedEnd >= today
  const startedRange = formatSprintRange(today, keepEnd ? plannedEnd : null)
  const update = keepEnd || !plannedEnd
    ? await run('UPDATE sprints SET is_started = TRUE, start_date = NOW(), date_range = ? WHERE id = ?', [startedRange, id])
    : await run('UPDATE sprints SET is_started = TRUE, start_date = NOW(), end_date = NULL, date_range = ? WHERE id = ?', [startedRange, id])
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

router.patch('/:id', requireProjectAdmin(sprintProject), asyncHandler(async (req, res) => {
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
  // JL-483: so is the display range. A PATCH that sends neither dateRange nor
  // dates (e.g. just a rename) used to reset it to "Upcoming" while the stored
  // dates stayed, so the row and the dates disagreed.
  const setClauses = ['name = ?']
  const params = [nextName]
  if (Object.prototype.hasOwnProperty.call(body, 'dateRange')) {
    setClauses.push('date_range = ?')
    params.push(nextDateRange || 'Upcoming')
  }

  // JL-483: planned dates from the Edit sprint dialog. Only keys present in the
  // body change; when either does, the display range is re-derived from the
  // resulting pair so it can never contradict the stored dates.
  if (Object.prototype.hasOwnProperty.call(body, 'startDate') || Object.prototype.hasOwnProperty.call(body, 'endDate')) {
    const stored = await get('SELECT start_date, end_date FROM sprints WHERE id = ?', [id])
    if (!stored) {
      res.status(404).json({ error: 'Sprint not found' })
      return
    }
    const planned = readSprintDates(body, { start_date: toDay(stored.start_date), end_date: toDay(stored.end_date) })
    if (planned.error) {
      res.status(400).json({ error: planned.error })
      return
    }
    for (const [column, day] of Object.entries(planned.dates)) {
      setClauses.push(`${column} = ?`)
      params.push(dayToTimestamp(day))
    }
    const derived = formatSprintRange(planned.start, planned.end) || nextDateRange || 'Upcoming'
    const at = setClauses.indexOf('date_range = ?')
    if (at >= 0) params[at] = derived
    else { setClauses.push('date_range = ?'); params.push(derived) }
  }

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

router.patch('/:id/complete', requireProjectAdmin(sprintProject), asyncHandler(async (req, res) => {
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

router.delete('/:id', requireProjectAdmin(sprintProject), asyncHandler(async (req, res) => {
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

// PUT /api/projects/:id/sprints/settings (project Admin/Lead) → toggle parallel sprints.
projectSprintRouter.put('/projects/:id/sprints/settings', requireProjectAdmin(projectParam('id')), asyncHandler(async (req, res) => {
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
templatesRouter.post('/:id/create-sprint', requireProjectAdmin(bodyProject), asyncHandler(async (req, res) => {
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
