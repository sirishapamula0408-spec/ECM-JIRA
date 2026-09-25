/*
 * JL-148 — address an issue by its key wherever one exists.
 *
 * Every link in the app built `/issues/${issue.id}`, so clicking JL-63 landed
 * on /issues/402. 402 is the issues.id primary key: global across all projects
 * and unrelated to the per-project key sequence, which is why it reads as a
 * random number and why id 305 turns out to be DM-266. Atlassian addresses
 * issues as /browse/JL-63; a URL carrying the key is shareable, guessable and
 * meaningful, and it does not leak internal row ids or record volume.
 *
 * The API accepts BOTH forms on GET /api/issues/:idOrKey, so nothing breaks
 * while links are migrated, and every /issues/<number> URL already in someone's
 * bookmarks or chat history keeps resolving.
 *
 * ── Why /browse ──────────────────────────────────────────────────────────────
 * The canonical path is /browse/JL-63, matching Atlassian
 * (https://sedin.atlassian.net/browse/JL-454). That is the URL people paste
 * into chat, type from memory and recognise on sight. /issues/:ref stays
 * registered as an alias so every link already shared keeps working — both
 * routes render the same page, and the page accepts either form of the param.
 *
 * The prefix is stated ONCE, here. Every call site goes through issueHref(),
 * so moving it again is a one-line change rather than a sweep of twenty files.
 */

/*
 * A key has a leading letter, may contain digits after it (TP1-11 is real
 * here), and ends in -<number>. The leading-letter requirement is what makes a
 * bare number unambiguous: a purely numeric ref is always an id.
 *
 * Kept in step with ISSUE_KEY_RE in server/routes/issues.js — the two decide
 * the same question on opposite sides of the wire, and a client that builds a
 * link the server will not parse is worse than no link at all.
 */
const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/

/** True when `ref` is shaped like an issue key rather than a numeric id. */
export function isIssueKey(ref) {
  return ISSUE_KEY_RE.test(String(ref ?? '').trim())
}

/**
 * The route segment for an issue: its key when it has one, else its id.
 *
 * Falls back rather than refusing, because not every caller has a fully loaded
 * issue — a freshly created row, a lightweight row from a list endpoint that
 * omits the key, or an optimistic local object. A numeric link still works; it
 * is only less pleasant to read.
 */
export function issueRefOf(issue) {
  if (!issue || typeof issue !== 'object') return ''
  const key = String(issue.key ?? '').trim()
  return key || String(issue.id ?? '')
}

/** The canonical client-side path for an issue: /browse/JL-63. */
export const ISSUE_PATH_PREFIX = '/browse'

/** The legacy path, still routed so existing links resolve. */
export const ISSUE_PATH_PREFIX_LEGACY = '/issues'

export function issueHref(issue) {
  const ref = issueRefOf(issue)
  return ref ? `${ISSUE_PATH_PREFIX}/${encodeURIComponent(ref)}` : ISSUE_PATH_PREFIX
}

/**
 * Does this issue correspond to the given route param?
 *
 * Used where a page looks an issue up in already-loaded context state before
 * fetching it. Compares against both identifiers because the param may be
 * either, and compares keys case-insensitively for the same reason the server
 * does — a hand-typed or email-pasted link should resolve.
 */
export function issueMatchesRef(issue, ref) {
  if (!issue) return false
  const value = String(ref ?? '').trim()
  if (!value) return false
  if (/^\d+$/.test(value)) return Number(issue.id) === Number(value)
  return String(issue.key ?? '').toUpperCase() === value.toUpperCase()
}

/**
 * The numeric id for a route param, when it can be known without a lookup.
 * Returns null for a key — the caller must resolve that through the API, which
 * is what the detail page does by fetching with the raw ref.
 */
export function numericIdFromRef(ref) {
  const value = String(ref ?? '').trim()
  return /^\d+$/.test(value) ? Number(value) : null
}
