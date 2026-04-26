#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT_DIR/apps/single-api"

if [[ -f "$API_DIR/.env" ]]; then
  set -a
  source "$API_DIR/.env"
  set +a
fi

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

stop_port() {
  local port="$1"
  local pids
  pids="$(port_pids "$port" | sort -u | xargs)"

  if [[ -z "$pids" ]]; then
    echo "[single] Port $port is free."
    return
  fi

  echo "[single] Stopping PID(s) on port $port: $pids"
  kill $pids 2>/dev/null || true
  sleep 1

  local survivors
  survivors="$(port_pids "$port" | sort -u | xargs)"
  if [[ -n "$survivors" ]]; then
    echo "[single] Force stopping PID(s) on port $port: $survivors"
    kill -9 $survivors 2>/dev/null || true
  fi
}

stop_port "${SINGLE_API_PORT:-18008}"
stop_port "13000"

echo "[single] Dev API/Web processes stopped. Sandbox container is left running."
