# JL-174 — Code Review: Security & Authorization

**Scope:** Security posture of the delivered backend/route work (Express 5 + PostgreSQL).
Focus: authorization on new routes, multi-tenancy/data scoping, config-gated tokens,
SQL/HTML injection, issue-level security (JL-131), secret exposure.
**Method:** read-only static review of `server/` (routes, middleware, services) and the
frontend HTML sinks. Grepped for `requireRole`/`protect`, raw SQL interpolation,
token comparisons, `dangerouslySetInnerHTML`, and traced each candidate to source.
**Reviewer note:** production code was NOT modified. Findings marked with confidence.

All flagged routers are mounted with `...protect = [authGuard, loadUserRoles, resolveWorkspace]`
(server/index.js:164) — i.e. *any authenticated user* reaches them. Whatever gating exists
must therefore live in the route handler itself.

---

## Summary

- **1 High**, **2 Medium-High**, **2 Medium**, **2 Low** findings.
- The auth primitives themselves (`requireRole`, `requireProjectRole`, `canViewIssue`,
  `isSafeUrl`, storage path handling, HMAC signing) are well-built and, where used, correct.
- The problems are **gaps in application**: a handful of write endpoints and issue-read
  paths that skip the gate that peer endpoints apply, plus one insecure default credential.

### Top 3
1. **SCIM API ships with a known default bearer token** → unauthenticated user provisioning/deprovisioning when `SCIM_TOKEN` unset (`config.js:168`, `scim.js:147`).
2. **Asset create/update/delete are ungated** → any Viewer can tamper/delete CMDB records (`assets.js:115,138,198`).
3. **Issue-level security (JL-131) bypassed** by the JQL/search endpoints and attachment read/download (`filters.js:435,471,526`, `attachments.js:29,86`).

---

## Findings (most severe first)

| # | Severity | Confidence | Location | Issue |
|---|----------|-----------|----------|-------|
| 1 | High | High | `server/config.js:168`, `server/routes/scim.js:147` | SCIM shared-token defaults to a hardcoded value; API live with a source-known credential when env unset |
| 2 | Medium-High | High | `server/routes/assets.js:115,138,198` | Asset CRUD writes have no `requireRole` — any authed user (Viewer incl.) can create/edit/delete assets |
| 3 | Medium-High | High | `server/routes/filters.js:435,471,526`; `server/routes/attachments.js:29,86` | JL-131 issue security bypassed in search + attachment read/download paths |
| 4 | Medium | Medium | `server/routes/inboundEmail.js:78-80,100` | Inbound-email webhook fails **open** when token unset; public endpoint creates issues with attacker-controlled `from` |
| 5 | Medium | High | `server/routes/kb.js:200,220,255` | KB article write/publish/delete open to any authed user (Viewer can publish/delete arbitrary content to the public KB) |
| 6 | Low | High | `scim.js:147`, `inboundEmail.js:80`, `gitIntegration.js:274` | Shared secrets compared with `===`/`!==` (non-constant-time) |
| 7 | Low | High | `server/routes/webhooks.js:199,225,232` | Webhook `secret` echoed back in POST/PATCH responses (`SELECT *`) unlike list/GET which exclude it |

---

### 1. SCIM ships with a default bearer token (High)

`server/config.js:168`
```js
export const SCIM_TOKEN = process.env.SCIM_TOKEN || 'dev-scim-token-change-me'
export function isScimConfigured() { return Boolean(SCIM_TOKEN) } // always true
```
`/scim/v2` is mounted unconditionally (`index.js:148`) and every route is guarded only by
`scimAuth` (`scim.js:143-151`), which checks `token !== SCIM_TOKEN`. Because the default is a
non-empty, **publicly-known** string, a deployment that forgets to set `SCIM_TOKEN` exposes the
full SCIM surface — `GET/POST /Users`, `PATCH`/`DELETE` (deprovision) — to anyone who reads the
repo.

**Impact:** unauthenticated (JWT-less) account creation and **deprovisioning** of any user →
account takeover / denial-of-service on identities. This is the most serious finding because it
combines a default credential with a user-lifecycle API mounted outside the JWT tree.

**Fix:** fail **closed** — treat an unset/default `SCIM_TOKEN` as "SCIM disabled" (return 404/501
and reject `scimAuth`), require an explicitly configured strong secret, and add a startup
assertion (like `assertRequiredEnv`) when SCIM is meant to be on.

---

### 2. Asset create / update / delete are ungated (Medium-High)

