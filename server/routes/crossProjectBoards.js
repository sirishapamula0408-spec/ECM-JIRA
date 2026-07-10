import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// Mirrors src/constants.js ISSUE_STATUSES — the Kanban columns, shared with the
// single-project board. Kept in sync here to keep the server self-contained.
export const ISSUE_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done']

export const SWIMLANE_MODES = ['project', 'assignee', 'none']

// JSONB comes back parsed from pg, but be defensive against raw strings.
function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return fallback }
  }
  return value
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    ownerEmail: row.owner_email,
    projectIds: parseJson(row.project_ids, []),
    swimlaneBy: row.swimlane_by,
    filter: parseJson(row.filter, {}),
    createdAt: row.created_at,
  }
}

/**
 * PURE HELPER (JL-123): intersect requested project ids with the ids the caller
 * is actually allowed to see. Numeric-normalised, de-duplicated, order follows
 * `requestedIds`. Guarantees a user can never widen a board to projects they
 * cannot access.
 */
export function accessibleProjectIds(requestedIds, allowedIds) {
  const allowed = new Set((allowedIds || []).map(Number))
  const seen = new Set()
  const result = []
  for (const raw of requestedIds || []) {
    const id = Number(raw)
    if (!Number.isFinite(id)) continue
    if (allowed.has(id) && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  }
  return result
}

// Build status columns for a given subset of issues.
function buildColumns(issues, statuses) {
  return statuses.map((status) => ({
    status,
    issues: issues.filter((i) => (i.status ?? null) === status),
  }))
}

/**
 * PURE HELPER (JL-123): compute the board layout from a flat issues array.
 * Returns:
 *   {
 *     columns:   [{ status, issues }]              // flat, all issues
 *     swimlanes: [{ key, columns: [{ status, issues }] }]  // grouped
 *   }
 * swimlaneBy:
 *   'project'  → one swimlane per distinct project_id (key = project id)
 *   'assignee' → one swimlane per distinct assignee (key = assignee | 'Unassigned')
 *   'none'     → swimlanes is [] (render the flat columns only)
 */
export function groupIssuesForBoard(issues, statuses, swimlaneBy = 'project') {
  const list = Array.isArray(issues) ? issues : []
  const cols = Array.isArray(statuses) && statuses.length ? statuses : ISSUE_STATUSES
  const columns = buildColumns(list, cols)

  if (swimlaneBy === 'none') {
    return { columns, swimlanes: [] }
  }

  const groups = new Map()
  const order = []
  for (const issue of list) {
    let key
    if (swimlaneBy === 'assignee') {
      const a = issue.assignee ?? issue.assignee_email ?? null
      key = a && String(a).trim() ? String(a) : 'Unassigned'
    } else {
      // default: by project
      key = issue.project_id ?? issue.projectId ?? null
    }
    const mapKey = String(key)
    if (!groups.has(mapKey)) {
      groups.set(mapKey, { key, issues: [] })
      order.push(mapKey)
    }
    groups.get(mapKey).issues.push(issue)
  }

  const swimlanes = order.map((mapKey) => {
    const g = groups.get(mapKey)
    return { key: g.key, columns: buildColumns(g.issues, cols) }
  })

  return { columns, swimlanes }
}

/**
 * Resolve the set of project ids the current user may access. Mirrors the
 * membership/lead logic used by the projects listing (JL-96 workspace scope).
 */
async function loadAllowedProjectIds(req) {
  const userEmail = req.user?.email
  if (!userEmail) return []
  const member = await get('SELECT id, name FROM members WHERE LOWER(email) = LOWER(?)', [userEmail])
  let rows
  if (member) {
    rows = await all(
      `SELECT DISTINCT p.id FROM projects p
       LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.member_id = ?
       WHERE (pm.member_id IS NOT NULL OR LOWER(p.lead) = LOWER(?))`,
      [member.id, userEmail],
    )
  } else {
    rows = await all('SELECT id FROM projects WHERE LOWER(lead) = LOWER(?)', [userEmail])
  }
  return rows.map((r) => Number(r.id))
}

// GET /api/cross-project-boards — owner-scoped list.
router.get('/', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT * FROM cross_project_boards WHERE owner_email = ? ORDER BY created_at DESC',
    [req.user.email],
  )
  res.json(rows.map(serialize))
}))

// GET /api/cross-project-boards/:id — owner only.
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await get('SELECT * FROM cross_project_boards WHERE id = ?', [Number(req.params.id)])
  if (!row) {
    res.status(404).json({ error: 'Board not found' })
    return
  }
  if (row.owner_email !== req.user.email) {
    res.status(403).json({ error: 'Access denied' })
    return
  }
  res.json(serialize(row))
}))

