import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ================================================================
   JL-160 — the Content and Description boxes lose their outline.

   Read as SOURCE, following ShellScroll.JL401: these are CSS
   cascade facts, and jsdom's getComputedStyle does not resolve
   emotion's nested `&` selectors reliably enough to assert on. What
   can be asserted exactly is the rule that ships and the class that
   opts into it.

   The load-bearing assertion is not "the border is gone" — it is
   that focus and error bring it back. A field with no resting
   border, no fill and no focus ring is invisible to anyone
   navigating by keyboard, which would trade a cosmetic complaint
   for an accessibility defect.
   ================================================================ */

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(resolve(here, '..', p), 'utf8').replace(/\r\n/g, '\n')

const css = read('components/wiki/fields.css')
/* Declarations only — the header comment discusses !important and colour
   literals, and must not be mistaken for shipping either. */
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '')
const createPage = read('pages/WikiHomePage/WikiCreatePage.jsx')
const dialogs = read('components/wiki/SpaceDialogs.jsx')

describe('JL-160 the rule itself', () => {
  it('removes the notched outline at rest', () => {
    expect(css).toMatch(
      /\.wiki-borderless-field \.MuiOutlinedInput-notchedOutline \{\s*border: 0;/,
    )
  })

  it('restores a visible border on FOCUS', () => {
    // Without this the control cannot be located by keyboard at all.
    const focus = css.match(/\.Mui-focused \.MuiOutlinedInput-notchedOutline \{([^}]*)\}/)
    expect(focus, 'no focus rule found').toBeTruthy()
    expect(focus[1]).toMatch(/border:\s*2px solid/)
  })

  it('restores a visible border on ERROR', () => {
    const err = css.match(/\.Mui-error \.MuiOutlinedInput-notchedOutline \{([^}]*)\}/)
    expect(err, 'no error rule found').toBeTruthy()
    expect(err[1]).toMatch(/border:\s*2px solid/)
  })

  it('takes both colours from design tokens, never a literal', () => {
    expect(css).toMatch(/var\(--jira-blue\)/)
    expect(css).toMatch(/var\(--jira-danger\)/)
    // A hex in this file would be a colour that cannot follow the theme.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('wins on specificity rather than on !important', () => {
    /*
     * MUI's own rule is `.MuiOutlinedInput-notchedOutline` (0,1,0); scoping
     * under .wiki-borderless-field beats it outright. RichTextEditor.css had
     * to reach for !important for the same job and is worth not imitating.
     */
    expect(cssRules).not.toMatch(/!important/)
  })
})

describe('JL-160 which fields opt in', () => {
  it('the Content box on the create-page form', () => {
    const field = createPage.match(/<TextField[^>]*?id="wiki-new-content"[\s\S]*?\/>/)
    expect(field, 'wiki-new-content field not found').toBeTruthy()
    expect(field[0]).toMatch(/className="wiki-borderless-field"/)
  })

  it('the Description box in the create-space dialog', () => {
    const field = dialogs.match(/<TextField[^>]*?id="space-description"[\s\S]*?\/>/)
    expect(field, 'space-description field not found').toBeTruthy()
    expect(field[0]).toMatch(/className="wiki-borderless-field"/)
  })

  it('and NOT the short single-line fields beside them', () => {
    /*
     * A one-line box is a control; a ten-line box is a canvas. Stripping the
     * outline from Title, Name or Key would leave three unlabelled gaps in a
     * row with nothing to say where one ends and the next begins.
     */
    for (const [src, id] of [
      [createPage, 'wiki-new-title'],
      [createPage, 'wiki-new-space'],
      [dialogs, 'space-name'],
      [dialogs, 'space-key'],
    ]) {
      const field = src.match(new RegExp(`<TextField[^>]*?id="${id}"[\\s\\S]*?(?:/>|</TextField>)`))
      expect(field, `${id} not found`).toBeTruthy()
      expect(field[0], `${id} should keep its outline`).not.toMatch(/wiki-borderless-field/)
    }
  })

  it('is imported by both components that use it', () => {
    expect(createPage).toMatch(/import '\.\.\/\.\.\/components\/wiki\/fields\.css'/)
    expect(dialogs).toMatch(/import '\.\/fields\.css'/)
  })
})
