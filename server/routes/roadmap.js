import { Router } from 'express'
import { all } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { projectScope } from '../middleware/authorize.js'

const router = Router()

// JL-193: narrowed to the caller's projects (plus project-less epics); it
// listed every project's roadmap to anyone signed in.
router.get('/', asyncHandler(async (req, res) => {
  const scope = await projectScope(req.user)
  const rows = await all(
    `SELECT id, name, phase, start_date, end_date, project_id FROM roadmap_epics WHERE ${scope.clause} ORDER BY id ASC`,
    scope.params,
  )
  res.json(rows)
}))

export default router
