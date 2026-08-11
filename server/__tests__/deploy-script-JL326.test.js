// JL-326 — deploy.sh must deploy a BUILT ARTIFACT, not the Vite dev server.
//
// A bash script can't be unit-tested by running it (it stops processes, resets
// the git tree and starts a server), so this suite asserts two things instead:
//
//   1. Textual properties of deploy.sh — which commands it does and does not
//      invoke. Comment lines are stripped first, so the header may still *talk
//      about* `npm run dev` while the script never runs it.
//   2. The serving contract it depends on, using the REAL shouldServeStatic()
//      from server/serveStatic.js fed with the env the script actually exports.
//      That is the assertion that couples script to server behaviour: if either
//      side drifts (script exports NODE_ENV=staging, or shouldServeStatic stops
//      honouring production) this test fails.

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { shouldServeStatic } from '../serveStatic.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEPLOY_SH = path.join(REPO_ROOT, 'deploy.sh')

const source = fs.readFileSync(DEPLOY_SH, 'utf8')
const allLines = source.split(/\r?\n/)

// Lines that actually execute: drop blanks and comment-only lines.
const codeLines = allLines.filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))

// Lines that *launch* something. Excluded, because they mention command names
// without running them:
//   * `pkill -f "<name>"`  — names a process to KILL (the script tears down any
//     legacy dev-server deploy from before this change).
//   * `command -v <name>`  — probes whether a binary exists.
//   * `log|ok|warn|die "…"` — the script's own console output helpers, whose
//     human-readable messages naturally name the commands being run.
const launchLines = codeLines.filter(
  (l) =>
    !/^\s*pkill\b/.test(l) &&
    !/\bcommand\s+-v\b/.test(l) &&
    !/^\s*(log|ok|warn|die)\s+["']/.test(l),
)

const launchText = launchLines.join('\n')

describe('JL-326: deploy.sh does not run a dev server', () => {
  it('sanity: the parsed line sets are non-trivial', () => {
    // Guards the filters above — if a refactor made these empty, every
    // "does not contain" assertion below would pass vacuously.
    expect(codeLines.length).toBeGreaterThan(40)
    expect(launchLines.length).toBeGreaterThan(30)
  })

  it('never invokes `npm run dev` (or dev:client / dev:server)', () => {
    const offenders = launchLines.filter((l) => /npm\s+run\s+dev/.test(l))
    expect(offenders).toEqual([])
  })

  it('never invokes nodemon', () => {
    const offenders = launchLines.filter((l) => /\bnodemon\b/.test(l))
    expect(offenders).toEqual([])
  })

  it('never starts vite as a dev server (vite / vite dev / vite preview)', () => {
    // `npm run build` shells out to `vite build` inside package.json — that is
    // the artifact build, not a server, and the word "vite" never appears here.
    const offenders = launchLines.filter(
      (l) => /(^|[\s;&|(])(npx\s+)?vite\b/.test(l) || /npm\s+run\s+(preview|dev:client)/.test(l),
    )
    expect(offenders).toEqual([])
  })

  it('does not use `concurrently` to run the app', () => {
    const offenders = launchLines.filter((l) => /\bconcurrently\b/.test(l))
    expect(offenders).toEqual([])
  })
})

describe('JL-326: deploy.sh builds and serves an artifact', () => {
  it('runs the production build', () => {
    expect(launchText).toMatch(/npm\s+run\s+build/)
  })

  it('aborts when the build produced no dist/index.html', () => {
    // The build must be verified, not assumed: `set -e` covers a non-zero exit,
    // this covers a build that exited 0 without emitting an artifact.
    const guard = launchLines.find(
      (l) => l.includes('dist/index.html') && /\bdie\b/.test(l),
    )
    expect(guard, 'expected a `[ -f dist/index.html ] || die ...` guard').toBeTruthy()
  })

  it('builds before starting the server', () => {
    const buildAt = launchLines.findIndex((l) => /npm\s+run\s+build/.test(l))
    const startAt = launchLines.findIndex((l) =>
      /npm\s+run\s+server|node\s+server\/index\.js|pm2\s+startOrReload|systemctl\s+restart/.test(l),
    )
    expect(buildAt).toBeGreaterThanOrEqual(0)
    expect(startAt).toBeGreaterThanOrEqual(0)
    expect(buildAt).toBeLessThan(startAt)
  })

  it('starts the server via the production entry, not a dev runner', () => {
    expect(launchText).toMatch(/npm\s+run\s+server|node\s+server\/index\.js/)
  })

  it('aborts on any error (`set -e`)', () => {
    // `set -euo pipefail` or `set -Eeuo pipefail` both satisfy this.
    const setLine = codeLines.find((l) => /^\s*set\s+-[A-Za-z]*e/.test(l))
    expect(setLine, 'expected a `set -e`-style line').toBeTruthy()
  })

  it('keeps its pre-existing responsibilities (env / db / health check)', () => {
    // JL-326 changes how the app is served; it must not drop the rest.
    expect(launchText).toMatch(/git\s+fetch\s+origin/) // fast-forward
    expect(launchText).toMatch(/npm\s+ci/) // dependency install
    expect(launchText).toMatch(/JWT_SECRET/) // env preflight
    expect(launchText).toMatch(/docker\s+compose\s+up|docker-compose\s+up/) // database
    expect(launchText).toMatch(/api\/health/) // post-deploy health check
  })

  it('treats a process manager as optional, never a hard dependency', () => {
    // pm2/systemd add restart-on-crash but must not be required: the default
    // launcher has to work with nothing beyond git/node/npm installed.
    expect(source).toMatch(/PROCESS_MANAGER="\$\{PROCESS_MANAGER:-none\}"/)
    const pm2Lines = launchLines.filter((l) => /\bpm2\b/.test(l))
    expect(pm2Lines.length).toBeGreaterThan(0) // the optional path exists…
    // …and is guarded by an availability check that fails loudly.
    expect(source).toMatch(/command -v pm2 >\/dev\/null \|\| die/)
  })
})

describe('JL-326: the script and shouldServeStatic() agree', () => {
  // Parse the env the script exports for the server process, rather than
  // hardcoding it here — this is what couples the two files.
  const exported = {}
  for (const line of codeLines) {
    const m = /^\s*export\s+([A-Z_][A-Z0-9_]*)=(.+)$/.exec(line)
    if (m) exported[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }

  it('deploy.sh exports NODE_ENV=production', () => {
    expect(exported.NODE_ENV).toBe('production')
  })

  it('the exported env makes the real shouldServeStatic() return true', () => {
    expect(Object.keys(exported).length).toBeGreaterThan(0)
    expect(shouldServeStatic(exported)).toBe(true)
  })

  it('each serving flag the script sets is independently sufficient', () => {
    // Belt-and-braces: NODE_ENV and SERVE_STATIC are both set, and either one
    // alone must still switch static serving on.
    for (const [key, value] of Object.entries(exported)) {
      if (key === 'NODE_ENV' || key === 'SERVE_STATIC') {
        expect(shouldServeStatic({ [key]: value }), `${key}=${value}`).toBe(true)
      }
    }
  })

  it('a dev env still does NOT serve static (no regression for local dev)', () => {
    expect(shouldServeStatic({ NODE_ENV: 'development' })).toBe(false)
    expect(shouldServeStatic({})).toBe(false)
  })
})
