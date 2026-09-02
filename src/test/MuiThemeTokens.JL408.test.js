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
    for (const step of ['sm', 'base', 'md', 'lg', 'xl', 'xxl', 'xxxl']) {
      expect(SIZE[step], `--font-size-${step}`).toBe(token(`font-size-${step}`))
    }
  })

  it('uses every line-height token at the declared value', () => {
    for (const step of ['sm', 'base', 'md', 'lg', 'xl', 'xxl', 'xxxl']) {
      expect(LEADING[step], `--line-height-${step}`).toBe(token(`line-height-${step}`))
    }
  })

  it('consumes the font-family token rather than restating the stack', () => {
    const theme = buildMuiTheme('light')
    // JL-414 changed this contract twice. Under option A the stack was written
    // out three times and the assertion compared a COPY; that copy is gone and
    // the theme now references the token. Under option B the first face is no
    // longer -apple-system but Inter, a self-hosted webfont.
    expect(theme.typography.fontFamily).toContain('var(--font-family-sans');

    const declared = variablesCss
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith('--font-family-sans:'))
    expect(declared, '--font-family-sans must be declared').toBeTruthy()

    const firstFace = declared.split(':')[1].split(',')[0].trim()
    expect(firstFace, 'Inter must be asked for first').toBe("'Inter Variable'")

    // The system stack must remain BEHIND Inter. If the webfont fails or is
    // still swapping, the app should land on the faces it used before rather
    // than on a generic — that is the metric-compatible fallback AC#4 wants.
    expect(declared).toContain('-apple-system')
    expect(declared).toContain('sans-serif')

    // Roboto may sit in the fallback chain, but must never be what is asked
    // for first: this app has never loaded it.
    expect(firstFace).not.toBe('Roboto')
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
