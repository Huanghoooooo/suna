#!/usr/bin/env python3
"""
领星 STA 货件创建全流程自动化脚本。

按 workflow.txt 的 5 个步骤顺序执行：
  1. 创建 STA 货件（含地址创建、商品查询）
  2. 商品装箱
  3. 配送服务（生成方案 → 确认 → 承运方式 → 送达时间 → 提交）
  4. 箱子标签（查询货件详情、打印标签）
  5. 完成

用法:
    /workspace/.venv/bin/python sta_workflow_runner.py \
        --app-id "ak_xxx" --app-secret "secret" \
        --sid 18426 --msku "Q9-CH" --quantity 1 \
        --address-line1 "123 Test Ave" --city "Los Angeles" \
        --state "CA" --postal-code "90001" \
        --shipper-name "Test Sender" --phone "2135550101"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

# 把同目录的 sta_api_caller 当模块导入
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sta_api_caller import call_api, poll_task, generate_sign  # noqa: E402

TOKEN_URL = "https://openapi.lingxingerp.com/api/auth-server/oauth/access-token"
BASE_URL = "https://openapi.lingxingerp.com"


def _configure_text_output() -> None:
    """Avoid Windows encode/decode failures while honoring caller-requested encoding."""
    requested = (os.getenv("PYTHONIOENCODING") or "").split(":", 1)[0] or None
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(
                encoding=requested or getattr(stream, "encoding", None) or "utf-8",
                errors="replace",
            )


_configure_text_output()


def log(step: str, msg: str) -> None:
    print(f"[{step}] {msg}", flush=True)


def fail(step: str, msg: str) -> None:
    print(
        json.dumps(
            {"error": True, "step": step, "message": msg}, ensure_ascii=False, indent=2
        )
    )
    sys.exit(1)


# ── Token ─────────────────────────────────────────────────────────────


def get_access_token(app_id: str, app_secret: str) -> str:
    form = urllib.parse.urlencode({"appId": app_id, "appSecret": app_secret}).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8", errors="replace"))
    if body.get("data", {}).get("access_token"):
        return body["data"]["access_token"]
    fail("token", f"获取 token 失败: {body}")
    return ""


# ── 辅助 ──────────────────────────────────────────────────────────────


def api(path: str, params: dict, ctx: dict, label: str = "") -> dict:
    """调用 API 并检查基本成功。"""
    result = call_api(
        path,
        params,
        app_id=ctx["app_id"],
        access_token=ctx["token"],
        base_url=ctx.get("base_url", BASE_URL),
    )
    resp = result.get("response", {})
    code = resp.get("code", -1)
    if code not in (0, "0"):
        fail(label or path, f"API 返回错误: {json.dumps(resp, ensure_ascii=False)}")
    return resp


def api_async(path: str, params: dict, ctx: dict, label: str = "") -> dict:
    """调用异步 API，自动轮询 taskId 直到完成。"""
    resp = api(path, params, ctx, label)
    data = resp.get("data", {})
    task_id = data.get("taskId") or data.get("operationId")
    if not task_id:
        return data
    time.sleep(2)
    poll = poll_task(
        task_id,
        app_id=ctx["app_id"],
        access_token=ctx["token"],
        base_url=ctx.get("base_url", BASE_URL),
    )
    if poll["task_status"] != "success":
        fail(label or path, f"异步任务失败: {json.dumps(poll, ensure_ascii=False)}")
    return data


# ── 步骤 1: 创建 STA 货件 ────────────────────────────────────────────


def step1_create(args: argparse.Namespace, ctx: dict) -> str:
    log("1", "创建 STA 任务...")
    params = {
        "addressLine1": args.address_line1,
        "addressLine2": getattr(args, "address_line2", "") or "",
        "city": args.city,
        "companyName": "",
        "countryCode": args.country_code,
        "email": "",
        "inboundPlanItems": [
            {
                "labelOwner": "SELLER",
                "msku": args.msku,
                "prepOwner": "SELLER",
                "quantity": args.quantity,
            }
        ],
        "phoneNumber": args.phone,
        "planName": f"FBA STA({args.msku}-{args.quantity}-{args.country_code}-WZ)-{datetime.now().strftime('%Y%m%d')}",
        "positionType": "1",
        "postalCode": args.postal_code,
        "remark": "auto created by sta-workflow skill",
        "shipperName": args.shipper_name,
        "sid": args.sid,
        "stateOrProvinceCode": args.state,
    }
    data = api_async(
        "/amzStaServer/openapi/inbound-plan/createInboundPlan",
        params,
        ctx,
        "创建STA任务",
    )
    inbound_plan_id = data.get("inboundPlanId", "")
    log("1", f"STA 任务创建成功: inboundPlanId={inbound_plan_id}")
    return inbound_plan_id


# ── 步骤 2: 商品装箱 ─────────────────────────────────────────────────


def step2_packing(inbound_plan_id: str, args: argparse.Namespace, ctx: dict) -> None:
    log("2", "查询包装组...")
    resp = api(
        "/amzStaServer/openapi/inbound-packing/listPackingGroupItems",
        {"sid": args.sid, "inboundPlanId": inbound_plan_id},
        ctx,
        "查询包装组",
    )
    packing_groups = resp["data"]["packingGroupList"]
    log("2", f"包装组数量: {len(packing_groups)}")

    package_groupings = []
    for pg in packing_groups:
        items_in_box = []
        for item in pg["packingGroupItemList"]:
            items_in_box.append(
                {
                    "labelOwner": item.get("labelOwner", "SELLER"),
                    "msku": item["msku"],
                    "prepOwner": item.get("prepOwner", "SELLER"),
                    "quantity": item["quantity"],
                }
            )
        package_groupings.append(
            {
                "packingGroupId": pg["packingGroupId"],
                "boxes": [
                    {
                        "dimensions": {
                            "height": args.box_height,
                            "length": args.box_length,
                            "width": args.box_width,
                            "unitOfMeasurement": "CM",
                        },
                        "items": items_in_box,
                        "weight": {"unit": "KG", "value": args.box_weight},
                    }
                ],
            }
        )

    log("2", "提交装箱信息...")
    api_async(
        "/amzStaServer/openapi/inbound-packing/setPackingInformation",
        {
            "sid": args.sid,
            "inboundPlanId": inbound_plan_id,
            "packageGroupings": package_groupings,
        },
        ctx,
        "提交装箱信息",
    )
    log("2", "装箱完成")


# ── 步骤 3: 配送服务 ─────────────────────────────────────────────────


def step3_delivery(inbound_plan_id: str, args: argparse.Namespace, ctx: dict) -> str:
    # 3.1 生成货件方案
    log("3", "生成货件方案...")
    api_async(
        "/amzStaServer/openapi/inbound-shipment/generatePlacementOptions",
        {"sid": args.sid, "inboundPlanId": inbound_plan_id},
        ctx,
        "生成货件方案",
    )

    # 3.2 查询货件方案
    log("3", "查询货件方案...")
    resp = api(
        "/amzStaServer/openapi/inbound-shipment/shipmentPreView",
        {"sid": args.sid, "inboundPlanId": inbound_plan_id},
        ctx,
        "查询货件方案",
    )
    placement = resp["data"]["placementOptionList"][0]
    placement_option_id = placement["placementOptionId"]
    shipment_id = placement["shipmentInformationList"][0]["shipmentId"]
    log("3", f"placementOptionId={placement_option_id}, shipmentId={shipment_id}")

    # 3.3 生成承运方式
    log("3", "生成承运方式...")
    ship_date = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")
    api_async(
        "/amzStaServer/openapi/inbound-shipment/generateTransportList",
        {
            "sid": args.sid,
            "inboundPlanId": inbound_plan_id,
            "shipmentIdList": [{"shipmentId": shipment_id, "shipingTime": ship_date}],
        },
        ctx,
        "生成承运方式",
    )

    # 3.4 查询承运方式
    log("3", "查询承运方式...")
    resp = api(
        "/amzStaServer/openapi/inbound-shipment/getTransportList",
        {"sid": args.sid, "inboundPlanId": inbound_plan_id, "shipmentId": shipment_id},
        ctx,
        "查询承运方式",
    )
    transport_list = resp["data"]["transportVOList"]
    # 按 workflow: 选择 其他承运人 + 小包裹快递
    chosen = None
    for t in transport_list:
        if (
            t.get("shippingMode") == "GROUND_SMALL_PARCEL"
            and t.get("shippingSolution") == "USE_YOUR_OWN_CARRIER"
            and t.get("alphaCode") == "Other"
        ):
            chosen = t
            break
    if not chosen:
        # fallback: 任意 SPD + 自有承运人
        for t in transport_list:
            if (
                t.get("shippingMode") == "GROUND_SMALL_PARCEL"
                and t.get("shippingSolution") == "USE_YOUR_OWN_CARRIER"
            ):
                chosen = t
                break
    if not chosen:
        chosen = transport_list[0]
    log("3", f"选择承运方式: {chosen['alphaName']} ({chosen['shippingMode']})")

    # 3.5 生成可选送达时间
    log("3", "生成可选送达时间...")
    api_async(
        "/amzStaServer/openapi/inbound-shipment/generateDeliveryDateList",
        {"sid": args.sid, "inboundPlanId": inbound_plan_id, "shipmentId": shipment_id},
        ctx,
        "生成可选送达时间",
    )

    # 3.6 查询可选送达时间
    log("3", "查询可选送达时间...")
    resp = api(
        "/amzStaServer/openapi/inbound-shipment/getDeliveryDateList",
        {"sid": args.sid, "inboundPlanId": inbound_plan_id, "shipmentId": shipment_id},
        ctx,
        "查询可选送达时间",
    )
    delivery_windows = resp["data"]["shipmentList"]
    # 按 workflow: 选择当前日期后约一个月的窗口
    target_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
    chosen_window = delivery_windows[0]
    for w in delivery_windows:
        if w["startDate"] <= target_date <= w["endDate"]:
            chosen_window = w
            break
    if not chosen_window.get("deliveryWindowOptionId"):
        chosen_window = delivery_windows[-1]
    log("3", f"选择送达时段: {chosen_window['startDate']} ~ {chosen_window['endDate']}")

    # 3.7 确认货件方案
    log("3", "确认货件方案...")
    api_async(
        "/amzStaServer/openapi/inbound-shipment/confirmPlacementOption",
        {
            "sid": args.sid,
            "inboundPlanId": inbound_plan_id,
            "placementOptionId": placement_option_id,
            "shipmentIds": [shipment_id],
        },
        ctx,
        "确认货件方案",
    )

    # 3.8 提交货件配送服务
    log("3", "提交货件配送服务...")
    api_async(
        "/amzStaServer/openapi/inbound-shipment/setDeliveryService",
        {
            "sid": args.sid,
            "inboundPlanId": inbound_plan_id,
            "shipmentDistributionInfo": [
                {
                    "alphaCode": chosen["alphaCode"],
                    "alphaName": chosen["alphaName"],
                    "deliveryWindowOptionId": chosen_window["deliveryWindowOptionId"],
                    "endDate": chosen_window["endDate"],
                    "shipingTime": ship_date,
                    "shipmentId": shipment_id,
                    "shippingMode": chosen["shippingMode"],
                    "shippingSolution": chosen["shippingSolution"],
                    "startDate": chosen_window["startDate"],
                    "transportationOptionId": chosen["transportationOptionId"],
                }
            ],
        },
        ctx,
        "提交货件配送服务",
    )
    log("3", "配送服务提交完成")
    return shipment_id


# ── 步骤 4: 箱子标签 ─────────────────────────────────────────────────


def step4_labels(inbound_plan_id: str, args: argparse.Namespace, ctx: dict) -> dict:
    log("4", "查询 STA 任务详情获取货件单号...")
    resp = api(
        "/amzStaServer/openapi/inbound-plan/detail",
        {"sid": args.sid, "inboundPlanId": inbound_plan_id},
        ctx,
        "查询STA详情",
    )
    shipment_list = resp["data"].get("shipmentList", [])
    if not shipment_list:
        fail("4", "未找到货件信息")
    fba_id = shipment_list[0].get("shipmentConfirmationId", "")
    shipment_id = shipment_list[0].get("shipmentId", "")
    plan_name = resp["data"].get("planName", "")

    log("4", f"货件单号(FBA号): {fba_id}")
    log("4", f"货件名称: {plan_name}")
    log("4", f"shipmentId: {shipment_id}")

    # 标签文件命名: SKU-店铺名+规格+数量-FBA号
    label_filename = f"{args.msku}-{args.quantity}pcs-{fba_id}"
    log("4", f"建议标签文件名: {label_filename}")

    return {
        "fba_id": fba_id,
        "shipment_id": shipment_id,
        "plan_name": plan_name,
        "label_filename": label_filename,
    }


# ── 主流程 ────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="领星 STA 货件创建全流程")
    parser.add_argument(
        "--app-id",
        default=os.getenv("LINGXING_APP_ID"),
        required=not os.getenv("LINGXING_APP_ID"),
    )
    parser.add_argument(
        "--app-secret",
        default=os.getenv("LINGXING_APP_SECRET"),
        required=not os.getenv("LINGXING_APP_SECRET"),
    )
    parser.add_argument("--access-token", default=os.getenv("LINGXING_ACCESS_TOKEN"))
    parser.add_argument("--sid", type=int, required=True, help="领星店铺 sid")
    parser.add_argument("--msku", required=True, help="发货商品 MSKU")
    parser.add_argument("--quantity", type=int, default=1, help="发货数量")
    parser.add_argument("--address-line1", required=True, help="发货地址街道")
    parser.add_argument("--address-line2", default="")
    parser.add_argument("--city", required=True)
    parser.add_argument("--state", required=True, help="州缩写，如 CA")
    parser.add_argument("--postal-code", required=True)
    parser.add_argument("--country-code", default="US")
    parser.add_argument("--shipper-name", required=True)
    parser.add_argument("--phone", default="")
    parser.add_argument("--box-height", type=float, default=30.0, help="箱子高度 CM")
    parser.add_argument("--box-length", type=float, default=40.0, help="箱子长度 CM")
    parser.add_argument("--box-width", type=float, default=35.0, help="箱子宽度 CM")
    parser.add_argument("--box-weight", type=float, default=6.0, help="箱子重量 KG")
    args = parser.parse_args()

    # 获取 token
    if args.access_token:
        token = args.access_token
    else:
        log("0", "获取 access_token...")
        token = get_access_token(args.app_id, args.app_secret)
        log("0", "token 获取成功")

    ctx = {"app_id": args.app_id, "token": token, "base_url": BASE_URL}

    # 步骤 1
    inbound_plan_id = step1_create(args, ctx)

    # 步骤 2
    step2_packing(inbound_plan_id, args, ctx)

    # 步骤 3
    shipment_id = step3_delivery(inbound_plan_id, args, ctx)

    # 步骤 4
    result = step4_labels(inbound_plan_id, args, ctx)

    # 步骤 5: 完成
    log("5", "货件创建完成!")
    summary = {
        "inbound_plan_id": inbound_plan_id,
        "shipment_id": shipment_id,
        "fba_id": result["fba_id"],
        "plan_name": result["plan_name"],
        "label_filename": result["label_filename"],
        "msku": args.msku,
        "quantity": args.quantity,
        "sid": args.sid,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
