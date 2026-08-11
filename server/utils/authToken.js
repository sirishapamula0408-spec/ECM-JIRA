import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config.js'

/**
 * Mint an app JWT for a user row.
 *
 * Extracted from server/routes/auth.js in JL-371 so the invitation-accept route
 * can hand back exactly the same kind of session as signup does, without
 * importing the whole auth router (and its OAuth/SAML/MFA graph) just for three
 * lines of jwt.sign. Both callers must keep producing identical claims —
 * authGuard verifies `sub`/`email`/`jti` and nothing else.
 */
export function issueToken(user, expiresIn = '1d', extraClaims = {}) {
  return jwt.sign({ sub: user.id, email: user.email, ...extraClaims }, JWT_SECRET, { expiresIn })
}
