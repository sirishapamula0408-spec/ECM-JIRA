# JL-175 — Code Review: API Consistency & Data Model / Migrations

**Scope:** REST conventions, SQL placeholder discipline, and the `server/db.js` migration
tail across the full 104-ticket codebase (`integration/JL-batch-1`).
**Method:** read `server/db.js` (all 1,871 lines), grep of every file in `server/routes/`,
targeted reads of representative new + baseline routes.
**Verdict:** The delivered work is **broadly consistent and safe**. Placeholder discipline,
idempotent DDL, and the `run()` composite-PK pitfall are all handled correctly. The real
drift is cosmetic-to-moderate: response-envelope shapes (delete bodies, pagination) diverge,
two FK columns are declared as bare `INTEGER` (no `REFERENCES`), one timestamp column breaks
the `TIMESTAMPTZ` convention, and several FK/filter columns lack indexes.

---

## Consistency Scorecard

| Convention | Status | Notes |
|---|---|---|
| `?` placeholders (no value interpolation) | ✅ Followed | Every route uses `?`; all `${…}` interpolation is whitelisted **column names** or `IN (?,?,…)` placeholder lists, never user values. |
| `run()` explicit `RETURNING` on no-id/composite tables | ✅ Followed | `issue_labels`, `issue_components`, `issue_assets`, `scim_group_members` all add explicit `RETURNING`. Pitfall avoided. |
| Idempotent DDL (`CREATE TABLE IF NOT EXISTS`, guarded `ALTER`) | ✅ Followed | Every new table + column is guarded via `IF NOT EXISTS` / `columnExists()`. |
| Error response shape `{ error }` | ✅ Followed | Near-universal. SCIM uses RFC-7644 error format (correct); `auth.js` `{ message }` is for success info, not errors. |
| `201` on create | ✅ Mostly | Widely and consistently used, incl. sub-resource creates (e.g. incident timeline). |
| CHECK constraints for enum columns | 🟡 Mixed | Consistent where used (severity/category/status enums), but many status-like columns are free `TEXT` validated only at the route layer (documented pattern). |
| JSONB defaults (`'[]'`, `'{}'`, `::jsonb`) | ✅ Followed | Consistent. |
| FK `ON DELETE` action choice | ✅ Mostly sensible | CASCADE for owned children, SET NULL for optional refs (`incidents.issue_id`, `deployments.issue_id`, `epic_id`, `release_id`). Two exceptions below. |
| Timestamp type = `TIMESTAMPTZ` | 🟡 One outlier | `automation_rules.last_run_at` is plain `TIMESTAMP`. |
| Delete success body | 🔴 Drifted | Three idioms: `{ success: true }`, `{ ok: true }`, `204 No Content`. |
| Pagination envelope | 🔴 Drifted | Five shapes across list endpoints (header, `{entries,…}`, `{issues,…}`, cursor, SCIM). |
| FK columns indexed | 🟡 Partial | Most indexed; several filter/cascade FKs are not. |
| Workspace/tenant scoping | 🟡 Gaps | Several post-JL-73 tables are global with no `workspace_id` (isolation was explicitly deferred in JL-73). |

---

## Ranked Findings

| # | Sev | Area | Location | Finding |
|---|-----|------|----------|---------|
| 1 | Medium | Data model | `db.js:1568-1580` | `installed_apps.workspace_id INTEGER` has **no `REFERENCES workspaces(id)`** — every other `workspace_id` column in the schema is a real FK. |
| 2 | Medium | Data model | `db.js:789-798` | `automation_logs.issue_id INTEGER` has **no FK** to `issues(id)`; deleting an issue orphans its logs (compare `notifications.issue_id` FK CASCADE). |
| 3 | Low-Med | REST | delete handlers (multi-file) | Delete success-body **drift**: `{ success: true }` vs `{ ok: true }` vs `204`. |
| 4 | Low-Med | REST | list handlers (multi-file) | Pagination **envelope drift**; several list endpoints omit a total entirely. |
| 5 | Low-Med | Data model | `db.js:804` | `automation_rules.last_run_at` is `TIMESTAMP` (timezone-naive) — only non-`TIMESTAMPTZ` timestamp in the schema. |
| 6 | Low | Data model | see detail | Missing indexes on several FK/filter columns. |
| 7 | Low (info) | Data model | see detail | Multi-tenant scoping gaps (no `workspace_id`) on several tables. |

---

## Detail

### 1. `installed_apps.workspace_id` is an unenforced FK — **Medium** (confidence: high)
`server/db.js:1568-1580`
```sql
CREATE TABLE IF NOT EXISTS installed_apps (
  ...
  workspace_id INTEGER,            -- ← no REFERENCES workspaces(id)
  UNIQUE (app_id, workspace_id)
)
```
Every other `workspace_id` in the schema (`projects`, `members`, `workspace_members`) is
`INTEGER REFERENCES workspaces(id) ON DELETE …`. Here it is a bare integer, so a workspace
delete leaves dangling install rows and a bad id can be inserted.
**Fix:** `workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE`.

### 2. `automation_logs.issue_id` has no FK — **Medium** (confidence: medium — may be intentional log retention)
`server/db.js:789-798`
```sql
CREATE TABLE IF NOT EXISTS automation_logs (
  ...
  issue_id INTEGER,                -- ← no REFERENCES issues(id)
  ...
)
```
Inconsistent with the rest of the schema, where issue-scoped rows carry
`issue_id INTEGER … REFERENCES issues(id) ON DELETE CASCADE/SET NULL`. If the intent is to
keep logs after an issue is deleted, use `ON DELETE SET NULL` explicitly rather than an
unconstrained column (which today allows non-existent issue ids).
**Fix:** `issue_id INTEGER REFERENCES issues(id) ON DELETE SET NULL`.

