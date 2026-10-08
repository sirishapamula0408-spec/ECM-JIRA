// JL-157 — functional test suite. See e2e/README.md.
//
//   npm run build            once, or after frontend changes (served from /dist)
//   npm run test:e2e         reset the e2e database, start the server, run all
//   npx playwright test e2e/api/auth.spec.mjs    one file
import { defineConfig } from '@playwright/test'
import { BASE_URL } from './e2e/support/env.mjs'

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.mjs$/,
  // One worker: the dev box is memory-constrained, and several specs share
  // workspace-level state (signup policy, members) that must not interleave.
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  retries: 0,
  globalSetup: './e2e/support/global-setup.mjs',
  outputDir: 'e2e/results/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e/results/results.json' }],
    ['html', { outputFolder: 'e2e/results/html', open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testDir: 'e2e/api' },
    { name: 'ui', testDir: 'e2e/ui' },
  ],
  webServer: {
    command: 'node e2e/support/start-server.mjs',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
