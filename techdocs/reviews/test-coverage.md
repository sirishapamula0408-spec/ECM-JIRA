# JL-176 — Code Review: Test Coverage & Quality

**Scope:** the ~30 newest backend suites (`server/__tests__/*JL-128 … JL-166`) and their routes/services, plus a frontend component-test cross-check for the new pages. Read-only review — no production code changed.

**Reviewer:** Claude Opus 4.8 · **Date:** 2026-07-11 · **Branch:** `feature/JL-176-review-test-coverage`

---

## 1. Summary

The recent delivery is **broad but shallow-in-places**. Almost every feature ships a suite, and the *pure helpers* (validators, aggregation math, CSV/NDJSON, slug/UA/time-in-status calculators, dependency-graph/cycle detection) are genuinely well covered — those are the best part of the suite. The systematic weaknesses are:

1. **Mock-only backend testing.** Of the ~30 suites reviewed, **all but two** (`realtime-JL136`, `storage-JL137`, which are pure-unit + real-fs) use `vi.mock('../db.js')`. **None of the new feature suites use the real-Postgres `createTestDb()` integration harness** that older suites (`collaboration-*`, `theme1-core-pm`) use. Consequence: SQL strings and bound params are asserted, but nothing validates real DB semantics — `::jsonb` casts, `convertPlaceholders()`, `RETURNING id` injection, `ON CONFLICT` behavior, `ILIKE`, `IS NOT DISTINCT FROM` workspace scoping, and `withTransaction` atomicity can all regress silently. A column typo or a bad cast passes every one of these tests.
2. **PATCH / update handlers are the least-tested endpoint class.** `PATCH /queues/:id`, `PATCH /report-builder/reports/:id` (success path), `PATCH /assets/:id` (guards), `PATCH /incidents/:id` (severity/status timeline), `PATCH /kb/*` — all missing key branches or entirely untested.
3. **RBAC-negative paths are stubbed away.** Fake auth middleware injects an Admin/Owner in most suites, so `requireRole('Admin')` / `requireProjectRole` **403 rejections are rarely exercised** (notably BI-export, several DELETE endpoints).
4. **Whole handlers with zero tests** in the ITSM/integration batch (git `/git/ingest`, all inbound-email settings CRUD, git-links CRUD, several oncall endpoints).
5. **Frontend: 12 new pages, zero component tests.**
6. **One known-flaky order-dependent suite** (`security-middleware-JL93`) confirmed with a concrete root cause (§5).

### Coverage tally (30 backend features)

| Rating | Count | Features |
|--------|-------|----------|
| **Full / strong** | 7 | Issue-Security JL-131, IP-Sessions JL-133, Dependency-Viz JL-128, Time-in-Status JL-155, Clone-Issue JL-158, Favorites JL-159, Event-Replay JL-150 |
| **Partial** (core happy paths tested, notable branch/endpoint gaps) | 17 | SSO JL-129, SCIM JL-130, Audit-Log JL-132, Security-Policy JL-134, Portal JL-140, Queues JL-141, Assets JL-142, KB JL-144, Plugins JL-145, Marketplace JL-146, Realtime JL-136, Storage JL-137, Report-Builder JL-151, Dashboard-Gadgets JL-152, Portfolio JL-154, BI-Export JL-156, Comments-cluster JL-139/160/166 |
| **Thin / weak** (majority of handlers untested) | 3 | Incidents JL-143, Deep-Git JL-147, Inbound-Email JL-148 |
| **Flaky / order-dependent** | 1 | Security-Middleware JL-93 |
| **Frontend pages with a component test** | 0 / 12 | (see §4) |

---

## 2. Coverage matrix (backend)

`H = endpoints/handlers` · `T = tested` · Style: `mock` = `vi.mock(db)`, `unit` = pure-unit, `fs` = real filesystem.

