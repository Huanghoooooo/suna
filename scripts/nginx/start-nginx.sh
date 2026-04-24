#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-nginx.sh — Start Nginx LAN reverse proxy for Kortix/Suna
#
# Detects the local LAN IP, renders the nginx config template, and starts
# nginx. Run with `stop` argument to shut it down.
#
# Usage:
#   ./scripts/nginx/start-nginx.sh          # start
#   ./scripts/nginx/start-nginx.sh stop     # stop
#   ./scripts/nginx/start-nginx.sh status   # check if running
#   LAN_IP=10.0.0.5 ./scripts/nginx/start-nginx.sh  # override IP detection
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/nginx-lan.conf"
RENDERED="/tmp/nginx-lan-rendered.conf"
PID_FILE="/tmp/nginx-lan.pid"

detect_lan_ip() {
  local ip=""
  case "$(uname -s)" in
    Darwin)
      ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
      ;;
    Linux)
      ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
      ;;
  esac
  echo "$ip"
}

stop_nginx() {
  if [ -f "$PID_FILE" ]; then
    nginx -c "$RENDERED" -s quit 2>/dev/null || true
    echo "Nginx stopped."
  else
    echo "Nginx is not running (no PID file)."
  fi
}

status_nginx() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Nginx is running (PID $(cat "$PID_FILE"))."
  else
    echo "Nginx is not running."
  fi
}

case "${1:-start}" in
  stop)   stop_nginx; exit 0 ;;
  status) status_nginx; exit 0 ;;
  start)  ;;
  *)      echo "Usage: $0 [start|stop|status]"; exit 1 ;;
esac

# ── Resolve LAN IP ──────────────────────────────────────────────────────────
if [ -z "${LAN_IP:-}" ]; then
  LAN_IP=$(detect_lan_ip)
fi

if [ -z "$LAN_IP" ]; then
  echo "ERROR: Could not detect LAN IP. Set it manually:"
  echo "  LAN_IP=192.168.1.100 $0"
  exit 1
fi

# ── Check nginx is installed ────────────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
  echo "ERROR: nginx not found. Install it first:"
  echo "  macOS:  brew install nginx"
  echo "  Ubuntu: sudo apt install nginx"
  exit 1
fi

# ── Render template ─────────────────────────────────────────────────────────
export LAN_IP
envsubst '$LAN_IP' < "$TEMPLATE" > "$RENDERED"

# ── Test config ─────────────────────────────────────────────────────────────
if ! nginx -t -c "$RENDERED" 2>&1; then
  echo "ERROR: nginx config test failed."
  exit 1
fi

# ── Stop existing instance if running ───────────────────────────────────────
stop_nginx 2>/dev/null || true

# ── Start ───────────────────────────────────────────────────────────────────
nginx -c "$RENDERED"

echo ""
echo "Nginx LAN proxy started. LAN IP: $LAN_IP"
echo ""
echo "Services available at:"
echo "  Web:       http://$LAN_IP"
echo "  API:       http://$LAN_IP/v1/"
echo "  Supabase:  http://$LAN_IP:54321"
echo "  Sandbox:   http://$LAN_IP:14000  (Master)"
echo "             http://$LAN_IP:14002  (noVNC Desktop)"
echo "             ssh -p 24007 $LAN_IP  (SSH)"
echo ""
echo "Don't forget to update your .env files:"
echo "  apps/web/.env.local:"
echo "    NEXT_PUBLIC_SUPABASE_URL=http://$LAN_IP:54321"
echo "    NEXT_PUBLIC_BACKEND_URL=http://$LAN_IP/v1"
echo ""
echo "  apps/api/.env:"
echo "    CORS_ALLOWED_ORIGINS=http://$LAN_IP"
echo ""
echo "  supabase/config.toml:"
echo "    site_url = \"http://$LAN_IP\""
echo ""
echo "Stop with: $0 stop"
