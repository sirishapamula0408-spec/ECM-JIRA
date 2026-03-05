# ECM-JIRA Project Plan & Execution Strategy

## Overview

Restructure and modernize the ECM-JIRA application from a monolithic codebase into a well-organized, maintainable, and scalable project management tool.

**Current State:** Working prototype with all features in monolithic files
**Target State:** Modular, testable, production-grade application

---

## Phase Summary

| Phase | Name                          | Scope                                | Priority  |
|-------|-------------------------------|--------------------------------------|-----------|
| 1     | Foundation & Project Setup    | Git, env config, docs, cleanup       | Immediate |
| 2     | Backend Modularization        | Split routes, middleware, services    | High      |
| 3     | Frontend Decomposition        | Split App.jsx into pages/components  | High      |
| 4     | State Management              | Context API + custom hooks           | High      |
| 5     | CSS Architecture              | Split App.css, add theming tokens    | Medium    |
| 6     | Security Hardening            | JWT auth, route protection, CORS     | High      |
| 7     | API Client Refactor           | Split appApi.js by domain            | Medium    |
| 8     | Testing                       | Unit + integration tests             | Medium    |
| 9     | Polish & Production Readiness | Error boundaries, loading, a11y      | Low       |

---

## Phase 1: Foundation & Project Setup

**Goal:** Establish project infrastructure and development standards.

### Tasks

| #   | Task                                        | Details                                                |
|-----|---------------------------------------------|--------------------------------------------------------|
| 1.1 | Initialize Git repository                   | `git init`, create `.gitignore`                        |
| 1.2 | Create environment config                   | `.env` with `PORT`, `API_URL`, `DB_PATH`               |
| 1.3 | Add `.env.example`                          | Template for other developers                          |
| 1.4 | Create `docs/` directory                    | Architecture doc + project plan (this file)            |
| 1.5 | Remove unused component files               | Delete `src/components/board/CreateIssueForm.jsx`, etc.|
| 1.6 | Update `index.html` title                   | Change from "jira" to "ECM Project Tracker"            |
| 1.7 | Establish ESLint configuration              | Review and lock down `eslint.config.js`                |

### Deliverables
- Git repo initialized with clean history
- Environment configuration in place
- Dead code removed

### Estimated Effort: Small

---

## Phase 2: Backend Modularization

**Goal:** Split `server/index.js` (583 lines) into modular route files with proper middleware.

### Tasks

| #   | Task                                        | Details                                                |
|-----|---------------------------------------------|--------------------------------------------------------|
| 2.1 | Create `server/config.js`                   | Centralize port, DB path, env reading                  |
| 2.2 | Extract seed data from `db.js`              | Move seed functions to `server/seed.js`                |
| 2.3 | Create `server/routes/auth.js`              | Move signup + login endpoints                          |
| 2.4 | Create `server/routes/issues.js`            | Move GET/POST/PATCH issue endpoints                    |
| 2.5 | Create `server/routes/sprints.js`           | Move sprint CRUD endpoints                             |
| 2.6 | Create `server/routes/dashboard.js`         | Move dashboard aggregation endpoint                    |
| 2.7 | Create `server/routes/reports.js`           | Move reports endpoint                                  |
| 2.8 | Create `server/routes/roadmap.js`           | Move roadmap endpoint                                  |
| 2.9 | Create `server/routes/workflows.js`         | Move workflows endpoint                                |
| 2.10| Create `server/routes/profile.js`           | Move profile GET/PUT endpoints                         |
| 2.11| Create `server/routes/members.js`           | Move members CRUD + resend endpoints                   |
| 2.12| Create `server/routes/activity.js`          | Move activity endpoint                                 |
| 2.13| Create `server/middleware/errorHandler.js`  | Centralized async error wrapper                        |
| 2.14| Create `server/middleware/validate.js`      | Reusable request validation helpers                    |
| 2.15| Slim down `server/index.js`                 | Just app setup + route mounting (~50 lines)            |
| 2.16| Verify all API endpoints still work         | Manual smoke test all endpoints                        |

### File Changes
```
BEFORE:                          AFTER:
server/index.js (583 lines) →   server/index.js (~50 lines)
server/db.js    (384 lines) →   server/db.js (~120 lines)
                                 server/config.js (~20 lines)
                                 server/seed.js (~250 lines)
                                 server/routes/auth.js
                                 server/routes/issues.js
                                 server/routes/sprints.js
                                 server/routes/dashboard.js
                                 server/routes/reports.js
                                 server/routes/roadmap.js
                                 server/routes/workflows.js
                                 server/routes/profile.js
                                 server/routes/members.js
                                 server/routes/activity.js
                                 server/middleware/errorHandler.js
                                 server/middleware/validate.js
```

