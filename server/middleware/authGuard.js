import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config.js'
import { get } from '../db.js'

export async function authGuard(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const token = header.slice(7)
  let payload
  try {
    payload = jwt.verify(token, JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  req.user = { id: payload.sub, email: payload.email, jti: payload.jti }

  // JL-133: best-effort session revocation check. Only runs when the token
  // carries a jti — legacy tokens without one always authenticate (backward
  // compatible). Any lookup failure fails OPEN so auth never hard-breaks on the
  // session table; only an explicit revoked row rejects the request.
  if (payload.jti) {
    try {
      const session = await get('SELECT revoked FROM user_sessions WHERE jti = ?', [payload.jti])
      if (session && session.revoked) {
        return res.status(401).json({ error: 'Session has been revoked' })
      }
    } catch {
      // ignore — treat session-store errors as non-fatal
    }
  }

  return next()
}
