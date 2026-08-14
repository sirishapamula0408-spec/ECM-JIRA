// @vitest-environment node
//
// JL-399 — the List and Board pages are locked to the viewport and scroll their
// own inner region instead of the document.
//
// These are CSS-source assertions on purpose. jsdom does no layout: it cannot
// report scrollHeight, so it cannot tell a page that scrolls from one that does
// not. The behaviour was proved in a real browser (Playwright, measurements in
// the PR); what these guard is the height chain that produces it, every link of
// which is load-bearing — drop any one and the page silently goes back to
// growing the document.
//
// The JL-398 follow-up is why this file exists in this shape: 20 passing jsdom
// tests there certified a menu that was invisible on screen.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(here, '..')
const read = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8')

const layoutCss = read('styles/layout.css')
const listCss = read('pages/ListPage/IssueListPage.css')
const boardCss = read('pages/BoardPage/BoardPage.css')
const listJsx = read('pages/ListPage/IssueListPage.jsx')
const boardJsx = read('pages/BoardPage/BoardPage.jsx')

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Declaration block for the first rule whose selector contains `needle`. */
function ruleWith(css, needle) {
  const source = strip(css)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = source.match(new RegExp(`[^{}]*${escaped}[^{}]*\\{([^}]*)\\}`))
  return m ? m[1] : null
}

/**
 * Declaration block for a rule whose selector is EXACTLY `selector`.
 * ruleWith() matches on containment, so asking it for `.page-viewport` hands
 * back `.workspace:has(.page-viewport)` — the first rule that merely mentions
 * it. Anchoring on the preceding `{`/`}`/newline and requiring the selector to
 * run straight into the brace avoids that.
 */
