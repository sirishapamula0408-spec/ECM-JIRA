# Functional test suite (JL-157)

End-to-end functional tests for the whole application, driven through the real
API and the real UI (Playwright + headless Chromium). This is the
production-readiness gate: run it before every release.

## Run

```bash
npm run build        # the suite serves /dist, so rebuild after frontend changes
npm run test:e2e     # everything (API + UI)

npx playwright test --project=api                 # API layer only
npx playwright test e2e/ui/issues.spec.mjs        # one file
npx playwright show-report e2e/results/html       # open the last HTML report
```

One-time machine setup: `npx playwright install chromium --only-shell`, and a
PostgreSQL database owned by `jira_lite` named `jira_lite_e2e`:

```bash
PGPASSWORD=… psql -U postgres -h localhost -c "CREATE DATABASE jira_lite_e2e OWNER jira_lite"
```

## What a run does

1. `e2e/support/start-server.mjs` **drops and recreates** the `jira_lite_e2e`
   schema (it refuses any database whose name does not end in `_e2e`), then
   starts `server/index.js` on port **4100** serving the production build.
   Starting from empty every time is deliberate: it is how JL-158 (a fresh
   install could not boot) was found, and it keeps it found.
2. `e2e/support/global-setup.mjs` seeds four accounts — owner, admin, member,
   viewer (`@e2e.example.com`) — and saves a signed-in browser session for each
   under `e2e/.auth/` (gitignored: they hold live tokens).
3. Specs run with one worker.

If a server is already listening on 4100 it is reused and **not** reset; set
`E2E_RESET=0` when starting it by hand to keep data between runs.

## Safety

- Never runs against the dev database (`jira_lite`) or any deployed instance.
- SMTP is blanked for the server under test (`e2e/support/env.mjs`), so invites
  and notifications send nothing; test addresses use the reserved
  `example.com` domain regardless.
- Rate limits are raised for the test server only.

## Layout

| Path | What |
|---|---|
| `e2e/api/*.spec.mjs` | Business rules and RBAC through the HTTP API |
| `e2e/ui/*.spec.mjs` | User journeys in the browser, plus a smoke check of every route |
| `e2e/support/` | Server start-up, seeding, shared API helpers |
| `e2e/catalogue/` | Test-case catalogue: one row per test, with its result |

## Known defects

A test that fails because the **application** is wrong keeps asserting the
correct behaviour and is marked `test.fail(true, 'DEFECT: …')`. The suite stays
green while the bug is open; when the bug is fixed that test starts "unexpectedly
passing" and fails the run — the signal to remove the marker.
