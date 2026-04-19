# 管理员与角色系统 | Admin & Role Management

本文档记录 Suna 的两级角色模型、平台管理员的权限边界、首次部署如何产生
第一个超级管理员，以及企业交付场景的相关配置。

This document records Suna's two-tier role model, platform-admin permission
boundaries, how to bootstrap the first super admin during first deployment,
and related configuration for enterprise delivery.

---

## 1. 角色模型 | Role Model

Suna 有**两层完全独立**的角色，解决不同问题：

Suna has **two independent role tiers**:

### 平台角色 | Platform role

存储在 `kortix.platform_user_roles`，枚举 `platform_role`：

Stored in `kortix.platform_user_roles`, enum `platform_role`:

| 值 Value | 能做什么 What it grants |
|---|---|
| `user`（默认 default）| 普通用户，看不到 `/admin`。Regular user, no `/admin` access. |
| `admin` | 可进 `/admin` 后台；管理 `user` 和 `admin` 级别；**不能**动 `super_admin`。 |
| `super_admin` | 全权。可以分配/撤销 `super_admin`，管任何账号。Full control. |

**这一层决定谁能进 `/admin` 后台**。默认所有用户都是 `user`——不在
`platform_user_roles` 表里有行，`getPlatformRole` 就返回 `user`。

This tier gates `/admin` panel access. Default is implicit `user` when no row
exists.

### 账号内角色 | Account role

存储在 `kortix.account_members.account_role`，枚举 `account_role`：

Stored on `kortix.account_members.account_role`, enum `account_role`:

| 值 Value | 含义 Meaning |
|---|---|
| `owner` | 账号所有者，最高权限，不能降到 0 个。Account owner. |
| `admin` | 账号内管理员。Account-level admin. |
| `member` | 普通成员。Regular member. |

**这一层管账号（组织）内部的协作权限**，跟平台角色正交——一个
`super_admin` 可以是他所在账号里的 `member`，反之亦然。

Orthogonal to the platform tier — a `super_admin` can be a `member` of their
own account and vice versa.

---

## 2. super_admin vs admin 的详细差异 | Super Admin vs Admin

两者都能进 `/admin`，但**能管谁**不同：

|  | admin | super_admin |
|---|---|---|
| 进 `/admin` 后台 Access admin panel | ✅ | ✅ |
| 查所有账号 List all accounts | ✅ | ✅ |
| 把 `user` 升到 `admin` Promote user→admin | ✅ | ✅ |
| 把 `admin` 降到 `user` Demote admin→user | ✅ | ✅ |
| 升任何人为 `super_admin` Grant super_admin | ❌ | ✅ |
| 改一个 `super_admin` 账号（降/改）Mutate super_admin | ❌ | ✅ |
| 降级最后一个 `super_admin` Demote last super_admin | ❌ | ❌（系统强制）|
| 管任意账号的成员 Manage any account's members | ✅ | ✅ |
| 移除末位 owner Remove last owner | ❌（系统强制） | ❌（系统强制）|

**一句话**：`admin` 管"用户"与"运营员"；`super_admin` 管"老板团队"。

**In one line**: `admin` operates on users and peers; `super_admin` operates
on the top tier (including itself).

### 代码位置 | Code locations

- 中间件 Middleware: `apps/api/src/middleware/require-admin.ts`
  （接受 `admin` 或 `super_admin`）
- 查询函数 Helper: `apps/api/src/shared/platform-roles.ts`
- 等级制执行 Hierarchy enforcement:
  `apps/api/src/admin/platform-roles.ts` 里的 `assertCanTransition`
- 末位保护 Last-one guards: `countSuperAdmins()` / `countOwners()`
  在同文件，所有分支都先检查再写

---

## 3. 首次部署：产生第一个超级管理员 | First Deployment: Bootstrap Super Admin

