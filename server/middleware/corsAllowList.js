// JL-93: In-house, dependency-free strict CORS allow-list.
//
// Replaces the open `cors()` call. Behaviour:
//  - EMPTY/unset allow-list → NO cross-origin access. No Origin is reflected, so
//    a browser blocks every cross-origin response. The SPA is unaffected: it
//    calls a relative /api, which is same-origin (Vite proxies it in dev,
//    serveStatic serves both in production), and browsers do not apply CORS to
//    same-origin requests. Non-browser clients (curl, server-to-server, API
//    tokens) send no Origin and are unaffected too.
//    This used to be PERMISSIVE — reflect ANY Origin, with credentials. The
//    production config check (JL-435) required an allow-list, but the deploy
//    box runs `npm run dev`, so that check never fired and every website was
//    allowed to call the API.
//  - NON-EMPTY allow-list → only reflect an Origin that is explicitly listed.
//  - `*` → permissive (reflect any Origin): an explicit opt-in for local
//    experiments only. validateConfig refuses it in production.
//
// Scope note: this ticket is rate limiting / lockout / CORS only. Security headers
// (CSP, X-Frame-Options, etc.) are handled separately by JL-91 — not set here.

const DEFAULT_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
const DEFAULT_HEADERS = 'Content-Type, Authorization, X-Workspace-Id'

/**
 * @param {object} [opts]
 * @param {string[]|string} [opts.allowedOrigins] Array or comma-separated string.
 * @param {boolean} [opts.credentials] Emit Access-Control-Allow-Credentials.
 * @param {string} [opts.methods]
 * @param {string} [opts.allowedHeaders]
 * @returns {import('express').RequestHandler}
 */
export function corsAllowList({
  allowedOrigins = [],
  credentials = true,
  methods = DEFAULT_METHODS,
  allowedHeaders = DEFAULT_HEADERS,
} = {}) {
  const list = (Array.isArray(allowedOrigins)
    ? allowedOrigins
    : String(allowedOrigins || '').split(','))
    .map((s) => s.trim())
    .filter(Boolean)

  const permissive = list.includes('*')

  function isAllowed(origin) {
    return permissive || list.includes(origin)
  }

  const middleware = (req, res, next) => {
    const origin = req.headers?.origin

    if (origin && isAllowed(origin)) {
      // Reflect the specific origin (required when credentials are enabled —
      // `*` is not permitted alongside Allow-Credentials).
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      if (credentials) res.setHeader('Access-Control-Allow-Credentials', 'true')
    } else if (!origin && permissive) {
      // No Origin header (e.g. curl, server-to-server) in explicit '*' mode.
      res.setHeader('Access-Control-Allow-Origin', '*')
    }
    // Any other origin → intentionally no ACAO header (the browser blocks it).

    res.setHeader('Access-Control-Allow-Methods', methods)
    res.setHeader('Access-Control-Allow-Headers', allowedHeaders)

    // Short-circuit preflight so it never falls through to route handlers.
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    next()
  }

  // Expose for testing / introspection.
  middleware.isAllowed = isAllowed
  middleware.allowedOrigins = list
  middleware.permissive = permissive

  return middleware
}

export default corsAllowList
