import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/* ================================================================
   JL-161 — a focused MUI field shows ONE border, not two.

   shared.css gives every bare input/select/textarea a focus ring:

     input:focus, select:focus, textarea:focus {
       box-shadow: 0 0 0 1px #4c9aff;
     }

   That is right for a hand-rolled control, which has no wrapper.
   MUI renders a real <textarea> INSIDE a wrapper that already draws
   its own focused border — the notched outline carrying the field's
   legend — so the ring landed inside it and painted a second blue
   border. Measured on /wiki/new and in the create-Space dialog:

     before   inner box-shadow rgb(76,154,255) 0 0 0 1px
              outer border     2px rgb(0,82,204)      <- two borders
     after    inner box-shadow none
              outer border     2px rgb(0,82,204)      <- one

   MUI zeroes the BORDER on .MuiInputBase-input but says nothing
   about box-shadow, which is why that one declaration had to be
   handed back rather than the whole rule being rewritten.

   Source-level, following ShellScroll.JL401: this is a cascade fact
   between a stylesheet and a library's injected styles, and jsdom
   resolves neither faithfully enough to assert on.
   ================================================================ */

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '..', 'styles', 'shared.css'), 'utf8').replace(/\r\n/g, '\n')
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('JL-161 the focus ring does not reach MUI inputs', () => {
  it('cancels the box-shadow on a focused MUI input', () => {
    expect(rules).toMatch(/\.MuiInputBase-input:focus\s*\{[^}]*box-shadow:\s*none/)
  })

  it('leaves the ring in place for hand-rolled controls', () => {
    /*
     * The fix is additive on purpose. Deleting the rule below would strip the
     * focus indicator from every non-MUI input in the app — a far worse
     * outcome than the cosmetic defect it was fixing.
     */
    expect(rules).toMatch(
      /input:focus,\s*\n\s*select:focus,\s*\n\s*textarea:focus\s*\{[^}]*box-shadow:\s*0 0 0 1px/,
    )
  })

  it('wins on specificity rather than !important', () => {
    // .MuiInputBase-input:focus is (0,2,0); textarea:focus is (0,1,1).
    const block = rules.match(/\.MuiInputBase-input:focus\s*\{([^}]*)\}/)
    expect(block, 'override block not found').toBeTruthy()
    expect(block[1]).not.toMatch(/!important/)
  })

  it('is declared AFTER the rule it corrects', () => {
    // Equal-specificity neighbours would otherwise decide on order; this also
    // keeps the two readable as a pair.
    expect(rules.indexOf('.MuiInputBase-input:focus'))
      .toBeGreaterThan(rules.indexOf('textarea:focus'))
  })
})
