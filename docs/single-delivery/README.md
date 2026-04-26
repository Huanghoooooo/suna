# Single Delivery 文档入口

这个目录记录我们把 Suna/Kortix 简化成「单用户、单固定沙箱」版本的进度、操作手册和排障方法。

目标是交付一个更容易部署、调试和维护的版本：

- 保留核心聊天流
- 保留 Docker sandbox 和 OpenCode runtime
- 去掉当前阶段不需要的多用户、团队、计费、Supabase 业务依赖、沙箱池等复杂平台逻辑
- 用独立 sidecar 目录承载新实现，尽量不污染原来的 `apps/api` 和 `apps/web`

## 文档列表

- [进度记录](./progress.md)
- [操作手册](./operations.md)
- [故障排查](./troubleshooting.md)

## 当前入口

开发启动：

```bash
pnpm single:dev
```

停止开发服务：

```bash
pnpm single:stop
```

本机访问：

```text
http://localhost:13000
```

默认端口：

| 服务 | 地址 |
| --- | --- |
| Single Web | `http://localhost:13000` |
| Single API | `http://localhost:18008` |
| Sandbox Master | `http://127.0.0.1:14000` |
| noVNC | `http://127.0.0.1:14002` |

