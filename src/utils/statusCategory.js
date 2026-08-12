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