> Suna **故意不提供自助提权的 HTTP 接口**——任何登录用户都不能通过 API 把自己
> 变成 `super_admin`，否则等同于开后门。第一个 `super_admin` 必须在数据库层
> 产生，之后的所有角色变更才能走 `/admin` UI。
>
> Suna intentionally has **no self-promote HTTP endpoint** — otherwise any
> authenticated user could grant themselves super_admin. The first one must
> be seeded at the database layer; all subsequent role changes go through
> `/admin`.

### 推荐：用 bootstrap 脚本 | Recommended: bootstrap script

步骤：

1. **部署 Suna**（正常启服务，前后端起得来）
2. **让目标管理员用正常流程注册**（打开 `/auth/signup`，用他的邮箱注册账号）
   - 理由：Supabase Auth 记下这个用户的 `auth.users.id`，Suna 同时自动给他
     建一个 personal account 与 `account_members` 关联
3. **把邮箱写进 API 侧的 `.env`**：

   ```bash
   # apps/api/.env
   INITIAL_SUPER_ADMIN_EMAIL=ops@yourcompany.com
   ```

4. **运行 bootstrap 脚本**：

   ```bash
   cd apps/api
   bun run bootstrap-admin
   ```

   输出示例：

   ```
   ✓ Granted super_admin to ops@yourcompany.com
     account:  Ops (xxxxxxxx-...) [personal]
     user_id:  xxxxxxxx-...
   ```

5. **让该用户重新登录**（或硬刷新清 React Query 缓存）→ 侧栏/命令面板就能
   看到 Admin 组菜单。

### 脚本特性 | Script properties

- **幂等 Idempotent**：重复运行同一邮箱只打印"已经是 super_admin"，不改数据。
- **只升不降 Promote-only**：不会降级、不会删用户、不会建账号。
- **失败安全 Fail-safe**：
  - 邮箱找不到用户 → 退出码 2
  - 用户无账号 → 退出码 3
  - DATABASE_URL 缺失 → 退出码 1

### 命令行覆盖 env | CLI override

一次性使用不想改 `.env`：

```bash
bun run bootstrap-admin --email ops@yourcompany.com
```

`--email`（或 `-e`）会覆盖 env。

### 备用：直接 SQL | Fallback: raw SQL

如果 bootstrap 脚本不可用（例如数据库不在同一网络），直连 Postgres：

```sql
-- 1. 先看目标用户的 account_id
SELECT a.account_id, a.name
FROM kortix.accounts a
JOIN kortix.account_members am ON am.account_id = a.account_id
JOIN auth.users u ON u.id = am.user_id
WHERE lower(u.email) = lower('ops@yourcompany.com')
  AND a.personal_account = true;

-- 2. 用查到的 account_id 做 upsert
INSERT INTO kortix.platform_user_roles (account_id, role)
VALUES ('<paste account_id>', 'super_admin')
ON CONFLICT (account_id) DO UPDATE SET role = 'super_admin';
```

---

## 4. 验证当前角色分配 | Inspect Current Role Assignments

### 看谁有平台角色 | List elevated platform roles

```sql
SELECT pr.role, a.name, u.email, pr.created_at
FROM kortix.platform_user_roles pr
JOIN kortix.accounts a ON a.account_id = pr.account_id
LEFT JOIN kortix.account_members am ON am.account_id = a.account_id
LEFT JOIN auth.users u ON u.id = am.user_id
ORDER BY pr.role DESC, a.name;
```

### 前端检查自己的角色 | Check your own role in-browser

1. 登录后访问 `/v1/user-roles`（或打开 DevTools → Network 搜 `user-roles`）
2. Response：
   - `{ "isAdmin": true, "role": "super_admin" }` → 你是超管
   - `{ "isAdmin": true, "role": "admin" }` → 你是 admin
   - `{ "isAdmin": false, "role": null }` → 你是普通用户

### 后端日志侧 | From API logs

