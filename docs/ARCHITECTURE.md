# ECM-JIRA Application Architecture

## 1. Current State Assessment

### 1.1 Tech Stack
| Layer       | Technology              | Version |
|-------------|-------------------------|---------|
| Frontend    | React + Vite            | 19 / 7  |
| Routing     | React Router            | 7       |
| Backend     | Express (Node.js)       | 5       |
| Database    | SQLite                  | 3       |
| Styling     | Vanilla CSS             | -       |
| Build Tool  | Vite                    | 7.3     |

### 1.2 Current File Map
```
D:\ECM-JIRA
├── index.html
├── vite.config.js
├── package.json
├── server/
│   ├── index.js            (583 lines - ALL routes)
│   ├── db.js               (384 lines - DB + seeds)
│   └── data/jira.db
└── src/
    ├── main.jsx
    ├── App.jsx             (3,068 lines - monolith)
    ├── App.css             (4,168 lines - monolith)
    ├── index.css
    ├── constants.js
    ├── api/appApi.js
    ├── assets/
    └── components/         (7 files - mostly unused)
```

### 1.3 Problems Identified

| #  | Problem                        | Severity | Impact                                    |
|----|--------------------------------|----------|-------------------------------------------|
| P1 | Monolithic App.jsx (3k lines)  | Critical | Unmaintainable, hard to review/test       |
| P2 | Monolithic App.css (4k lines)  | High     | Style conflicts, no scoping               |
| P3 | No state management            | High     | Prop drilling 5+ levels deep              |
| P4 | No auth middleware on backend  | Critical | All API routes are publicly accessible    |
| P5 | Single-file backend            | Medium   | Hard to maintain, no separation of concern|
| P6 | No testing                     | High     | Zero test coverage                        |
| P7 | No TypeScript                  | Medium   | No type safety, harder refactoring        |
| P8 | Unused component files         | Low      | Dead code, confusing structure            |
| P9 | No environment config          | Medium   | Hardcoded ports, no .env support          |
| P10| No error boundaries            | Medium   | Unhandled errors crash entire app         |

---

## 2. Target Architecture

