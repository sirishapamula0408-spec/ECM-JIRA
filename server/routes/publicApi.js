import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { apiTokenAuth, requireScope } from '../middleware/apiTokenAuth.js'

const router = Router()

// All public API endpoints require a valid API token.
router.use(apiTokenAuth)

// GET /api/public/me — identify the authenticated token holder
router.get('/me', asyncHandler(async (req, res) => {
  res.json({
    email: req.user.email,
    memberId: req.user.memberId,
    scopes: req.user.scopes,
  })
}))

// GET /api/public/projects — list projects (read scope)
router.get('/projects', requireScope('read'), asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, name, key, type, lead, created_at FROM projects ORDER BY id ASC',
  )
  res.json(rows)
}))

// GET /api/public/issues — list issues, optionally filtered by project (read scope)
router.get('/issues', requireScope('read'), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const projectId = req.query.projectId ? Number(req.query.projectId) : null

  let sql =
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, created_at FROM issues'
  const params = []
  if (projectId) {
    sql += ' WHERE project_id = ?'
    params.push(projectId)
  }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const rows = await all(sql, params)
  res.json({ issues: rows, limit, offset })
}))

// GET /api/public/issues/:id — fetch a single issue (read scope)
router.get('/issues/:id', requireScope('read'), asyncHandler(async (req, res) => {
  const row = await get(
    'SELECT id, issue_key, title, description, priority, assignee, status, issue_type, sprint_id, project_id, parent_id, created_at FROM issues WHERE id = ?',
    [Number(req.params.id)],
  )
  if (!row) {
    res.status(404).json({ error: 'Issue not found' })
    return
  }
  res.json(row)
}))

export default router