`require-admin.ts` 中间件在拒绝访问时返回 403，但不会主动日志记名——若要审计
历史角色变更，看 `feature/audit-log`（规划中的日志系统）。

---

## 5. 常见操作 | Common Operations

操作都可通过 `/admin/accounts/[id]` UI 完成；这里列出对应的 SQL 仅用于紧急
情况或脚本化。

All operations can be done in the `/admin/accounts/[id]` UI; SQL listed here
for emergencies or scripting.

### 新增一个 admin | Add an admin

UI 路径：`/admin/accounts` → 搜用户 → 进详情 → 平台角色下拉选 `admin`。

SQL equivalent:

```sql
INSERT INTO kortix.platform_user_roles (account_id, role, granted_by)
VALUES ('<target>', 'admin', '<your account_id>')
ON CONFLICT (account_id) DO UPDATE SET role = 'admin';
```

### 降级一个 admin | Demote an admin

UI：同上，下拉改回 `user`（等效于从 `platform_user_roles` 删行）。

### 转移 super_admin 身份 | Transfer super_admin

**必须先升一个新人、再降旧人**——系统强制至少 1 个 `super_admin` 存在。

**Promote first, then demote** — the system forbids having zero super_admins.

```
A = current super_admin (me)
B = new super_admin

1. 用 A 的身份登录 → /admin/accounts → 搜 B → 平台角色 = super_admin
2. 让 B 登录 → /admin/accounts → 搜 A → 平台角色 = user（或 admin）
```

### 找回丢失的 super_admin | Recover lost super_admin

如果所有 `super_admin` 都被误降或离职，`/admin` 里无法再操作——这时**只能回
数据库**：

When all super_admins are lost, you must fall back to SQL:

```sql
INSERT INTO kortix.platform_user_roles (account_id, role)
VALUES ('<rescue account_id>', 'super_admin')
ON CONFLICT (account_id) DO UPDATE SET role = 'super_admin';
```

建议企业部署**保留一个独立的"紧急超管"账号**（不日常登录，只在恢复时用），
避免单点失效。

Enterprises should keep an emergency super_admin account (not used day to day)
as insurance against lockout.

---

## 6. 企业部署注意事项 | Enterprise Deployment Checklist

### 关闭公开注册 | Disable public signup

Suna 默认开了 `/auth/signup`——企业环境里员工不该自助注册。

By default public signups at `/auth/signup` are open; for enterprise,
disable them:

1. Supabase Studio (`http://127.0.0.1:64323` 本地 / 生产对应 URL)
2. Authentication → Providers → Email（或其他）→ **Enable signup** 关掉
3. 关掉之后只有两种路径产生用户：
   - **方案 A（当前不支持）**：管理员在 Suna UI 里"邀请成员"——需要新建接口调
     `supabase.auth.admin.inviteUserByEmail`，目前后端没写，属于下一阶段需求。
   - **方案 B（现成）**：Supabase Dashboard → Authentication → Users → "Invite user"
     发邀请邮件。适合用户量少的试点期。
   - **方案 C（现成）**：`/admin/access-requests` 页面走审批流——员工自己填申请，
     管理员批准。属于 Suna 自带能力，后端已有，适合半开放场景。

### 首个管理员优先 | Bootstrap before opening the door

顺序务必：

1. 部署 Suna
2. 指定企业管理员用自己邮箱注册
3. 跑 bootstrap 脚本给他发 `super_admin`
4. **然后**才让其他员工进来（通过邀请或审批）

If other users sign up before a super_admin exists, the `/admin` panel is
inaccessible and role assignment has to go through SQL.

### 紧急备份超管 | Backup super admin

除主管理员外，建议 bootstrap **至少两个** `super_admin`（一个主用、一个备用），
写进 `.env.example`：

```bash
INITIAL_SUPER_ADMIN_EMAIL=primary@yourcompany.com
# 用 --email 参数跑第二次给备用账号发权限
```

或在运维手册里记清楚备用账号凭证（不与日常账号混）。