### 2.1 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENT (React)                        │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Pages   │  │Components│  │  Hooks   │  │ Context  │    │
│  │          │  │          │  │          │  │ (State)  │    │
│  │ Dashboard│  │ Sidebar  │  │ useAuth  │  │ AuthCtx  │    │
│  │ Backlog  │  │ Topbar   │  │ useIssues│  │ IssueCtx │    │
│  │ Board    │  │ IssueCard│  │ useSprint│  │ SprintCtx│    │
│  │ Reports  │  │ Modal    │  │ useTheme │  │ ThemeCtx │    │
│  │ Roadmap  │  │ Badge    │  │          │  │          │    │
│  │ Workflows│  │ Button   │  │          │  │          │    │
│  │ Profile  │  │ Filter   │  │          │  │          │    │
│  │ Issue    │  │ Icons    │  │          │  │          │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                         │                                    │
│                    src/api/                                   │
│              (API client layer)                               │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP (fetch)
                         │ /api/*
┌────────────────────────┴─────────────────────────────────────┐
│                      SERVER (Express)                         │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐               │
│  │ Middleware │  │  Routes   │  │ Services  │               │
│  │           │  │           │  │           │               │
│  │ cors      │  │ /auth     │  │ auth      │               │
│  │ json      │  │ /issues   │  │ issues    │               │
│  │ authGuard │  │ /sprints  │  │ sprints   │               │
│  │ errorHndl │  │ /dashboard│  │ dashboard │               │
│  │ validator │  │ /reports  │  │ members   │               │
│  │           │  │ /members  │  │ profile   │               │
│  │           │  │ /profile  │  │           │               │
│  └───────────┘  └───────────┘  └───────────┘               │
│                         │                                    │
│                   ┌─────┴─────┐                              │
│                   │   db.js   │                              │
│                   │  (SQLite) │                              │
│                   └───────────┘                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Target Folder Structure

```
D:\ECM-JIRA
├── index.html
├── vite.config.js
├── package.json
├── .env                          # Environment variables
├── .env.example                  # Template
├── docs/
│   ├── ARCHITECTURE.md           # This document
│   └── PROJECT_PLAN.md           # Project plan
│
├── server/
│   ├── index.js                  # Server entry (slim)
│   ├── config.js                 # Port, env config
│   ├── db.js                     # DB connection + helpers
│   ├── seed.js                   # Seed data (extracted)
│   ├── middleware/
│   │   ├── authGuard.js          # JWT/session validation
│   │   ├── errorHandler.js       # Centralized error handling
│   │   └── validate.js           # Request validation
│   ├── routes/
│   │   ├── auth.js               # POST /auth/signup, /auth/login
│   │   ├── issues.js             # CRUD /issues
│   │   ├── sprints.js            # CRUD /sprints
│   │   ├── dashboard.js          # GET /dashboard
│   │   ├── reports.js            # GET /reports
│   │   ├── roadmap.js            # GET /roadmap
│   │   ├── workflows.js          # GET /workflows
│   │   ├── profile.js            # GET/PUT /profile
│   │   ├── members.js            # CRUD /members
│   │   └── activity.js           # GET /activity
│   └── data/
│       └── jira.db
│
├── src/
│   ├── main.jsx                  # Entry point
│   ├── App.jsx                   # Shell: router + providers
│   ├── constants.js              # Shared constants
│   │
│   ├── api/
│   │   ├── client.js             # Base fetch wrapper
│   │   ├── authApi.js            # Auth endpoints
│   │   ├── issueApi.js           # Issue endpoints
│   │   ├── sprintApi.js          # Sprint endpoints
│   │   ├── dashboardApi.js       # Dashboard endpoint
│   │   ├── reportApi.js          # Reports endpoint
│   │   ├── memberApi.js          # Member endpoints
│   │   └── profileApi.js         # Profile endpoints
│   │
│   ├── context/
│   │   ├── AuthContext.jsx        # Auth state + login/logout
│   │   ├── IssueContext.jsx       # Issues state + CRUD
│   │   ├── SprintContext.jsx      # Sprint state + CRUD
│   │   ├── ThemeContext.jsx       # Theme state
│   │   └── AppDataContext.jsx     # Dashboard, reports, etc.
│   │
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useIssues.js
│   │   ├── useSprints.js
│   │   ├── useTheme.js
│   │   └── useMembers.js
│   │
│   ├── pages/
│   │   ├── LoginPage/
│   │   │   ├── LoginPage.jsx
│   │   │   └── LoginPage.css
│   │   ├── DashboardPage/
│   │   │   ├── DashboardPage.jsx
│   │   │   └── DashboardPage.css
│   │   ├── BacklogPage/
│   │   │   ├── BacklogPage.jsx
│   │   │   └── BacklogPage.css
│   │   ├── BoardPage/
│   │   │   ├── BoardPage.jsx
│   │   │   └── BoardPage.css
│   │   ├── ReportsPage/
│   │   │   ├── ReportsPage.jsx
│   │   │   └── ReportsPage.css
│   │   ├── RoadmapPage/
│   │   │   ├── RoadmapPage.jsx
│   │   │   └── RoadmapPage.css
│   │   ├── WorkflowsPage/
│   │   │   ├── WorkflowsPage.jsx
│   │   │   └── WorkflowsPage.css
│   │   ├── ProfilePage/
│   │   │   ├── ProfilePage.jsx
│   │   │   └── ProfilePage.css
│   │   └── IssueDetailPage/
│   │       ├── IssueDetailPage.jsx
│   │       └── IssueDetailPage.css
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx
│   │   │   ├── Sidebar.css
│   │   │   ├── Topbar.jsx
│   │   │   ├── Topbar.css
│   │   │   ├── ProjectTopPanel.jsx
│   │   │   └── ProjectTopPanel.css
│   │   ├── icons/
│   │   │   ├── SidebarNavIcon.jsx
│   │   │   ├── TopNavIcon.jsx
│   │   │   └── HeaderPanelIcon.jsx
│   │   ├── issues/
│   │   │   ├── IssueCard.jsx
│   │   │   ├── IssueRow.jsx
│   │   │   ├── BacklogIssueRow.jsx
│   │   │   ├── CreateIssueModal.jsx
│   │   │   └── issues.css
│   │   ├── activity/
│   │   │   ├── ActivityItem.jsx
│   │   │   └── activity.css
│   │   └── ui/
│   │       ├── Badge.jsx
│   │       ├── Button.jsx
│   │       ├── Modal.jsx
│   │       ├── StatCard.jsx
│   │       └── ui.css
│   │
│   ├── styles/
│   │   ├── variables.css         # CSS custom properties
│   │   ├── reset.css             # Base reset styles
│   │   ├── layout.css            # Grid/flex utilities
│   │   └── theme.css             # Light/dark theme tokens
│   │
│   └── utils/
│       ├── helpers.js            # displayNameFromEmail, etc.
│       └── storage.js            # localStorage wrappers
│
└── tests/                        # Future: test directory
    ├── setup.js
    ├── server/
    └── src/
```

### 2.3 State Management Strategy

Replace prop-drilling with React Context + custom hooks:

```
AuthContext       ─── useAuth()       ─── login, logout, user, isAuthenticated
IssueContext      ─── useIssues()     ─── issues, createIssue, moveIssue
SprintContext     ─── useSprints()    ─── sprints, createSprint, startSprint
ThemeContext      ─── useTheme()      ─── theme, toggleTheme
AppDataContext    ─── useAppData()    ─── dashboard, reports, roadmap, etc.
```

**Provider hierarchy in App.jsx:**
```jsx
<ThemeProvider>
  <AuthProvider>
    <AppDataProvider>
      <IssueProvider>
        <SprintProvider>
          <RouterProvider />
        </SprintProvider>
      </IssueProvider>
    </AppDataProvider>
  </AuthProvider>
</ThemeProvider>
```

### 2.4 Routing Architecture

```
/                  → DashboardPage (redirect)
/dashboard         → DashboardPage
/backlog           → BacklogPage
/board             → BoardPage
/reports           → ReportsPage
/roadmap           → RoadmapPage
/workflows         → WorkflowsPage
/profile           → ProfilePage
/issues/:issueId   → IssueDetailPage
/login             → LoginPage (unauthenticated only)
```

Protected routes wrap pages that require authentication.

### 2.5 Backend Route Modularization

Each route file exports an Express Router:

```js
// server/routes/issues.js
import { Router } from 'express'
const router = Router()

router.get('/', async (req, res) => { ... })
router.get('/:id', async (req, res) => { ... })
router.post('/', async (req, res) => { ... })
router.patch('/:id/status', async (req, res) => { ... })

export default router
```

Mounted in `server/index.js`:
```js
app.use('/api/auth', authRoutes)
app.use('/api/issues', authGuard, issueRoutes)
app.use('/api/sprints', authGuard, sprintRoutes)
// ...
```

### 2.6 Security Improvements

| Area              | Current                     | Target                          |
|-------------------|-----------------------------|---------------------------------|
| Authentication    | localStorage user object    | JWT tokens (access + refresh)   |
| API Protection    | None                        | authGuard middleware on routes   |
| Password Storage  | PBKDF2 (good)               | Keep PBKDF2 (already secure)    |
| Input Validation  | Partial server-side         | Full validation middleware      |
| CORS              | Wide open `cors()`          | Configured origin whitelist     |
| Error Handling    | Inline try/catch            | Centralized error handler       |

---

## 3. Component Dependency Map

### Pages and their key component dependencies:

```
LoginPage
  └── (self-contained)

DashboardPage
  ├── ActivityItem
  ├── StatCard
  └── Filter components (inline)

BacklogPage
  ├── BacklogIssueRow
  ├── TopNavIcon
  └── Quick create (inline)

BoardPage
  └── IssueCard (kanban cards)

ReportsPage
  ├── StatCard
  └── Charts (inline)

RoadmapPage
  └── Table (inline)

WorkflowsPage
  └── List table (inline)

ProfilePage
  └── Invite form (inline)

IssueDetailPage
  └── Comment section (inline)

--- Shared Layout ---
Sidebar
  └── SidebarNavIcon

Topbar
  └── HeaderPanelIcon

ProjectTopPanel
  └── TopNavIcon
```

---

## 4. Database Schema

```sql
-- Authentication
users (id, email, password_hash, created_at)

-- Core Issue Tracking
issues (id, issue_key, title, description, priority, assignee,
        status, issue_type, sprint_id, created_at)
sprints (id, name, date_range, is_started)

-- Supporting Data
activity (id, actor, action, happened_at)
members (id, name, email, role, status, task_count, invited_by)
roadmap_epics (id, name, phase, start_date, end_date)
workflows (id, issue_type, workflow_name, workflow_status)
profile (id, full_name, job_title, department, timezone, avatar_url)
```

### Relationships:
- `issues.sprint_id` → `sprints.id` (many-to-one)
- `issues.status` is constrained to: Backlog, To Do, In Progress, Code Review, Done
- `issues.priority` is constrained to: Low, Medium, High
- `issues.issue_type` is constrained to: Story, Bug, Task
