import { Router } from 'express'
import { asyncHandler } from '../middleware/errorHandler.js'
import { getEventCatalog } from '../services/events.js'

const router = Router()

// GET /api/events/catalog — list all emittable event types (any authenticated user)
router.get('/catalog', asyncHandler(async (_req, res) => {
  res.json(getEventCatalog())
}))

export default router
