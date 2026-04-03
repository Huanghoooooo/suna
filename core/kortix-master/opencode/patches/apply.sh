#!/usr/bin/env bash
# Postinstall patch: applies binary patches to the opencode CLI.
# Run from Dockerfile AFTER `npm install -g opencode-ai`.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Patch: opencode binary — fine-grained tool-input streaming ──────────────
# Patches the compiled Bun binary to enable tool-input-delta streaming.
# Idempotent: skips if already patched or binary not found.
STREAMING_PATCH="$SCRIPT_DIR/patch-opencode-streaming.js"
if [ -f "$STREAMING_PATCH" ]; then
  node "$STREAMING_PATCH" || echo "[patches] WARNING: streaming patch failed (non-fatal)"
else
  echo "[patches] Skipped streaming patch (script not found)"
fi
