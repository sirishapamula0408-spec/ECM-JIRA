import { Router } from 'express'
import { all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all('SELECT priority FROM issues')
  const total = rows.length || 1
  const critical = rows.filter((row) => row.priority === 'High').length
  const medium = rows.filter((row) => row.priority === 'Medium').length
  const low = rows.filter((row) => row.priority === 'Low').length

  res.json({
    totalPoints: 452,
    velocityAverage: 42.5,
    completionRate: 94,
    sprintProgress: 68,
    priorityDistribution: {
      critical: Math.round((critical / total) * 100),
      high: 25,
      medium: Math.round((medium / total) * 100),
      low: Math.round((low / total) * 100),
    },
  })
}))

export default router
