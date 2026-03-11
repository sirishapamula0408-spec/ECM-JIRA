import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { validStatuses, validPriorities, validIssueTypes } from '../middleware/validate.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

function mapIssue(row) {
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
    createdAt: row.created_at,
  }
}

async function getDefaultSprintId() {
  const sprint = await get('SELECT id FROM sprints ORDER BY id ASC LIMIT 1')
  return sprint?.id ?? null
}

router.get('/', asyncHandler(async (req, res) => {
  const status = req.query.status
  const params = []
  let sql =
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at FROM issues'

  if (status) {
    sql += ' WHERE status = ?'
    params.push(status)
  }

  sql += ' ORDER BY id DESC'
  const rows = await all(sql, params)
  res.json(rows.map(mapIssue))
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid issue id' })
    return
  }

  const row = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at FROM issues WHERE id = ?',
    [id],
  )

  if (!row) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }

  res.json(mapIssue(row))
}))

router.post('/', requireRole('Member'), asyncHandler(async (req, res) => {
  const { title, description, priority, assignee, status, issueType, sprintId, projectId } = req.body
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

  // Generate issue key scoped to project
  const count = resolvedProjectId
    ? await get('SELECT COUNT(*) AS count FROM issues WHERE project_id = ?', [resolvedProjectId])
    : await get('SELECT COUNT(*) AS count FROM issues')
  const issueKey = `${projectKey}-${count.count + 1}`
  const created = await run(
    'INSERT INTO issues (issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [issueKey, normalizedTitle, normalizedDescription, priority, normalizedAssignee, status, issueType, nextSprintId, resolvedProjectId],
  )

  const row = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at FROM issues WHERE id = ?',
    [created.lastID],
  )

  await run('INSERT INTO activity (actor, action, happened_at) VALUES (?, ?, ?)', [
    normalizedAssignee,
    `created ${issueKey} (${normalizedTitle})`,
    'Just now',
  ])

  res.status(201).json(mapIssue(row))
}))

router.patch('/:id', requireRole('Member'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid issue id' })
    return
  }

  const existing = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at FROM issues WHERE id = ?',
    [id],
  )
  if (!existing) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }

  const fields = req.body
  const sets = []
  const params = []

  if (fields.priority !== undefined) {
    if (!validPriorities.includes(fields.priority)) {
      res.status(400).json({ error: 'priority must be Low, Medium, or High' })
      return
    }
    sets.push('priority = ?')
    params.push(fields.priority)
  }

  if (fields.assignee !== undefined) {
    const a = String(fields.assignee || '').trim()
    if (!a) {
      res.status(400).json({ error: 'assignee cannot be empty' })
      return
    }
    sets.push('assignee = ?')
    params.push(a)
  }

  if (fields.issueType !== undefined) {
    if (!validIssueTypes.includes(fields.issueType)) {
      res.status(400).json({ error: 'issueType must be Story, Bug, or Task' })
      return
    }
    sets.push('issue_type = ?')
    params.push(fields.issueType)
  }

  if (fields.sprintId !== undefined) {
    if (fields.sprintId === null || fields.sprintId === '') {
      sets.push('sprint_id = ?')
      params.push(null)
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
    }
  }

  if (sets.length === 0) {
    res.json(mapIssue(existing))
    return
  }

  params.push(id)
  await run(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`, params)

  const row = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at FROM issues WHERE id = ?',
    [id],
  )
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

  const existing = await get('SELECT id, sprint_id FROM issues WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Issue not found' })
    return
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

  const row = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at FROM issues WHERE id = ?',
    [id],
  )

  await run('INSERT INTO activity (actor, action, happened_at) VALUES (?, ?, ?)', [
    row.assignee,
    `moved ${row.issue_key} to ${status.toUpperCase()}`,
    'Just now',
  ])

  res.json(mapIssue(row))
}))

export default router
