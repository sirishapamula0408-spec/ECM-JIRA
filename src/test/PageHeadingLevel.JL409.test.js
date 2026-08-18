// @vitest-environment node
//
// JL-409 — every page title is a level-1 heading.
//
// Measured before this change: Dashboard/Filters/Portfolio used h1 (24px/500),
// Workflow Editor an h2 (20px/600), Activity and Audit Log a MUI h5 (21px/700)
// and Report Builder a MUI h4 (29.75px/600). Four sizes, three weights and four
// levels for the same semantic thing — and Activity, Audit Log and Report
// Builder had no h1 at all, so a screen reader got an outline starting
// mid-hierarchy.
//
// Source assertions rather than render assertions: several of these pages need
// admin permissions or heavy context to mount, and what matters here is the
// element each one declares. The computed sizes were verified in a browser (see
// the PR) because jsdom applies no stylesheets.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8')

const PAGES = [
  ['TeamsPage/TeamsPage.jsx', 'Teams'],
  ['UserManagementPage/UserManagementPage.jsx', 'User Management'],
  ['WorkflowEditorPage/WorkflowEditorPage.jsx', 'Workflow Editor'],
  ['ActivityFeedPage/ActivityFeedPage.jsx', 'Activity Feed'],
  ['AuditLogPage/AuditLogPage.jsx', 'Audit Log'],
  ['FiltersPage/FiltersPage.jsx', null],
  ['DashboardPage/DashboardPage.jsx', null],
  ['PortfolioPage/PortfolioPage.jsx', 'Portfolio'],
  ['ReportBuilderPage/ReportBuilderPage.jsx', 'Report Builder'],
  // JL-410: these two had NO heading element at all — the more severe form of
  // the same defect, on the app's two densest surfaces.
  ['ListPage/IssueListPage.jsx', 'List'],
  ['BacklogPage/BacklogPage.jsx', 'Backlog'],
]

describe('JL-409 — every page declares an h1 title', () => {
  for (const [rel, title] of PAGES) {
    it(`${rel.split('/')[0]} renders an <h1>`, () => {
      const src = read(`pages/${rel}`)
      expect(src, `${rel} should contain an <h1>`).toMatch(/<h1[\s>]/)
      if (title) expect(src).toContain(`<h1>${title}</h1>`)
    })
  }

  it('no page title is left as a MUI heading variant', () => {
    // A `variant="h4"`/`"h5"` page title bypasses the shared `.page h1` rule and
    // takes MUI's size instead, which is how four different sizes arose.
    const offenders = []
    for (const [rel] of PAGES) {
      const src = read(`pages/${rel}`)
      // Only flag variants that are NOT explicitly re-tagged as an h1.
      for (const m of src.matchAll(/<Typography[^>]*variant="h[1-5]"[^>]*>/g)) {
        if (!/component="h1"/.test(m[0])) offenders.push(`${rel}: ${m[0].slice(0, 70)}`)
      }
    }
    expect(offenders, `page-title Typography variants remain:\n${offenders.join('\n')}`)
      .toEqual([])
  })
})

describe('JL-409 — the shared rule is the single source of the treatment', () => {
  it('.page h1 still defines size, line-height and weight from tokens', () => {
    const layout = read('styles/layout.css')
    const block = layout.match(/(^|\})\s*\.page h1\s*\{([^}]*)\}/m)
    expect(block, '.page h1 rule not found').not.toBeNull()
    expect(block[2]).toMatch(/font-size:\s*var\(--font-size-xl\)/)
    expect(block[2]).toMatch(/line-height:\s*var\(--line-height-xl\)/)
    expect(block[2]).toMatch(/font-weight:\s*var\(--font-weight-medium\)/)
  })

  it('the one page outside .page matches that rule explicitly', () => {
    // WorkflowEditorPage roots on .workflow-editor-page, so `.page h1` cannot
    // reach it; its own rule has to carry the same token values.
    const css = read('pages/WorkflowEditorPage/WorkflowEditorPage.css')
    const block = css.match(/\.wfe-header h1\s*\{([^}]*)\}/)
    expect(block, '.wfe-header h1 rule not found').not.toBeNull()
    expect(block[1]).toMatch(/font-size:\s*var\(--font-size-xl\)/)
    expect(block[1]).toMatch(/font-weight:\s*var\(--font-weight-medium\)/)
    // And the old h2 rule is gone, not merely superseded.
    expect(css).not.toMatch(/\.wfe-header h2\s*\{/)
  })
})
