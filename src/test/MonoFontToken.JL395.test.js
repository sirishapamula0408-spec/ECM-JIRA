// @vitest-environment node
//
// JL-395 (widened by JL-416) — every monospace surface uses the shared token.
//
// JL-395 fixed AuditLogPage and FiltersPage and guarded exactly those two
// files. JL-416 found the identical hardcoded SFMono stack still living in
// WikiPage.css and RichTextEditor.css, unseen because they were not on the
// list. This version scans all of src/ instead.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(here, '..')
const repoRoot = path.resolve(srcDir, '..')
const read = (rel) => fs.readFileSync(path.join(srcDir, rel), 'utf8')

// Built from pieces so this file never contains the literal it guards against
// (otherwise the scan below would flag the test itself).
const BAD_VAR = 'var(--font-' + 'mono'

// variables.css legitimately declares the stack; it is the definition site.
const DEFINITION_SITE = path.join(srcDir, 'styles', 'variables.css')

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const keyOf = (abs) => path.relative(repoRoot, abs).split(path.sep).join('/')

const allFiles = walk(srcDir)
const styleFiles = allFiles.filter(
  (f) => (f.endsWith('.css') || f.endsWith('.jsx') || f.endsWith('.js')) &&
    f !== DEFINITION_SITE &&
    !f.includes(`${path.sep}test${path.sep}`),
)

describe('JL-395 — mono surfaces use the shared font token', () => {
  it('AuditLogPage.css uses var(--font-family-mono)', () => {
    const css = read('pages/AuditLogPage/AuditLogPage.css')
    expect(css).toContain('var(--font-family-mono')
    expect(css).not.toContain(BAD_VAR)
  })

  it('FiltersPage.css uses var(--font-family-mono) and no hardcoded stack', () => {
    const css = read('pages/FiltersPage/FiltersPage.css')
    expect(css).toContain('var(--font-family-mono')
    expect(css).not.toContain('SFMono')
  })

  it('no file under src/ references the non-existent --font-mono name', () => {
    const offenders = allFiles
      .filter((f) => fs.readFileSync(f, 'utf8').includes(BAD_VAR))
      .map(keyOf)
    expect(
      offenders,
      `the token is --font-family-mono, not --font-mono:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('variables.css is the only place the mono stack is spelled out', () => {
    // JL-416: the audit found the same SFMono stack copied into WikiPage.css
    // and RichTextEditor.css. A second copy is how the two drift apart.
    const STACK_LITERALS = ['SFMono', 'Menlo', 'Consolas', 'ui-monospace']
    const offenders = []
    for (const file of styleFiles) {
      const content = fs.readFileSync(file, 'utf8')
      const found = STACK_LITERALS.filter((lit) => content.includes(lit))
      if (found.length) offenders.push(`${keyOf(file)}: ${found.join(', ')}`)
    }
    expect(
      offenders,
      'hardcoded monospace stacks. Use var(--font-family-mono):\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('no stylesheet falls back to bare `monospace`', () => {
    const offenders = []
    for (const file of styleFiles.filter((f) => f.endsWith('.css'))) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        const m = line.match(/font-family:\s*([^;]+);/)
        if (m && /(^|[\s,])monospace\s*$/.test(m[1]) && !m[1].includes('var(--font-')) {
          offenders.push(`${keyOf(file)}:${i + 1}  ${m[1].trim()}`)
        }
      })
    }
    expect(
      offenders,
      `bare monospace fallbacks. Use var(--font-family-mono):\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('the mono token itself is defined', () => {
    const variables = fs.readFileSync(DEFINITION_SITE, 'utf8')
    expect(variables).toMatch(/--font-family-mono\s*:/)
  })
})
