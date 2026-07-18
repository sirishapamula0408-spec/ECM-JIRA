#!/usr/bin/env bash
#
# deploy.prod.sh — PRODUCTION deploy of ECM JIRA Clone.
#
# Unlike deploy.sh (which runs the Vite dev server), this builds the SPA to
# dist/, serves it via nginx, and runs the Express API (+ /ws realtime hub)
# under PM2. Run it ON the server from the repo directory.
#
# One-time server setup (nginx, pm2, TLS, boot persistence) is documented in
# deploy/README.md — do that first. Thereafter each release is just:
#
#     ./deploy.prod.sh
#
#   Env overrides:
#     BRANCH=main            branch to deploy
#     APP_DIR=<path>         repo dir (default: this script's dir)
#     API_PORT=4000          API port for the health check
#     WEB_ROOT=<path>        if set, rsync dist/ here (must match nginx `root`);
#                            unset => nginx serves <repo>/dist directly
#     RELOAD_NGINX=1         set 0 to skip `nginx -t && systemctl reload nginx`
#     SKIP_DB=1              don't touch docker/postgres
#     FORCE_INSTALL=1        run npm ci even when the lockfile didn't change

set -euo pipefail

BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
API_PORT="${API_PORT:-4000}"
WEB_ROOT="${WEB_ROOT:-}"
RELOAD_NGINX="${RELOAD_NGINX:-1}"
HEALTH_URL="http://localhost:${API_PORT}/api/health"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ ok  ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail ]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR" || die "APP_DIR not found: $APP_DIR"
log "Production deploy of '$BRANCH' in $APP_DIR"

# --- 0. Sanity checks ------------------------------------------------------
command -v git  >/dev/null || die "git not installed"
command -v node >/dev/null || die "node not installed"
command -v npm  >/dev/null || die "npm not installed"
command -v pm2  >/dev/null || die "pm2 not installed — run 'npm install -g pm2' (see deploy/README.md)"
[ -d .git ]         || die "$APP_DIR is not a git repository"
[ -f package.json ] || die "no package.json in $APP_DIR"
[ -f ecosystem.config.cjs ] || die "ecosystem.config.cjs missing — is this the right branch?"

# --- 1. Fast-forward to origin/<branch> ------------------------------------
log "Fetching origin…"
git fetch origin --prune
CURRENT_SHA="$(git rev-parse HEAD)"
git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
NEW_SHA="$(git rev-parse HEAD)"
[ "$CURRENT_SHA" = "$NEW_SHA" ] && warn "Already at $NEW_SHA — rebuilding anyway" \
                                || ok "Updated $CURRENT_SHA -> $NEW_SHA"

# --- 2. Install deps (devDeps included — vite is needed to build) ----------
if [ "${FORCE_INSTALL:-0}" = "1" ] || ! git diff --quiet "$CURRENT_SHA" "$NEW_SHA" -- package-lock.json package.json 2>/dev/null; then
  log "Installing dependencies (npm ci)…"
  npm ci || { warn "npm ci failed — falling back to npm install"; npm install; }
  ok "Dependencies installed"
else
  log "No dependency changes — skipping install (FORCE_INSTALL=1 to force)"
fi

# --- 3. Environment: .env + JWT_SECRET (app hard-fails without it) ---------
if [ ! -f .env ]; then
  [ -f .env.example ] && cp .env.example .env && warn "Created .env from .env.example — review it!" \
    || die "No .env and no .env.example to seed from"
fi
if ! grep -q '^JWT_SECRET=..*' .env; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  if grep -q '^JWT_SECRET=' .env; then sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env
  else printf '\nJWT_SECRET=%s\n' "$SECRET" >> .env; fi
  ok "Generated a JWT_SECRET into .env"
else
  ok ".env has JWT_SECRET"
fi

# --- 4. Database: ensure PostgreSQL is reachable ---------------------------
if [ "${SKIP_DB:-0}" != "1" ]; then
  if command -v docker >/dev/null && [ -f docker-compose.yml ]; then
    log "Ensuring PostgreSQL container is up…"
    (docker compose up -d 2>/dev/null || docker-compose up -d) && ok "Postgres up" \
      || warn "Could not start Postgres via compose — ensure the DB is running another way"
  else
    warn "docker/compose not available — assuming PostgreSQL is already running (DATABASE_URL in .env)"
  fi
else
  log "SKIP_DB=1 — not touching the database"
fi

# --- 5. Build the SPA ------------------------------------------------------
log "Building frontend (npm run build)…"
npm run build
[ -f dist/index.html ] || die "build did not produce dist/index.html"
ok "Built dist/ ($(du -sh dist 2>/dev/null | cut -f1))"

# --- 6. Publish dist/ to the nginx web root (if configured separately) -----
if [ -n "$WEB_ROOT" ] && [ "$WEB_ROOT" != "$APP_DIR/dist" ]; then
  log "Publishing dist/ -> $WEB_ROOT"
  mkdir -p "$WEB_ROOT"
  if command -v rsync >/dev/null; then rsync -a --delete dist/ "$WEB_ROOT/";
  else rm -rf "$WEB_ROOT"/* && cp -r dist/* "$WEB_ROOT/"; fi
  ok "Published to $WEB_ROOT"
else
  log "WEB_ROOT unset — nginx should serve $APP_DIR/dist directly"
fi

# --- 7. (Re)start the API under PM2 ----------------------------------------
mkdir -p logs
log "Reloading API under PM2…"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null 2>&1 || warn "pm2 save failed (run 'pm2 startup' once for boot persistence)"
ok "API (re)started under PM2"

# --- 8. Reload nginx -------------------------------------------------------
if [ "$RELOAD_NGINX" = "1" ] && command -v nginx >/dev/null; then
  log "Reloading nginx…"
  if sudo nginx -t 2>/dev/null; then sudo systemctl reload nginx && ok "nginx reloaded"
  else warn "nginx config test failed — NOT reloading; run 'sudo nginx -t' to inspect"; fi
else
  log "Skipping nginx reload (RELOAD_NGINX=$RELOAD_NGINX / nginx not found)"
fi

# --- 9. Health check -------------------------------------------------------
log "Waiting for API health at $HEALTH_URL (up to ${HEALTH_TIMEOUT}s)…"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT )); healthy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -sf -m 3 "$HEALTH_URL" | grep -q '"status":"ok"'; then healthy=1; break; fi
  sleep 3
done

if [ "$healthy" = "1" ]; then
  ok "API healthy at $HEALTH_URL"
  ok "Production deploy complete → now serving $NEW_SHA"
else
  warn "API did not report healthy within ${HEALTH_TIMEOUT}s. Recent PM2 logs:"
  pm2 logs jira-lite-api --lines 40 --nostream 2>/dev/null || true
  die "Deploy finished but health check failed — inspect 'pm2 logs jira-lite-api'"
fi
