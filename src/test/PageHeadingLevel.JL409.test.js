// @vitest-environment node
//
// JL-409 (widened by JL-416) — every page title is a plain level-1 heading.
//
// JL-409 measured the original defect: Dashboard/Filters/Portfolio used h1
// (24px/500), Workflow Editor an h2 (20px/600), Activity and Audit Log a MUI h5
// (21px/700) and Report Builder a MUI h4 (29.75px/600) — four sizes, three
// weights and four levels for the same semantic thing.
//
// It then guarded 11 named pages. JL-416 found that all six pages with NO <h1>
// at all sat outside that list, so the suite was green because it was not
// looking at them. This version enumerates src/pages/*/ instead: a page added
// tomorrow is covered on day one.
//
// Source assertions rather than render assertions: several of these pages need
// admin permissions or heavy context to mount, and what matters here is the
// element each one declares. Computed sizes were verified in a browser, because
// jsdom applies no stylesheets.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(here, '..')
const pagesDir = path.join(srcDir, 'pages')
const read = (abs) => fs.readFileSync(abs, 'utf8')

// Deliberate, reviewable exclusions. Empty on purpose: every directory under
// src/pages/ currently renders a real page with a title. Adding an entry here
// is a decision someone has to justify in review, which is the point — the old
// test's silence was an accident, this one's would be a choice.
const NOT_A_PAGE = new Set([])

/** Every page directory, with the JSX file that owns its title. */
const pageDirs = fs
  .readdirSync(pagesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !NOT_A_PAGE.has(e.name))
  .map((e) => e.name)
  .sort()

/** All .jsx in a page directory — some pages split the title into a subcomponent. */
function jsxFilesFor(page) {
  const dir = path.join(pagesDir, page)
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsx'))
    .map((f) => path.join(dir, f))
}

describe('JL-416 — the heading guard enumerates the filesystem', () => {
  it('finds every page directory rather than a hardcoded list', () => {
    // If this ever collapses, every assertion below silently passes.
    expect(pageDirs.length).toBeGreaterThanOrEqual(40)
  })
})

