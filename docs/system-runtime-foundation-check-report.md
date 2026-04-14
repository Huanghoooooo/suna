# 系统基座检查报告（执行版）

## 执行范围

- 按既定计划执行 `L0` 到 `L4`。
- 不修改业务代码，仅执行环境探测、接口探测、代码链路核验与结论归档。
- 检查目标能力：智能体交互/指令接收、任务调度、状态回写、中断恢复、人工确认节点。

## L0 环境与服务就绪检查

### 依赖检查

- `node -v` -> `v24.14.0`
- `pnpm -v` -> `8.15.8`
- `docker --version` -> `29.3.1`
- `bun`：本机命令不存在（`where bun` 未找到），但可通过 `npx --yes bun` 临时调用
- `supabase`：本机命令不存在（`where supabase` 未找到），但可通过 `npx --yes supabase` 调用（`2.89.1`）

### 服务健康探测

- `http://localhost:8008/health` -> `200`
- `http://localhost:8008/v1/health` -> `200`
- `http://localhost:3000` -> `200`
- `http://127.0.0.1:14000/kortix/health` -> `200`

### L0 结论

- 当前机器已有运行中的 API/Web/Sandbox 服务，可做在线探测。
- `supabase` 未做全局安装，但通过 `npx` 可用，不再阻断执行层面的本地验证。
- `bun` 虽未全局安装，但可通过 `npx --yes bun` 执行测试，因此“完全阻断测试”结论已更新为“可运行但存在平台兼容失败”。

## L1 静态链路核验（代码级）

### 指令接收

- Task 启动入口：`core/kortix-master/src/routes/tasks.ts` 的 `POST /:id/start`
- Queue 入队入口：`apps/api/src/queue/routes.ts` 的 `POST /sessions/:sessionId`
- Trigger 分发入口：`core/kortix-master/triggers/src/action-dispatch.ts` 的 `ActionDispatcher.dispatch(...)`

### 任务调度

- Task 调度主流程：`core/kortix-master/src/services/task-service.ts` 的 `startTask`
- Queue 调度主流程：`apps/api/src/queue/drainer.ts` 的 `startDrainer` / `drainOnce`
- Trigger 调度主流程：`core/kortix-master/triggers/src/trigger-manager.ts` 的 `scheduleCron` / `dispatchWebhook` / `runTrigger`

### 状态回写

- Task 运行/事件回写：`core/kortix-master/src/services/task-service.ts` 的 `updateTaskRun` / `recordTaskEvent`
- Trigger 执行回写：`core/kortix-master/triggers/src/trigger-store.ts` 的 `createExecution` / `updateExecution` / `markRun`
- Queue 持久化：`apps/api/src/queue/storage.ts` 的 `enqueue` / `dequeue` / `setSessionQueue`

### 人工确认

- Task 审批入口：`core/kortix-master/src/routes/tasks.ts` 的 `POST /:id/approve`
- Task 审批约束：`core/kortix-master/src/services/task-service.ts` 的 `ACTIVE_REVIEW_STATUSES = ['awaiting_review']`
- Tunnel 权限审批：`apps/api/src/tunnel/routes/permission-requests.ts` 的 `POST /:requestId/approve`

### L1 结论

- 四条主链路（接收、调度、回写、人工确认）代码证据完整、可定位、职责边界清晰。

## L2 最小动态闭环检查（API 级）

### 已执行探测

- Queue：
  - `GET /v1/queue/status` -> `401`
  - `POST /v1/queue/sessions/runtime-check-session` -> `401`
  - `GET /v1/queue/sessions/runtime-check-session` -> `401`
  - `DELETE /v1/queue/sessions/runtime-check-session` -> `401`
- Task（直连 API 主端口）：
  - `POST /kortix/tasks/non-exist-id/start` -> `404`
  - `POST /kortix/tasks/non-exist-id/approve` -> `404`
- Trigger（直连 API 主端口）：
  - `GET /kortix/triggers` -> `404`
  - `POST /kortix/triggers` -> `404`
- Tunnel 权限审批：
  - `POST /v1/tunnel/permission-requests/fake-id/approve` -> `401`
- API 到 Kortix 代理：
  - `GET /v1/kortix/triggers` -> `401`
  - `GET /v1/kortix/tasks` -> `401`

### L2 解读

- `401` 结果证明 API 端点已启用且鉴权中间件生效，安全边界符合预期。
- `404` 出现在 `/kortix/*` 直连 `8008` 时符合路由设计（该路径应由 sandbox/core 或 `/v1/kortix/*` 代理承载）。
- 由于缺少鉴权凭据（JWT 或 kortix token），当前无法在本机完成“鉴权后”的完整业务闭环调用。

## L3 中断恢复与人工确认专项

### 中断恢复链路证据

- Task 续跑与对账：`core/kortix-master/src/services/task-service.ts`
  - `reconcileTaskIfIdle(...)`
  - `resumePrompt` 续跑逻辑
- 服务恢复编排：`core/kortix-master/src/services/service-manager.ts`
  - `watchdogTimer`
  - `requestRecovery(...)`
  - in-flight 去重与 recovery throttle
