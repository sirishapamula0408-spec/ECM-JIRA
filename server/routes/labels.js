import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { sendError } from '../utils/httpError.js' // JL-181: canonical { error } shape

const router = Router()

const HEX = /^#[0-9a-fA-F]{6}$/

// GET /api/projects/:projectId/labels — list labels (with issue counts); ?search= for autocomplete
router.get('/projects/:projectId/labels', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const search = String(req.query.search || '').trim()
  const params = [projectId]
  let where = 'l.project_id = ?'
  if (search) {
    where += ' AND l.name ILIKE ?'
    params.push(`%${search}%`)
  }
  const rows = await all(
    `SELECT l.id, l.project_id, l.name, l.color,
            COUNT(il.issue_id)::int AS "issueCount"
     FROM labels l
     LEFT JOIN issue_labels il ON il.label_id = l.id
     WHERE ${where}
     GROUP BY l.id
     ORDER BY l.name ASC`,
    params,
  )
  res.json(rows)
}))

// POST /api/projects/:projectId/labels — create a label
router.post('/projects/:projectId/labels', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const name = String(req.body?.name || '').trim()
  const color = String(req.body?.color || '#42526E').trim()
  if (!name) {
    return sendError(res, 400, 'Label name is required')
  }
  if (!HEX.test(color)) {
    return sendError(res, 400, 'color must be a hex value like #FF5630')
  }
  const existing = await get(
    'SELECT id, name, color FROM labels WHERE project_id = ? AND LOWER(name) = LOWER(?)',
    [projectId, name],
  )
  if (existing) {
    res.status(200).json({ ...existing, issueCount: 0, existed: true })
    return
  }
  const created = await run(
    'INSERT INTO labels (project_id, name, color) VALUES (?, ?, ?)',
    [projectId, name, color],
  )
  const row = await get('SELECT id, project_id, name, color FROM labels WHERE id = ?', [created.lastID])
  res.status(201).json({ ...row, issueCount: 0 })
}))

// PUT /api/projects/:projectId/labels/:labelId — rename and/or recolor a label (JL-199)
router.put('/projects/:projectId/labels/:labelId', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId)
  const labelId = Number(req.params.labelId)

  const label = await get(
    'SELECT id, project_id, name, color FROM labels WHERE id = ? AND project_id = ?',
    [labelId, projectId],
  )
  if (!label) {
    return sendError(res, 404, 'Label not found')
  }

  const hasName = req.body?.name !== undefined
  const hasColor = req.body?.color !== undefined
  if (!hasName && !hasColor) {
    return sendError(res, 400, 'Provide a name and/or color to update')
  }

  let name = label.name
  if (hasName) {
    name = String(req.body.name || '').trim()
    if (!name) {
      return sendError(res, 400, 'Label name is required')
    }
    // Duplicate-name guard within the project (excluding this label)
    const clash = await get(
      'SELECT id FROM labels WHERE project_id = ? AND LOWER(name) = LOWER(?) AND id <> ?',
      [projectId, name, labelId],
    )
    if (clash) {
      return sendError(res, 409, 'A label with that name already exists in this project')
    }
  }

  let color = label.color
  if (hasColor) {
    color = String(req.body.color || '').trim()
    if (!HEX.test(color)) {
      return sendError(res, 400, 'color must be a hex value like #FF5630')
    }
  }

  await run('UPDATE labels SET name = ?, color = ? WHERE id = ? AND project_id = ?', [name, color, labelId, projectId])
  const row = await get(
    `SELECT l.id, l.project_id, l.name, l.color,
            COALESCE(COUNT(il.issue_id), 0)::int AS "issueCount"
     FROM labels l
     LEFT JOIN issue_labels il ON il.label_id = l.id
     WHERE l.id = ?
     GROUP BY l.id`,
    [labelId],
  )
  res.json(row)
}))

// DELETE /api/projects/:projectId/labels/:labelId — delete a label (cascades issue_labels)
router.delete('/projects/:projectId/labels/:labelId', asyncHandler(async (req, res) => {
  const labelId = Number(req.params.labelId)
  await run('DELETE FROM labels WHERE id = ? AND project_id = ?', [labelId, Number(req.params.projectId)])
  res.json({ success: true })
}))

// GET /api/issues/:issueId/labels — labels assigned to an issue
router.get('/issues/:issueId/labels', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    `SELECT l.id, l.project_id, l.name, l.color
     FROM issue_labels il JOIN labels l ON l.id = il.label_id
     WHERE il.issue_id = ? ORDER BY l.name ASC`,
    [issueId],
  )
  res.json(rows)
}))

// PUT /api/issues/:issueId/labels — set labels for an issue (replaces existing). Body: { labelIds: [] }
router.put('/issues/:issueId/labels', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const labelIds = Array.isArray(req.body?.labelIds) ? req.body.labelIds.map(Number).filter(Number.isInteger) : []
  await run('DELETE FROM issue_labels WHERE issue_id = ?', [issueId])
  for (const labelId of labelIds) {
    await run(
      // Explicit RETURNING so the run() wrapper doesn't auto-append "RETURNING id"
      // (issue_labels has a composite PK and no id column).
      'INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING label_id',
      [issueId, labelId],
    )
  }
  const rows = await all(
    `SELECT l.id, l.project_id, l.name, l.color
     FROM issue_labels il JOIN labels l ON l.id = il.label_id
     WHERE il.issue_id = ? ORDER BY l.name ASC`,
    [issueId],
  )
  res.json(rows)
}))

export default router