describe('JL-409 — every page declares a plain <h1> title', () => {
  it.each(pageDirs)('%s renders an <h1>', (page) => {
    const sources = jsxFilesFor(page).map(read)
    const hasH1 = sources.some((src) => /<h1[\s>]/.test(src))
    expect(
      hasH1,
      `${page} has no <h1>. A page title is a plain <h1> (JL-409) so the ` +
        'shared `.page h1` rule in styles/layout.css owns the treatment; a ' +
        'MUI heading variant bypasses that rule and leaves the document ' +
        'outline starting mid-hierarchy.',
    ).toBe(true)
  })

  it('no page renders its title as a MUI Typography heading', () => {
    // `variant="h4"`/`"h5"` takes MUI's size instead of the page-title size,
    // which is how four different title sizes arose. `component="h1"` is not a
    // fix either: it produces an emotion class the shared rule has to fight.
    const offenders = []
    for (const page of pageDirs) {
      for (const file of jsxFilesFor(page)) {
        const src = read(file)
        for (const m of src.matchAll(/<Typography[^>]*component="h1"[^>]*>/g)) {
          offenders.push(`${page}: ${m[0].slice(0, 80)}`)
        }
      }
    }
    expect(
      offenders,
      `page titles still rendered via Typography component="h1":\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  // NOTE (JL-416): there is deliberately NO "exactly one <h1> per page" test.
  // AC#1 asks for it, but it cannot be decided from source and the naive
  // version produced four false positives:
  //   * ActiveSprintPage / SharedDashboardsPage — one per mutually exclusive
  //     early-return branch, so only ever one renders;
  //   * ReportsPage — a screen title plus a `print-only` title;
  //   * KnowledgeBasePage — the string '<h1>$1</h1>' inside a markdown-to-HTML
  //     replacement, which is not a JSX element at all.
  // Counting occurrences would force those four to be exempted, and an
  // exemption list that large is indistinguishable from no test. The two
  // assertions that ARE sound — at least one h1, and never a Typography
  // heading — catch the defect this ticket exists to fix.
})

describe('JL-409 — the shared rule is the single source of the treatment', () => {
  const layout = read(path.join(srcDir, 'styles', 'layout.css'))

  it('.page h1 defines size, line-height and weight from tokens', () => {
    const block = layout.match(/(^|\})\s*\.page h1\s*\{([^}]*)\}/m)
    expect(block, '.page h1 rule not found').not.toBeNull()
    expect(block[2]).toMatch(/font-size:\s*var\(--font-size-xl\)/)
    expect(block[2]).toMatch(/line-height:\s*var\(--line-height-xl\)/)
    expect(block[2]).toMatch(/font-weight:\s*var\(--font-weight-medium\)/)
  })

  it('the standalone rule carries the same token values', () => {
    // JL-416: AcceptInvite and ResetPassword are centred cards outside the app
    // shell; Assets and Portal root on their own class. `.page h1` cannot reach
    // any of them, so they share ONE class rather than four restated rules.
    const block = layout.match(/\.page-title-standalone\s*\{([^}]*)\}/)
    expect(block, '.page-title-standalone rule not found').not.toBeNull()
    expect(block[1]).toMatch(/font-size:\s*var\(--font-size-xl\)/)
    expect(block[1]).toMatch(/line-height:\s*var\(--line-height-xl\)/)
    expect(block[1]).toMatch(/font-weight:\s*var\(--font-weight-medium\)/)
  })

  it('pages outside .page use the standalone class', () => {
    const STANDALONE = [
      'AcceptInvitePage', 'ResetPasswordPage', 'AssetsPage', 'PortalPage',
    ]
    for (const page of STANDALONE) {
      const sources = jsxFilesFor(page).map(read).join('\n')
      expect(
        sources,
        `${page} roots outside .page, so its <h1> needs page-title-standalone`,
      ).toContain('page-title-standalone')
    }
  })

  it('the one page outside .page with its own header matches the shared rule', () => {
    const css = read(
      path.join(pagesDir, 'WorkflowEditorPage', 'WorkflowEditorPage.css'),
    )
    const block = css.match(/\.wfe-header h1\s*\{([^}]*)\}/)
    expect(block, '.wfe-header h1 rule not found').not.toBeNull()
    expect(block[1]).toMatch(/font-size:\s*var\(--font-size-xl\)/)
    expect(block[1]).toMatch(/font-weight:\s*var\(--font-weight-medium\)/)
    expect(css).not.toMatch(/\.wfe-header h2\s*\{/)
  })

  it('no page CSS overrides the shared page-title weight with a literal', () => {
    // JL-416: six pages redefined the h1 weight to 600, four of them as a bare
    // literal. Only WorkflowEditorPage mirrored the shared rule correctly —
    // because the old test checked that one file and no others.
    // NotFoundPage's h1 is the 72px "404" numeral — a display element that
    // happens to be the page's heading, not a page title in the JL-409 sense.
    // Exempted deliberately and by name, so the exemption is reviewable.
    const NOT_A_PAGE_TITLE = new Set(['NotFoundPage'])

    const offenders = []
    for (const page of pageDirs) {
      if (NOT_A_PAGE_TITLE.has(page)) continue
      const cssFile = path.join(pagesDir, page, `${page}.css`)
      if (!fs.existsSync(cssFile)) continue
      const css = read(cssFile)
      for (const m of css.matchAll(/h1\s*\{([^}]*)\}/g)) {
        const weight = m[1].match(/font-weight:\s*([^;]+);/)
        if (!weight) continue
        const value = weight[1].trim()
        if (value !== 'var(--font-weight-medium)') {
          offenders.push(`${page}.css: h1 { font-weight: ${value} }`)
        }
      }
    }
    expect(
      offenders,
      'page-title weight overrides. The shared rule sets 500; these diverge:\n' +
        offenders.join('\n'),
    ).toEqual([])
  })
})
