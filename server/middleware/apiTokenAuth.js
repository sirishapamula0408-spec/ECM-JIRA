import crypto from 'node:crypto'
import { get, run } from '../db.js'

const TOKEN_BYTES = 32
export const TOKEN_PREFIX = 'ecm_'

/** Compute the SHA-256 hex hash of a plaintext API token. */
export function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex')
}

/**
 * Generate a new API token.
 * Returns { plaintext, hash, prefix } — only the hash is persisted.
 * `prefix` is a short, non-secret identifier (first chars) shown in listings.
 */
export function generateToken() {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  const plaintext = `${TOKEN_PREFIX}${raw}`
  return {
    plaintext,
    hash: hashToken(plaintext),
    prefix: plaintext.slice(0, 12),
  }
}

/** Extract the presented token from Authorization: Bearer or X-API-Key headers. */
export function extractToken(req) {
  const apiKey = req.headers['x-api-key']
  if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim()

  const header = req.headers.authorization
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim()
  }
  return null
}

/**
 * Middleware: authenticate an inbound public-API request by API token.
 * Hashes the presented token, looks up a non-revoked row, sets req.user
 * ({ email, memberId, scopes, tokenId, viaApiToken }), and stamps last_used_at.
 * Rejects missing/invalid/revoked tokens with 401.
 */
export async function apiTokenAuth(req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) {
      return res.status(401).json({ error: 'API token required' })
    }

    const tokenHash = hashToken(token)
    const row = await get(
      'SELECT id, member_id, user_email, scopes, revoked FROM api_tokens WHERE token_hash = ?',
      [tokenHash],
    )

    if (!row || row.revoked) {
      return res.status(401).json({ error: 'Invalid or revoked API token' })
    }

    req.user = {
      email: row.user_email,
      memberId: row.member_id,
      scopes: (row.scopes || '').split(',').map((s) => s.trim()).filter(Boolean),
      tokenId: row.id,
      viaApiToken: true,
    }

    // Best-effort usage stamp; never block the request on it.
    run('UPDATE api_tokens SET last_used_at = NOW() WHERE id = ?', [row.id]).catch(() => {})

    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Factory: require a given scope on the authenticated API token.
 * `read` and `*` (or empty scope list) grant read access.
 */
export function requireScope(scope) {
  return (req, res, next) => {
    const scopes = req.user?.scopes || []
    if (scopes.includes('*') || scopes.includes(scope)) return next()
    res.status(403).json({ error: `API token missing required scope: ${scope}` })
  }
}
