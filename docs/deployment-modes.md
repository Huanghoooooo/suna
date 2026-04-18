# 部署模式说明 | Deployment Modes

> 最后更新 | Last updated: 2026-04-18
>
> 配套阅读 | See also: [`custom-providers.md`](./custom-providers.md)

---

## 中文

### 我们的交付场景

**客户自己的服务器 + 客户自己的 LLM API Key**。客户数据完全不经过 Kortix 或任何第三方 SaaS。我们提供一键部署能力，不代客户付任何云服务费。

因此我们采用**最简洁的 self-hosted 组合**。

### 两个正交维度

Suna 的运行形态由**两个独立**的配置维度决定：

| 维度 | 控制什么 | 关键 env |
| --- | --- | --- |
| **`ENV_MODE`** | LLM 出口策略 + 是否开启计费 | `OPENROUTER_API_KEY`, `KORTIX_TOKEN`, Stripe 等 |
| **`ALLOWED_SANDBOX_PROVIDERS`** | 沙盒容器在哪里跑 | `DOCKER_HOST`, `DAYTONA_API_KEY`, `JUSTAVPS_API_KEY` 等 |

可能组合（简表）：

| ENV_MODE | 沙盒 provider | 典型场景 |
| --- | --- | --- |
| `local` | `local_docker` | **我们的交付模式**（客户服务器 + 客户 Docker） |
| `local` | `daytona` / `justavps` | 开发者用本地 API 驱动远程云沙盒 |
| `cloud` | `local_docker` | Kortix SaaS 本机试用，少见 |
| `cloud` | `daytona` / `justavps` | Kortix 官网的完整 SaaS 形态 |

### 我们固定使用的模式

```
ENV_MODE=local
ALLOWED_SANDBOX_PROVIDERS=local_docker
```

**含义**：

- **不走** Kortix 中转，LLM 请求直接从沙盒容器发往各家官方或中转 endpoint（如 apipool、open.bigmodel.cn）
- **不需要** `KORTIX_TOKEN`（没有它 `opencode.jsonc` 里的 `kortix` provider 会一直空 key，交付时可以注释掉或保留不影响运行）
- **不需要** Stripe / RevenueCat / token ledger
- **不需要** Daytona 或 JustAVPS 帐号
- 沙盒容器由客户服务器上的 **本机 Docker daemon** 管理，API 通过 `DOCKER_HOST`（通常 `unix:///var/run/docker.sock`）连过去

### 客户服务器的前置要求

1. **Linux 服务器**（推荐 Ubuntu 22.04+）
2. **Docker Engine + Docker Compose**（沙盒容器需要 DinD 能力，确保 Docker 至少 20.10+）
3. **Node / pnpm**（如果是源码部署）或直接 `docker compose` 起完整 stack
4. **反代层**：nginx / Caddy / openresty 任选，用于把 API、Web、Supabase 暴露成单一入口（可选，但强烈推荐）
5. **对外端口**：通常只需开放反代的入口端口（例如 8800），内部 3000 / 8008 / 54321 保持 loopback

### 必填 env（交付清单）

在 `apps/api/.env` 里：

```
# ─── 核心 ─────────────────────────────────────────
ENV_MODE=local
PORT=8008

# ─── 数据库 ───────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:64322/postgres
SUPABASE_URL=http://127.0.0.1:64321
SUPABASE_SERVICE_ROLE_KEY=<客户 Supabase 安装提供>

# ─── 沙盒 ─────────────────────────────────────────
ALLOWED_SANDBOX_PROVIDERS=local_docker
DOCKER_HOST=unix:///var/run/docker.sock

# ─── LLM provider 的 API Key（对应 opencode.jsonc 已启用条目）─
BIGMODEL_API_KEY=<客户填>
CLAUDE_API_KEY=<客户填>

# ─── 其它 ─────────────────────────────────────────
API_KEY_SECRET=<客户交付时生成一个 64 位 hex，比如 openssl rand -hex 32>
INTERNAL_SERVICE_KEY=<首启自动生成，无需手填>
```

### 不要动的 env

以下变量**留空或删掉即可**，填错反而会触发错误分支：

- `KORTIX_TOKEN`, `KORTIX_API_URL`（走 Kortix 中转才需要）
- `STRIPE_SECRET_KEY`, `REVENUECAT_API_KEY`（cloud 计费才需要）
- `DAYTONA_*`, `JUSTAVPS_*`（远程云沙盒才需要）

### 交付前检查清单

- [ ] `ENV_MODE=local`，`ALLOWED_SANDBOX_PROVIDERS=local_docker`
- [ ] `apps/api/.env` 里每个在 `opencode.jsonc` 中启用的 provider 都有对应 API Key
- [ ] `DOCKER_HOST` 指向客户机器的 Docker socket，且运行用户在 `docker` 组里
- [ ] Supabase 本地实例已起，`SUPABASE_SERVICE_ROLE_KEY` 已填
- [ ] nginx 反代配置（示例见 `/opt/1panel/apps/openresty/.../kortix.conf`）
- [ ] 沙盒镜像已 pull 或已 build（见 `scripts/start-sandbox.sh`）
- [ ] 首次启动后，确认 `http://<反代入口>/v1/providers/health` 返回 `{ok: true}`
- [ ] Chat 流能正常收 streaming 消息

### 常见误区

