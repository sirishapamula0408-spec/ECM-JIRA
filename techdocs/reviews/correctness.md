# JL-173 — Code Review: Correctness & Error-Handling

**Scope:** the 19 newest backend route/service files delivered in `integration/JL-batch-1`
(assets, kb, sessions, ipAllowlist middleware, marketplace, inboundEmail, events, portal,
dashboardGadgets, auditLog, securityPolicy, queues, incidents, gitIntegration webhook,
reportBuilder, crossProjectBoards, advancedRoadmap, plugins, biExport, securityLevels,
issueSecurity) plus the hand-repaired hub files (`server/db.js` migration tail,
`server/index.js` mounts, `server/routes/auth.js` login flow).

**Method:** read each file end-to-end, traced SQL/params, checked guard/await/response-once
discipline, and reasoned about edge cases and multi-tenant scoping. Only findings with a
concrete failure scenario are listed. Base commit reviewed: `2e92bc4`.

**Verdict:** the combined auth login flow (JL-133 session + JL-132 audit + JL-134 MFA nudge)
is **correct** — every best-effort block is genuinely non-blocking. No High-severity
correctness defects found. Two Medium feature-breaking bugs and a cluster of Medium/Low
scoping + edge-case issues are documented below.

---

## Findings (most severe first)

| # | Severity | Confidence | File:Line | Summary |
|---|----------|-----------|-----------|---------|
| 1 | Medium | High | `server/services/auditLog.js` + `server/routes/auditLog.js:94-103` | Audit-log retention purge permanently breaks hash-chain `/verify` |
| 2 | Medium | High | `server/routes/gitIntegration.js:278-285` | Webhook HMAC recomputed over re-serialized body → real signed webhooks always 401 |
| 3 | Medium | Med-High | `server/routes/reportBuilder.js:212-255` | `/report-builder/run` has no workspace/project scoping — cross-tenant aggregate + project-name leak |
| 4 | Low-Med | High | `server/routes/dashboardGadgets.js:191-198` | `recent_activity` gadget queries `activity` globally (unscoped) while every other gadget scopes by workspace |
| 5 | Low | High | `server/routes/queues.js:294` | Queue SLA uses `created_at` as the resolution time for Done issues → always 0h elapsed / "ok" |
| 6 | Low | High (mech.) | `server/services/auditLog.js:129-141` | `appendAudit` read-then-insert of `seq` races the `UNIQUE(seq)` index → silent audit-entry loss under concurrency |
| 7 | Low | Med | `server/routes/inboundEmail.js:222` + `226` | `default_issue_type` stored without validation → later inbound emails 500 on the `issue_type` CHECK |
| 8 | Low | High | `server/routes/kb.js:90,231`; `server/routes/incidents.js:151` | `.trim()` on optional PATCH fields assumed to be strings → 500 (not 400) when a non-string is sent |

---

### 1. Audit-log retention purge permanently breaks `/verify` — Medium

`verifyChain()` (`auditLog.js:82-106`) starts `prevHash = GENESIS_HASH` and requires the
first entry's stored `prev_hash` to equal GENESIS. `POST /api/audit-log/retention`
(`routes/auditLog.js:94-103`) hard-`DELETE`s rows older than the window. After any purge,
the earliest *remaining* entry's `prev_hash` still points at the (now-deleted) previous
entry's hash, which no longer equals GENESIS.

**Scenario:** append 5 audit entries (seq 1..5). Admin calls `POST /audit-log/retention`
with a window that removes seq 1-2. `GET /audit-log/verify` now returns
`{ ok:false, brokenAt: 3 }` forever — the tamper-evidence feature reports corruption on a
legitimate, admin-initiated purge, so genuine tampering can no longer be distinguished.

**Fix:** on purge, re-anchor the chain — after deleting, recompute/re-store the new first
entry as if its `prev_hash` were GENESIS (or keep a "chain checkpoint" the verifier seeds
from), or make `/verify` accept the oldest surviving `prev_hash` as its starting anchor.

