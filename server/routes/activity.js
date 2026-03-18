import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// GET /api/activity — filterable, paginated activity feed with cursor support
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 100)
  const offset = Number(req.query.offset) || 0
  const cursor = req.query.cursor ? Number(req.query.cursor) : null
  const activityType = req.query.type || null
  const projectId = req.query.projectId ? Number(req.query.projectId) : null
  const actor = req.query.actor || null
  const dateFrom = req.query.dateFrom || null
  const dateTo = req.query.dateTo || null

  const conditions = []
  const params = []

  if (cursor) {
    conditions.push('id < ?')
    params.push(cursor)
  }
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
  if (dateFrom) {
    conditions.push('created_at >= ?')
    params.push(dateFrom)
  }
  if (dateTo) {
    conditions.push('created_at <= ?')
    params.push(dateTo)
  }

  let sql = 'SELECT id, actor, action, happened_at, activity_type, project_id, issue_id, created_at FROM activity'
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }
  sql += ' ORDER BY id DESC LIMIT ?'
  params.push(limit + 1) // fetch one extra to determine hasMore

  // Use offset only when no cursor
  if (!cursor && offset > 0) {
    sql += ' OFFSET ?'
    params.push(offset)
  }

  const rows = await all(sql, params)
  const hasMore = rows.length > limit
  const activities = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = activities.length > 0 ? activities[activities.length - 1].id : null

  // Total count for pagination info
  const countConditions = []
  const countParams = []
  if (activityType) { countConditions.push('activity_type = ?'); countParams.push(activityType) }
  if (projectId) { countConditions.push('project_id = ?'); countParams.push(projectId) }
  if (actor) { countConditions.push('actor = ?'); countParams.push(actor) }
  if (dateFrom) { countConditions.push('created_at >= ?'); countParams.push(dateFrom) }
  if (dateTo) { countConditions.push('created_at <= ?'); countParams.push(dateTo) }
  let countSql = 'SELECT COUNT(*) AS count FROM activity'
  if (countConditions.length > 0) {
    countSql += ` WHERE ${countConditions.join(' AND ')}`
  }
  const countRow = await get(countSql, countParams)

  res.json({
    activities,
    total: Number(countRow.count),
    limit,
    offset,
    hasMore,
    nextCursor,
  })
}))

export default router
