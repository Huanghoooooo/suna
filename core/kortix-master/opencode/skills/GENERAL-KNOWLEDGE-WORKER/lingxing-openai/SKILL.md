---
name: lingxing-openapi
description: Use when working with LingXing ERP OpenAPI. This skill helps an agent find the right API, inspect detailed parameters, obtain tokens, generate valid signed requests, and execute LingXing business APIs end-to-end.
---

# LingXing OpenAPI

这个 Skill 不是只给你一个签名脚本。

它现在是一套完整的 LingXing API Agent 工作流，适合让 AI 直接照着跑：

1. 先找候选接口
2. 再看接口细节
3. 再拿 token / 生成 sign
4. 最后发请求

## 这个 Skill 到底去哪里检索

这个问题很重要。这个 Skill 不是“凭空知道 API 文档在哪”，而是通过固定入口脚本去找仓库里的知识文件。

Skill 优先使用它自己目录里的资产：

- 接口索引：`Skills/lingxing-openapi/data/api_registry.json`
- 详细文档块：`Skills/lingxing-openapi/data/api_chunks.jsonl`
- 接口索引搜索器：`Skills/lingxing-openapi/scripts/core_search_api_registry.py`
- 详细文档块搜索器：`Skills/lingxing-openapi/scripts/core_search_api_chunks.py`
- 统一执行器：`Skills/lingxing-openapi/scripts/core_api_executor.py`

也就是说，Skill 入口脚本的真实调用链是：

- `scripts/search_api.py` -> `scripts/core_search_api_registry.py` -> `data/api_registry.json`
- `scripts/search_api_details.py` -> `scripts/core_search_api_chunks.py` -> `data/api_chunks.jsonl`
- `scripts/call_api.py` -> `scripts/core_api_executor.py` -> `data/api_registry.json`

如果本地 Skill 资产还没同步好，它才会回退到源仓库根目录的 `scripts/` 和 `build/`。

初始化或更新 Skill 资产时，先运行：

```bash
python3 Skills/lingxing-openapi/scripts/sync_skill_assets.py
```

这个命令会把源仓库里的核心脚本和数据复制到 Skill 自己目录下。迁移到别的目录或机器时，只要把整个 `Skills/lingxing-openapi/` 带走即可。

如果以后仓库根目录变了，可以通过环境变量覆盖：

```bash
export LINGXING_API_REPO_ROOT="/your/new/repo/root"
```

这时 Skill 会优先从这个目录下查找 `scripts/` 和 `build/`。

如果知识文件不存在：

- 优先运行 `python3 Skills/lingxing-openapi/scripts/sync_skill_assets.py`
- 如果你还在源仓库里，也可以先运行：
  - `python3 scripts/generate_api_registry.py`
  - `python3 scripts/chunk_api_docs.py`

不要在知识文件缺失时盲猜接口。

## 什么时候用

当任务涉及下面任意一种情况时，就应该用这个 Skill：

- 用户想“查某个业务数据”，但没说具体接口名
- 用户想调用领星 ERP OpenAPI
- 用户需要获取 `access_token`
- 用户需要生成 `sign`
- 用户需要测试某个业务接口
- 用户希望像助手一样，让 AI 自动找接口并调用

## 这个 Skill 里有哪些能力

### 1. 找接口

脚本：

- `scripts/search_api.py`

这个脚本会调用仓库根目录下的注册表搜索器，帮 AI 从大量接口里先找出最相关的候选接口。

它会显式把 `build/api_registry.json` 传给底层搜索器，而不是依赖当前工作目录碰巧正确。

示例：

```bash
python3 Skills/lingxing-openapi/scripts/search_api.py "查亚马逊店铺列表"
python3 Skills/lingxing-openapi/scripts/search_api.py "创建 FBA 发货计划" --json
```

---

### 2. 查接口细节

脚本：

- `scripts/search_api_details.py`

这个脚本会调用仓库根目录下的文档块搜索器，补参数、返回值、错误码、示例等细节。

它会显式把 `build/api_chunks.jsonl` 传给底层搜索器，而不是依赖当前工作目录碰巧正确。

示例：

```bash
python3 Skills/lingxing-openapi/scripts/search_api_details.py "shipment_plan_quantity" --api-path "/erp/sc/routing/storage/shipment/createShipmentPlan"
python3 Skills/lingxing-openapi/scripts/search_api_details.py "api sign not correct"
```

---

### 3. 获取 token

脚本：

- `scripts/get_access_token.py`

作用：

