// JL-135 — pure, testable helpers for the TipTap (ADF-style) editor.
// These MUST stay free of React / TipTap imports so they can be unit-tested
// without mounting the editor.
//
// JL-359: this module used to ALSO export a second, DOM-based `sanitizeHtml`
// that competed with `utils/sanitizeHtml.js`. It has been removed — there is
// exactly one sanitizer in the codebase now, `utils/sanitizeHtml.js`, and its
// allow-list absorbed the tags/attributes this one used to permit (table and
// friends, `class`, `title`) plus the anchor `rel`/`target` hardening it did.
// Do NOT reintroduce a sanitizer here; extend that module instead.

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
  // JL-359: the non-breaking space is written as an escape rather than a
  // literal character. The literal tripped `no-irregular-whitespace` and was
  // visually indistinguishable from a plain space in the source. Behaviour is
  // unchanged: strip non-breaking spaces, then trim.
  const stripped = htmlToPlainText(html).replace(/\u00A0/g, '').trim()
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
