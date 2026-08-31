// Client (jsdom) test setup. The environment-only half lives in setup.env.js so
// the server project can share it without pulling in DOM-dependent imports.
import { configure } from '@testing-library/dom'
import './setup.env.js'
import '@testing-library/jest-dom'

// JL-400 — align Testing Library's async budget with Vitest's.
//
// The WorkflowEditor* suites failed nondeterministically under load, always on
// an `await screen.findByRole(...)` that timed out rather than asserting a
// wrong value. The cause is a mismatch between two independent timeouts:
//
//   vite.config.js  testTimeout        20000ms   (raised by JL-377)
//   @testing-library asyncUtilTimeout   1000ms   (library default, never set)
//
// `testTimeout` does NOT govern `findBy*`/`waitFor` — those carry their own
// budget. So JL-377 raised the test budget 4x to absorb scheduling delay under
// a loaded fork pool, but every async QUERY inside those tests kept a 1s budget
// that the raise never reached. The suites' mocks resolve immediately in
// wall-clock terms; what expires is the worker's turn on the CPU, and 1s of
// descheduling is entirely reachable with `maxWorkers: 8` when several of the
// heaviest suites are co-scheduled. That is why the 8 WorkflowEditor suites run
// ALONE reproduce it worse (15 failures) than the full 3903-test suite does
// (3): running only those 8 guarantees all 8 heavy mounts are concurrent,
// whereas the full run interleaves them with cheap suites.
//
// This is not "raise the timeout until it goes green" — 1000ms was never a
// deliberate statement about this app, it is a default that predates the
// testTimeout raise, and leaving the two disagreeing is the actual defect.
// 5000ms keeps a failed query reporting as a useful "unable to find element"
// well inside the 20s test budget, rather than as a blunt test timeout.
configure({ asyncUtilTimeout: 5000 })
