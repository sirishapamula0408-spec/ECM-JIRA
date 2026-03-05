import { Router } from 'express'
import { all, get } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

router.get('/', asyncHandler(async (_req, res) => {
  const total = await get('SELECT COUNT(*) AS count FROM issues')
  const inProgress = await get("SELECT COUNT(*) AS count FROM issues WHERE status = 'In Progress'")
  const completed = await get("SELECT COUNT(*) AS count FROM issues WHERE status = 'Done'")
  const critical = await get("SELECT COUNT(*) AS count FROM issues WHERE priority = 'High'")
  const activities = await all(
    'SELECT id, actor, action, happened_at FROM activity ORDER BY id DESC LIMIT 5',
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
