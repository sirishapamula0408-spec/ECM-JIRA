import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// ----- JQL parser -----
const FIELD_MAP = {
  status: 'status',
  priority: 'priority',
  type: 'issue_type',
  issuetype: 'issue_type',
  issue_type: 'issue_type',
  assignee: 'assignee',
  summary: 'title',
  title: 'title',
  project: 'project_id',
  key: 'issue_key',
  sprint: 'sprint_id',
}

const ORDER_FIELD_MAP = {
  ...FIELD_MAP,
  created: 'created_at',
  createdat: 'created_at',
  created_at: 'created_at',
  id: 'id',
}

function parseJql(jql) {
  const conditions = []
  const params = []
  let orderBy = null

  // Extract ORDER BY clause
  const orderMatch = jql.match(/\bORDER\s+BY\s+(.+)$/i)
  let filterPart = jql
  if (orderMatch) {
    filterPart = jql.slice(0, orderMatch.index).trim()
    const orderFields = orderMatch[1].split(',').map((f) => {
      const parts = f.trim().split(/\s+/)
      const field = ORDER_FIELD_MAP[parts[0].toLowerCase()]
      if (!field) throw new Error(`Unknown ORDER BY field: "${parts[0]}"`)
      const dir = parts[1] && parts[1].toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
      return `${field} ${dir}`
    })
    orderBy = orderFields.join(', ')
  }

  if (!filterPart) return { conditions, params, orderBy }

  // Split by AND (top-level only)
  const clauses = filterPart.split(/\bAND\b/i).map((c) => c.trim()).filter(Boolean)

  for (const clause of clauses) {
    // Match: field operator value
    // Operators: =, !=, ~, !~, IN, NOT IN, IS, IS NOT
    const inMatch = clause.match(/^(\w+)\s+(NOT\s+IN|IN)\s*\((.+)\)$/i)
    if (inMatch) {
      const field = FIELD_MAP[inMatch[1].toLowerCase()]
      if (!field) throw new Error(`Unknown field: "${inMatch[1]}"`)
      const op = inMatch[2].toUpperCase()
      const values = inMatch[3].split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''))
      const placeholders = values.map(() => '?').join(', ')
      conditions.push(`${field} ${op === 'IN' ? 'IN' : 'NOT IN'} (${placeholders})`)
      params.push(...values)
      continue
    }

    const isMatch = clause.match(/^(\w+)\s+(IS\s+NOT|IS)\s+(.+)$/i)
    if (isMatch) {
      const field = FIELD_MAP[isMatch[1].toLowerCase()]
      if (!field) throw new Error(`Unknown field: "${isMatch[1]}"`)
      const val = isMatch[3].trim().replace(/^["']|["']$/g, '')
      if (val.toUpperCase() === 'EMPTY' || val.toUpperCase() === 'NULL') {
        conditions.push(isMatch[2].toUpperCase().includes('NOT') ? `${field} IS NOT NULL AND ${field} != ''` : `(${field} IS NULL OR ${field} = '')`)
      } else {
        throw new Error(`Invalid IS expression: "${clause}"`)
      }
      continue
    }

    const opMatch = clause.match(/^(\w+)\s*(!=|!~|~|=)\s*(.+)$/)
    if (opMatch) {
      const field = FIELD_MAP[opMatch[1].toLowerCase()]
      if (!field) throw new Error(`Unknown field: "${opMatch[1]}"`)
      const operator = opMatch[2]
      const value = opMatch[3].trim().replace(/^["']|["']$/g, '')

      if (operator === '=') {
        conditions.push(`${field} = ?`)
        params.push(value)
      } else if (operator === '!=') {
        conditions.push(`${field} != ?`)
        params.push(value)
      } else if (operator === '~') {
        conditions.push(`LOWER(${field}) LIKE ?`)
        params.push(`%${value.toLowerCase()}%`)
      } else if (operator === '!~') {
        conditions.push(`LOWER(${field}) NOT LIKE ?`)
        params.push(`%${value.toLowerCase()}%`)
      }
      continue
    }

    throw new Error(`Could not parse clause: "${clause}"`)
  }

  return { conditions, params, orderBy }
}

function mapFilter(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerEmail: row.owner_email,
    criteria: typeof row.criteria === 'string' ? JSON.parse(row.criteria || '{}') : (row.criteria || {}),
    isStarred: Boolean(row.is_starred),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// List filters for the current user
router.get('/', asyncHandler(async (req, res) => {
  const email = req.user?.email
  const rows = await all(
    'SELECT * FROM filters WHERE owner_email = ? ORDER BY is_starred DESC, updated_at DESC',
    [email],
  )
  res.json(rows.map(mapFilter))
}))

// Create a new filter
router.post('/', asyncHandler(async (req, res) => {
  const email = req.user?.email
  const { name, description, criteria } = req.body
  const trimmedName = String(name || '').trim()

  if (!trimmedName) {
    res.status(400).json({ error: 'Filter name is required' })
    return
  }

  const criteriaJson = JSON.stringify(criteria || {})

  const result = await run(
    'INSERT INTO filters (name, description, owner_email, criteria) VALUES (?, ?, ?, ?::jsonb)',
    [trimmedName, String(description || '').trim(), email, criteriaJson],
  )

  const row = await get('SELECT * FROM filters WHERE id = ?', [result.lastID])
  res.status(201).json(mapFilter(row))
}))

// Update a filter
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const email = req.user?.email
  const existing = await get('SELECT * FROM filters WHERE id = ? AND owner_email = ?', [id, email])

  if (!existing) {
    res.status(404).json({ error: 'Filter not found' })
    return
  }

  const { name, description, criteria, isStarred } = req.body
  const updatedName = name !== undefined ? String(name).trim() : existing.name
  const updatedDesc = description !== undefined ? String(description).trim() : existing.description
  const updatedCriteria = criteria !== undefined ? JSON.stringify(criteria) : (typeof existing.criteria === 'string' ? existing.criteria : JSON.stringify(existing.criteria))
  const updatedStarred = isStarred !== undefined ? Boolean(isStarred) : existing.is_starred

  await run(
    'UPDATE filters SET name = ?, description = ?, criteria = ?::jsonb, is_starred = ?, updated_at = NOW() WHERE id = ?',
    [updatedName, updatedDesc, updatedCriteria, updatedStarred, id],
  )

  const row = await get('SELECT * FROM filters WHERE id = ?', [id])
  res.json(mapFilter(row))
}))