- 调用 `/api/auth-server/oauth/access-token`
- 获取 `access_token` 和 `refresh_token`

示例：

```bash
python3 Skills/lingxing-openapi/scripts/get_access_token.py \
  --app-id 'ak_xxx' \
  --app-secret 'secret'
```

---

### 4. 生成 sign

脚本：

- `scripts/sign_request.py`

作用：

- 按领星规则生成 `sign`
- 输出拼装后的 query string

示例：

```bash
python3 Skills/lingxing-openapi/scripts/sign_request.py \
  --app-id 'ak_xxx' \
  --access-token 'token' \
  --param offset=0 \
  --param length=100
```

---

### 5. 直接执行 API

脚本：

- `scripts/call_api.py`

这个脚本会调用仓库根目录下统一的执行器：

- 自动构造请求
- 自动处理 token 接口
- 自动生成 sign
- 支持 `--dry-run`
- 支持业务接口真正发起调用

它会显式把 `build/api_registry.json` 传给底层执行器，而不是依赖当前工作目录碰巧正确。

示例：

```bash
python3 Skills/lingxing-openapi/scripts/call_api.py \
  --api-path "/erp/sc/data/seller/lists" \
  --params '{}' \
  --dry-run
```

## 给 AI 的推荐工作流

这个 Skill 应该按下面顺序使用，不要跳着来。

### 场景 A：用户没说接口名

1. 先运行 `search_api.py`
2. 找出最可能的 3 到 5 个接口
3. 选最相关的一个
4. 再运行 `search_api_details.py`
5. 补参数和约束
6. 最后运行 `call_api.py`

---

### 场景 B：用户已经知道接口名或路径

1. 先运行 `search_api_details.py`
2. 确认参数和返回字段
3. 如果没有 token，先运行 `get_access_token.py`
4. 最后运行 `call_api.py`

---

### 场景 C：用户只想测试凭证

1. 运行 `get_access_token.py`
2. 如果成功，说明 `appId/appSecret` 可用
3. 再选一个轻量业务接口，比如店铺列表
4. 运行 `call_api.py` 验证 `access_token + sign + 根地址` 都通

## 关键规则

### Auth 接口规则

- 获取 token 和续约 token 走表单提交
- 不需要 `sign`

### Business 接口规则

公共参数必须放到 URL query 中：

- `access_token`
- `app_key`
- `timestamp`
- `sign`

### 签名规则

1. 收集所有业务参数 + `access_token` + `app_key` + `timestamp`
2. 按 ASCII 排序
3. 拼成 `key=value&key=value`
4. MD5 后转大写
5. 用 `AES/ECB/PKCS5PADDING` 和 `appId` 作为密钥加密
6. Base64
7. URL encode

### POST 请求规则

- 业务参数放 body
- 公共参数放 query
- 如果 body 里有数组或对象，参与签名时要先转成紧凑 JSON 字符串

### GET 请求规则

- 业务参数和公共参数都放 query

## AI 使用时不要做的事

- 不要一上来就翻整份 `ERPapi.md`
- 不要让用户自己挑接口名
- 不要向用户追问 `access_token/app_key/sign/timestamp`
- 不要跳过 `search_api.py` 直接盲猜接口
- 不要在真实调用前省略 `--dry-run` 检查

## 推荐给用户的输出方式

AI 在调用这个 Skill 时，返回给用户的内容应该是：

1. 你准备调用哪个接口
2. 为什么选它
3. 还缺哪些业务参数
4. 调用是否成功
5. 关键结果是什么
6. 下一步建议是什么

## 当前 Skill 和仓库工具的关系

这个 Skill 里的脚本并不是重复造轮子。

它的定位是：

- 给 AI 一个稳定、统一的入口
- 底层复用仓库里已经生成好的注册表、文档块和执行器

所以可以这样理解：

- `search_api.py` = Skill 入口，底层调用根目录 `scripts/search_api_registry.py`
- `search_api_details.py` = Skill 入口，底层调用根目录 `scripts/search_api_chunks.py`
- `call_api.py` = Skill 入口，底层调用根目录 `scripts/api_executor.py`
- `get_access_token.py` / `sign_request.py` = Skill 内保留的基础工具

这样以后 agent 只需要记住这个 Skill，而不用记住仓库里散落的多个脚本。

## 配套资料

如果需要看更完整的接入说明，可以参考：

- `/Users/ziwu/pythonproject/wukongai-api/docs/API_AGENT_WITH_SUNA.md`
- `/Users/ziwu/pythonproject/wukongai-api/README.md`
