#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SUPABASE_DIR="$ROOT_DIR/supabase"

FRONTEND_PID=""

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

echo "[dev] Ensuring local Supabase is running..."
if ! docker info >/dev/null 2>&1; then
  echo "[dev] ERROR: Docker daemon is not running"
  exit 1
fi

if ! (cd "$SUPABASE_DIR" && supabase status >/dev/null 2>&1); then
  (cd "$SUPABASE_DIR" && supabase start)
fi

echo "[dev] Waiting for Postgres on 127.0.0.1:54322..."
python3 - <<'PY'
import socket
import sys
import time

deadline = time.time() + 60
while time.time() < deadline:
    try:
        with socket.create_connection(("127.0.0.1", 54322), timeout=1):
            sys.exit(0)
    except OSError:
        time.sleep(1)

print("[dev] ERROR: Timed out waiting for Supabase Postgres on 127.0.0.1:54322", file=sys.stderr)
sys.exit(1)
PY

echo "[dev] Local sandboxes are provisioned on demand by the API (multi-user/dev bind mounts enabled)."
echo "[dev] 'pnpm dev:sandbox' is only for the fixed single compose sandbox debug flow."

echo "[dev] Starting frontend..."
pnpm --filter Kortix-Computer-Frontend dev &
FRONTEND_PID=$!

echo "[dev] Starting API..."
cd "$ROOT_DIR"
KORTIX_DEV_MODE=1 KORTIX_SKIP_ENSURE_SCHEMA=1 pnpm --filter kortix-api dev
