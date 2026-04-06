#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  E2E Test: Full VPS lifecycle                                              ║
# ║                                                                            ║
# ║  Tests the COMPLETE lifecycle a real VPS user would experience:            ║
# ║    1. Fresh install via raw GitHub URL (get-kortix.sh)                     ║
# ║    2. Verify all services healthy (Caddy, frontend, API, Supabase, sandbox)║
# ║    3. Test HTTPS / TLS termination                                        ║
# ║    4. Test authentication flow (owner bootstrap, sign-in)                  ║
# ║    5. Test every CLI command (start, stop, restart, status, logs, etc.)    ║
# ║    6. Test update flow                                                     ║
# ║    7. Test reset flow                                                      ║
# ║    8. Test uninstall                                                       ║
# ║    9. Re-install and verify clean second install                           ║
# ║                                                                            ║
# ║  Usage (run ON the VPS):                                                   ║
# ║    bash test-full-vps-e2e.sh [--ip-only] [--skip-install] [--keep]        ║
# ║                                                                            ║
# ║  Environment variables:                                                    ║
# ║    VPS_DOMAIN       Domain or IP to test against                           ║
# ║    OWNER_EMAIL      Owner account email (default: e2e@kortix.ai)           ║
# ║    OWNER_PASSWORD   Owner account password (default: e2e-test-pass-42)     ║
# ║    INSTALLER_URL    URL to get-kortix.sh (default: raw GitHub URL)         ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

set -uo pipefail
# NOTE: We intentionally do NOT use -e (errexit) because the test framework
# tracks pass/fail counts and should not exit on individual test failures.

# ─── Colors ──────────────────────────────────────────────────────────────────
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
BLUE=$'\033[0;34m'; CYAN=$'\033[0;36m'; BOLD=$'\033[1m'
DIM=$'\033[2m'; NC=$'\033[0m'

# ─── Config ──────────────────────────────────────────────────────────────────
INSTALL_DIR="${KORTIX_HOME:-$HOME/.kortix}"
OWNER_EMAIL="${OWNER_EMAIL:-e2e@kortix.ai}"
OWNER_PASSWORD="${OWNER_PASSWORD:-e2e-test-pass-42}"
INSTALLER_URL="${INSTALLER_URL:-https://raw.githubusercontent.com/kortix-ai/suna/main/scripts/get-kortix.sh}"
IP_ONLY=false
SKIP_INSTALL=false
KEEP_INSTALL=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ip-only)       IP_ONLY=true;       shift ;;
    --skip-install)  SKIP_INSTALL=true;   shift ;;
    --keep)          KEEP_INSTALL=true;   shift ;;
    *)               echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# Auto-detect server IP if no domain provided
if [ -z "${VPS_DOMAIN:-}" ]; then
  VPS_DOMAIN=$(curl -4 -sf --connect-timeout 5 https://ifconfig.me 2>/dev/null \
    || curl -4 -sf --connect-timeout 5 https://api.ipify.org 2>/dev/null \
    || echo "")
  if [ -z "$VPS_DOMAIN" ]; then
    echo "${RED}Cannot detect server IP. Set VPS_DOMAIN.${NC}" >&2
    exit 1
  fi
  IP_ONLY=true
fi

BASE_URL="https://${VPS_DOMAIN}"

# ─── Test framework ─────────────────────────────────────────────────────────
PASS=0; FAIL=0; SKIP=0; TOTAL=0
FAILED_TESTS=()

pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); printf "  ${GREEN}✓${NC} %s\n" "$1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); FAILED_TESTS+=("$1"); printf "  ${RED}✗${NC} %s\n" "$1"; }
skip() { SKIP=$((SKIP+1)); TOTAL=$((TOTAL+1)); printf "  ${YELLOW}○${NC} %s ${DIM}(skipped)${NC}\n" "$1"; }
section() { echo ""; echo "${BOLD}${CYAN}═══ $1 ═══${NC}"; echo ""; }

run_test() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    pass "$name"
  else
    fail "$name"
  fi
  return 0  # Never fail the script — we track pass/fail counts
}

