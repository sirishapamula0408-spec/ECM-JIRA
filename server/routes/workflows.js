import { Router } from 'express'
import { all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, issue_type, workflow_name, workflow_status FROM workflows ORDER BY id ASC',
  )
  res.json(rows)
}))

export default router
