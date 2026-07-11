// JL-135 — pure, testable helpers for the TipTap (ADF-style) editor.
// These MUST stay free of React / TipTap imports so they can be unit-tested
// without mounting the editor.

const BLOCK_TAGS = /<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi
const BR_TAGS = /<br\s*\/?>/gi

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

/**
 * Decode a small, safe set of HTML entities. Numeric entities are decoded too.
 */
export function decodeEntities(str) {
  if (!str) return ''
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&[a-z]+;|&#39;/gi, (m) => (m in ENTITIES ? ENTITIES[m] : m))
}

/**
 * Convert an HTML string to readable plain text.
 * Strips all tags, turns block-closers / <br> into newlines, decodes entities,
 * and collapses excess whitespace. Pure — no DOM required.
 */
export function htmlToPlainText(html) {
  if (html == null) return ''
  let text = String(html)
  // Drop script/style contents entirely.
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  // Preserve line structure.
  text = text.replace(BR_TAGS, '\n').replace(BLOCK_TAGS, '\n')
  // Strip remaining tags.
  text = text.replace(/<[^>]+>/g, '')
  text = decodeEntities(text)
  // Collapse spaces/tabs but keep newlines; trim trailing whitespace per line.
  text = text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text
}

/**
 * True when the HTML represents an "empty" document — used to disable Save.
 * Handles '', '<p></p>', '<p><br></p>', whitespace-only and entity-only cases.
 */
export function isEmptyDoc(html) {
  if (html == null) return true
  const stripped = htmlToPlainText(html).replace(/ /g, '').trim()
  return stripped.length === 0
}

/**
 * Heuristic: does this string contain HTML markup (vs. plain text/markdown)?
 * Used to decide whether stored legacy descriptions should render as HTML.
 */
export function looksLikeHtml(str) {
  if (!str) return false
  return /<\/?[a-z][\s\S]*>/i.test(String(str))
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'code', 'pre',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'hr',
  'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span',
])
const ALLOWED_ATTRS = {
  a: new Set(['href', 'title', 'target', 'rel']),
  '*': new Set(['class']),
}

/**
 * Allowlist-based HTML sanitizer. Uses the DOM when available (browser/jsdom);
 * falls back to a conservative regex strip when no DOM is present.
 * Removes scripts, event handlers, javascript: URLs, and disallowed tags/attrs.
 */
export function sanitizeHtml(html) {
  if (html == null) return ''
  const input = String(html)
  if (typeof document === 'undefined' || !document.implementation) {
    return regexSanitize(input)
  }
  const doc = document.implementation.createHTMLDocument('')
  const root = doc.body
  root.innerHTML = input
  sanitizeNode(root)
  return root.innerHTML
}

function sanitizeNode(node) {
  const children = Array.from(node.childNodes)
  for (const child of children) {
    if (child.nodeType === 8) {
      // comment
      child.remove()
      continue
    }
    if (child.nodeType !== 1) continue // keep text nodes
    const tag = child.tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap disallowed element: replace with its (sanitized) children.
      sanitizeNode(child)
      const parent = child.parentNode
      while (child.firstChild) parent.insertBefore(child.firstChild, child)
      child.remove()
      continue
    }
    // Scrub attributes.
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase()
      const allowed =
        (ALLOWED_ATTRS[tag] && ALLOWED_ATTRS[tag].has(name)) ||
        ALLOWED_ATTRS['*'].has(name)
      if (!allowed || name.startsWith('on')) {
        child.removeAttribute(attr.name)
        continue
      }
      if (name === 'href') {
        const val = attr.value.trim().toLowerCase()
        if (val.startsWith('javascript:') || val.startsWith('data:') || val.startsWith('vbscript:')) {
          child.removeAttribute(attr.name)
        }
      }
    }
    if (tag === 'a' && child.getAttribute('href')) {
      child.setAttribute('rel', 'noopener noreferrer')
      if (!child.getAttribute('target')) child.setAttribute('target', '_blank')
    }
    sanitizeNode(child)
  }
}

function regexSanitize(input) {
  return input
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '')
}
