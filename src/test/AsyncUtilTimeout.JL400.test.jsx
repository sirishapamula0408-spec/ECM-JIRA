// JL-400 — Testing Library's async budget must stay aligned with Vitest's.
//
// The WorkflowEditor* suites failed nondeterministically under load, always on
// an `await screen.findByRole(...)` that TIMED OUT rather than asserting a
// wrong value. Root cause: two independent timeouts that nobody had reconciled.
//
//   vite.config.js   testTimeout       20000ms  (raised by JL-377)
//   @testing-library asyncUtilTimeout   1000ms  (library default, never set)
//
// `testTimeout` does not govern `findBy*` / `waitFor` — they carry their own
// budget. JL-377 raised the TEST budget 20x to absorb scheduling delay under a
// loaded fork pool, but every async QUERY inside those tests kept the 1s
// default that the raise never reached.
//
// Why that bites these suites specifically: their mocks resolve immediately in
// wall-clock terms, so what expires is not I/O but the worker's turn on the
// CPU. With `maxWorkers: 8`, running the 8 heaviest suites together guarantees
// all 8 full-page mounts are co-scheduled — which is why running ONLY those 8
// reproduced it far worse (15 failures) than the full 3903-test suite did (3).
// The full run interleaves them with cheap suites and hides it.
//
// This test exists so the alignment cannot silently regress: deleting the
// configure() call in setup.js, or a Testing Library upgrade changing the
// default, fails here rather than resurfacing as a flake months later.
import { describe, it, expect } from 'vitest'
import { getConfig } from '@testing-library/dom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

/** The Testing Library default, which is what this ticket had to override. */
const LIBRARY_DEFAULT = 1000

describe('JL-400 — async query budget', () => {
  it('is configured, not left at the library default', () => {
    expect(getConfig().asyncUtilTimeout).toBeGreaterThan(LIBRARY_DEFAULT)
  })

  it('leaves ample headroom inside the Vitest test timeout', () => {
    // A query that genuinely cannot find its element should fail as a readable
    // "unable to find element" well before the test itself is killed — so the
    // query budget must stay comfortably under testTimeout, not near it.
    const config = fs.readFileSync(path.join(repoRoot, 'vite.config.js'), 'utf8')
    const match = config.match(/testTimeout:\s*(\d+)/)
    expect(match, 'testTimeout not found in vite.config.js').not.toBeNull()

    const testTimeout = Number(match[1])
    const asyncUtilTimeout = getConfig().asyncUtilTimeout

    expect(asyncUtilTimeout).toBeLessThan(testTimeout)
    // Keep at least a 2x gap so the failure mode stays informative.
    expect(testTimeout / asyncUtilTimeout).toBeGreaterThanOrEqual(2)
  })

  it('setup.js records why, so the value is not tuned away as noise', () => {
    // The ticket explicitly forbids papering over this with a bare timeout
    // bump. The reasoning has to survive in the file.
    const setup = fs.readFileSync(path.join(here, 'setup.js'), 'utf8')
    expect(setup).toContain('asyncUtilTimeout')
    expect(setup).toMatch(/JL-400/)
  })
})
