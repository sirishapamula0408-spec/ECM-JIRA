// @vitest-environment node
//
// JL-394 (widened by JL-416) — page and component CSS uses the typography
// tokens rather than literal font values.
//
// JL-394 checked a hardcoded list of 13 page directories. That list was the
// problem: 42 pages exist, so 29 of them plus every component were unguarded,
// and the suite stayed green precisely because it was not looking. 257 literal
// font declarations accumulated underneath it.
//
// This version scans the filesystem through stylelint (see typographyScan.mjs
// for why that, and not a regex, is the scanner). The known set is frozen in
// typography-baseline.json as a per-file COUNT, and this test ratchets:
//
//   * a NEW violation, in any file, listed or not        -> fail
//   * a violation REMOVED without shrinking the baseline -> fail
//
// The second half is what makes it a ratchet rather than a snapshot: the count
// can only go down. Counts are per file rather than per line, so unrelated
// edits that shift line numbers do not churn the baseline.
//
// JL-415 then cleared the baseline: 257 violations across 46 files went to 1,
// so `npm run lint` now hard-gates every stylesheet but one. That removed the
// original "guard the guard" signal, which asserted the baseline was LARGE —
// true when 257 violations were outstanding, meaningless at 1. It is replaced
// below by two checks that survive an empty baseline: the scan must report
// having parsed the whole stylesheet tree, and the rule must still flag a
// known-bad probe.
//
// Re-baseline with:  node scripts/typography-baseline.mjs
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { scanTypography, repoRoot } from './typographyScan.mjs'
import { TOKEN_ONLY, RULE_NAME } from './typographyRule.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(here, '..')

const baseline = JSON.parse(
  fs.readFileSync(path.join(here, 'typography-baseline.json'), 'utf8'),
)

let current = {}
let detail = {}
let scanned = 0

beforeAll(async () => {
  const scan = await scanTypography()
  current = scan.counts
  detail = scan.detail
  scanned = scan.scanned
}, 60_000)

describe('JL-416 — the typography guard enumerates the filesystem', () => {
  it('parses the whole stylesheet tree, not a handful of files', () => {
    // Guards the guard: if the scan ever collapses, every assertion below
    // becomes vacuously true. Post-JL-415 the baseline is nearly empty, so the
    // signal has to be how many files the scanner OPENED, not how many it
    // complained about.
    const onDisk = (function walk(dir, n = 0) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) n = walk(path.join(dir, e.name), n)
        else if (e.name.endsWith('.css')) n++
      }
      return n
    })(srcDir)
    expect(onDisk).toBeGreaterThan(30)
    expect(scanned).toBe(onDisk)
  })

  it('still flags a known-bad declaration', async () => {
    // Positive control. An allow-list rule that silently stopped applying —
    // renamed, mis-scoped, dropped by a stylelint upgrade — would report zero
    // violations and agree with a zero baseline perfectly.
    const probe = await stylelint.lint({
      code: '.probe { font-size: 13px; font-weight: 600; }',
      config: { rules: { [RULE_NAME]: [TOKEN_ONLY] } },
    })
    const hits = probe.results[0].warnings.filter((w) => w.rule === RULE_NAME)
    expect(hits).toHaveLength(2)
  })

  it('the recorded total matches the recorded per-file counts', () => {
    const summed = Object.values(baseline.files).reduce((a, b) => a + b, 0)
    expect(baseline.total).toBe(summed)
  })

  it('has no baseline entry for a file that no longer exists', () => {
    const missing = Object.keys(baseline.files).filter(
      (f) => !fs.existsSync(path.join(repoRoot, f)),
    )
    expect(missing, `stale baseline entries:\n${missing.join('\n')}`).toEqual([])
  })
})

describe('JL-416 — the ratchet', () => {
  it('rejects NEW hardcoded font declarations', () => {
    const regressions = []
    for (const [file, count] of Object.entries(current)) {
      const allowed = baseline.files[file] ?? 0
      if (count > allowed) {
        regressions.push(
          `${file}: ${count} violation(s), baseline allows ${allowed}\n` +
            detail[file].map((d) => `    ${d}`).join('\n'),
        )
      }
    }
    expect(
      regressions,
      'New hardcoded font declarations. Use the var(--font-*) tokens from ' +
        `src/styles/variables.css:\n${regressions.join('\n')}`,
    ).toEqual([])
  })

  it('requires the baseline to shrink when a file is migrated', () => {
    const stale = []
    for (const [file, allowed] of Object.entries(baseline.files)) {
      const count = current[file] ?? 0
      if (count < allowed) {
        stale.push(`${file}: now ${count}, baseline still says ${allowed}`)
      }
    }
    expect(
      stale,
      'These files improved but the baseline was not updated. Run ' +
        '`node scripts/typography-baseline.mjs` so the ratchet cannot slip ' +
        `back:\n${stale.join('\n')}`,
    ).toEqual([])
  })

  it('agrees with the baseline exactly', () => {
    const total = Object.values(current).reduce((a, b) => a + b, 0)
    expect(total).toBe(baseline.total)
  })
})

describe('JL-394 — the originally migrated pages stay migrated', () => {
  // The 13 pages JL-394 cleaned. A regression here means a migrated page took
  // on a literal value again.
  const MIGRATED = [
    'ActivityFeedPage', 'AdvancedRoadmapPage', 'AutomationPage',
    'CrossProjectBoardPage', 'GoalsPage', 'InboundEmailPage',
    'KnowledgeBasePage', 'PluginsPage', 'PortfolioPage', 'ReleasesPage',
    'SharedDashboardsPage', 'WebhooksPage', 'WikiPage',
  ]

  it.each(MIGRATED)('%s.css has no hardcoded font-size', (page) => {
    const css = fs.readFileSync(
      path.join(srcDir, 'pages', page, `${page}.css`), 'utf8',
    )
    expect(css.match(/font-size:\s*[\d.]+\s*(px|rem)/g) || []).toEqual([])
  })

  it.each(MIGRATED)('%s.css uses at least one typography token', (page) => {
    const css = fs.readFileSync(
      path.join(srcDir, 'pages', page, `${page}.css`), 'utf8',
    )
    expect(css).toMatch(/var\(--font-size-[a-z]+\)/)
  })

  it('every font-size token referenced anywhere is defined in variables.css', () => {
    const variables = fs.readFileSync(
      path.join(srcDir, 'styles', 'variables.css'), 'utf8',
    )
    const defined = new Set(variables.match(/--font-size-[a-z]+(?=\s*:)/g) || [])
    expect(defined.size).toBeGreaterThan(0)

    const walk = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name)
        if (e.isDirectory()) walk(f, out)
        else if (e.name.endsWith('.css')) out.push(f)
      }
      return out
    }

    const undefinedRefs = []
    for (const file of walk(srcDir)) {
      const css = fs.readFileSync(file, 'utf8')
      for (const token of css.match(/(?<=var\()--font-size-[a-z]+(?=[),])/g) || []) {
        if (!defined.has(token)) undefinedRefs.push(`${file} -> ${token}`)
      }
    }
    expect(undefinedRefs, `undefined token references:\n${undefinedRefs.join('\n')}`)
      .toEqual([])
  })
})
