# 前端页面注册指南 | Frontend Page Registration Guide

> **TL;DR**：在 Suna 的 `apps/web` 里加一个新页面**不只是在 app 目录建文件**。
> 一共有 **4 层注册**要同时改，否则菜单看不到 / 点击没反应 / 页面被聊天界面盖住。
> 这份文档把 `feature/admin-role-management` 踩过的坑写死。

> **TL;DR**: Adding a new page to Suna's `apps/web` is **not just creating a
> file in the app directory**. There are **four registration layers** that must
> be updated together; missing any one causes invisible menus, dead clicks, or
> the chat UI rendering instead of your page. This doc captures the pitfalls
> we hit on the `feature/admin-role-management` branch.

---

## 1. Suna 前端的分层（抽象）| The Layers

Suna 不是传统 Next.js 应用。页面渲染穿过一个**tab 系统**：

Suna doesn't render like a plain Next.js app. Every page flows through a
**tab system**:

```
┌────────────────────────────────────────────────────────────────────┐
│  URL (/admin/accounts)                                             │
│       │                                                            │
│       ▼                                                            │
│  middleware.ts                                                     │
│  - 如果是 INSTANCE_SCOPED_ROUTES → 转成 /instances/<id>/xxx        │
│  - 再 rewrite 回裸路径给 Next.js                                   │
│       │                                                            │
│       ▼                                                            │
│  Next.js App Router → app/(dashboard)/admin/accounts/page.tsx      │
│       │                                                            │
│       ▼                                                            │
│  DashboardLayoutContent > SessionTabsContainer                     │
│       │                                                            │
│       ▼                                                            │
│  如果当前有 active tab（session / file / page 等），               │
│  route-based children 被 CSS 隐藏。页面必须以 "page 类型 tab" 方式 │
│  打开才能真正可见。                                                │
│       │                                                            │
│       ▼                                                            │
│  page-tab-content.tsx 的 PAGE_COMPONENTS 决定 tab 内部渲染哪个组件 │
└────────────────────────────────────────────────────────────────────┘
```

**关键结论**：**加文件到 `app/(dashboard)/xxx/page.tsx` 只完成了 1/4**。
用户看不到你的页面，要么是菜单被过滤、要么是 tab 没绑定组件、要么是点击没开 tab。

**Key takeaway**: Creating `app/(dashboard)/xxx/page.tsx` only finishes **1 of 4**
steps. Users won't see it unless the menu, tab resolver, component binding, and
whitelist are all aligned.

---

## 2. 新增一个管理员页面的完整清单 | Full Checklist

以"账号与角色"页为模板，加一个新页面要改的文件：

Files to touch when adding a new admin page (accounts-and-roles used as
template):

### Layer 1 — 页面文件 | Page file

```
apps/web/src/app/(dashboard)/<你的路径>/page.tsx
apps/web/src/app/(dashboard)/<你的路径>/[id]/page.tsx  (如果有动态子路由)
```

- 详情页用 `export default function X({ params }: { params: Promise<{id: string}> })`，
  通过 `use(params)` 解包——这样 tab 系统和 Next.js 都认。
- Detail pages use `use(params)` so both Next.js and the tab system work.

### Layer 2 — 侧栏 / 命令面板菜单 | Menu registry

文件：`apps/web/src/lib/menu-registry.ts`

两处都要改：

1. **`menuRegistry` 数组**加条目：

```ts
{
  id: 'admin-accounts',                     // 唯一 id，后面要复用
  label: 'Admin: 账号与角色 | Accounts & Roles',
  icon: Users,
  group: 'admin',
  showIn: ['userMenu', 'commandPalette'],   // admin 页标准配置
  kind: 'navigate',
  href: '/admin/accounts',
  requiresAdmin: true,                       // 权限门
  keywords: 'admin accounts roles 账号 角色',
},
```

2. **`VISIBLE_IDS` 白名单**加 id（就是 4 层里最隐蔽的一层）：

```ts
const VISIBLE_IDS = new Set<string>([
  // ...已有条目
  'admin-accounts',                          // ← 必须加，否则即便 isAdmin=true 也不显示
]);
```

3. **`ZH_LABELS`** 加中文标签（可选但推荐）：

