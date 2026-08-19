// JL-411 — the seven Portfolio KPI cards must read as one row.
//
// These are source-scanning tests, deliberately. jsdom performs no layout: it
// reports zero for every box and never applies a stylesheet's grid rules, so a
// rendering test here cannot tell one row from four. The wrap was found and the
// fix confirmed by measuring card offsets in headless Chromium; what a unit test
// can usefully do is pin the CSS decisions that produce that layout, so an edit
// to the grid declaration cannot silently reintroduce the wrap.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CSS = fs.readFileSync(path.join(SRC, 'pages/PortfolioPage/PortfolioPage.css'), 'utf8')
const JSX = fs.readFileSync(path.join(SRC, 'pages/PortfolioPage/PortfolioPage.jsx'), 'utf8')

// Declarations only. The comments in that file name the rejected properties in
// order to explain why they were rejected, so a "must not contain" assertion run
// over the raw text fails on the explanation rather than on any real rule.
const DECLS = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the first `@media (<query>)` block whose query matches. */
function mediaBlock(queryFragment) {
  const re = new RegExp(`@media\\s*\\([^)]*${queryFragment}[^)]*\\)\\s*\\{`, 'g')
  const m = re.exec(CSS)
  if (!m) return null
  // Walk braces from the opening one to find the block's extent.
  let depth = 0
  let i = m.index + m[0].length - 1
  const start = i
  for (; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++
    else if (CSS[i] === '}') { depth--; if (depth === 0) break }
  }
  // Comments stripped here too, so a commented-out example inside a block can
  // neither satisfy nor break an assertion about that block's declarations.
  return CSS.slice(start + 1, i).replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('JL-411 — the KPI strip is one row on desktop', () => {
  const desktop = mediaBlock('min-width:\\s*861px')

  it('lays the cards out in a single row with auto columns', () => {
    expect(desktop, 'a min-width: 861px block should exist').toBeTruthy()
    expect(desktop).toMatch(/grid-auto-flow:\s*column/)
    expect(desktop).toMatch(/grid-auto-columns:\s*minmax\(/)
  })

  it('does not reintroduce a fixed or auto-fill column template', () => {
    // `repeat(auto-fill, minmax(140px, 1fr))` is exactly what orphaned the
    // seventh card at 1280px: the 140px floor overstated the 131px a card needs,
    // so auto-fill computed six columns where seven fitted. A hardcoded
    // `repeat(7, ...)` would work today and break the moment an eighth KPI is
    // added, which is why the count comes from the markup instead.
    expect(desktop).not.toMatch(/auto-fill|auto-fit/)
    expect(desktop).not.toMatch(/grid-template-columns:\s*repeat\(\s*\d/)
  })

  it('clears the inherited template so the auto flow governs placement', () => {
    // An explicit template would place items into those tracks and wrap, making
    // grid-auto-flow inert.
    expect(desktop).toMatch(/grid-template-columns:\s*none/)
  })

  it('keeps overflow at the strip, never the page', () => {
    // Below a 989px grid the floor holds and the strip scrolls sideways rather
    // than crushing a card. Same contract as JL-399/JL-401: components scroll,
    // the page does not.
    expect(desktop).toMatch(/overflow-x:\s*auto/)
  })
})

describe('JL-411 — labels stay whole', () => {
  it('never breaks a label mid-word', () => {
    // `overflow-wrap: break-word` passed every measurement — one row, nothing
    // clipped — while rendering "PROJEC/TS", "OVERD/UE" and "COMPL/ETION".
    expect(DECLS).not.toMatch(/overflow-wrap:\s*break-word/)
    expect(DECLS).not.toMatch(/word-break:\s*break-all/)
    expect(DECLS).toMatch(/overflow-wrap:\s*normal/)
  })

  it('gives each card a floor wide enough for the longest unbreakable word', () => {
    // "THROUGHPUT" renders at 99px uppercase; with 32px of card padding a card
    // cannot go below 131px without breaking that word.
    const floor = DECLS.match(/--stat-min-width:\s*(\d+)px/)
    expect(floor, 'the auto-column floor should be declared as a token').toBeTruthy()
    expect(Number(floor[1])).toBeGreaterThanOrEqual(131)
    // Declared, not just referenced with a fallback: TypographyTokens.JL394
    // requires every var() used under src/pages to resolve to a real
    // declaration, and a bare fallback silently satisfies nothing.
    expect(DECLS).toMatch(/grid-auto-columns:\s*minmax\(var\(--stat-min-width\)/)
  })

  it('lets cards shrink to their share of the row', () => {
    // Grid items will not go below their content width without this, which turns
    // a narrow row into an overflow instead of narrower cards.
    expect(DECLS).toMatch(/min-width:\s*0/)
  })
})

describe('JL-411 — the strip still wraps where one row would be unusable', () => {
  it('wraps below the desktop range instead of staying in one row', () => {
    const small = mediaBlock('max-width:\\s*860px')
    expect(small, 'a max-width: 860px block should exist').toBeTruthy()
    expect(small).toMatch(/grid-auto-flow:\s*row/)
    expect(small).toMatch(/grid-template-columns:\s*repeat\(2/)
  })

  it('goes to a single column on a phone', () => {
    const phone = mediaBlock('max-width:\\s*480px')
    expect(phone).toBeTruthy()
    expect(phone).toMatch(/grid-template-columns:\s*1fr/)
  })

  it('spells the breakpoints out per-page rather than relying on the shared ones', () => {
    // layout.css has responsive `.stats-grid` overrides, but they are inert:
    // App.jsx imports layout.css *before* shared.css and both rules are
    // specificity (0,1,0), so shared.css's unconditional
    // `repeat(4, minmax(0, 1fr))` wins at every width. That is an app-wide fault
    // with its own ticket; this page must not depend on those rules working.
    const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
    expect(app.indexOf('styles/layout.css')).toBeLessThan(app.indexOf('styles/shared.css'))
  })
})

describe('JL-411 — unchanged behaviour', () => {
  it('still renders exactly the seven KPI cards, in order', () => {
    const labels = [...JSX.matchAll(/<StatCard\s+label="([^"]+)"/g)].map((m) => m[1])
    expect(labels).toEqual([
      'Projects', 'Total issues', 'Open', 'Done', 'Overdue', 'Completion', 'Throughput (30d)',
    ])
  })

  it('leaves the per-project table alone', () => {
    // Throughput is portfolio-wide only — server/routes/portfolio.js computes a
    // single `throughput30d` and the per-project rows carry no such field — so
    // the table keeps its six columns.
    const head = JSX.slice(JSX.indexOf('<TableHead>'), JSX.indexOf('</TableHead>'))
    const cells = [...head.matchAll(/<TableCell[^>]*>([A-Za-z ]+)</g)].map((m) => m[1].trim())
    expect(cells).toEqual(['Project', 'Total', 'Open', 'Done', 'Overdue', 'Completion'])
  })
})
