# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ECM JIRA Clone — a full-stack agile project management tool (JIRA clone) built with React 19 + Vite + Material UI (frontend) and Express 5 + PostgreSQL (backend).

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start both Vite (port 5173) and Express (port 4000) concurrently |
| `npm run dev:client` | Frontend only |
| `npm run dev:server` | Backend only (nodemon auto-restart) |
| `npm run build` | Production build to `/dist` |
| `npm run lint` | ESLint (flat config format) |
| `npm run test` | Vitest (single run) |
| `npm run test:watch` | Vitest in watch mode |
| `npx vitest run path/to/test.js` | Run a single test file |
| `npx vitest run --grep "test name"` | Run tests matching a pattern |

## Architecture

### Frontend (`src/`)
- **Routing:** React Router v7 (`BrowserRouter` in `main.jsx`, routes in `App.jsx`)
- **UI framework:** Material UI (MUI) v6 — components used across Topbar, Sidebar, modals, forms, and pages
- **Theme:** MUI `ThemeProvider` is wired in `ThemeProvider.jsx`, and the theme itself is built by `src/theme/muiTheme.js` (`buildMuiTheme(mode)`), keyed to the same light/dark switch that toggles `.app-theme-dark`. **Both files existed only as documentation until JL-408** — before that there was no MUI theme at all, so every MUI component used MUI's defaults: Roboto (which this app never loads) and a rem-based type scale that multiplied against the 14px root, producing off-scale sizes like 21px, 29.75px and 12.25px. The theme now mirrors `src/styles/variables.css` in **px**, deliberately — a rem-based theme would re-scale the moment the root size changes, which is how the drift happened. `src/test/MuiThemeTokens.JL408.test.js` fails if the theme and the CSS tokens diverge. CSS custom properties in `src/styles/variables.css` and `theme.css` remain the source of truth for layout.
- **Design system (JL-437 → JL-441):** the visual language lives in exactly **three** files and nowhere else:
  1. `src/styles/variables.css` — every value. Colour, type scale, spacing, radius (`--radius-xs|sm|md|lg|pill` = 3/6/8/12/999), shadow, and the layout/control geometry (`--layout-sidebar-width` 326px, `--layout-header-height` 86px, `--layout-breadcrumb-height` 76px, `--layout-details-panel-width` 332px, `--layout-content-padding` 32px, `--control-height` 40px plus the `-sm|flag|status|nav|search|create` variants, `--avatar-size-md|lg`).
  2. `src/styles/shared.css` — those values applied to the **hand-rolled** controls (`.btn` + `-primary|-ghost|-danger|-sm`, `.icon-btn`, `.card`/`.panel`, `.table`, `.tabs`/`.tab`, `.badge`, `.pill`, `.field`/`.field-label`/`.field-help`/`.field-error`, `.breadcrumb-bar`/`.breadcrumbs`/`.breadcrumb-*`, `.modal`, and the global `input, select, textarea` rule).
  3. `src/theme/muiTheme.js` — the **same** contract applied to MUI, via a `components` override block. 25 of the 44 pages render MUI Button/Select/TextField/Table/Dialog; changing a control app-wide means editing this block, **not** adding `sx` props to a page.

  A bare `.btn` is now the brief's default *secondary* button (40px, white, bordered) rather than an unstyled shell, and `label` / `input` / `select` / `textarea` carry the form contract globally. **Page CSS composes these; it must not restate them.** `src/test/DesignTokens.JL441.test.js` enforces it: a colour that has a token may not be written as a literal anywhere under `src/**/*.css` (outside comments, `var()` fallbacks, and the two token-source files), every single-value `border-radius` must come from the radius scale, the layout/control tokens must hold their briefed values, and `muiTheme.js` must agree with the CSS about radius and control height. JL-440 swept 647 colour literals and 376 radius literals out of 56 stylesheets to get there — 119 of them still wrote the pre-JL-438 brand blue `#0052cc` and had never seen the refresh, which is exactly the drift the guard exists to stop.

  **Components live in `src/components/ui/` (JL-439)** and are imported from its barrel: `Button`, `IconButton`, `Input`/`Textarea`/`Select`, `FormField`, `Table`, `Modal`, `Tabs`, `Breadcrumb`, `PageHeader`, `SectionHeader`, `Toast`, `StatCard`. They render the shared classes above rather than carrying styles of their own, so a hand-written `<table className="table">` and a `<Table>` are the same table. `Modal` and `Toast` wrap MUI `Dialog`/`Snackbar` on purpose — JL-367 had to retrofit Escape-to-close, focus trap and dialog semantics onto a hand-rolled overlay, and MUI ships all of them. **Check this barrel before writing a control.** `StatusLozenge`, `EmptyState`, `LoadingState`, `ConfirmDialog` and the layout components stay where they are and are deliberately *not* re-exported; `UiComponents.JL439.test.jsx` walks the directory and fails if a file duplicates one of them or is missing from the barrel.
  **The issue-detail page is the visual reference.** Its title is the one consumer of `--font-size-display` (36/700/44); a generic page title stays on `.page h1` (28px), because a page title and an issue summary are different roles. Breadcrumbs used to exist twice (`.project-breadcrumb-*` and `.id-breadcrumb-*`, drifted on separator colour and current-item weight) and are now one shared family.