```ts
const ZH_LABELS: Record<string, string> = {
  // ...已有
  'admin-accounts': '账号与角色',
};
```

> ⚠️ **最易漏的一步就是 VISIBLE_IDS**。commit `4d1ba5b38` 引入这个白名单用于
> 隐藏 Suna 开源版里的多余入口，新页面必须显式加回去。
>
> ⚠️ **The most-missed step is VISIBLE_IDS**. It was added in commit
> `4d1ba5b38` to hide upstream Suna's extra menu items; any new page has
> to explicitly re-enter the whitelist.

### Layer 3 — tab 路由解析 | Tab route resolver

文件：`apps/web/src/lib/tab-route-resolver.ts`

**静态路由**在 `STATIC_TABS` 里加：

```ts
'/admin/accounts': {
  id: 'page:/admin/accounts',              // 约定：page:<href>
  title: '账号与角色',
  type: 'page',
  href: '/admin/accounts',
},
```

**动态路由**（有 `[id]` 的）在 `DYNAMIC_RESOLVERS` 里加 resolver：

```ts
(pathname) => {
  const m = pathname.match(/^\/admin\/accounts\/([^/]+)$/);
  if (!m) return null;
  const accountId = decodeURIComponent(m[1]);
  return {
    id: `page:/admin/accounts/${accountId}`,
    title: '账号详情',
    type: 'page',
    href: `/admin/accounts/${accountId}`,
  };
},
```

### Layer 4 — tab 内容 → 组件 | Tab content component map

文件：`apps/web/src/components/tabs/page-tab-content.tsx`

**静态路由**在 `PAGE_COMPONENTS` 里加：

```ts
// 顶部 lazy import
const AdminAccountsPage = lazy(() =>
  import('@/app/(dashboard)/admin/accounts/page'),
);

// PAGE_COMPONENTS map
'/admin/accounts': AdminAccountsPage,
```

**动态路由**除了 lazy import 还要在 `resolveComponent` 里加 regex 分支：

```ts
const AdminAccountDetailPage = lazy(() =>
  import('@/app/(dashboard)/admin/accounts/[id]/page'),
);

// resolveComponent
const accountMatch = routeKey.match(/^\/admin\/accounts\/([^/]+)$/);
if (accountMatch) {
  return {
    Component: AdminAccountDetailPage,
    params: { id: decodeURIComponent(accountMatch[1]) },
  };
}
```

> `params` 会被 `resolveComponent` 包成 `Promise.resolve(params)` 喂给组件的 `use(params)`。
> `params` are wrapped into `Promise.resolve(params)` for the component's `use(params)`.

---

## 3. 页面内导航：别用 `<Link>` | Navigating inside the tab system

页面里从一行跳到详情页，用 `<Link>` **不会开 page 类型 tab**——URL 变了但
tab 系统没变，活动 tab 还是原来那个，用户看到的还是上一屏。

Inside the tab system a plain `<Link>` **does not open a page-type tab** —
the URL changes but the tab store doesn't, so the previous active tab keeps
covering the content.

**正确写法**：

```ts
import { openTabAndNavigate } from '@/stores/tab-store';

<TableRow onClick={() => openTabAndNavigate({
  id: `page:/admin/accounts/${a.accountId}`,   // 必须对齐 resolver 里的 id 约定
  title: a.name,
  type: 'page',
  href: `/admin/accounts/${a.accountId}`,
})}>
```

- `openTabAndNavigate` 按 `id` 去重，重复点同一行不会开多个 tab。
- "返回上一页"按钮同理，跳到已有的列表 tab（用同一个 id）。

- `openTabAndNavigate` dedupes by `id`, so repeat clicks reuse the tab.
- "Back" buttons should navigate to the list tab via the same pattern.

---

## 4. Middleware 重写路径的约定 | Middleware URL rewriting

`apps/web/src/middleware.ts` 对 `INSTANCE_SCOPED_ROUTES`（见 `lib/instance-routes.ts`）
做两步处理：

`middleware.ts` handles `INSTANCE_SCOPED_ROUTES` in two steps:

