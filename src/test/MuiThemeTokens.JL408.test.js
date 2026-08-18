// @vitest-environment node
//
// JL-408 — the MUI theme must stay on the same scale as variables.css.
//
// Before this theme existed, MUI used its defaults: Roboto (a font this app
// never loads) and a rem-based scale that multiplied against the 14px root, so
// h5 computed to 21px, h4 to 29.75px and body2 to 12.25px — none on the token
// scale. These assertions pin the theme to the tokens so the two cannot drift
// apart again silently.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMuiTheme, SIZE, LEADING } from '../theme/muiTheme.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const variablesCss = fs.readFileSync(
  path.join(here, '..', 'styles', 'variables.css'), 'utf8',
)

/** A `--font-size-x: Npx` / `--line-height-x: Npx` token as a number. */
const token = (name) => {
  // Uses a LITERAL regex. Built from a template string, the `\s` and `\d`
  // escapes collapse to bare "s" and "d", which silently produced the regex
  // --font-size-xss*:s*(d+)px and matched nothing — the assertions then
  // compared a real number against NaN.
  const line = variablesCss
    .split('\n')
    .find((l) => l.trim().startsWith('--' + name + ':'))
  return line ? Number(line.match(/(\d+(?:\.\d+)?)px/)[1]) : NaN
}

describe('JL-408 — the theme mirrors the CSS token scale', () => {
  it('uses every font-size token at the value variables.css declares', () => {
    for (const step of ['xs', 'sm', 'base', 'md', 'lg', 'xl', 'xxl']) {
      expect(SIZE[step], `--font-size-${step}`).toBe(token(`font-size-${step}`))
    }
  })

  it('uses every line-height token at the declared value', () => {
    for (const step of ['xs', 'sm', 'base', 'md', 'lg', 'xl', 'xxl']) {
      expect(LEADING[step], `--line-height-${step}`).toBe(token(`line-height-${step}`))
    }
  })

  it('declares the same font family as the app, not Roboto', () => {
    const theme = buildMuiTheme('light')
    // Roboto may appear later in the stack as a fallback (index.css lists it),
    // but it must not be what MUI asks for FIRST, because it is never loaded.
    expect(theme.typography.fontFamily.split(',')[0].trim()).toBe('-apple-system')
    expect(variablesCss).toContain('-apple-system')
  })
})

describe('JL-408 — no variant escapes onto a rem-derived size', () => {
  const theme = buildMuiTheme('light')
  const VARIANTS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'subtitle1', 'subtitle2',
    'body1', 'body2', 'button', 'caption', 'overline']

  it('expresses every typography variant in px', () => {
    // rem would re-scale the moment anyone changes the root size — which is
    // exactly how the 21px / 29.75px / 12.25px drift happened.
    for (const v of VARIANTS) {
      expect(String(theme.typography[v].fontSize), v).toMatch(/^\d+px$/)
    }
  })

  it('puts every variant on a value from the token scale', () => {
    const allowed = new Set(Object.values(SIZE).map((n) => `${n}px`))
    for (const v of VARIANTS) {
      expect(allowed.has(String(theme.typography[v].fontSize)), `${v} = ${theme.typography[v].fontSize}`)
        .toBe(true)
    }
  })

  it('pins the MUI size variants, which carry their own rem sizes', () => {
    // size="small" is 0.8125rem in MUI's defaults and computed to 11.375px here
    // even after the typography fix, because component size variants bypass it.
    expect(theme.components.MuiButton.styleOverrides.sizeSmall.fontSize).toBe(`${SIZE.sm}px`)
    expect(theme.components.MuiTableCell.styleOverrides.sizeSmall.fontSize).toBe(`${SIZE.sm}px`)
  })
})

describe('JL-408 — light and dark both resolve', () => {
  it('builds a palette per mode with distinct text colours', () => {
    const light = buildMuiTheme('light')
    const dark = buildMuiTheme('dark')
    expect(light.palette.mode).toBe('light')
    expect(dark.palette.mode).toBe('dark')
    expect(light.palette.text.primary).not.toBe(dark.palette.text.primary)
    // The dark canvas matches the one layout.css paints (JL-393/JL-401).
    expect(dark.palette.background.default.toLowerCase()).toBe('#1d2125')
  })

  it('falls back to light for an unknown mode rather than throwing', () => {
    expect(buildMuiTheme('nonsense').palette.text.primary)
      .toBe(buildMuiTheme('light').palette.text.primary)
  })
})
