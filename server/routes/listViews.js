import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// Known/allowed column keys for the issue list / search results.
// Any submitted column must be one of these; unknown keys are rejected (400).
export const ALLOWED_COLUMNS = [
  'key',
  'summary',
  'status',
  'priority',
  'assignee',
  'reporter',
  'issueType',
  'labels',
  'updated',
  'created',
  'dueDate',
  'storyPoints',
  // JL-255: extra keys used by the List page's own column model so its
  // configuration can be persisted verbatim through saved views.
  'type',
  'comments',
  'sprint',
  'label',
]

// Sensible default column set (order matters).
export const DEFAULT_COLUMNS = ['key', 'summary', 'status', 'priority', 'assignee', 'updated']

function mapView(row) {
  return {
    id: row.id,
    name: row.name,
    ownerEmail: row.owner_email,
    columns: typeof row.columns === 'string' ? JSON.parse(row.columns || '[]') : (row.columns || []),
    filterJql: row.filter_jql ?? null,
    projectId: row.project_id ?? null,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Validate a submitted columns array against the allow-list.
// Returns { columns } on success or { error } on failure.
function validateColumns(columns) {
  if (!Array.isArray(columns)) {
    return { error: 'columns must be an array' }
  }
  if (columns.length === 0) {
    return { error: 'At least one column is required' }
  }
  const seen = new Set()
  for (const col of columns) {
    if (typeof col !== 'string' || !ALLOWED_COLUMNS.includes(col)) {
      return { error: `Unknown column key: "${col}"` }
    }
    if (seen.has(col)) {
      return { error: `Duplicate column key: "${col}"` }
    }
    seen.add(col)
  }
  return { columns }
}

// List the current user's views. When a `projectId` query param is supplied the
// list is scoped to that project (List page, JL-255); otherwise only global
// views (project_id IS NULL, e.g. Filters/search page) are returned.
router.get('/', asyncHandler(async (req, res) => {
  const email = req.user?.email
  const rawProjectId = req.query.projectId
  const projectId = rawProjectId != null && rawProjectId !== '' ? Number(rawProjectId) : null

  let rows
  if (projectId != null && Number.isFinite(projectId)) {
    rows = await all(
      'SELECT * FROM list_views WHERE owner_email = ? AND project_id = ? ORDER BY is_default DESC, updated_at DESC',
      [email, projectId],
    )
  } else {
    rows = await all(
      'SELECT * FROM list_views WHERE owner_email = ? AND project_id IS NULL ORDER BY is_default DESC, updated_at DESC',
      [email],
    )
  }
  res.json(rows.map(mapView))
}))

// Return the allowed column catalog + default set (for the column picker)
router.get('/columns', asyncHandler(async (_req, res) => {
  res.json({ allowed: ALLOWED_COLUMNS, defaults: DEFAULT_COLUMNS })
}))

// Create a new view
router.post('/', asyncHandler(async (req, res) => {
  const email = req.user?.email
  const { name, columns, filterJql, isDefault, projectId } = req.body || {}
  const trimmedName = String(name || '').trim()
  const scopedProjectId = projectId != null && projectId !== '' && Number.isFinite(Number(projectId))
    ? Number(projectId)
    : null

  if (!trimmedName) {
    res.status(400).json({ error: 'View name is required' })
    return
  }

  const { columns: validColumns, error } = validateColumns(columns)
  if (error) {
    res.status(400).json({ error })
    return
  }

  const makeDefault = Boolean(isDefault)
  // Setting this view as default unsets any other default within the same scope
  // (per-project when scoped, else across the user's global views).
  if (makeDefault) {
    if (scopedProjectId != null) {
      await run('UPDATE list_views SET is_default = FALSE WHERE owner_email = ? AND project_id = ?', [email, scopedProjectId])
    } else {
      await run('UPDATE list_views SET is_default = FALSE WHERE owner_email = ? AND project_id IS NULL', [email])
    }
  }

  const result = await run(
    'INSERT INTO list_views (owner_email, name, columns, filter_jql, is_default, project_id) VALUES (?, ?, ?::jsonb, ?, ?, ?)',
    [email, trimmedName, JSON.stringify(validColumns), filterJql ? String(filterJql) : null, makeDefault, scopedProjectId],
  )

  const row = await get('SELECT * FROM list_views WHERE id = ?', [result.lastID])
  res.status(201).json(mapView(row))
}))

// Update a view (rename / update columns / set default) — owner only
router.patch('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const email = req.user?.email

  const existing = await get('SELECT * FROM list_views WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'View not found' })
    return
  }
  if (existing.owner_email !== email) {
    res.status(403).json({ error: 'You do not own this view' })
    return
  }

  const { name, columns, filterJql, isDefault } = req.body || {}

  let updatedColumns = existing.columns
  if (columns !== undefined) {
    const { columns: validColumns, error } = validateColumns(columns)
    if (error) {
      res.status(400).json({ error })
      return
    }
    updatedColumns = JSON.stringify(validColumns)
  } else if (typeof updatedColumns !== 'string') {
    updatedColumns = JSON.stringify(updatedColumns)
  }

  const updatedName = name !== undefined ? String(name).trim() : existing.name
  if (!updatedName) {
    res.status(400).json({ error: 'View name is required' })
    return
  }
  const updatedFilter = filterJql !== undefined ? (filterJql ? String(filterJql) : null) : existing.filter_jql
  const makeDefault = isDefault !== undefined ? Boolean(isDefault) : Boolean(existing.is_default)

  // Setting this view as default unsets any other default within the same scope
  // (per-project when the view is project-scoped, else across global views).
  if (makeDefault && !existing.is_default) {
    if (existing.project_id != null) {
      await run('UPDATE list_views SET is_default = FALSE WHERE owner_email = ? AND project_id = ?', [email, existing.project_id])
    } else {
      await run('UPDATE list_views SET is_default = FALSE WHERE owner_email = ? AND project_id IS NULL', [email])
    }
  }

  await run(
    'UPDATE list_views SET name = ?, columns = ?::jsonb, filter_jql = ?, is_default = ?, updated_at = NOW() WHERE id = ?',
    [updatedName, updatedColumns, updatedFilter, makeDefault, id],
  )

  const row = await get('SELECT * FROM list_views WHERE id = ?', [id])
  res.json(mapView(row))
}))

// Delete a view — owner only
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const email = req.user?.email

  const existing = await get('SELECT * FROM list_views WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'View not found' })
    return
  }
  if (existing.owner_email !== email) {
    res.status(403).json({ error: 'You do not own this view' })
    return
  }

  await run('DELETE FROM list_views WHERE id = ?', [id])
  res.json({ ok: true })
}))

export default router
