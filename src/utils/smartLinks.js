/**
 * Smart issue-key links (JL-138).
 *
 * Utilities for detecting JIRA-style issue keys (e.g. "JL-42") inside free text
 * (comments, descriptions) so they can be auto-rendered as clickable links.
 *
 * Issue-key format: PROJECTKEY-NUMBER where PROJECTKEY is an uppercase letter
 * followed by one or more uppercase letters/digits, then a hyphen and a number.
 * Examples that match: JL-42, ABC-1, PROJ2-100. Examples that do NOT match:
 * lowercase "jl-42", a bare number "42", or "1-2" (must start with a letter).
 *
 * URL-safety: to avoid linkifying keys that appear inside a URL
 * (e.g. "https://example.com/JL-42"), the tokenizer first recognises http(s)
 * URLs and emits them as plain text segments, scanning for issue keys only in
 * the remaining text.
 */

// Matches a full issue key, anchored on word boundaries so it will not fire in
// the middle of a larger word (e.g. "xJL-42" or "JL-42x" are not matched).
export const ISSUE_KEY_REGEX = /\b[A-Z][A-Z0-9]+-\d+\b/

// Combined scanner: group 1 = an http(s) URL, group 2 = an issue key.
// URLs are captured first so any key embedded in a URL is treated as plain text.
const TOKEN_REGEX = /(https?:\/\/[^\s]+)|(\b[A-Z][A-Z0-9]+-\d+\b)/g

/**
 * Split `text` into an ordered list of segments:
 *   { type: 'text', value }      — literal text (including URLs)
 *   { type: 'issueKey', key }    — a detected issue key
 *
 * Concatenating every segment's `value`/`key` reproduces the original string.
 *
 * @param {string} text
 * @returns {Array<{type:'text', value:string}|{type:'issueKey', key:string}>}
 */
export function tokenizeIssueKeys(text) {
  if (text == null || text === '') return []
  const str = String(text)
  const segments = []
  let lastIndex = 0
  // Use a fresh regex instance to keep this function reentrant/stateless.
  const re = new RegExp(TOKEN_REGEX.source, 'g')
  let m
  while ((m = re.exec(str)) !== null) {
    const [full, url, key] = m
    if (m.index > lastIndex) {
      segments.push({ type: 'text', value: str.slice(lastIndex, m.index) })
    }
    if (url) {
      // A URL — keep it as literal text (do not linkify keys inside it).
      segments.push({ type: 'text', value: url })
    } else {
      segments.push({ type: 'issueKey', key })
    }
    lastIndex = m.index + full.length
    // Guard against zero-length matches (shouldn't happen with this regex).
    if (full.length === 0) re.lastIndex += 1
  }
  if (lastIndex < str.length) {
    segments.push({ type: 'text', value: str.slice(lastIndex) })
  }
  return segments
}

/**
 * Return the unique issue keys found in `text`, in first-seen order.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractIssueKeys(text) {
  const seen = new Set()
  const keys = []
  for (const seg of tokenizeIssueKeys(text)) {
    if (seg.type === 'issueKey' && !seen.has(seg.key)) {
      seen.add(seg.key)
      keys.push(seg.key)
    }
  }
  return keys
}