- **State management:** React Context API — 7 nested providers in `App.jsx`:
  `AuthContext → ThemeContext (+ MUI ThemeProvider) → IssueContext → SprintContext → AppDataContext → MemberContext → NotificationContext`
  Each one is **two files** (JL-407): `src/context/<X>Context.jsx` holds the context object and the `use<X>()` hook and exports **no components**; `src/context/<X>Provider.jsx` holds the provider component and exports **nothing else**. A module that mixes the two opts out of Vite fast refresh (`react-refresh/only-export-components`, an error here). Consumers import the hook from `<X>Context`, providers from `<X>Provider` — keep it that way when adding a context. `src/components/common/useConfirm.jsx` is split from `ConfirmDialog.jsx` for the same reason.
- **API layer:** `src/api/client.js` is a fetch wrapper that auto-injects JWT Bearer tokens from localStorage/sessionStorage. Domain-specific modules (`issueApi.js`, `sprintApi.js`, `memberApi.js`, `projectApi.js`, `notificationApi.js`, `watcherApi.js`, `approvalApi.js`, `sharedDashboardApi.js`, `webhookApi.js`, `wikiApi.js`, plus Theme-1: `labelApi.js`, `importExportApi.js`, `attachmentApi.js`, `issueLinkApi.js`, `worklogApi.js`, `customFieldApi.js`, `automationApi.js`) use this client. Note: `client.js` does **not** auto-stringify — callers pass `body: JSON.stringify(...)`. Binary/large downloads (CSV/JSON export, attachment download) use a raw `fetch` with the Bearer header instead of `api()`, because `api()` always parses JSON.
- **Pages:** Each feature has its own page component in `src/pages/` with co-located CSS. Key pages: Dashboard, Board, Backlog, ProjectSummary, ActiveSprint, Reports, Roadmap, TeamsPage (the MEMBER directory, at /members), TeamDirectoryPage + TeamProfilePage (real teams, at /teams and /teams/:teamId), Filters, Profile, ProjectSettings, WorkflowEditor, ActivityFeed, WikiPage, WebhooksPage, SharedDashboardsPage, AutomationPage.
- **Rich text:** `src/components/issues/RichTextEditor.jsx` provides markdown formatting toolbar for description fields.
- **@Mentions:** `src/components/mentions/MentionInput.jsx` — autocomplete textarea for @email mentions. `MentionText` component renders mentions as clickable styled chips.
- **Notifications:** `src/components/notifications/NotificationDropdown.jsx` — bell icon dropdown in Topbar with unread count badge, mark-read/mark-all. `NotificationContext` manages state.

### Backend (`server/`)
- **Entry:** `server/index.js` — Express app with CORS, JSON parsing, route registration
- **Auth:** JWT-based. `authGuard.js` middleware verifies tokens on protected routes. Token expiry controlled by `JWT_EXPIRES_IN` env var (default `7d`).
- **Authorization:** Two-tier RBAC system in `server/middleware/authorize.js`:
  - **Workspace roles:** Owner > Admin > Member > Viewer. `requireRole('Admin')` middleware enforces minimum workspace role.
  - **Project roles:** Lead/Admin/Member/Viewer. `loadProjectRole` middleware loads from `project_members` table, then `requireProjectRole('Admin')` enforces. Workspace Admin/Owner always bypass project-level checks.
  - `asyncHandler` wrapper in `server/middleware/errorHandler.js` for async route error handling.
