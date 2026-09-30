import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      // JL-136: proxy the real-time WebSocket endpoint to the Express server.
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
  test: {
    // JL-377: the suite used a single global `environment: 'jsdom'`, so the ~163
    // backend suites each paid a full jsdom instantiation they never used. On a
    // 12-file backend sample that was 66s of environment setup against 4.8s of
    // actual test time. The inflated wall clock pushed tests past the 5s default
    // timeout and starved the worker pool, producing the nondeterministic
    // "Test timed out in 5000ms" / "Failed to start forks worker" failures.
    //
    // Splitting into two projects gives the DOM only to the tests that need it.
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          // `globals` is NOT inherited from the root block by projects — every
          // suite using a bare `vi`/`expect` fails to collect without it here.
          globals: true,
          include: ['src/**/*.{test,spec}.{js,jsx}'],
          setupFiles: ['./src/test/setup.js'],
          css: true,
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          globals: true,
          include: ['server/**/*.{test,spec}.js'],
          // No jest-dom: these suites have no DOM to assert against.
          setupFiles: ['./src/test/setup.env.js'],
        },
      },
    ],

    // Defaults of 5000ms were tight enough that ordinary scheduling delay under
    // a loaded pool registered as a test failure rather than slowness.
    testTimeout: 20000,
    hookTimeout: 20000,

    /*
     * Vitest sizes the pool from the CPU count (22 here). Each worker is a
     * separate Node process, and oversubscribing them is what made workers fail
     * to start at all (JL-377). Leave headroom for the OS and any running dev
     * server.
     *
     * ── JL-163: why 8 stayed, and what the flakiness actually is ────────────
     *
     * The intermittent failures — a different async-heavy suite timing out on
     * each full run, all of them passing in isolation, and one run collecting
     * only 197 of 202 files with unhandled errors — are MEMORY PRESSURE on the
     * developer machine, not a defect in the suite. Measured on this box:
     * 22 cores but 15.5 GiB RAM, ~2 GiB free, 35 GiB committed against a
     * 41.5 GiB limit, 4.1 GiB actively paged, and the largest consumers were
     * other applications rather than Node. A full run launched while that was
     * true was killed outright by the OS for low memory. A worker that loses
     * seconds to page faults blows a findBy* budget, and which suite that hits
     * is luck — hence a different one each time.
     *
     * Lowering the DEFAULT was tried and rejected, because the pool size is
     * not the discriminator — the machine's free memory at the moment of the
     * run is:
     *
     *   full suite, 8 workers    576s   clean      (box had headroom)
     *   full suite, 8 workers    576s   clean      (box had headroom)
     *   full suite, 4 workers   1071s   clean      (box had headroom)
     *   full suite, 8 workers      --   OS-killed, low memory
     *   full suite, 4 workers      --   OS-killed, low memory
     *   full suite, 2 workers      --   OS-killed, low memory  (0.84 GiB free)
     *
     * Both sizes complete with headroom and every size is killed without it,
     * while 4 costs 86% more wall-clock. So the default stays at 8 and the
     * lever is exposed per machine instead.
     *
     * Be clear about what VITEST_MAX_WORKERS can and cannot do: it buys
     * headroom on a machine that is merely tight. At 0.84 GiB free even two
     * workers were killed, so below roughly a gigabyte the answer is to free
     * memory — close browsers, stop `npm run dev` — not to tune this number.
     * Running the projects separately (`--project=server` is node-only and
     * cheap) or a subset of files is the other way through.
     *
     * A first benchmark over only the six heaviest suites appeared to favour
     * 4 workers (47s vs 59s). That experiment was invalid and is recorded so
     * it is not repeated: six files can occupy at most six workers, so 8 and 4
     * were the same run wearing different labels, and the gap was noise.
     *
     * `pool: 'threads'` was also measured, since threads share one address
     * space and should cost less memory. Roughly twice as slow on this suite
     * (84s/94s against 47-59s on the same files), so forks stay.
     *
     * VITEST_MAX_WORKERS is the lever for a machine that cannot afford 8 —
     * `VITEST_MAX_WORKERS=2 npm test` trades wall-clock for headroom without
     * editing the repo, which is the right shape for a limit that genuinely
     * differs per machine.
     *
     * NOTE: `poolOptions.forks.maxForks` was removed in Vitest 4 — the pool
     * limits are top-level `maxWorkers`/`minWorkers` now, and setting the old
     * shape is silently ignored apart from a deprecation warning.
     */
    pool: 'forks',
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || 8,
    minWorkers: 1,
  },
})