function exactRule(css, selector) {
  const source = strip(css)
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = source.match(new RegExp(`(^|[{}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  return m ? m[2] : null
}

describe('JL-399 — both pages opt in to the locked layout', () => {
  it('the List page root carries the marker class', () => {
    expect(listJsx).toMatch(/className="page jira-list-page page-viewport"/)
  })

  it('the Board page root carries the marker class', () => {
    expect(boardJsx).toMatch(/className="page page-viewport"/)
  })

  it('the Board wraps its swimlanes in a scroll region', () => {
    expect(boardJsx).toMatch(/className="board-scroll-region"/)
  })
})

describe('JL-399 — the height chain from the viewport down', () => {
  const locked = strip(layoutCss)

  it('bounds the workspace to the viewport', () => {
    // JL-399 gated this on :has(.page-viewport); JL-401 made it unconditional —
    // see the superseded assertion below for why that became safe.
    // Scoped to the media-query block: an unqualified `.workspace` lookup finds
    // the unlocked base rule declared above it.
    const media = locked.match(/@media \(min-width: 861px\)\s*\{([\s\S]*?)\n\}/)[1]
    const block = exactRule(media, '.workspace')
    expect(block, 'no locked workspace rule inside the breakpoint').not.toBeNull()
    expect(block).toMatch(/height:\s*100dvh/)
    expect(block).toMatch(/overflow:\s*hidden/)
  })

  it('locks the shell only because every page now has a scroll region (JL-401)', () => {
    // SUPERSEDED, deliberately. JL-399 asserted the opposite — that .workspace is
    // never locked unconditionally — because locking a page with no inner
    // scroller does not make it scroll inside, it clips the content and strands
    // it. JL-401 removed the hazard rather than the rule: every child of the
    // content region is now a scroll region by default, so the fallback is
    // "this scrolls" instead of "this is hidden", and the gate was no longer
    // buying anything. The guarantee that replaces it is the one below.
    const region = ruleWith(locked, '.content > *:not(')
    expect(region, 'no default scroll-region rule — content could be stranded')
      .not.toBeNull()
    expect(region).toMatch(/overflow-y:\s*auto/)
    expect(region).toMatch(/min-height:\s*0/)
  })

  it('lets the content column shrink below its content', () => {
    // min-height:0 is the link people forget: grid and flex items default to
    // min-height:auto and refuse to shrink, which defeats every bound below.
    const block = ruleWith(locked, '.workspace > .content')
    expect(block).not.toBeNull()
    expect(block).toMatch(/min-height:\s*0/)
    expect(block).toMatch(/flex-direction:\s*column/)
  })

  it('keeps a tall sidebar reachable now that the shell cannot scroll', () => {
    const block = ruleWith(locked, '.workspace > .sidebar')
    expect(block).not.toBeNull()
    expect(block).toMatch(/overflow-y:\s*auto/)
  })

  it('makes the opted-out pages flex columns that delegate scrolling', () => {
    const block = ruleWith(locked, '.content > .page-viewport')
    expect(block, 'no .page-viewport opt-out rule').not.toBeNull()
    expect(block).toMatch(/overflow:\s*hidden/)
    expect(block).toMatch(/flex-direction:\s*column/)
  })

  it('applies the lock only above the narrow-width breakpoint', () => {
    // Below it the topbar reflows and the bottom nav appears; a locked shell
    // around a nested scroller is the wrong pattern there, and vh is unreliable.
    expect(locked).toMatch(/@media \(min-width: 861px\)[\s\S]*\.page-viewport/)
  })
})

describe('JL-399 — the List table is the scroller', () => {
  it('gives the scroll wrapper both axes and room to shrink', () => {
    const block = ruleWith(listCss, '.page-viewport .jira-list-table-scroll')
    expect(block, 'no locked-layout rule for the scroll wrapper').not.toBeNull()
    expect(block).toMatch(/overflow:\s*auto/)
    expect(block).toMatch(/min-height:\s*0/)
    expect(block).toMatch(/flex:\s*1 1 auto/)
  })

  it('keeps the header row visible while rows scroll', () => {
    const block = ruleWith(listCss, '.page-viewport .jira-list-table thead th')
    expect(block).not.toBeNull()
    expect(block).toMatch(/position:\s*sticky/)
    expect(block).toMatch(/top:\s*0/)
    // Opaque, or rows would show through the header as they pass under it.
    expect(block).toMatch(/background:/)
  })

  it('keeps the sticky header below the JL-398 sort menu', () => {
    // The menu is z-index 20 inside a th that opts out of overflow; a header
    // stacked above it would hide the menu it is supposed to reveal.
    const th = ruleWith(listCss, '.page-viewport .jira-list-table thead th')
    const z = Number(th.match(/z-index:\s*(\d+)/)?.[1])
    const menu = exactRule(listCss, '.jira-list-col-menu')
    const menuZ = Number(menu.match(/z-index:\s*(\d+)/)?.[1])
    expect(Number.isFinite(z) && Number.isFinite(menuZ)).toBe(true)
    expect(z).toBeLessThan(menuZ)
  })

  it('anchors the toolbar and footer so they do not scroll away', () => {
    const block = ruleWith(listCss, '.page-viewport .jira-list-toolbar')
    expect(block).not.toBeNull()
    expect(block).toMatch(/flex:\s*0 0 auto/)
    for (const cls of ['jira-list-pagination', 'jira-list-bulk-bar', 'jira-list-create']) {
      expect(strip(listCss), cls).toMatch(new RegExp(`\\.page-viewport \\.${cls}`))
    }
  })
})

describe('JL-399 — the Board area is the scroller', () => {
  it('scrolls the region vertically and leaves the horizontal axis to the grid', () => {
    // Both axes on one element would give the board nested horizontal
    // scrollbars; .kanban-grid has owned overflow-x since JL-320.
    const block = ruleWith(boardCss, '.page-viewport .board-scroll-region')
    expect(block, 'no scroll-region rule').not.toBeNull()
    expect(block).toMatch(/overflow-y:\s*auto/)
    expect(block).toMatch(/overflow-x:\s*hidden/)
    expect(block).toMatch(/min-height:\s*0/)

    const grid = boardCss.match(/(^|\})\s*\.kanban-grid\s*\{([^}]*)\}/m)
    expect(grid[2]).toMatch(/overflow-x:\s*auto/)
  })

  it('fills the height only when there is a single lane', () => {
    // With swimlanes on, each lane keeps its own smaller bound and the region
    // scrolls through them; :only-child tells the two cases apart.
    expect(strip(boardCss)).toMatch(/\.board-swimlane:only-child/)
    const cards = ruleWith(boardCss, ':only-child .kanban-col-cards')
    expect(cards, 'no locked-layout rule for the card list').not.toBeNull()
    expect(cards).toMatch(/flex:\s*1 1 auto/)
    expect(cards).toMatch(/max-height:\s*none/)
  })

  it('leaves JL-391 base contract intact for the un-locked case', () => {
    // JL-391's own suite asserts this rule has a vh max-height, overflow-y:auto
    // and no height/min-height. It still governs narrow widths, so it is not
    // dead code — and the locked layout refines it from a separate rule rather
    // than editing it.
    const base = boardCss.replace(/\/\*[\s\S]*?\*\//g, '')
      .match(/(^|\})\s*\.kanban-col-cards\s*\{([^}]*)\}/m)
    expect(base, '.kanban-col-cards base rule not found').not.toBeNull()
    expect(base[2]).toMatch(/max-height:[^;]*vh/)
    expect(base[2]).toMatch(/overflow-y:\s*auto/)
    expect(base[2]).not.toMatch(/(^|[\s;])height:/)
    expect(base[2]).not.toMatch(/min-height:/)
  })

  it('keeps the column header outside the scrolling card list', () => {
    const header = ruleWith(boardCss, ':only-child .kanban-col header')
    expect(header).not.toBeNull()
    expect(header).toMatch(/flex:\s*0 0 auto/)
  })
})
