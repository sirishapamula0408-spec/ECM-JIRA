import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

// JL-214: Issue voting — mirrors the watchers pattern (server/routes/watchers.js).
// issue_votes has a composite PK (issue_id, user_email), so INSERTs use an
// explicit RETURNING issue_id (the run() wrapper would otherwise inject RETURNING id).

async function getVoteCount(issueId) {
  const row = await get('SELECT COUNT(*) AS count FROM issue_votes WHERE issue_id = ?', [issueId])
  return Number(row?.count ?? 0)
}

// GET /api/issues/:issueId/votes — vote count, voters, and whether the current user voted
router.get('/:issueId/votes', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const rows = await all(
    `SELECT v.issue_id, v.user_email, v.created_at, m.name AS voter_name
     FROM issue_votes v LEFT JOIN members m ON m.email = v.user_email
     WHERE v.issue_id = ? ORDER BY v.created_at ASC`,
    [issueId],
  )
  const hasVoted = rows.some((r) => r.user_email === req.user.email)
  res.json({ voters: rows, count: rows.length, hasVoted })
}))

// POST /api/issues/:issueId/votes — vote (idempotent via ON CONFLICT DO NOTHING)
router.post('/:issueId/votes', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  const result = await run(
    `INSERT INTO issue_votes (issue_id, user_email) VALUES (?, ?)
     ON CONFLICT (issue_id, user_email) DO NOTHING RETURNING issue_id`,
    [issueId, req.user.email],
  )
  const created = (result?.changes ?? 0) > 0
  const count = await getVoteCount(issueId)
  res.status(created ? 201 : 200).json({
    success: true,
    action: created ? 'voted' : 'already_voted',
    hasVoted: true,
    count,
  })
}))

// DELETE /api/issues/:issueId/votes — remove own vote (no-op 200 when not voted)
router.delete('/:issueId/votes', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.issueId)
  await run('DELETE FROM issue_votes WHERE issue_id = ? AND user_email = ?', [issueId, req.user.email])
  const count = await getVoteCount(issueId)
  res.json({ success: true, action: 'unvoted', hasVoted: false, count })
}))

export default router