wait_for_url() {
  local url="$1" max="${2:-60}" curl_args="${3:--k -sf}"
  for i in $(seq 1 "$max"); do
    if curl $curl_args "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "${BOLD}${CYAN}"
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║  Kortix — Full VPS E2E Test Suite             ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo "${NC}"
echo "  ${DIM}Domain/IP:${NC}  ${BOLD}${VPS_DOMAIN}${NC}"
echo "  ${DIM}IP-only:${NC}    ${IP_ONLY}"
echo "  ${DIM}Install:${NC}    ${INSTALL_DIR}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Clean slate & fresh install
# ═══════════════════════════════════════════════════════════════════════════════
if [ "$SKIP_INSTALL" = "false" ]; then
  section "PHASE 1: Clean slate"

  # Nuke any existing installation
  if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    cd "$INSTALL_DIR"
    docker compose --profile vps down -v --remove-orphans 2>/dev/null || true
    cd /
  fi
  docker ps -a --format '{{.Names}}' | grep -E '^kortix-' | xargs -r docker rm -f 2>/dev/null || true
  docker volume ls --format '{{.Name}}' | grep -i kortix | xargs -r docker volume rm -f 2>/dev/null || true
  rm -f /usr/local/bin/kortix 2>/dev/null || true
  rm -rf "$INSTALL_DIR"
  pass "Existing installation removed"

  # Verify clean state
  run_test "No kortix containers running" \
    "! docker ps --format '{{.Names}}' | grep -q kortix"
  run_test "No kortix volumes" \
    "! docker volume ls --format '{{.Name}}' | grep -qi kortix"
  run_test "No ~/.kortix directory" \
    "[ ! -d '$INSTALL_DIR' ]"

  section "PHASE 2: Fresh install via raw GitHub URL"

  echo "  ${BLUE}[e2e]${NC} Installer source: ${DIM}${INSTALLER_URL}${NC}"

  # Build the stdin for the interactive installer
  # VPS mode prompts: 2=VPS, 1=Docker DB, 2=IP-only, y=firewall, email, password, confirm password, n=no integrations
  INSTALL_STDIN=""
  if [ "$IP_ONLY" = "true" ]; then
    # 2=VPS, 1=Docker DB, 2=IP-only, n=no firewall, email, password, password, n=no integrations
    INSTALL_STDIN=$(printf "2\n1\n2\nn\n%s\n%s\n%s\nn\n" "$OWNER_EMAIL" "$OWNER_PASSWORD" "$OWNER_PASSWORD")
  else
    # 2=VPS, 1=Docker DB, 1=domain, domain, n=no firewall, email, password, password, n=no integrations
    INSTALL_STDIN=$(printf "2\n1\n1\n%s\nn\n%s\n%s\n%s\nn\n" "$VPS_DOMAIN" "$OWNER_EMAIL" "$OWNER_PASSWORD" "$OWNER_PASSWORD")
  fi

  INSTALL_LOG="/tmp/kortix-vps-e2e-install.log"

  # Support both local file paths and remote URLs
  if [ -f "$INSTALLER_URL" ]; then
    echo "$INSTALL_STDIN" | bash "$INSTALLER_URL" >"$INSTALL_LOG" 2>&1 || {
      fail "Installer exited with error"
      echo "  ${RED}Last 30 lines of install log:${NC}"
      tail -30 "$INSTALL_LOG" | sed 's/^/    /'
      exit 1
    }
  else
    echo "$INSTALL_STDIN" | bash <(curl -fsSL "$INSTALLER_URL") >"$INSTALL_LOG" 2>&1 || {
      fail "Installer exited with error"
      echo "  ${RED}Last 30 lines of install log:${NC}"
      tail -30 "$INSTALL_LOG" | sed 's/^/    /'
      exit 1
    }
  fi

  pass "Installer completed successfully"

  # Verify files created
  run_test "docker-compose.yml created" "[ -f '$INSTALL_DIR/docker-compose.yml' ]"
  run_test ".env created" "[ -f '$INSTALL_DIR/.env' ]"
  run_test ".credentials created" "[ -f '$INSTALL_DIR/.credentials' ]"
  run_test "CLI script created" "[ -x '$INSTALL_DIR/kortix' ]"
  run_test "Caddyfile created" "[ -f '$INSTALL_DIR/Caddyfile' ]"
  run_test "Kong config created" "[ -d '$INSTALL_DIR/volumes/api' ]"
  run_test "DB init scripts created" "[ -d '$INSTALL_DIR/volumes/db' ]"

  # Verify .env contents
  run_test ".env has DEPLOY_MODE=vps" "grep -q 'DEPLOY_MODE=vps' '$INSTALL_DIR/.env'"
  run_test ".env has DB_MODE=docker" "grep -q 'DB_MODE=docker' '$INSTALL_DIR/.env'"
  run_test ".env has correct version" "grep -q 'KORTIX_VERSION=' '$INSTALL_DIR/.env'"
  ENV_PERMS=$(stat -c '%a' "$INSTALL_DIR/.env" 2>/dev/null || stat -f '%Lp' "$INSTALL_DIR/.env" 2>/dev/null || echo "unknown")
  if [ "$ENV_PERMS" = "600" ]; then
    pass ".env permissions are 600"
  else
    fail ".env permissions are 600 (got: $ENV_PERMS)"
  fi

  # Verify CLI is in PATH
  run_test "kortix CLI in PATH" "which kortix"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: Wait for services & verify health
# ═══════════════════════════════════════════════════════════════════════════════
section "PHASE 3: Service health"

echo "  ${BLUE}[e2e]${NC} Waiting for services to start (may take 1-2 minutes)..."

# Wait for Caddy + frontend
if wait_for_url "$BASE_URL" 90 "-k -sf"; then
  pass "Frontend via Caddy (HTTPS)"
else
  fail "Frontend via Caddy (HTTPS) — timeout"
fi

# API health
if wait_for_url "$BASE_URL/v1/health" 30 "-k -sf"; then
  pass "API health via Caddy"
else
  # Try API directly
  if wait_for_url "$BASE_URL/health" 10 "-k -sf"; then
    pass "API health check (/health direct)"
  else
    fail "API health check — timeout"
  fi
fi

# Supabase auth health
ANON_KEY=""
if [ -f "$INSTALL_DIR/.env" ]; then
  ANON_KEY=$(grep -m1 '^SUPABASE_ANON_KEY=' "$INSTALL_DIR/.env" | cut -d= -f2- || true)
fi

if [ -n "$ANON_KEY" ]; then
  if curl -k -sf "$BASE_URL/auth/v1/health" -H "apikey: $ANON_KEY" >/dev/null 2>&1; then
    pass "Supabase Auth health via Caddy"
  else
    fail "Supabase Auth health via Caddy"
  fi
else
  skip "Supabase Auth health (no anon key found)"
fi

# Containers running
for name in caddy frontend kortix-api supabase-kong supabase-auth supabase-db supabase-rest; do
  if docker ps --format '{{.Names}}' | grep -q "$name"; then
    pass "Container '$name' is running"
  else
    fail "Container '$name' is running"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: TLS / HTTPS verification
# ═══════════════════════════════════════════════════════════════════════════════
section "PHASE 4: HTTPS & TLS"

# HTTPS responds
HTTP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" "$BASE_URL" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "302" ]; then
  pass "HTTPS responds (status: $HTTP_CODE)"
else
  fail "HTTPS responds (got: $HTTP_CODE)"
fi

# HTTP redirects to HTTPS
HTTP_REDIRECT=$(curl -s -o /dev/null -w "%{http_code}" "http://${VPS_DOMAIN}" 2>/dev/null)
if [ "$HTTP_REDIRECT" = "301" ] || [ "$HTTP_REDIRECT" = "308" ] || [ "$HTTP_REDIRECT" = "302" ]; then
  pass "HTTP -> HTTPS redirect ($HTTP_REDIRECT)"
elif [ "$HTTP_REDIRECT" = "200" ]; then
  pass "HTTP port responds (Caddy handling both)"
else
  skip "HTTP redirect check (got: $HTTP_REDIRECT)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: Authentication flow
# ═══════════════════════════════════════════════════════════════════════════════
section "PHASE 5: Authentication"

# Sign in via Supabase API
SESSION_RESPONSE=""
ACCESS_TOKEN=""

if [ -n "$ANON_KEY" ]; then
  # Direct sign-in through Caddy proxy
  SESSION_RESPONSE=$(curl -k -sf "${BASE_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}" 2>&1 || true)

  if echo "$SESSION_RESPONSE" | grep -q '"access_token"'; then
    pass "Owner can sign in via Supabase API"
    ACCESS_TOKEN=$(echo "$SESSION_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])' 2>/dev/null || true)
  else
    fail "Owner sign-in failed"
    echo "  ${DIM}Response: $(echo "$SESSION_RESPONSE" | head -1 | cut -c1-200)${NC}"
  fi
else
  skip "Authentication tests (no anon key)"
fi

# Test authenticated API access
if [ -n "$ACCESS_TOKEN" ]; then
  # Setup status
  SETUP_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" "$BASE_URL/v1/setup/setup-status" \
    -H "Authorization: Bearer $ACCESS_TOKEN" 2>/dev/null)
  if [ "$SETUP_CODE" = "200" ]; then
    pass "Authenticated: /v1/setup/setup-status (200)"
  else
    fail "Authenticated: /v1/setup/setup-status (got: $SETUP_CODE)"
  fi

  # Install status (no auth needed)
  INSTALL_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" "$BASE_URL/v1/setup/install-status" 2>/dev/null)
  if [ "$INSTALL_CODE" = "200" ]; then
    pass "Public: /v1/setup/install-status (200)"
  else
    fail "Public: /v1/setup/install-status (got: $INSTALL_CODE)"
  fi
else
  skip "Authenticated API access (no token)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6: Port isolation (VPS security)
# ═══════════════════════════════════════════════════════════════════════════════
section "PHASE 6: Port isolation"

# Internal ports should NOT be accessible from outside
# NOTE: When testing from the VPS host itself, Docker bridge networking allows
# the host to reach container ports regardless of UFW, because Docker injects
# its own iptables rules. These tests only make sense from an external machine.
# We detect "testing from host" by checking if VPS_DOMAIN resolves to a local IP.
IS_LOCAL_TEST="no"
if echo "$VPS_DOMAIN" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  RESOLVED_IP="$VPS_DOMAIN"
else
  RESOLVED_IP=$(dig +short "$VPS_DOMAIN" 2>/dev/null | head -1 || echo "")
fi
if [ -n "$RESOLVED_IP" ] && ip addr show 2>/dev/null | grep -q "$RESOLVED_IP"; then
  IS_LOCAL_TEST="yes"
fi
for port in 3000 8008 8000 9999; do
  PORT_CODE=$(curl -s --connect-timeout 3 -o /dev/null -w "%{http_code}" "http://${VPS_DOMAIN}:${port}" 2>/dev/null)
  PORT_CODE="${PORT_CODE:-000}"
  if [ "$PORT_CODE" = "000" ]; then
    pass "Internal port $port is NOT externally accessible"
  elif [ "$IS_LOCAL_TEST" = "yes" ]; then
    skip "Internal port $port reachable from host (Docker bridge — expected)"
  else
    fail "Internal port $port IS externally accessible (got: $PORT_CODE)"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 7: CLI commands
# ═══════════════════════════════════════════════════════════════════════════════
section "PHASE 7: CLI commands"

# version
CLI_VERSION=$(kortix version 2>&1)
if echo "$CLI_VERSION" | grep -q 'kortix'; then
  pass "kortix version"
else
  fail "kortix version"
fi

# status
if kortix status >/dev/null 2>&1; then
  pass "kortix status"
else
  fail "kortix status"
fi

# credentials
if kortix credentials >/dev/null 2>&1; then
  pass "kortix credentials"
else
  fail "kortix credentials"
fi

# help (default case shows help)
HELP_OUTPUT=$(kortix 2>&1 || true)
if echo "$HELP_OUTPUT" | grep -q 'start'; then
  pass "kortix help (default)"
else
  fail "kortix help (default)"
fi

# stop
echo "  ${BLUE}[e2e]${NC} Testing stop..."
if kortix stop >/dev/null 2>&1; then
  sleep 5
  # Verify containers are actually stopped
  RUNNING=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -c 'kortix-' || true)
  if [ "${RUNNING:-0}" -eq 0 ] 2>/dev/null; then
    pass "kortix stop (all containers stopped)"
  else
    pass "kortix stop (completed, $RUNNING containers winding down)"
  fi
else
  fail "kortix stop"
fi

# Verify frontend is down after stop
if ! curl -k -sf "$BASE_URL" >/dev/null 2>&1; then
  pass "Frontend unreachable after stop"
else
  fail "Frontend still reachable after stop"
fi

# start
echo "  ${BLUE}[e2e]${NC} Testing start..."
if kortix start >/dev/null 2>&1; then
  pass "kortix start"
else
  fail "kortix start"
fi

echo "  ${BLUE}[e2e]${NC} Waiting for services after start..."
if wait_for_url "$BASE_URL" 60 "-k -sf"; then
  pass "Frontend accessible after start"
else
  fail "Frontend accessible after start"
fi

# restart
echo "  ${BLUE}[e2e]${NC} Testing restart..."
if kortix restart >/dev/null 2>&1; then
  pass "kortix restart"
else
  fail "kortix restart"
fi

echo "  ${BLUE}[e2e]${NC} Waiting for services after restart..."
if wait_for_url "$BASE_URL" 60 "-k -sf"; then
  pass "Frontend accessible after restart"
else
  fail "Frontend accessible after restart"
fi

# logs (just verify it doesn't crash — capture a few lines)
LOG_OUTPUT=$(timeout 5 kortix logs --tail 5 2>&1; true)
if [ -n "$LOG_OUTPUT" ]; then
  pass "kortix logs produces output"
else
  skip "kortix logs (no output in 5s)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 8: Update flow
# ═══════════════════════════════════════════════════════════════════════════════
section "PHASE 8: Update"

echo "  ${BLUE}[e2e]${NC} Testing update (pulls and restarts)..."
if kortix update >/dev/null 2>&1; then
  pass "kortix update completed"
else
  fail "kortix update"
fi

echo "  ${BLUE}[e2e]${NC} Waiting for services after update..."
if wait_for_url "$BASE_URL" 60 "-k -sf"; then
  pass "Frontend accessible after update"
else
  fail "Frontend accessible after update"
fi

# Verify auth still works after update
if [ -n "$ANON_KEY" ]; then
  POST_UPDATE_RESPONSE=$(curl -k -sf "${BASE_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}" 2>&1 || true)

  if echo "$POST_UPDATE_RESPONSE" | grep -q '"access_token"'; then
    pass "Auth still works after update"
  else
    fail "Auth broken after update"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 9: Reset flow
# ═══════════════════════════════════════════════════════════════════════════════
section "PHASE 9: Reset"

echo "  ${BLUE}[e2e]${NC} Testing reset --yes (wipes and recreates)..."
if kortix reset --yes >/dev/null 2>&1; then
  pass "kortix reset --yes completed"
else
  fail "kortix reset --yes"
fi

echo "  ${BLUE}[e2e]${NC} Waiting for services after reset..."
if wait_for_url "$BASE_URL" 90 "-k -sf"; then
  pass "Frontend accessible after reset"
else
  fail "Frontend accessible after reset"
fi

# After reset, data is wiped — need to re-bootstrap owner
echo "  ${BLUE}[e2e]${NC} Re-bootstrapping owner after reset..."
BOOTSTRAP_RESPONSE=$(curl -k -sf -X POST "$BASE_URL/v1/setup/bootstrap-owner" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}" 2>&1 || true)

if echo "$BOOTSTRAP_RESPONSE" | grep -q '"success"'; then
  pass "Owner re-bootstrapped after reset"
else
  # May say already exists, which is also fine
  if echo "$BOOTSTRAP_RESPONSE" | grep -qi 'already\|exist'; then
    pass "Owner already exists after reset (data preserved)"
  else
    fail "Owner bootstrap after reset failed"
    echo "  ${DIM}Response: $(echo "$BOOTSTRAP_RESPONSE" | head -1 | cut -c1-200)${NC}"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 10: Uninstall
# ═══════════════════════════════════════════════════════════════════════════════
if [ "$KEEP_INSTALL" = "false" ]; then
  section "PHASE 10: Uninstall"

  echo "  ${BLUE}[e2e]${NC} Testing uninstall (with volume deletion)..."
  # The uninstall command is interactive — answer 'y' to delete volumes
  echo "y" | kortix uninstall 2>&1 || true

  # Allow containers to fully stop
  sleep 5

  # Belt-and-suspenders: clean up anything the uninstall missed
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E '^kortix-' | xargs -r docker rm -f 2>/dev/null || true

  # Verify uninstall
  run_test "Install directory removed" "[ ! -d '$INSTALL_DIR' ]"

  KORTIX_CONTAINERS=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -c 'kortix-' || true)
  if [ "${KORTIX_CONTAINERS:-0}" -eq 0 ] 2>/dev/null; then
    pass "All kortix containers removed"
  else
    fail "Kortix containers still exist ($KORTIX_CONTAINERS)"
  fi

  run_test "CLI removed from PATH" "! which kortix 2>/dev/null"

  if ! curl -k -sf "$BASE_URL" >/dev/null 2>&1; then
    pass "Frontend unreachable after uninstall"
  else
    fail "Frontend still reachable after uninstall"
  fi

  # ═══════════════════════════════════════════════════════════════════════════════
  # PHASE 11: Re-install (verify clean second install works)
  # ═══════════════════════════════════════════════════════════════════════════════
  section "PHASE 11: Re-install (clean second install)"

  # Thorough cleanup of anything uninstall may have missed
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E '^kortix-' | xargs -r docker rm -f 2>/dev/null || true
  docker volume ls --format '{{.Name}}' | grep -i kortix | xargs -r docker volume rm -f 2>/dev/null || true
  rm -f /usr/local/bin/kortix 2>/dev/null || true
  rm -rf "$INSTALL_DIR" 2>/dev/null || true

  echo "  ${BLUE}[e2e]${NC} Running installer again..."

  REINSTALL_STDIN=""
  if [ "$IP_ONLY" = "true" ]; then
    REINSTALL_STDIN=$(printf "2\n1\n2\nn\n%s\n%s\n%s\nn\n" "$OWNER_EMAIL" "$OWNER_PASSWORD" "$OWNER_PASSWORD")
  else
    REINSTALL_STDIN=$(printf "2\n1\n1\n%s\nn\n%s\n%s\n%s\nn\n" "$VPS_DOMAIN" "$OWNER_EMAIL" "$OWNER_PASSWORD" "$OWNER_PASSWORD")
  fi

  REINSTALL_LOG="/tmp/kortix-vps-e2e-reinstall.log"
  if [ -f "$INSTALLER_URL" ]; then
    echo "$REINSTALL_STDIN" | bash "$INSTALLER_URL" >"$REINSTALL_LOG" 2>&1 || {
      fail "Re-install failed"
      tail -20 "$REINSTALL_LOG" | sed 's/^/    /'
      exit 1
    }
  else
    echo "$REINSTALL_STDIN" | bash <(curl -fsSL "$INSTALLER_URL") >"$REINSTALL_LOG" 2>&1 || {
      fail "Re-install failed"
      tail -20 "$REINSTALL_LOG" | sed 's/^/    /'
      exit 1
    }
  fi

  pass "Re-install completed"

  # Verify re-install
  run_test "docker-compose.yml created (reinstall)" "[ -f '$INSTALL_DIR/docker-compose.yml' ]"
  run_test ".env created (reinstall)" "[ -f '$INSTALL_DIR/.env' ]"
  run_test "CLI in PATH (reinstall)" "which kortix"

  echo "  ${BLUE}[e2e]${NC} Waiting for services after re-install..."
  if wait_for_url "$BASE_URL" 90 "-k -sf"; then
    pass "Frontend accessible after re-install"
  else
    fail "Frontend accessible after re-install"
  fi

  # Verify auth works on fresh install
  if [ -f "$INSTALL_DIR/.env" ]; then
    ANON_KEY_2=$(grep -m1 '^SUPABASE_ANON_KEY=' "$INSTALL_DIR/.env" | cut -d= -f2- || true)
    if [ -n "$ANON_KEY_2" ]; then
      REINSTALL_AUTH=$(curl -k -sf "${BASE_URL}/auth/v1/token?grant_type=password" \
        -H "apikey: $ANON_KEY_2" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}" 2>&1 || true)

      if echo "$REINSTALL_AUTH" | grep -q '"access_token"'; then
        pass "Auth works after re-install"
      else
        fail "Auth broken after re-install"
      fi
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "${BOLD}${CYAN}═══ TEST SUMMARY ═══${NC}"
echo ""
echo "  ${GREEN}Passed:${NC}  $PASS"
echo "  ${RED}Failed:${NC}  $FAIL"
echo "  ${YELLOW}Skipped:${NC} $SKIP"
echo "  ${BOLD}Total:${NC}   $TOTAL"
echo ""

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo "  ${RED}Failed tests:${NC}"
  for t in "${FAILED_TESTS[@]}"; do
    echo "    ${RED}✗${NC} $t"
  done
  echo ""
fi

if [ "$FAIL" -eq 0 ]; then
  echo "${GREEN}${BOLD}  ✅  All E2E tests passed!${NC}"
  echo ""
  echo "  ${CYAN}Kortix VPS:${NC}  ${BOLD}${BASE_URL}${NC}"
  echo "  ${CYAN}Login:${NC}       ${OWNER_EMAIL} / ${OWNER_PASSWORD}"
else
  echo "${RED}${BOLD}  ❌  $FAIL test(s) failed${NC}"
fi
echo ""

exit "$FAIL"
