import { Router } from 'express'
import { all, get, run, withTransaction } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { validStatuses, validPriorities, validIssueTypes } from '../middleware/validate.js'
import { requireRole } from '../middleware/authorize.js'
import { runStatusChangeAutomations } from '../services/automation.js'
import { loadTransitions, isTransitionAllowed, findTransition, runValidators, applyPostFunctions } from '../services/workflow.js'
import { buildIssueSearchAsync } from '../services/jqlSearch.js'
import { emitEvent } from '../services/events.js'
import { parsePagination, isPaginationRequested } from '../utils/pagination.js'
import { validateRequiredFields } from './fieldConfig.js'

const router = Router()

// JL-77: helper to normalize an optional string field ('' → null, trimmed).
function optText(v) {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? null : s
}

function mapIssue(row) {
  if (!row) return null
  return {
    id: row.id,
    key: row.issue_key,
    title: row.title,
    description: row.description,
    priority: row.priority,
    assignee: row.assignee,
    status: row.status,
    issueType: row.issue_type,
    sprintId: row.sprint_id ?? null,
    projectId: row.project_id ?? null,
    parentId: row.parent_id ?? null,
    epicId: row.epic_id ?? null,
    storyPoints: row.story_points ?? null,
    createdAt: row.created_at,
    reporter: row.reporter ?? null,
    dueDate: row.due_date ?? null,
    startDate: row.start_date ?? null,
    resolution: row.resolution ?? null,
    environment: row.environment ?? null,
    components: row.components ?? null,
    updatedAt: row.updated_at ?? null,
    ...(row.watcher_count !== undefined
      ? { watcherCount: Number(row.watcher_count) || 0 }
      : {}),
  }
}

// JL-86: normalize a story-points input to a non-negative integer or null.
// Returns `undefined` when the value is invalid so callers can reject it.
function normalizeStoryPoints(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  return parsed
}

// JL-76: normalize an epic_id input. Returns null for empty, undefined for invalid,
// or an integer id. Callers reject `undefined` as a 400.
function normalizeEpicId(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined
  return parsed
}

// JL-76: validate that `epicId` references an existing Epic. Resolves to an
// error string (for 400) or null when OK.
async function validateEpicRef(epicId, issueType) {
  if (epicId === null) return null
  if (issueType === 'Epic') return 'An Epic cannot belong to another Epic'
  if (issueType === 'Sub-task') return 'A Sub-task cannot belong to an Epic directly'
  const epic = await get('SELECT id, issue_type FROM issues WHERE id = ?', [epicId])
  if (!epic) return 'Epic not found'
  if (epic.issue_type !== 'Epic') return 'Referenced issue is not an Epic'
  return null
}

async function getDefaultSprintId() {
  const sprint = await get('SELECT id FROM sprints ORDER BY id ASC LIMIT 1')
  return sprint?.id ?? null
}

// JL-92: allocate the next issue-key number for a project using a monotonic
// per-project counter (never reuses numbers after a delete; concurrency-safe
// because the increment happens atomically inside the UPDATE). Falls back to
// COUNT(*)+1 only for the legacy path where an issue has no project.
async function nextIssueKey(projectKey, resolvedProjectId) {
  if (resolvedProjectId) {
    const row = await get(
      'UPDATE projects SET issue_counter = issue_counter + 1 WHERE id = ? RETURNING issue_counter',
      [resolvedProjectId],
    )
    return `${projectKey}-${row.issue_counter}`
  }
  const count = await get('SELECT COUNT(*) AS count FROM issues')
  return `${projectKey}-${Number(count.count) + 1}`
}

// JL-82: record a field-level change into the per-issue audit log.
// Only writes a row when the value actually changed (compared as strings).
async function recordHistory(issueId, field, oldValue, newValue, actor) {
  const from = oldValue === null || oldValue === undefined ? '' : String(oldValue)
  const to = newValue === null || newValue === undefined ? '' : String(newValue)
  if (from === to) return
  await run(
    'INSERT INTO issue_history (issue_id, field, old_value, new_value, actor) VALUES (?, ?, ?, ?, ?)',
    [issueId, field, from, to, actor || 'system'],
  )
}

