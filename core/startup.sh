#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Container entrypoint — boots s6-overlay inside a PID namespace.
#
# PERSISTENCE MODEL:
#   /workspace/  = PERSISTENT  (Docker volume — survives restart, recreate, update)
#   /opt/        = EPHEMERAL   (image layer — replaced on every image update)
#   /run/s6/     = EPHEMERAL   (tmpfs — rebuilt from /workspace/.secrets/ on boot)
#
# On boot, this script:
#   1. Ensures all persistent dirs exist under /workspace/
#   2. Migrates legacy layouts (symlinks → real dirs)
#   3. Fixes file ownership for the abc user
#   4. Cleans stale locks/WAL files from previous container
#   5. Hands off to s6-overlay (/init)
#
# The s6 init scripts then:
#   - Restore secrets → s6 env dir (97-secrets-to-s6-env.sh)
#   - Set up git, tool deps, env guards (98-kortix-env.sh)
#   - Restore user-installed apk/pip/npm packages (99-restore-packages.sh)
# ─────────────────────────────────────────────────────────────────────────────

set -e

# Resolve abc's actual UID/GID — never assume 1000.
# The linuxserver base image creates abc with UID 911, not 1000.
WORKSPACE_UID="$(id -u abc 2>/dev/null || echo 911)"
WORKSPACE_GID="$(id -g abc 2>/dev/null || echo 911)"

echo "[startup] Preparing Kortix sandbox..."

# ── Persistent dirs (all under /workspace/) ─────────────────────────────────
# /workspace is the ONLY persistent volume. Everything outside /workspace
# is ephemeral and gets reset on container recreate/update.
# If something needs to survive, it MUST be in /workspace/.
mkdir -p \
  /workspace/.agent-browser \
  /workspace/.browser-profile \
  /workspace/.lss \
  /workspace/.cache/opencode \
  /workspace/.local/share/opencode \
  /workspace/.local/share/opencode/log \
  /workspace/.local/share/opencode/storage \
  /workspace/.local/share/opencode/snapshot \
  /workspace/.local/bin \
  /workspace/.local/lib \
  /workspace/.npm-global/bin \
  /workspace/.npm-global/lib \
  /workspace/.kortix \
  /workspace/.kortix/packages \
  /workspace/.kortix-state \
  /workspace/.secrets \
  /workspace/.config \
  /workspace/.XDG \
  /workspace/.opencode \
  /workspace/.opencode/skills \
  /workspace/.ocx

# ── Migrate legacy symlinks to real dirs ────────────────────────────────────
# Old images created /workspace/.opencode as a symlink to /workspace/.kortix/.opencode.
# New model: /workspace/.opencode IS the real dir. Migrate data if needed.
if [ -L /workspace/.opencode ]; then
  LINK_TARGET=$(readlink /workspace/.opencode 2>/dev/null || true)
  echo "[startup] Migrating .opencode from symlink ($LINK_TARGET) to real dir..."
  rm -f /workspace/.opencode
  mkdir -p /workspace/.opencode/skills
  # Copy data from old location if it exists
  if [ -d "$LINK_TARGET" ]; then
    cp -a "$LINK_TARGET"/. /workspace/.opencode/ 2>/dev/null || true
  fi
fi

# Old images created /workspace/.secrets as a symlink to /workspace/.kortix/secrets.
# New model: /workspace/.secrets IS the real dir. Migrate data if needed.
if [ -L /workspace/.secrets ]; then
  LINK_TARGET=$(readlink /workspace/.secrets 2>/dev/null || true)
  echo "[startup] Migrating .secrets from symlink ($LINK_TARGET) to real dir..."
  rm -f /workspace/.secrets
  mkdir -p /workspace/.secrets
  if [ -d "$LINK_TARGET" ]; then
    cp -a "$LINK_TARGET"/. /workspace/.secrets/ 2>/dev/null || true
  fi
  chmod 700 /workspace/.secrets
fi

# ── Convenience symlink: opencode → .opencode ───────────────────────────────
# Visible, discoverable alias for users who don't know to look for dotfiles.
# Migrate legacy "OpenCodeConfig" symlink to the shorter "opencode" name.
if [ -L /workspace/OpenCodeConfig ]; then
  rm -f /workspace/OpenCodeConfig
fi
if [ ! -e /workspace/opencode ] && [ ! -L /workspace/opencode ]; then
  ln -s /workspace/.opencode /workspace/opencode
fi

# ── Exclude opencode internal dirs from git (prevents 16K+ snapshot diffs) ──
# Only refresh info/exclude when the git repo already exists (container restart).
# For fresh workspaces, kortix-env-setup.sh writes info/exclude AFTER git init
# (git init overwrites info/exclude with its default template, so writing it here
# on fresh repos is pointless — it gets clobbered).
if [ -f /workspace/.git/HEAD ]; then
  mkdir -p /workspace/.git/info 2>/dev/null || true
  cat > /workspace/.git/info/exclude << 'GITEXCLUDE'
