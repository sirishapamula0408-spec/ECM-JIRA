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

## Deployment (JL-97)

Production runs a single Node container that serves both the REST API and the
built frontend. When `NODE_ENV=production` (or `SERVE_STATIC=1`) is set, Express
serves `/dist` via `express.static` with an SPA history-fallback (see
`server/serveStatic.js`); `/api/*` routes are unaffected.

```bash
# Build + run the full stack (app + postgres) in production mode:
JWT_SECRET=$(openssl rand -hex 32) \
  docker compose -f docker-compose.prod.yml up -d --build

# With an nginx TLS-terminating reverse proxy (see nginx.conf.example):
docker compose -f docker-compose.prod.yml --profile proxy up -d --build
```

- `Dockerfile` — multi-stage: builds the Vite frontend, then runs the API serving `/dist`.
- `docker-compose.prod.yml` — app + postgres (+ optional `nginx` proxy under the `proxy` profile).
- `nginx.conf.example` — HTTPS/reverse-proxy termination (copy to `nginx.conf`, add certs).

### Backups

`scripts/backup-db.sh` runs a `pg_dump` (custom format, gzip'd) into `./backups`
with configurable retention (`RETENTION_DAYS`, default 14). Schedule it via cron:

```bash
30 2 * * * DATABASE_URL=postgresql://... /path/to/scripts/backup-db.sh >> backup.log 2>&1
```

Restore with `pg_restore --clean --if-exists -d "$DATABASE_URL" <dumpfile>` (see the
script header for details).

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

## Security

### Secret handling & rotation (JL-102)

- **Never commit secrets.** `.env` is gitignored; only `.env.example` (with
  placeholder values) is tracked. Copy `.env.example` to `.env` and fill in
  real values locally.
- **Startup validation.** `server/config.js` exports `validateConfig(env)` and
  `assertValidConfig()`, called from `server/index.js` at boot. In
  `NODE_ENV=production`, the server refuses to start if `JWT_SECRET` is missing,
  too short, or set to a known default/placeholder (e.g. the dev default
  `ecm-jira-dev-secret-change-in-production`), or if `DATABASE_URL` is unset.
  Dev/test runs are lenient and only emit warnings.
- **Generate a strong `JWT_SECRET`:**
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
- **Rotation.** Rotate `JWT_SECRET`, database credentials, SMTP and OAuth
  secrets periodically and immediately after any suspected exposure. Rotating
  `JWT_SECRET` invalidates all existing sessions (users must re-authenticate).
  Rotate provider (Google/GitHub) client secrets from their respective consoles
  and update `.env`.

### Scanning

- **Dependency / vulnerability (SCA) scanning:** `.github/workflows/security-scan.yml`
  runs `npm audit --audit-level=high` on push/PR and weekly.
- **Secret scanning:** the same workflow runs gitleaks over git history plus an
  in-repo, dependency-free scanner. Run it locally before pushing:
  ```bash
  npm run scan:secrets   # node scripts/scan-secrets.mjs
  ```
  It exits non-zero if AWS keys, private-key headers, provider tokens, or
  high-entropy secret literals are found in tracked files.