| Feature (suite) | Style | H | T | Key gaps | Rating |
|---|---|---|---|---|---|
| Dependency-Viz JL-128 | mock+unit | 3 | 3 | 3-node cycle; null-key fallback (Low) | Full |
| SSO JL-129 | mock+unit | 6 | ~2 real | **All 5 SSO routes' configured happy-path** untested; only 501 asserted; OIDC/SAML callback 400 guards untested (High) | Partial |
| SCIM JL-130 | mock | 12 | 7 | **PUT /Users/:id, GET/PATCH/PUT/DELETE /Groups/:id** untested; PATCH /Groups member add/remove/replace (High); `setGroupMembers` never asserted | Partial |
| Issue-Security JL-131 | mock | 4+1 | 4+1 | `canViewIssue(null user)`, invalid-FK 400 on security-level (Med) | Full |
| Audit-Log JL-132 | mock | 4+5 | 8 | `safeAppendAudit` swallow path; retention `<=0` 400; limit-clamp/date filters; `csvEscape` of commas/quotes (Med) | Partial |
| IP-Sessions JL-133 | mock | 3+1 | 3+1 | UA Edge/iOS/Android branches; DELETE NaN-id 400 (Low) | Full |
| Security-Policy JL-134 | mock+unit | 2+4 | 6 | **Password-change enforcement & forced-MFA login policy untested** (High); missing-row defaults; expired-invalid-date (Med) | Partial |
| Realtime JL-136 | unit | ~10 | ~7 | `createRealtimeServer` (JWT auth/4401/join/leave wiring); `sendToSocket` (readyState skip + throw-swallow) (Med) | Partial |
| Storage JL-137 | unit+fs | ~14 | ~10 | `LocalStorage.url`/`S3Storage.url`; `streamToBuffer` non-Buffer branches; cached `getStorage()`/`_resetStorage` (Med) | Partial |
| Comments JL-139/160/166 | mock+unit | 5 | 4 | POST-create **mention/watcher-notify/auto-watch side-effects & empty-text 400** untested (author-resolution itself is covered by older `comment-author-JL99`); email→member-name display branch (Med). JL-166 tests `mentions.js` only, never imports `comments.js` | Partial |
| Portal JL-140 | mock | 7 | 3 | GET request-types (2 variants), **public catalog**, DELETE (Admin) untested; POST 400 guards (High) | Partial |
| Queues JL-141 | mock | 6 | 4 | **`PATCH /queues/:id` entirely untested** (404/403/400/COALESCE/orderBy whitelist); GET /:id 404; due-date fallback SLA branch (High) | Partial |
| Assets JL-142 | mock | 10 | 9 | GET /:id (404); PATCH guards (404/empty-name/unknown-type); DELETE has no existence check in handler (Med) | Partial |
| Incidents JL-143 | mock | 12 | 4 | **8 handlers untested**: timeline POST, all oncall schedule/shift CRUD; PATCH severity/status timeline branches (Med) | Thin |
| KB JL-144 | mock | 11 | 6 | **`uniqueSlug` collision loop never executed**; category PATCH/DELETE; article GET/:id/DELETE; public `?search`/`?category` (Med-High) | Partial |
| Plugins JL-145 | mock+unit | 11 | 8 | GET /:id (404), GET /extension-points handler; `validateManifest` guard branches; PATCH re-validation 400 (Med) | Partial |
| Marketplace JL-146 | mock+unit | 9 | 7 | GET /apps/:key, **DELETE /apps/:id** (204/404/Admin) untested; install params + `IS NOT DISTINCT FROM` not asserted (Med) | Partial |
| Deep-Git JL-147 | mock+unit | 11 | ~5 | **`POST /git/ingest` (real DB mutations), all git-links CRUD** zero tests; HMAC `verifyWebhookSecret`; `merge_request`/`unknown` events (High) | Thin |
| Inbound-Email JL-148 | mock+unit | 6 | 3 | **Entire settings CRUD (GET/POST/DELETE) untested**; webhook empty subject+body 400; unknown-key fall-through; null-project COUNT key alloc (Med-High) | Thin |
| Event-Replay JL-150 | mock+unit | ~7 | ~6 | `emitEvent` error-swallow; `?status=success` deliveries branch (Low) | Full |
| Report-Builder JL-151 | mock+unit | 7 | 6 | **PATCH success path** (UPDATE builder + `::jsonb`); `computeReport` priority/issue_type/project dims; label dim via endpoint (High/Med) | Partial |
| Dashboard-Gadgets JL-152 | mock+unit | 5+ | 3 | **`filter_results` & `recent_activity` gadgets** + `clampLimit`/`buildIssueScope` (projectId/workspace) untested (High/Med) | Partial |
| Portfolio JL-154 | mock+unit | 3 | ~2 | `member=null` lead-email branch; `!userEmail` empty-summary early return (Med) | Partial |
| Time-in-Status JL-155 | mock+unit | 7 | 7 | negative-span cycle; unparseable-ts drop; extra-status ordering (Low) | Full |
| BI-Export JL-156 | mock+unit | 8 | 6 | **Admin-gate 403 on all 3 routes**; `format=ndjson` route branch; workspace scoping; limit/offset clamp (High/Med) | Partial |
| Clone-Issue JL-158 | mock | 1 | 1 | label-copy try/catch swallow; project-without-key fallback; reporter fallback chain (Med/Low) | Full |
| Favorites JL-159 | mock | 3 | 3 | invalid `:id` validation only (Low) | Full |

---

## 3. Ranked list of the most important missing tests

Ranked by **risk of silent regression × blast radius**.

