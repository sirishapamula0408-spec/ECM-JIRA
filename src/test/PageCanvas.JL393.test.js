// @vitest-environment node
//
// JL-393 — one page canvas.
//
// The page background used to be declared four different ways: the global
// `.page` rule painted it white (var(--jira-surface)) and eight pages then
// re-declared their own value (#f4f5f7, #f7f8fa, #ffffff, var(--jira-bg)).
// Consolidating them onto one token is what this ticket is for.
//
// JL-393 originally consolidated onto a GREY canvas, on the reading that
// Atlassian puts white cards on a grey page. That is inverted. Atlassian's
// elevation foundation makes elevation.surface — white — "the starting point
// for body content and page backgrounds", and reserves the grey for
// elevation.surface.sunken, "a backdrop (or well) where other content sits",
// its documented example being Kanban board columns. Cards are
// elevation.surface.raised: white, separated by shadow.
//
// A grey canvas therefore put the page and the board columns (#f1f2f4) within
// ~1% of each other and flattened the content area into a single grey field.
// The token is now white and the assertions below check the RELATIONSHIP —
// canvas lighter than its wells — rather than pinning a hex.
//
// These assertions read the CSS sources directly — jsdom does not apply
// external stylesheets, so the declared value is the only thing to check.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, relative } from 'node:path'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(here, '..')
const read = (rel) => readFileSync(resolve(srcRoot, rel), 'utf8')

const CANVAS_TOKEN = '--jira-canvas'

/** Strip /* ... *\/ comments so a documented old value never trips an assertion. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Pull the declaration block for a selector that appears at the start of a line
 * (i.e. a top-level rule, not one nested inside a media query at indentation).
 */
function ruleBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm')
  return stripComments(css).match(re)?.[1] ?? null
}

/** A background value that is a hard-coded colour rather than a token. */
const COLOUR_LITERAL =
  /background(?:-color)?\s*:\s*(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|white|whitesmoke|ghostwhite|snow|ivory|gainsboro|lightgr[ae]y|silver|black)/i

// The eight pages the audit found overriding the canvas, with the page-level
// selector each one puts on its <section className="page …"> root.
const PAGES = [
  ['BacklogPage/BacklogPage.css', '.backlog-page'],
  ['DashboardPage/DashboardPage.css', '.dashboard-page'],
  ['ListPage/IssueListPage.css', '.jira-list-page'],
  ['IssueDetailPage/IssueDetailPage.css', '.issue-detail-page'],
  ['ProjectDetailPage/ProjectDetailPage.css', '.project-detail-page'],
  ['RoadmapPage/RoadmapPage.css', '.timeline-page'],
  ['WorkflowEditorPage/WorkflowEditorPage.css', '.workflow-editor-page'],
  ['ProjectSummaryPage/ProjectSummaryPage.css', '.ps-page'],
]

