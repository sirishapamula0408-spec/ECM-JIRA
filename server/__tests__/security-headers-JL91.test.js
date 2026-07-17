// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  securityHeaders,
  buildSecurityHeaders,
  buildContentSecurityPolicy,
} from '../middleware/securityHeaders.js'

function makeRes() {
  const headers = {}
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value
    },
  }
}

describe('securityHeaders middleware (JL-91)', () => {
  it('buildContentSecurityPolicy includes strict directives', () => {
    const csp = buildContentSecurityPolicy()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    // emotion/MUI needs inline styles
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    // script-src must NOT allow unsafe-inline
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('buildSecurityHeaders returns CSP + hardening headers', () => {
    const h = buildSecurityHeaders()
    expect(h['Content-Security-Policy']).toBe(buildContentSecurityPolicy())
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })

  it('middleware sets all headers on the response and calls next()', () => {
    const req = {}
    const res = makeRes()
    const next = vi.fn()

    securityHeaders(req, res, next)

    expect(res.headers['Content-Security-Policy']).toContain("default-src 'self'")
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(res.headers['X-Frame-Options']).toBe('DENY')
    expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(next).toHaveBeenCalledOnce()
  })
})
