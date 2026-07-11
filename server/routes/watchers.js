import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// GET /api/issues/:issueId/watchers — list watchers for an issue
router.get('/:issueId/watchers', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  // Join with members table for name/avatar info
  const rows = await all(
    `SELECT w.id, w.issue_id, w.user_email, w.created_at, m.name AS watcher_name
     FROM watchers w LEFT JOIN members m ON m.email = w.user_email
     WHERE w.issue_id = ? ORDER BY w.created_at ASC`,
    [issueId],
  )
  const isWatching = rows.some((r) => r.user_email === req.user.email)
  res.json({ watchers: rows, isWatching, count: rows.length })
}))

// POST /api/issues/:issueId/watchers — watch an issue
router.post('/:issueId/watchers', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const email = req.user.email

  const existing = await get(
    'SELECT id FROM watchers WHERE issue_id = ? AND user_email = ?',
    [issueId, email],
  )
  if (existing) {
    res.json({ success: true, action: 'already_watching' })
    return
  }

  await run('INSERT INTO watchers (issue_id, user_email) VALUES (?, ?)', [issueId, email])
  res.status(201).json({ success: true, action: 'watching' })
}))

// DELETE /api/issues/:issueId/watchers — unwatch an issue
router.delete('/:issueId/watchers', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  await run('DELETE FROM watchers WHERE issue_id = ? AND user_email = ?', [issueId, req.user.email])
  res.json({ success: true, action: 'unwatched' })
}))

export default router
