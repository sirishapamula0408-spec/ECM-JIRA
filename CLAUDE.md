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
| `npm run lint` | ESLint |
| `npm run test` | Vitest (single run) |
| `npm run test:watch` | Vitest in watch mode |

## Architecture

### Frontend (`src/`)
- **Routing:** React Router v7 (`BrowserRouter` in `main.jsx`, routes in `App.jsx`)
- **UI framework:** Material UI (MUI) v6 — components used across Topbar, Sidebar, modals, forms, and pages
- **Theme:** MUI `ThemeProvider` integrated in `ThemeContext.jsx`. Theme config in `src/theme/muiTheme.js` with light/dark variants matching Atlassian design tokens. CSS custom properties in `src/styles/variables.css` and `theme.css` still used for layout.
- **State management:** React Context API — 6 nested providers in `App.jsx`:
  `AuthContext → ThemeContext (+ MUI ThemeProvider) → IssueContext → SprintContext → AppDataContext → MemberContext`
- **API layer:** `src/api/client.js` is a fetch wrapper that auto-injects JWT Bearer tokens from localStorage/sessionStorage. Domain-specific modules (`issueApi.js`, `sprintApi.js`, `memberApi.js`, `projectApi.js`, etc.) use this client.
- **Pages:** Each feature has its own page component in `src/pages/` with co-located CSS. Key pages: Dashboard, Board, Backlog, ProjectSummary, ActiveSprint, Reports, Roadmap, Teams, Filters, Profile, ProjectSettings, WorkflowEditor.
- **Rich text:** `src/components/issues/RichTextEditor.jsx` provides markdown formatting toolbar for description fields.

### Backend (`server/`)
- **Entry:** `server/index.js` — Express app with CORS, JSON parsing, route registration
- **Auth:** JWT-based. `authGuard.js` middleware verifies tokens on protected routes. Tokens issued with configurable expiry (1d standard, 30d for "remember me").
- **Authorization:** Two-tier RBAC system in `server/middleware/authorize.js`:
  - **Workspace roles:** Owner > Admin > Member > Viewer. `requireRole('Admin')` middleware enforces minimum workspace role.
  - **Project roles:** Lead/Admin/Member/Viewer. `loadProjectRole` middleware loads from `project_members` table, then `requireProjectRole('Admin')` enforces. Workspace Admin/Owner always bypass project-level checks.
  - `asyncHandler` wrapper in `server/middleware/errorHandler.js` for async route error handling.
- **Database:** PostgreSQL via `pg` (node-postgres) connection pool. Schema in `server/db.js` with `initializeDatabase()`. Uses `convertPlaceholders()` compatibility layer to auto-convert SQLite-style `?` placeholders to PostgreSQL `$1,$2,...` format. The `run()` wrapper auto-appends `RETURNING id` for INSERT statements and returns `{ lastID, changes }` for compatibility. Docker Compose config in `docker-compose.yml` for local PostgreSQL.
- **Routes:** RESTful API under `/api/` — auth, issues, sprints, projects, dashboard, reports, roadmap, workflows, members, profile, activity, comments, filters
- **Config:** `server/config.js` reads from `.env` (PORT, DATABASE_URL, JWT_SECRET, SMTP settings)

### RBAC & Permissions
- **Hook:** `src/hooks/usePermissions.js` — `usePermissions(projectId?)` returns capability booleans (`canEditIssue`, `canCreateIssue`, `canManageMembers`, `canManageSprints`, `canEditWorkflows`, `isAdmin`, etc.)
- **Component:** `src/components/RequireRole.jsx` — wrapper that conditionally renders children based on role
- **UI gating:** All pages gate create/edit/delete actions using `usePermissions()`. Viewers see read-only UI.
- **Role editing:** Inline `<select>` dropdowns on TeamsPage (workspace roles) and ProjectSettingsPage Access tab (project roles). Backend endpoints enforce Owner/last-Admin/Lead protections.
- **API client:** `src/api/client.js` auto-handles 403 responses with Snackbar notifications via `SnackbarContext`.

### API Proxy
Vite dev server proxies `/api/*` requests to `http://localhost:4000` (configured in `vite.config.js`).

### Key Constants
`src/constants.js` defines statuses (`Backlog → To Do → In Progress → Code Review → Done`), priorities, and issue types used across the app.

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

- **Framework:** Vitest + jsdom (frontend) / node (backend)
- **Frontend tests:** `src/test/` — component tests with `@testing-library/react`
- **Backend tests:** `server/test/` and `server/__tests__/` — route handler tests with mocked db
- **Pattern:** Backend route tests use a `runRoute` helper that executes all middleware + handlers sequentially, properly handling `asyncHandler`'s fire-and-forget promise pattern.

## Environment
Copy `.env.example` to `.env`. Key variables: `PORT`, `VITE_API_URL`, `DATABASE_URL`, `JWT_SECRET`, SMTP config for email features. Run `docker compose up -d` to start PostgreSQL locally.

## Conventions
- MUI components preferred for new UI (buttons, inputs, dialogs, tables, avatars, chips, alerts)
- Existing CSS layout classes (`.workspace`, `.sidebar`, `.topbar`, `.page`) remain for responsive grid
- Co-locate page CSS files with their JSX components in `src/pages/<PageName>/`
- Use `src/theme/muiTheme.js` to adjust global MUI theme tokens
- Markdown formatting used for issue descriptions (rendered by RichTextEditor)
- Use `asyncHandler` wrapper for all async Express route handlers
- Use `requireRole` / `requireProjectRole` middleware for authorization on protected endpoints
