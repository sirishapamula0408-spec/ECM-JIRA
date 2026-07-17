import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

/* ================================================================
   JL-125: Advanced Roadmaps (multi-team, dependency- & capacity-aware)

   Extends the roadmap into a cross-project planning view built on the
   existing Epic model (issues with issue_type='Epic', epic_id children,
   start_date/due_date). Adds:
     - epic timelines across the caller's accessible projects
     - finish_to_start dependencies between epics
     - team capacity (points) per planning period vs planned load

   The scheduling logic lives in pure, unit-testable helpers exported
   below (detectDependencyViolations / detectCapacityOverload /
   topoOrderEpics) so it can be reasoned about without a DB.
   ================================================================ */

const router = Router()

const DEPENDENCY_TYPES = new Set(['finish_to_start'])

/* ---------------- pure field accessors (shape-tolerant) ---------------- */

const epicId = (e) => e?.id
const epicProject = (e) => e?.projectId ?? e?.project_id ?? null
const epicStart = (e) => e?.startDate ?? e?.start_date ?? null
const epicDue = (e) => e?.dueDate ?? e?.due_date ?? e?.endDate ?? e?.end_date ?? null
const epicPoints = (e) =>
  e?.points ?? e?.plannedPoints ?? e?.rollup?.points ?? e?.storyPoints ?? e?.story_points ?? 0
const depFrom = (d) => d?.fromEpicId ?? d?.from_epic_id
const depTo = (d) => d?.toEpicId ?? d?.to_epic_id
const depType = (d) => d?.type ?? d?.dependency_type ?? 'finish_to_start'

// Parse a date-ish value to epoch ms, or null when missing/invalid.
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/**
 * Flag finish_to_start dependency violations: the to-epic must not start
 * before the from-epic finishes. Epics with missing start/due dates are
 * skipped gracefully (cannot be judged), never reported as violations.
 *
 * @returns {Array<{dependencyId, fromEpicId, toEpicId, type, fromEnd, toStart, message}>}
 */
export function detectDependencyViolations(epics, deps) {
  const byId = new Map((epics || []).map((e) => [Number(epicId(e)), e]))
  const violations = []
  for (const dep of deps || []) {
    const type = depType(dep)
    if (type !== 'finish_to_start') continue
    const from = byId.get(Number(depFrom(dep)))
    const to = byId.get(Number(depTo(dep)))
    if (!from || !to) continue
    const fromEnd = parseDate(epicDue(from))
    const toStart = parseDate(epicStart(to))
    if (fromEnd === null || toStart === null) continue // missing dates -> skip
    if (toStart < fromEnd) {
      violations.push({
        dependencyId: dep.id ?? null,
        fromEpicId: Number(epicId(from)),
        toEpicId: Number(epicId(to)),
        type,
        fromEnd: epicDue(from),
        toStart: epicStart(to),
        message: `Epic ${epicId(to)} starts before its dependency (epic ${epicId(from)}) finishes`,
      })
    }
  }
  return violations
}

// Does an epic's date range overlap a capacity period? Missing period bounds
// or missing epic dates are treated inclusively so planned work is never lost.
function epicInPeriod(e, periodStart, periodEnd) {
  if (periodStart === null && periodEnd === null) return true
  const lo = parseDate(epicStart(e)) ?? -Infinity
  const hi = parseDate(epicDue(e)) ?? Infinity
  const pLo = periodStart ?? -Infinity
  const pHi = periodEnd ?? Infinity
  return lo <= pHi && hi >= pLo
}

/**
 * Per capacity row (team/period/project), sum the planned points of the epics
 * that fall within its project + period, and flag when planned > capacity.
 *
 * @returns {Array<{teamName, projectId, capacityPoints, plannedPoints, epicIds, overloaded}>}
 */