### 2. Webhook HMAC verified against a re-serialized body — Medium

`verifyWebhookSecret()` computes
`'sha256=' + hmac(secret, JSON.stringify(req.body || {}))` and `timingSafeEqual`s it against
`X-Hub-Signature-256`. Providers (GitHub is the canonical one) sign the **raw request
bytes**. By this point `express.json()` has parsed and discarded the raw body; re-stringifying
the parsed object differs in key order, whitespace, and unicode escaping, so the digest never
matches.

**Scenario:** deployment sets `GIT_WEBHOOK_SECRET` and configures GitHub with the standard
signature (no `X-Webhook-Token`). Every `POST /api/git/webhook` is rejected `401`. The feature
only works via the shared-token fallback header.

**Fix:** capture the raw body for this route (`express.json({ verify })` stashing
`req.rawBody`, or a `express.raw()` sub-mount) and HMAC over the raw bytes. Confidence high;
the token path masks it in tests, which is why it slipped through.

### 3. `report-builder/run` ignores workspace/project scope — Medium

`loadIssues()` builds its `WHERE` purely from caller-supplied filters and selects across the
entire `issues` table (joined to `projects`). `req.workspaceId` (set by `resolveWorkspace` in
`protect`) is never consulted. The sibling BI export (`biExport.js:219-231`) deliberately
scopes to `p.workspace_id`, so this is an inconsistency, not an intended global report.

**Scenario:** a Viewer/Member in workspace A `POST`s `{ dimension:'project', measure:'count' }`
and receives grouped counts + **project names** for every project in every workspace,
including tenants they cannot otherwise see.

**Fix:** add the same `project_id IN (SELECT id FROM projects WHERE workspace_id = ?)`
(with the NULL-workspace allowance) that `biExport`/`dashboardGadgets` use, before applying
user filters.

### 4. `recent_activity` gadget is unscoped — Low-Med

In `runGadgetQuery`, the `issue_count` / breakdown / `filter_results` branches all call
`buildIssueScope(req, config)` (which scopes to `req.workspaceId`). The `recent_activity`
branch (`dashboardGadgets.js:191-198`) runs
`SELECT ... FROM activity ORDER BY id DESC LIMIT ?` with **no scope**, returning global
cross-tenant activity (actor + action) to any authenticated user.

**Fix:** join/filter activity by `project_id IN (workspace projects)` (the `activity` table
has `project_id`), mirroring the other branches.

### 5. Queue SLA elapsed time is 0 for Done issues — Low

`routes/queues.js:294`:
`const endMs = issue.status === 'Done' ? new Date(issue.created_at).getTime() : now`.
Using `created_at` as the "end" makes `elapsedHoursBetween(created_at, created_at) === 0`, so
every resolved issue reports `elapsedHours: 0`, `percent: 0`, `status: ok/met` regardless of
how long it actually took — the policy-based SLA annotation is meaningless for exactly the
issues whose SLA outcome is final.

**Fix:** use a resolution timestamp (e.g. `resolved_at`/`updated_at` at the time it went Done)
for the end bound, not `created_at`.

### 6. `appendAudit` seq race → silent entry loss — Low (high mechanism, low frequency)

`appendAudit` does `SELECT max seq` then `INSERT seq+1`. `idx_audit_log_seq` is `UNIQUE`
(`db.js:1656`). Two concurrent audit writes (e.g. two simultaneous logins) read the same
`last.seq`, both try `seq = N+1`; the second `INSERT` throws a unique violation which
`safeAppendAudit` swallows — one audit event is silently dropped.

**Fix:** allocate `seq` atomically (a sequence / `INSERT ... SELECT COALESCE(MAX(seq),0)+1`
in one statement with a retry, or serialize appends). Acceptable for now since audit is
best-effort, but worth a note for a tamper-evidence feature.

### 7. `inbound-email` default_issue_type not validated — Low

