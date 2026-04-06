#!/bin/bash
set -euo pipefail

BASE_URL="${1:-http://localhost:4096}"

echo "[test-pty-tools] checking tool registry at ${BASE_URL}"
TOOL_JSON=$(curl -fsS "${BASE_URL}/experimental/tool/ids")

python3 - <<'PY' <<<"$TOOL_JSON"
import json, sys
tools = set(json.load(sys.stdin))
required = {"pty_spawn", "pty_write", "pty_read", "pty_list", "pty_kill"}
missing = sorted(required - tools)
if missing:
    raise SystemExit(f"missing PTY tools: {', '.join(missing)}")
print("PTY tools present:", ", ".join(sorted(required)))
PY

echo "[test-pty-tools] creating raw PTY session via built-in backend"
CREATE_JSON=$(curl -fsS -X POST "${BASE_URL}/pty" \
  -H 'Content-Type: application/json' \
  -d '{"command":"bash","args":["-lc","echo pty-ok; sleep 2"],"cwd":"/workspace","title":"PTY test"}')

PTY_ID=$(python3 - <<'PY' <<<"$CREATE_JSON"
import json, sys
print(json.load(sys.stdin)["id"])
PY
)
export PTY_ID

echo "[test-pty-tools] created ${PTY_ID}"

LIST_JSON=$(curl -fsS "${BASE_URL}/pty")
python3 - <<'PY' <<<"$LIST_JSON"
import json, os, sys
pty_id = os.environ["PTY_ID"]
items = json.load(sys.stdin)
if not any(item.get("id") == pty_id for item in items):
    raise SystemExit(f"created PTY {pty_id} missing from /pty list")
print(f"PTY {pty_id} present in /pty list")
PY

curl -fsS -X DELETE "${BASE_URL}/pty/${PTY_ID}" >/dev/null

echo "[test-pty-tools] cleanup ok"
echo "[test-pty-tools] PASS"