// POST /api/cross-project-boards — create (project ids clamped to accessible).
router.post('/', asyncHandler(async (req, res) => {
  const { name, projectIds = [], swimlaneBy = 'project', filter = {} } = req.body
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  if (!Array.isArray(projectIds)) {
    res.status(400).json({ error: 'projectIds must be an array' })
    return
  }
  if (!SWIMLANE_MODES.includes(swimlaneBy)) {
    res.status(400).json({ error: `swimlaneBy must be one of ${SWIMLANE_MODES.join(', ')}` })
    return
  }
  const allowed = await loadAllowedProjectIds(req)
  const safeIds = accessibleProjectIds(projectIds, allowed)

  const result = await run(
    'INSERT INTO cross_project_boards (name, owner_email, project_ids, swimlane_by, filter) VALUES (?, ?, ?::jsonb, ?, ?::jsonb)',
    [name.trim(), req.user.email, JSON.stringify(safeIds), swimlaneBy, JSON.stringify(filter || {})],
  )
  const row = await get('SELECT * FROM cross_project_boards WHERE id = ?', [result.lastID])
  res.status(201).json(serialize(row))
}))

// PATCH /api/cross-project-boards/:id — owner only.
router.patch('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT * FROM cross_project_boards WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Board not found' })
    return
  }
  if (existing.owner_email !== req.user.email) {
    res.status(403).json({ error: 'Only the owner can edit this board' })
    return
  }

  const { name, projectIds, swimlaneBy, filter } = req.body
  const sets = []
  const params = []

  if (name !== undefined) {
    if (!name?.trim()) {
      res.status(400).json({ error: 'name cannot be empty' })
      return
    }
    sets.push('name = ?'); params.push(name.trim())
  }
  if (projectIds !== undefined) {
    if (!Array.isArray(projectIds)) {
      res.status(400).json({ error: 'projectIds must be an array' })
      return
    }
    const allowed = await loadAllowedProjectIds(req)
    const safeIds = accessibleProjectIds(projectIds, allowed)
    sets.push('project_ids = ?::jsonb'); params.push(JSON.stringify(safeIds))
  }
  if (swimlaneBy !== undefined) {
    if (!SWIMLANE_MODES.includes(swimlaneBy)) {
      res.status(400).json({ error: `swimlaneBy must be one of ${SWIMLANE_MODES.join(', ')}` })
      return
    }
    sets.push('swimlane_by = ?'); params.push(swimlaneBy)
  }
  if (filter !== undefined) {
    sets.push('filter = ?::jsonb'); params.push(JSON.stringify(filter || {}))
  }

  if (sets.length === 0) {
    res.json(serialize(existing))
    return
  }
  params.push(id)
  await run(`UPDATE cross_project_boards SET ${sets.join(', ')} WHERE id = ?`, params)
  const row = await get('SELECT * FROM cross_project_boards WHERE id = ?', [id])
  res.json(serialize(row))
}))

// DELETE /api/cross-project-boards/:id — owner only.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get('SELECT owner_email FROM cross_project_boards WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Board not found' })
    return
  }
  if (existing.owner_email !== req.user.email) {
    res.status(403).json({ error: 'Only the owner can delete this board' })
    return
  }
  await run('DELETE FROM cross_project_boards WHERE id = ?', [id])
  res.json({ success: true })
}))

// GET /api/cross-project-boards/:id/issues — aggregated board issues.
// Scoped to projects the caller can access; disallowed project ids are dropped
// (never queried), so a board can't leak issues from projects the user lost
// access to.
router.get('/:id/issues', asyncHandler(async (req, res) => {
  const board = await get('SELECT * FROM cross_project_boards WHERE id = ?', [Number(req.params.id)])
  if (!board) {
    res.status(404).json({ error: 'Board not found' })
    return
  }
  if (board.owner_email !== req.user.email) {
    res.status(403).json({ error: 'Access denied' })
    return
  }

  const requestedIds = parseJson(board.project_ids, [])
  const allowed = await loadAllowedProjectIds(req)
  const safeIds = accessibleProjectIds(requestedIds, allowed)

  let issues = []
  if (safeIds.length > 0) {
    const placeholders = safeIds.map(() => '?').join(', ')
    issues = await all(
      `SELECT i.id, i.issue_key, i.title, i.priority, i.assignee, i.status, i.issue_type,
              i.project_id, i.parent_id, i.epic_id, i.story_points, i.updated_at,
              p.name AS project_name, p.key AS project_key
       FROM issues i
       JOIN projects p ON p.id = i.project_id
       WHERE i.project_id IN (${placeholders})
       ORDER BY i.project_id ASC, i.id ASC`,
      safeIds,
    )
  }

  const board_ = serialize(board)
  const grouped = groupIssuesForBoard(issues, ISSUE_STATUSES, board_.swimlaneBy)
  res.json({
    board: { ...board_, projectIds: safeIds },
    statuses: ISSUE_STATUSES,
    ...grouped,
  })
}))

export default router
