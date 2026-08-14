// @vitest-environment node
//
// JL-401 — the viewport-locked shell applies to every page, with the content
// region as the default scroll region.
//
// CSS-source assertions, for the same reason as the JL-399 suite: jsdom does no
// layout, so it cannot tell a page that scrolls from one that silently clips its
// content. The behaviour was swept across all 34 authenticated routes in a real
// browser (measurements in the PR); these guard the rules that produce it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const layoutCss = fs
  .readFileSync(path.join(here, '..', 'styles', 'layout.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Declaration block of the first rule whose selector contains `needle`. */
function ruleWith(needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = layoutCss.match(new RegExp(`[^{}]*${escaped}[^{}]*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

/** Rough specificity (ids, classes, elements) for a compound selector. */
function specificity(selector) {
  // :where() contributes nothing; :not()/:is() contribute their argument's.
  const withoutWhere = selector.replace(/:where\([^)]*\)/g, '')
  const ids = (withoutWhere.match(/#[\w-]+/g) || []).length
  // \b before the lookahead stops `:not(` from backtracking into a `:no` match,
  // which silently counted functional pseudo-classes as plain ones and made the
  // two selectors tie.
  const classes = (withoutWhere.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+\b(?!\()/g) || []).length
  const elements = (withoutWhere.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length
  return [ids, classes, elements]
}

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

describe('JL-401 — every page gets a scroll region', () => {
  it('makes each content child a scroller by default', () => {
    // This is the rule that makes locking the shell safe at all: without it,
    // any page lacking a bespoke inner scroller has its overflow clipped and
    // its content becomes unreachable.
    const block = ruleWith('.content > *:not(')
    expect(block, 'no default scroll-region rule').not.toBeNull()
    expect(block).toMatch(/overflow-y:\s*auto/)
    expect(block).toMatch(/min-height:\s*0/)
    expect(block).toMatch(/flex:\s*1 1 auto/)
  })

  it('targets content children structurally, not the .page class', () => {
    // Three pages inside the shell root on their own class instead of .page —
    // RoadmapPage, WorkflowEditorPage and AssetsPage — and a .page-only rule
    // would clip exactly those.
    const selector = layoutCss.match(/(\.content > \*[^{]*)\{/)?.[1] ?? ''
    expect(selector).toContain('.content >')
    expect(selector).toContain('*')
  })

  it('excludes the chrome from becoming a scroll region', () => {
    const chrome = ruleWith('.content > .topbar')
    expect(chrome).not.toBeNull()
    expect(chrome).toMatch(/flex:\s*0 0 auto/)
    const selector = layoutCss.match(/(\.content > \*[^{]*)\{/)?.[1] ?? ''
    for (const c of ['topbar', 'project-top-panel-wrapper', 'banner']) {
      expect(selector, `${c} must be excluded`).toContain(c)
    }
  })
})

describe('JL-401 — the opt-out still wins', () => {
  it('keeps .page-viewport non-scrolling so it can delegate', () => {
    const block = ruleWith('.content > .page-viewport')
    expect(block).not.toBeNull()
    expect(block).toMatch(/overflow:\s*hidden/)
  })

  it('gives the default rule LOWER specificity than the opt-out', () => {
    // The bug this guards actually happened. Written as a chain of :not()s the
    // default rule scores (0,4,0) and beats `.content > .page-viewport` at
    // (0,2,0), so List and Board silently got overflow-y:auto — a second
    // scrollbar on top of their own inner scroller. :where() contributes zero
    // specificity, which is why the negations must stay inside it.
    const defaultSel = layoutCss.match(/(\.content > \*[^{]*)\{/)?.[1]?.trim() ?? ''
    const optOutSel = '.content > .page-viewport'
    expect(defaultSel).toContain(':where(')
    expect(defaultSel).not.toMatch(/:not\(\s*\./) // no bare :not(.class) chain
    expect(
      cmp(specificity(defaultSel), specificity(optOutSel)),
      `default "${defaultSel}" must not outrank the opt-out`,
    ).toBeLessThan(0)
  })

  it('declares the opt-out after the default rule', () => {
    // Belt and braces: equal specificity would make source order decide.
    expect(layoutCss.indexOf('.content > .page-viewport'))
      .toBeGreaterThan(layoutCss.indexOf('.content > *:not('))
  })
})

describe('JL-401 — scope', () => {
  it('applies only above the narrow-width breakpoint', () => {
    const block = layoutCss.match(/@media \(min-width: 861px\)\s*\{([\s\S]*?)\n\}/)
    expect(block, 'locked rules are not inside the 861px media query').not.toBeNull()
    expect(block[1]).toContain('.workspace')
    expect(block[1]).toContain('.content >')
  })

  it('leaves the unlocked base rules alone for narrow widths', () => {
    // Below the breakpoint the page scrolls normally, so the base .workspace
    // must keep its min-height and gain no overflow.
    const base = layoutCss.match(/(^|\})\s*\.workspace\s*\{([^}]*)\}/m)
    expect(base).not.toBeNull()
    expect(base[2]).toMatch(/min-height:\s*100vh/)
    expect(base[2]).not.toMatch(/overflow/)
  })
})
