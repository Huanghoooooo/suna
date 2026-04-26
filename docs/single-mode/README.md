# Kortix Single Mode

Single Mode is a sidecar rewrite for a simpler product shape:

- one operator
- one fixed Docker sandbox
- multiple isolated sessions inside that sandbox
- no Supabase, account switching, billing, providers, sandbox pool, or team logic

It keeps the core runtime:

- `core/docker`
- `core/kortix-master`
- OpenCode inside the sandbox

## Current Progress

Implemented:

- `apps/single-api`
  - sandbox status/start/restart/stop/logs
  - session registry stored in `.single-data/sessions.json`
  - session workspace convention: `/workspace/sessions/<session_id>`
  - prompt forwarding to OpenCode through the sandbox master
  - message polling from OpenCode
  - preview proxy: `/api/preview/:port/*`
- `apps/single-web`
  - single operator workspace
  - session list
  - chat composer
  - sandbox status panel
  - log viewer
  - static preview launcher
- one-command dev script: `pnpm single:dev`
- deployment helper: `pnpm single:deploy`

Not yet implemented:

- hard filesystem sandboxing between sessions
- process/port reservation per session
- file explorer
- production systemd/nginx templates
- multi-sandbox registry

## Ports

Default ports:

| Service | URL |
| --- | --- |
| Single Web | `http://localhost:13000` |
| Single API | `http://localhost:18008` |
| Sandbox Master | `http://127.0.0.1:14000` |
| Sandbox noVNC | `http://127.0.0.1:14002` |
| Sandbox static web | proxied through `http://localhost:18008/api/preview/3211/` |

## Development

```bash
pnpm install
pnpm single:dev
```

The first run creates:

```text
apps/single-api/.env
apps/single-web/.env.local
```

Review `apps/single-api/.env` before using this outside localhost.

After changing model API keys, recreate the sandbox so container env is refreshed:

```bash
SINGLE_RECREATE_SANDBOX=1 pnpm single:dev
```

## LAN / Tailscale Access

If you open the app from another device, replace localhost in both env files:

```bash
SINGLE_PUBLIC_API_URL=http://100.90.101.9:18008
SINGLE_WEB_URL=http://100.90.101.9:13000
KORTIX_API_URL=http://100.90.101.9:18008
```

And in `apps/single-web/.env.local`:

```bash
NEXT_PUBLIC_SINGLE_API_URL=http://100.90.101.9:18008
```

Restart `pnpm single:dev` after changing env.

## Production Build

```bash
pnpm single:deploy
pnpm --filter kortix-single-api start
pnpm --filter kortix-single-web start
```

For a customer machine, put those two start commands behind systemd or a process manager.

## Health Checks

```bash
curl http://localhost:18008/health
curl http://localhost:18008/api/sandbox/status
curl http://localhost:18008/api/sandbox/logs
```

If chat does not work, check in this order:

1. `docker ps` shows `kortix-single-sandbox` running
2. `curl http://127.0.0.1:14000/kortix/health`
3. `curl http://localhost:18008/api/sandbox/status`
4. `curl http://localhost:18008/api/sandbox/logs`

## Architecture

```text
apps/single-web
  -> apps/single-api
    -> fixed Docker sandbox: kortix-single-sandbox
      -> core/kortix-master
        -> OpenCode
```

The old Suna platform remains untouched. Single Mode is designed so it can later grow into:

```text
v1: one sandbox, many sessions
v2: one user, many sandboxes
v3: users or tenants mapped to sandboxes
```
