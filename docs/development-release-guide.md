# Development & Release Guide

> How the Suna project is developed, built, and deployed.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Local Development](#local-development)
3. [Sandbox Dev Details](#sandbox-dev-details)
4. [CI/CD: Dev Line](#cicd-dev-line)
5. [CI/CD: Prod Line (Release)](#cicd-prod-line-release)
6. [Docker Hub Tags](#docker-hub-tags)
7. [Ports Reference](#ports-reference)
8. [Quick Reference Cheatsheet](#quick-reference-cheatsheet)

---

## Architecture Overview

### Three components

| Component | Image | Source | What it does |
|---|---|---|---|
| **API** | `kortix/kortix-api` | `apps/api/` | Backend API server (Bun + Hono) |
| **Frontend** | `kortix/kortix-frontend` | `apps/web/` | Next.js web app |
| **Computer** | `kortix/computer` | `core/` | Sandbox container (Alpine, s6-overlay, browser, tools) |

### Two environments

| Environment | API | Frontend | Computer |
|---|---|---|---|
| **Dev** | `dev.kortix.com` | Vercel preview | JustAVPS (dev snapshot) |
| **Prod** | `kortix.com` | Vercel production | JustAVPS (prod snapshot) |

### Single registry

All Docker images live on **Docker Hub** under the `kortix/` namespace. No GHCR.

---

## Local Development

### Quick Start

```bash
# 1. Start Supabase (auth + DB)
supabase start
supabase status -o env  # copy values into apps/api/.env and apps/web/.env.local

# 2. Start dev servers (frontend + API)
pnpm dev

# 3. Start sandbox (optional — only if you need it)
pnpm dev:sandbox
```

### Individual services

```bash
pnpm dev:frontend   # Next.js dev server on http://localhost:3000
pnpm dev:api        # kortix-api on http://localhost:8008
pnpm dev            # Both at once
pnpm dev:sandbox    # Sandbox container with bind mounts
```

---

## Sandbox Dev Details

### Bind mounts (dev mode)

`docker-compose.dev.yml` mounts local source over the prebaked image:

| Local path | Container path |
|---|---|
| `core/kortix-master/src` | `/ephemeral/kortix-master/src` |
| `core/kortix-master/opencode/` | `/ephemeral/kortix-master/opencode/` |
| `core/kortix-master/channels/src` | `/ephemeral/kortix-master/channels/src` |
| `core/kortix-master/triggers/src` | `/ephemeral/kortix-master/triggers/src` |

### When to rebuild

You **do not** need to rebuild for:
- TypeScript source changes (bind-mounted live)
- Adding/editing agents, skills, tools, prompts

You **do** need `pnpm dev:sandbox --build` when:
- `Dockerfile` changes
- `core/package.json` changes (new/removed dep)
- `kortix-master/package.json` or `bun.lock` changes

### Restarting services inside the container

```bash
docker exec kortix-sandbox s6-svc -r /run/service/svc-kortix-master
docker exec -it kortix-sandbox bash
```

### Health check

```bash
curl http://127.0.0.1:14000/kortix/health
```

---

## CI/CD: Dev Line

**Workflow:** `.github/workflows/deploy-dev.yml`
**Trigger:** Push to `main` (path-filtered) or manual dispatch

### How it works

```
push to main
  │
  ├─► detect-changes (dorny/paths-filter)
  │     outputs: api_changed, frontend_changed, computer_changed
  │
  ├─► build-api (if api changed)
  │     Build kortix/kortix-api:dev-{sha8} + dev-latest → Docker Hub
  │     └─► deploy-api → SSH into dev VPS → zero-downtime deploy
  │
  ├─► build-frontend (if frontend changed)
  │     Host build (pnpm build) → Docker build → Docker Hub
  │
  └─► build-computer (if core/ changed)
        Build kortix/computer:dev-{sha8} + dev-latest → Docker Hub
        └─► build-dev-snapshot → JustAVPS snapshot (async)
```

### What triggers what

| Path changed | Build triggered | Deploy triggered |
|---|---|---|
| `apps/api/**`, `packages/**`, `pnpm-lock.yaml` | API image | API → dev VPS |
| `apps/web/**`, `packages/shared/**` | Frontend image | — (Vercel handles frontend) |
| `core/**` | Computer image | JustAVPS snapshot |

### Deploy script

The dev VPS deploy uses `scripts/deploy-zero-downtime.sh` — a blue/green deployment with nginx port swapping. The CI passes `PREBUILT_IMAGE=kortix/kortix-api:dev-{sha8}` so the VPS pulls the pre-built image instead of building locally.

---

## CI/CD: Prod Line (Release)

> **Not yet implemented.** This section describes the planned approach.

The prod release workflow will:
1. Be triggered manually via GitHub Actions
2. Re-tag `dev-latest` images to the release version (e.g., `0.8.28`)
3. Deploy to the production VPS
4. Create a GitHub Release with changelog

---

## Docker Hub Tags

All images are in the `kortix/` Docker Hub namespace.

### Tag convention

| Tag | Meaning | Example |
|---|---|---|
| `dev-{sha8}` | Specific dev build from a commit | `kortix/kortix-api:dev-a1b2c3d4` |
| `dev-latest` | Current state on the dev environment | `kortix/kortix-api:dev-latest` |
| `0.8.28` | Pinned prod release | `kortix/kortix-api:0.8.28` |
| `latest` | Latest prod release | `kortix/kortix-api:latest` |

### Images

| Image | Component |
|---|---|
| `kortix/kortix-api` | Backend API |
| `kortix/kortix-frontend` | Next.js frontend |
| `kortix/computer` | Sandbox container |

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

### Force rebuild after dep change

```bash
pnpm dev:sandbox --build
```

### Build sandbox image manually

```bash
docker compose -f core/docker/docker-compose.yml build
```

### Trigger a dev deploy manually

```bash
gh workflow run deploy-dev.yml --repo kortix-ai/suna
```
