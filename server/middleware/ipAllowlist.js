// JL-133: IP allowlisting middleware + pure, unit-testable helpers.
//
// The middleware restricts API access to a configured allow-list of IPv4
// addresses / CIDR ranges. An EMPTY list is a no-op (allow all), which keeps
// local dev and the test suite completely unaffected.

/**
 * Convert a dotted-quad IPv4 string to an unsigned 32-bit integer.
 * Returns null for anything that isn't a valid IPv4 address.
 */
function ipv4ToLong(ip) {
  const parts = String(ip).trim().split('.')
  if (parts.length !== 4) return null
  let long = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null
    const n = Number(part)
    if (n < 0 || n > 255) return null
    long = long * 256 + n
  }
  return long >>> 0
}

/**
 * Normalize a client IP: strip an IPv4-mapped IPv6 prefix (`::ffff:127.0.0.1`)
 * and surrounding whitespace so plain IPv4 comparisons work behind proxies.
 */
export function normalizeIp(ip) {
  return String(ip || '').trim().replace(/^::ffff:/i, '')
}

/**
 * Pure predicate: is `ip` allowed by `cidrList`?
 *
 * - `cidrList` is an array of plain IPv4 addresses and/or CIDR ranges
 *   (e.g. `['10.0.0.0/8', '203.0.113.5']`).
 * - An empty / non-array list allows everything (returns true).
 * - Supports exact IPv4 matches and IPv4 CIDR ranges. Non-IPv4 / malformed
 *   entries are skipped rather than throwing.
 *
 * @param {string} ip
 * @param {string[]} cidrList
 * @returns {boolean}
 */
export function ipAllowed(ip, cidrList) {
  if (!Array.isArray(cidrList) || cidrList.length === 0) return true

  const clean = normalizeIp(ip)
  const ipLong = ipv4ToLong(clean)

  for (const raw of cidrList) {
    const rule = String(raw || '').trim()
    if (!rule) continue

    if (rule.includes('/')) {
      const [base, bitsStr] = rule.split('/')
      const bits = Number(bitsStr)
      const baseLong = ipv4ToLong(base)
      if (baseLong === null || ipLong === null) continue
      if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
      if ((ipLong & mask) === (baseLong & mask)) return true
    } else {
      if (rule === clean) return true
      const ruleLong = ipv4ToLong(rule)
      if (ruleLong !== null && ipLong !== null && ruleLong === ipLong) return true
    }
  }
  return false
}

/** Parse a comma-separated allow-list string into a trimmed, non-empty array. */
export function parseCidrList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Express middleware factory. Returns a middleware that 403s any client whose
 * IP is not in the allow-list. When the list is empty it is a pure no-op, so it
 * is safe to mount unconditionally (dev/test default = allow all).
 *
 * @param {{ allowlist?: string|string[] }} [options]
 */
export function ipAllowlist(options = {}) {
  const list = parseCidrList(options.allowlist)

  return function ipAllowlistMiddleware(req, res, next) {
    if (list.length === 0) return next() // empty allow-list = allow all
    const ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || ''
    if (ipAllowed(ip, list)) return next()
    res.status(403).json({ error: 'Access denied: your IP address is not permitted' })
  }
}