`server/routes/assets.js` — only `POST /asset-types` (line 53) carries `requireRole('Admin')`.
The asset records themselves are open:
```
115  router.post('/assets', asyncHandler(...))          // no requireRole
138  router.patch('/assets/:id', asyncHandler(...))     // no requireRole
198  router.delete('/assets/:id', asyncHandler(...))    // no requireRole  → DELETE assets WHERE id=?
```
Any authenticated principal, **including a workspace Viewer**, can create, mutate (name, type,
status, owner_email, attributes) or delete any CMDB asset, cascading to `issue_assets`.

**Impact:** integrity/availability loss on the CMDB the ticket explicitly expected to be
Admin-controlled. Deleting an asset silently unlinks it from all incident/issue records.

**Fix:** add `requireRole('Admin')` (or a dedicated manage-assets capability) to the three write
routes, matching the already-gated `asset-types` creation.

---

### 3. Issue-level security (JL-131) bypass (Medium-High)

`canViewIssue` (`services/issueSecurity.js`) is correctly applied in the canonical issue paths —
list (`issues.js:244,250`) and single-get (`issues.js:274`). It is **not** applied in other paths
that read the same rows:

- **Search endpoints** select straight `FROM issues` with no `canViewIssue` filter and do not even
  select `security_level_id`:
  - `POST /api/filters/jql` (`filters.js:471`)
  - `POST /api/filters/search` (`filters.js:526`)
  - `POST /api/filters/ai-search` (`filters.js:435`)
  A non-privileged user can read `title`, `description`, `assignee` etc. of restricted issues, e.g.
  `POST /api/filters/jql {"jql":"project = 3"}`.
- **Attachments** of restricted issues are enumerable and downloadable with no view check:
  - `GET /api/issues/:issueId/attachments` (`attachments.js:29`)
  - `GET /api/attachments/:id/download` (`attachments.js:86`) — fetches by attachment id only (IDOR).

**Impact:** the confidentiality guarantee JL-131 advertises is only enforced on two of several read
surfaces; restricted-issue content and files leak through search and direct attachment fetch.

**Fix:** route restricted-issue reads through a shared helper — include `security_level_id` in the
projection and `.filter(canViewIssue)` the search results; on attachment read, load the parent
issue and enforce `canViewIssue` before streaming.

---

### 4. Inbound-email webhook fails open (Medium)

`server/routes/inboundEmail.js:77-81`
```js
function tokenAllowed(req) {
  if (!INBOUND_EMAIL_TOKEN) return true          // fail OPEN when unset (default '')
  const provided = req.get('x-inbound-token') || req.body?.token
  return String(provided || '') === String(INBOUND_EMAIL_TOKEN)
}
```
`POST /api/inbound-email` (`:100`) is mounted publicly (no JWT, `index.js:144`) and creates
issues/comments using `email.from` as the author. With the token unset (the default) the endpoint is
completely open.

**Impact:** in any environment that forgets `INBOUND_EMAIL_TOKEN`, anyone on the network can inject
issues/comments and spoof the originating address. (Contrast the git webhook, which is also fail-open
but only mutates via signed provider payloads.)

