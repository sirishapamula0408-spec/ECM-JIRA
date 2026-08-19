// JL-407 — a module that exports a component alongside anything else opts out of
// Vite fast refresh. `react-refresh/only-export-components` is an error in this
// repo, so the seven context modules were split: <X>Context.jsx keeps the context
// object and the use<X>() hook, <X>Provider.jsx keeps the provider component.
//
// These are source-scanning tests on purpose. The lint rule already catches a
// regression when someone runs `npm run lint`, but it says nothing about *why*
// the layout is this way, and nothing about the import convention that makes the
// split cheap (hooks keep their original path; only provider imports moved).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTEXTS = ['AppData', 'Auth', 'Issue', 'Member', 'Notification', 'Sprint', 'Theme']

const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8')

/** Names exported by a module, via `export function X` / `export const X`. */
function exportedNames(source) {
  return [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1])
}

/** Every .js/.jsx file under src/. */
function allSourceFiles(dir = SRC, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) allSourceFiles(p, out)
    else if (/\.jsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

describe('JL-407 — context modules are split by export kind', () => {
  it.each(CONTEXTS)('%sContext.jsx exports the context and hook, and no component', (name) => {
    const names = exportedNames(read(`context/${name}Context.jsx`))
    expect(names, `${name}Context should export the context object`).toContain(`${name}Context`)
    expect(names.some((n) => /^use[A-Z]/.test(n)), `${name}Context should export its hook`).toBe(true)
    // A component export is what would trip the rule. PascalCase minus the
    // context object itself is the signature of one.
    const components = names.filter((n) => /^[A-Z]/.test(n) && n !== `${name}Context`)
    expect(components, `${name}Context must not export components`).toEqual([])
  })

  it.each(CONTEXTS)('%sProvider.jsx exports only the provider component', (name) => {
    const names = exportedNames(read(`context/${name}Provider.jsx`))
    expect(names).toEqual([`${name}Provider`])
  })

  it.each(CONTEXTS)('%sProvider imports its context rather than redeclaring one', (name) => {
    const source = read(`context/${name}Provider.jsx`)
    expect(source).toContain(`import { ${name}Context } from './${name}Context'`)
    // Two createContext() calls would mean the hook and the provider are wired
    // to different contexts — the hook would throw its "must be used within"
    // error inside a perfectly valid tree.
    expect(source).not.toContain('createContext(')
  })
})

describe('JL-407 — useConfirm is split from ConfirmDialog for the same reason', () => {
  it('ConfirmDialog.jsx exports only the component', () => {
    const names = exportedNames(read('components/common/ConfirmDialog.jsx'))
    expect(names).toEqual(['ConfirmDialog'])
  })

  it('useConfirm.jsx exports only the hook, and renders the real dialog', () => {
    const source = read('components/common/useConfirm.jsx')
    expect(exportedNames(source)).toEqual(['useConfirm'])
    expect(source).toContain(`import { ConfirmDialog } from './ConfirmDialog'`)
  })
})

describe('JL-407 — the import convention holds across the codebase', () => {
  const files = allSourceFiles()

  // Both patterns tolerate an explicit `.jsx?` suffix. The codemod that
  // performed this split matched only extension-less paths and so missed
  // QueuesPage's `from '../../components/common/ConfirmDialog.jsx'`. ESLint does
  // not resolve imports, and no jsdom test rendered that page, so the broken
  // import reached a browser before anything complained.
  const MODULE_END = String.raw`(?:\.jsx?)?`

  it('no module imports a provider from a *Context file', () => {
    // This is the half of the split that had to move. Getting it wrong is a
    // runtime crash, not a lint warning, so it is worth pinning directly.
    const re = new RegExp(String.raw`import\s+\{([^}]*)\}\s+from\s+'([^']*Context${MODULE_END})'`, 'g')
    const offenders = []
    for (const file of files) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(re)) {
        const specs = m[1].split(',').map((s) => s.trim())
        const provider = specs.find((s) => CONTEXTS.some((n) => s === `${n}Provider`))
        if (provider) offenders.push(`${path.relative(SRC, file)}: ${provider} from '${m[2]}'`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no module imports useConfirm from ConfirmDialog', () => {
    const re = new RegExp(
      String.raw`import\s+\{[^}]*\buseConfirm\b[^}]*\}\s+from\s+'[^']*\/ConfirmDialog${MODULE_END}'`,
    )
    const offenders = files.filter((file) => re.test(fs.readFileSync(file, 'utf8')))
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([])
  })

  it('every split module resolves to a file that exists', () => {
    // The catch-all for the same class of mistake: a rewritten import path that
    // simply is not there. Vite reports it at runtime; nothing else does.
    // Anchored to a real import statement. An unanchored `from '…'` also
    // matches the illustrative import inside this file's own comments and the
    // provider headers, which are prose, not module specifiers.
    const importRe = /^\s*import\s[^\n]*?\sfrom\s+'(\.[^']*)'/gm
    const missing = []
    for (const file of files) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(importRe)) {
        const spec = m[1]
        if (!/(Context|Provider|ConfirmDialog|useConfirm)(\.jsx?)?$/.test(spec)) continue
        const base = path.resolve(path.dirname(file), spec)
        const found = [base, `${base}.js`, `${base}.jsx`].some((p) => fs.existsSync(p))
        if (!found) missing.push(`${path.relative(SRC, file)} -> ${spec}`)
      }
    }
    expect(missing).toEqual([])
  })
})
