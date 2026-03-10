# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ECM JIRA Clone — a full-stack agile project management tool (JIRA clone) built with React 19 + Vite (frontend) and Express 5 + SQLite (backend).

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
- **State management:** React Context API — 6 nested providers in `App.jsx`:
  `AuthContext → ThemeContext → IssueContext → SprintContext → AppDataContext → MemberContext`
- **API layer:** `src/api/client.js` is a fetch wrapper that auto-injects JWT Bearer tokens from localStorage/sessionStorage. Domain-specific modules (`issueApi.js`, `sprintApi.js`, etc.) use this client.
- **Pages:** Each feature has its own page component in `src/pages/` with co-located CSS
- **Styles:** CSS custom properties in `src/styles/variables.css`, theme support (light/dark) in `theme.css`

### Backend (`server/`)
- **Entry:** `server/index.js` — Express app with CORS, JSON parsing, route registration
- **Auth:** JWT-based. `authGuard.js` middleware verifies tokens on protected routes. Tokens issued with configurable expiry (1d standard, 30d for "remember me").
- **Database:** SQLite at `server/data/jira.db`. Schema and migrations handled in `server/db.js` (auto-creates tables, adds missing columns, normalizes legacy data).
- **Routes:** RESTful API under `/api/` — auth, issues, sprints, projects, dashboard, reports, roadmap, workflows, members, profile, activity, comments, filters
- **Config:** `server/config.js` reads from `.env` (PORT, DB_PATH, JWT_SECRET, SMTP settings)

### API Proxy
Vite dev server proxies `/api/*` requests to `http://localhost:4000` (configured in `vite.config.js`).

### Key Constants
`src/constants.js` defines statuses (`Backlog → To Do → In Progress → Code Review → Done`), priorities, and issue types used across the app.

## Environment
Copy `.env.example` to `.env`. Key variables: `PORT`, `VITE_API_URL`, `DB_PATH`, `JWT_SECRET`, SMTP config for email features.
