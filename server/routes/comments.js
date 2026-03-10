import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

// GET /api/issues/:issueId/comments
router.get('/:issueId/comments', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    'SELECT id, issue_id, author, text, created_at FROM comments WHERE issue_id = ? ORDER BY created_at DESC',
    [issueId],
  )
  res.json(rows)
}))

// POST /api/issues/:issueId/comments
router.post('/:issueId/comments', requireRole('Member'), asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const { author, text } = req.body
  const normalizedAuthor = String(author || '').trim()
  const normalizedText = String(text || '').trim()

  if (!normalizedText) {
    res.status(400).json({ error: 'Comment text is required' })
    return
  }

  const created = await run(
    'INSERT INTO comments (issue_id, author, text) VALUES (?, ?, ?)',
    [issueId, normalizedAuthor || 'Unknown', normalizedText],
  )
  const row = await get('SELECT id, issue_id, author, text, created_at FROM comments WHERE id = ?', [created.lastID])
  res.status(201).json(row)
}))

export default router
