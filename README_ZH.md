# 当前状态说明（中文）

这份说明基于当前仓库和本地改动整理，重点记录：

1. 现在还没完全解决的问题
2. 本地开发怎么启动
3. 源码方式怎么启动/部署
4. 怎么配置超级管理员

## 1. 目前还没完全解决的问题

### 已经在做、但还没彻底收口

1. `1:1 用户 -> 账号 -> 沙箱` 这条链路已经基本改通，但还有一些边缘问题要继续收尾。
   - 重点是切换账号、旧 cookie、旧本地缓存、旧 preview session 之间的残留状态。
   - 现象通常是：新账号进不去、一直转圈、或者切账号后短暂串到旧沙箱。

2. 本地开发模式下，`pnpm dev` 之外通常还需要单独起 sandbox。
   - 也就是还要再开一个终端执行 `pnpm dev:sandbox`
   - 这是当前开发模式的正常使用方式，不是你操作错了。

3. Preview / 沙箱代理这块虽然已经修过一轮，但仍然建议把它当成“需要继续观察”的区域。
   - 尤其是账号切换后访问 `/v1/p/...`
   - 如果再出现 `401`、一直转圈、或者连到了旧实例，优先检查 cookie 和本地 server-store 状态

4. 数据库层面对“一个用户只能属于一个账号”的硬约束还需要继续确认。
   - 代码层已经按这个模型走了
   - 但如果要彻底杜绝脏数据，数据库 migration 也要同步补齐并真正执行

### 已知问题/待确认

1. `pnpm start` 的完整线上/部署链路，我这里没有完整跑过一遍，当前以仓库脚本和现有文档为准。
2. 你之前提到的“长时间显示工作时间”和“推送新版本去掉”这两个业务/UI问题，还没在这轮里继续处理。

## 2. 本地开发怎么启动

推荐最小步骤：

### 2.1 启动 Supabase 本地依赖

```bash
supabase start
```

### 2.2 启动前端 + API

```bash
pnpm dev
```

默认会启动：

- Web: `http://localhost:3000`
- API: `http://localhost:8008`

### 2.3 单独启动本地 sandbox

再开一个终端：

```bash
pnpm dev:sandbox
```

如果你改了 sandbox 相关依赖、镜像层、Docker 构建内容，用：

```bash
pnpm dev:sandbox:build
```

### 2.4 只启动单个服务

如果只想单独调试：

```bash
pnpm dev:web
pnpm dev:api
```

## 3. 源码方式怎么启动 / 部署

当前仓库根脚本里主要有两种方式。

### 3.1 本地源码启动

```bash
supabase start
pnpm dev
pnpm dev:sandbox
```

这是最适合开发排查 bug 的方式。

### 3.2 本地源码“接近正式启动”的方式

仓库根目录有：

```bash
pnpm start
```

它实际执行的是：

```bash
bash scripts/start-local.sh
```

但这条链路我这里没有完整验证过，所以当前建议：

1. 开发调试优先用 `pnpm dev + pnpm dev:sandbox`
2. 真要走部署/交付，先按仓库已有英文 `README.md`、`docs/deployment-modes.md`、`docs/development-release-guide.md` 再完整对一遍

### 3.3 Docker / core 运行时

如果你只想直接起 core runtime，也可以：

```bash
pnpm dev:core
```

它和下面这条本质一样：

```bash
docker compose -f core/docker/docker-compose.yml -f core/docker/docker-compose.dev.yml up
```

## 4. 怎么配置超级管理员

当前推荐做法是：**先确保这个用户已经存在，再执行 bootstrap-admin**。

### 4.1 先准备一个已经能登录的用户

也就是：

1. 先通过正常方式注册/创建用户
2. 确认数据库里已经有这个用户

### 4.2 执行超级管理员脚本

在仓库根目录执行：

```bash
INITIAL_SUPER_ADMIN_EMAIL=你的邮箱 pnpm --filter kortix-api bootstrap-admin
```

例如：

```bash
INITIAL_SUPER_ADMIN_EMAIL=admin@example.com pnpm --filter kortix-api bootstrap-admin
```

这个脚本会做几件事：

1. 通过邮箱查找用户
2. 如果这个用户还没有 personal account，就补建一个
3. 给该账号写入 `super_admin`

### 4.3 另一种写法

如果你想直接传参数，本质上等价于：

```bash
pnpm --filter kortix-api exec bun run scripts/bootstrap-admin.ts --email 你的邮箱
```

### 4.4 注意

1. 第一个 `super_admin` 不是通过前端页面点出来的，应该用脚本做。
2. `Platform Role` 控制的是能不能进 `/admin`，不是普通账号内的成员角色。
3. 当前 1:1 模型下，更推荐“每个用户一个 personal account”，而不是继续走老的共享账号玩法。

## 5. 现在建议的工作方式

如果你接下来还要继续修这套问题，建议按这个顺序：

1. 先固定使用 `fix/one-user-one-account-sandbox-split` 这条拆分后的分支继续做
2. 每次都用两个终端：
   - 一个跑 `pnpm dev`
   - 一个跑 `pnpm dev:sandbox`
3. 每修一类问题就单独 commit，不要把账户模型、sandbox、前端状态修复混在一起
4. 新用户登录、切换账号、管理员进入 `/admin`，这三条路径每次都回归测试
