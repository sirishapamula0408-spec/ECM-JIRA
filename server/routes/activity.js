import { Router } from 'express'
import { all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

router.get('/', asyncHandler(async (_req, res) => {
  const rows = await all(
    'SELECT id, actor, action, happened_at FROM activity ORDER BY id DESC LIMIT 10',
  )
  res.json(rows)
}))

export default router
