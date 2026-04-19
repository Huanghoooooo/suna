# 管理员与角色系统 | Admin & Role Management

本文档记录 Suna 管理员后台的使用方法、角色语义和实现文件结构。随着
`feature/admin-role-management` 分支的推进持续更新。

This document records how to use the Suna admin panel, the role semantics it
exposes, and the files that implement it. It is kept in sync with
`feature/admin-role-management`.

---

## 1. 角色模型 | Role Model

Suna 有**两层角色**，解决两个不同的问题：

Suna uses **two tiers of roles** to separate concerns:

| 层级 Tier | 表 Table | 取值 Values | 管谁 Scope |
|---|---|---|---|
| 平台角色 Platform | `kortix.platform_user_roles` | `user` / `admin` / `super_admin` | 跨账号，可进 `/admin` 后台<br>Cross-account; gates `/admin` panel |
| 账号内角色 Account | `kortix.account_members.account_role` | `owner` / `admin` / `member` | 单个账号（组织）内部<br>Within a single account/org |

**要点 | Key points**

- 一个用户在自己的 personal account 里默认是 `owner`（账号内）；平台角色独立赋予。
- 超管（`super_admin`）是唯一能晋升其他超管的人。`admin` 可以管理普通用户但不能管理同级。
- `requireAdmin` 中间件（`apps/api/src/middleware/require-admin.ts`）同时接受 `admin` 和 `super_admin`。
- 平台角色表**不提供任何 HTTP 写接口用于自我提权**——首次只能通过 `bootstrap-admin` 脚本或直接 SQL。

---

## 2. 首次部署：设置第一个超管 | First Deployment: Bootstrap Super Admin

企业部署时，第一个超管必须通过脚本或 SQL 初始化，不能从 UI 创建（防止自我提权漏洞）。

On first deployment, the first super_admin must be seeded via script or SQL — never via the UI (self-privilege-escalation guard).

### 流程 | Workflow

1. **部署 Suna 并让目标管理员用户通过正常流程注册。**
   Deploy Suna and have the intended admin sign up through the normal flow.

2. **在 `apps/api/.env` 里设置 `INITIAL_SUPER_ADMIN_EMAIL`：**
   Set `INITIAL_SUPER_ADMIN_EMAIL` in `apps/api/.env`:

   ```bash
   INITIAL_SUPER_ADMIN_EMAIL=ops@acme.com
   ```

3. **运行 bootstrap 脚本：**
   Run the bootstrap script:

   ```bash
   cd apps/api
   bun run bootstrap-admin
   # 或者 / or: bun run bootstrap-admin --email ops@acme.com
   ```

4. **该用户下次访问 `/admin` 即可进入后台。**
   That user can now access `/admin`.

### 脚本特性 | Script properties

- **幂等 Idempotent**：重复运行同一 email 只打印"已经是超管"，不改数据。
- **只做提权**：不会降级、不会删用户、不会创建账号。降级请用管理 UI 或直接 SQL。
- **失败安全 Fail-safe**：email 找不到或账号不存在都报错退出，不会默默成功。

---

## 3. 手动 SQL（备用方案） | Manual SQL (fallback)

如果 bootstrap 脚本不可用，可以直连 Postgres/Supabase 执行：

If the bootstrap script is unavailable, connect directly to Postgres/Supabase:

```sql
-- 1. 查询目标用户的 account_id
SELECT a.account_id, a.name
FROM kortix.account_members am
JOIN kortix.accounts a ON a.account_id = am.account_id
JOIN auth.users u ON u.id = am.user_id
WHERE lower(u.email) = lower('ops@acme.com')
  AND a.personal_account = true;

-- 2. 提权
INSERT INTO kortix.platform_user_roles (account_id, role)
VALUES ('<paste account_id>', 'super_admin')
ON CONFLICT (account_id) DO UPDATE SET role = 'super_admin';
```

---

## 4. 管理员后台路径 | Admin Panel Routes

**前端 Frontend** (Next.js app router, route group `(dashboard)`):

| 路径 Path | 用途 Purpose |
|---|---|
| `/admin` | 概览面板 Overview |
| `/admin/accounts` *(规划中 planned)* | 账号列表 + 平台角色管理 |
| `/admin/accounts/[id]` *(规划中 planned)* | 账号详情 + 账号内成员管理 |
| `/admin/sandboxes` | 沙盒实例 Sandbox instances |
| `/admin/analytics` | 分析 Analytics |
| `/admin/access-requests` | 注册审批 Access requests |
| `/admin/feedback` | 用户反馈 User feedback |

**后端 Backend** (Hono, mounted at `/v1/admin`):

| 路径 Path | 方法 Method | 用途 |
|---|---|---|
| `/v1/admin/api/env` | GET / POST | 读/改 `.env`（脱敏） |
| `/v1/admin/api/schema` | GET | Provider key schema |
| `/v1/admin/api/instances` | GET | 沙盒清单 |
| `/v1/admin/api/sandboxes` | GET / DELETE | 沙盒管理 |
| `/v1/admin/api/platform-roles` | GET | 列出所有显式平台角色 List elevated platform-role accounts |
| `/v1/admin/api/platform-roles/:accountId` | PUT | 设置角色（`user`/`admin`/`super_admin`） Set role |
| `/v1/admin/api/platform-roles/:accountId` | DELETE | 撤销角色（降回隐式 `user`） Revoke role |
| `/v1/admin/api/accounts` *(规划中)* | GET | 账号列表 |
| `/v1/admin/api/accounts/:id/members` *(规划中)* | GET / PUT / DELETE | 账号内成员 |