export function detectCapacityOverload(epics, capacities) {
  const results = []
  for (const cap of capacities || []) {
    const capacityPoints = Number(cap.capacityPoints ?? cap.capacity_points ?? 0) || 0
    const projectId = cap.projectId ?? cap.project_id ?? null
    const periodStart = parseDate(cap.periodStart ?? cap.period_start)
    const periodEnd = parseDate(cap.periodEnd ?? cap.period_end)

    let plannedPoints = 0
    const epicIds = []
    for (const e of epics || []) {
      if (projectId != null && Number(epicProject(e)) !== Number(projectId)) continue
      if (!epicInPeriod(e, periodStart, periodEnd)) continue
      plannedPoints += Number(epicPoints(e)) || 0
      epicIds.push(Number(epicId(e)))
    }

    results.push({
      teamName: cap.teamName ?? cap.team_name ?? null,
      projectId: projectId != null ? Number(projectId) : null,
      capacityPoints,
      plannedPoints,
      epicIds,
      overloaded: plannedPoints > capacityPoints,
    })
  }
  return results
}

/**
 * Kahn topological sort over finish_to_start edges (from -> to). Returns a
 * dependency-respecting order. When a cycle exists, `order` holds the
 * schedulable prefix and `cycle` lists the epic ids that could not be ordered.
 *
 * @returns {{order:number[], cycle:number[]|null}}
 */
export function topoOrderEpics(epics, deps) {
  const ids = (epics || []).map((e) => Number(epicId(e)))
  const idSet = new Set(ids)
  const adj = new Map(ids.map((id) => [id, []]))
  const indeg = new Map(ids.map((id) => [id, 0]))

  for (const dep of deps || []) {
    const from = Number(depFrom(dep))
    const to = Number(depTo(dep))
    if (!idSet.has(from) || !idSet.has(to)) continue
    adj.get(from).push(to)
    indeg.set(to, indeg.get(to) + 1)
  }

  const queue = ids.filter((id) => indeg.get(id) === 0)
  const order = []
  while (queue.length) {
    const n = queue.shift()
    order.push(n)
    for (const m of adj.get(n)) {
      indeg.set(m, indeg.get(m) - 1)
      if (indeg.get(m) === 0) queue.push(m)
    }
  }

  if (order.length < ids.length) {
    const ordered = new Set(order)
    return { order, cycle: ids.filter((id) => !ordered.has(id)) }
  }
  return { order, cycle: null }
}

/* ---------------- scoping helpers ---------------- */

// Accessible projects for the caller: project member or project lead, scoped to
// the resolved workspace (mirrors portfolio.js / projects.js).
async function accessibleProjects(req) {
  const userEmail = req.user?.email
  if (!userEmail) return []
  const workspaceId = req.workspaceId ?? null
  const member = await get('SELECT id, name FROM members WHERE LOWER(email) = LOWER(?)', [userEmail])
  if (member) {
    return (await all(
      `SELECT DISTINCT p.id, p.key, p.name FROM projects p
         LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id = ?
        WHERE (pm.member_id IS NOT NULL OR LOWER(p.lead) = LOWER(?))
          AND (? IS NULL OR p.workspace_id = ?)
        ORDER BY p.id ASC`,
      [member.id, member.name, workspaceId, workspaceId],
    )) || []
  }
  return (await all(
    `SELECT id, key, name FROM projects
      WHERE LOWER(lead) = LOWER(?)
        AND (? IS NULL OR workspace_id = ?)
      ORDER BY id ASC`,
    [userEmail, workspaceId, workspaceId],
  )) || []
}

// Parse a comma-separated list of ids from a query string into unique ints.
function parseIdList(raw) {
  if (!raw) return []
  return [...new Set(
    String(raw)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  )]
}

const camelDep = (d) => ({
  id: d.id,
  fromEpicId: d.from_epic_id,
  toEpicId: d.to_epic_id,
  type: d.type,
  createdAt: d.created_at,
})

const camelCapacity = (c) => ({
  id: c.id,
  teamName: c.team_name,
  projectId: c.project_id,
  capacityPoints: Number(c.capacity_points),
  periodStart: c.period_start,
  periodEnd: c.period_end,
  createdAt: c.created_at,
})

/* ================================================================
   GET /api/advanced-roadmap?projectIds=1,2,3
   Epics (roadmap bars) across the caller's accessible projects with a
   child roll-up (count/points/done%), their dependencies, capacities,
   and computed dependency violations + per-team capacity load.
   ================================================================ */
