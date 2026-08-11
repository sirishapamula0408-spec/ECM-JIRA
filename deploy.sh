#!/usr/bin/env bash
#
# deploy.sh — deploy the latest `main` of ECM JIRA Clone on this server.
#
# Run this ON the deployment box (e.g. 20.219.248.167), from the app's
# repo directory. It stops the running app, fast-forwards to origin/main,
# installs deps, guarantees the required env + database are up, restarts
# the app detached, and health-checks it.
#
#   Usage:   ./deploy.sh                 # deploy origin/main
#            BRANCH=main ./deploy.sh     # deploy a specific branch
#            SKIP_DB=1 ./deploy.sh       # don't touch docker/postgres
#
#            PROCESS_MANAGER=pm2 ./deploy.sh    # supervise via PM2 (optional)
#            PROCESS_MANAGER=systemd ./deploy.sh
#
# Serving model (JL-326): this deploys a real BUILT ARTIFACT, not a dev
# server. It runs `npm run build` to emit the SPA into dist/, then starts the
# API with NODE_ENV=production so Express serves that dist/ itself (static
# assets + SPA history-fallback — see server/serveStatic.js, JL-97). One Node
# process, one port (API_PORT, default 4000), no Vite and no nodemon.
#
# What that fixes versus the old `npm run dev` deploy:
#   * Raw sources are no longer public. Vite's dev server served the working
#     tree, so GET /src/App.jsx returned the file; dist/ contains only the
#     compiled, hashed bundle.
#   * The API no longer bounces. nodemon restarted the server on any stray
#     write inside the repo (a log file, an editor swap file, a git checkout);
#     `node server/index.js` does not watch the filesystem.
#
# What it does NOT fix by itself — these are box-side, opt-in:
#   * Restart on crash/reboot. The default launcher is plain `nohup`, which
#     gives you neither. Set PROCESS_MANAGER=pm2 (uses ecosystem.config.cjs)
#     or PROCESS_MANAGER=systemd (uses deploy/systemd/jira-lite-api.service)
#     once that supervisor is installed on the box; see deploy/README.md.
#     Kept optional on purpose so the script never hard-depends on a globally
#     installed tool.
#   * HTTPS. Terminate TLS in front of API_PORT with a reverse proxy —
#     nginx.conf.example ships a working config — or run the container stack
#     in docker-compose.prod.yml. Nothing here opens :443.
#
# For the nginx-serves-dist/ + PM2 layout, use ./deploy.prod.sh instead (see
# deploy/README.md). This script deliberately needs nothing beyond git/node/npm.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config (override via env)
# ---------------------------------------------------------------------------
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
API_PORT="${API_PORT:-4000}"   # single port: REST API *and* the built frontend
LOG_FILE="${LOG_FILE:-$APP_DIR/app.log}"
# none => nohup (no extra tooling). pm2/systemd are optional and must already
# be installed on the box; they add restart-on-crash/boot. See the header.
PROCESS_MANAGER="${PROCESS_MANAGER:-none}"
SYSTEMD_UNIT="${SYSTEMD_UNIT:-jira-lite-api}"
HEALTH_URL="http://localhost:${API_PORT}/api/health"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"   # seconds to wait for /api/health

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok  ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail ]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "APP_DIR not found: $APP_DIR"
log "Deploying '$BRANCH' in $APP_DIR"

# ---------------------------------------------------------------------------
# 0. Sanity checks
# ---------------------------------------------------------------------------
command -v git  >/dev/null || die "git not installed"
command -v node >/dev/null || die "node not installed"
command -v npm  >/dev/null || die "npm not installed"
[ -d .git ]      || die "$APP_DIR is not a git repository"
[ -f package.json ] || die "no package.json in $APP_DIR"

# ---------------------------------------------------------------------------
# 1. Stop the running app (best-effort; ignore 'no process' errors)
# ---------------------------------------------------------------------------
# The concurrently/vite/nodemon kills stay so that a box still running the
# pre-JL-326 dev-server deploy is cleaned up on the first upgrade and can't keep
# holding :4000 / :5173.
log "Stopping running app (and any legacy dev-server processes)…"
pkill -f "concurrently" 2>/dev/null || true
pkill -f "vite"         2>/dev/null || true
pkill -f "nodemon"      2>/dev/null || true
# The unsupervised production process is `node server/index.js`. Under
# pm2/systemd, leave it alone: the supervisor owns the lifecycle and would just
# restart it on the old code (burning its restart budget) before we rebuild.
if [ "$PROCESS_MANAGER" = "none" ]; then
  pkill -f "node server/index.js" 2>/dev/null || true
