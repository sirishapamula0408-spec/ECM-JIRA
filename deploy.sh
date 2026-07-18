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
# The box currently serves the Vite dev server on :5173 with /api proxied
# to the Express API on :4000 (i.e. it runs `npm run dev`). This script
# keeps that model. For a real production setup (build + nginx + systemd),
# see the note at the bottom of this file.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config (override via env)
# ---------------------------------------------------------------------------
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-5173}"
LOG_FILE="${LOG_FILE:-$APP_DIR/app.log}"
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
log "Stopping running app (concurrently / vite / nodemon)…"
pkill -f "concurrently" 2>/dev/null || true
pkill -f "vite"         2>/dev/null || true
pkill -f "nodemon"      2>/dev/null || true
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

# ---------------------------------------------------------------------------
# 4. Environment: .env must exist and carry JWT_SECRET (app hard-fails without it)
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  [ -f .env.example ] && cp .env.example .env && warn "Created .env from .env.example — review it!" \
    || die "No .env and no .env.example to seed from"
fi
if ! grep -q '^JWT_SECRET=..*' .env; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  # Replace an empty JWT_SECRET= line if present, else append.
  if grep -q '^JWT_SECRET=' .env; then
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env
  else
    printf '\nJWT_SECRET=%s\n' "$SECRET" >> .env
  fi
  ok "Generated a JWT_SECRET into .env"
else
  ok ".env has JWT_SECRET"
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
# 6. Restart the app, detached so it survives this shell/SSH session
# ---------------------------------------------------------------------------
log "Starting app (npm run dev) — logging to $LOG_FILE"
nohup npm run dev > "$LOG_FILE" 2>&1 &
APP_PID=$!
disown "$APP_PID" 2>/dev/null || true
ok "Started (pid $APP_PID)"

# ---------------------------------------------------------------------------
# 7. Health check — poll /api/health until it reports ok (or time out)
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
  ok "Deploy complete → http://localhost:${WEB_PORT}/  (now at $NEW_SHA)"
else
  warn "API did not report healthy within ${HEALTH_TIMEOUT}s. Last 40 log lines:"
  tail -n 40 "$LOG_FILE" || true
  die "Deploy finished but health check failed — check $LOG_FILE"
fi

# ---------------------------------------------------------------------------
# Note — moving to a real production deployment (recommended for non-demo use):
#   1. npm run build                 # emits static assets to /dist
#   2. Serve /dist via nginx; proxy /api -> http://localhost:4000
#   3. Run the API under a process manager (pm2 or a systemd unit) instead of
#      `npm run dev`, so it restarts on crash/reboot.
#   Then this script's step 6 becomes:  npm run build && pm2 reload ecosystem.config.js
# ---------------------------------------------------------------------------
