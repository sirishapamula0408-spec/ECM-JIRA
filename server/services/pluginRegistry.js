// JL-145: Plugin/app framework — declarative extension-point registry.
//
// SAFETY: Contributions are DATA, never code. A contribution describes a piece
// of UI or a link (label, icon, target extension point, url/action-type). The
// host renders these; it NEVER evals or executes plugin-provided code. URLs are
// validated to be http(s) or a relative /path so a malicious manifest cannot
// inject `javascript:`/`data:` payloads.

/** The set of extension points a plugin may contribute to. */
export const EXTENSION_POINTS = Object.freeze([
  'issue-panel',
  'nav-item',
  'issue-action',
  'dashboard-gadget',
  'webhook',
])

/**
 * Validate that a URL is safe to render as a link/target.
 * Accepts absolute http(s) URLs and relative paths beginning with `/`.
 * Rejects everything else (javascript:, data:, vbscript:, protocol-relative //, etc.).
 */
export function isSafeUrl(url) {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed) return false
  // Relative in-app path (but not protocol-relative "//host").
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Pure manifest validator.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateManifest(manifest) {
  const errors = []

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest must be an object'] }
  }

  if (!manifest.name || typeof manifest.name !== 'string' || !manifest.name.trim()) {
    errors.push('name is required')
  }

  const contributions = manifest.contributions
  if (contributions !== undefined && !Array.isArray(contributions)) {
    errors.push('contributions must be an array')
  } else if (Array.isArray(contributions)) {
    contributions.forEach((c, i) => {
      const at = `contributions[${i}]`
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        errors.push(`${at} must be an object`)
        return
      }
      if (!EXTENSION_POINTS.includes(c.extensionPoint)) {
        errors.push(`${at}.extensionPoint "${c.extensionPoint}" is not a known extension point`)
      }
      if (!c.id || typeof c.id !== 'string' || !c.id.trim()) {
        errors.push(`${at}.id is required`)
      }
      if (!c.label || typeof c.label !== 'string' || !c.label.trim()) {
        errors.push(`${at}.label is required`)
      }
      if (c.url !== undefined && c.url !== null && c.url !== '' && !isSafeUrl(c.url)) {
        errors.push(`${at}.url is not a safe url (must be http(s) or a relative /path)`)
      }
    })
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Sanitize a single contribution to a safe, whitelisted shape.
 * Drops any url that fails the safety check.
 */
export function sanitizeContribution(c, manifest = {}) {
  const safe = {
    extensionPoint: c.extensionPoint,
    id: c.id,
    label: c.label,
    appKey: manifest.app_key ?? manifest.appKey ?? null,
    manifestId: manifest.id ?? null,
  }
  if (c.icon != null) safe.icon = c.icon
  if (c.target != null) safe.target = c.target
  if (c.url != null && c.url !== '' && isSafeUrl(c.url)) safe.url = c.url
  if (c.config != null && typeof c.config === 'object') safe.config = c.config
  return safe
}

/**
 * Flatten the enabled contributions for a given extension point across manifests.
 * Skips disabled manifests entirely and any contribution that fails validation.
 * @param {Array} manifests - rows with { enabled, contributions, app_key, id }
 * @param {string} extensionPoint
 * @returns {Array} sanitized contributions
 */
export function contributionsFor(manifests, extensionPoint) {
  if (!Array.isArray(manifests)) return []
  const out = []
  for (const manifest of manifests) {
    if (!manifest) continue
    // enabled defaults to true when the column is absent/undefined.
    if (manifest.enabled === false) continue
    let contributions = manifest.contributions
    if (typeof contributions === 'string') {
      try { contributions = JSON.parse(contributions) } catch { contributions = [] }
    }
    if (!Array.isArray(contributions)) continue
    for (const c of contributions) {
      if (!c || typeof c !== 'object') continue
      if (c.extensionPoint !== extensionPoint) continue
      if (!EXTENSION_POINTS.includes(c.extensionPoint)) continue
      if (!c.id || !c.label) continue
      if (c.url != null && c.url !== '' && !isSafeUrl(c.url)) continue
      out.push(sanitizeContribution(c, manifest))
    }
  }
  return out
}