- **Database:** PostgreSQL via `pg` (node-postgres) connection pool (`max: 10`, idle timeout 30s, connection timeout 5s). Schema in `server/db.js` with `initializeDatabase()`. Graceful shutdown hooks on `SIGINT`/`SIGTERM` close the pool.
  - **Compatibility layer:** `convertPlaceholders()` auto-converts SQLite-style `?` placeholders to PostgreSQL `$1,$2,...` format (respects `?` inside single-quoted strings). The `run()` wrapper auto-appends `RETURNING id` for INSERT statements and returns `{ lastID, changes }` for compatibility. Route files still use `?` placeholders — the conversion is transparent.
  - Docker Compose config in `docker-compose.yml` for local PostgreSQL, or install PostgreSQL 16 directly.
- **Routes:** RESTful API under `/api/` — auth, issues, sprints, projects, dashboard, reports, roadmap, workflows, members, profile, activity, comments, filters, notifications, watchers (under issues), approvals, shared-dashboards, webhooks, wiki. **Theme-1 routers** (`labels`, `importExport`, `attachments`, `issueLinks`, `worklogs`, `customFields`, `automation`) are mounted at `/api` with absolute sub-paths (`/projects/:id/...`, `/issues/:id/...`, `/links/:id`, `/worklogs/:id`, etc.).
- **Config:** `server/config.js` reads from `.env` — `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `APP_URL`, SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)

### RBAC & Permissions
- **Hook:** `src/hooks/usePermissions.js` — `usePermissions(projectId?)` returns capability booleans (`canEditIssue`, `canCreateIssue`, `canManageMembers`, `canManageSprints`, `canEditWorkflows`, `isAdmin`, etc.)
- **Component:** `src/components/RequireRole.jsx` — wrapper that conditionally renders children based on role
- **UI gating:** All pages gate create/edit/delete actions using `usePermissions()`. Viewers see read-only UI.
- **Role editing (JL-417):** Inline role dropdowns on **TeamsPage** and **UserManagementPage** (`/users`) for workspace roles. Owner rows stay static — ownership is a flag (JL-317), not an assignable role. Backend endpoints enforce Owner/last-Admin protections and the UI surfaces the rejection rather than duplicating the rule. **ProjectSettingsPage has no role dropdown** — this line used to claim one and was wrong; project-role changes are not editable inline there.
- **Member status (JL-417):** `Active` / `Invited` / `Deactivated` each get a distinct pill (`.pill-green` / `.pill-yellow` / `.pill-red` in `shared.css`). Deactivate is a suspension that preserves role and history; Delete is separate. The Teams members table defaults its Status filter to `Active`.
- **`members.task_count` is not authoritative (JL-417).** The column is written on INSERT and never updated. `GET /api/members` derives the count from `issues` instead, matching `issues.assignee` against the member's name **or** email (both forms occur). Do not read the stored column expecting a real number.
- **Teams vs Members routing (JL-425).** These three are easy to confuse, and were — badly. `/members` is the Admin-only workspace **member directory** (component: `TeamsPage`, which kept its old filename); `/teams` is the Atlassian-style **team directory**, open to every workspace member; `/teams/:teamId` is a team profile. `/teams` used to *be* the member directory, so `/teams` and `/teams/:teamId` meant unrelated things — that collision hid the entire team feature for a day (JL-436). Old routes redirect rather than 404. **`/members` and `/users` still overlap** (both Admin-only member lists; `/users` is more capable) — a known, unresolved follow-up.
- **API client:** `src/api/client.js` auto-handles 403 responses with Snackbar notifications via `SnackbarContext`.

### Collaboration & Communication Modules
- **@Mentions (JL-41):** `server/routes/comments.js` extracts `@email` patterns from comment text, stores in `mentions` table, creates notifications. Frontend `MentionInput` provides autocomplete; `MentionText` renders clickable chips.
- **Notifications (JL-42):** `server/routes/notifications.js` — CRUD + mark-read + mark-all + SSE stream (`/api/notifications/stream`). Per-user preferences in `notification_preferences` table (in-app, email, digest frequency). `NotificationContext` + `NotificationDropdown` on frontend.
- **Watch/Follow (JL-43):** `server/routes/watchers.js` — watch/unwatch/list endpoints under `/api/issues/:issueId/watchers`. Auto-watch on issue create and comment (`ON CONFLICT DO NOTHING`). Watchers notified on comments.
- **Activity Feed (JL-44):** `server/routes/activity.js` — filterable by type/project/actor/dateRange with cursor-based pagination (`nextCursor`/`hasMore`). Frontend `ActivityFeedPage` uses `IntersectionObserver` for infinite scroll.
- **Approval Workflows (JL-45):** `server/routes/approvals.js` — `approval_rules` define required approvals per status transition (Admin only). `approvals` track individual approve/reject decisions. Check endpoint verifies if transition is gated. Input validation on status values and approver roles.
- **Shared Dashboards (JL-46):** `server/routes/shared-dashboards.js` — CRUD + clone with JSONB layout, private/public visibility. Ownership check on PATCH, access control on GET by ID.
- **Webhooks (JL-47):** `server/routes/webhooks.js` — CRUD (Admin only) + test + delivery logs. HMAC-SHA256 signing (`X-Hub-Signature-256` header). Retry with exponential backoff (up to 3 attempts). Pre-built Slack/Teams message templates based on webhook name. `fireWebhooks()` helper called from other routes.
- **Project Wiki (JL-48):** `server/routes/wiki.js` — hierarchical pages per project with markdown content. Page versioning (`wiki_page_versions` table, new version on each edit). Full-text search (`ILIKE` on title + content). Bidirectional issue-page linking via `issue_wiki_links` table. Frontend `WikiPage` has sidebar tree, search bar, version history panel, and issue linking UI.

### Database Tables (Collaboration)
`mentions`, `notifications`, `notification_preferences`, `watchers`, `approval_rules`, `approvals`, `shared_dashboards`, `webhooks`, `webhook_logs`, `wiki_pages`, `wiki_page_versions`, `issue_wiki_links`. The `activity` table was enhanced with `activity_type`, `project_id`, `issue_id`, `created_at` columns.

### Core Project Management Modules (Theme-1, JL-31 → JL-40)
These extend the issue model. Most issue-scoped routers are mounted at `/api` with absolute sub-paths (e.g. `/projects/:id/labels`, `/issues/:id/links`) and gated by the `protect` middleware.
- **Sub-tasks (JL-31):** `issues.parent_id` (self-FK, `ON DELETE CASCADE`) + `Sub-task` added to the `issue_type` CHECK and `ISSUE_TYPES`. `GET`/`POST /api/issues/:id/subtasks` (inherits project/sprint from parent); rejects nested sub-tasks (400) and closing a parent with open sub-tasks (409). IssueDetailPage shows a Child-issues panel with a progress bar + inline add form.
- **Labels / Tags (JL-32):** `server/routes/labels.js` — `labels` + `issue_labels` tables. `GET/POST/DELETE /api/projects/:id/labels` (issue counts + `?search`), `GET/PUT /api/issues/:id/labels`. Frontend `labelApi.js` + LabelPicker on IssueDetailPage (colored chips, catalog suggestions, inline create).
- **Attachments (JL-33):** `server/routes/attachments.js` — `attachments` table; files stored on local disk under `server/uploads/` (gitignored). Upload is **base64-over-JSON** (no multer), so the global `express.json` limit is raised to `25mb`. Endpoints: upload, list, authenticated download stream, delete. Frontend `attachmentApi.js` (FileReader → base64) + attachment grid.
- **Issue Linking (JL-34):** `server/routes/issueLinks.js` — `issue_links` (source/target/type). `GET/POST /api/issues/:id/links` (bidirectional, inverse-aware: blocks/is blocked by, duplicates/is duplicated by, relates to), `DELETE /api/links/:id`. Guards against self-link and duplicates.
- **Time Tracking (JL-35):** `server/routes/worklogs.js` — `issues.original_estimate_minutes` + `worklogs` table. `parseTimeToMinutes()` handles `1d 4h`/`45m`/bare-minutes (1d = 8h). Worklog CRUD + `PUT /api/issues/:id/estimate`; returns estimate/spent/remaining summary. Frontend Work-log tab + progress bar + editable Estimate field.
- **Custom Fields (JL-37):** `server/routes/customFields.js` — `custom_fields` (text/number/date/dropdown) + `issue_custom_field_values` (EAV). Admin-only definition CRUD; `GET`/`PUT` issue values. Dynamic "More fields" sidebar section on IssueDetailPage.
- **Automation Rules (JL-38):** engine in `server/services/automation.js` + routes in `server/routes/automation.js`. `automation_rules` + `automation_logs`. Triggers `status_changed` / `comment_added`; actions `assign`/`transition`/`comment`/`notify`; per-rule execution logging; **loop-safe** (actions apply directly to the DB, never re-invoking the engine). Wired into the issues status-change route and comments route. Frontend `AutomationPage` (rule builder + list + log), routes `/automation` and `/projects/:id/automation`, sidebar nav link.
- **Bulk Operations (JL-39):** `DELETE /api/issues/:id` (dependents cascade). BacklogPage bulk toolbar extended from status-only to an action picker (Status/Assignee/Priority/Sprint/Delete) with confirm on delete. `IssueContext.handleDelete`.
- **Import / Export (JL-40):** `server/routes/importExport.js` — `GET /api/projects/:id/export?format=csv|json` (downloadable) + `POST /api/projects/:id/import` with column mapping, validation, **dry-run preview**, sequential key generation on commit. Frontend `ImportExportModal` in the Backlog toolbar.

### Database Tables (Core PM)
`labels`, `issue_labels`, `attachments`, `issue_links`, `worklogs`, `custom_fields`, `issue_custom_field_values`, `automation_rules`, `automation_logs`. The `issues` table gained `parent_id` and `original_estimate_minutes` columns, and the `issue_type` CHECK now allows `Sub-task`.

### API Proxy
Vite dev server proxies `/api/*` requests to `http://localhost:4000` (configured in `vite.config.js`).

### Deployment (JL-97)
- **Serve static:** `server/serveStatic.js` exports `shouldServeStatic(env)` and `setupStaticServing(app, opts)`. When `NODE_ENV==='production'` or `SERVE_STATIC` is set, `server/index.js` serves the built `/dist` via `express.static` plus an SPA history-fallback (`SPA_FALLBACK_PATTERN` regex excludes `/api`). Dev behavior (Vite serving the frontend) is unchanged.
- **Docker:** `Dockerfile` is multi-stage (build frontend → run API serving `/dist`); `docker-compose.prod.yml` wires app + postgres (+ optional `nginx` under the `proxy` profile); `nginx.conf.example` handles HTTPS/reverse-proxy termination.
- **Backups:** `scripts/backup-db.sh` — cron-friendly `pg_dump` (custom-format, gzip) into `./backups` with `RETENTION_DAYS` pruning; restore via `pg_restore`.

### Key Constants
`src/constants.js` defines statuses (`Backlog → To Do → In Progress → Code Review → Done`), priorities, and issue types (`Story`, `Bug`, `Task`, `Sub-task`) used across the app.

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@mui/material` | UI component library |
| `@mui/icons-material` | Material icons |
| `@emotion/react`, `@emotion/styled` | MUI styling engine |
| `react-router-dom` | Client-side routing |
| `express` | Backend framework |
| `pg` | PostgreSQL client |
| `jsonwebtoken` | Auth tokens |
| `nodemailer` | Email sending |

## Testing

- **Framework:** Vitest, configured in `vite.config.js` as **two projects** (JL-377): `client` (jsdom, `src/**`, setup `./src/test/setup.js`) and `server` (node, `server/**`, setup `./src/test/setup.env.js`). Backend suites deliberately do **not** load jsdom or `@testing-library/jest-dom` — applying jsdom globally cost ~66s of environment setup per 12 backend files against 4.8s of actual test time, which starved the worker pool and made the suite fail nondeterministically. Each project sets `globals: true` itself — projects do **not** inherit it from the root `test` block. Pool size is capped via top-level `maxWorkers` (`poolOptions` was removed in Vitest 4); `testTimeout`/`hookTimeout` are 20s, not the 5s default. `src/test/VitestConfigProjects.JL377.test.js` guards all of this.
- **Frontend tests:** `src/test/` — component tests with `@testing-library/react` (jsdom environment)
- **Backend tests — integration:** `server/test/` — database/schema tests using real PostgreSQL with isolated schemas per test suite via `createTestDb()`. Each suite gets a unique schema (`test_<random_hex>`) to allow parallel execution without conflicts. Cleaned up by `cleanTestDb()` which drops the schema.
- **Backend tests — unit:** `server/__tests__/` — middleware/route handler tests with `vi.mock('../db.js')` mocked db. Uses `runRoute` helper that executes all middleware + handlers sequentially, properly handling `asyncHandler`'s fire-and-forget promise pattern. `collaboration-modules.test.js` (39 tests) covers all collaboration route CRUD. `collaboration-enhancements.test.js` (19 tests) covers preferences, cursor pagination, wiki versioning/search/linking, HMAC, auto-watch.
- **Test DB:** Set `TEST_DATABASE_URL` env var (defaults to `postgresql://jira_lite:jira_lite_dev@localhost:5432/jira_lite_test`)

## Linting

ESLint uses **flat config** (`eslint.config.js`) with separate configs for frontend (`src/**/*.{js,jsx}` — React hooks/refresh plugins) and backend (`server/**/*.js` — Node.js globals only).

**`npm run lint` runs ESLint *and* stylelint** (JL-416). `stylelint.config.mjs` enforces that every `font-size` / `font-weight` / `font-family` in `src/**/*.css` resolves to a `var(--font-*)` token. The rule itself lives once in `src/test/typographyRule.mjs` and is imported by both the stylelint config and the vitest guard — a rule stated twice is how the original four typography guards drifted from reality.

Both gates are scoped by a **frozen baseline**, `src/test/typography-baseline.json`:
- **stylelint** exempts a baselined file *entirely*. Drop a file from the baseline and it becomes gated automatically, with no config edit.
- **`TypographyTokens.JL394.test.js`** counts per file, so it catches a new violation *inside* an already-baselined file — which stylelint cannot — and it also **fails when a violation is fixed without the baseline shrinking**. The count can only go down.

Re-baseline with `npm run typography:baseline` (it refuses to raise the total).

**JL-415 emptied that baseline: 257 literal declarations across 46 files → 0**, so stylelint now hard-gates *every* stylesheet under `src/` — no file is exempt. The last entry (`ProjectSettingsPage.css`'s `32px` avatar initial) was cleared once JL-414 added the 32px `xxxl` step. Rules applied in the sweep, so new CSS follows the same ones:
- **`13px` (38 sites) → `--font-size-base` (14px), uniformly.** 13px was never a step — it was "one notch above the pre-JL-396 12px base", i.e. body copy, and since JL-396 the body token *is* 14px. Snapping down to 12px would have re-imposed the very shrink JL-396 removed.
- `7px`/`9px`/`10px`/`11px` → `--font-size-sm` (12px). 9px and 7px went on accessibility grounds; 11px maps to `sm` rather than `xs` because JL-414 retires the 11px step. **Do not add new `--font-size-xs` references.**
- `15px`→base, `18px`→lg, `22px`→xl, `30px`→xxl.
- `em`/`rem` font sizes are gone from CSS *and* JSX — they are the JL-408 re-scaling bug, and the root is 14px. Editor heading levels map to xl/lg/md (Atlassian h800/h700/h600) rather than to their nearest computed value, which would have collapsed h1 and h2 onto one step.
- Two literals survive with a `stylelint-disable-next-line` and a reason: `.empty-state__icon` (40px) and `.not-found-page h1` (72px). Both size *artwork*, and the text scale has no display step above heading.xxlarge. `.gadget-stat` was a third until JL-414 added the **metric tier** (`--font-size-metric-lg/md/sm`, 28/24/16 — Atlassian's `font.metric.*`); a KPI numeral takes that tier, not a heading token. `.mention-chip` keeps `font-size: inherit` because it is `display: inline` inside arbitrary copy.
- The print stylesheet in `src/utils/printDocument.js` is a separate document with none of the app's CSS loaded, so it **declares** the tokens in its own `:root` from `FONT_FAMILY`/`SIZE`/`WEIGHT` in `src/theme/muiTheme.js` and then references them. Do not restate a font stack there.

## Environment

Copy `.env.example` to `.env`. Key variables: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `APP_URL`, `TEST_DATABASE_URL`, SMTP config (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Run `docker compose up -d` or install PostgreSQL 16 locally.

## Conventions
- MUI components preferred for new UI (buttons, inputs, dialogs, tables, avatars, chips, alerts)
- Existing CSS layout classes (`.workspace`, `.sidebar`, `.topbar`, `.page`) remain for responsive grid
- Co-locate page CSS files with their JSX components in `src/pages/<PageName>/`
- Use `src/theme/muiTheme.js` to adjust global MUI theme tokens — keep its values in sync with `variables.css` (a test enforces this)
- **A page title is a plain `<h1>` (JL-409).** The shared `.page h1` rule in `layout.css` owns the treatment; do not reach for `<Typography variant="h4|h5">` as a page title, which bypasses that rule and leaves the page with no level-1 heading. `Typography component="h1"` is not a fix either — it emits an emotion class the shared rule then has to out-specify. JL-416 enforces this across **all 42 pages** by enumerating `src/pages/*/` rather than a hardcoded list. For the four pages that root *outside* `.page` (`AcceptInvitePage`, `ResetPasswordPage`, `AssetsPage`, `PortalPage`) use `<h1 className="page-title-standalone">` — one shared rule in `layout.css`, not a per-page restatement
- Markdown formatting used for issue descriptions (rendered by RichTextEditor)
- **`src/utils/sanitizeHtml.js` is the only HTML sanitiser in the codebase (JL-359).** Every string that reaches `dangerouslySetInnerHTML` must pass through it — `RichTextEditor`, `KnowledgeBasePage`, `IssueDetailPage` and `TipTapEditor` all do. It is a dependency-free allow-list (tags, per-tag attributes, and URL schemes) and carries the JL-344 attribute-breakout defence, the JL-358 control-character URL normalization and the JL-368 URL scheme allow-list. There used to be a second, DOM-based sanitiser in `src/utils/editorContent.js`; it was deleted because the two allow-lists had drifted and a fix to one never reached the other's consumers. **Do not add another sanitiser** — need a new tag or attribute? Extend `ALLOWED_TAGS` / `ALLOWED_ATTRS` in that one module and add a case to `src/test/sanitizeHtml.test.jsx`. `editorContent.js` now holds only pure text helpers (`htmlToPlainText`, `isEmptyDoc`, `looksLikeHtml`, `decodeEntities`).
- Use `asyncHandler` wrapper for all async Express route handlers
- Use `requireRole` / `requireProjectRole` middleware for authorization on protected endpoints
- Route SQL queries use `?` placeholders — `convertPlaceholders()` in `db.js` handles PostgreSQL conversion transparently
- Use PostgreSQL `TRUE`/`FALSE` for boolean values (not `0`/`1`), `NOW()` for timestamps, `::jsonb` for JSON casting
- Use `ON CONFLICT DO NOTHING` for idempotent inserts (e.g., watchers auto-watch)
- Webhook routes require `requireRole('Admin')` on all endpoints; secrets are never returned in GET responses
- Use `signPayload()` helper for HMAC-SHA256 webhook signing; `logDelivery()` for consistent webhook log inserts
- Wiki page edits always create a new version in `wiki_page_versions`; use `ILIKE` for case-insensitive full-text search
- The `run()` wrapper auto-appends `RETURNING id` to INSERTs. For tables **without an `id` column** (e.g. `issue_labels` composite PK), add an explicit `RETURNING <col>` so the wrapper doesn't inject `RETURNING id` and error
- Attachment uploads are base64-over-JSON (no multer); this is why `express.json({ limit: '25mb' })` is set globally in `server/index.js`
- Automation actions apply directly to the DB and never re-invoke the engine — this keeps `transition` actions from causing trigger loops
- Deleting an issue cascades to labels/links/worklogs/attachments/custom-field-values/subtasks via `ON DELETE CASCADE`; `activity.issue_id` is `ON DELETE SET NULL`