`settingsRouter POST /settings` accepts any `defaultIssueType` string (`inboundEmail.js:222`)
and stores it. The webhook create path inserts it straight into `issues.issue_type`
(`:170-171`), which is CHECK-constrained. An admin who sets e.g. `"Feature"` makes every
subsequent inbound email to that mailbox fail with a 500 on insert.

**Fix:** validate `defaultIssueType` against the allowed issue-type set on write.

### 8. `.trim()` on optional non-string PATCH fields → 500 — Low (pervasive)

`kb.js:90` (`name.trim()`), `kb.js:231` (`title.trim()`), `incidents.js:151` (`title` passed
raw is fine, but several PATCH bodies assume strings). When a client sends e.g.
`{ "name": 123 }` on a category/article PATCH, `name.trim()` throws `TypeError`, surfaced by
`asyncHandler` as a generic 500 instead of a 400. Create paths guard with `?.trim()`; the
PATCH paths don't.

**Fix:** coerce with `String(x)` or type-check before `.trim()` in the update handlers.

---

## No-issue areas reviewed (verified correct)

- **`auth.js` login flow (the JL-133 + JL-132 + JL-134 combination).** Order is: lockout gate →
  credential check → MFA gate → `loginLockout.reset` → best-effort session insert (try/catch,
  swallowed; `jti` still minted) → `issueToken` with `jti` → fire-and-forget `safeAppendAudit`
  (swallows internally) → best-effort `getSecurityPolicy` MFA-nudge (try/catch). Every
  post-auth block is genuinely non-blocking; no path can fail the login, and no response is
  sent twice. `authGuard` fails **open** on the session lookup so a dropped session row never
  locks a valid token out. Correct.
- **`crossProjectBoards.js`.** Ownership enforced on every read/write; requested project ids are
  intersected with `loadAllowedProjectIds` via the pure `accessibleProjectIds`, so a board can
  never widen to or leak issues from inaccessible projects. Route ordering (`/`, `/:id`,
  `/:id/issues`) is unambiguous.
- **`biExport.js`.** Admin-gated, workspace-scoped issue fact export (with NULL-workspace
  allowance), pagination clamped (`limit` 1..50000, `offset >= 0`), dimension name whitelisted.
- **`securityLevels.js` / `issueSecurity.js`.** `DELETE` resets referencing issues to NULL
  before dropping the level (no dangling FK / invisible issues); `canViewIssue` treats a
  null level as public (backward compatible) and gates the rest to Owner/Admin/assignee/reporter.
- **`advancedRoadmap.js`.** Pure scheduling helpers (dependency-violation / capacity / Kahn
  topo-sort) are sound; `accessibleProjects` scopes to workspace; requested ids are intersected
  with accessible ids; self-dependency and duplicate (`ON CONFLICT`) guarded.
- **`assets.js`, `marketplace.js`, `plugins.js`, `sessions.js`, `securityPolicy.js`,
  `incidents.js`, `portal.js`.** Guards, 400/404s, param coercion, `RETURNING`-aware inserts,
  and `withTransaction` (portal issue+portal_request) are correct. Composite-PK inserts
  (`issue_assets`) correctly add explicit `RETURNING` so the `run()` wrapper doesn't inject
  `RETURNING id`.
- **`db.js` migration tail.** Fully idempotent — `CREATE TABLE IF NOT EXISTS`, `columnExists`
  guards for `ALTER`, `INSERT ... ON CONFLICT DO NOTHING` singleton seed, `CREATE INDEX IF NOT
  EXISTS`. `issues.project_id` is nullable, so the inbound-email null-project path inserts
  cleanly. Re-runs are safe.
- **`index.js` mounts.** Public routers (`/api/inbound-email` webhook, `gitWebhookRouter`,
  `/api/public`, `/scim`) are mounted before the `protect` block; the Admin-only inbound-email
  settings router is remounted under `protect` at the same base path and only matches
  `/settings`, so it never shadows the public `POST /`. Ordering is correct.
