#!/usr/bin/env bash
# Launch the ECM JIRA Clone dev stack (Vite + Express) in the background and
# verify both are up. Exit 0 = healthy. Leaves the servers running.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT" || exit 1

LOG="${TMPDIR:-/tmp}/ecm-jira-dev.log"
echo "Starting 'npm run dev' → logs: $LOG"
npm run dev >"$LOG" 2>&1 &
DEV_PID=$!
echo "dev PID: $DEV_PID"

# Wait for the API health endpoint.
api_ok=""
for _ in $(seq 1 40); do
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then api_ok=1; break; fi
  # Bail early if the server crash-looped (e.g. the schema-public permission bug).
  if grep -qi "permission denied for schema public" "$LOG" 2>/dev/null; then
    echo "FAIL: API crashed — permission denied for schema public."
    echo "      See the 'Local PostgreSQL gotcha' section in SKILL.md for the one-time fix."
    exit 1
  fi
  sleep 1
done

# Wait for the Vite frontend.
fe_ok=""
for _ in $(seq 1 20); do
  if curl -sf http://localhost:5173/ >/dev/null 2>&1; then fe_ok=1; break; fi
  sleep 1
done

echo "----"
if [ -n "$api_ok" ]; then
  echo "API  http://localhost:4000  OK  → $(curl -s http://localhost:4000/api/health)"
else
  echo "API  http://localhost:4000  NOT READY (see $LOG)"
fi
if [ -n "$fe_ok" ]; then
  echo "Web  http://localhost:5173  OK"
else
  echo "Web  http://localhost:5173  NOT READY (see $LOG)"
fi

[ -n "$api_ok" ] && [ -n "$fe_ok" ] && exit 0 || exit 1
