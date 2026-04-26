#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT_DIR/apps/single-api"
WEB_DIR="$ROOT_DIR/apps/single-web"

if [[ ! -f "$API_DIR/.env" ]]; then
  cp "$API_DIR/.env.example" "$API_DIR/.env"
  echo "[single] Created apps/single-api/.env; review it before public deployment."
fi

if [[ ! -f "$WEB_DIR/.env.local" ]]; then
  cp "$WEB_DIR/.env.local.example" "$WEB_DIR/.env.local"
fi

set -a
source "$API_DIR/.env"
set +a

echo "[single] Building single-web..."
(cd "$ROOT_DIR" && pnpm --filter kortix-single-web build)

echo "[single] Starting sandbox..."
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
docker compose -f "$ROOT_DIR/core/docker/docker-compose.yml" up -d

cat <<'MSG'
[single] Build complete.

Run the services with two process managers, tmux panes, or systemd units:

  pnpm --filter kortix-single-api start
  pnpm --filter kortix-single-web start

Health check:

  curl http://localhost:18008/health
MSG
