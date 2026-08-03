import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { HeaderPanelIcon, COG_TEETH_PATH } from '../components/icons/HeaderPanelIcon'

/* ================================================================
   JL-322 — "Toggle theme" and "Configure" rendered the same glyph
   (a circle ringed by eight radiating lines). The configure/settings
   affordance must be an Atlassian-style cog instead, and must stay
   visually distinct from the sun used by the theme toggle.
   ================================================================ */

/** Serialise every shape in an icon so two glyphs can be compared. */
function glyphShape(name) {
  const { container } = render(<HeaderPanelIcon name={name} />)
  const svg = container.querySelector('svg')
  return Array.from(svg.children)
    .map((el) => {
      if (el.tagName === 'circle') return `circle:${el.getAttribute('r')}`
      return `path:${el.getAttribute('d')}`
    })
    .join('|')
}

describe('JL-322 — configure vs theme-toggle icons', () => {
  it('renders the settings/cog glyph as a toothed gear, not a spoked circle', () => {
    const cog = glyphShape('settings')
    expect(cog).toContain(COG_TEETH_PATH)
    // A gear has a hollow centre...
    expect(cog).toContain('circle:2.05')
    // ...and none of the eight straight rays the old glyph drew.
    expect(cog).not.toMatch(/M8 2\.5v1\.4/)
  })

  it('exposes the same cog under both "settings" and "cog" names', () => {
    expect(glyphShape('cog')).toBe(glyphShape('settings'))
  })

  it('draws the sun with a plain circle and radiating rays', () => {
    const sun = glyphShape('sun')
    expect(sun).toContain('circle:2.6')
    expect(sun).toContain('path:M8 1.8v1.4')
    expect(sun).not.toContain(COG_TEETH_PATH)
  })

  it('makes the configure icon and both theme-toggle icons mutually distinct', () => {
    const cog = glyphShape('settings')
    const sun = glyphShape('sun')
    const moon = glyphShape('theme')

    expect(new Set([cog, sun, moon]).size).toBe(3)
  })

  it('no longer shares geometry between the cog and the sun', () => {
    // The original bug: both were `<circle r≈2.5/>` plus eight rays, so the
    // rendered markup was effectively identical at 14–16px.
    const cogPaths = glyphShape('settings').split('|').filter((s) => s.startsWith('path:'))
    const sunPaths = glyphShape('sun').split('|').filter((s) => s.startsWith('path:'))
    expect(cogPaths.some((p) => sunPaths.includes(p))).toBe(false)
  })
})
