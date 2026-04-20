# 企业审计日志 API（Wutong Agent / Kortix API）

本文档供前端与 Agent 服务联调使用。审计日志满足需求文档中的要求：**仅追加（append-only）**、**按租户（account）维度的哈希链（hash chain）防篡改**，并与业务日志、系统日志、Agent 轨迹等通过 `category` 字段区分。

## 基础信息

| 项 | 说明 |
|----|------|
| 基础路径 | `/v1/audit` |
| 鉴权 | 与队列、隧道等一致：`Authorization: Bearer <token>`，支持 **Supabase JWT** 或 **Kortix API Key**（`kortix_` / `kortix_sb_` 前缀） |
| 启用条件 | 服务端配置 `DATABASE_URL` 时挂载；本地前端通常将 `/v1/*` 代理到 `http://localhost:8008` |
| 数据库 | 表位于 `kortix.audit_logs`，由 Drizzle schema 管理；开发环境启动 API 时会 `drizzle-kit push` 同步表结构 |

## 数据模型（响应字段说明）

单条审计记录（`GET` / `POST` 返回体）主要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `logId` | uuid | 主键 |
| `accountId` | uuid | 租户账户 ID |
| `chainSeq` | number | 当前账户内的链序号，从 1 递增 |
| `category` | string | `business` \| `system` \| `agent_trace` |
| `action` | string | 动作标识，建议 `域.动作`，如 `user.login`、`shipment.create` |
| `actorUserId` | uuid \| null | 操作者用户 ID；Kortix Key 调用时通常为 `null` |
| `resourceType` | string \| null | 可选，如 `shipment`、`invoice`、`file` |
| `resourceId` | string \| null | 可选，业务主键或外部 ID |
| `summary` | string | 人类可读摘要（列表、检索用） |
| `metadata` | object | 结构化扩展信息（JSON） |
| `requestId` | string \| null | 请求关联 ID；`POST` 未传时服务端会尽量填入当前请求的 `requestId` |
| `ipAddress` | string \| null | 由服务端从 `X-Forwarded-For` / `X-Real-IP` 解析 |
| `userAgent` | string \| null | `User-Agent` |
| `prevRecordHash` | string(64) | 上一条记录的 `recordHash`，首条为账户创世哈希 |
| `recordHash` | string(64) | 本条记录的 SHA-256 链式哈希（十六进制） |
| `createdAt` | ISO8601 | 写入时间（UTC） |

### category 取值

- **business**：登录、货件/发票创建与修改、关键写操作确认、文件下载、权限变更等业务侧行为。
- **system**：服务启停、配置变更、与健康检查相关的内部事件（由后端写入）。
- **agent_trace**：Agent / 工具调用轨迹（可与 Langfuse 等并存，本表存平台侧摘要）。

## HTTP 接口

### 1. 分页查询 `GET /v1/audit/events`

**Query 参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `page` | 否 | 默认 `1` |
| `limit` | 否 | 默认 `50`，最大 `100` |
| `category` | 否 | `business` / `system` / `agent_trace` |
| `action_prefix` 或 `actionPrefix` | 否 | 按 `action` **前缀**匹配（SQL `ILIKE 'prefix%'`） |
| `q` | 否 | 在 `summary` 与 `action` 中模糊搜索 |
| `from` | 否 | 起始时间，ISO8601 |
| `to` | 否 | 结束时间，ISO8601 |

**响应示例：**

```json
{
  "data": [ { "logId": "...", "chainSeq": 1, "category": "business", "action": "user.login", "...": "..." } ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 120,
    "totalPages": 3
  }
}
```

### 2. 单条查询 `GET /v1/audit/events/:logId`

返回单条记录；若不属于当前租户则 `404`。

### 3. 追加一条 `POST /v1/audit/events`

仅通过服务端计算 `chainSeq`、`prevRecordHash`、`recordHash`，客户端**不能**伪造哈希字段。

**请求体（JSON）：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `category` | 是 | `business` \| `system` \| `agent_trace` |
| `action` | 是 | 1～160 字符 |
| `summary` | 是 | 1～8000 字符 |
| `metadata` | 否 | 任意 JSON 对象 |
| `actorUserId` | 否 | 不传时：Supabase 用户默认写当前用户 UUID；Kortix Key 为 `null` |
| `resourceType` | 否 | 最多 128 字符 |
| `resourceId` | 否 | 文本 |
| `requestId` | 否 | 不传时使用当前请求的 request id |

成功：`201`，响应体为完整记录。

### 4. 链完整性校验 `GET /v1/audit/verify-chain`

对**当前账户**的全部审计行按 `chainSeq` 顺序重算哈希。数据量大时可能较慢，适合管理页或低频巡检。

**响应示例（成功）：**

```json
{ "valid": true, "chainLength": 120 }
```

**失败时**（示例）：`valid: false`，并包含 `reason`（如 `prev_record_hash_mismatch`、`record_hash_mismatch`、`chain_seq_gap_or_duplicate`）及定位字段。

## 哈希链（供联调与排错）

对同一 `accountId`：

1. 首条的前序哈希 `prevRecordHash` 为固定算法生成的创世值（与账户 ID 绑定）。
2. 每条记录的 `recordHash = SHA256(prevRecordHash + "|" + canonicalPayload)`，其中 `canonicalPayload` 为关键字段的稳定 JSON（键排序一致），并包含 `chainSeq`、`createdAt` 等。
3. 下一条的 `prevRecordHash` 等于上一条的 `recordHash`。

业务层不提供更新/删除接口；数据库层应仅授予 `INSERT`/`SELECT`（由运维策略与迁移保证）。

## 后端在其他模块中写入审计

在 `apps/api` 内可直接调用：

```ts
import { appendAuditEvent } from './audit';

await appendAuditEvent({
  accountId,
  category: 'business',
  action: 'user.login',
  summary: '用户登录成功',
  metadata: { method: 'password' },
  actorUserId: userId,
});
```

## 数据库与 PostgreSQL 版本

追加写入使用 `pg_advisory_xact_lock(hashtextextended(...))` 做账户级串行化，需要 **PostgreSQL 14+**（`hashtextextended`）。若自建较旧版本，需替换为等价加锁实现（联系后端）。

## 与 Langfuse / 运行日志的关系

- **本 API**：面向合规与追责的**不可篡改审计带**（登录、权限、关键写操作、平台侧 Agent 摘要等）。
- **Langfuse / 应用日志**：面向 LLM 轨迹与排障，可按需在 `agent_trace` 的 `metadata` 中存放外部 trace id 做关联。
