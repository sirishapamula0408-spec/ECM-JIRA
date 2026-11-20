/*
 * JL-480: browser sessions live in an httpOnly cookie, not in browser storage.
 *
 * The sign-in JWT used to be handed to the SPA, which kept it in localStorage
 * (30 days with "Remember me") or sessionStorage and sent it as a Bearer header.
 * Any script-injection bug could read it and replay it from anywhere. Now:
 *
 *   jira_session  the JWT. HttpOnly (page scripts cannot read it), SameSite=Lax
 *                 (not sent on cross-site POSTs), Secure when served over HTTPS.
 *                 Persistent for 30 days with "Remember me", otherwise a
 *                 browser-session cookie — the same lifetimes the two storages had.
 *   jira_csrf     a random token the SPA CAN read and must echo back in the
 *                 X-CSRF-Token header on every state-changing request
 *                 (double-submit). A cookie alone is no longer enough to act.
 *
 * Non-browser clients (the ecm-issue CLI, API tokens) keep using the
 * Authorization header; authGuard accepts both. A request authenticated by
 * header needs no CSRF token — a cross-site page cannot set that header.
 */
import crypto from 'node:crypto'
import { run } from '../db.js'
import { cookieSecure } from '../config.js'
import { issueToken } from './authToken.js'

export const SESSION_COOKIE = 'jira_session'
export const CSRF_COOKIE = 'jira_csrf'
export const CSRF_HEADER = 'x-csrf-token'
export const REMEMBER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Methods that change nothing and so need no CSRF token. */
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Parse a Cookie header into { name: value }. Malformed pairs are skipped. */
export function parseCookies(header) {
  const out = {}
  if (typeof header !== 'string' || !header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const name = part.slice(0, eq).trim()
    let value = part.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    try { value = decodeURIComponent(value) } catch { /* keep raw */ }
    if (name && !(name in out)) out[name] = value
  }
  return out
}

function baseOptions() {
  // Path=/ (not /api): the realtime socket is at /ws and must see the cookie too.
  return { path: '/', sameSite: 'lax', secure: cookieSecure() }
}

export function newCsrfToken() {
  return crypto.randomBytes(32).toString('hex')
}

/** (Re)issue the readable CSRF cookie. */
export function setCsrfCookie(res, value = newCsrfToken(), { maxAge } = {}) {
  res.cookie(CSRF_COOKIE, value, { ...baseOptions(), httpOnly: false, ...(maxAge ? { maxAge } : {}) })
  return value
}

/** Set the session + CSRF cookies for a freshly minted JWT. */
export function setSessionCookies(res, token, { remember = false } = {}) {
  const maxAge = remember ? REMEMBER_MAX_AGE_MS : undefined
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(), httpOnly: true, ...(maxAge ? { maxAge } : {}) })
  setCsrfCookie(res, newCsrfToken(), { maxAge })
}

export function clearSessionCookies(res) {
  const opts = baseOptions()
  res.clearCookie(SESSION_COOKIE, { ...opts, httpOnly: true })
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false })
}

/**
 * Start a browser session: record it in user_sessions (so it can be listed and
 * revoked — JL-133), mint the JWT with that jti, and set the cookies. Every
 * sign-in path (login, signup, invitation accept, SSO) goes through here, so all
 * of them are revocable and none of them hands the browser a readable token.
 *
 * Returns the JWT, for the callers that still return it to non-browser clients.
 */
export async function startSession(req, res, user, { remember = false, expiresIn } = {}) {
  const jti = crypto.randomUUID()
  try {
    await run(
      'INSERT INTO user_sessions (user_email, jti, user_agent, ip) VALUES (?, ?, ?, ?)',
      [
        user.email,
        jti,
        req.headers?.['user-agent'] || null,
        req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || null,
      ],
    )
  } catch (err) {
    // Best-effort, as before: never block a sign-in on the session table.
    console.error(`[auth] Failed to record session for ${user.email}: ${err.message}`)
  }
  const token = issueToken(user, expiresIn || (remember ? '30d' : '1d'), { jti })
  setSessionCookies(res, token, { remember })
  return token
}

/** Constant-time check of the X-CSRF-Token header against the jira_csrf cookie. */
export function csrfValid(req, cookies = parseCookies(req.headers?.cookie)) {
  const header = req.headers?.[CSRF_HEADER]
  const cookie = cookies[CSRF_COOKIE]
  if (typeof header !== 'string' || !header || !cookie) return false
  const a = Buffer.from(header)
  const b = Buffer.from(cookie)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Where did this request's session JWT come from? A header wins (CLI, scripts,
 * tests); otherwise the session cookie. Returns { token, via } or null.
 */
export function readSessionToken(req) {
  const header = req.headers?.authorization
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim()
    if (token) return { token, via: 'header' }
  }
  const cookie = parseCookies(req.headers?.cookie)[SESSION_COOKIE]
  if (cookie) return { token: cookie, via: 'cookie' }
  return null
}
