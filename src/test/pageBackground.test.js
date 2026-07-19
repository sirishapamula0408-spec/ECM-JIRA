// @vitest-environment node
//
// JL-231: The global page background should be pure white (#ffffff) in light
// mode, not the previous smoke-white (#f1f5f9). This asserts the CSS source of
// truth directly — jsdom doesn't apply external stylesheets, so we verify the
// declared value in src/index.css (light mode) and that the dark-mode override
// in src/styles/theme.css is left intact.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(resolve(here, rel), 'utf8')

describe('JL-231 page background', () => {
  const indexCss = read('../index.css')

  it('sets the light-mode body background to pure white (#ffffff)', () => {
    // Grab the top-level `body { ... }` block (before any dark-theme rules).
    const bodyBlock = indexCss.match(/\bbody\s*\{[^}]*\}/)?.[0] ?? ''
    expect(bodyBlock).toMatch(/background:\s*#ffffff\b/i)
  })

  it('no longer declares the smoke-white #f1f5f9 as a background value', () => {
    // A historical reference to the old colour in a comment is fine; what must
    // be gone is any active `background: #f1f5f9` declaration.
    expect(indexCss).not.toMatch(/background:\s*#f1f5f9/i)
  })

  it('keeps the dark-mode body background override (#1d2125) intact', () => {
    const themeCss = read('../styles/theme.css')
    expect(themeCss).toMatch(/\.app-theme-dark\s+body/)
    expect(themeCss).toMatch(/#1d2125/i)
  })
})
