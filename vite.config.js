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

    // Vitest sizes the pool from the CPU count (22 here). Each worker is a
    // separate Node process, and oversubscribing them is what made workers fail
    // to start at all. Leave headroom for the OS and any running dev server.
    // NOTE: `poolOptions.forks.maxForks` was removed in Vitest 4 — the pool
    // limits are top-level `maxWorkers`/`minWorkers` now, and setting the old
    // shape is silently ignored apart from a deprecation warning.
    pool: 'forks',
    maxWorkers: 8,
    minWorkers: 1,
  },
})
