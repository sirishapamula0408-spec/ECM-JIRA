# Automated Gates: ESLint & the flaky JL-93 lockout test (JL-172)

This document explains two CI/local-tooling issues that undermined the automated
quality gates, their root causes, and how to verify each is healthy.

---

## 1. ESLint fails locally with `Cannot find module './xhtml'`

### Symptom

Running the lint gate locally blows up before linting a single file:

```
$ npm run lint
Oops! Something went wrong! :(
ESLint: 9.39.3
Error: Cannot find module './xhtml'
Require stack:
- .../node_modules/acorn-jsx/index.js
- .../node_modules/espree/dist/espree.cjs
- .../node_modules/eslint/lib/languages/js/index.js
  ...
```

### Root cause

The failure is **not** a code or config problem — it is a **corrupt `acorn-jsx`
install in the local `node_modules`**. `acorn-jsx/index.js` does
`require('./xhtml')`, but the `xhtml.js` file is missing from the installed
package (a partial/incomplete extraction). ESLint's parser (`espree`) depends on
`acorn-jsx`, so ESLint cannot even start.

In this workspace the situation is aggravated because `node_modules` is a
**Windows junction to a shared store** used across the whole worktree pipeline.
The corrupt `acorn-jsx` lives in that shared store, so it cannot be repaired from
inside an individual worktree (and must never be repaired with `npm install`
there — an install mutates the shared store for every worktree).

### The fix that CI relies on (JL-99)

`package.json` pins the package via an `overrides` block:

```json
"overrides": {
  "acorn-jsx": "5.3.2"
}
```

A **clean install from the lockfile (`npm ci`)** honors this override and fetches
a *complete* `acorn-jsx@5.3.2` (including `xhtml.js`), which resolves the error.
This is exactly what CI does, which is why the lint step works in CI even though
it fails against a corrupt local store. `npm ci` deletes `node_modules` and
reinstalls deterministically from `package-lock.json`, so it cannot inherit the
partial extraction that a plain `npm install` (or a shared junction) can leave
behind.

### How to verify locally

In a **normal clone** (not a shared-junction worktree), from the repo root:

```bash
npm ci          # clean, lockfile-driven install; honors the acorn-jsx override
npm run lint    # eslint . — should now run to completion
```

> ⚠️ Do **not** run `npm install` / `npm ci` inside a pipeline worktree whose
> `node_modules` is a junction to the shared store — it corrupts the store for
> every other worktree. Verify ESLint in a standalone clone instead, or rely on
> the CI lint job.

### CI status

`.github/workflows/ci.yml` has a dedicated **`lint` job** that runs:

```yaml
- run: npm ci
- run: npm run lint
```

So `npm run lint` **is** wired into CI. The job is currently marked
`continue-on-error: true`, i.e. it **surfaces** lint problems but does **not
block** the pipeline.

**Can it be made blocking now?** Yes — the prerequisite is in place. With the
`acorn-jsx` override committed (JL-99) and CI using `npm ci`, the parser-load
crash no longer occurs in CI, so the lint job now reflects *real* lint results
rather than a tooling failure. The remaining step before flipping
`continue-on-error: true` → removing it (making lint blocking) is a single green
CI lint run confirming the codebase is actually clean under the current ruleset.
Once a CI run shows `npm run lint` passing, delete the `continue-on-error: true`
line from the `lint` job to restore lint as a hard gate. It is intentionally
left non-blocking here because it cannot be verified from a shared-junction
worktree (ESLint can't run locally), and flipping it blind risks breaking CI on
a pre-existing violation unrelated to this ticket.

---

## 2. Flaky JL-93 login-lockout integration test

### Symptom

`server/__tests__/security-middleware-JL93.test.js` → the test
*"429s once the identity is locked out after repeated bad passwords"* passes in
isolation but could fail intermittently under the **full parallel backend
suite** (`npx vitest run server/__tests__`).

### Root cause

Two coupled factors:

1. **Shared mutable singleton.** The login route
   (`server/routes/auth.js`) used the process-wide `loginLockout` singleton from
   `server/middleware/loginLockout.js` directly. That singleton holds in-memory
   failure counters. Any auth-touching suite that runs in the same worker can
   leave state on it, so the integration test's determinism depended on nothing
   else ever mutating the shared instance — a fragile assumption under parallel
   execution.
2. **Contention-driven duration.** The test performs **6 sequential
   `supertest` round-trips**, each of which spins up a real HTTP server. In
   isolation the whole test takes ~1.3s; under the full 91-file suite, CPU
   contention inflates it to **7–8s** (measured). That is enough headroom over a
   default per-test timeout to make the test time out and fail on a busy CI box.

### The fix (`JL-172`)

Both factors are addressed without weakening the assertion (still: 5 bad logins
→ `401`, 6th → `429` with `Retry-After` and the "too many failed login" error):

- **State isolation via an injection seam.** `server/routes/auth.js` now keeps
  the active lockout tracker in a swappable module-level variable and exports
  `setLoginLockout(instance)` (call with no args to restore the shared default).
  Production always uses the default singleton. The JL-93 integration test's
  `beforeEach` injects a **fresh `createLoginLockout()` instance** (same default
  config — 5 attempts) and `afterEach` restores the default. The route now
  counts failures against a `Map` no other suite can see, so cross-suite state
  leakage cannot affect it.
- **Timeout headroom.** The slow supertest test is given an explicit `30000`ms
  timeout so parallel-suite CPU contention can no longer turn its 7–8s runtime
  into a spurious timeout failure.

### How to verify

```bash
# Isolated — 15/15:
npx vitest run server/__tests__/security-middleware-JL93.test.js

# Full suite — the lockout test must pass consistently (run a few times):
npx vitest run server/__tests__
```

Verified for JL-172: 3 consecutive full-suite runs all green (1293/1293), with
the lockout test passing every time (measured 7.1s / 7.3s / 8.3s — all now
comfortably inside the 30s budget).
