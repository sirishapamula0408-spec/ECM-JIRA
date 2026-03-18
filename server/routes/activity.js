import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// GET /api/activity — filterable, paginated activity feed
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 100)
  const offset = Number(req.query.offset) || 0
  const activityType = req.query.type || null
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  const actor = req.query.actor || null

  const conditions = []
  const params = []

  if (activityType) {
    conditions.push('activity_type = ?')
    params.push(activityType)
  }
  if (projectId) {
    conditions.push('project_id = ?')
    params.push(projectId)
  }
  if (actor) {
    conditions.push('actor = ?')
    params.push(actor)
  }

  let sql = 'SELECT id, actor, action, happened_at, activity_type, project_id, issue_id, created_at FROM activity'
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const rows = await all(sql, params)

  // Total count for pagination
  let countSql = 'SELECT COUNT(*) AS count FROM activity'
  const countParams = []
  if (conditions.length > 0) {
    const countConditions = []
    if (activityType) { countConditions.push('activity_type = ?'); countParams.push(activityType) }
    if (projectId) { countConditions.push('project_id = ?'); countParams.push(projectId) }
    if (actor) { countConditions.push('actor = ?'); countParams.push(actor) }
    countSql += ` WHERE ${countConditions.join(' AND ')}`
  }
  const countRow = await get(countSql, countParams)

  res.json({ activities: rows, total: Number(countRow.count), limit, offset })
}))

export default router
