import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * JL-381 — dead-CSS guard for the Activity page.
 *
 * JL-378/379/380 migrated ActivityFeedPage to MUI, orphaning the af-* rules
 * that styled the old header, filters, loading/empty paragraphs and the
 * infinite-scroll sentinel. JL-381 deleted those rules. This suite pins both
 * directions of that cleanup at the source level:
 *
 *  1. every class selector remaining in ActivityFeedPage.css is actually
 *     applied by ActivityFeedPage.jsx (no dead CSS can creep back in), and
 *  2. the selectors JL-381 removed stay removed.
 *
 * A render-based assertion would be weaker here: the component applies every
 * kept class unconditionally or under states already covered by the JL-378/380
 * suites, so the meaningful invariant is the CSS↔JSX cross-reference itself.
 *
 * JL-382 extended the same cleanup: replacing the bespoke timeline cards with
 * an MUI table orphaned the af-item, af-actor, af-action and af-type-badge
 * rules, so those joined the removed list and the table/toolbar classes joined
 * the kept list.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const pageDir = path.join(here, '..', 'pages', 'ActivityFeedPage')
const css = fs.readFileSync(path.join(pageDir, 'ActivityFeedPage.css'), 'utf8')
const jsx = fs.readFileSync(path.join(pageDir, 'ActivityFeedPage.jsx'), 'utf8')

/**
 * Class names used in CSS selectors (comments stripped).
 *
 * MUI's own global class names (`.MuiAvatar-root` & co) are excluded: they are
 * emitted by the component library, not written as string literals in the JSX,
 * so they can never appear in `jsxClasses` and would be false "dead CSS". They
 * are only ever used here as specificity qualifiers on one of our own classes
 * (e.g. `.af-avatar.MuiAvatar-root`), which is still covered by the af-* half
 * of the compound selector.
 */
function cssClasses(source) {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  // Only look at selector text (everything outside {...} blocks) so that
  // decimal values or dots inside declarations can never match.
  const selectorText = noComments.replace(/\{[^}]*\}/g, '\n')
  const classes = new Set()
  for (const match of selectorText.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
    if (/^Mui[A-Z]/.test(match[1])) continue
    classes.add(match[1])
  }
  return classes
}

/** Class names applied via string-literal className props in the JSX. */
function jsxClasses(source) {
  const classes = new Set()
  for (const match of source.matchAll(/className\s*=\s*["']([^"']+)["']/g)) {
    for (const cls of match[1].split(/\s+/).filter(Boolean)) classes.add(cls)
  }
  return classes
}

describe('JL-381 — ActivityFeedPage.css contains no dead rules', () => {
  it('the component still applies string-literal classNames (guard preconditions)', () => {
    // If the component ever moves to computed classNames, this suite must be
    // rewritten rather than silently passing on an empty set.
    const used = jsxClasses(jsx)
    expect(used.size).toBeGreaterThan(0)
    expect(used).toContain('activity-feed-page')
  })

  it('every class selector in the CSS is applied by the component', () => {
    const defined = cssClasses(css)
    const used = jsxClasses(jsx)
    const dead = [...defined].filter((cls) => !used.has(cls))
    expect(dead).toEqual([])
  })

  it('the selectors deleted by JL-381 do not reappear in the CSS', () => {
    const defined = cssClasses(css)
    const removed = [
      'af-header',
      'af-total',
      'af-filters',
      'af-filter-select',
      'af-loading',
      'af-empty',
      'af-page-info',
      'af-sentinel',
    ]
    const resurrected = removed.filter((cls) => defined.has(cls))
    expect(resurrected).toEqual([])
  })

  it('the selectors deleted by JL-382 do not reappear in the CSS', () => {
    const defined = cssClasses(css)
    // The bespoke timeline card markup these styled is gone — activities are
    // an MUI table now, so re-adding any of these means dead CSS is back.
    const removed = [
      'af-timeline',
      'af-item',
      'af-item-avatar',
      'af-item-content',
      'af-item-header',
      'af-actor',
      'af-action',
      'af-type-badge',
    ]
    const resurrected = removed.filter((cls) => defined.has(cls))
    expect(resurrected).toEqual([])
  })

  it('keeps the rules the migrated component still relies on', () => {
    const defined = cssClasses(css)
    const kept = [
      'activity-feed-page',
      'af-filter-bar',
      'af-table-container',
      'af-user-cell',
      'af-avatar',
      'af-time',
      'af-pagination',
    ]
    const missing = kept.filter((cls) => !defined.has(cls))
    expect(missing).toEqual([])
    // …and the component really does apply each of them.
    const used = jsxClasses(jsx)
    expect(kept.filter((cls) => !used.has(cls))).toEqual([])
  })
})
