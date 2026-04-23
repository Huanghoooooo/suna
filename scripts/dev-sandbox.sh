#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER_NAME="${SANDBOX_CONTAINER_NAME:-kortix-sandbox}"

cd "$ROOT_DIR"

echo "[dev:sandbox] Starting fixed compose sandbox '$CONTAINER_NAME' for manual core debugging."
echo "[dev:sandbox] For local multi-user / multi-container development, use 'pnpm dev' and let the API create sandboxes on demand."

if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  COMPOSE_PROJECT="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [[ -z "$COMPOSE_PROJECT" || "$COMPOSE_PROJECT" == "<no value>" ]]; then
    WORKSPACE_VOLUME="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Name}}{{end}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    echo "[dev:sandbox] Existing standalone container '$CONTAINER_NAME' is already using the fixed dev name."
    echo "[dev:sandbox] It was likely created earlier by the local_docker provider, not by docker compose."
    echo "[dev:sandbox] To switch to compose dev mode with bind mounts, remove only the container and keep its volume:"
    echo "  docker rm -f $CONTAINER_NAME"
    if [[ -n "$WORKSPACE_VOLUME" && "$WORKSPACE_VOLUME" != "<no value>" ]]; then
      echo "[dev:sandbox] Compose is configured to reuse workspace volume '$WORKSPACE_VOLUME' after you rerun this command."
    fi
    exit 1
  fi
fi

exec docker compose -f core/docker/docker-compose.yml -f core/docker/docker-compose.dev.yml up "$@"
