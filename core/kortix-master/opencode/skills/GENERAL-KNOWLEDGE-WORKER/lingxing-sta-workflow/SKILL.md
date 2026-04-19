---
name: lingxing-sta-workflow
description: 领星 ERP STA 货件创建全流程自动化。按 workflow.txt 的 5 个步骤（创建STA货件 → 商品装箱 → 配送服务 → 箱子标签 → 完成）驱动 API 调用，支持先装箱再分仓模式。需要 lingxing-openapi skill 的凭证和基础设施。
---

# 领星 STA 货件创建 Workflow Skill

本 Skill 将 `workflow.txt` 中描述的 STA 货件创建流程，映射为可由 AI Agent 自动执行的 API 调用链。

## 适用场景

- 用户说"帮我创建一个 STA 货件"
- 用户说"按 workflow 走流程"
- 用户说"发一批货到亚马逊 FBA"
- 任何涉及领星 ERP STA 货件创建的任务

## 前置条件

1. 已有领星 `appId` 和 `appSecret`（通常在 `/workspace/appid.txt`）
2. Python 虚拟环境已就绪（`/workspace/.venv/bin/python`），已安装 `requests`
3. `lingxing-openapi` skill 的数据资产可用（`api_registry.json` 等）

## 核心工具

本 Skill 提供两个脚本：

### 1. `scripts/sta_api_caller.py` — STA 专用 API 调用器

解决了现有 `core_api_executor.py` 对嵌套 JSON 签名不兼容的问题。

```bash
/workspace/.venv/bin/python scripts/sta_api_caller.py \
  --api-path "/amzStaServer/openapi/inbound-plan/createInboundPlan" \
  --params '{"sid":18426,...}' \
  --app-id "ak_xxx" \
  --access-token "token"
```

特点：
- 嵌套 JSON 参与签名时**不做 sort_keys**，与领星服务端一致
- 支持 `--dry-run` 只输出请求不发送
- 自动处理 AES/ECB 签名

### 2. `scripts/sta_workflow_runner.py` — 全流程自动化

按 workflow.txt 的 5 个步骤顺序执行，每步都有状态检查和错误处理。

```bash
/workspace/.venv/bin/python scripts/sta_workflow_runner.py \
  --app-id "ak_xxx" \
  --app-secret "secret" \
  --sid 18426 \
  --msku "Q9-CH" \
  --quantity 1 \
  --address-line1 "123 Test Avenue" \
  --city "Los Angeles" \
  --state "CA" \
  --postal-code "90001" \
  --shipper-name "Test Sender" \
  --phone "2135550101"
```

## Workflow 步骤与 API 映射

### 步骤 1：创建 STA 货件

对应 workflow.txt 第 1-2 步。

| 操作 | API |
|------|-----|
| 查询店铺列表 | `GET /erp/sc/data/seller/lists` |
| 查询发货地址 | `POST /erp/sc/routing/fba/shipment/shipFromAddressList` |
| 创建发货地址（如需） | `POST /erp/sc/routing/fba/shipment/createShipFromAddress` |
| 查询可发货商品 | `POST /erp/sc/routing/fba/shipment/getFbaProductList` |
| 创建 STA 任务 | `POST /amzStaServer/openapi/inbound-plan/createInboundPlan` |
| 查询异步任务状态 | `POST /amzStaServer/openapi/task-plan/operate` |

关键参数：
- `positionType`: `"1"` = 先装箱再分仓（默认），`"2"` = 先分仓再装箱
- `labelOwner`: `"SELLER"` = 卖家自己贴标
- `prepOwner`: `"SELLER"` = 卖家预处理

### 步骤 2：商品装箱

对应 workflow.txt 第 3 步。

| 操作 | API |
|------|-----|
| 查询包装组 | `POST /amzStaServer/openapi/inbound-packing/listPackingGroupItems` |
| 提交装箱信息 | `POST /amzStaServer/openapi/inbound-packing/setPackingInformation` |
| 查询异步任务状态 | `POST /amzStaServer/openapi/task-plan/operate` |

**重要**：`setPackingInformation` 接口包含深层嵌套 JSON，必须使用本 Skill 的 `sta_api_caller.py` 而非通用执行器，否则签名会报 `api sign not correct`。

装箱参数结构：
```json
{
  "sid": 18426,
  "inboundPlanId": "wfxxx",
  "packageGroupings": [{
    "packingGroupId": "pgxxx",
    "boxes": [{
      "dimensions": {"height": 30, "length": 40, "width": 35, "unitOfMeasurement": "CM"},
      "items": [{"labelOwner": "SELLER", "msku": "Q9-CH", "prepOwner": "SELLER", "quantity": 1}],
      "weight": {"unit": "KG", "value": 6}
    }]
  }]
}
```

### 步骤 3：配送服务

对应 workflow.txt 第 4 步。这是最复杂的一步，包含多个子步骤：

