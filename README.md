# Project Tracker (React + SQLite)

This app is designed from the screens in `D:\JIRA_Screens` and implemented with:

- Frontend: React + Vite
- Backend: Express + SQLite

## Run

```bash
npm install
npm run dev
```

## URLs

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000`

## Implemented Screens

- Login
- Dashboard
- Backlog Management
- Kanban Board
- Reporting Dashboard
- Roadmap
- Issue Workflows
- Issue Detail
- Public Profile

## API Endpoints

- `GET /api/health`
- `GET /api/dashboard`
- `GET /api/issues`
- `GET /api/issues/:id`
- `POST /api/issues`
- `PATCH /api/issues/:id/status`
- `GET /api/reports`
- `GET /api/roadmap`
- `GET /api/workflows`
- `GET /api/profile`
- `PUT /api/profile`
- `GET /api/members`
- `GET /api/activity`
