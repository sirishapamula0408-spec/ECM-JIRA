import { Router } from 'express'
import { all, get, run } from '../db.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { generateToken } from '../middleware/apiTokenAuth.js'

const router = Router()

const VALID_SCOPES = ['read', 'write', '*']

/** Normalize and validate a requested scopes value into a comma-separated string. */
function normalizeScopes(input) {
  let list = []
  if (Array.isArray(input)) list = input
  else if (typeof input === 'string') list = input.split(',')
  list = list.map((s) => String(s).trim()).filter(Boolean)
  if (list.length === 0) list = ['read']
  const invalid = list.filter((s) => !VALID_SCOPES.includes(s))
  return { scopes: list.join(','), invalid }
}

// GET /api/api-tokens — list the current user's tokens (never returns hash/plaintext)
router.get('/', asyncHandler(async (req, res) => {
  const rows = await all(
    `SELECT id, name, token_prefix, scopes, revoked, created_at, last_used_at
     FROM api_tokens WHERE LOWER(user_email) = LOWER(?) ORDER BY created_at DESC`,
    [req.user.email],
  )
  res.json(rows)
}))

// POST /api/api-tokens — create a token; returns plaintext ONCE
router.post('/', asyncHandler(async (req, res) => {
  const { name, scopes } = req.body || {}
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const { scopes: scopeStr, invalid } = normalizeScopes(scopes)
  if (invalid.length > 0) {
    res.status(400).json({ error: `Invalid scope(s): ${invalid.join(', ')}` })
    return
  }

  const { plaintext, hash, prefix } = generateToken()
  const result = await run(
    `INSERT INTO api_tokens (member_id, user_email, name, token_prefix, token_hash, scopes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.memberId || null, req.user.email, name.trim(), prefix, hash, scopeStr],
  )
  const row = await get(
    `SELECT id, name, token_prefix, scopes, revoked, created_at, last_used_at
     FROM api_tokens WHERE id = ?`,
    [result.lastID],
  )

  // Plaintext token is returned exactly once and never stored/retrievable again.
  res.status(201).json({ ...row, token: plaintext })
}))

// DELETE /api/api-tokens/:id — revoke (soft-delete) a token owned by the user
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id)
  const existing = await get(
    'SELECT id FROM api_tokens WHERE id = ? AND LOWER(user_email) = LOWER(?)',
    [id, req.user.email],
  )
  if (!existing) {
    res.status(404).json({ error: 'API token not found' })
    return
  }
  await run('UPDATE api_tokens SET revoked = TRUE WHERE id = ?', [id])
  res.json({ success: true })
}))

export default router
