# JL-177 — Performance Review: N+1, Indexes, Unbounded Exports

**Scope:** Backend (`server/routes/*`, `server/services/*`) + schema (`server/db.js`) across the delivered 104-ticket codebase.
**Method:** grep + read. No production code changed — this is a findings report only.
**Reviewer confidence** is marked per finding. Severity reflects impact at *realistic* data volume (thousands of issues, a growing audit log, multi-project workspaces), not a fresh demo DB.

---

## Summary

The codebase is generally disciplined about batching: the prime N+1 suspects the ticket flagged (comment reactions, cross-project boards, advanced-roadmap epic rollups, dependency graph, report label enrichment) are already solved with `IN (...)` batch queries and in-memory `Map` joins. Good.

The real performance debt is in three areas:

1. **Missing indexes** — `issues.issue_key` has **no index at all** despite being a constant lookup key; several hot filter columns (`status`, `priority`, `assignee`, `updated_at`) are unindexed, so the dashboard, queues, reports and BI export all do sequential scans.
2. **Unbounded result sets** — the audit-log export/verify endpoints and the default issues list load whole (and fastest-growing) tables into memory with no `LIMIT`.
3. **JS aggregation over full-table loads** — the report builder, portfolio and dashboard compute in JavaScript what a SQL `GROUP BY` / `COUNT FILTER` would do in one indexed query.

The realtime WS hub and the automation scheduler are structurally sound (no O(n²), bounded per-room broadcast); the only scheduler concern is unbounded `automation_logs` growth.

### Top 3 hotspots
1. **`issues.issue_key` unindexed + `issues.status/priority` unindexed** — every smart-commit webhook, JQL link lookup and the home dashboard's 4 count queries scan the full issues table. (`server/db.js`, `dashboard.js:8-11`, `gitIntegration.js:358/379`)
2. **Unbounded audit-log export & verify** — `/audit-log/export` and `/audit-log/verify` read the *entire* audit_log (the fastest-growing table) into memory and stringify it in one shot. (`auditLog.js:54`, `auditLog.js:66`)
3. **Unbounded issues list + report-builder full load** — `GET /api/issues` default branch and `reportBuilder.loadIssues()` with no filter both pull the whole issues table into JS. (`issues.js:248`, `reportBuilder.js:212`)

---

## Ranked findings

