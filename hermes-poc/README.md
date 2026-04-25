# Wutong Agent Hermes POC

这是一个独立于 `suna` 的离线 POC，用来验证“企业级智能工作台 + Hermes Runtime 适配层”的关键链路。

## 已实现

- 三栏式桌面工作台：左侧用户/模块，中间 Agent 执行流，右侧指标、任务、文件和审计。
- Hermes Runtime Adapter：默认 `mock-hermes`，设置 `HERMES_BASE_URL` 后可标记为 OpenAI-compatible Hermes 接入模式。
- 发票闭环模拟流程：意图识别、参数提取、ERP 校验、结构化确认卡、PDF 生成、归档、API 失败重试、浏览器兜底上传。
- 企业能力最小样例：HMAC JWT、Meta/Admin/Employee 角色、店铺组权限、用户文件隔离。
- 审计链：`append-only` JSONL + `prevHash/hash` 校验，覆盖登录、确认、工具调用、文件创建、下载和任务完成。
- 测试：JWT、审计链、确认卡强制执行、跨店铺权限拒绝。

## 运行

```powershell
cd D:\Projects\WutongAI\hermes-poc
npm test
npm start
```

打开：

```text
http://127.0.0.1:4188
```

## Hermes 接入点

当前实现把 Hermes 作为可替换 Runtime：

- 默认不依赖外网和 Python/Node 第三方包，使用 `mock-hermes` 跑通产品闭环。
- 后续接真实 Hermes 时，把 `src/runtime.js` 中的规划与执行步骤替换为 Hermes API Server / OpenAI-compatible stream 的事件映射。
- 需要保持前端事件协议不变：任务状态、步骤、确认卡、文件和审计仍由本服务统一落库。

## 验收路径

1. 选择 `李运营`。
2. 发送 `生成美国店铺 1 张金额 1280 的发票并上传`。
3. 等待确认卡出现。
4. 点击 `确认执行`。
5. 右侧文件列表出现 PDF，审计链计数增加，任务状态变为 `已完成`。
6. 切换到无权限用户后，确认其看不到不属于自己的任务和文件。
