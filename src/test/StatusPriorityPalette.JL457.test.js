// JL-457 — one status-category palette, one priority ramp.
//
// Status and priority colour used to be decided in 13 places, four of them full
// conflicting palettes. `In Progress` was blue in the lozenge, GREEN in the
// dashboard gadgets and AMBER in the Reports CFD; `To Do` was grey, purple and
// blue in the same three. Green meant both "Done" and "Low priority".
//
// The tests that matter here are the ones that fail when a NEW literal appears.
// Asserting only that the tokens exist would pass just as happily on the day
// someone adds a fourteenth palette next to them.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { contrastRatio } from '../utils/color'
import {
  resolveStatusCategory,
  priorityTokenName,
  isBlockedStatus,
  STATUS_CATEGORIES,
  CATEGORY_GLYPH,
  PRIORITY_KEYS,
} from '../utils/statusCategory'

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const variables = read('src/styles/variables.css')
const theme = read('src/styles/theme.css')

describe('JL-457 — the palette is defined once', () => {
  it('defines bg/border/text/accent for all five categories', () => {
    for (const cat of STATUS_CATEGORIES) {
      for (const part of ['bg', 'border', 'text', 'accent']) {
        expect(variables, `--status-${cat}-${part}`).toContain(`--status-${cat}-${part}:`)
      }
    }
  })

  it('defines the whole priority ramp', () => {
    for (const key of PRIORITY_KEYS) {
      for (const part of ['bg', 'text', 'accent']) {
        expect(variables, `--priority-${key}-${part}`).toContain(`--priority-${key}-${part}:`)
      }
    }
  })

  it('overrides every one of them for dark theme', () => {
    // A category defined only for light would render an unreadable chip in dark
    // mode — and the old code compensated by restating brightened hexes at each
    // call site, which is how the lozenge and the board drifted apart.
    for (const cat of STATUS_CATEGORIES) {
      expect(theme, `dark --status-${cat}-bg`).toContain(`--status-${cat}-bg:`)
      expect(theme, `dark --status-${cat}-text`).toContain(`--status-${cat}-text:`)
    }
    for (const key of PRIORITY_KEYS) {
      expect(theme, `dark --priority-${key}-accent`).toContain(`--priority-${key}-accent:`)
    }
  })
})

describe('JL-457 — the priority ramp contains no green', () => {
  // The core defect. Green was Done AND Low, so a green mark on a row could not
  // be read without knowing which control drew it.
  const GREENS = ['#00875a', '#36b37e', '#006644', '#e3fcef', '#abf5d1', '#7fb239', '#4bce97']

  function priorityBlock(css) {
    // Every --priority-* declaration, light and dark.
    return (css.match(/--priority-[a-z-]+:\s*[^;]+;/g) || []).join('\n').toLowerCase()
  }

  it('has no green hex in any priority token, light or dark', () => {
    const block = priorityBlock(variables) + '\n' + priorityBlock(theme)
    for (const green of GREENS) {
      expect(block, `priority ramp contains ${green}`).not.toContain(green)
    }
  })

  it('maps Low to the neutral step, not to a success colour', () => {
    expect(priorityTokenName('Low')).toBe('low')
    expect(priorityTokenName('low')).toBe('low')
  })

  it('resolves the imported Atlassian names JL-451 has to cope with', () => {
    expect(priorityTokenName('Highest')).toBe('highest')
    expect(priorityTokenName('Critical')).toBe('highest')
    expect(priorityTokenName('Blocker')).toBe('highest')
    expect(priorityTokenName('Major')).toBe('high')
    // An unknown value must not land on `high` and manufacture false urgency.
    expect(priorityTokenName('wibble')).toBe('low')
  })
})

describe('JL-457 — statuses resolve to categories, not to hues', () => {
  it('puts every in-progress status in one category', () => {
    // Code Review was purple in the workflow editor and amber in Summary. It is
    // an in-progress status like any other.
    expect(resolveStatusCategory('In Progress')).toBe('inprogress')
    expect(resolveStatusCategory('Code Review')).toBe('inprogress')
  })

  it('keeps cancelled out of the done green (JL-312)', () => {
    expect(resolveStatusCategory('Cancelled')).toBe('cancelled')
    expect(resolveStatusCategory('Canceled')).toBe('cancelled')
    // Even when the API tags it done-category, which it does: cancellation IS
    // terminal. Terminal is not the same as successful.
    expect(resolveStatusCategory('Cancelled', { Cancelled: 'done' })).toBe('cancelled')
  })

  it('recognises blocked, which no API field carries', () => {
    expect(isBlockedStatus('Blocked')).toBe(true)
    expect(isBlockedStatus('On Hold')).toBe(true)
    expect(isBlockedStatus('In Progress')).toBe(false)
    // The workflow editor stores Blocked as inprogress; it must still paint amber.
    expect(resolveStatusCategory('Blocked', { Blocked: 'inprogress' })).toBe('blocked')
  })

  it('honours a project category map for statuses it cannot infer', () => {
    expect(resolveStatusCategory('In Rework', { 'In Rework': 'inprogress' })).toBe('inprogress')
    expect(resolveStatusCategory('In UAT', { 'In UAT': 'done' })).toBe('done')
  })

  it('degrades an unknown status to todo rather than throwing', () => {
    expect(resolveStatusCategory('')).toBe('todo')
    expect(resolveStatusCategory(null)).toBe('todo')
    expect(resolveStatusCategory('Wibble')).toBe('todo')
    expect(resolveStatusCategory('X', { X: 'nonsense' })).toBe('todo')
  })
})

