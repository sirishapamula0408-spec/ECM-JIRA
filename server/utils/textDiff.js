/*
 * JL-109 — a line diff between two revisions of a page.
 *
 * ── Why a line diff, and why over TEXT ──────────────────────────────────────
 *
 * Page content is sanitised HTML (JL-76). Diffing the raw markup would show
 * `<p>` tags moving around, which is noise to the person asking "what changed
 * in this runbook". So the markup is reduced to its text first and the diff is
 * over that: it answers the question actually being asked.
 *
 * The cost is stated plainly rather than hidden: a change that is PURELY
 * formatting — bolding a word, turning a paragraph into a heading — produces
 * identical text on both sides and so shows as no change. The version list
 * still records that an edit happened and who made it, so nothing is lost,
 * but the diff will not explain it. A markup-aware diff is a different and
 * much larger piece of work, and this is the level a lite product needs.
 *
 * ── Why hand-written ────────────────────────────────────────────────────────
 *
 * This is a textbook LCS over lines, about forty lines of code, and the
 * alternative is a dependency for something the standard algorithm solves
 * exactly. Bounded below so a pathological pair of revisions cannot make the
 * server chew a quadratic matrix.
 */

/** Above this many lines on either side, fall back to a coarse diff. */
const LCS_LINE_CAP = 2000

/**
 * Longest common subsequence of two line arrays, as a matrix walk.
 *
 * O(n*m) in time and space, which is why LCS_LINE_CAP exists: two 10k-line
 * revisions would be a hundred million cells, and a page that size is a
 * pathological input rather than a real one.
 */
function lcsMatrix(a, b) {
  const rows = a.length + 1
  const cols = b.length + 1
  // A single flat array rather than nested ones: same arithmetic, far less
  // allocation for the sizes this runs at.
  const grid = new Uint32Array(rows * cols)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      grid[i * cols + j] = a[i] === b[j]
        ? grid[(i + 1) * cols + (j + 1)] + 1
        : Math.max(grid[(i + 1) * cols + j], grid[i * cols + (j + 1)])
    }
  }
  return { grid, cols }
}

/**
 * Diff two line arrays.
 *
 * @returns {Array<{ type: 'same'|'added'|'removed', text: string }>}
 */
export function diffLines(fromLines, toLines) {
  const a = Array.isArray(fromLines) ? fromLines : []
  const b = Array.isArray(toLines) ? toLines : []

  // Nothing in common to walk — emit the whole of each side.
  if (a.length === 0 || b.length === 0) {
    return [
      ...a.map((text) => ({ type: 'removed', text })),
      ...b.map((text) => ({ type: 'added', text })),
    ]
  }

  /*
   * Too large to diff properly. Saying so — by emitting a wholesale
   * replacement — is honest; silently returning "no changes" for a big page
   * would be a lie, and timing out would be worse than either.
   */
  if (a.length > LCS_LINE_CAP || b.length > LCS_LINE_CAP) {
    return [
      ...a.map((text) => ({ type: 'removed', text })),
      ...b.map((text) => ({ type: 'added', text })),
    ]
  }

  const { grid, cols } = lcsMatrix(a, b)
  const out = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i += 1
      j += 1
    } else if (grid[(i + 1) * cols + j] >= grid[i * cols + (j + 1)]) {
      out.push({ type: 'removed', text: a[i] })
      i += 1
    } else {
      out.push({ type: 'added', text: b[j] })
      j += 1
    }
  }
  while (i < a.length) { out.push({ type: 'removed', text: a[i] }); i += 1 }
  while (j < b.length) { out.push({ type: 'added', text: b[j] }); j += 1 }
  return out
}

/*
 * Reduce stored page content to the lines a reader would see.
 *
 * Deliberately NOT a sanitiser and not a renderer — it strips markup for
 * COMPARISON only, and its output is never sent anywhere as HTML. The one
 * sanitiser remains src/utils/sanitizeHtml.js (JL-359); adding a second
 * cleaning path here is exactly what that ticket deleted.
 */
export function contentToLines(content) {
  const text = String(content ?? '')
    // Block boundaries become line breaks, so a paragraph is a line.
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Cell boundaries become spaces so a table row reads as one line.
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    // The few entities the sanitiser emits, back to their characters.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // &amp; last, or it would double-decode the ones above.
    .replace(/&amp;/gi, '&')

  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    // Blank lines carry no meaning here and would show as spurious changes
    // whenever spacing shifted.
    .filter((line) => line !== '')
}

/** A one-line tally, so a caller can say "3 added, 1 removed" without walking. */
export function summarise(diff) {
  let added = 0
  let removed = 0
  for (const row of diff) {
    if (row.type === 'added') added += 1
    else if (row.type === 'removed') removed += 1
  }
  return { added, removed, unchanged: diff.length - added - removed }
}
