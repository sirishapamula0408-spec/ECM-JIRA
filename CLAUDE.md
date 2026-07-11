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
- **Theme:** MUI `ThemeProvider` integrated in `ThemeContext.jsx`. Theme config in `src/theme/muiTheme.js` with light/dark variants matching Atlassian design tokens. CSS custom properties in `src/styles/variables.css` and `theme.css` still used for layout.
- **State management:** React Context API — 7 nested providers in `App.jsx`:
  `AuthContext → ThemeContext (+ MUI ThemeProvider) → IssueContext → SprintContext → AppDataContext → MemberContext → NotificationContext`
- **API layer:** `src/api/client.js` is a fetch wrapper that auto-injects JWT Bearer tokens from localStorage/sessionStorage. Domain-specific modules (`issueApi.js`, `sprintApi.js`, `memberApi.js`, `projectApi.js`, `notificationApi.js`, `watcherApi.js`, `approvalApi.js`, `sharedDashboardApi.js`, `webhookApi.js`, `wikiApi.js`, plus Theme-1: `labelApi.js`, `importExportApi.js`, `attachmentApi.js`, `issueLinkApi.js`, `worklogApi.js`, `customFieldApi.js`, `automationApi.js`) use this client. Note: `client.js` does **not** auto-stringify — callers pass `body: JSON.stringify(...)`. Binary/large downloads (CSV/JSON export, attachment download) use a raw `fetch` with the Bearer header instead of `api()`, because `api()` always parses JSON.
- **Pages:** Each feature has its own page component in `src/pages/` with co-located CSS. Key pages: Dashboard, Board, Backlog, ProjectSummary, ActiveSprint, Reports, Roadmap, Teams, Filters, Profile, ProjectSettings, WorkflowEditor, ActivityFeed, WikiPage, WebhooksPage, SharedDashboardsPage, AutomationPage.
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
- **Role editing:** Inline `<select>` dropdowns on TeamsPage (workspace roles) and ProjectSettingsPage Access tab (project roles). Backend endpoints enforce Owner/last-Admin/Lead protections.
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

- **Framework:** Vitest with test config in `vite.config.js` (`globals: true`, `setupFiles: ['./src/test/setup.js']`)
- **Frontend tests:** `src/test/` — component tests with `@testing-library/react` (jsdom environment)
- **Backend tests — integration:** `server/test/` — database/schema tests using real PostgreSQL with isolated schemas per test suite via `createTestDb()`. Each suite gets a unique schema (`test_<random_hex>`) to allow parallel execution without conflicts. Cleaned up by `cleanTestDb()` which drops the schema.
- **Backend tests — unit:** `server/__tests__/` — middleware/route handler tests with `vi.mock('../db.js')` mocked db. Uses `runRoute` helper that executes all middleware + handlers sequentially, properly handling `asyncHandler`'s fire-and-forget promise pattern. `collaboration-modules.test.js` (39 tests) covers all collaboration route CRUD. `collaboration-enhancements.test.js` (19 tests) covers preferences, cursor pagination, wiki versioning/search/linking, HMAC, auto-watch.
- **Test DB:** Set `TEST_DATABASE_URL` env var (defaults to `postgresql://jira_lite:jira_lite_dev@localhost:5432/jira_lite_test`)

## Linting

ESLint uses **flat config** (`eslint.config.js`) with separate configs for frontend (`src/**/*.{js,jsx}` — React hooks/refresh plugins) and backend (`server/**/*.js` — Node.js globals only).

## Environment

Copy `.env.example` to `.env`. Key variables: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `APP_URL`, `TEST_DATABASE_URL`, SMTP config (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Run `docker compose up -d` or install PostgreSQL 16 locally.

## Conventions
- MUI components preferred for new UI (buttons, inputs, dialogs, tables, avatars, chips, alerts)
- Existing CSS layout classes (`.workspace`, `.sidebar`, `.topbar`, `.page`) remain for responsive grid
- Co-locate page CSS files with their JSX components in `src/pages/<PageName>/`
- Use `src/theme/muiTheme.js` to adjust global MUI theme tokens
- Markdown formatting used for issue descriptions (rendered by RichTextEditor)
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
