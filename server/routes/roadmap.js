import { Router } from 'express'
import { all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, name, phase, start_date, end_date, project_id FROM roadmap_epics ORDER BY id ASC',
  )
  res.json(rows)
}))

export default router