- **"ENV_MODE=cloud 比 local 更'高级'"**：错。Cloud 是 Kortix SaaS 的路径，启用它意味着引入 Stripe 计费和 Kortix 中转，**不适合** self-hosted 交付。
- **"local_docker 就是只能跑在本机"**：错。`local` 指"和 API 同一台机器上的 Docker"。客户的云服务器上跑着 Docker，API 也在这台机器上，就叫 `local_docker`。
- **"客户需要自己的 Kortix 帐号"**：不需要。我们走 `local` 模式，`kortix` provider 块客户用不到，可以注释或无视。

---

## English

### Our delivery scenario

**Customer's own server + customer's own LLM API keys.** No customer data touches Kortix or any third-party SaaS. We deliver a turn-key self-hosted deployment; we do not pay for any cloud services on behalf of the customer.

Therefore we use the **simplest possible self-hosted combination**.

### Two orthogonal dimensions

Suna's runtime shape is governed by two independent config axes:

| Axis | What it controls | Key env vars |
| --- | --- | --- |
| **`ENV_MODE`** | LLM egress strategy + whether billing is enabled | `OPENROUTER_API_KEY`, `KORTIX_TOKEN`, Stripe, ... |
| **`ALLOWED_SANDBOX_PROVIDERS`** | Where sandbox containers actually run | `DOCKER_HOST`, `DAYTONA_API_KEY`, `JUSTAVPS_API_KEY`, ... |

Combinations (abridged):

| ENV_MODE | Sandbox provider | Typical scenario |
| --- | --- | --- |
| `local` | `local_docker` | **Our delivery mode** (customer server + customer Docker) |
| `local` | `daytona` / `justavps` | Dev uses local API with remote cloud sandboxes |
| `cloud` | `local_docker` | Kortix SaaS tryout on localhost, rare |
| `cloud` | `daytona` / `justavps` | Full Kortix SaaS (what kortix.com runs) |

### Our fixed mode

```
ENV_MODE=local
ALLOWED_SANDBOX_PROVIDERS=local_docker
```

Meaning:

- LLM traffic does **not** go through Kortix's router; it goes directly from the sandbox to each vendor's official or relay endpoint (apipool, open.bigmodel.cn, ...).
- `KORTIX_TOKEN` is **not required** — the `kortix` provider block in `opencode.jsonc` will stay empty-keyed (harmless; feel free to comment it out for delivery).
- No Stripe / RevenueCat / token ledger needed.
- No Daytona or JustAVPS account needed.
- Sandbox containers are orchestrated by the **Docker daemon on the customer's server**, reached by the API via `DOCKER_HOST` (usually `unix:///var/run/docker.sock`).

### Customer server prerequisites

1. **Linux server** (Ubuntu 22.04+ recommended)
2. **Docker Engine + Docker Compose** (sandboxes need DinD; require Docker ≥ 20.10)
3. **Node / pnpm** (for source-code deploys) or full stack via `docker compose`
4. **Reverse proxy**: nginx / Caddy / openresty — pick one; used to expose API + Web + Supabase behind a single port (optional but strongly recommended)
5. **Network**: only the reverse-proxy port needs public exposure (e.g. 8800); keep 3000 / 8008 / 54321 on loopback

### Required env (delivery checklist)

In `apps/api/.env`:

```
# ─── Core ─────────────────────────────────────────
ENV_MODE=local
PORT=8008

# ─── Database ─────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:64322/postgres
SUPABASE_URL=http://127.0.0.1:64321
SUPABASE_SERVICE_ROLE_KEY=<from the customer's Supabase install>

# ─── Sandbox ──────────────────────────────────────
ALLOWED_SANDBOX_PROVIDERS=local_docker
DOCKER_HOST=unix:///var/run/docker.sock

# ─── LLM provider API keys (matching enabled entries in opencode.jsonc) ─
BIGMODEL_API_KEY=<customer-provided>
CLAUDE_API_KEY=<customer-provided>

# ─── Misc ─────────────────────────────────────────
API_KEY_SECRET=<generate at delivery time, e.g. openssl rand -hex 32>
INTERNAL_SERVICE_KEY=<auto-generated on first start; leave blank>
```

### What to leave blank

These vars should **stay empty or be removed** — populating them will send the code down the wrong branches:

- `KORTIX_TOKEN`, `KORTIX_API_URL` (only for Kortix-routed egress)
- `STRIPE_SECRET_KEY`, `REVENUECAT_API_KEY` (only for cloud billing)
- `DAYTONA_*`, `JUSTAVPS_*` (only for remote cloud sandboxes)

### Pre-delivery checklist

- [ ] `ENV_MODE=local`, `ALLOWED_SANDBOX_PROVIDERS=local_docker`
- [ ] Every enabled provider in `opencode.jsonc` has a matching API key in `apps/api/.env`
- [ ] `DOCKER_HOST` points at the customer's Docker socket; run-user is in the `docker` group
- [ ] Supabase local instance is up; `SUPABASE_SERVICE_ROLE_KEY` filled
- [ ] Reverse-proxy config in place (cf. `kortix.conf` template in openresty)
- [ ] Sandbox image pulled or built (see `scripts/start-sandbox.sh`)
- [ ] First boot: `http://<proxy-host>/v1/providers/health` returns `{ok: true}`
- [ ] Chat streaming works end-to-end

### Common confusions

- **"ENV_MODE=cloud is more 'advanced' than local"**: No. Cloud is the Kortix SaaS path — enabling it drags in Stripe billing and Kortix's LLM router, neither of which belong in a customer self-hosted deployment.
- **"local_docker only runs on a developer laptop"**: No. "local" means "the Docker daemon on the same host as the API." Customers' cloud servers run Docker; the API is co-located; that's `local_docker`.
- **"Customers need a Kortix account"**: They do not. In `local` mode the `kortix` provider block is unreachable for them and can be ignored or commented out.