| 顺序 | 操作 | API |
|------|------|-----|
| 3.1 | 生成货件方案 | `POST /amzStaServer/openapi/inbound-shipment/generatePlacementOptions` |
| 3.2 | 查询异步任务状态 | `POST /amzStaServer/openapi/task-plan/operate` |
| 3.3 | 查询货件方案 | `POST /amzStaServer/openapi/inbound-shipment/shipmentPreView` |
| 3.4 | 查询货件方案装箱信息 | `POST /amzStaServer/openapi/inbound-packing/getInboundPackingBoxInfo` |
| 3.5 | 生成承运方式 | `POST /amzStaServer/openapi/inbound-shipment/generateTransportList` |
| 3.6 | 查询异步任务状态 | `POST /amzStaServer/openapi/task-plan/operate` |
| 3.7 | 查询承运方式 | `POST /amzStaServer/openapi/inbound-shipment/getTransportList` |
| 3.8 | 生成可选送达时间 | `POST /amzStaServer/openapi/inbound-shipment/generateDeliveryDateList` |
| 3.9 | 查询异步任务状态 | `POST /amzStaServer/openapi/task-plan/operate` |
| 3.10 | 查询可选送达时间 | `POST /amzStaServer/openapi/inbound-shipment/getDeliveryDateList` |
| 3.11 | 确认货件方案 | `POST /amzStaServer/openapi/inbound-shipment/confirmPlacementOption` |
| 3.12 | 查询异步任务状态 | `POST /amzStaServer/openapi/task-plan/operate` |
| 3.13 | 提交货件配送服务 | `POST /amzStaServer/openapi/inbound-shipment/setDeliveryService` |
| 3.14 | 查询异步任务状态 | `POST /amzStaServer/openapi/task-plan/operate` |

配送服务选择逻辑（按 workflow.txt）：
- 配送模式：选择"其他承运人" → `shippingSolution: "USE_YOUR_OWN_CARRIER"`
- 承运人类型：选择"小包裹快递" → `shippingMode: "GROUND_SMALL_PARCEL"`
- 运输方式：选择"陆运" → 从 `transportVOList` 中筛选 `shippingMode == "GROUND_SMALL_PARCEL"` 且 `shippingSolution == "USE_YOUR_OWN_CARRIER"`
- 承运人：选择"其他" → `alphaCode: "Other"`
- 送达时段：选择当前日期后约一个月的窗口
- 发货日期：选择当天或延后 2-3 天

### 步骤 4：箱子标签

对应 workflow.txt 第 5 步。

| 操作 | API |
|------|-----|
| 查询 STA 任务详情（获取 shipmentConfirmationId） | `POST /amzStaServer/openapi/inbound-plan/detail` |
| 打印 FBA 货件箱子标签 | `POST /erp/sc/storage/shipment/printFbaLabels` |

货件名称命名格式：`FBA STA(SKU-发货数量-国家-WZ)-日期`
例：`FBA STA(Q9-CH-1-US-WZ)-20260417`

标签打印参数：
```json
{
  "data": [{"shipment_id": "FBA19BRFDGP8", "page_type": "4", "num": 1}],
  "type": "box"
}
```
- `page_type`: `"4"` = 每张 A4 纸上 4 个标签

### 步骤 5：完成

查询最终 STA 任务详情确认状态，输出货件编号。

## 已知问题与解决方案

### 1. 嵌套 JSON 签名不兼容

**问题**：现有 `core_api_executor.py` 在签名时对嵌套对象使用 `sort_keys=True`，导致 `setPackingInformation`、`generateTransportList`、`setDeliveryService` 等接口返回 `api sign not correct`。

**解决**：本 Skill 的 `sta_api_caller.py` 使用不排序的 `json.dumps(separators=(",", ":"))` 序列化嵌套值，与领星服务端签名逻辑一致。

### 2. 异步任务需要轮询

**问题**：STA 流程中大部分写操作都是异步的，返回 `taskStatus: "process"` 不代表成功。

**解决**：每次异步操作后，必须调用 `task-plan/operate` 轮询直到 `taskStatus` 变为 `success` 或 `failure`。建议间隔 2-3 秒，最多重试 10 次。

### 3. 令牌桶限流

**问题**：STA 相关接口令牌桶容量为 1，并发请求会被拒绝。

**解决**：所有 API 调用串行执行，每次调用间隔至少 1 秒。

### 4. 美国站发货地址 province 字段

**问题**：美国地址的 `province` 字段不能超过 2 位字符。

**解决**：传州缩写（如 `CA`），不传全名（如 `California`）。

## AI Agent 推荐工作流

```
1. 加载本 Skill
2. 读取 /workspace/appid.txt 获取凭证
3. 获取 access_token（调用 lingxing-openapi 的 get_access_token.py）
4. 向用户确认：店铺、MSKU、发货数量、发货地址
5. 按步骤 1-5 顺序执行
6. 每步执行后向用户报告进度
7. 遇到需要用户选择的地方（如入库配置选项、承运方式）暂停并询问
8. 最终输出：货件编号（FBA号）、货件名称、shipmentId
```

## 凭证与环境变量

| 变量 | 说明 |
|------|------|
| `LINGXING_APP_ID` | 领星 appId |
| `LINGXING_APP_SECRET` | 领星 appSecret |
| `LINGXING_ACCESS_TOKEN` | 当前有效的 access_token |

也可通过命令行参数 `--app-id`、`--app-secret`、`--access-token` 传入。