// JL-121: pure, db-free preview builder for a bulk change.
// Given the currently-loaded `issues` (mapped shape: { id, key, status,
// priority, assignee, sprintId, labels? }) and an `operations` object,
// returns a per-issue diff describing only the fields that would actually
// change, whether the row would change at all, and any value-level validation
// error (invalid status / priority). Existence checks (assignee, sprint) are
// left to the endpoint because they need the database.
export function buildBulkPreview(issues, operations = {}, options = {}) {
  const allowedStatuses = options.allowedStatuses || validStatuses
  const allowedPriorities = options.allowedPriorities || validPriorities
  const ops = operations || {}
  const isDelete = ops.delete === true

  return (issues || []).map((issue) => {
    if (isDelete) {
      return {
        issueId: issue.id,
        key: issue.key ?? null,
        delete: true,
        willChange: true,
        changes: [],
        error: null,
      }
    }

    const changes = []
    let error = null

    if (ops.status !== undefined && ops.status !== null && ops.status !== '') {
      if (!allowedStatuses.includes(ops.status)) {
        error = error || `Invalid status "${ops.status}"`
      } else if ((issue.status ?? null) !== ops.status) {
        changes.push({ field: 'status', from: issue.status ?? null, to: ops.status })
      }
    }

    if (ops.priority !== undefined && ops.priority !== null && ops.priority !== '') {
      if (!allowedPriorities.includes(ops.priority)) {
        error = error || `Invalid priority "${ops.priority}"`
      } else if ((issue.priority ?? null) !== ops.priority) {
        changes.push({ field: 'priority', from: issue.priority ?? null, to: ops.priority })
      }
    }

    if (ops.assignee !== undefined && ops.assignee !== null && String(ops.assignee).trim() !== '') {
      const target = String(ops.assignee).trim()
      if ((issue.assignee ?? null) !== target) {
        changes.push({ field: 'assignee', from: issue.assignee ?? null, to: target })
      }
    }

    if (ops.sprintId !== undefined) {
      const target = ops.sprintId === null || ops.sprintId === '' ? null : Number(ops.sprintId)
      const current = issue.sprintId ?? null
      if (current !== target) {
        changes.push({ field: 'sprintId', from: current, to: target })
      }
    }

    if (Array.isArray(ops.addLabels) && ops.addLabels.length > 0) {
      const existing = Array.isArray(issue.labels) ? issue.labels : []
      const existingLower = new Set(existing.map((l) => String(l).toLowerCase()))
      const toAdd = ops.addLabels
        .map((l) => String(l).trim())
        .filter((l) => l && !existingLower.has(l.toLowerCase()))
      if (toAdd.length > 0) {
        changes.push({ field: 'labels', from: existing, to: [...existing, ...toAdd], added: toAdd })
      }
    }

    return {
      issueId: issue.id,
      key: issue.key ?? null,
      delete: false,
      willChange: changes.length > 0,
      changes,
      error,
    }
  })
}

router.get('/', asyncHandler(async (req, res) => {
  const { status, q, jql } = req.query

  let built
  try {
    // Whitelisted fields + bound params only — see server/services/jqlSearch.js.
    // currentUser() resolves to the requesting user (JL-117); membersOf/
    // linkedIssues are resolved via DB and bound as params.
    built = await buildIssueSearchAsync({
      status,
      q,
      jql,
      currentUser: req.user?.email,
    })
  } catch (err) {
    if (err.status === 400) {
      res.status(400).json({ error: err.message })
      return
    }
    throw err
  }

  const sql =
    'SELECT i.id, i.issue_key, i.title, i.description, i.priority, i.assignee, i.status, i.issue_type, i.sprint_id, i.project_id, i.parent_id, i.epic_id, i.story_points, i.created_at, i.reporter, i.due_date, i.start_date, i.resolution, i.environment, i.components, i.updated_at, ' +
    '(SELECT COUNT(*) FROM watchers w WHERE w.issue_id = i.id) AS watcher_count FROM issues i' +
    (built.where ? ` ${built.where}` : '') +
    ` ORDER BY ${built.orderBy}`

  // JL-100: opt-in pagination. Default (no limit/offset/page) keeps the legacy
  // unbounded array response shape. When a paging param is present, cap the
  // result set with LIMIT/OFFSET and expose totals via response headers.
  if (isPaginationRequested(req.query)) {
    const { limit, offset } = parsePagination(req.query)

    const countSql =
      'SELECT COUNT(*) AS total FROM issues i' + (built.where ? ` ${built.where}` : '')
    const countRow = await get(countSql, built.params)
    const total = Number(countRow?.total) || 0

    const rows = await all(`${sql} LIMIT ? OFFSET ?`, [...built.params, limit, offset])
    res.set('X-Total-Count', String(total))
    res.set('X-Limit', String(limit))
    res.set('X-Offset', String(offset))
    res.json(rows.map(mapIssue))
    return
  }

  const rows = await all(sql, built.params)
  res.json(rows.map(mapIssue))
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid issue id' })
    return
  }

  const row = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, epic_id, story_points, created_at, reporter, due_date, start_date, resolution, environment, components, updated_at FROM issues WHERE id = ?',
    [id],
  )

  if (!row) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }

  const issue = mapIssue(row)

  // JL-112: include fix/affects versions in the issue detail (best-effort).
  issue.fixVersions = []
  issue.affectsVersions = []
  try {
    const versionRows = await all(
      `SELECT iv.type, r.id, r.name, r.status, r.release_date
       FROM issue_versions iv
       JOIN releases r ON r.id = iv.version_id
       WHERE iv.issue_id = ?
       ORDER BY r.release_date DESC NULLS LAST, r.id ASC`,
      [id],
    )
    for (const v of Array.isArray(versionRows) ? versionRows : []) {
      const item = { id: v.id, name: v.name, status: v.status, releaseDate: v.release_date }
      if (v.type === 'fix') issue.fixVersions.push(item)
      else if (v.type === 'affects') issue.affectsVersions.push(item)
    }
  } catch {
    // leave versions empty if the query fails
  }

  res.json(issue)
}))

