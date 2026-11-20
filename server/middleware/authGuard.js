import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config.js'
import { get } from '../db.js'
import {
  readSessionToken, parseCookies, csrfValid, setCsrfCookie, SAFE_METHODS, CSRF_COOKIE,
} from '../utils/session.js'

/**
 * Authenticate a request by its session JWT.
 *
 * JL-480: the JWT comes from the httpOnly `jira_session` cookie (browsers) or an
 * `Authorization: Bearer` header (the CLI, scripts). A cookie is sent by the
 * browser automatically, so a cookie-authenticated request that changes state
 * must also carry the CSRF token (X-CSRF-Token header = jira_csrf cookie);
 * otherwise it is refused with 403. A header-authenticated request needs no CSRF
 * token: a cross-site page cannot attach that header.
 */
export async function authGuard(req, res, next) {
  const presented = readSessionToken(req)
  if (!presented) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  let payload
  try {
    payload = jwt.verify(presented.token, JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  req.user = { id: payload.sub, email: payload.email, jti: payload.jti }
  req.authVia = presented.via

  if (presented.via === 'cookie') {
    const cookies = parseCookies(req.headers?.cookie)
    if (!SAFE_METHODS.has(req.method)) {
      if (!csrfValid(req, cookies)) {
        return res.status(403).json({ error: 'Invalid or missing CSRF token' })
      }
    } else if (!cookies[CSRF_COOKIE] && typeof res.cookie === 'function') {
      // A valid session with no CSRF cookie (cleared by hand, or a browser that
      // dropped it) could never make another change. Re-issue it on a read.
      setCsrfCookie(res)
    }
  }

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
