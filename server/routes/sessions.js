// JL-133: Session / device management.
//
// JWTs are stateless; we keep a lightweight `user_sessions` row keyed by the
// token's `jti` (see auth.js login) so a user can list and revoke their active
// sessions/devices. authGuard performs a best-effort revoked check on the jti.

import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'

const router = Router()

/**
 * Pure, unit-testable heuristic UA parser for display purposes only.
 * Returns { browser, os } with best-effort labels (never throws).
 *
 * @param {string} ua
 * @returns {{ browser: string, os: string }}
 */
export function parseUserAgent(ua) {
  const s = String(ua || '')

  let browser = 'Unknown'
  if (/Edg\//i.test(s)) browser = 'Edge'
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera'
  else if (/Chrome\//i.test(s)) browser = 'Chrome'
  else if (/Firefox\//i.test(s)) browser = 'Firefox'
  else if (/Version\/.*Safari/i.test(s) || (/Safari/i.test(s) && !/Chrome/i.test(s))) browser = 'Safari'
  else if (/curl\//i.test(s)) browser = 'curl'
  else if (/PostmanRuntime/i.test(s)) browser = 'Postman'

  let os = 'Unknown'
  if (/Windows/i.test(s)) os = 'Windows'
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS'
  else if (/Android/i.test(s)) os = 'Android'
  else if (/iPhone|iPad|iPod|iOS/i.test(s)) os = 'iOS'
  else if (/Linux/i.test(s)) os = 'Linux'

  return { browser, os }
}

// GET /api/sessions — the caller's own active (non-revoked) sessions/devices.
router.get('/', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT id, jti, user_agent, ip, created_at, last_seen_at, revoked
     FROM user_sessions
     WHERE LOWER(user_email) = LOWER(?) AND revoked = FALSE
     ORDER BY last_seen_at DESC NULLS LAST, created_at DESC`,
    [req.user.email],
  )

  const sessions = (rows || []).map((r) => {
    const { browser, os } = parseUserAgent(r.user_agent)
    return {
      id: r.id,
      ip: r.ip,
      userAgent: r.user_agent,
      browser,
      os,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      // Flag the session backing the token used for THIS request.
      current: Boolean(req.user.jti && r.jti === req.user.jti),
    }
  })

  res.json(sessions)
}))

// DELETE /api/sessions/:id — revoke a single session. Owner only.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid session id' })
    return
  }

  const existing = await get('SELECT id, user_email FROM user_sessions WHERE id = ?', [id])
  if (!existing) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  if (String(existing.user_email).toLowerCase() !== String(req.user.email).toLowerCase()) {
    res.status(403).json({ error: 'You can only revoke your own sessions' })
    return
  }

  await run('UPDATE user_sessions SET revoked = TRUE WHERE id = ?', [id])
  res.json({ success: true })
}))

// POST /api/sessions/revoke-all — "sign out everywhere": revoke all of the
// caller's active sessions EXCEPT the one backing the current request.
router.post('/revoke-all', asyncHandler(async (req, res) => {
  const currentJti = req.user.jti || ''
  await run(
    `UPDATE user_sessions SET revoked = TRUE
     WHERE LOWER(user_email) = LOWER(?) AND revoked = FALSE AND COALESCE(jti, '') <> ?`,
    [req.user.email, currentJti],
  )
  res.json({ success: true })
}))

export default router
