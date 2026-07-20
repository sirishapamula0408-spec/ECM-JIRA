// @vitest-environment node
//
// JL-253: shared.css declares `input { width: 100% }` globally, which stretched
// the Security Policy checkboxes (Require MFA / uppercase / number / symbol) to
// full width and shoved their labels far right. TeamsPage.css now scopes a
// width/flex reset to the security-check checkboxes. jsdom doesn't apply
// external stylesheets, so we assert the CSS source of truth directly.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../pages/TeamsPage/TeamsPage.css'), 'utf8')

describe('JL-253 TeamsPage security checkbox alignment', () => {
  it('scopes a checkbox reset to the security-check rows', () => {
    expect(css).toMatch(
      /\.teams-security-check\s+input\[type='checkbox'\]\s*\{/
    )
  })

  it('resets the stretched width and flex on those checkboxes', () => {
    // Isolate just the .teams-security-check input[type='checkbox'] rule body.
    const match = css.match(
      /\.teams-security-check\s+input\[type='checkbox'\]\s*\{([^}]*)\}/
    )
    expect(match).not.toBeNull()
    const body = match[1]
    expect(body).toMatch(/width:\s*auto/)
    expect(body).toMatch(/flex:\s*none/)
  })
})