describe('JL-457 — every token pair is legible', () => {
  /*
   * This inherits JL-324's guarantee and strengthens it.
   *
   * JL-324 checked contrast at RENDER time, because a workflow node could carry
   * any hex a user picked and dark text could land on a dark fill (~1.5:1).
   * JL-457 removes the arbitrary hex — a node now paints from one of five known
   * category token pairs — so the check moves to the pairs themselves. Checking
   * the source of truth once is strictly better than checking one rendering of
   * it, and it covers every consumer rather than the one under test.
   */
  const tokenValue = (src, name) => (src.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim()

  it.each(STATUS_CATEGORIES)('status %s: text on bg meets WCAG AA', (cat) => {
    const bg = tokenValue(variables, `status-${cat}-bg`)
    const fg = tokenValue(variables, `status-${cat}-text`)
    expect(contrastRatio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(PRIORITY_KEYS)('priority %s: text on bg meets WCAG AA', (key) => {
    const bg = tokenValue(variables, `priority-${key}-bg`)
    const fg = tokenValue(variables, `priority-${key}-text`)
    expect(contrastRatio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })
})

describe('JL-457 — category survives greyscale', () => {
  it('gives every category a distinct glyph', () => {
    const glyphs = STATUS_CATEGORIES.map((c) => CATEGORY_GLYPH[c])
    expect(glyphs.filter(Boolean)).toHaveLength(STATUS_CATEGORIES.length)
    expect(new Set(glyphs).size).toBe(STATUS_CATEGORIES.length)
  })

  it('uses geometric glyphs, not emoji', () => {
    // Emoji colour themselves — which defeats the point — and render at wildly
    // different sizes across platforms, breaking the chip's line-height.
    for (const g of Object.values(CATEGORY_GLYPH)) {
      expect(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(g), `${g} is emoji`).toBe(false)
    }
  })
})

describe('JL-457 — no site keeps its own status or priority palette', () => {
  // The regression guard. Each of these files held a competing palette; a new
  // literal in any of them re-splits the app.
  const GUARDED = [
    'src/components/dashboard/gadgets/gadgetChartUtils.js',
    'src/pages/ProjectSummaryPage/ProjectSummaryPage.jsx',
    'src/pages/WorkflowEditorPage/WorkflowEditorPage.jsx',
    'src/pages/ReportsPage/ReportsPage.jsx',
    'src/components/common/StatusLozenge.css',
    'src/pages/BoardPage/BoardPage.css',
    'src/pages/ListPage/IssueListPage.css',
  ]

  /*
   * Only hexes that were UNIQUELY status colours are listed.
   *
   * The other four palette entries — #4c9aff, #c1c7d0, #eae6ff, #ff8b00 — are
   * ordinary UI colours used legitimately all over the app (#4c9aff alone is
   * the focus ring, 65 occurrences). Guarding those would be a guard that
   * cries wolf, and a guard nobody trusts gets deleted.
   */
  const RETIRED = [
    '#7fb239', // the gadget palette's "In Progress" GREEN
    '#a95be7', // the gadget palette's "To Do" PURPLE
  ]

  /* Comments are stripped first: several of the files above now EXPLAIN the old
   * value in a comment ("In Progress was GREEN (#7fb239) here"), and a guard
   * that fails on its own rationale is worse than no guard. */
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  for (const file of GUARDED) {
    it(`${file} carries no retired palette literal`, () => {
      const src = stripComments(read(file)).toLowerCase()
      for (const hex of RETIRED) {
        expect(src, `${file} still contains ${hex}`).not.toContain(hex)
      }
    })
  }

  it('the gadget palette no longer maps status names to hexes', () => {
    const src = read('src/components/dashboard/gadgets/gadgetChartUtils.js')
    expect(src).not.toMatch(/'In Progress':\s*'#/)
    expect(src).not.toMatch(/'Done':\s*'#/)
    // and Low priority is not a hex either
    expect(src).not.toMatch(/'Low':\s*'#/)
  })

  it('the workflow editor derives node fill from the category, not node.color', () => {
    const src = read('src/pages/WorkflowEditorPage/WorkflowEditorPage.jsx')
    // The exact line that let a per-status hex override the category.
    expect(src).not.toContain('node.color || style.bg')
    expect(src).toContain('const fill = style.bg')
  })

  it('shared.css no longer paints Low priority with the success green', () => {
    const src = read('src/styles/shared.css')
    expect(src).not.toMatch(/\.priority-low\s*\{\s*background:\s*var\(--jira-success\)/)
    expect(src).toMatch(/\.priority-low\s*\{\s*background:\s*var\(--priority-low-accent\)/)
  })
})
