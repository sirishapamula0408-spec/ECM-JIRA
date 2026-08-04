import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { buildActivityScope } from '../services/activityScope.js'

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

  // JL-362 — cross-workspace data leak. This endpoint had NO tenant predicate:
  // any authenticated user could page the whole `activity` table and read every
  // other tenant's issue keys, titles, status transitions and member-management
  // events. The scope fragment is built once per request and applied to BOTH the
  // row query and the count query below; because it depends only on the caller
  // (never on the page), it is identical across every page of a cursor walk, so
  // JL-44's nextCursor/hasMore pagination stays consistent.
  // See server/services/activityScope.js for the full attribution rules.
  const scope = await buildActivityScope(req)

  const conditions = [scope.clause]
  const params = [...scope.params]

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
  // JL-362: `total` must count only what the caller may see — an unscoped count
  // would otherwise disclose the size of every other tenant's activity log.
  const countConditions = [scope.clause]
  const countParams = [...scope.params]
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