router.post('/', requireRole('Member'), asyncHandler(async (req, res) => {
  const { title, description, priority, assignee, status, issueType, sprintId, projectId, storyPoints } = req.body
  // JL-77: expanded, optional issue fields
  const reporter = optText(req.body.reporter) ?? (req.user?.email || null)
  const dueDate = optText(req.body.dueDate)
  const startDate = optText(req.body.startDate)
  const resolution = optText(req.body.resolution)
  const environment = optText(req.body.environment)
  const components = optText(req.body.components)
  const normalizedTitle = String(title || '').trim()
  const normalizedDescription = String(description || '').trim()
  const normalizedAssignee = String(assignee || '').trim()

  if (!normalizedTitle || !normalizedDescription || !normalizedAssignee) {
    res.status(400).json({ error: 'title, description, and assignee are required' })
    return
  }

  if (!validPriorities.includes(priority)) {
    res.status(400).json({ error: 'priority must be Low, Medium, or High' })
    return
  }

  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'status is invalid' })
    return
  }

  if (!validIssueTypes.includes(issueType)) {
    res.status(400).json({ error: 'issueType must be Story, Bug, or Task' })
    return
  }

  // Validate project
  let projectKey = 'PROJ'
  let resolvedProjectId = null
  if (projectId) {
    const project = await get('SELECT id, key FROM projects WHERE id = ?', [projectId])
    if (!project) {
      res.status(400).json({ error: 'Project not found' })
      return
    }
    projectKey = project.key
    resolvedProjectId = project.id
  }

  let nextSprintId = null
  if (status !== 'Backlog') {
    if (sprintId === undefined || sprintId === null || sprintId === '') {
      nextSprintId = await getDefaultSprintId()
    } else {
      const parsed = Number(sprintId)
      if (!Number.isInteger(parsed)) {
        res.status(400).json({ error: 'Invalid sprint id' })
        return
      }
      const sprintRow = await get('SELECT id FROM sprints WHERE id = ?', [parsed])
      if (!sprintRow) {
        res.status(400).json({ error: 'Sprint not found' })
        return
      }
      nextSprintId = parsed
    }
  }

  // JL-92: allocate a monotonic issue key scoped to the project. The atomic
  // increment happens here (in the same spot the old COUNT query lived) so the
  // db-mock call order in existing tests is preserved.
  const issueKey = await nextIssueKey(projectKey, resolvedProjectId)

  const normalizedStoryPoints = normalizeStoryPoints(storyPoints)
  if (normalizedStoryPoints === undefined) {
    res.status(400).json({ error: 'storyPoints must be a non-negative integer' })
    return
  }

  // JL-76: optional parent Epic assignment
  const normalizedEpicId = normalizeEpicId(req.body.epicId)
  if (normalizedEpicId === undefined) {
    res.status(400).json({ error: 'epicId must be a positive integer' })
    return
  }
  const epicError = await validateEpicRef(normalizedEpicId, issueType)
  if (epicError) {
    res.status(400).json({ error: epicError })
    return
  }

  // JL-115: enforce project field-configuration required fields. No-op (and no
  // extra query) when the issue has no project or the project has no config rows,
  // so existing create behavior is unchanged.
  const providedFields = {
    title: normalizedTitle,
    description: normalizedDescription,
    assignee: normalizedAssignee,
    priority,
    status,
    issueType,
    reporter,
    dueDate,
    startDate,
    resolution,
    environment,
    components,
    storyPoints: normalizedStoryPoints,
    sprintId: nextSprintId,
    epicId: normalizedEpicId,
    ...(req.body?.customFields && typeof req.body.customFields === 'object'
      ? Object.fromEntries(
          Object.entries(req.body.customFields).map(([k, v]) => [`custom:${k}`, v]),
        )
      : {}),
  }
  const missingRequired = await validateRequiredFields(resolvedProjectId, issueType, providedFields)
  if (missingRequired.length > 0) {
    res.status(400).json({ error: 'Missing required fields', missingFields: missingRequired })
    return
  }

  // JL-94: the issue insert, its activity-log row, and the creator auto-watch
  // must all land together or not at all — wrap them in a single transaction.
  const row = await withTransaction(async (tx) => {
    const created = await tx.run(
      'INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, story_points, epic_id, reporter, due_date, start_date, resolution, environment, components, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [issueKey, normalizedTitle, normalizedDescription, priority, normalizedAssignee, status, issueType, nextSprintId, resolvedProjectId, normalizedStoryPoints, normalizedEpicId, reporter, dueDate ?? null, startDate ?? null, resolution ?? null, environment ?? null, components ?? null],
    )

    const inserted = await tx.get(
      'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, epic_id, story_points, created_at, reporter, due_date, start_date, resolution, environment, components, updated_at FROM issues WHERE id = ?',
      [created.lastID],
    )

    await tx.run('INSERT INTO activity (actor, action, happened_at) VALUES (?, ?, ?)', [
      normalizedAssignee,
      `created ${issueKey} (${normalizedTitle})`,
      'Just now',
    ])

    // JL-43: Auto-watch on issue create for the creator
    await tx.run(
      'INSERT INTO watchers (issue_id, user_email) VALUES (?, ?) ON CONFLICT (issue_id, user_email) DO NOTHING',
      [created.lastID, req.user.email],
    )

    return inserted
  })

  // JL-59: emit issue.created event to subscribed webhooks (fire-and-forget)
  emitEvent('issue.created', mapIssue(row), resolvedProjectId).catch(() => {})

  res.status(201).json(mapIssue(row))
}))