router.get('/advanced-roadmap', asyncHandler(async (req, res) => {
  const accessible = await accessibleProjects(req)
  const requested = parseIdList(req.query.projectIds)
  const scoped = requested.length
    ? accessible.filter((p) => requested.includes(p.id))
    : accessible

  const empty = {
    projects: scoped,
    epics: [],
    dependencies: [],
    capacities: [],
    violations: [],
    capacityLoad: [],
  }
  if (scoped.length === 0) {
    res.json({ ...empty, projects: [] })
    return
  }

  const projectIds = scoped.map((p) => p.id)
  const ph = projectIds.map(() => '?').join(', ')

  const epicRows = (await all(
    `SELECT id, issue_key, title, status, project_id, start_date, due_date, story_points
       FROM issues
      WHERE issue_type = 'Epic' AND project_id IN (${ph})
      ORDER BY id ASC`,
    projectIds,
  )) || []

  const epicIds = epicRows.map((e) => e.id)

  // Child roll-up per epic (count / points / done%).
  const rollups = new Map(epicIds.map((id) => [id, { childCount: 0, doneCount: 0, points: 0 }]))
  let deps = []
  if (epicIds.length) {
    const cph = epicIds.map(() => '?').join(', ')
    const children = (await all(
      `SELECT epic_id, status, story_points FROM issues WHERE epic_id IN (${cph})`,
      epicIds,
    )) || []
    for (const c of children) {
      const r = rollups.get(c.epic_id)
      if (!r) continue
      r.childCount += 1
      if (c.status === 'Done') r.doneCount += 1
      r.points += Number(c.story_points) || 0
    }

    const dph = epicIds.map(() => '?').join(', ')
    deps = (await all(
      `SELECT id, from_epic_id, to_epic_id, type, created_at
         FROM roadmap_dependencies
        WHERE from_epic_id IN (${dph}) OR to_epic_id IN (${dph})`,
      [...epicIds, ...epicIds],
    )) || []
  }

  const capacities = (await all(
    `SELECT id, team_name, project_id, capacity_points, period_start, period_end, created_at
       FROM team_capacity
      WHERE project_id IN (${ph}) OR project_id IS NULL
      ORDER BY id ASC`,
    projectIds,
  )) || []

  const epics = epicRows.map((e) => {
    const r = rollups.get(e.id) || { childCount: 0, doneCount: 0, points: 0 }
    const donePct = r.childCount > 0 ? Math.round((r.doneCount / r.childCount) * 100) : 0
    const planned = r.points > 0 ? r.points : (Number(e.story_points) || 0)
    return {
      id: e.id,
      issueKey: e.issue_key,
      title: e.title,
      status: e.status,
      projectId: e.project_id,
      startDate: e.start_date,
      dueDate: e.due_date,
      storyPoints: e.story_points,
      points: planned,
      rollup: {
        childCount: r.childCount,
        doneCount: r.doneCount,
        points: r.points,
        donePct,
      },
    }
  })

  const violations = detectDependencyViolations(epics, deps)
  const capacityLoad = detectCapacityOverload(epics, capacities)

  res.json({
    projects: scoped,
    epics,
    dependencies: deps.map(camelDep),
    capacities: capacities.map(camelCapacity),
    violations,
    capacityLoad,
  })
}))

/* ================================================================
   Dependency CRUD (Admin/lead — workspace Admin/Owner gated)
   ================================================================ */

router.get('/roadmap-dependencies', asyncHandler(async (req, res) => {
  const accessible = await accessibleProjects(req)
  if (accessible.length === 0) {
    res.json([])
    return
  }
  const projectIds = accessible.map((p) => p.id)
  const ph = projectIds.map(() => '?').join(', ')
  const rows = (await all(
    `SELECT d.id, d.from_epic_id, d.to_epic_id, d.type, d.created_at
       FROM roadmap_dependencies d
       JOIN issues fi ON fi.id = d.from_epic_id
       JOIN issues ti ON ti.id = d.to_epic_id
      WHERE fi.project_id IN (${ph}) OR ti.project_id IN (${ph})
      ORDER BY d.id ASC`,
    [...projectIds, ...projectIds],
  )) || []
  res.json(rows.map(camelDep))
}))