### 审计日志（规划中）| Audit log (planned)

`/admin` 下的权限变更目前**没有审计记录**——谁什么时候给谁发了 `admin` 不会
留痕。若企业合规要求追溯，启用 `feature/audit-log` 分支（规划中）。

Role changes currently leave no audit trail. Turn on the `feature/audit-log`
branch (planned) when compliance requires traceability.

---

## 7. 威胁模型 | Threat Model

本系统**防**：

- 外部用户自助提权（无写 `platform_user_roles` 的 HTTP 接口）
- 普通成员访问 `/admin/*`（`requireAdmin` 中间件拦截）
- 删光 `super_admin` 导致锁死（`countSuperAdmins()` + 409）
- 孤儿账号（末位 owner 不能降/删）

**不防**：

- 持有 `service_role` key 或数据库直连权限的内部人员——他们可以任意改表。
- 社工、会话劫持、XSS 盗 JWT——属于通用 web 安全范畴，由 Supabase + 业务安全
  层分别加固。
- 合规审计追溯——见上节"审计日志"。

**Scope**: protects against self-privilege-escalation and misconfiguration.
Does **not** defend against insiders with direct DB access, session hijacking,
or compliance-level traceability (out of scope; see planned audit log).

---

## 8. 快速故障排查 | Troubleshooting Quick Reference

| 症状 Symptom | 最可能原因 Likely cause | 修复 Fix |
|---|---|---|
| 登录后 `/admin` 404/重定向 | 没提权，或缓存 | 查 SQL；清浏览器 storage 重登 |
| `/v1/user-roles` 返回 `false` 但 SQL 有行 | account_id 不匹配 JWT sub | bootstrap 用的是 account_members.account_id；personal account 的 account_id=user_id，应当匹配，若不匹配说明上游数据异常 |
| 命令面板搜不到 Admin 菜单 | `VISIBLE_IDS` 没加 | 见 `docs/frontend-page-registration-guide.md` §2 |
| 管理页空白 / 显示聊天界面 | tab 系统没注册 | 同上 §3-4 |
| 脚本报 `Cannot find package 'postgres'` | worktree 没 `pnpm install` | 在 worktree 根目录跑 `pnpm install` |
| 脚本报 `no user found` | 目标邮箱还没注册 | 让用户先走正常 `/auth/signup`，再跑脚本 |

---

## 9. 相关文件索引 | File Index

```
apps/api/
├── scripts/bootstrap-admin.ts                # 提权脚本
├── src/
│   ├── admin/
│   │   ├── index.ts                           # 管理员路由根
│   │   ├── platform-roles.ts                  # 平台角色 CRUD + 等级制
│   │   └── accounts.ts                        # 账号列表/详情 + 成员 CRUD
│   ├── middleware/require-admin.ts            # 权限门
│   └── shared/platform-roles.ts               # getPlatformRole / isPlatformAdmin
└── .env.example                               # INITIAL_SUPER_ADMIN_EMAIL 说明

apps/web/
├── src/
│   ├── app/(dashboard)/admin/accounts/
│   │   ├── page.tsx                           # 账号列表 UI
│   │   └── [id]/page.tsx                      # 账号详情 + 角色管理 UI
│   ├── hooks/admin/use-admin-accounts.ts      # 五个 React Query hook
│   ├── lib/menu-registry.ts                   # 菜单 + 白名单
│   ├── lib/tab-route-resolver.ts              # tab 路由解析
│   └── components/tabs/page-tab-content.tsx   # tab → 组件映射

packages/db/src/schema/kortix.ts               # accounts / account_members / platform_user_roles

supabase/migrations/
├── 00000000000000_bootstrap.sql               # 两个 enum 的定义
└── 00000000000013_platform_user_roles.sql     # 平台角色表

docs/
├── admin-role-management.md                   # 本文件
└── frontend-page-registration-guide.md        # 前端 4 层注册指南
```