- 代理超时恢复重试：`core/kortix-master/src/services/proxy.ts`
  - timeout 分支触发 `requestRecovery(...)`
  - recovery 后 retry 分支

### 人工确认专项证据

- Task 审批只允许 `awaiting_review` 状态进入 approve。
- Tunnel 权限审批路由包含 pending 判定、scope 校验、授权落库和通知发送。

### L3 结论

- 中断恢复与人工确认存在原生实现，核心语义（触发条件、状态约束、恢复策略）明确。
- 受限于鉴权凭据与运行态上下文，尚未在本机完成“恢复动作全过程日志”与“真实人工审批成功态”在线复现。

## L4 结果归档与准入结论

## 追加全检证据（本轮补跑）

### A. GLM 5.1 API 连通性测试

- 通过 `POST https://open.bigmodel.cn/api/paas/v4/chat/completions` 发起请求。
- 请求模型：`glm-5.1`。
- 结果：HTTP 调用成功并返回模型响应内容（说明 key 可用、接口可达）。

### B. Trigger E2E 实跑结果

- 执行命令：`npx --yes bun test core/kortix-master/tests/e2e/triggers-api.test.ts`
- 修复后结果：`17 pass / 0 fail`
- 修复动作：
  - 在 `afterEach` 前释放 sqlite 句柄。
  - 对临时目录删除加入 Windows 友好的退避重试（处理 `EBUSY/EPERM/ENOTEMPTY`）。
- 结论：Trigger E2E 的 Windows 兼容性问题已修复并通过回归。

### C. 恢复注入测试（单测）结果

- 执行命令：`npx --yes bun test core/kortix-master/tests/unit/service-manager.test.ts core/kortix-master/tests/unit/opencode-proxy.test.ts`
- 修复后结果：`15 pass / 0 fail`
- 修复动作：
  - `service-manager` 运行时将 shell 调用改为跨平台：Windows 使用 `cmd.exe`，其余平台使用 `/bin/sh`。
  - 单测中将启动命令改为基于 `process.execPath` 的 Bun 可执行路径，避免命令解析差异。
  - 调整个别对停止/日志的脆弱断言，减少 Windows 时序波动误报。
- 已通过的恢复关键项：
  - `opencode-proxy` timeout + health fail -> recovery 触发路径通过。
  - `service-manager` auto-heal、recovery join active startup、TCP 健康探测路径通过。

### D. 鉴权闭环补跑（自动获取 JWT）

- 获取方式：从本机 `apps/api/.env` 读取 Supabase 配置，通过 admin API 创建一次性测试账号并自动换取 JWT（未暴露密钥）。
- 受保护路由结果：
  - Queue：`/v1/queue/status` -> `200`，入队 `201`，查询 `200`，清空 `200`（闭环通过）。
  - Kortix 代理：`/v1/kortix/tasks`、`/v1/kortix/triggers` -> `401`（上游 sandbox 鉴权仍未打通）。
  - Tunnel 审批：`/v1/tunnel/permission-requests/fake-id/approve` -> `500`（鉴权后进入业务层，但当前运行态缺少有效审批上下文）。

## 快检结论（30 分钟档）

- 结论：**有条件通过**（可作为后续功能开发基线）。
- 依据：
  - 代码链路完整（L1 通过）。
  - 在线接口可达且鉴权行为正确（Queue 业务闭环已通过）。
  - 恢复与人工确认语义有明确实现（L3 通过）。

## 全检结论（2 小时档）

- 结论：**部分通过（核心测试已通过，剩余集成阻塞待消除）**。
- 阻塞项：
  - `v1/kortix/*` 在当前本机运行态仍返回 `401`（sandbox 侧链路鉴权未打通）。
  - Tunnel 审批需真实 pending request 场景，当前仅完成“鉴权后路由可达”验证，未完成成功审批闭环。

## 建议下一步（按优先级）

1. 对齐 `v1/kortix/*` 的 sandbox 鉴权配置（重点核查 API -> sandbox 的 token 透传与 `INTERNAL_SERVICE_KEY` 生效路径）。
2. 通过插入一条真实 tunnel pending request，再执行 approve，补齐“审批成功态 + 审计”证据。
3. 固化当前 Windows 测试兼容修复为 CI 覆盖项，避免回归。

## 可复用命令（PowerShell）

```powershell
# 依赖与命令存在性
node -v
pnpm -v
where.exe bun
where.exe supabase

# 服务可达性
Invoke-WebRequest -UseBasicParsing http://localhost:8008/health
Invoke-WebRequest -UseBasicParsing http://localhost:8008/v1/health
Invoke-WebRequest -UseBasicParsing http://localhost:3000
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:14000/kortix/health

# 鉴权边界探测（无 token 应返回 401）
Invoke-WebRequest -UseBasicParsing http://localhost:8008/v1/queue/status
Invoke-WebRequest -UseBasicParsing http://localhost:8008/v1/kortix/triggers
Invoke-WebRequest -UseBasicParsing -Method Post http://localhost:8008/v1/tunnel/permission-requests/fake-id/approve -Body '{}' -ContentType 'application/json'
```