router.post('/roadmap-dependencies', requireRole('Admin'), asyncHandler(async (req, res) => {
  const fromEpicId = Number(req.body?.fromEpicId)
  const toEpicId = Number(req.body?.toEpicId)
  const type = req.body?.type ? String(req.body.type) : 'finish_to_start'

  if (!Number.isInteger(fromEpicId) || !Number.isInteger(toEpicId)) {
    res.status(400).json({ error: 'fromEpicId and toEpicId are required' })
    return
  }
  if (fromEpicId === toEpicId) {
    res.status(400).json({ error: 'An epic cannot depend on itself' })
    return
  }
  if (!DEPENDENCY_TYPES.has(type)) {
    res.status(400).json({ error: `Unsupported dependency type: ${type}` })
    return
  }

  const from = await get("SELECT id, issue_type FROM issues WHERE id = ?", [fromEpicId])
  const to = await get("SELECT id, issue_type FROM issues WHERE id = ?", [toEpicId])
  if (!from || from.issue_type !== 'Epic' || !to || to.issue_type !== 'Epic') {
    res.status(404).json({ error: 'Both endpoints must reference existing Epics' })
    return
  }

  const result = await run(
    `INSERT INTO roadmap_dependencies (from_epic_id, to_epic_id, type)
     VALUES (?, ?, ?)
     ON CONFLICT (from_epic_id, to_epic_id) DO NOTHING
     RETURNING id`,
    [fromEpicId, toEpicId, type],
  )
  if (!result?.lastID) {
    res.status(409).json({ error: 'Dependency already exists' })
    return
  }
  const row = await get(
    'SELECT id, from_epic_id, to_epic_id, type, created_at FROM roadmap_dependencies WHERE id = ?',
    [result.lastID],
  )
  res.status(201).json(camelDep(row))
}))

router.delete('/roadmap-dependencies/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }
  await run('DELETE FROM roadmap_dependencies WHERE id = ?', [id])
  res.status(204).end()
}))

/* ================================================================
   Team capacity CRUD (Admin/lead — workspace Admin/Owner gated)
   ================================================================ */

router.get('/team-capacity', asyncHandler(async (req, res) => {
  const accessible = await accessibleProjects(req)
  const requested = parseIdList(req.query.projectIds)
  const ids = accessible
    .map((p) => p.id)
    .filter((id) => requested.length === 0 || requested.includes(id))

  if (ids.length === 0) {
    // Only global (project-less) capacity rows are visible without projects.
    const rows = (await all(
      'SELECT id, team_name, project_id, capacity_points, period_start, period_end, created_at FROM team_capacity WHERE project_id IS NULL ORDER BY id ASC',
    )) || []
    res.json(rows.map(camelCapacity))
    return
  }
  const ph = ids.map(() => '?').join(', ')
  const rows = (await all(
    `SELECT id, team_name, project_id, capacity_points, period_start, period_end, created_at
       FROM team_capacity
      WHERE project_id IN (${ph}) OR project_id IS NULL
      ORDER BY id ASC`,
    ids,
  )) || []
  res.json(rows.map(camelCapacity))
}))

router.post('/team-capacity', requireRole('Admin'), asyncHandler(async (req, res) => {
  const teamName = typeof req.body?.teamName === 'string' ? req.body.teamName.trim() : ''
  const capacityPoints = Number(req.body?.capacityPoints)
  const projectIdRaw = req.body?.projectId
  const projectId = projectIdRaw === null || projectIdRaw === undefined || projectIdRaw === ''
    ? null
    : Number(projectIdRaw)
  const periodStart = req.body?.periodStart || null
  const periodEnd = req.body?.periodEnd || null

  if (!teamName) {
    res.status(400).json({ error: 'teamName is required' })
    return
  }
  if (!Number.isFinite(capacityPoints) || capacityPoints < 0) {
    res.status(400).json({ error: 'capacityPoints must be a non-negative number' })
    return
  }
  if (projectId !== null && !Number.isInteger(projectId)) {
    res.status(400).json({ error: 'projectId must be an integer' })
    return
  }

  const result = await run(
    `INSERT INTO team_capacity (team_name, project_id, capacity_points, period_start, period_end)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id`,
    [teamName, projectId, capacityPoints, periodStart, periodEnd],
  )
  const row = await get(
    'SELECT id, team_name, project_id, capacity_points, period_start, period_end, created_at FROM team_capacity WHERE id = ?',
    [result.lastID],
  )
  res.status(201).json(camelCapacity(row))
}))

router.delete('/team-capacity/:id', requireRole('Admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid id' })
    return
  }
  await run('DELETE FROM team_capacity WHERE id = ?', [id])
  res.status(204).end()
}))

export default router