router.patch('/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid issue id' })
    return
  }

  const existing = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, epic_id, story_points, created_at, reporter, due_date, start_date, resolution, environment, components, updated_at FROM issues WHERE id = ?',
    [id],
  )
  if (!existing) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }

  const fields = req.body
  const sets = []
  const params = []
  // JL-82: collect field-level changes to write to the audit log after UPDATE
  const changes = []

  if (fields.title !== undefined) {
    const t = String(fields.title || '').trim()
    if (!t) {
      res.status(400).json({ error: 'title cannot be empty' })
      return
    }
    sets.push('title = ?')
    params.push(t)
    changes.push({ field: 'title', oldValue: existing.title, newValue: t })
  }

  if (fields.priority !== undefined) {
    if (!validPriorities.includes(fields.priority)) {
      res.status(400).json({ error: 'priority must be Low, Medium, or High' })
      return
    }
    sets.push('priority = ?')
    params.push(fields.priority)
    changes.push({ field: 'priority', oldValue: existing.priority, newValue: fields.priority })
  }

  let newAssignee = null
  if (fields.assignee !== undefined) {
    const a = String(fields.assignee || '').trim()
    if (!a) {
      res.status(400).json({ error: 'assignee cannot be empty' })
      return
    }
    sets.push('assignee = ?')
    params.push(a)
    changes.push({ field: 'assignee', oldValue: existing.assignee, newValue: a })
    newAssignee = a
  }

  if (fields.issueType !== undefined) {
    if (!validIssueTypes.includes(fields.issueType)) {
      res.status(400).json({ error: 'issueType must be Story, Bug, or Task' })
      return
    }
    sets.push('issue_type = ?')
    params.push(fields.issueType)
    changes.push({ field: 'type', oldValue: existing.issue_type, newValue: fields.issueType })
  }

  if (fields.sprintId !== undefined) {
    if (fields.sprintId === null || fields.sprintId === '') {
      sets.push('sprint_id = ?')
      params.push(null)
      changes.push({ field: 'sprint', oldValue: existing.sprint_id, newValue: null })
    } else {
      const parsed = Number(fields.sprintId)
      if (!Number.isInteger(parsed)) {
        res.status(400).json({ error: 'Invalid sprint id' })
        return
      }
      const sprintRow = await get('SELECT id FROM sprints WHERE id = ?', [parsed])
      if (!sprintRow) {
        res.status(400).json({ error: 'Sprint not found' })
        return
      }
      sets.push('sprint_id = ?')
      params.push(parsed)
      changes.push({ field: 'sprint', oldValue: existing.sprint_id, newValue: parsed })
    }
  }

  // JL-77: expanded optional fields (nullable text/date columns)
  const optionalColumns = {
    reporter: 'reporter',
    dueDate: 'due_date',
    startDate: 'start_date',
    resolution: 'resolution',
    environment: 'environment',
    components: 'components',
  }
  for (const [field, column] of Object.entries(optionalColumns)) {
    if (fields[field] !== undefined) {
      sets.push(`${column} = ?`)
      params.push(optText(fields[field]) ?? null)
    }
  }

  if (fields.storyPoints !== undefined) {
    const normalized = normalizeStoryPoints(fields.storyPoints)
    if (normalized === undefined) {
      res.status(400).json({ error: 'storyPoints must be a non-negative integer' })
      return
    }
    sets.push('story_points = ?')
    params.push(normalized)
  }

  // JL-76: (re)assign parent Epic. Validated against the effective issue type
  // (a type change in the same PATCH is respected).
  if (fields.epicId !== undefined) {
    const normalizedEpicId = normalizeEpicId(fields.epicId)
    if (normalizedEpicId === undefined) {
      res.status(400).json({ error: 'epicId must be a positive integer' })
      return
    }
    const effectiveType = fields.issueType !== undefined ? fields.issueType : existing.issue_type
    if (normalizedEpicId !== null && normalizedEpicId === id) {
      res.status(400).json({ error: 'An issue cannot be its own Epic' })
      return
    }
    const epicError = await validateEpicRef(normalizedEpicId, effectiveType)
    if (epicError) {
      res.status(400).json({ error: epicError })
      return
    }
    sets.push('epic_id = ?')
    params.push(normalizedEpicId)
    changes.push({ field: 'epic', oldValue: existing.epic_id, newValue: normalizedEpicId })
  }

  if (sets.length === 0) {
    res.json(mapIssue(existing))
    return
  }

  // JL-77: always bump updated_at on any edit
  sets.push('updated_at = NOW()')

  params.push(id)
  await run(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`, params)

  // JL-82: write one audit-log row per field that actually changed
  for (const change of changes) {
    await recordHistory(id, change.field, change.oldValue, change.newValue, req.user?.email)
  }

  // JL-36: Auto-watch on assign — subscribe the newly assigned member (by name or email)
  if (newAssignee && newAssignee !== existing.assignee) {
    const member = await get(
      'SELECT email FROM members WHERE email = ? OR name = ? LIMIT 1',
      [newAssignee, newAssignee],
    )
    const watcherEmail = member?.email || newAssignee
    if (watcherEmail) {
      await run(
        'INSERT INTO watchers (issue_id, user_email) VALUES (?, ?) ON CONFLICT (issue_id, user_email) DO NOTHING',
        [id, watcherEmail],
      )
    }
  }

  const row = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, epic_id, story_points, created_at, reporter, due_date, start_date, resolution, environment, components, updated_at FROM issues WHERE id = ?',
    [id],
  )

  // JL-59: emit issue.updated event to subscribed webhooks (fire-and-forget)
  emitEvent('issue.updated', mapIssue(row), row?.project_id ?? null).catch(() => {})

  res.json(mapIssue(row))
}))

router.patch('/:id/status', requireRole('Member'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const { status, sprintId } = req.body

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid issue id' })
    return
  }

  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status value' })
    return
  }

  const existing = await get(
    'SELECT id, sprint_id, status, project_id, assignee, priority, resolution, reporter, environment, components FROM issues WHERE id = ?',
    [id],
  )
  if (!existing) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }

  // JL-79: enforce the project's configurable workflow. Backward compatible —
  // a project with no transitions configured allows every status change.
  const transitions = await loadTransitions(existing.project_id)
  if (!isTransitionAllowed(transitions, existing.status, status)) {
    res.status(409).json({
      error: `Transition from "${existing.status}" to "${status}" is not allowed by the workflow`,
    })
    return
  }
  const workflowTransition = findTransition(transitions, existing.status, status)
  const validationErrors = runValidators(workflowTransition, existing, req.body)
  if (validationErrors.length > 0) {
    res.status(400).json({ error: validationErrors[0], errors: validationErrors })
    return
  }

  // Theme-1 #1: block closing a parent that still has open sub-tasks
  if (status === 'Done') {
    const openSubtasks = await all(
      "SELECT id, issue_key, title, status FROM issues WHERE parent_id = ? AND status <> 'Done'",
      [id],
    )
    if (openSubtasks.length > 0) {
      res.status(409).json({ error: 'Cannot close issue with open sub-tasks', openSubtasks })
      return
    }
  }

  let nextSprintId = null
  if (status !== 'Backlog') {
    if (sprintId === undefined || sprintId === null || sprintId === '') {
      nextSprintId = existing.sprint_id ?? (await getDefaultSprintId())
    } else {
      const parsed = Number(sprintId)
      if (!Number.isInteger(parsed)) {
        res.status(400).json({ error: 'Invalid sprint id' })
        return
      }
      const sprintRow = await get('SELECT id FROM sprints WHERE id = ?', [parsed])
      if (!sprintRow) {
        res.status(400).json({ error: 'Sprint not found' })
        return
      }
      nextSprintId = parsed
    }
  }

  await run('UPDATE issues SET status = ?, sprint_id = ? WHERE id = ?', [status, nextSprintId, id])

  // JL-82: record the status transition in the per-issue audit log
  await recordHistory(id, 'status', existing.status, status, req.user?.email)

  // JL-79: apply workflow post-functions directly to the DB (loop-safe — never
  // re-invokes the engine, mirroring the automation.js pattern)
  if (workflowTransition) {
    await applyPostFunctions(workflowTransition, id, { run }).catch(() => {})
  }

  const row = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, epic_id, story_points, created_at, reporter, due_date, start_date, resolution, environment, components, updated_at FROM issues WHERE id = ?',
    [id],
  )

  await run('INSERT INTO activity (actor, action, happened_at) VALUES (?, ?, ?)', [
    row.assignee,
    `moved ${row.issue_key} to ${status.toUpperCase()}`,
    'Just now',
  ])

  // Theme-1 #8: fire status-change automation rules (non-fatal)
  await runStatusChangeAutomations(row).catch(() => {})

  // Re-read in case an automation action mutated the issue (e.g. transition/assign)
  const finalRow = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, epic_id, story_points, created_at, reporter, due_date, start_date, resolution, environment, components, updated_at FROM issues WHERE id = ?',
    [id],
  )

  // JL-59: emit issue.status_changed event to subscribed webhooks (fire-and-forget)
  emitEvent('issue.status_changed', { ...mapIssue(finalRow), status }, finalRow.project_id ?? null).catch(() => {})

  res.json(mapIssue(finalRow))
}))

// JL-82: GET /api/issues/:id/history — per-issue field change log, newest-first
router.get('/:id/history', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid issue id' })
    return
  }
  const rows = await all(
    'SELECT id, issue_id, field, old_value, new_value, actor, changed_at FROM issue_history WHERE issue_id = ? ORDER BY changed_at DESC, id DESC',
    [id],
  )
  res.json(
    rows.map((r) => ({
      id: r.id,
      issueId: r.issue_id,
      field: r.field,
      oldValue: r.old_value,
      newValue: r.new_value,
      actor: r.actor,
      changedAt: r.changed_at,
    })),
  )
}))

// JL-76: GET /api/issues/:id/epic-children — child issues of an Epic + rollup
router.get('/:id/epic-children', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid issue id' })
    return
  }
  const epic = await get('SELECT id, issue_type FROM issues WHERE id = ?', [id])
  if (!epic) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }
  const rows = await all(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, epic_id, story_points, created_at, reporter, due_date, start_date, resolution, environment, components, updated_at FROM issues WHERE epic_id = ? ORDER BY id ASC',
    [id],
  )
  const total = rows.length
  const done = rows.filter((r) => r.status === 'Done').length
  res.json({
    children: rows.map(mapIssue),
    rollup: { total, done, percent: total ? Math.round((done / total) * 100) : 0 },
  })
}))

// GET /api/issues/:parentId/subtasks — list sub-tasks + progress summary
router.get('/:parentId/subtasks', asyncHandler(async (req, res) => {
  const parentId = Number(req.params.parentId)
  if (!Number.isInteger(parentId)) {
    res.status(400).json({ error: 'Invalid issue id' })
    return
  }
  const rows = await all(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, epic_id, story_points, created_at, reporter, due_date, start_date, resolution, environment, components, updated_at FROM issues WHERE parent_id = ? ORDER BY id ASC',
    [parentId],
  )
  const total = rows.length
  const done = rows.filter((r) => r.status === 'Done').length
  res.json({
    subtasks: rows.map(mapIssue),
    progress: { total, done, percent: total ? Math.round((done / total) * 100) : 0 },
  })
}))

// POST /api/issues/:parentId/subtasks — create a sub-task under a parent
router.post('/:parentId/subtasks', requireRole('Member'), asyncHandler(async (req, res) => {
  const parentId = Number(req.params.parentId)
  const parent = await get(
    'SELECT id, assignee, status, sprint_id, project_id, parent_id FROM issues WHERE id = ?',
    [parentId],
  )
  if (!parent) {
    res.status(404).json({ error: 'Parent issue not found' })
    return
  }
  if (parent.parent_id) {
    res.status(400).json({ error: 'Cannot create a sub-task under another sub-task.' })
    return
  }

  const title = String(req.body?.title || '').trim()
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }
  const priority = validPriorities.includes(req.body?.priority) ? req.body.priority : 'Medium'
  const status = validStatuses.includes(req.body?.status) ? req.body.status : 'To Do'
  const assignee = String(req.body?.assignee || parent.assignee || 'Unassigned').trim()
  const description = String(req.body?.description || '').trim()
  const projectId = parent.project_id
  const sprintId = status === 'Backlog' ? null : parent.sprint_id

  const projectRow = projectId ? await get('SELECT key FROM projects WHERE id = ?', [projectId]) : null
  const projectKey = projectRow?.key || 'PROJ'
  // JL-92: use the monotonic per-project counter (same as the main create path)
  const issueKey = await nextIssueKey(projectKey, projectId)

  const created = await run(
    'INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [issueKey, title, description, priority, assignee, status, 'Sub-task', sprintId, projectId, parentId],
  )
  const row = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, epic_id, story_points, created_at, reporter, due_date, start_date, resolution, environment, components, updated_at FROM issues WHERE id = ?',
    [created.lastID],
  )
  res.status(201).json(mapIssue(row))
}))

// JL-121: resolve a label name to an id within a project, creating it if needed.
async function resolveLabelId(projectId, name) {
  if (!projectId) return null
  const existing = await get(
    'SELECT id FROM labels WHERE project_id = ? AND LOWER(name) = LOWER(?)',
    [projectId, name],
  )
  if (existing) return existing.id
  const created = await run(
    'INSERT INTO labels (project_id, name, color) VALUES (?, ?, ?)',
    [projectId, name, '#42526E'],
  )
  return created.lastID
}

// POST /api/issues/bulk — multi-issue change wizard backend.
// Body: { issueIds:[], operations:{ status?, assignee?, priority?, sprintId?, addLabels?, delete? }, dryRun?:bool }
// dryRun=true → return a per-issue preview and write nothing.
// dryRun=false → apply to valid issues, skipping/reporting invalid ones, and
// return a { updated, skipped, errors, results } summary. Applied sequentially,
// each guarded so one failure does not abort the batch.
router.post('/bulk', requireRole('Member'), asyncHandler(async (req, res) => {
  const body = req.body || {}
  const operations = body.operations || {}
  const dryRun = body.dryRun === true

  if (!Array.isArray(body.issueIds) || body.issueIds.length === 0) {
    res.status(400).json({ error: 'issueIds must be a non-empty array' })
    return
  }
  const ids = body.issueIds.map(Number).filter((n) => Number.isInteger(n))
  if (ids.length === 0) {
    res.status(400).json({ error: 'issueIds must contain valid integer ids' })
    return
  }

  const placeholders = ids.map(() => '?').join(', ')
  const rows = await all(
    `SELECT id, issue_key, title, priority, assignee, status, sprint_id, project_id FROM issues WHERE id IN (${placeholders})`,
    ids,
  )
  const issues = rows.map((r) => ({
    id: r.id,
    key: r.issue_key,
    title: r.title,
    priority: r.priority,
    assignee: r.assignee,
    status: r.status,
    sprintId: r.sprint_id ?? null,
    projectId: r.project_id ?? null,
  }))

  const preview = buildBulkPreview(issues, operations)

  // Flag ids that were requested but not found in the database.
  const foundIds = new Set(issues.map((i) => i.id))
  for (const id of ids) {
    if (!foundIds.has(id)) {
      preview.push({ issueId: id, key: null, delete: false, willChange: false, changes: [], error: 'Issue not found' })
    }
  }

  // Existence validation for value operations that need the db. A failure here
  // becomes a per-issue error (only for the issues whose row would change).
  let sprintError = null
  if (operations.sprintId !== undefined && operations.sprintId !== null && operations.sprintId !== '') {
    const parsed = Number(operations.sprintId)
    if (!Number.isInteger(parsed)) sprintError = 'Invalid sprint id'
    else {
      const sprintRow = await get('SELECT id FROM sprints WHERE id = ?', [parsed])
      if (!sprintRow) sprintError = 'Sprint not found'
    }
  }
  let assigneeError = null
  if (operations.assignee !== undefined && operations.assignee !== null && String(operations.assignee).trim() !== '') {
    const a = String(operations.assignee).trim()
    const member = await get('SELECT email FROM members WHERE email = ? OR name = ? LIMIT 1', [a, a])
    if (!member) assigneeError = 'Assignee not found'
  }

  if (dryRun) {
    // Surface op-level existence errors in the preview for changed issues.
    for (const item of preview) {
      if (item.error || !item.willChange) continue
      const changed = new Set(item.changes.map((c) => c.field))
      if (sprintError && changed.has('sprintId')) item.error = sprintError
      else if (assigneeError && changed.has('assignee')) item.error = assigneeError
    }
    res.json({ dryRun: true, preview })
    return
  }

  const isDelete = operations.delete === true
  const columnByField = {
    status: 'status',
    priority: 'priority',
    assignee: 'assignee',
    sprintId: 'sprint_id',
  }

  let updated = 0
  let skipped = 0
  const errors = []
  const results = []

  for (const item of preview) {
    if (item.error) {
      skipped += 1
      errors.push({ issueId: item.issueId, error: item.error })
      results.push({ issueId: item.issueId, key: item.key, applied: false, error: item.error })
      continue
    }

    const changedFields = new Set(item.changes.map((c) => c.field))
    // Apply op-level existence errors as per-issue failures.
    if (sprintError && changedFields.has('sprintId')) {
      skipped += 1
      errors.push({ issueId: item.issueId, error: sprintError })
      results.push({ issueId: item.issueId, key: item.key, applied: false, error: sprintError })
      continue
    }
    if (assigneeError && changedFields.has('assignee')) {
      skipped += 1
      errors.push({ issueId: item.issueId, error: assigneeError })
      results.push({ issueId: item.issueId, key: item.key, applied: false, error: assigneeError })
      continue
    }

    if (!item.willChange) {
      skipped += 1
      results.push({ issueId: item.issueId, key: item.key, applied: false, error: null, noop: true })
      continue
    }

    try {
      if (isDelete) {
        await run('DELETE FROM issues WHERE id = ?', [item.issueId])
        updated += 1
        results.push({ issueId: item.issueId, key: item.key, applied: true, deleted: true })
        continue
      }

      const sets = []
      const params = []
      for (const change of item.changes) {
        const column = columnByField[change.field]
        if (!column) continue
        sets.push(`${column} = ?`)
        params.push(change.to)
        await recordHistory(item.issueId, change.field === 'sprintId' ? 'sprint' : change.field, change.from, change.to, req.user?.email)
      }
      if (sets.length > 0) {
        sets.push('updated_at = NOW()')
        params.push(item.issueId)
        await run(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`, params)
      }

      // Labels are applied as a separate additive step (never removes).
      const labelChange = item.changes.find((c) => c.field === 'labels')
      if (labelChange) {
        const issueRow = issues.find((i) => i.id === item.issueId)
        for (const name of labelChange.added || []) {
          const labelId = await resolveLabelId(issueRow?.projectId, name)
          if (labelId) {
            await run(
              'INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING label_id',
              [item.issueId, labelId],
            )
          }
        }
      }

      updated += 1
      results.push({ issueId: item.issueId, key: item.key, applied: true })
    } catch (err) {
      skipped += 1
      errors.push({ issueId: item.issueId, error: err.message })
      results.push({ issueId: item.issueId, key: item.key, applied: false, error: err.message })
    }
  }

  res.json({ updated, skipped, errors, results })
}))

// DELETE /api/issues/:id — delete an issue (dependent rows cascade via FKs)
router.delete('/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid issue id' })
    return
  }
  const existing = await get('SELECT id, issue_key FROM issues WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }
  await run('DELETE FROM issues WHERE id = ?', [id])
  res.json({ success: true, id })
}))

export default router