# opencode internal data — never include in snapshot diffs
.local/share/opencode/
.cache/
.config/
.opencode/
.kortix/
.kortix-state/
.secrets/
.browser-profile/
.agent-browser/
.lss/
.ocx/
.XDG/
.bun/
.npm-global/
.npm/
.dbus/
.pki/
.ssh/
ssl/
opencode
GITEXCLUDE
fi

# ── Clean stale browser locks ───────────────────────────────────────────────
# After unclean shutdown, Chromium singletons prevent agent-browser from starting.
rm -f /workspace/.browser-profile/SingletonLock \
     /workspace/.browser-profile/SingletonCookie \
     /workspace/.browser-profile/SingletonSocket 2>/dev/null

# ── Clean stale legacy dirs ─────────────────────────────────────────────────
# ssl/ was created by old images but never used by anything. Remove if empty.
[ -d /workspace/ssl ] && [ -z "$(ls -A /workspace/ssl 2>/dev/null)" ] && rmdir /workspace/ssl 2>/dev/null || true

# ── Fix ownership (critical after Docker image updates) ─────────────────────
# When a container is recreated from a new image, the abc user UID may differ
# from the previous image. Fix ALL workspace files to match the current abc user.
echo "[startup] Fixing workspace ownership..."
chown -R "$WORKSPACE_UID:$WORKSPACE_GID" /workspace 2>/dev/null || true
chmod 700 /workspace/.secrets 2>/dev/null || true

# Also fix /opt dirs — the Dockerfile chowns these to abc:abc at build time,
# but if the image was built with an older Dockerfile that used 1000:1000,
# this ensures they are corrected at runtime too.
chown -R "$WORKSPACE_UID:$WORKSPACE_GID" \
  /ephemeral \
  2>/dev/null || true

# ── Initialize ocx (marketplace CLI) ────────────────────────────────────────
# Runs AFTER chown so all files ocx creates are owned by abc, not root.
# This prevents EACCES errors when the frontend PTY runs 'ocx add' as abc.
if command -v ocx >/dev/null 2>&1; then
  if [ ! -f /workspace/.opencode/ocx.jsonc ]; then
    echo "[startup] Running ocx init..."
    su -s /bin/sh abc -c 'ocx init --cwd /workspace' 2>/dev/null || echo "[startup] WARNING: ocx init failed (non-fatal)"
  fi
  # Always ensure registry aliases exist (idempotent)
  su -s /bin/sh abc -c 'ocx registry add https://master.kortix-registry.pages.dev --name kortix --cwd /workspace -q' 2>/dev/null || true
  su -s /bin/sh abc -c 'ocx registry add https://registry.kdco.dev --name kdco --cwd /workspace -q' 2>/dev/null || true
fi

# ── Clean stale sqlite WAL/SHM files ────────────────────────────────────────
# After container recreate, sqlite WAL/SHM files from the old container can
# cause "readonly database" errors. Remove them so sqlite recreates cleanly.
find /workspace/.local/share/opencode -name "*.db-wal" -o -name "*.db-shm" 2>/dev/null | while read f; do
  echo "[startup] Removing stale sqlite file: $f"
  rm -f "$f"
done

# ── Stale LSS database cleanup ───────────────────────────────────────────────
if [ -f /workspace/.lss/lss.db ]; then
  LSS_OWNER=$(stat -c '%u' /workspace/.lss/lss.db 2>/dev/null || echo "unknown")
  if [ "$LSS_OWNER" != "$WORKSPACE_UID" ] && [ "$LSS_OWNER" != "unknown" ]; then
    echo "[startup] Removing stale LSS database (owned by UID $LSS_OWNER, expected $WORKSPACE_UID)"
    rm -f /workspace/.lss/lss.db /workspace/.lss/lss.db-wal /workspace/.lss/lss.db-shm
  fi
fi

# ── /config symlink (linuxserver base image compat) ─────────────────────────
if [ ! -L /config ] && [ ! -d /config ]; then
  ln -s /workspace /config
fi

# ── Verify runtime exists ───────────────────────────────────────────────────
if [ ! -e /ephemeral/kortix-master ]; then
  echo "[startup] WARNING: /ephemeral/kortix-master not found! Rebuild the Docker image."
fi

# ── Install stable channel CLI wrappers ─────────────────────────────────────
# Runtime-facing commands (ktelegram/kslack/kchannel) should always resolve
# from immutable /ephemeral code, never /workspace.
if [ -x /ephemeral/kortix-master/scripts/install-channel-clis.sh ]; then
  /ephemeral/kortix-master/scripts/install-channel-clis.sh || echo "[startup] WARNING: channel CLI install failed"
fi

echo "[startup] Starting s6-overlay via PID namespace..."

if unshare --pid --fork true >/dev/null 2>&1; then
  exec unshare --pid --fork /init
fi

echo "[startup] WARNING: unshare not permitted — falling back to direct /init"
exec /init
