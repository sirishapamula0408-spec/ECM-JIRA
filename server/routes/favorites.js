import { Router } from 'express'
import { all, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// GET /api/favorites — the caller's favorited project ids
router.get('/favorites', asyncHandler(async (req, res) => {
  const rows = await all(
    'SELECT project_id FROM project_favorites WHERE user_email = ? ORDER BY created_at DESC',
    [req.user.email],
  )
  res.json({ projectIds: rows.map((r) => r.project_id) })
}))

// POST /api/projects/:id/favorite — star a project (idempotent)
router.post('/projects/:id/favorite', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  await run(
    'INSERT INTO project_favorites (project_id, user_email) VALUES (?, ?) ON CONFLICT (project_id, user_email) DO NOTHING',
    [projectId, req.user.email],
  )
  res.status(201).json({ success: true, favorited: true })
}))

// DELETE /api/projects/:id/favorite — unstar a project
router.delete('/projects/:id/favorite', asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id)
  await run(
    'DELETE FROM project_favorites WHERE project_id = ? AND user_email = ?',
    [projectId, req.user.email],
  )
  res.json({ success: true, favorited: false })
}))

export default router
