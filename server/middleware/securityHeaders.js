/**
 * securityHeaders — in-house security response headers (JL-91).
 *
 * Adds a Content-Security-Policy plus a few hardening headers to every
 * response. No external dependency (no helmet) — this is intentionally a
 * small, auditable middleware.
 *
 * CSP notes:
 *   - script-src 'self'         → only first-party scripts execute; blocks
 *                                 injected inline/remote scripts (defense in
 *                                 depth alongside output sanitization).
 *   - style-src 'self' 'unsafe-inline'
 *                               → MUI/emotion inject styles at runtime, so
 *                                 inline styles must be permitted.
 *   - img-src 'self' data: blob:→ base64/blob image previews (attachments).
 *   - object-src 'none', frame-ancestors 'none', base-uri 'self'
 *                               → lock down plugins, clickjacking, base tag.
 */

const CSP_DIRECTIVES = [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'"]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["img-src", ["'self'", 'data:', 'blob:']],
  ["font-src", ["'self'", 'data:']],
  ["connect-src", ["'self'"]],
  ["object-src", ["'none'"]],
  ["frame-ancestors", ["'none'"]],
  ["base-uri", ["'self'"]],
  ["form-action", ["'self'"]],
]

/**
 * Build the Content-Security-Policy header value from the directive table.
 * Exported so it can be unit-tested independently of Express.
 * @returns {string}
 */
export function buildContentSecurityPolicy() {
  return CSP_DIRECTIVES.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
}

/**
 * Build the full map of security headers.
 * Exported for testing.
 * @returns {Record<string,string>}
 */
export function buildSecurityHeaders() {
  return {
    'Content-Security-Policy': buildContentSecurityPolicy(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  }
}

/**
 * Express middleware that applies the security headers to every response.
 */
export function securityHeaders(req, res, next) {
  const headers = buildSecurityHeaders()
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value)
  }
  next()
}

export default securityHeaders
