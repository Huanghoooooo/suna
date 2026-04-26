# 操作手册

## 1. 初次启动

安装依赖：

```bash
pnpm install
```

启动单用户模式：

```bash
pnpm single:dev
```

启动后访问：

```text
http://localhost:13000
```

首次启动会生成：

```text
apps/single-api/.env
apps/single-web/.env.local
```

## 2. 停止服务

停止 API 和 Web：

```bash
pnpm single:stop
```

这个命令只停 `18008` 和 `13000` 上的开发服务，默认不停止 sandbox 容器。

## 3. 模型配置

默认模型：

```bash
SINGLE_MODEL=apipool/claude-opus-4-7
OPENROUTER_API_KEY=你的key
```

配置文件：

```text
apps/single-api/.env
```

如果使用智谱：

```bash
SINGLE_MODEL=bigmodel/glm-5-1
BIGMODEL_API_KEY=你的key
```

如果使用 OpenAI-compatible provider，需要先确认 `core/kortix-master/opencode/opencode.jsonc` 中已有对应 provider。

## 4. 修改 key 后重启

模型 key 会注入 sandbox 容器。改完 key 后，建议强制重建 sandbox：

```bash
pnpm single:stop
SINGLE_RECREATE_SANDBOX=1 pnpm single:dev
```

## 5. LAN / Tailscale 访问

如果从其他机器访问，比如：

```text
http://100.90.101.9:13000
```

需要修改 `apps/single-api/.env`：

```bash
SINGLE_PUBLIC_API_URL=http://100.90.101.9:18008
SINGLE_WEB_URL=http://100.90.101.9:13000
KORTIX_API_URL=http://100.90.101.9:18008
```

并修改 `apps/single-web/.env.local`：

```bash
NEXT_PUBLIC_SINGLE_API_URL=http://100.90.101.9:18008
```

然后重启：

```bash
pnpm single:stop
pnpm single:dev
```

## 6. 健康检查

API：

```bash
curl http://localhost:18008/health
```

Sandbox：

```bash
curl http://localhost:18008/api/sandbox/status
```

Logs：

```bash
curl http://localhost:18008/api/sandbox/logs
```

## 7. 生产构建

```bash
pnpm single:deploy
pnpm --filter kortix-single-api start
pnpm --filter kortix-single-web start
```

生产机器上建议后续补 systemd 或进程管理器。

## 8. 推荐工作流

日常开发：

```bash
pnpm single:dev
```

端口冲突时：

```bash
pnpm single:stop
pnpm single:dev
```

改了模型 key：

```bash
pnpm single:stop
SINGLE_RECREATE_SANDBOX=1 pnpm single:dev
```

改了 `core/docker` 或 `core/startup.sh` 这类 sandbox 镜像内容：

```bash
pnpm single:stop
SINGLE_REBUILD_SANDBOX=1 SINGLE_RECREATE_SANDBOX=1 pnpm single:dev
```

要确认没有把本地数据放进 git：

```bash
git status --short
```