// Delete a filter
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const email = req.user?.email
  const existing = await get('SELECT * FROM filters WHERE id = ? AND owner_email = ?', [id, email])

  if (!existing) {
    res.status(404).json({ error: 'Filter not found' })
    return
  }

  await run('DELETE FROM filters WHERE id = ?', [id])
  res.json({ ok: true })
}))

// ----- Natural language (Ask AI) parser -----
function parseNaturalLanguage(text) {
  const lower = text.toLowerCase()
  const conditions = []
  const params = []
  const interpreted = []

  // Status detection
  const statusMap = {
    'in progress': 'In Progress',
    'in-progress': 'In Progress',
    'inprogress': 'In Progress',
    'to do': 'To Do',
    'todo': 'To Do',
    'to-do': 'To Do',
    'backlog': 'Backlog',
    'done': 'Done',
    'completed': 'Done',
    'complete': 'Done',
    'finished': 'Done',
    'resolved': 'Done',
    'code review': 'Code Review',
    'code-review': 'Code Review',
    'review': 'Code Review',
    'in review': 'Code Review',
  }
  for (const [keyword, status] of Object.entries(statusMap)) {
    if (lower.includes(keyword)) {
      conditions.push('status = ?')
      params.push(status)
      interpreted.push(`Status = "${status}"`)
      break
    }
  }

  // Priority detection
  const priorityMap = {
    'critical': 'High',
    'urgent': 'High',
    'high priority': 'High',
    'high-priority': 'High',
    'priority high': 'High',
    'p1': 'High',
    'medium priority': 'Medium',
    'medium-priority': 'Medium',
    'priority medium': 'Medium',
    'normal priority': 'Medium',
    'p2': 'Medium',
    'low priority': 'Low',
    'low-priority': 'Low',
    'priority low': 'Low',
    'minor': 'Low',
    'p3': 'Low',
  }
  // Check multi-word patterns first
  let priorityFound = false
  for (const [keyword, priority] of Object.entries(priorityMap)) {
    if (lower.includes(keyword)) {
      conditions.push('priority = ?')
      params.push(priority)
      interpreted.push(`Priority = "${priority}"`)
      priorityFound = true
      break
    }
  }
  // Fallback: standalone high/medium/low near "priority" context or standalone
  if (!priorityFound) {
    const prioMatch = lower.match(/\b(high|medium|low)\b/)
    if (prioMatch) {
      const val = prioMatch[1].charAt(0).toUpperCase() + prioMatch[1].slice(1)
      conditions.push('priority = ?')
      params.push(val)
      interpreted.push(`Priority = "${val}"`)
    }
  }

  // Issue type detection
  const typeMap = {
    'bugs': 'Bug',
    'bug': 'Bug',
    'defect': 'Bug',
    'defects': 'Bug',
    'error': 'Bug',
    'errors': 'Bug',
    'issue': 'Bug',
    'stories': 'Story',
    'story': 'Story',
    'user story': 'Story',
    'user stories': 'Story',
    'feature': 'Story',
    'features': 'Story',
    'tasks': 'Task',
    'task': 'Task',
  }
  for (const [keyword, issueType] of Object.entries(typeMap)) {
    // Match whole word
    const regex = new RegExp(`\\b${keyword}\\b`)
    if (regex.test(lower)) {
      conditions.push('issue_type = ?')
      params.push(issueType)
      interpreted.push(`Type = "${issueType}"`)
      break
    }
  }

  // Assignee detection: "assigned to X", "assignee X", "by X", "for X"
  const assigneePatterns = [
    /assigned\s+to\s+["']?([a-z0-9@._\s]+?)["']?(?:\s+(?:with|and|in|on|that|who|which|status|priority|type)|$)/i,
    /assignee\s*[=:is]*\s*["']?([a-z0-9@._\s]+?)["']?(?:\s+(?:with|and|in|on|that|who|which|status|priority|type)|$)/i,
    /(?:owned|created|reported)\s+by\s+["']?([a-z0-9@._\s]+?)["']?(?:\s+(?:with|and|in|on|that|who|which|status|priority|type)|$)/i,
  ]
  for (const pattern of assigneePatterns) {
    const match = text.match(pattern)
    if (match) {
      const assignee = match[1].trim()
      if (assignee && assignee.length > 1) {
        conditions.push('LOWER(assignee) LIKE ?')
        params.push(`%${assignee.toLowerCase()}%`)
        interpreted.push(`Assignee contains "${assignee}"`)
        break
      }
    }
  }

  // Text / keyword search: "about X", "containing X", "mentioning X", "related to X", "with title X"
  const textPatterns = [
    /(?:about|containing|contains|mentioning|mentions|related to|with title|titled|called|named|regarding|involving)\s+["'](.+?)["']/i,
    /(?:about|containing|contains|mentioning|mentions|related to|with title|titled|called|named|regarding|involving)\s+(\S+(?:\s+\S+){0,3}?)(?:\s+(?:and|assigned|with|in|status|priority|type)|$)/i,
  ]
  for (const pattern of textPatterns) {
    const match = text.match(pattern)
    if (match) {
      const term = match[1].trim()
      if (term && term.length > 1) {
        const termLower = `%${term.toLowerCase()}%`
        conditions.push('(LOWER(issue_key) LIKE ? OR LOWER(title) LIKE ?)')
        params.push(termLower, termLower)
        interpreted.push(`Text contains "${term}"`)
        break
      }
    }
  }

  // "unassigned" detection
  if (/\bunassigned\b/.test(lower)) {
    conditions.push("(assignee IS NULL OR assignee = '')")
    interpreted.push('Assignee is empty')
  }

  // "my issues" / "assigned to me" - can't resolve user here, skip
  // "overdue", "recent", "latest", "oldest" - ordering hints
  let orderBy = 'id DESC'
  if (/\b(latest|newest|recent|recently)\b/.test(lower)) {
    orderBy = 'created_at DESC'
    interpreted.push('Sorted by newest first')
  } else if (/\b(oldest|earliest|first)\b/.test(lower)) {
    orderBy = 'created_at ASC'
    interpreted.push('Sorted by oldest first')
  }

  return { conditions, params, orderBy, interpreted }
}

// Ask AI — natural language search
router.post('/ai-search', asyncHandler(async (req, res) => {
  const { query } = req.body || {}
  if (!query || !query.trim()) {
    res.status(400).json({ error: 'Please describe what you are looking for.' })
    return
  }

  try {
    const { conditions, params, orderBy, interpreted } = parseNaturalLanguage(query.trim())
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
    const sql = `SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at FROM issues${where} ORDER BY ${orderBy}`

    const rows = await all(sql, params)
    res.json({
      interpreted,
      issues: rows.map((row) => ({
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
      })),
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}))

// Parse and execute a JQL query
router.post('/jql', asyncHandler(async (req, res) => {
  const { jql } = req.body || {}
  if (!jql || !jql.trim()) {
    res.status(400).json({ error: 'JQL query is required' })
    return
  }

  try {
    const { conditions, params, orderBy } = parseJql(jql.trim())
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
    const order = orderBy || 'id DESC'
    const sql = `SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at FROM issues${where} ORDER BY ${order}`

    const rows = await all(sql, params)
    res.json(rows.map((row) => ({
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
    })))
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
}))

// Execute a filter — returns matching issues
router.post('/search', asyncHandler(async (req, res) => {
  const { status, priority, issueType, assignee, projectId, text } = req.body || {}

  const conditions = []
  const params = []

  if (status && status !== 'All') {
    conditions.push('status = ?')
    params.push(status)
  }
  if (priority && priority !== 'All') {
    conditions.push('priority = ?')
    params.push(priority)
  }
  if (issueType && issueType !== 'All') {
    conditions.push('issue_type = ?')
    params.push(issueType)
  }
  if (assignee && assignee.trim()) {
    conditions.push('LOWER(assignee) LIKE ?')
    params.push(`%${assignee.trim().toLowerCase()}%`)
  }
  if (projectId) {
    conditions.push('project_id = ?')
    params.push(Number(projectId))
  }
  if (text && text.trim()) {
    const term = `%${text.trim().toLowerCase()}%`
    conditions.push('(LOWER(issue_key) LIKE ? OR LOWER(title) LIKE ?)')
    params.push(term, term)
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const sql = `SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, created_at FROM issues${where} ORDER BY id DESC`

  const rows = await all(sql, params)
  res.json(rows.map((row) => ({
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
  })))
}))

export default router
