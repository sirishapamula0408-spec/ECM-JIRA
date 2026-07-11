// Shared db-mock helper for backend route/middleware unit suites (JL-178).
//
// Consolidates the boilerplate that dozens of `server/__tests__/*.js` suites
// hand-rolled inside `vi.mock('../db.js', () => ({ ... }))`. Each of those
// stubbed `run`/`all`/`get`/`columnExists`/`tableExists` and a `withTransaction`
// that invokes the callback with the same `{ run, all, get }` stubs — but the
// copies drifted (some omitted `withTransaction`, some passed throwaway stubs),
// which caused the failures seen at integration.
//
// This module is intentionally NOT a test file: it lives under
// `server/__tests__/helpers/` with a plain `.js` name, so it does not match
// vitest's default include glob (`**/*.{test,spec}.*`) and is never collected
// or run as a suite.
//
// Usage — safe inside a hoisted `vi.mock` factory because `makeDbMock` is
// self-contained (it calls the global `vi.fn()` itself, referencing no
// out-of-scope variables):
//
//   import { makeDbMock } from './helpers/mockDb.js'
//   vi.mock('../db.js', () => makeDbMock())
//   import { run, all, get } from '../db.js'
//
// `vi` is available as a global (vitest `globals: true`).

/**
 * Build the standard mocked surface of `server/db.js`.
 *
 * Returns `{ run, all, get, columnExists, tableExists, withTransaction }` where
 * `run`/`all`/`get` are `vi.fn()` stubs that the caller can assert on, and
 * `withTransaction` invokes its callback with the *same* `{ run, all, get }`
 * stubs so that writes performed inside a transaction are still visible to
 * those assertions.
 *
 * @param {Record<string, unknown>} [overrides] - keys to override on the
 *   returned object (e.g. a custom `get` implementation, or extra exports).
 * @returns {{run: Function, all: Function, get: Function, columnExists: Function, tableExists: Function, withTransaction: Function}}
 */
export function makeDbMock(overrides = {}) {
  const run = vi.fn()
  const all = vi.fn()
  const get = vi.fn()
  return {
    run,
    all,
    get,
    columnExists: vi.fn(),
    tableExists: vi.fn(),
    // Run the callback with the same mocked helpers so run/all/get assertions
    // still observe writes performed inside a transaction.
    withTransaction: vi.fn(async (fn) => fn({ run, all, get })),
    ...overrides,
  }
}
