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
 *   - URL attributes (`href`/`src`) are scheme allow-listed (JL-368): only
 *     https:, http:, mailto: and scheme-less relative URLs survive; anything
 *     else (javascript:, data:, vbscript:, blob:, file:, about:, …) is dropped.
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
//
// JL-368: `src` is currently unreachable — no tag on ALLOWED_TAGS has `src` in
// ALLOWED_ATTRS, so the check never fires for it. It is kept deliberately
// rather than removed: the day someone adds `img`/`video` to the allow-list
// they will add `src` to ALLOWED_ATTRS, and the URL check must already be
// wired up for it. Removing the entry would turn that future edit into a
// silently unchecked URL attribute. Cost of keeping it is zero.
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

// JL-368: URL schemes permitted in an allow-listed URL attribute.
//
// Everything else in this module is allow-listed (tags, attributes); the URL
// check was the one deny-list left, naming javascript:/data:/vbscript: and
// letting every other scheme through. The notable gap was `blob:` — a
// same-origin `blob:` URL of type text/html executes script on navigation, so
// an author could smuggle one into a description and it survived the
// sanitizer. `file:` and `about:` were equally unfiltered. Naming dangerous
// schemes can only ever be as complete as the list; naming safe ones is
// complete by construction.
//
// The permitted set is derived from what the real callers actually emit:
//   - RichTextEditor.jsx  — its link toolbar inserts `https://`, and its
//     JL-358 comment records that issue descriptions legitimately carry
//     `mailto:`, root-relative (`/projects/1`) and in-page (`#section`) links.
//     sanitizeHtml is the *only* URL gate on that path.
//   - KnowledgeBasePage.jsx — its markdown link rule already hard-restricts
//     the scheme to `https?://` before sanitizeHtml ever sees the href, so no
//     KB content can be affected by tightening this.
//   - IssueDetailPage.jsx goes through utils/editorContent.js, a separate
//     sanitizer, and is untouched by this function (see JL-359).
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto'])

// A scheme per RFC 3986: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":".
// `/`, `?`, `#`, `&` are absent from the charset, so a colon further along a
// relative path (`docs/ratio:1`) is correctly NOT read as a scheme — exactly
// how a browser splits it.
const URL_SCHEME_RE = /^([a-z][a-z0-9+.-]*):/

// JL-368: a relative URL that begins with two slash-ish characters is not
// root-relative — it is protocol-relative, and resolves to a foreign origin.
// A naive `startsWith('/')` test would wave `//evil.com/x` straight through.
// Backslash counts: for special schemes the URL parser maps `\` to `/`, so
// `\\evil.com`, `/\evil.com` and `\/evil.com` all resolve to https://evil.com
// just like `//evil.com` (verified against the WHATWG URL parser).
const PROTOCOL_RELATIVE_RE = /^[/\\]{2}/

/**
 * True when `value` is a URL we are willing to emit in an href/src.
 *
 * ALLOW-LIST (JL-368): https:, http:, mailto:, plus scheme-less relative URLs
 * (root-relative `/…`, in-page `#…`, query `?…` and path-relative `doc.html`).
 * Everything else — blob:, file:, about:, javascript:, data:, vbscript:, tel:,
 * ftp: and any scheme not yet invented — is rejected.
 */
function isSafeUrl(value) {
  // JL-358: normalization MUST run before the scheme test. Browsers strip
  // TAB/LF/CR from URLs and ignore leading C0 controls before resolving, so
  // `java<TAB>script:` executes; comparing the raw string would both miss that
  // and wrongly reject a legitimate `ht<TAB>tps:`. Stripping a superset of
  // what a browser strips is safe here because this normalized copy only ever
  // feeds the comparison below — the value emitted is still the raw one. It
  // also cannot launder a scheme: normalization removes only control chars,
  // spaces and hyphens, never letters or the colon, so the scheme's letters
  // (and which colon terminates it) are identical to what the browser sees.
  const normalized = String(value)
    .replace(URL_NORMALIZE_STRIP, '')
    .toLowerCase()

  // Nothing left to navigate to once normalized — not a URL we recognise.
  if (normalized === '') return false

  const scheme = URL_SCHEME_RE.exec(normalized)
  if (scheme) return ALLOWED_URL_SCHEMES.has(scheme[1])

  // No scheme → relative. Reject the protocol-relative forms that only *look*
  // root-relative; permit the rest. Scheme-less relatives such as
  // `example.com/page` and `my-doc.html` are permitted deliberately: they
  // cannot name a scheme (a browser needs a colon for that), so they can only
  // ever resolve against the current origin, and existing issue descriptions
  // are allowed to contain them (asserted since JL-358). Rejecting them would
  // break stored content for no security gain.
  return !PROTOCOL_RELATIVE_RE.test(normalized)
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