describe('JL-393 page canvas', () => {
  const layoutCss = read('styles/layout.css')

  describe('the global .page rule', () => {
    it('paints the canvas token rather than a literal or the surface token', () => {
      const block = ruleBlock(layoutCss, '.page')
      expect(block, '.page rule not found in styles/layout.css').not.toBeNull()
      expect(block).toMatch(
        new RegExp(`background\\s*:\\s*var\\(\\s*${CANVAS_TOKEN}`),
      )
      expect(block).not.toMatch(COLOUR_LITERAL)
      // The old value — white is for cards/panels, not the canvas.
      expect(block).not.toMatch(/background\s*:\s*var\(\s*--jira-surface/)
    })

    it('paints the same canvas behind .content, so full-bleed pages match', () => {
      // RoadmapPage and WorkflowEditorPage render outside `.page`, so `.content`
      // is what sits behind them.
      const block = ruleBlock(layoutCss, '.content')
      expect(block).toMatch(
        new RegExp(`background\\s*:\\s*var\\(\\s*${CANVAS_TOKEN}`),
      )
    })
  })

  describe('the canvas token', () => {
    it('is defined once as the white baseline surface', () => {
      const defs = [
        ...stripComments(layoutCss).matchAll(
          new RegExp(`${CANVAS_TOKEN}\\s*:\\s*([^;]+);`, 'g'),
        ),
      ].map((m) => m[1].trim())
      // One light definition + one dark counterpart.
      expect(defs.length).toBe(2)

      // Atlassian's elevation.surface — "the starting point for body content and
      // page backgrounds". This assertion was inverted until the JL-393 follow-up:
      // it required a grey canvas, which is what flattened the board (see below).
      const light = defs[0].toLowerCase()
      expect(light).toMatch(/^#(ffffff|fff)$/)
    })

    it('is lighter than the wells that sit on it, so wells read as sunken', () => {
      // The actual design rule, and the one worth guarding: canvas is
      // elevation.surface, a board column is elevation.surface.sunken, so the
      // column must be measurably darker than the page behind it. Pinning a hex
      // is what let the canvas drift to within ~1% of the column and flatten the
      // whole content area into a single grey field.
      const light = stripComments(layoutCss)
        .match(new RegExp(`${CANVAS_TOKEN}\\s*:\\s*([^;]+);`))[1]
        .trim()
        .toLowerCase()
      // BoardPage.css declares .kanban-col twice (layout first, then painting),
      // so take whichever block actually carries the background rather than the
      // first one ruleBlock() would find.
      const boardCss = stripComments(read('pages/BoardPage/BoardPage.css'))
      const well = [...boardCss.matchAll(/^\.kanban-col\s*\{([^}]*)\}/gm)]
        .map((m) => m[1].match(/background:\s*(#[0-9a-f]{6})/i)?.[1])
        .find(Boolean)
        ?.toLowerCase()
      expect(well, '.kanban-col should paint its own sunken background').toBeTruthy()

      const luminance = (hex) =>
        [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0) / 3
      const canvasHex = light === '#fff' ? '#ffffff' : light

      // The well is grey, not tinted.
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(well.slice(i, i + 2), 16))
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(8)
      // …and sits below the canvas by enough to actually be visible as a well.
      expect(luminance(canvasHex) - luminance(well)).toBeGreaterThanOrEqual(4)
    })

    it('has a dark-theme counterpart under .app-theme-dark', () => {
      const darkBlock = ruleBlock(layoutCss, '.app-theme-dark')
      expect(
        darkBlock,
        '.app-theme-dark block not found in styles/layout.css',
      ).not.toBeNull()
      const dark = darkBlock
        .match(new RegExp(`${CANVAS_TOKEN}\\s*:\\s*([^;]+);`))?.[1]
        ?.trim()
        .toLowerCase()
      expect(dark).toBeTruthy()
      expect(dark).toMatch(/^#[0-9a-f]{6}$/)
      // A dark canvas: every channel well below mid grey.
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16))
      expect(Math.max(r, g, b)).toBeLessThan(0x50)
    })

    it('agrees with the dark app canvas theme.css already paints on .page', () => {
      // theme.css belongs to JL-392; JL-393 only mirrors its value so the token
      // is theme-correct for anything that reads it.
      const themeCss = read('styles/theme.css')
      const dark = ruleBlock(layoutCss, '.app-theme-dark')
        .match(new RegExp(`${CANVAS_TOKEN}\\s*:\\s*([^;]+);`))[1]
        .trim()
        .toLowerCase()
      expect(themeCss).toMatch(/\.app-theme-dark\s+\.page/)
      expect(themeCss.toLowerCase()).toContain(dark)
    })
  })

  describe('the eight audited pages', () => {
    it.each(PAGES)('%s no longer sets a background on %s', (file, selector) => {
      // The rule may have been deleted outright (DashboardPage's only
      // declaration *was* the background) — that inherits the canvas too.
      const block = ruleBlock(read(join('pages', file)), selector)
      if (block === null) return
      expect(block).not.toMatch(/background(?:-color)?\s*:/)
    })

    it('drops every one of the four old canvas values from page-level rules', () => {
      for (const [file, selector] of PAGES) {
        const block = ruleBlock(read(join('pages', file)), selector) ?? ''
        // Only `background` declarations — a local custom property such as
        // --list-surface: #ffffff is a card colour and stays.
        const backgrounds = [
          ...block.matchAll(/background(?:-color)?\s*:\s*([^;]+)/gi),
        ].map((m) => m[1].trim().toLowerCase())
        expect(backgrounds, `${file} ${selector}`).toEqual([])
      }
    })
  })

  describe('guard: no page CSS may reintroduce a page-level background', () => {
    // Walk every page stylesheet and flag a colour literal on any top-level
    // selector that looks like a page root — `.page`, `.foo-page`, `.page-foo`.
    // Nested/child selectors (`.foo-page .bar`) are cards and panels: allowed.
    const cssFiles = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (entry.endsWith('.css')) cssFiles.push(full)
      }
    }
    walk(resolve(srcRoot, 'pages'))

    it('finds page stylesheets to scan', () => {
      expect(cssFiles.length).toBeGreaterThan(20)
    })

    it('finds no page-level background literal in src/pages/**/*.css', () => {
      const offenders = []
      // A top-level rule: selector at column 0, single simple selector chain
      // ending in a page-ish class, then a block.
      const RULE = /^([.#][\w-]+(?:[.:][\w-]+)*)\s*\{([^}]*)\}/gm

      for (const file of cssFiles) {
        const css = stripComments(readFileSync(file, 'utf8'))
        for (const [, selector, body] of css.matchAll(RULE)) {
          const isPageish = /(^\.page$|-page(?:$|[.:])|^\.page-)/.test(selector)
          if (!isPageish) continue
          const hit = body.match(COLOUR_LITERAL)
          if (hit) {
            offenders.push(
              `${relative(srcRoot, file)}: ${selector} { ${hit[0].trim()} }`,
            )
          }
        }
      }

      expect(
        offenders,
        `page-level background literal(s) found — pages must inherit ` +
          `var(${CANVAS_TOKEN}) from the global .page rule:\n  ${offenders.join('\n  ')}`,
      ).toEqual([])
    })
  })
})
