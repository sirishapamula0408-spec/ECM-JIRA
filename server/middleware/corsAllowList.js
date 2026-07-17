// JL-93: In-house, dependency-free strict CORS allow-list.
//
// Replaces the open `cors()` call. Behaviour:
//  - When the allow-list is EMPTY/unset → permissive mode: reflect whatever
//    Origin is presented (or `*` when none), preserving prior dev behaviour and
//    keeping the Vite dev proxy / same-origin requests and existing tests working.
//  - When the allow-list is NON-EMPTY → strict mode: only reflect an Origin that
//    is explicitly listed. Disallowed origins get NO `Access-Control-Allow-Origin`
//    header, so browsers block the cross-origin response.
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

  const permissive = list.length === 0

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
      // No Origin header (e.g. curl, same-origin, server-to-server) in permissive
      // mode: keep the historically-open default.
      res.setHeader('Access-Control-Allow-Origin', '*')
    }
    // Disallowed origin in strict mode → intentionally no ACAO header (blocked).

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
