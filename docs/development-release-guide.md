# Development & Release Guide

> **Single source of truth** for local development, sandbox architecture, versioning, and releases.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Local Dev Workflow](#local-dev-workflow)
4. [Sandbox Dev Details](#sandbox-dev-details)
5. [Versioning](#versioning)
6. [CI/CD & Deployment](#ci-cd--deployment)
7. [Release Flow](#release-flow)
8. [Update Mechanism](#update-mechanism)
9. [Docker Image Architecture](#docker-image-architecture)
10. [Ports Reference](#ports-reference)
11. [Quick Reference Cheatsheet](#quick-reference-cheatsheet)

---

## Quick Start

```bash
# 1. Start Supabase (auth + DB)
supabase start
supabase status -o env  # copy values into apps/api/.env and apps/web/.env.local

# 2. Start dev servers (frontend + API)
pnpm dev

# 3. Start sandbox (optional — only if you need it)
pnpm dev:sandbox
```

---

## Architecture Overview

The sandbox is built in 4 layers:

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Image (kortix/computer)                             │
│  OS: Alpine XFCE, Bun, uv, chromium, SSH, s6-overlay       │
│  Prebaked at: docker build time                             │
│                                                             │
│  /ephemeral/kortix-master/            ← proxy/API server    │
│  /ephemeral/kortix-master/opencode/   ← OpenCode config     │
│  /ephemeral/kortix-master/channels/   ← chat adapters       │
│  /ephemeral/kortix-master/triggers/   ← cron/triggers       │
│  /ephemeral/agent-browser-viewer/     ← browser viewer UI   │
│  /ephemeral/metadata/                 ← version + CHANGELOG │
│                                                             │
│  Versioned releases are shipped as Docker image tags        │
│  (`kortix/computer:<version>`) instead of staged OTA trees  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  s6-overlay services (managed by s6-rc)                     │
│  svc-kortix-master  — starts /ephemeral/kortix-master       │
│  svc-sshd           — SSH daemon                            │
│  svc-de             — desktop environment (webtop)          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  kortix-master (proxy + control server)                     │
│  Port 8000 — entry point for all sandbox API calls          │
│  Mounts: /kortix/*, /health, /update, /proxy, /lss, etc.   │
│  Process-manages: opencode, agent-browser, lss, channels    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  /workspace  (persistent volume — user data)                │
│  .kortix/         — opencode config, agent state            │
│  .kortix-state/   — kortix-master persisted state           │
│  .browser-profile/ — Chromium profile                       │
│  .lss/            — semantic search DB                      │
│  .secrets/        — injected env vars (mode 700)            │
└─────────────────────────────────────────────────────────────┘
```

### Runtime contract

The sandbox runtime is baked directly into the container image under `/opt/*`.
When a new release ships, running sandboxes update by pulling the new tagged Docker image and recreating the container with the same persistent `/workspace` volume.

---

## Local Dev Workflow

### 1. Frontend

```bash
pnpm dev:frontend
# Runs: Next.js dev server on http://localhost:3000
# Source: apps/web/
```

### 2. API

```bash
pnpm dev:api
# Runs: kortix-api on http://localhost:8008
# Source: apps/api/
```

### 3. Both (common case)

```bash
pnpm dev
```

### 4. Sandbox (when you need it)

```bash
pnpm dev:sandbox
# = docker compose -f .../docker-compose.yml -f .../docker-compose.dev.yml up
```

This uses **two compose files**:
- `docker-compose.yml` — builds the image, sets ports and env
- `docker-compose.dev.yml` — **overlay** that bind-mounts your local source

With the dev overlay, **code changes are live immediately**. You only need `--build` when deps change (see below).

---

## Sandbox Dev Details

### Bind mounts (dev mode)

`docker-compose.dev.yml` mounts local source over the prebaked image:

| Local path | Container path |
|---|---|
| `core/kortix-master/src` | `/ephemeral/kortix-master/src` |
| `core/kortix-master/opencode/` | `/ephemeral/kortix-master/opencode/` (agents, tools, skills, plugin, commands) |
| `core/kortix-master/channels/src` | `/ephemeral/kortix-master/channels/src` |
| `core/kortix-master/triggers/src` | `/ephemeral/kortix-master/triggers/src` |

These mounts land directly in the running code path inside the dev container.

### When to rebuild the image

You **do not** need to rebuild for:
- TypeScript source changes (they're bind-mounted live)
- Adding/editing agents, skills, tools, prompts

You **do** need `pnpm dev:sandbox --build` when:
- `Dockerfile` changes
- `core/package.json` changes (new/removed dep)
- `kortix-master/package.json` or `bun.lock` changes
- `kortix-opencode/package.json` changes

### Restarting services inside the container

```bash
# Restart kortix-master (picks up code changes when not bind-mounted):
docker exec kortix-sandbox s6-svc -r /run/service/svc-kortix-master

# View live logs:
docker exec kortix-sandbox s6log tail /run/service/svc-kortix-master/log/

# Shell into the container:
docker exec -it kortix-sandbox bash
```

### Health check

```bash
curl http://127.0.0.1:14000/kortix/health
# Returns: {"status":"ok","version":"0.7.26"}
```

---

## Versioning

### Semver conventions

| Bump | When |
|---|---|
| **patch** `0.7.x` | Bug fixes, agent/skill updates, small tweaks |
| **minor** `0.x.0` | New features, new services, breaking internal APIs |
| **major** `x.0.0` | Architecture changes, Docker base image overhaul |

### Version locations

The single source of version truth is `core/package.json`. The `ship` script keeps all other locations in sync:

| File | Field |
|---|---|
| `core/package.json` | `"version"` |
| `core/release.json` | `version`, `images.*`, `snapshots.*` |
| `core/startup.sh` | `DEFAULT_KORTIX_SANDBOX_VERSION` |
| `scripts/get-kortix.sh` | `DEFAULT_KORTIX_VERSION` |

### Changelog

Before releasing, add an entry to `core/CHANGELOG.json`:

```json
{
  "version": "0.8.0",
  "date": "2026-03-15",
  "title": "Short title for the release",
  "description": "Optional longer description",
  "changes": [
    { "type": "feature", "text": "Added X" },
    { "type": "fix",     "text": "Fixed Y" }
  ]
}
```

`pnpm ship` will reject if the changelog entry is missing.

---

## CI/CD & Deployment

The project uses **two independent deployment tracks**:

### Track 1: API + Frontend (Continuous Deployment)

The API (`kortix-api`) and frontend (`apps/web`) deploy independently of sandbox releases.

```
push to main
  └─► deploy-api.yml (auto)
        └─► SSH → dev VPS → docker compose build+up
            dev-new-api.kortix.com ✓

ready for prod?
  └─► gh workflow run deploy-api.yml (manual, select "prod")
        └─► SSH → prod VPS → docker compose build+up
            new-api.kortix.com ✓
```

- **Dev**: auto-deploys on every push to `main` (when `apps/api/`, `packages/`, or `scripts/compose/` change)
- **Prod**: manual workflow dispatch — `gh workflow run deploy-api.yml -f target=prod`
- **Frontend**: Vercel auto-deploys from `main`
- **Rollback**: re-run the workflow on a previous commit

### Track 2: Sandbox Release (Versioned, via `pnpm ship`)

See [Release Flow](#release-flow) below. `pnpm ship` builds Docker images, creates GitHub Releases, and seeds JustAVPS snapshots. This is the only way to publish a new version to users.

### Infrastructure

| Component | Dev | Prod |
|---|---|---|
| **API** | `kortix-dev` Lightsail → `dev-new-api.kortix.com` | `kortix-prod` Lightsail → `new-api.kortix.com` |
| **Frontend** | Vercel → `dev-new.kortix.com` | Vercel → `new.kortix.com` |

> **Planned cutover**: `new-api.kortix.com` → `api.kortix.com`, `new.kortix.com` → `kortix.com`

### Deploy commands

```bash
# Deploy API to prod (manual)
gh workflow run deploy-api.yml -f target=prod --repo kortix-ai/suna

# Deploy API to dev (manual override — normally auto on push)
gh workflow run deploy-api.yml -f target=dev --repo kortix-ai/suna
```

---

## Release Flow

### One-liner

```bash
pnpm ship 0.8.0                 # Full release: GitHub Release + Docker images + JustAVPS image
pnpm ship --no-docker 0.8.0     # Skip Docker image rebuild/push
pnpm image 0.8.0                # Rebuild only the JustAVPS image for this version
```

### What `ship` does step by step

1. **Validate** — checks changelog entry exists and inspects whether the GitHub release already exists
2. **Bump versions** — updates all 4 version locations (package.json, release.json, startup.sh, get-kortix.sh)
3. **GitHub Release** — creates `v{version}` release with changelog as notes, or reuses the existing release
4. **Docker** — `docker buildx build --platform linux/amd64,linux/arm64 --push` for `kortix/computer`, `kortix/kortix-api`, and `kortix/kortix-frontend` unless you pass `--no-docker`
5. **JustAVPS image** — creates a temporary JustAVPS machine, waits until it is ready, captures a JustAVPS image from it, boots a fresh verification machine from the new image, updates `apps/api/.env` with `JUSTAVPS_IMAGE_ID`, and deletes both temporary machines
6. **Commit** — `git commit -m "release: v{version}"` when there are version-bump changes to record (you still run `git push`)

By default the image-builder script uses `nbg1` for the temporary build machine unless you override `JUSTAVPS_IMAGE_BUILD_LOCATION`.

### After shipping

```bash
git push
# The push to main auto-deploys the API to dev.
# To also deploy the API to prod:
gh workflow run deploy-api.yml -f target=prod --repo kortix-ai/suna
```

### Validate state without shipping

```bash
pnpm check
# Shows: version numbers, git status, gh auth status
```

---

## Update Mechanism

Running sandboxes update by replacing the container image, not by staging OTA tarballs inside the VM.

### How a sandbox updates

1. User clicks **Update** in the sidebar, or the platform hits the sandbox update API
2. The control plane resolves the target version from `core/release.json`
3. The host pulls the matching image tags such as `kortix/computer:{version}`
4. The sandbox container is recreated with the same mounted workspace and env
5. Health checks wait for `kortix-master` and dependent services to come back cleanly

### Why this model is simpler

- **Single release artifact** — the Docker tag is the deployable unit
- **Consistent runtime** — cloud and self-hosted installs boot the same image
- **Safer rollback** — reverting means recreating from the previous tag
- **Less moving state** — user files stay in `/workspace`, app code stays in the image

---

## Docker Image Architecture

### What's in the image (prebaked at build time)

Everything needed to run, with zero network calls on container start:

| Path | Contents |
|---|---|
| `/opt/bun/` | Bun runtime |
| `/usr/local/bin/uv` | uv (Python package runner) |
| `/opt/bun-pty-musl/librust_pty.so` | musl-compiled bun-pty Rust lib |
| `/ephemeral/kortix-master/` | Proxy + control server runtime |
| `/ephemeral/kortix-master/opencode/` | OpenCode config, agents, tools, skills, plugins |
| `/etc/s6-overlay/s6-rc.d/` | Service definitions |
| `/custom-cont-init.d/` | Init scripts |

### What's NOT in the image

- User workspace data (mounted at `/workspace` as a volume)
- Secrets (injected via env vars → `/workspace/.secrets/`)
- New code versions beyond the currently pulled image tag

### Build command

```bash
# Just the sandbox image (local, for dev):
docker compose -f core/docker/docker-compose.yml build

# Multi-platform release push:
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f core/docker/Dockerfile \
  -t kortix/computer:0.8.0 \
  -t kortix/computer:latest \
  --push .
```

### When to rebuild the image

Only when something in the Dockerfile or its dependency chain changes:
- `Dockerfile` itself
- Any `apk add` package needed
- Bun version
- `core/package.json` (adds/removes a dep that needs prebaking)
- `bun.lock` in a sandbox package

For everything else, `pnpm ship` and a container recreate are sufficient.

---

## Ports Reference

All ports are on `127.0.0.1` in dev (no public exposure).

| Host port | Container port | Service |
|---|---|---|
| `14000` | `8000` | Kortix Master (proxy entry point) |
| `14001` | `3111` | OpenCode Web UI |
| `14002` | `6080` | Desktop (noVNC HTTP) |
| `14003` | `6081` | Desktop (noVNC HTTPS) |
| `14004` | `3210` | Presentation Viewer |
| `14005` | `9223` | Agent Browser Stream (WebSocket) |
| `14006` | `9224` | Agent Browser Viewer |
| `14007` | `22` | SSH |
| `14008` | `3211` | Static Web Server |

---

## Quick Reference Cheatsheet

### Start dev

```bash
supabase start
pnpm dev                  # frontend + API
pnpm dev:sandbox          # sandbox (separate terminal)
```

### Check health

```bash
curl http://127.0.0.1:14000/kortix/health
```

### Restart kortix-master inside sandbox

```bash
docker exec kortix-sandbox s6-svc -r /run/service/svc-kortix-master
```

### Shell into sandbox

```bash
docker exec -it kortix-sandbox bash
```

### Release a new version

```bash
# 1. Add changelog entry to core/CHANGELOG.json
# 2. Ship everything:
pnpm ship 0.8.0
git push
# 3. Deploy API to prod if needed:
gh workflow run deploy-api.yml -f target=prod --repo kortix-ai/suna
```

### Release + new Docker image

```bash
pnpm ship 0.8.0
git push
# Deploy API to prod:
gh workflow run deploy-api.yml -f target=prod --repo kortix-ai/suna
```

### Rebuild the JustAVPS image only

```bash
pnpm image 0.8.0
```

### Validate/check state

```bash
pnpm check
```

### Build sandbox image manually

```bash
docker compose -f core/docker/docker-compose.yml build
```

### Deploy API to prod

```bash
gh workflow run deploy-api.yml -f target=prod --repo kortix-ai/suna
```

### Force rebuild after dep change

```bash
pnpm dev:sandbox --build
```
