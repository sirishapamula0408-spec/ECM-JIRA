---
name: run-app
description: Launch and drive the ECM JIRA Clone full-stack app (Vite frontend + Express API + PostgreSQL). Use when asked to run, start, or smoke-test the app locally, or to confirm a change works in the real app.
---

# Run the ECM JIRA Clone app

Full-stack app: **Vite/React frontend** on port `5173` and **Express API** on port
`4000`, both started by one `npm run dev` process. The API needs **PostgreSQL**
reachable at the `DATABASE_URL` in `.env` (default `localhost:5432`, db `jira_lite`,
user `jira_lite`, password `jira_lite_dev`).

## Prerequisites (check once)

- `.env` exists (copy from `.env.example` if not) and `node_modules` is installed
  (`npm install`).
- PostgreSQL is listening on 5432. Either `docker compose up -d` (brings up the
  `jira-lite-db` container with the right owner already) **or** a locally-installed
  PostgreSQL.

### ⚠️ Local PostgreSQL gotcha — `permission denied for schema public`

If you use a **directly-installed** PostgreSQL (not the docker-compose one) and the
API crash-loops on startup with:

```
Database init failed: error: permission denied for schema public   (code 42501)
```

the `jira_lite` role connects but doesn't **own** the database, and PostgreSQL 15+
gives non-owner roles no `CREATE` on schema `public`, so `initializeDatabase()`
fails on the first `CREATE TABLE`. Fix it once, as a superuser (default superuser is
`postgres`; on this project's setup its password is also `jira_lite_dev`):

```bash
PGPASSWORD=jira_lite_dev psql -U postgres -h localhost -d jira_lite \
  -c "ALTER DATABASE jira_lite OWNER TO jira_lite; GRANT ALL ON SCHEMA public TO jira_lite;"
```

This persists in Postgres — you only need it once per database. Docker Compose avoids
it entirely because `POSTGRES_USER=jira_lite` makes that role the DB owner.

## Run

Start both servers in the background and smoke-test them with the helper script:

```bash
bash .claude/skills/run-app/smoke.sh
```

It launches `npm run dev`, waits for the API `/api/health` to return `ok` and the
Vite dev server to answer, prints the result, and leaves both running. Exit code `0`
means healthy. Logs go to the path it prints.

To launch manually instead:

```bash
npm run dev            # foreground; Ctrl-C to stop
```

- Frontend: **http://localhost:5173/**
- API ready line in the log: `API server running at http://localhost:4000`
- Health check: `curl http://localhost:4000/api/health` → `{"status":"ok"}`

nodemon auto-restarts the API on changes under `server/`. Touch a server file to force
a restart (e.g. after applying the DB fix): `touch server/index.js`.

## Drive it

- **API:** `curl -s http://localhost:4000/api/health` → `{"status":"ok"}`. A login
  attempt exercises the DB path:
  `curl -s http://localhost:4000/api/auth/login -X POST -H "Content-Type: application/json" -d '{"email":"x@sedintechnologies.com","password":"wrong"}'`
  → `{"error":"Invalid email or password"}` (proves handler + `users` table work).
- **UI:** open http://localhost:5173/ in a browser and register / log in.

## Stop

```bash
pkill -f "concurrently"   # or kill the background job you started
```
