// @vitest-environment node
// JL-480: browser sessions ride on an httpOnly cookie, not on a token the page
// stores. End to end against PostgreSQL (like auth.test.js): sign-in sets the
// cookies, the cookie authenticates, a cookie-authenticated change needs the
// CSRF token, a header-authenticated one (the CLI) does not, and logout revokes
// the session server-side.
import { describe, it, expect, beforeAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { initializeDatabase, get } from '../db.js'
import authRoutes from '../routes/auth.js'
import { authGuard } from '../middleware/authGuard.js'
import { errorHandler } from '../middleware/errorHandler.js'
import { JWT_SECRET, cookieSecure } from '../config.js'
import { parseCookies, SESSION_COOKIE, CSRF_COOKIE } from '../utils/session.js'
import { socketOriginAllowed, authenticateSocket } from '../services/realtime.js'

let app
beforeAll(async () => {
  await initializeDatabase()
  app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  // A protected probe: GET reads, POST changes something.
  app.get('/api/probe', authGuard, (req, res) => res.json({ email: req.user.email, via: req.authVia }))
  app.post('/api/probe', authGuard, (req, res) => res.json({ ok: true, via: req.authVia }))
  app.use(errorHandler)
})

const email = `jl480_${Date.now()}@gmail.com`
const password = 'password123'

/** The Set-Cookie line for `name`, or undefined. */
const setCookie = (res, name) => (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`))
/** Cookie values from a response, as a browser would store them. */
const jar = (res) => parseCookies((res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; '))
const cookieHeader = (cookies) => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')

async function signIn({ remember = false } = {}) {
  const res = await request(app).post('/api/auth/login').send({ email, password, remember })
  expect(res.status).toBe(200)
  return { res, cookies: jar(res) }
}

describe('sign-in sets an httpOnly session cookie and a readable CSRF cookie', () => {
  it('signup', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email, password })
    expect(res.status).toBe(201)
    expect(setCookie(res, SESSION_COOKIE)).toMatch(/HttpOnly/i)
    expect(setCookie(res, CSRF_COOKIE)).toBeDefined()
  })

  it('login without "remember me": browser-session cookies, HttpOnly, SameSite=Lax, Path=/', async () => {
    const { res } = await signIn()
    const session = setCookie(res, SESSION_COOKIE)
    expect(session).toMatch(/HttpOnly/i)
    expect(session).toMatch(/SameSite=Lax/i)
    expect(session).toMatch(/Path=\//)
    expect(session).not.toMatch(/Max-Age|Expires/i) // dies with the browser session
    const csrf = setCookie(res, CSRF_COOKIE)
    expect(csrf).not.toMatch(/HttpOnly/i) // the SPA must read it
    expect(csrf).not.toMatch(/Max-Age|Expires/i)
  })

  it('login with "remember me": both cookies last 30 days', async () => {
    const { res } = await signIn({ remember: true })
    expect(setCookie(res, SESSION_COOKIE)).toMatch(/Max-Age=2592000/)
    expect(setCookie(res, CSRF_COOKIE)).toMatch(/Max-Age=2592000/)
  })

  it('the session cookie carries a revocable session (a jti with a user_sessions row)', async () => {
    const { cookies } = await signIn()
    const { jti } = jwt.verify(cookies[SESSION_COOKIE], JWT_SECRET)
    expect(jti).toBeTruthy()
    const row = await get('SELECT revoked FROM user_sessions WHERE jti = ?', [jti])
    expect(row).toMatchObject({ revoked: false })
  })
})

describe('authGuard', () => {
  it('authenticates a read by cookie alone', async () => {
    const { cookies } = await signIn()
    const res = await request(app).get('/api/probe').set('Cookie', cookieHeader({ [SESSION_COOKIE]: cookies[SESSION_COOKIE], [CSRF_COOKIE]: cookies[CSRF_COOKIE] }))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ email, via: 'cookie' })
  })

  it('refuses a cookie-authenticated change without the CSRF header (403)', async () => {
    const { cookies } = await signIn()
    const res = await request(app).post('/api/probe').set('Cookie', cookieHeader(cookies))
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Invalid or missing CSRF token')
  })

  it('refuses a CSRF header that does not match the cookie', async () => {
    const { cookies } = await signIn()
    const res = await request(app).post('/api/probe')
      .set('Cookie', cookieHeader(cookies)).set('X-CSRF-Token', 'f'.repeat(64))
    expect(res.status).toBe(403)
  })

  it('accepts a cookie-authenticated change with the matching CSRF header', async () => {
    const { cookies } = await signIn()
    const res = await request(app).post('/api/probe')
      .set('Cookie', cookieHeader(cookies)).set('X-CSRF-Token', cookies[CSRF_COOKIE])
    expect(res.status).toBe(200)
    expect(res.body.via).toBe('cookie')
  })

  it('a Bearer header (the CLI) needs no CSRF token', async () => {
    const { res: login } = await signIn()
    const res = await request(app).post('/api/probe').set('Authorization', `Bearer ${login.body.token}`)
    expect(res.status).toBe(200)
    expect(res.body.via).toBe('header')
  })

  it('re-issues a missing CSRF cookie on a read, so the session can make changes again', async () => {
    const { cookies } = await signIn()
    const res = await request(app).get('/api/probe').set('Cookie', cookieHeader({ [SESSION_COOKIE]: cookies[SESSION_COOKIE] }))
    expect(res.status).toBe(200)
    expect(setCookie(res, CSRF_COOKIE)).toBeDefined()
  })

  it('401 with no session at all', async () => {
    expect((await request(app).get('/api/probe')).status).toBe(401)
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the session server-side and clears both cookies', async () => {
    const { cookies } = await signIn()
    const res = await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(cookies))
    expect(res.status).toBe(200)
    // Cleared: empty value, expiry in the past.
    expect(setCookie(res, SESSION_COOKIE)).toMatch(/^jira_session=;.*Expires=Thu, 01 Jan 1970/i)
    expect(setCookie(res, CSRF_COOKIE)).toMatch(/^jira_csrf=;/)

    // The token is dead everywhere, not just in this browser: replaying it fails.
    const replay = await request(app).get('/api/probe').set('Cookie', cookieHeader(cookies))
    expect(replay.status).toBe(401)
    expect(replay.body.error).toBe('Session has been revoked')
  })

  it('still clears the cookies for an expired session, or with none at all', async () => {
    const expired = jwt.sign({ sub: 1, email, jti: 'gone' }, JWT_SECRET, { expiresIn: -10 })
    const res = await request(app).post('/api/auth/logout').set('Cookie', `${SESSION_COOKIE}=${expired}`)
    expect(res.status).toBe(200)
    expect(setCookie(res, SESSION_COOKIE)).toBeDefined()
    expect((await request(app).post('/api/auth/logout')).status).toBe(200)
  })
})

describe('cookieSecure', () => {
  it('follows APP_URL, and COOKIE_SECURE overrides it', () => {
    expect(cookieSecure({ APP_URL: 'https://jira.example.com' })).toBe(true)
    expect(cookieSecure({ APP_URL: 'http://20.219.248.167:5173' })).toBe(false)
    expect(cookieSecure({ APP_URL: 'http://x', COOKIE_SECURE: 'true' })).toBe(true)
    expect(cookieSecure({ APP_URL: 'https://x', COOKIE_SECURE: 'false' })).toBe(false)
  })
})

describe('realtime socket authentication', () => {
  const req = (headers, url = '/ws') => ({ url, headers: { host: 'localhost:5174', ...headers } })

  it('accepts the session cookie from this host', async () => {
    const { cookies } = await signIn()
    const user = await authenticateSocket(req({ origin: 'http://localhost:5174', cookie: cookieHeader(cookies) }))
    expect(user).toMatchObject({ email })
  })

  it('refuses a socket opened by another site, even with the cookie (cross-site WebSocket hijacking)', async () => {
    const { cookies } = await signIn()
    expect(await authenticateSocket(req({ origin: 'https://evil.example', cookie: cookieHeader(cookies) }))).toBeNull()
  })

  it('refuses a revoked session', async () => {
    const { cookies } = await signIn()
    await request(app).post('/api/auth/logout').set('Cookie', cookieHeader(cookies))
    expect(await authenticateSocket(req({ origin: 'http://localhost:5174', cookie: cookieHeader(cookies) }))).toBeNull()
  })

  it('origin rule: same host or an allow-listed origin; no Origin means not a browser', () => {
    expect(socketOriginAllowed(req({ origin: 'http://localhost:5174' }), '')).toBe(true)
    expect(socketOriginAllowed(req({ origin: 'https://evil.example' }), '')).toBe(false)
    expect(socketOriginAllowed(req({ origin: 'https://ok.example' }), 'https://ok.example')).toBe(true)
    expect(socketOriginAllowed(req({}), '')).toBe(true)
    expect(socketOriginAllowed(req({ origin: 'not a url' }), '')).toBe(false)
  })
})