fi
# Give sockets a moment to free up so the restart can bind the ports.
sleep 2
ok "Old processes signalled"

# ---------------------------------------------------------------------------
# 2. Fast-forward to origin/<branch>
# ---------------------------------------------------------------------------
log "Fetching origin…"
git fetch origin --prune
CURRENT_SHA="$(git rev-parse HEAD)"
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
NEW_SHA="$(git rev-parse HEAD)"
if [ "$CURRENT_SHA" = "$NEW_SHA" ]; then
  warn "Already at $NEW_SHA (no new commits) — redeploying anyway"
else
  ok "Updated $CURRENT_SHA -> $NEW_SHA"
fi

# ---------------------------------------------------------------------------
# 3. Install dependencies (only when the lockfile changed, unless forced)
# ---------------------------------------------------------------------------
if [ "${FORCE_INSTALL:-0}" = "1" ] || ! git diff --quiet "$CURRENT_SHA" "$NEW_SHA" -- package-lock.json package.json 2>/dev/null; then
  log "Installing dependencies (npm ci)…"
  npm ci || { warn "npm ci failed — falling back to npm install"; npm install; }
  ok "Dependencies installed"
else
  log "No dependency changes — skipping install (FORCE_INSTALL=1 to force)"
fi

# Everything from here on runs in production mode. Exported AFTER the install
# step on purpose: `npm ci` with NODE_ENV=production omits devDependencies, and
# vite lives there — the build would fail. SERVE_STATIC is belt-and-braces, it
# makes shouldServeStatic() true even if NODE_ENV is ever dropped.
export NODE_ENV=production
export SERVE_STATIC=1

# ---------------------------------------------------------------------------
# 4. Environment: .env must exist and carry JWT_SECRET (app hard-fails without it)
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  [ -f .env.example ] && cp .env.example .env && warn "Created .env from .env.example — review it!" \
    || die "No .env and no .env.example to seed from"
fi
# Under NODE_ENV=production, server/config.js (assertValidConfig, JL-102) turns a
# missing / too-short (<16 chars) / known-placeholder JWT_SECRET into a FATAL
# startup error instead of a warning — so a value that merely exists is no longer
# good enough. Replace an unusable one here rather than deploying a server that
# refuses to boot.
CURRENT_SECRET="$(sed -n 's/^JWT_SECRET=//p' .env | head -n 1)"
if [ "${#CURRENT_SECRET}" -lt 16 ] ||
   printf '%s' "$CURRENT_SECRET" | grep -qiE '^(change|changeme|secret|jwt-secret|your-secret|dev-secret|test-secret|password|placeholder|ecm-jira-dev-secret)'; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  # Replace an existing JWT_SECRET= line if present, else append.
  if grep -q '^JWT_SECRET=' .env; then
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env
  else
    printf '\nJWT_SECRET=%s\n' "$SECRET" >> .env
  fi
  ok "Generated a JWT_SECRET into .env (previous value was missing or insecure — existing sessions are invalidated)"
else
  ok ".env has a usable JWT_SECRET"
fi

# Also fatal in production if absent (assertValidConfig), and there is no sane
# default to invent for someone else's database.
if ! grep -q '^DATABASE_URL=..*' .env && [ -z "${DATABASE_URL:-}" ]; then
  die "DATABASE_URL is not set in .env — required with NODE_ENV=production"
fi

# ---------------------------------------------------------------------------
# 5. Database: make sure PostgreSQL is reachable
# ---------------------------------------------------------------------------
if [ "${SKIP_DB:-0}" != "1" ]; then
  if command -v docker >/dev/null && [ -f docker-compose.yml ]; then
    log "Ensuring PostgreSQL container is up (docker compose)…"
    (docker compose up -d 2>/dev/null || docker-compose up -d) && ok "Postgres container up" \
      || warn "Could not start Postgres via compose — ensure DB is running some other way"
  else
    warn "docker/compose not available — assuming PostgreSQL is already running (DATABASE_URL in .env)"
  fi
else
  log "SKIP_DB=1 — not touching the database"
fi