1. **`POST /api/git/ingest` (Deep-Git JL-147) — HIGH.** Zero tests on a handler that writes git-links, inserts comments (`smart.comment`), and *transitions issue status* (`smart.transition`) straight into the DB. A regression here silently corrupts issue state from commit messages. Add: ingest with keys links existing issues + applies comment/transition; no-keys → 200 early-return; non-existent key skipped.
2. **BI-Export Admin gate (JL-156) — HIGH.** All three export routes are `requireRole('Admin')` but every test injects an Admin, so a broken gate would leak the entire issue/dimension dataset to any authenticated user with no test failing. Add: non-Admin caller → 403 on `/bi/export/issues` and `/bi/dimensions/:name`. (Same pattern: add one 403-negative test per Admin/Lead-gated DELETE across Portal/Incidents/Marketplace.)
3. **Security-Policy enforcement (JL-134) — HIGH.** `validatePassword`/`isPasswordExpired`/`require_mfa` are defined and unit-tested, but their *enforcement* on the profile password-change route and the forced-MFA-at-login path is untested — the policy could be silently ignored where it matters. Add: password-change route rejects a policy-violating password (400 + errors); login honors org `require_mfa`.
4. **Inbound-Email settings CRUD (JL-148) — HIGH.** The whole Admin `settingsRouter` (GET/POST/DELETE, incl. projectId-not-found and mailbox-required validation) has zero tests, and the webhook's "unknown issue-key → create new issue" fall-through and null-project key allocation are untested. Add the settings validation matrix + the webhook fall-through test.
5. **`PATCH /queues/:id` (JL-141) — HIGH.** The most complex mutating handler in the ITSM batch (404/403-canManageQueue/400-empty-name/orderBy-whitelist/COALESCE partial update) has no coverage at all. Add a PATCH suite covering each guard + a partial-field update asserting COALESCE semantics.

**Runners-up (Med, worth batching in):** `PATCH /report-builder/reports/:id` success path (`::jsonb` update); SCIM `PATCH /Groups/:id` member add/remove/replace; `uniqueSlug` collision loop in KB; Dashboard-gadgets `filter_results`/`recent_activity`; SSO OIDC/SAML callback 400 guards with the provider libs mocked; comment-create mention/watcher-notify side-effects.

---

## 4. Frontend — new pages with NO component test

The frontend test dir (`src/test/`) covers older/collaboration surfaces (`collaboration-pages`, `LoginPage`, `DashboardPage.reflow`, `BoardPage.swimlanes`, etc.) but **none of the 12 pages shipped by the recent backend features have any component test**:

`AssetsPage`, `KnowledgeBasePage`, `PortalPage`, `QueuesPage`, `IncidentsPage`, `MarketplacePage`, `PluginsPage`, `BiExportPage`, `ReportBuilderPage`, `PortfolioPage`, `AuditLogPage`, `InboundEmailPage` — **0 tests each** (verified by grep against `src/test/`).

Recommended minimum: a render + primary-interaction smoke test per page (renders without crashing given a mocked API, shows the empty state, and gates create/edit controls via `usePermissions` for a Viewer). `ReportBuilderPage` and `QueuesPage` (filter builders) and `AssetsPage`/`IncidentsPage` (create/edit forms) carry the most UI logic and should be prioritized.

---

## 5. Flaky / order-dependent suites

### `security-middleware-JL93` — confirmed flaky, root cause identified

Parts 1–3 of the suite build **fresh** middleware via `rateLimit()` / `createLoginLockout()` / `corsAllowList()` with an **injected clock** — deterministic. The flake lives in **part 4, "POST /api/auth/login lockout gate"**, which drives the real login route and mutates the **process-wide module-level singleton `loginLockout`** (`server/middleware/loginLockout.js:103`, consumed by `server/routes/auth.js`). Three coupled problems make it order-dependent:

- **No teardown reset.** The test only calls `loginLockout.clear()` in `beforeEach` — there is **no `afterEach`/`afterAll`**. The singleton runs on the **real wall clock** (`Date.now`, not injected) with a **15-minute window**, so after the test the key stays *locked for 15 real minutes*; a re-run or a sibling suite sharing the module registry inherits the locked state and the clock can't be advanced to clear it.
- **Threshold frozen at import.** `maxAttempts` is read from `process.env.LOGIN_LOCKOUT_MAX_ATTEMPTS` **at import time** (`loginLockout.js:104`), while the test hard-codes "5 failures then 429". Whichever suite imports the module first fixes that value — an env override or import-order change silently breaks the count.
- **`req.ip` key instability.** `lockoutKey` embeds `req.ip`; under supertest the loopback family (`127.0.0.1` vs `::ffff:127.0.0.1` vs `::1`) is environment-dependent, so the recorded failures and the final check can land on different keys → 401 instead of the expected 429.

**Fix:** make the login route accept an injectable/resettable lockout instance (or add `afterEach(() => loginLockout.clear())` **and** pin `maxAttempts` for the test), and stub `req.ip` deterministically.

**Other order-dependence watch-items:** any suite that mutates module-level singletons without `afterEach` reset is at the same risk. `storage-JL137` uses a cached `getStorage()` singleton and *does* expose `_resetStorage()` — but the reset itself is never called in a test, so confirm each `storage` test passes an explicit config (it currently does). The pure-unit suites (`realtime`, most helpers) are isolated and safe.

---

## 6. Method note

For each feature the route/service handlers were enumerated and diffed against the suite's test cases (handler-by-handler), classifying each gap by silent-regression risk. Two top findings were independently re-verified by grep: `git/ingest` has 0 references in its suite; comment-create author-resolution is in fact covered by the older `comment-author-JL99` (so that finding was down-graded to "side-effects only"). No production code was modified.