1. 裸路径 `/admin/accounts` → redirect 到 `/instances/<activeId>/admin/accounts`
2. 再从 `/instances/<id>/xxx` → rewrite 回 `/xxx` 喂给 Next.js 路由表

**如果要把新页面做成 instance-scoped**，只需把前缀加到 `INSTANCE_SCOPED_ROUTES`。
`/admin` 已经在里面，所以新管理页自动生效——但**必须通过 instance 访问**，
不能直接 `http://host/admin/xxx`（除非登录态没有 active instance 才会走到 `/instances` 选择页）。

**To make a new page instance-scoped**, add its prefix to
`INSTANCE_SCOPED_ROUTES`. `/admin` is already listed, so new admin pages work
out of the box — **access via an instance**, not the bare path.

---

## 5. Worktree & 分支起点避坑 | Worktree & Branch Base Pitfall

**真实踩过的坑**：我在 `feature/admin-role-management` 上开工时，worktree 的起点
比当前 develop 落后了几个 commit，其中包括 `4d1ba5b38`（VISIBLE_IDS 白名单）和
`aabe8f2a3`（Kortix → Wutong 品牌替换）。结果：

- 我改的 `menu-registry.ts` 没有 VISIBLE_IDS 这段，commit 看起来正常
- merge 回 develop 时 git 自动合并成功，**但 VISIBLE_IDS 里没有我的新条目**
- 测试时菜单里找不到新页面，浪费了好几轮定位

**Real-world pitfall**: my worktree branched off an older commit that
pre-dated both the `VISIBLE_IDS` whitelist (`4d1ba5b38`) and the
Kortix→Wutong rebrand (`aabe8f2a3`). Merging into develop auto-resolved
cleanly, but my new entry wasn't in the whitelist — costing several rounds
of debugging.

**教训 | Lessons**：

1. **开 worktree 前先同步 develop**：

   ```bash
   cd /home/murasame/nas/suna
   git checkout develop
   git pull origin develop
   # 然后再开 worktree
   ```

2. **准备合 PR 前 rebase 一次**：

   ```bash
   cd <worktree>
   git fetch origin
   git rebase origin/develop
   # rebase 后用新代码基线检查一遍 VISIBLE_IDS 之类后加进来的新限制
   ```

3. **加新页面时用本文档检查 4 层都覆盖到了**。

---

## 6. Next.js HMR 的局限 | Next.js HMR Limitations

Next.js dev 对**新建目录 / 新动态路由 `[id]`** 的热更新不可靠。遇到下列情况
**一定要重启** `pnpm dev`：

Next.js HMR is unreliable for **new directories** and **new dynamic routes
`[id]`**. Restart `pnpm dev` after:

- 新建 `page.tsx` 在一个**之前不存在的目录**
- 新增 `[id]` 动态路由
- 改 `page-tab-content.tsx` 的 `PAGE_COMPONENTS` 映射
- 改 `tab-route-resolver.ts` 的 `STATIC_TABS` 或 `DYNAMIC_RESOLVERS`

改组件内部（JSX / 逻辑）HMR 正常工作，不用重启。

Modifying component internals (JSX / logic) HMR-reloads fine.

---

## 7. 自检清单 | Self-Check Before PR

新增一个管理员页面后，在 PR 之前过一遍：

Before opening a PR with a new admin page, run through:

- [ ] `app/(dashboard)/<path>/page.tsx` 存在
- [ ] `menuRegistry` 里有条目，`requiresAdmin: true`（如果是管理页）
- [ ] `VISIBLE_IDS` 白名单加了这个 id
- [ ] `ZH_LABELS` 有中文覆盖（可选）
- [ ] `STATIC_TABS` 或 `DYNAMIC_RESOLVERS` 里有路由
- [ ] `PAGE_COMPONENTS` 里有组件映射（静态）或 `resolveComponent` 有 regex 分支（动态）
- [ ] 页面内部跳转用 `openTabAndNavigate` 而不是 `<Link>`
- [ ] 浏览器里 Cmd+K 能搜到
- [ ] 点菜单能开新 tab 并显示内容（不是聊天界面）
- [ ] 动态详情页能打开且参数正确
- [ ] React Query cache 清掉后（hard reload + re-login）权限仍然对
