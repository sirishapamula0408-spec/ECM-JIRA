// Status → category inference, shared by everything that colours by status.
//
// These two helpers started life as module-private functions inside
// `src/pages/BoardPage/BoardPage.jsx` (JL-311 / JL-312), which made them the de
// facto source of truth for "what colour is this status?" — but only for code
// living in that file. When JL-384 built the StatusLozenge it could not import
// them, so it hand-copied both with a comment naming BoardPage as the original.
// Two copies of a colour rule is exactly how a lozenge ends up disagreeing with
// the column heading above it, so JL-387 lifted them here: BoardPage and
// StatusLozenge now import the same functions and cannot drift apart.

/**
 * JL-311: fallback status→category inference for statuses that carry no
 * explicit category (the default/unconfigured board on ISSUE_STATUSES, or a
 * legacy status the project-statuses endpoint didn't tag).
 *
 * Returns 'done' | 'inprogress' | 'todo'.
 */
export function defaultCategoryForStatus(name) {
  if (name === 'Done') return 'done'
  if (name === 'In Progress' || name === 'Code Review') return 'inprogress'
  return 'todo'
}

/**
 * JL-312: a cancellation status (e.g. "Cancelled"/"Canceled") is terminal
 * (done-category) but NOT a success, so anything painting it — a board column
 * or a status lozenge — must stay neutral grey rather than green. Identified by
 * name, matching /cancel/i.
 */
export function isCancelStatus(name) {
  return /cancel/i.test(name || '')
}

/*
 * ── JL-457 ────────────────────────────────────────────────────────────────
 *
 * One resolver, five categories, used by every site that paints a status.
 *
 * The two helpers above answered "done, inprogress or todo?" — three buckets,
 * because that is all the board needed. Everything else invented its own
 * answer, and the answers disagreed: `In Progress` was blue in the lozenge,
 * green in the dashboard gadgets and amber in the Reports CFD. The fix is not
 * a fourth palette but a single question with a single answer.
 *
 * `cancelled` and `blocked` are new. Previously a cancelled status was folded
 * into neutral (JL-312 kept it out of the green) and a blocked status was
 * folded into in-progress by the workflow editor, so neither could be told
 * apart from an ordinary to-do or working status.
 */

/** The five categories, in workflow order. Also the token-name suffixes. */
export const STATUS_CATEGORIES = ['todo', 'inprogress', 'done', 'cancelled', 'blocked']

/**
 * A blocked status is identified by name, the same way JL-312 identifies a
 * cancellation. No project-status API field carries "blocked" — it is a
 * convention ("Blocked", "On Hold", "Waiting"), so name-matching is the only
 * signal available, and it degrades safely: an unmatched status keeps whatever
 * category it already had.
 */
export function isBlockedStatus(name) {
  return /\b(blocked|on hold|waiting)\b/i.test(name || '')
}

/**
 * Resolve a status to one of STATUS_CATEGORIES.
 *
 * Order matters. Cancelled and blocked are checked FIRST, because both would
 * otherwise be swallowed: a project-statuses row tags "Cancelled" as
 * done-category (it is terminal), and "Blocked" as inprogress (work is open).
 * Both are true and both are the wrong thing to paint.
 *
 * @param {string} status      the status name
 * @param {object} [categoryMap] optional name -> 'todo'|'inprogress'|'done'
 *                             from the project-statuses endpoint (JL-309)
 */
export function resolveStatusCategory(status, categoryMap) {
  const name = typeof status === 'string' ? status.trim() : ''
  if (!name) return 'todo'
  if (isCancelStatus(name)) return 'cancelled'
  if (isBlockedStatus(name)) return 'blocked'
  const category = (categoryMap && categoryMap[name]) || defaultCategoryForStatus(name)
  return STATUS_CATEGORIES.includes(category) ? category : 'todo'
}

/*
 * Category glyphs.
 *
 * Colour was the ONLY channel carrying category. In greyscale, in print, or to
 * a colour-blind reader, a status chip said nothing its text did not already
 * say — and the whole point of the colour is to be readable at a glance,
 * before the text is.
 *
 * Deliberately geometric rather than emoji: emoji render at wildly different
 * sizes across platforms, colour themselves (defeating the greyscale purpose),
 * and would break the chip's line-height. These are ASCII-safe glyphs that
 * inherit currentColor and the surrounding font size.
 */
export const CATEGORY_GLYPH = {
  todo: '○',        // empty circle — nothing started
  inprogress: '◐',  // half-filled — under way
  done: '●',        // filled — complete
  cancelled: '⊘',   // slashed — stopped, not completed
  blocked: '▲',     // warning triangle — attention
}

/** Screen-reader / tooltip wording for each category. */
export const CATEGORY_LABEL = {
  todo: 'To do',
  inprogress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
  blocked: 'Blocked',
}

/**
 * The CSS custom-property suffix for a status. Call sites build
 * `var(--status-${statusTokenName(s)}-bg)` rather than choosing a colour.
 */
export function statusTokenName(status, categoryMap) {
  return resolveStatusCategory(status, categoryMap)
}

/*
 * ── Priority ──────────────────────────────────────────────────────────────
 *
 * The ramp is neutral -> amber -> red-orange -> red, and contains NO GREEN.
 * Green previously meant Low in three places while simultaneously meaning Done
 * everywhere else, which made a green mark on a row genuinely ambiguous.
 *
 * `highest` resolves for imported data — JL-451 maps Atlassian's Highest onto
 * High for storage, but a UI fed a raw value should still colour it sanely
 * rather than fall through to neutral, which would read as *low*.
 */
export const PRIORITY_KEYS = ['low', 'medium', 'high', 'highest']

export function priorityTokenName(priority) {
  const name = typeof priority === 'string' ? priority.trim().toLowerCase() : ''
  if (name === 'highest' || name === 'blocker' || name === 'critical') return 'highest'
  if (name === 'high' || name === 'major') return 'high'
  if (name === 'medium' || name === 'normal') return 'medium'
  return 'low'
}
