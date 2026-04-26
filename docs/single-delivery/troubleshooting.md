# 故障排查

## 1. 端口占用

现象：

```text
EADDRINUSE
Failed to start server. Is port 18008 in use?
listen EADDRINUSE: address already in use :::13000
```

原因：

上一组 `single-api` 或 `single-web` 还在运行。

处理：

```bash
pnpm single:stop
pnpm single:dev
```

## 2. Unable to connect

现象：

```text
Error: Unable to connect. Is the computer able to access the url?
```

优先检查模型配置。尤其是消息记录里出现类似：

```json
"providerID": "11",
"modelID": "111111"
```

这说明模型 provider/model 是假的或来自旧偏好。

处理：

1. 打开 `apps/single-api/.env`
2. 确认：

```bash
SINGLE_MODEL=apipool/claude-opus-4-7
OPENROUTER_API_KEY=你的key
```

或：

```bash
SINGLE_MODEL=bigmodel/glm-5-1
BIGMODEL_API_KEY=你的key
```

3. 重启：

```bash
pnpm single:stop
SINGLE_RECREATE_SANDBOX=1 pnpm single:dev
```

4. 新建一个 chat session 再试。

## 3. 缺少模型 key

现象：

`single-api` 返回类似：

```text
Missing model API key for SINGLE_MODEL=...
```

处理：

在 `apps/single-api/.env` 填对应 key，然后重建 sandbox：

```bash
pnpm single:stop
SINGLE_RECREATE_SANDBOX=1 pnpm single:dev
```

## 4. 页面打不开

检查顺序：

```bash
curl http://localhost:13000
curl http://localhost:18008/health
curl http://localhost:18008/api/sandbox/status
```

如果本机能打开，其他设备打不开，检查 LAN/Tailscale 配置：

```bash
SINGLE_PUBLIC_API_URL=http://你的IP:18008
SINGLE_WEB_URL=http://你的IP:13000
NEXT_PUBLIC_SINGLE_API_URL=http://你的IP:18008
```

## 5. Sandbox 不健康

检查：

```bash
curl http://localhost:18008/api/sandbox/status
curl http://localhost:18008/api/sandbox/logs
```

重启 sandbox：

```bash
curl -X POST http://localhost:18008/api/sandbox/restart
```

或者强制重建：

```bash
pnpm single:stop
SINGLE_RECREATE_SANDBOX=1 pnpm single:dev
```

如果状态里出现：

```text
Runtime
The socket connection was closed unexpectedly
```

并且 `docker exec kortix-single-sandbox ps -ef` 里只有 `/ephemeral/startup.sh` 或卡在 `chown -R ... /ephemeral`，说明 sandbox 还没把内部服务启动起来。

当前修复：

- `core/startup.sh` 不再递归 chown `/ephemeral`
- 只轻量修正 `/ephemeral/startup.sh` 权限

如果改过这部分源码，需要重建镜像：

```bash
pnpm single:stop
SINGLE_REBUILD_SANDBOX=1 SINGLE_RECREATE_SANDBOX=1 pnpm single:dev
```

## 6. 旧 session 行为异常

原因：

OpenCode 或 `.single-data` 里可能保留了旧 session 的错误模型、错误路径或历史状态。

处理：

- 优先新建一个 session
- 必要时停止服务后清理 `.single-data/sessions.json`

注意：`.single-data/` 是本地运行数据，已经被 `.gitignore` 忽略。
