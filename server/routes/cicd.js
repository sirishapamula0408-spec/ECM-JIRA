import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { requireRole } from '../middleware/authorize.js'

const router = Router()

export const CI_STATUSES = ['pending', 'running', 'success', 'failed', 'canceled']

const ISSUE_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/

/**
 * Parse the first issue key (e.g. "JL-56") out of an arbitrary text such as a
 * branch name, commit ref/message. Returns the uppercased key or null.
 */
export function parseIssueKey(text) {
  if (!text || typeof text !== 'string') return null
  const match = text.match(ISSUE_KEY_RE)
  return match ? match[0] : null
}

// POST /api/ci/status — ingest a CI/CD build status payload.
router.post('/ci/status', requireRole('Member'), asyncHandler(async (req, res) => {
  const {
    pipeline, branch, commit_ref, status, url, duration_seconds, message,
  } = req.body || {}

  const normalizedStatus = String(status || '').trim().toLowerCase()
  if (!CI_STATUSES.includes(normalizedStatus)) {
    res.status(400).json({ error: `status must be one of: ${CI_STATUSES.join(', ')}` })
    return
  }

  // Resolve the target issue: explicit issue_id wins, otherwise parse a key
  // from branch / commit_ref / message.
  let issue = null
  const explicitId = Number(req.body?.issue_id)
  if (Number.isInteger(explicitId) && explicitId > 0) {
    issue = await get('SELECT id FROM issues WHERE id = ?', [explicitId])
  } else {
    const key = parseIssueKey(branch) || parseIssueKey(commit_ref) || parseIssueKey(message)
    if (key) {
      issue = await get('SELECT id FROM issues WHERE issue_key = ?', [key])
    }
  }

  if (!issue) {
    res.status(404).json({ error: 'No matching issue found for this build (provide issue_id or an issue key in branch/commit_ref/message)' })
    return
  }

  const durationRaw = Number(duration_seconds)
  const duration = Number.isFinite(durationRaw) ? Math.round(durationRaw) : null

  const created = await run(
    `INSERT INTO ci_builds (issue_id, pipeline, branch, commit_ref, status, url, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      issue.id,
      pipeline ? String(pipeline) : null,
      branch ? String(branch) : null,
      commit_ref ? String(commit_ref) : null,
      normalizedStatus,
      url ? String(url) : null,
      duration,
    ],
  )

  res.status(201).json({
    id: created.lastID,
    issueId: issue.id,
    status: normalizedStatus,
  })
}))

// GET /api/issues/:id/ci-builds — latest builds for the issue (newest first).
router.get('/issues/:id/ci-builds', asyncHandler(async (req, res) => {
  const issueId = Number(req.params.id)
  const rows = await all(
    `SELECT id, issue_id, pipeline, branch, commit_ref, status, url, duration_seconds, created_at
     FROM ci_builds
     WHERE issue_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
    [issueId],
  )
  res.json(rows)
}))

export default router