### Deliverables
- Each domain has its own route file
- Server entry point is slim and readable
- Error handling is centralized
- All endpoints verified working

### Estimated Effort: Medium

---

## Phase 3: Frontend Decomposition

**Goal:** Break `App.jsx` (3,068 lines) into individual page and component files.

### Tasks

| #   | Task                                        | Lines Moved | Target File                              |
|-----|---------------------------------------------|-------------|------------------------------------------|
| 3.1 | Extract `LoginPage`                         | ~75         | `src/pages/LoginPage/LoginPage.jsx`      |
| 3.2 | Extract `DashboardPage`                     | ~360        | `src/pages/DashboardPage/DashboardPage.jsx`|
| 3.3 | Extract `BacklogPage`                       | ~550        | `src/pages/BacklogPage/BacklogPage.jsx`  |
| 3.4 | Extract `BoardPage`                         | ~160        | `src/pages/BoardPage/BoardPage.jsx`      |
| 3.5 | Extract `ReportsPage`                       | ~120        | `src/pages/ReportsPage/ReportsPage.jsx`  |
| 3.6 | Extract `RoadmapPage`                       | ~30         | `src/pages/RoadmapPage/RoadmapPage.jsx`  |
| 3.7 | Extract `WorkflowsPage`                     | ~200        | `src/pages/WorkflowsPage/WorkflowsPage.jsx`|
| 3.8 | Extract `ProfilePage`                       | ~250        | `src/pages/ProfilePage/ProfilePage.jsx`  |
| 3.9 | Extract `IssueDetailPage`                   | ~200        | `src/pages/IssueDetailPage/IssueDetailPage.jsx`|
| 3.10| Extract `Sidebar`                           | ~250        | `src/components/layout/Sidebar.jsx`      |
| 3.11| Extract `Topbar`                            | ~115        | `src/components/layout/Topbar.jsx`       |
| 3.12| Extract `ProjectTopPanel`                   | ~60         | `src/components/layout/ProjectTopPanel.jsx`|
| 3.13| Extract SVG icon components                 | ~90         | `src/components/icons/*.jsx`             |
| 3.14| Extract `CreateIssueModal`                  | ~115        | `src/components/issues/CreateIssueModal.jsx`|
| 3.15| Extract `BacklogIssueRow`                   | ~50         | `src/components/issues/BacklogIssueRow.jsx`|
| 3.16| Extract `IssueRow`                          | ~25         | `src/components/issues/IssueRow.jsx`     |
| 3.17| Extract `ActivityItem`                      | ~15         | `src/components/activity/ActivityItem.jsx`|
| 3.18| Extract `StatCard`                          | ~10         | `src/components/ui/StatCard.jsx`         |
| 3.19| Extract utility functions                   | ~20         | `src/utils/helpers.js`                   |
| 3.20| Slim down `App.jsx`                         | -           | ~80 lines (router + providers only)      |
| 3.21| Delete old unused components                | -           | Remove stale files in components/        |
| 3.22| Verify app renders and navigates correctly  | -           | Manual smoke test all pages              |

### Result
```
BEFORE:                          AFTER:
src/App.jsx (3,068 lines)  →    src/App.jsx (~80 lines)
                                 9 page files
                                 12+ component files
                                 1 utils file
```

### Deliverables
- Each page is a standalone file < 300 lines
- Shared components are reusable
- App.jsx is just routing shell
- All pages render correctly

### Estimated Effort: Large

---

## Phase 4: State Management

**Goal:** Replace prop drilling with React Context + custom hooks.

### Tasks