# ---------------------------------------------------------------------------
# 6. Build the frontend artifact that the API will serve
#
# `set -e` aborts the deploy if the build fails, and the explicit index.html
# check below catches a build that "succeeded" without emitting anything. Either
# way we never reach step 7, so the server is never started against a stale or
# missing dist/. Removing dist/ first guarantees the artifact we serve came from
# THIS commit — a partial build cannot leave last release's index.html behind.
# ---------------------------------------------------------------------------
log "Building frontend (npm run build) — NODE_ENV=$NODE_ENV"
rm -rf dist
npm run build
[ -f dist/index.html ] || die "build did not produce dist/index.html — refusing to start without an artifact"
ok "Built dist/ ($(du -sh dist 2>/dev/null | cut -f1)) — Express will serve it (JL-97 serveStatic)"

# ---------------------------------------------------------------------------
# 7. Start the API (which also serves dist/), detached so it survives this
#    shell/SSH session. `npm run server` == `node server/index.js`: no Vite,
#    no nodemon, no file watching.
# ---------------------------------------------------------------------------
case "$PROCESS_MANAGER" in
  pm2)
    command -v pm2 >/dev/null || die "PROCESS_MANAGER=pm2 but pm2 is not installed (npm i -g pm2), or use PROCESS_MANAGER=none"
    mkdir -p logs
    log "Starting API under PM2 (ecosystem.config.cjs)…"
    pm2 startOrReload ecosystem.config.cjs --update-env
    pm2 save >/dev/null 2>&1 || warn "pm2 save failed — run 'pm2 startup' once for boot persistence"
    ok "API running under PM2 (restarts on crash/boot) — logs: pm2 logs jira-lite-api"
    ;;
  systemd)
    command -v systemctl >/dev/null || die "PROCESS_MANAGER=systemd but systemctl is not available"
    log "Restarting API via systemd ($SYSTEMD_UNIT)…"
    sudo systemctl restart "$SYSTEMD_UNIT"
    ok "API running under systemd (restarts on crash/boot) — logs: journalctl -u $SYSTEMD_UNIT -f"
    ;;
  none)
    log "Starting API (npm run server) — logging to $LOG_FILE"
    nohup npm run server > "$LOG_FILE" 2>&1 &
    APP_PID=$!
    disown "$APP_PID" 2>/dev/null || true
    ok "Started (pid $APP_PID)"
    warn "nohup does not restart the app on crash or reboot — use PROCESS_MANAGER=pm2|systemd for that"
    ;;
  *)
    die "Unknown PROCESS_MANAGER='$PROCESS_MANAGER' (expected none, pm2 or systemd)"
    ;;
esac

# ---------------------------------------------------------------------------
# 8. Health check — poll /api/health until it reports ok (or time out)
# ---------------------------------------------------------------------------
log "Waiting for API health at $HEALTH_URL (up to ${HEALTH_TIMEOUT}s)…"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
healthy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -sf -m 3 "$HEALTH_URL" | grep -q '"status":"ok"'; then healthy=1; break; fi
  sleep 3
done

if [ "$healthy" = "1" ]; then
  ok "API healthy at $HEALTH_URL"
  # Same port serves the SPA and the API — the built dist/, not a dev server.
  ok "Deploy complete → http://localhost:${API_PORT}/  (now at $NEW_SHA)"
else
  warn "API did not report healthy within ${HEALTH_TIMEOUT}s. Last 40 log lines:"
  tail -n 40 "$LOG_FILE" 2>/dev/null || warn "no $LOG_FILE — check 'pm2 logs jira-lite-api' / 'journalctl -u $SYSTEMD_UNIT'"
  die "Deploy finished but health check failed — check the logs above"
fi

# ---------------------------------------------------------------------------
# Remaining operational work, which a deploy script cannot do for you (JL-326):
#   * TLS. Put a proxy in front of :$API_PORT — copy nginx.conf.example, point
#     `proxy_pass` at the app, install certs (certbot/Let's Encrypt). If the box
#     still has an nginx vhost exposing the old Vite port :5173, delete it: that
#     vhost is what published the raw working tree.
#   * Supervision. PROCESS_MANAGER=pm2|systemd above, after a one-time
#     `npm i -g pm2` + `pm2 startup`, or installing
#     deploy/systemd/jira-lite-api.service. Documented in deploy/README.md.
#   * Or skip both: docker-compose.prod.yml runs this same artifact with
#     `restart: unless-stopped` and an optional nginx profile.
# ---------------------------------------------------------------------------