| # | Severity | Area | File:Line | Problem | Fix | Confidence |
|---|----------|------|-----------|---------|-----|-----------|
| 1 | **High** | Index | `server/db.js` (issues table, ~L243) | `issue_key TEXT NOT NULL` has **no unique constraint and no index**. Looked up by equality in git webhooks (per commit), JQL linked-issues, releases, etc. Every lookup is a full scan. | `CREATE UNIQUE INDEX idx_issues_issue_key ON issues(issue_key)` | High |
| 2 | **High** | Unbounded | `auditLog.js:66` `/audit-log/export` | No `LIMIT`. Reads the entire filtered audit_log into memory, then builds one CSV/JSON string via `res.send`. Audit log grows on every action — the biggest table long-term. | Stream rows / enforce a max rows or a date-range requirement; paginate large exports. | High |
| 3 | **High** | Unbounded | `auditLog.js:54` `/audit-log/verify` | Loads the **whole** table (`ORDER BY seq ASC`, no filter/limit) to recompute the hash chain on every call. O(table) memory + CPU per request. | Verify in bounded chunks (seq ranges) or cache last-verified seq and verify incrementally. | High |
| 4 | **High** | Unbounded | `issues.js:248` `GET /api/issues` | Default (no-pagination) branch returns **all** matching issues with a per-row correlated subquery `(SELECT COUNT(*) FROM watchers ...)`. Broad/empty filter = whole table into JS, then `canViewIssue` filtered in JS. | Enforce a default cap (e.g. 500) even on the legacy branch; move watcher count to a `LEFT JOIN ... GROUP BY` or lazy-load. | High |
| 5 | **High** | Full load + JS agg | `reportBuilder.js:212` `loadIssues()` | With no filters the `WHERE` is empty → `SELECT ... FROM issues` across **all** projects/workspaces into memory, then dimension counting done in JS (`reportBuilder.js:144-146`). | Require at least a project/date scope; push dimension counts to SQL `GROUP BY`. Add supporting indexes (#7-#9). | High |
| 6 | **Med-High** | Full load + JS agg | `portfolio.js:108-139` | Loads every issue (`project_id,status,due_date,updated_at`) for all accessible projects, then counts total/open/done/overdue and 30-day throughput in JS. | Replace with `SELECT project_id, status, COUNT(*) ... GROUP BY project_id, status` + a separate throughput aggregate. | High |
| 7 | **Med-High** | Index | `server/db.js` (issues) | `issues.status` unindexed. Scanned by `dashboard.js:9-10` (two `COUNT(*) WHERE status=...`), `queues.js` filters, reports. | `CREATE INDEX idx_issues_status ON issues(status)` (or composite `idx_issues_project_status`). | High |
| 8 | **Medium** | Hot path | `dashboard.js:8-11` | 4 sequential full-scan `COUNT(*)` queries on `issues` on every dashboard load (total, in-progress, done, high-priority). | Collapse into one query using `COUNT(*) FILTER (WHERE ...)`; back with indexes #7/#10. | High |
| 9 | **Medium** | Index | `server/db.js` (issues) | `issues.assignee` unindexed — filtered by reportBuilder/filters/board grouping. | `CREATE INDEX idx_issues_assignee ON issues(assignee)` | Medium |
| 10 | **Medium** | Index | `server/db.js` (issues) | `issues.priority` unindexed — `dashboard.js:11` critical count + queue/report filters. | `CREATE INDEX idx_issues_priority ON issues(priority)` | Medium |
| 11 | **Medium** | Index | `server/db.js` (issues) | `issues.updated_at` unindexed — `biExport.js:224/241` filters `updated_at >= since` **and** `ORDER BY updated_at`; forces scan + sort. | `CREATE INDEX idx_issues_updated_at ON issues(updated_at)` | Medium |
| 12 | **Medium** | N+1 | `comments.js:73-74` | `rows.map(async row => ... await resolveAuthorDisplay(row.author))` fires one `SELECT name FROM members WHERE email=?` per comment with an email author (parallel via `Promise.all`, but still N queries). | Batch: collect distinct emails, one `WHERE email IN (...)`, resolve from a Map. | High |
| 13 | **Medium** | Scheduler | `scheduler.js:53-61` | Per due rule loads all matching issues (no limit) and runs `executeAction` + 2 serial `logExecution` writes **per issue**, every 60s. A rule matching thousands of issues = thousands of serial writes per cycle. | Cap issues per rule per cycle; batch-insert logs; consider set-based `transition` updates. | Medium |
| 14 | **Medium** | Unbounded growth | `db.js` `automation_logs` (no index) + scheduler | `automation_logs` has **no index** and grows one row per issue per scheduled run. Log-viewing filters by `rule_id`; retention unbounded. | `CREATE INDEX idx_automation_logs_rule ON automation_logs(rule_id)` + a retention/purge job. | High |
| 15 | **Medium** | Index | `server/db.js` `project_members` | Only `UNIQUE(project_id, member_id)` exists (usable for `project_id` prefix). Queries joining/filtering by **member_id** alone (`portfolio.js:84`, accessible-projects joins) have no usable index. | `CREATE INDEX idx_project_members_member ON project_members(member_id)` | Medium |
| 16 | **Medium** | Unbounded | `queues.js:275` `/queues/:id/issues` | No `LIMIT`; returns all issues matching a queue filter in a project, then SLA-annotates in JS. A busy support project's queue can be large. | Add pagination / a sane cap; keep the JS annotation (it's O(n) with a Map — fine). | Medium |
| 17 | **Medium** | Unbounded | `crossProjectBoards.js:274` `/:id/issues` | No `LIMIT` on a query spanning **multiple** projects (`project_id IN (...)`), all grouped into board columns in JS. Scales with the sum of all selected projects' issues. | Cap per column / per board; lazy-load columns. | Medium |
| 18 | **Low-Med** | N+1 | `gitIntegration.js:357-362, 378-405` | Webhook loops commits × extracted keys doing `SELECT id FROM issues WHERE issue_key=?` per key (compounded by missing index #1). Bounded by push size, but each lookup is a full scan today. | Fixing #1 (index issue_key) removes the scan; optionally batch keys with `IN (...)`. | Medium |
| 19 | **Low-Med** | Unbounded | `dependencies.js:157` | Loads all issues in a project (no limit) + links, builds graph & DFS cycle detection in JS. Bounded by project size; DFS is O(V+E) so fine algorithmically, but a huge project loads fully. | Acceptable for now; cap or paginate for very large projects. | Medium |
| 20 | **Low** | Index | `server/db.js` `issue_wiki_links` | `UNIQUE(issue_id, wiki_page_id)` covers `issue_id` prefix; reverse lookups by `wiki_page_id` ("which issues link this page") are unindexed. | `CREATE INDEX idx_issue_wiki_links_page ON issue_wiki_links(wiki_page_id)` | Medium |

### Verified NOT problematic (checked, no action)
- **Comment reactions** (`comments.js:20-43`) — single batched `GROUP BY` over `comment_id IN (...)`. Correct.
- **Advanced roadmap rollups** (`advancedRoadmap.js:249-291`) — children/deps/capacities each fetched with one `IN (...)` query; rollup in a Map. Correct.
- **Cross-project board grouping** (`crossProjectBoards.js:274`) — single query, JS grouping (the only issue is the missing LIMIT, #17).
- **Report label enrichment** (`reportBuilder.js:236-251`) — batched `issue_id IN (...)`. Correct.
- **Realtime WS hub** (`services/realtime.js`) — `broadcast`/`presence` are O(members-in-room); no global fan-out, no O(n²), `unref`'d timer. Clean.

---

## Recommended indexes (drop-in migration)

Append to the migration tail in `server/db.js` (all `IF NOT EXISTS`, safe to re-run). **8 indexes.**

```sql
-- JL-177: performance review — hot lookup/filter/sort columns and join FKs.

-- #1 issue_key: constant equality lookup (git webhooks, JQL links, releases). Currently a full scan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_issues_issue_key   ON issues(issue_key);

-- #7 status: dashboard counts, queue/report filters.
CREATE INDEX IF NOT EXISTS idx_issues_status             ON issues(status);

-- #9 assignee: report builder, board/queue filters.
CREATE INDEX IF NOT EXISTS idx_issues_assignee           ON issues(assignee);

-- #10 priority: dashboard "critical" count, queue/report filters.
CREATE INDEX IF NOT EXISTS idx_issues_priority           ON issues(priority);

-- #11 updated_at: BI export `since` filter + ORDER BY updated_at.
CREATE INDEX IF NOT EXISTS idx_issues_updated_at         ON issues(updated_at);

-- #15 project_members.member_id: "projects for member" joins (portfolio, access checks).
CREATE INDEX IF NOT EXISTS idx_project_members_member    ON project_members(member_id);

-- #14 automation_logs.rule_id: per-rule log viewing; table grows unbounded via scheduler.
CREATE INDEX IF NOT EXISTS idx_automation_logs_rule      ON automation_logs(rule_id);

-- #20 issue_wiki_links.wiki_page_id: reverse (page -> issues) lookup.
CREATE INDEX IF NOT EXISTS idx_issue_wiki_links_page     ON issue_wiki_links(wiki_page_id);
```

> Optional composite instead of #7 if dashboard/queue queries are always project-scoped:
> `CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);`
> The standalone `idx_issues_status` is the safer general choice because `dashboard.js` counts are **not** project-scoped.

---

## Recommended follow-ups (code, not just indexes)
1. **Cap every unbounded list/export** — add a hard default `LIMIT` (with pagination headers, mirroring `issues.js`'s opt-in JL-100 pattern) to: `/audit-log/export`, `GET /api/issues` default branch, `/queues/:id/issues`, `/cross-project-boards/:id/issues`, and `reportBuilder`.
2. **Push aggregation to SQL** — replace JS counting in `dashboard.js` (one `COUNT(*) FILTER` query), `portfolio.js` (`GROUP BY project_id, status`), and `reportBuilder.js` (dimension `GROUP BY`).
3. **Audit-log verify** — verify incrementally / in seq-range chunks instead of loading the whole chain.
4. **Batch the comment author resolution** (#12) — one `members WHERE email IN (...)` instead of N.
5. **Retention job for `automation_logs`** (and confirm one exists for `webhook_logs`) to bound growth.
