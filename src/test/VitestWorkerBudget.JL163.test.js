// @vitest-environment node
//
// vite.config.js pulls in esbuild, which refuses to load under jsdom — see the
// note at the top of VitestConfigProjects.JL377.test.js. Config assertions
// belong in node.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import viteConfig from '../../vite.config.js'

/* ================================================================
   JL-163 — the pool size is overridable, and the investigation that
   decided not to change its default is written down.

   The reported flakiness — a different async-heavy suite timing out
   on each full run, all passing in isolation, one run collecting
   197 of 202 files with unhandled errors — was MEMORY PRESSURE on
   the developer machine, not a defect in the suite. 22 cores but
   15.5 GiB RAM, ~2 GiB free, 35 GiB committed against a 41.5 GiB
   limit, 4.1 GiB paged, largest consumers not Node. A full run
   launched under that was killed by the OS for low memory.

   Three full runs completed clean during the investigation, so the
   suite could not be made to fail on demand once the machine had
   headroom.

   Lowering maxWorkers was tried and rejected on measurement:

     full suite, 8 workers    576s   clean
     full suite, 4 workers   1071s   clean   <- 86% slower, no gain

   What ships is the LEVER plus the write-up, not a new number. The
   assertions below exist so the next person reads the measurements
   before re-tuning, and so the escape hatch cannot be dropped.
   ================================================================ */

const config = typeof viteConfig === 'function'
  ? viteConfig({ command: 'serve', mode: 'test' })
  : viteConfig

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '..', '..', 'vite.config.js'), 'utf8').replace(/\r\n/g, '\n')

describe('JL-163 the pool size can be lowered per machine', () => {
  it('reads VITEST_MAX_WORKERS', () => {
    /*
     * The right number genuinely differs per machine — that is the whole
     * finding. A box with headroom wants 8; one at 2 GiB free wants 2, and
     * should not have to edit a tracked file to get it.
     */
    expect(src).toMatch(/process\.env\.VITEST_MAX_WORKERS/)
  })

  it('falls back to the default when the variable is absent or junk', () => {
    // Number('') is 0 and Number('abc') is NaN, both falsy, so `||` yields the
    // default. Pinned because switching to `??` here would hand the pool a 0
    // for anyone with the variable exported empty.
    expect(Number('') || 8).toBe(8)
    expect(Number('abc') || 8).toBe(8)
    expect(Number('2') || 8).toBe(2)
  })

  it('still resolves to a real cap, not the core count', () => {
    expect(config.test.maxWorkers).toBeGreaterThan(0)
    expect(config.test.maxWorkers).toBeLessThanOrEqual(16)
    // poolOptions was removed in Vitest 4; setting it is silently ignored and
    // the pool quietly grows back to the core count.
    expect(config.test.poolOptions).toBeUndefined()
  })
})

describe('JL-163 the investigation is recorded, not just its conclusion', () => {
  it('keeps the full-suite numbers that rejected a smaller pool', () => {
    /*
     * Without these, "why is this 8?" is unanswerable and the next person
     * re-runs the same experiment. With them, they can see that 4 was tried
     * and cost 86% wall-clock for nothing.
     */
    expect(src).toMatch(/8 workers\s+576s/)
    expect(src).toMatch(/4 workers\s+1071s/)
    /*
     * And that EVERY size was killed once the box lost its headroom — 8, 4 and
     * finally 2 at 0.84 GiB free. This is the set of numbers that rules the
     * pool size out as the cause; without them the obvious next move is to
     * tune the number again, which is a dead end.
     */
    expect(src).toMatch(/8 workers\s+--\s+OS-killed/)
    expect(src).toMatch(/4 workers\s+--\s+OS-killed/)
    expect(src).toMatch(/2 workers\s+--\s+OS-killed/)
    // The override buys headroom on a machine that is tight; it does not
    // rescue one that is full, and the comment must keep saying so.
    expect(src).toMatch(/free memory/)
  })

  it('records that the first benchmark was INVALID', () => {
    /*
     * A six-file benchmark appeared to favour 4 workers. Six files occupy at
     * most six workers, so 8 and 4 were the same run wearing different
     * labels. Recording a wrong measurement is worth as much as recording a
     * right one — it stops the same mistake being made twice.
     */
    expect(src).toMatch(/invalid/i)
  })

  it('records that threads were measured rather than assumed', () => {
    // Threads share an address space and should cost less memory, which makes
    // them the obvious idea; they are about twice as slow here.
    expect(src).toMatch(/threads/)
    expect(config.test.pool).toBe('forks')
  })

  it('names memory as the cause rather than the test code', () => {
    expect(src).toMatch(/MEMORY PRESSURE/)
  })
})
