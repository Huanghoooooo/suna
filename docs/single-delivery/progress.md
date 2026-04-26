# 进度记录

更新时间：2026-04-25

## 背景判断

原 Suna/Kortix 本地部署链路耦合度过高：

- 前端、后端、Supabase、账号体系、团队体系、沙箱池、preview proxy、LLM provider 配置互相影响
- debug 时经常无法快速判断问题来自 URL、端口、Supabase、sandbox、OpenCode 还是模型配置
- 当前目标不是完整 SaaS，而是先交付稳定的单用户体验

因此改成独立的 Single Mode sidecar：

```text
apps/single-web
  -> apps/single-api
    -> fixed Docker sandbox: kortix-single-sandbox
      -> core/kortix-master
        -> OpenCode
```

## 已完成

### 代码结构

- 新增 `apps/single-api`
  - 轻量 Hono API
  - 本地 JSON session registry
  - 固定 sandbox 容器管理
  - OpenCode session 创建
  - prompt 转发
  - message polling
  - sandbox logs/status/start/restart/stop
  - preview proxy
- 新增 `apps/single-web`
  - 单用户工作台
  - 会话列表
  - 聊天输入和消息轮询
  - sandbox 状态面板
  - 日志面板
  - preview 快捷入口
- 新增 `scripts/single`
  - `dev.sh`
  - `stop.sh`
  - `deploy.sh`
- 新增 `docs/single-mode`
  - 英文版结构说明
- 新增 `docs/single-delivery`
  - 中文进度和操作手册

### 根脚本

`package.json` 已加入：

```bash
pnpm single:dev
pnpm single:stop
pnpm single:deploy
pnpm single:api
pnpm single:web
```

### 模型配置修复

已修复一次关键问题：

```json
"providerID": "11",
"modelID": "111111"
```

这类假 provider/model 会导致 OpenCode 报：

```text
Error: Unable to connect. Is the computer able to access the url?
```

当前修复策略：

- `single-api` 发 prompt 时显式传 `SINGLE_MODEL`
- 缺少模型 key 时提前返回清晰错误
- Docker compose 显式把模型 key 注入 sandbox

### 本地运行数据

`.single-data/` 已加入 `.gitignore`，避免 session runtime 数据进入 git。

## 已验证

- `pnpm --filter kortix-single-api typecheck` 通过
- `pnpm --filter kortix-single-web typecheck` 通过
- `pnpm --filter kortix-single-web build` 通过
- `scripts/single/dev.sh` 语法检查通过
- `scripts/single/stop.sh` 语法检查通过
- `scripts/single/deploy.sh` 语法检查通过
- API health 曾验证通过
- sandbox status 曾验证为 `running` 和 `healthy`
- 前端曾验证返回 `200 OK`

## 暂未完成

- token streaming UI
- 文件浏览器
- session 级进程隔离
- session 级端口分配
- 强文件系统隔离
- 生产 systemd/nginx 模板
- 多 sandbox registry

## 当前风险

- 单 sandbox 内多 session 目前主要靠 prompt 和 workspace 目录约束隔离，不是强隔离
- 模型 key 修改后需要重建 sandbox 容器才能保证容器环境刷新
- OpenCode 旧 session 可能保留历史错误模型；必要时新建 session 或清理 `.single-data`