| #   | Task                                        | Details                                                |
|-----|---------------------------------------------|--------------------------------------------------------|
| 4.1 | Create `AuthContext` + `useAuth`            | Manages user, login, logout, isAuthenticated           |
| 4.2 | Create `ThemeContext` + `useTheme`          | Manages theme, persist to localStorage                 |
| 4.3 | Create `IssueContext` + `useIssues`         | Manages issues array, create, move                     |
| 4.4 | Create `SprintContext` + `useSprints`       | Manages sprints, create, start, update, delete         |
| 4.5 | Create `AppDataContext` + `useAppData`      | Dashboard, reports, roadmap, workflows, activity       |
| 4.6 | Create `MemberContext` + `useMembers`       | Members list, invite, resend                           |
| 4.7 | Wire providers into App.jsx                 | Nest providers in correct order                        |
| 4.8 | Refactor all pages to use hooks             | Replace props with useAuth(), useIssues(), etc.        |
| 4.9 | Remove prop drilling from App component     | App no longer passes state down                        |
| 4.10| Verify state flows correctly                | Test all CRUD operations still work                    |

### Deliverables
- Zero prop drilling from App component
- Each page consumes state via hooks
- Clean separation of concerns

### Estimated Effort: Medium-Large

---

## Phase 5: CSS Architecture

**Goal:** Break `App.css` (4,168 lines) into modular, co-located stylesheets.

### Tasks

| #   | Task                                        | Details                                                |
|-----|---------------------------------------------|--------------------------------------------------------|
| 5.1 | Create `src/styles/variables.css`           | CSS custom properties (colors, spacing, typography)    |
| 5.2 | Create `src/styles/reset.css`               | Base reset + body styles                               |
| 5.3 | Create `src/styles/theme.css`               | Light/dark theme token definitions                     |
| 5.4 | Create `src/styles/layout.css`              | Workspace grid, sidebar, content area                  |
| 5.5 | Extract login styles                        | `src/pages/LoginPage/LoginPage.css`                    |
| 5.6 | Extract dashboard styles                    | `src/pages/DashboardPage/DashboardPage.css`            |
| 5.7 | Extract backlog styles                      | `src/pages/BacklogPage/BacklogPage.css`                |
| 5.8 | Extract board styles                        | `src/pages/BoardPage/BoardPage.css`                    |
| 5.9 | Extract reports styles                      | `src/pages/ReportsPage/ReportsPage.css`                |
| 5.10| Extract profile styles                      | `src/pages/ProfilePage/ProfilePage.css`                |
| 5.11| Extract sidebar styles                      | `src/components/layout/Sidebar.css`                    |
| 5.12| Extract topbar styles                       | `src/components/layout/Topbar.css`                     |
| 5.13| Extract shared component styles             | `src/components/ui/ui.css`, `issues/issues.css`        |
| 5.14| Delete monolithic `App.css`                 | Replace with imports in each file                      |
| 5.15| Verify all styles render correctly          | Visual regression check on all pages                   |

### Deliverables
- Each page/component owns its styles
- Theme tokens defined once, consumed everywhere
- No single file > 300 lines of CSS

### Estimated Effort: Medium

---

## Phase 6: Security Hardening

**Goal:** Add proper authentication and API security.

### Tasks

| #   | Task                                        | Details                                                |
|-----|---------------------------------------------|--------------------------------------------------------|
| 6.1 | Add `jsonwebtoken` dependency               | `npm install jsonwebtoken`                             |
| 6.2 | Implement JWT token generation              | Issue access token on login/signup                     |
| 6.3 | Create `server/middleware/authGuard.js`     | Verify JWT on protected routes                         |
| 6.4 | Apply authGuard to all non-auth routes      | `/api/issues`, `/api/sprints`, etc.                    |
| 6.5 | Update frontend API client                  | Send `Authorization: Bearer <token>` header            |
| 6.6 | Store token securely on frontend            | httpOnly cookie or secure localStorage                 |
| 6.7 | Configure CORS with specific origins        | Restrict to dev + production domains                   |
| 6.8 | Add rate limiting (optional)                | Protect auth endpoints from brute force                |
| 6.9 | Verify auth flow end-to-end                 | Login → token → API calls → logout                    |

### Deliverables
- JWT-based authentication
- All API routes protected
- CORS properly configured
- Token handled securely on frontend

### Estimated Effort: Medium

---

## Phase 7: API Client Refactor

**Goal:** Split `appApi.js` into domain-specific modules.

### Tasks

