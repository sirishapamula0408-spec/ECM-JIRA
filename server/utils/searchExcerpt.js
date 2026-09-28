import { contentToLines } from './textDiff.js'

/*
 * JL-112 — the snippet of a page that shows WHY it matched.
 *
 * ── Plain text, never HTML ──────────────────────────────────────────────────
 *
 * The excerpt is returned as text plus the offsets of the matches, and the
 * client wraps those ranges in elements itself. It is never returned as
 * pre-marked HTML.
 *
 * That is deliberate and it is the security-relevant decision here. Emitting
 * `…the <mark>term</mark> appears…` would mean building HTML out of stored
 * page content on a path that does not go through sanitizeHtml — a second
 * place where markup is assembled, which is exactly what JL-359 deleted. With
 * offsets there is no markup to get wrong: the client renders text nodes.
 *
 * ── Markup is stripped by the module that already does it ───────────────────
 *
 * contentToLines is reused from the JL-109 diff rather than reimplemented.
 * Two functions reducing page HTML to readable text would drift the first time
 * a tag was added to the editor.
 */

/** Characters of context either side of the match. */
const CONTEXT = 60
/** Never return more than this, however long the surrounding line is. */
const MAX_EXCERPT = 240

/** Escape a user's term so it cannot act as a regular expression. */
function escapeRe(term) {
  return String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Every match of `term` in `text`, as [start, end) offsets.
 *
 * Returned as offsets rather than as marked-up text so the caller renders
 * elements around ranges and never parses markup.
 */
export function matchRanges(text, term) {
  const haystack = String(text ?? '')
  const needle = String(term ?? '').trim()
  if (!haystack || !needle) return []

  const re = new RegExp(escapeRe(needle), 'gi')
  const out = []
  let m = re.exec(haystack)
  while (m) {
    out.push([m.index, m.index + m[0].length])
    // A zero-length match would spin here forever; there is no such term
    // after the trim above, but the guard costs nothing and the failure it
    // prevents is a hung request.
    if (m[0].length === 0) break
    m = re.exec(haystack)
  }
  return out
}

/**
 * Build the excerpt for one page.
 *
 * @param {string} content  stored page content (HTML or legacy plain text)
 * @param {string} term     what the user searched for
 * @returns {{ text: string, ranges: Array<[number, number]>, truncatedStart: boolean, truncatedEnd: boolean }}
 */
export function buildExcerpt(content, term) {
  const text = contentToLines(content).join(' ')
  const needle = String(term ?? '').trim()

  if (!text) return { text: '', ranges: [], truncatedStart: false, truncatedEnd: false }

  const first = needle
    ? text.toLowerCase().indexOf(needle.toLowerCase())
    : -1

  /*
   * No match in the BODY is a normal outcome, not a failure: the page may
   * have matched on its title or its Space name (JL-114). Showing the opening
   * of the page is more useful than showing nothing.
   */
  if (first < 0) {
    const head = text.slice(0, MAX_EXCERPT)
    return {
      text: head,
      ranges: [],
      truncatedStart: false,
      truncatedEnd: head.length < text.length,
    }
  }

  // Window the text around the first match, then re-find the matches inside
  // the window — offsets must be relative to what is actually returned.
  let start = Math.max(0, first - CONTEXT)
  let end = Math.min(text.length, first + needle.length + CONTEXT)

  // Avoid cutting mid-word at the start, which reads as a typo.
  if (start > 0) {
    const space = text.lastIndexOf(' ', start)
    if (space > 0 && first - space < CONTEXT * 2) start = space + 1
  }
  if (end < text.length) {
    const space = text.indexOf(' ', end)
    if (space > 0 && space - end < 20) end = space
  }
  if (end - start > MAX_EXCERPT) end = start + MAX_EXCERPT

  const window = text.slice(start, end)
  return {
    text: window,
    ranges: matchRanges(window, needle),
    truncatedStart: start > 0,
    truncatedEnd: end < text.length,
  }
}
