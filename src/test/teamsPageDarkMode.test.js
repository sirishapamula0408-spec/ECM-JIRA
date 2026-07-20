// @vitest-environment node
//
// JL-249: TeamsPage.css hardcoded light-palette colors (#fafbfc, #deebff,
// #0052cc) which broke in dark mode. This asserts the CSS source of truth
// directly (jsdom doesn't apply external stylesheets): the light hexes are
// replaced by --jira-* tokens, and .app-theme-dark overrides exist for the
// surfaces whose tokens don't switch in dark mode. Comments mentioning old
// hexes are fine — we assert on active `: #xxxxxx` declarations only.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../pages/TeamsPage/TeamsPage.css'), 'utf8')

describe('JL-249 TeamsPage dark mode', () => {
  it.each(['#fafbfc', '#deebff', '#0052cc'])(
    'no longer declares hardcoded light color %s as an active value',
    (hex) => {
      // Match property declarations like `background: #fafbfc` / `color:#0052cc`
      // but not mentions inside comments (which lack the `: #hex` shape).
      expect(css).not.toMatch(new RegExp(`:\\s*${hex}\\b`, 'i'))
    }
  )

  it('uses --jira-* tokens for the former hardcoded colors', () => {
    expect(css).toMatch(/background:\s*var\(--jira-surface-subtle\)/)
    expect(css).toMatch(/background:\s*var\(--jira-blue-soft\)/)
    expect(css).toMatch(/color:\s*var\(--jira-blue\)/)
  })

  it('provides .app-theme-dark overrides for token-based surfaces', () => {
    expect(css).toMatch(/\.app-theme-dark\s+\.teams-search input\s*\{/)
    expect(css).toMatch(/\.app-theme-dark\s+\.teams-table th\s*\{/)
    expect(css).toMatch(/\.app-theme-dark\s+\.teams-member-avatar\s*\{/)
  })
})
