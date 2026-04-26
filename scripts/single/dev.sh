#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT_DIR/apps/single-api"
WEB_DIR="$ROOT_DIR/apps/single-web"

API_PID=""
WEB_PID=""

port_pids() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' || true
    echo
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null \
      | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' \
      | sort -u
  fi
  return 0
}

describe_port() {
  local port="$1"
  local pids
  pids="$(port_pids "$port" | sort -u | xargs)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "[single] Port $port is already in use by PID(s): $pids"
  ps -fp $pids 2>/dev/null || true
  return 1
}

require_free_port() {
  local port="$1"
  if ! describe_port "$port"; then
    echo
    echo "[single] Another single-mode dev server is probably already running."
    echo "[single] Open it directly, or stop it with: pnpm single:stop"
    exit 1
  fi
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -n "${API_PID:-}" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

mkdir -p "$API_DIR" "$WEB_DIR"

if [[ ! -f "$API_DIR/.env" ]]; then
  cp "$API_DIR/.env.example" "$API_DIR/.env"
  echo "[single] Created apps/single-api/.env"
fi

if [[ ! -f "$WEB_DIR/.env.local" ]]; then
  cp "$WEB_DIR/.env.local.example" "$WEB_DIR/.env.local"
  echo "[single] Created apps/single-web/.env.local"
fi

set -a
source "$API_DIR/.env"
set +a

require_free_port "${SINGLE_API_PORT:-18008}"
require_free_port "13000"

echo "[single] Starting sandbox container ${SINGLE_SANDBOX_CONTAINER:-kortix-single-sandbox}..."
COMPOSE_ARGS=(up -d)
if [[ "${SINGLE_REBUILD_SANDBOX:-0}" == "1" ]]; then
  COMPOSE_ARGS+=(--build)
fi
if [[ "${SINGLE_RECREATE_SANDBOX:-0}" == "1" ]]; then
  COMPOSE_ARGS+=(--force-recreate)
fi

SANDBOX_CONTAINER_NAME="${SINGLE_SANDBOX_CONTAINER:-kortix-single-sandbox}" \
KORTIX_TOKEN="${SINGLE_SANDBOX_TOKEN:-kortix_single_dev_token_change_me}" \
INTERNAL_SERVICE_KEY="${SINGLE_SANDBOX_TOKEN:-kortix_single_dev_token_change_me}" \
TUNNEL_TOKEN="${SINGLE_SANDBOX_TOKEN:-kortix_single_dev_token_change_me}" \
KORTIX_API_URL="${KORTIX_API_URL:-http://host.docker.internal:18008}" \
TUNNEL_API_URL="${KORTIX_API_URL:-http://host.docker.internal:18008}" \
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}" \
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
BIGMODEL_API_KEY="${BIGMODEL_API_KEY:-}" \
GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
GROQ_API_KEY="${GROQ_API_KEY:-}" \
CONTEXT7_API_KEY="${CONTEXT7_API_KEY:-}" \
CORS_ALLOWED_ORIGINS="${SINGLE_WEB_URL:-http://localhost:13000},${SINGLE_PUBLIC_API_URL:-http://localhost:18008}" \
docker compose -f "$ROOT_DIR/core/docker/docker-compose.yml" "${COMPOSE_ARGS[@]}"

echo "[single] Starting single-api on ${SINGLE_API_PORT:-18008}..."
(cd "$ROOT_DIR" && pnpm --filter kortix-single-api dev) &
API_PID=$!

echo "[single] Starting single-web on 13000..."
(cd "$ROOT_DIR" && pnpm --filter kortix-single-web dev) &
WEB_PID=$!

echo "[single] Ready:"
echo "  Web: http://localhost:13000"
echo "  API: http://localhost:${SINGLE_API_PORT:-18008}/health"
echo "  Sandbox master: ${SINGLE_SANDBOX_BASE_URL:-http://127.0.0.1:14000}"

wait -n "$API_PID" "$WEB_PID"
