import crypto from 'node:crypto'
import { hashPassword } from '../middleware/validate.js'

/**
 * JL-129 — Live SSO shared helpers.
 *
 * These are PURE and dependency-injected (the db `get`/`run` are passed in) so
 * they can be unit-tested without a live IdP or a real PostgreSQL connection.
 * The network / library calls (openid-client discovery, node-saml validation)
 * live in thin wrappers in the route handlers and delegate the persistence step
 * to `upsertSsoUser`.
 */

/**
 * Find-or-create the app user for an authenticated SSO identity, and ensure a
 * matching `oauth_identities` row exists (provider = 'oidc' | 'saml').
 *
 * Resolution order:
 *   1. Existing identity (provider + provider_user_id) → reuse that user.
 *   2. Existing user with the same email → link a new identity to it.
 *   3. Otherwise → create a fresh user (random, unusable local password) + identity.
 *
 * @param {{ email: string, provider: string, providerUserId: string }} claims
 * @param {{ get: Function, run: Function }} db  Injectable db accessors.
 * @returns {Promise<{ id: number, email: string, created_at?: string }>} the user row.
 */
export async function upsertSsoUser({ email, provider, providerUserId }, { get, run }) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const pid = String(providerUserId || normalizedEmail)

  if (!normalizedEmail) {
    throw new Error('SSO identity is missing an email claim')
  }
  if (!provider) {
    throw new Error('SSO provider is required')
  }

  // 1. Existing identity → reuse the linked user.
  const identity = await get(
    'SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?',
    [provider, pid],
  )
  if (identity && identity.user_id) {
    const linked = await get('SELECT id, email, created_at FROM users WHERE id = ?', [identity.user_id])
    if (linked) return linked
  }

  // 2. Existing user by email → link a new identity to it.
  let user = await get('SELECT id, email, created_at FROM users WHERE email = ?', [normalizedEmail])

  // 3. No user yet → create one with a random, effectively-unusable local password.
  if (!user) {
    const randomPassword = hashPassword(crypto.randomBytes(24).toString('hex'))
    const created = await run('INSERT INTO users (email, password_hash) VALUES (?, ?)', [
      normalizedEmail,
      randomPassword,
    ])
    user = await get('SELECT id, email, created_at FROM users WHERE id = ?', [created.lastID])
  }

  await run(
    'INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    [user.id, provider, pid],
  )

  return user
}