所有路由在 `apps/api/src/admin/index.ts` 第 34 行统一挂 `supabaseAuth + requireAdmin` 中间件，
无需每个路由重复校验。

All routes inherit `supabaseAuth + requireAdmin` from `apps/api/src/admin/index.ts:34`; no per-route check needed.

---

## 5. 文件结构 | File Structure

```
apps/api/
├── .env.example                             # INITIAL_SUPER_ADMIN_EMAIL 声明
├── package.json                             # bootstrap-admin npm script
├── scripts/
│   └── bootstrap-admin.ts                   # 首次超管提权脚本
└── src/
    ├── admin/
    │   ├── index.ts                         # 管理员路由根（env/schema/instances/sandboxes）
    │   ├── platform-roles.ts                # 平台角色 CRUD（含等级制 + 末位超管保护）
    │   ├── account-members.ts [规划中]      # 账号内成员 CRUD
    │   └── accounts.ts        [规划中]      # 账号列表/详情
    ├── middleware/
    │   ├── auth.ts                          # supabaseAuth / combinedAuth
    │   └── require-admin.ts                 # 平台角色门禁 (admin/super_admin)
    └── shared/
        └── platform-roles.ts                # getPlatformRole / isPlatformAdmin

apps/web/
├── src/
│   ├── app/(dashboard)/admin/
│   │   ├── layout.tsx                       # 侧栏 + 角色校验
│   │   ├── page.tsx                         # 概览
│   │   ├── accounts/        [规划中]
│   │   │   ├── page.tsx                     # 账号列表
│   │   │   └── [id]/page.tsx                # 账号详情 + 角色管理
│   │   ├── sandboxes/
│   │   ├── analytics/
│   │   ├── access-requests/
│   │   ├── feedback/
│   │   ├── notifications/
│   │   ├── stateless/
│   │   ├── stress-test/
│   │   └── sandbox-pool/
│   ├── components/admin/
│   │   ├── admin-user-table.tsx
│   │   ├── admin-user-details-dialog.tsx
│   │   ├── admin-feedback-table.tsx
│   │   ├── platform-role-select.tsx       [规划中]
│   │   └── account-members-table.tsx      [规划中]
│   └── hooks/admin/
│       ├── use-admin-role.ts                # 当前用户的平台角色
│       ├── use-admin-users.ts
│       ├── use-admin-sandboxes.ts
│       ├── use-admin-analytics.ts
│       ├── use-admin-accounts.ts          [规划中]
│       └── use-platform-roles.ts          [规划中]

packages/db/src/schema/kortix.ts             # 只读（本分支不改 schema）
├── accounts                                 # 账号（org）表
├── accountMembers                           # 用户-账号-角色 多对多
└── platformUserRoles                        # 平台角色（user/admin/super_admin）
```

---

## 6. 常见操作速查 | Common Operations Cheat Sheet

### 晋升一个平台管理员 | Promote a platform admin

通过 UI（规划中）或 SQL：

```sql
INSERT INTO kortix.platform_user_roles (account_id, role)
VALUES ('<account_id>', 'admin')
ON CONFLICT (account_id) DO UPDATE SET role = 'admin';
```

### 降级超管 | Demote a super_admin

```sql
UPDATE kortix.platform_user_roles
SET role = 'user'
WHERE account_id = '<account_id>';
```
⚠️ **注意 Caution**：必须先确保至少还有一个 `super_admin` 存在。
Ensure at least one other `super_admin` exists before demoting.

### 查看谁有平台角色 | List all platform roles

```sql
SELECT pr.role, a.name, a.account_id, u.email
FROM kortix.platform_user_roles pr
JOIN kortix.accounts a ON a.account_id = pr.account_id
LEFT JOIN kortix.account_members am ON am.account_id = a.account_id
LEFT JOIN auth.users u ON u.id = am.user_id
ORDER BY pr.role DESC, a.name;
```

---

## 7. 威胁模型 | Threat Model

本系统防的 | Protects against:
- 外部用户自助提权（API 不暴露写接口） | External users self-promoting.
- 普通成员越权访问管理后台（`requireAdmin` 拦截） | Members hitting admin endpoints.
- 忘记配置首个超管（bootstrap 脚本 + env 声明） | Missing initial admin.

**不防 Does NOT defend against:**
- 有 `service_role` key 或 DB 直连权限的内部人员（他们能改任何数据） | Insiders with service_role or direct DB.
- 社工 / session 劫持 / XSS 提取 JWT（这些属于通用 web 安全范畴） | Social engineering, session hijack, XSS — handled by generic web hardening.

合规/审计需求（谁在什么时候提权了谁）由**另一条分支 `feature/audit-log`** 的日志系统负责覆盖。

Compliance/audit ("who promoted whom, when") is handled by the **separate `feature/audit-log`** branch.
