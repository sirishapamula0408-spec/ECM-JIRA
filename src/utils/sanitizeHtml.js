/**
 * sanitizeHtml — a small, dependency-free HTML sanitizer (JL-91).
 *
 * Hardens against stored XSS when user-provided text (issue descriptions,
 * comments, wiki markdown) is converted to HTML and injected via
 * `dangerouslySetInnerHTML`.
 *
 * Approach: strict ALLOW-LIST.
 *   - A safe subset of tags is preserved.
 *   - `<script>`, `<style>`, `<iframe>` elements are dropped entirely
 *     (tag + contents).
 *   - Event-handler attributes (`on*`) are removed.
 *   - `javascript:` and `data:` URIs in `href`/`src` are neutralized.
 *   - Any tag NOT on the allow-list is escaped (rendered as literal text),
 *     so it can never execute.
 *
 * Works in both the browser and Node/jsdom test environments because it
 * relies only on string processing (no DOM APIs required).
 *
 * @param {string} dirty - untrusted HTML string
 * @returns {string} sanitized HTML safe to inject
 */

// Tags allowed to pass through as real HTML elements.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 'del', 's',
  'ul', 'ol', 'li', 'a', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'span',
])

// Elements whose entire contents must be discarded, not just the tag.
const DANGEROUS_TAGS = new Set(['script', 'style', 'iframe'])

// Void tags that never have a closing tag.
const VOID_TAGS = new Set(['br'])

// Per-tag allow-list of attributes. '*' applies to every allowed tag.
const ALLOWED_ATTRS = {
  a: new Set(['href', 'target', 'rel']),
  '*': new Set([]),
}

// Attributes that carry a URL and must be scheme-checked.
const URL_ATTRS = new Set(['href', 'src'])

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Characters removed before the scheme is compared.
//
// JL-358: this class previously contained only `-` and space, so a scheme split
// by a control character (`java<TAB>script:`) sailed past every check below and
// the link executed — browsers strip TAB/LF/CR from URLs before resolving them,
// and ignore leading C0 controls entirely. The control-character class had been
// dropped at some point, leaving the `no-control-regex` disable directive below
// unused, which is what gave the regression away.
//
// Covers: C0 controls incl. NUL/TAB/LF/VT/FF/CR (\u0000-\u001F) and space
// (\u0020), DEL and the C1 controls (\u007F-\u009F), plus the literal
// hyphen (trailing `-`) that the original normalization stripped. Stripping
// more than a browser strictly would is safe here: this normalization only
// ever feeds the scheme comparison, so it can add false *rejections* at worst
// — and no valid URL scheme contains a control character.
// eslint-disable-next-line no-control-regex
const URL_NORMALIZE_STRIP = /[\u0000-\u0020\u007F-\u009F-]+/g

// Reject javascript:/data:/vbscript: URIs. Whitespace, control chars and
// case are normalized first so obfuscated schemes (e.g. "java\tscript:")
// cannot slip through.
function isSafeUrl(value) {
  const normalized = String(value)
    .replace(URL_NORMALIZE_STRIP, '')
    .toLowerCase()
  if (/^javascript:/.test(normalized)) return false
  if (/^data:/.test(normalized)) return false
  if (/^vbscript:/.test(normalized)) return false
  return true
}

function sanitizeAttributes(tagName, attrString) {
  if (!attrString) return ''
  const allowed = new Set([
    ...(ALLOWED_ATTRS['*'] || []),
    ...(ALLOWED_ATTRS[tagName] || []),
  ])
  const out = []
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g
  let m
  while ((m = attrRe.exec(attrString)) !== null) {
    const name = m[1].toLowerCase()
    // Drop all event handlers regardless of tag.
    if (name.startsWith('on')) continue
    if (!allowed.has(name)) continue

    let rawValue = m[2]
    if (rawValue === undefined) {
      out.push(name)
      continue
    }
    // Strip surrounding quotes if present.
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      rawValue = rawValue.slice(1, -1)
    }
    if (URL_ATTRS.has(name) && !isSafeUrl(rawValue)) continue

    out.push(`${name}="${escapeHtml(rawValue)}"`)
  }
  return out.length ? ' ' + out.join(' ') : ''
}

export function sanitizeHtml(dirty) {
  if (dirty == null) return ''
  let s = String(dirty)

  // 1. Remove dangerous elements together with their contents (paired form),
  //    then mop up any stray/unclosed opening or closing dangerous tags.
  s = s.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  s = s.replace(/<\/?(script|style|iframe)\b[^>]*>/gi, '')

  // 2. Tokenize remaining tags; keep allow-listed tags, escape the rest.
  //    The tag name must immediately follow `<` (or `</`), matching how
  //    browsers parse markup — this avoids treating plain text like
  //    "a < b" as an element.
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>])*)>/g
  let result = ''
  let lastIndex = 0
  let m
  while ((m = tagRe.exec(s)) !== null) {
    // Preserve text before this tag verbatim (it is not markup).
    result += s.slice(lastIndex, m.index)
    lastIndex = tagRe.lastIndex

    const isClosing = m[1] === '/'
    const name = m[2].toLowerCase()
    const attrString = m[3] || ''

    if (DANGEROUS_TAGS.has(name)) {
      // Any leftover dangerous tag → drop entirely.
      continue
    }

    if (ALLOWED_TAGS.has(name)) {
      if (isClosing) {
        if (!VOID_TAGS.has(name)) result += `</${name}>`
      } else if (VOID_TAGS.has(name)) {
        result += `<${name}/>`
      } else {
        result += `<${name}${sanitizeAttributes(name, attrString)}>`
      }
    } else {
      // Disallowed tag → escape it so it renders as literal text.
      result += escapeHtml(m[0])
    }
  }
  result += s.slice(lastIndex)
  return result
}

export default sanitizeHtml