| #   | Task                                        | Details                                                |
|-----|---------------------------------------------|--------------------------------------------------------|
| 7.1 | Create `src/api/client.js`                  | Base fetch wrapper with auth headers + error handling  |
| 7.2 | Create `src/api/authApi.js`                 | signup, login                                          |
| 7.3 | Create `src/api/issueApi.js`                | fetchIssues, fetchById, create, updateStatus           |
| 7.4 | Create `src/api/sprintApi.js`               | fetchSprints, create, start, update, delete            |
| 7.5 | Create `src/api/dashboardApi.js`            | fetchDashboard                                         |
| 7.6 | Create `src/api/reportApi.js`               | fetchReports                                           |
| 7.7 | Create `src/api/memberApi.js`               | fetchMembers, invite, resend                           |
| 7.8 | Create `src/api/profileApi.js`              | fetchProfile, updateProfile                            |
| 7.9 | Delete old `appApi.js`                      | Replace all imports                                    |
| 7.10| Verify all API calls still work             | Smoke test every feature                               |

### Deliverables
- Each API domain in its own file
- Centralized auth header injection
- Clean import paths

### Estimated Effort: Small

---

## Phase 8: Testing

**Goal:** Add test infrastructure and initial test coverage.

### Tasks

| #   | Task                                        | Details                                                |
|-----|---------------------------------------------|--------------------------------------------------------|
| 8.1 | Install testing dependencies                | `vitest`, `@testing-library/react`, `supertest`        |
| 8.2 | Configure Vitest                            | `vitest.config.js` with react plugin                   |
| 8.3 | Write API route tests                       | Test each endpoint with `supertest`                    |
| 8.4 | Write component unit tests                  | Test key UI components render correctly                |
| 8.5 | Write context/hook tests                    | Test state management logic                            |
| 8.6 | Add test script to `package.json`           | `npm test` runs all tests                              |
| 8.7 | Target 60%+ coverage on critical paths      | Auth, issues, sprints                                  |

### Deliverables
- Test infrastructure set up
- Key paths covered
- CI-ready test scripts

### Estimated Effort: Medium

---

## Phase 9: Polish & Production Readiness

**Goal:** Handle edge cases, improve UX, prepare for deployment.

### Tasks

| #   | Task                                        | Details                                                |
|-----|---------------------------------------------|--------------------------------------------------------|
| 9.1 | Add React Error Boundaries                  | Wrap pages with error fallback UI                      |
| 9.2 | Add loading skeletons                       | Replace "Loading workspace..." with skeleton UI        |
| 9.3 | Add 404 page                                | Handle unknown routes                                  |
| 9.4 | Accessibility audit                         | aria labels, keyboard nav, focus management            |
| 9.5 | Add favicon and meta tags                   | Proper branding                                        |
| 9.6 | Production build verification               | `npm run build` + test dist output                     |
| 9.7 | Add deployment configuration                | Dockerfile or hosting config as needed                 |

### Deliverables
- Graceful error handling
- Better loading states
- Production-ready build

### Estimated Effort: Small-Medium

---

## Execution Order & Dependencies

```
Phase 1 (Foundation)
  │
  ├──→ Phase 2 (Backend Modularization)
  │         │
  │         └──→ Phase 6 (Security) ──→ Phase 7 (API Client)
  │
  └──→ Phase 3 (Frontend Decomposition)
            │
            ├──→ Phase 4 (State Management)
            │
            └──→ Phase 5 (CSS Architecture)
                      │
                      └──→ Phase 8 (Testing) ──→ Phase 9 (Polish)
```

**Critical path:** Phase 1 → Phase 3 → Phase 4 (unblocks all frontend work)
**Parallel track:** Phase 2 can run alongside Phase 3

---

## Risk Register

| Risk                                      | Likelihood | Impact | Mitigation                                    |
|-------------------------------------------|------------|--------|-----------------------------------------------|
| Breaking changes during extraction        | High       | High   | Extract one file at a time, test after each   |
| CSS style regressions                     | Medium     | Medium | Visual compare before/after each extraction   |
| State bugs after context migration        | Medium     | High   | Migrate one context at a time, verify CRUD    |
| Auth migration breaks existing sessions   | Low        | Medium | Keep localStorage fallback during transition  |
| Merge conflicts if multiple devs          | Medium     | Low    | Clear phase ownership, avoid touching same files |

---

## Success Criteria

| Metric                                | Target                    |
|---------------------------------------|---------------------------|
| Max lines per file (JSX)              | < 300 lines               |
| Max lines per file (CSS)              | < 400 lines               |
| App.jsx size                          | < 100 lines               |
| server/index.js size                  | < 60 lines                |
| All existing features working         | 100%                      |
| Zero prop drilling from App           | 0 props passed through    |
| Protected API routes                  | All non-auth routes       |
| Test coverage (critical paths)        | > 60%                     |
