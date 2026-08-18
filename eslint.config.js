import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['server/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      // JL-406: was 2020, which cannot parse numeric separators (60_000, ES2021)
      // or top-level await (ES2022). ESLint does not check a file it cannot
      // parse, so server/config.js, server/middleware/rateLimit.js and two
      // server test files were silently unlinted. 'latest' stops this recurring.
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      // JL-406: argsIgnorePattern matters as much as varsIgnorePattern here — an
      // Express error handler MUST keep 4 params to be recognised as error
      // middleware, so errorHandler's `_next` is deliberately unused and must
      // not be deleted to satisfy the linter.
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
  {
    // JL-377: front-end tests are matched by the `src/**` block above, which
    // only grants browser globals — but they execute under Node (Vitest), so
    // `process` and friends are legitimately available. Without this, the test
    // setup files fail `no-undef` on `process.env`, which they did on main.
    files: ['src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // JL-406: server tests run under Vitest with globals: true, so `vi`,
    // `describe`, `it` and friends are legitimately available - but the
    // server/** block above grants only Node globals, so they failed no-undef.
    // Same fault JL-377 fixed for src/test/**; this is its server counterpart.
    files: ['server/**/*.test.js', 'server/__tests__/**/*.js', 'server/test/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
])
