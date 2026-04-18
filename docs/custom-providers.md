# 自定义 LLM Provider 维护指南 | Maintaining Custom LLM Providers

> 适用范围 | Applies to: `develop` 及之后的版本（自 `feat/hardcode-providers` 起）
>
> 最后更新 | Last updated: 2026-04-18

---

## 中文

### 为什么要硬编码？

此前后端提供了 `POST /v1/providers/custom` 端点，允许前端 UI 动态添加 OpenAI-compatible provider。该实现存在两个根本问题：

1. **Dev 模式下写文件逻辑脆弱**：通过字符串拼接直接修改 `core/kortix-master/opencode/opencode.jsonc`，多次增删后会破坏 JSONC 缩进和逗号，最终导致沙盒启动时报 `ConfigJsonError`。
2. **Prod（installed）模式下根本走不通**：代码分支依赖 `findRepoRoot()`，prod 环境下没有仓库根，直接返回 `501 Not Implemented`，即"装上去用户看不到这个功能"。

综合考虑"终端用户不应自定义 provider"这一产品诉求，我们选择**一律硬编码**：

- Provider 清单写在 `core/kortix-master/opencode/opencode.jsonc` 的 `"provider"` 块里
- 对应 API Key 通过 `apps/api/.env` 的环境变量注入
- 前端"添加自定义 Provider"入口已移除；后端 `POST/DELETE /v1/providers/custom` 统一返回 `410 Gone`

### 如何新增 / 修改 / 删除一个 Provider

1. **编辑 `core/kortix-master/opencode/opencode.jsonc`** 的 `"provider"` 块，按现有条目的格式添加：

   ```jsonc
   "myprovider": {
     "name": "My Provider",
     "npm": "@ai-sdk/openai-compatible",
     "options": {
       "baseURL": "https://api.example.com/v1",
       "apiKey": "{env:MYPROVIDER_API_KEY}",
     },
     "models": {
       "my-model": {
         "name": "My Model",
         "id": "my-model-id",
       },
     },
   },
   ```

2. **在 `apps/api/.env.example`** 对应区块添加占位：

   ```
   MYPROVIDER_API_KEY=                     # My Provider 描述
   ```

3. **在实际部署的 `apps/api/.env`** 填入真实 key。

4. **重新部署 / 重启 API + 沙盒**。Provider 会随 `opencode.jsonc` 被挂载到沙盒 `/ephemeral/kortix-master/opencode/opencode.jsonc`，OpenCode runtime 启动时自动读取。

### 约定

- **不要** 手工修改生产环境沙盒里的 `opencode.jsonc`——配置应来自 repo，便于团队共享与版本控制。
- **不要** 重新启用前端 Custom Provider 入口或 `POST /custom` 端点——除非先用 `jsonc-parser` 库重写写入逻辑，或迁移到 OpenCode 官方 `client.global.config.update()` 路径（见 `suna-latest` upstream commit `0a31da48b`）。
- Provider ID 仅允许 `[a-zA-Z0-9_-]`，避免破坏 JSONC 或 env 变量名。
- **API Key 的环境变量命名** 保持和 `opencode.jsonc` 中 `{env:XXX_API_KEY}` 完全一致，否则沙盒启动时该 provider 会报空 key。

### 当前已硬编码的 Provider

| Provider ID | 说明 | 需要的 env key |
| --- | --- | --- |
| `kortix` | Kortix 默认托管 provider（含 MiniMax / GLM / Kimi） | `KORTIX_TOKEN`, `KORTIX_API_URL`（自动注入） |
| `bigmodel` | GLM 官方（open.bigmodel.cn） | `BIGMODEL_API_KEY` |
| `claude` | Claude 中转（apipool.dev） | `CLAUDE_API_KEY` |

`opencode.jsonc` 里还有 `openai` / `deepseek` / `moonshot` 三个注释掉的示例。要启用时，取消注释 + 填对应 env key。

---

## English

### Why hardcode?

The legacy `POST /v1/providers/custom` endpoint had two root problems:

1. **Fragile JSONC writer in dev**: it edited `core/kortix-master/opencode/opencode.jsonc` via naive string splicing. Repeated insert/delete would break indentation and trailing commas, eventually tripping `ConfigJsonError` on sandbox startup.
2. **Broken in prod**: the code path depends on `findRepoRoot()`, which returns `null` in an installed/packaged deployment — so the endpoint just returned `501 Not Implemented`. End users never had a working "Add provider" feature.

Combined with the product decision that **end users should not be able to add providers**, we hardcode the full registry:

- Provider list lives in `core/kortix-master/opencode/opencode.jsonc` under `"provider"`
- API keys flow in via `apps/api/.env`
- The "Custom Provider" button in the web UI is removed; `POST/DELETE /v1/providers/custom` now return `410 Gone`.

### Adding / changing / removing a provider

1. **Edit `core/kortix-master/opencode/opencode.jsonc`** `"provider"` block, following the existing entries:

   ```jsonc
   "myprovider": {
     "name": "My Provider",
     "npm": "@ai-sdk/openai-compatible",
     "options": {
       "baseURL": "https://api.example.com/v1",
       "apiKey": "{env:MYPROVIDER_API_KEY}",
     },
     "models": {
       "my-model": {
         "name": "My Model",
         "id": "my-model-id",
       },
     },
   },
   ```

2. **Add a placeholder in `apps/api/.env.example`**:

   ```
   MYPROVIDER_API_KEY=                     # description of My Provider
   ```

3. **Fill the real key in the deployment's `apps/api/.env`**.

4. **Redeploy / restart API + sandbox**. `opencode.jsonc` is mounted into the sandbox at `/ephemeral/kortix-master/opencode/opencode.jsonc`, and OpenCode reads it on startup.

### Conventions

- **Never** hand-edit `opencode.jsonc` inside a running sandbox — configuration must come from the repo so the team shares it via Git.
- **Do not** re-enable the Custom Provider UI entry or re-open `POST /custom` until the writer is rewritten via `jsonc-parser` (round-trip-safe) or migrated to OpenCode's own `client.global.config.update()` (see upstream commit `0a31da48b` in `suna-latest`).
- Provider IDs must match `[a-zA-Z0-9_-]` to avoid breaking JSONC keys or env var names.
- The env var used in `{env:XXX_API_KEY}` must match the real variable name exactly; otherwise the provider will start with an empty key.

### Currently hardcoded providers

| Provider ID | Description | Required env key |
| --- | --- | --- |
| `kortix` | Kortix-hosted router (MiniMax / GLM / Kimi) | `KORTIX_TOKEN`, `KORTIX_API_URL` (auto-injected) |
| `bigmodel` | GLM official (open.bigmodel.cn) | `BIGMODEL_API_KEY` |
| `claude` | Claude via apipool.dev | `CLAUDE_API_KEY` |

`opencode.jsonc` also ships commented-out examples for `openai` / `deepseek` / `moonshot`. To enable one, uncomment its block and set the corresponding env key.