**Fix:** require the token in production (fail closed unless explicitly configured), and use a
constant-time compare (see #6). *Confidence Medium:* fail-open may be an intentional dev convenience,
but for an issue-creating public endpoint it should be opt-out, not opt-in.

---

### 5. KB articles have no author/role authorization (Medium)

`server/routes/kb.js` — categories are correctly Admin-gated (`:63,79,105`), but articles are not:
```
200  router.post('/kb/articles', ...)        // any authed user
220  router.patch('/kb/articles/:id', ...)   // any authed user — incl. status: 'published'
255  router.delete('/kb/articles/:id', ...)  // any authed user — DELETE ... WHERE id=?
```
There is no author-ownership or role check. A Viewer can edit or delete **any** author's article and
flip `status` to `published`. Published articles are served to the public/portal readers
(`GET /kb/public/articles`), so this is a stored-content integrity path.

**Impact:** unauthorized modification/deletion of knowledge content and unauthorized publication of
arbitrary content to public readers.

**Fix:** require Member+ to author, restrict PATCH/DELETE to the author or Admin, and gate the
`published` transition to Admin.

---

### 6. Non-constant-time secret comparisons (Low)

- `scim.js:147` — `token !== SCIM_TOKEN`
- `inboundEmail.js:80` — `String(provided) === String(INBOUND_EMAIL_TOKEN)`
- `gitIntegration.js:274` — `token === secret` (the shared-token branch)

Byte-wise short-circuit `===`/`!==` on secrets is a timing side-channel. The codebase already does
this correctly elsewhere (`validate.js:27`, `totp.js:145`, and the git **HMAC** branch
`gitIntegration.js:284`), so the fix is to reuse `crypto.timingSafeEqual` on equal-length buffers.
Low severity (remote timing recovery is impractical over HTTP), but trivially fixable and
inconsistent with the rest of the codebase.

---

### 7. Webhook secret returned in create/update responses (Low)

`server/routes/webhooks.js` — list (`:80`) and single-get (`:180`) correctly exclude the `secret`
column, but create and update return `SELECT *`:
```
199  const row = await get('SELECT * FROM webhooks WHERE id = ?', [result.lastID]); res.status(201).json(row)
225  res.json(existing)   // existing is SELECT * (secret included)
232  const row = await get('SELECT * FROM webhooks WHERE id = ?', [id]); res.json(row)
```
All webhook routes are Admin-gated, so exposure is to the same privileged actor who set the secret —
hence Low — but the secret still lands in response bodies (and any intermediary/proxy logs),
contradicting the "secrets never returned" convention.

**Fix:** return the same secret-excluded projection used by the GET endpoints.

---

## Areas verified clean

- **Queues** (`queues.js`): writes gated by `canManageQueue` (workspace Admin/Owner **or** project
  Lead/Admin, `:108-116`); `order_by` constrained to the `ORDER_COLUMNS` whitelist before
  interpolation (`:10-17,161,270`); `buildQueueWhere` fully parameterizes statuses/priorities/labels.
- **Cross-project boards** (`crossProjectBoards.js`): owner-scoped list (`:134`), owner-only
  get/patch/delete (`:149,190,244`); requested project ids clamped to the caller's accessible set via
  `accessibleProjectIds` + `loadAllowedProjectIds` (`:40-53,171,268`) so a board can't widen to or
  leak issues from projects the user can't access.
- **List views** (`listViews.js`) & **saved reports** (`reportBuilder.js`): owner-scoped list,
  owner-only PATCH/DELETE (403 otherwise); list-view columns validated against `ALLOWED_COLUMNS`.
- **Filters JQL / NL parser** (`filters.js:8-110,262-422`): despite building SQL by string
  interpolation, every column comes from the `FIELD_MAP`/`ORDER_FIELD_MAP` whitelist (throws on
  unknown field / ORDER BY), and every value is bound via `?` placeholders. No SQL injection.
- **Plugin manifests** (`pluginRegistry.js`): `isSafeUrl` rejects `javascript:`/`data:`/`vbscript:`/
  protocol-relative `//`, enforced at both `validateManifest` and render (`contributionsFor`
  re-checks each url); plugin CRUD is Admin-gated (`plugins.js:72,89,132`).
- **Attachment storage** (`services/storage.js`): `LocalStorage._resolve` uses `path.basename`, and
  every route caller also `path.basename`s the stored key (`attachments.js:91,106,120,122`) — no path
  traversal; download `Content-Disposition` strips quotes; uploads pass a virus scan first.
- **Git webhook HMAC** (`gitIntegration.js:277-287`): `crypto.timingSafeEqual` with a length guard;
  fail-open only when `GIT_WEBHOOK_SECRET` is unset (documented dev behavior).
- **XSS sinks**: `IssueDetailPage` renders description via `sanitizeHtml` (JL-91); `RichTextEditor`
  runs `sanitizeHtml` on generated markup; `KnowledgeBasePage.renderMarkdown` HTML-escapes `& < >`
  before formatting and only emits `http(s)` links — no unsanitized sink found beyond the JL-91
  allow-list.
- **Admin-gated config surfaces confirmed correct**: audit log (`router.use(requireRole('Admin'))`),
  security-levels (POST/PUT/DELETE Admin), field-config PUT, screen-schemes, marketplace
  install/uninstall/CRUD, BI export (`/bi/export/*` Admin), advanced-roadmap dependencies & team
  capacity (POST/DELETE Admin), inbound-email **settings** router (Admin), plugins CRUD (Admin).
- **Auth core**: `authGuard` verifies JWT and does a best-effort session-revocation check that fails
  open only on store errors (JL-133, intentional/backward-compatible); IP allowlist is a documented
  no-op when empty; `requireRole`/`requireProjectRole` hierarchy math is correct and Owner/Admin
  bypasses are deliberate.
