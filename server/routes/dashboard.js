import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { activityScopeWhere } from '../services/activityScope.js'

const router = Router()

router.get('/', asyncHandler(async (req, res) => {
  const total = await get('SELECT COUNT(*) AS count FROM issues')
  const inProgress = await get("SELECT COUNT(*) AS count FROM issues WHERE status = 'In Progress'")
  const completed = await get("SELECT COUNT(*) AS count FROM issues WHERE status = 'Done'")
  const critical = await get("SELECT COUNT(*) AS count FROM issues WHERE priority = 'High'")
  // JL-362: the same unscoped `activity` read as GET /api/activity — the home
  // dashboard's "recent activity" strip showed the five most recent rows from
  // ANY workspace. Scoped through the shared helper so all three activity
  // readers (this, /api/activity, the recent_activity gadget) share one rule.
  const activityScope = await activityScopeWhere(req)
  const activities = await all(
    `SELECT id, actor, action, happened_at FROM activity${activityScope.where} ORDER BY id DESC LIMIT 5`,
    activityScope.params,
  )
  const team = await all(
    'SELECT id, name, role, task_count FROM members ORDER BY task_count DESC LIMIT 4',
  )

  res.json({
    metrics: {
      totalTasks: total.count,
      inProgress: inProgress.count,
      completed: completed.count,
      critical: critical.count,
    },
    activities,
    team,
  })
}))

export default router