### 3. Delete success-body drift — **Low-Medium** (confidence: high)
Three distinct success bodies for `DELETE`:
- `res.json({ success: true })` — `assets.js:200,257`, `kb.js`, `sla.js:118`, `portal.js:139`, `incidents.js:267,294`, `plugins.js`, `securityLevels.js`, …
- `res.json({ ok: true })` — `projects.js:155` (baseline)
- `res.status(204).end()` — `marketplace.js:90,129`, `reportBuilder.js:370`, `scim.js:357,523`, `advancedRoadmap.js:403,479`

Even the baseline disagrees: `issues.js:1086` returns `{ success: true, id }`, `worklogs.js:91`
returns `{ success: true, summary }`, `projects.js` returns `{ ok: true }`.
**Fix:** pick one house style (recommend `204 No Content` for pure deletes, or a documented
`{ success: true }`) and note it in CLAUDE.md so future routes converge.

### 4. Pagination envelope drift — **Low-Medium** (confidence: high)
Five shapes coexist across paginated list endpoints:
- `issues.js:228-240` — `LIMIT/OFFSET` + `X-Total-Count` header, bare array body.
- `auditLog.js:50` — `{ entries, total, limit, offset }`.
- `publicApi.js:45` — `{ issues, limit, offset }` (**no total** → clients can't compute page count).
- `activity.js:83-84` — cursor: `{ activities, hasMore, nextCursor }`.
- `notifications.js` — rows + separate `unreadCount`; `scim.js` — RFC ListResponse (`totalResults`/`startIndex`, correct for SCIM).

SCIM and the cursor feed are legitimately special; the drift worth fixing is the
offset-based JSON endpoints (`auditLog`, `publicApi`, `webhooks`, `notifications`) that each
invent their own envelope and some omit `total`.
**Fix:** standardize offset endpoints on one envelope, e.g. `{ data, total, limit, offset }`,
and always include `total`.

### 5. `TIMESTAMP` vs `TIMESTAMPTZ` — **Low-Medium** (confidence: high)
`server/db.js:804`: `ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP`.
This is the only non-`TIMESTAMPTZ` timestamp in the entire schema; it stores wall-clock time
with no zone, which will drift against the `NOW()` (`timestamptz`) comparisons the scheduler
uses.
**Fix:** `last_run_at TIMESTAMPTZ`.

### 6. Missing FK / filter-column indexes — **Low** (confidence: medium)
FK columns without an index (Postgres seq-scans the child on parent delete, and these are
common filter columns):
- `incidents.issue_id` (`db.js:1715`; only `status` is indexed).
- `key_results.issue_id` (`db.js:993-994`; added via ALTER, no index).
- `portal_requests.issue_id` and `portal_requests.request_type_id` (`db.js:1631-1640`; only `requester_email` indexed).
- `notifications.issue_id` / `notifications.project_id` (`db.js:456-457`; only recipient indexed).
- `projects.permission_scheme_id` / `projects.notification_scheme_id` (`db.js:1206-1211`).
- `issues.security_level_id` (`db.js:1463-1467`).
**Fix:** add `CREATE INDEX IF NOT EXISTS` on each (cheap, idempotent, matches the pattern used everywhere else).

### 7. Multi-tenant scoping gaps — **Low / informational** (confidence: medium)
Post-JL-73 (workspaces) tables that are global with no `workspace_id`:
`asset_types` / `assets`, `kb_categories` / `kb_articles` (the JL-144 comment even claims
"workspace/global scoped" but there is no `workspace_id` column), `sprint_templates`,
`oncall_schedules`, `incidents`, `security_levels`, `permission_schemes`,
`notification_schemes`, `scim_groups`. In a workspace-tenant product these are shared across
all tenants. JL-73 explicitly deferred full row isolation to a follow-on, so this is a known
gap rather than a regression — flagged so the follow-on ticket has an inventory.

---

## What's Done Right (verified, not assumed)
- **No SQL value interpolation.** Grep of all `${…}` in `server/routes/` shows only: error
  strings, filenames/keys, `IN (${placeholders})` lists (placeholders = `?,?,…`), and dynamic
  `SET`/`WHERE` built from **hardcoded literal column names** (e.g. `assets.js:192`,
  `dashboardGadgets.js:204` iterate a fixed `['status','assignee','priority']` list) with all
  values bound via `?`. No user-controlled identifier reaches SQL.
- **`run()` composite-PK pitfall handled.** All four no-`id` tables add explicit `RETURNING`:
  `issue_assets` (`assets.js:235`), `issue_components` (`components.js:91`), `issue_labels`
  (`labels.js:89`, `issues.js:1054,1151`), `scim_group_members` (`scim.js:412,462`).
- **Idempotent migrations.** Every table is `CREATE TABLE IF NOT EXISTS`; every column add is
  guarded by `columnExists()` or `ADD COLUMN IF NOT EXISTS`; seeds use `ON CONFLICT DO NOTHING`
  or existence checks. Repeated boots are safe.
- **Error shape** is `{ error }` almost everywhere; SCIM's divergence is the RFC-required format.
- **FK `ON DELETE`** choices are mostly sound: CASCADE for owned children, SET NULL for optional
  cross-references (issues↔incidents/deployments/epics/releases/security levels).
