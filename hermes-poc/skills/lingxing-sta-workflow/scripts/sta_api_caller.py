#!/usr/bin/env python3
"""
领星 STA 专用 API 调用器。

解决 core_api_executor.py 对嵌套 JSON 签名时 sort_keys=True 导致
setPackingInformation / generateTransportList / setDeliveryService 等接口
返回 "api sign not correct" 的问题。

用法:
    python sta_api_caller.py \
        --api-path "/amzStaServer/openapi/inbound-plan/createInboundPlan" \
        --params '{"sid":18426,...}' \
        --app-id "ak_xxx" \
        --access-token "token"
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from typing import Any

try:
    import requests
except ImportError:
    requests = None

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


# ── 签名 ──────────────────────────────────────────────────────────────


def _stringify_for_sign(value: Any) -> str:
    """将值转为签名用字符串。嵌套对象不排序 key。"""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if value is None:
        return "null"
    return str(value)


def _pkcs5_pad(data: bytes, block_size: int = 16) -> bytes:
    pad_len = block_size - (len(data) % block_size)
    return data + bytes([pad_len]) * pad_len


def _aes_ecb_encrypt(plaintext: str, key_bytes: bytes) -> bytes:
    """用 openssl CLI 做 AES-ECB 加密，避免依赖 pycryptodome。"""
    key_len = len(key_bytes)
    cipher_name = {16: "aes-128-ecb", 24: "aes-192-ecb", 32: "aes-256-ecb"}.get(key_len)
    if not cipher_name:
        raise ValueError(f"app_id 长度 {key_len} 不是合法 AES key 长度 (16/24/32)")
    result = subprocess.run(
        [
            "openssl",
            "enc",
            f"-{cipher_name}",
            "-K",
            key_bytes.hex(),
            "-nosalt",
            "-nopad",
        ],
        input=_pkcs5_pad(plaintext.encode("utf-8")),
        capture_output=True,
        check=True,
    )
    return result.stdout


def generate_sign(
    business_params: dict, app_id: str, access_token: str, timestamp: str
) -> str:
    """按领星规则生成 sign。"""
    sign_params: dict[str, str] = {
        "access_token": access_token,
        "app_key": app_id,
        "timestamp": timestamp,
    }
    for key, value in business_params.items():
        if value == "":
            continue
        sign_params[key] = _stringify_for_sign(value)

    items = sorted(sign_params.items(), key=lambda kv: kv[0])
    raw = "&".join(f"{k}={v}" for k, v in items)
    md5_upper = hashlib.md5(raw.encode("utf-8")).hexdigest().upper()
    encrypted = _aes_ecb_encrypt(md5_upper, app_id.encode("utf-8"))
    return base64.b64encode(encrypted).decode("utf-8")


# ── 请求 ──────────────────────────────────────────────────────────────


def call_api(
    api_path: str,
    params: dict,
    app_id: str,
    access_token: str,
    base_url: str = BASE_URL,
    timeout: int = 30,
    dry_run: bool = False,
) -> dict:
    timestamp = str(int(time.time()))
    sign = generate_sign(
        params, app_id=app_id, access_token=access_token, timestamp=timestamp
    )
    query = {
        "access_token": access_token,
        "app_key": app_id,
        "timestamp": timestamp,
        "sign": sign,
    }
    url = f"{base_url.rstrip('/')}{api_path}"

    request_spec = {
        "url": url,
        "method": "POST",
        "query": query,
        "body": params,
    }

    if dry_run:
        return {"dry_run": True, "request": request_spec}

    if requests is not None:
        resp = requests.post(url, params=query, json=params, timeout=timeout)
        try:
            body = resp.json()
        except ValueError:
            body = resp.text
        return {
            "status_code": resp.status_code,
            "ok": resp.ok,
            "request": request_spec,
            "response": body,
        }

    encoded_query = urllib.parse.urlencode(query)
    request_url = f"{url}?{encoded_query}"
    body_bytes = json.dumps(params, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        request_url,
        data=body_bytes,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            status_code = resp.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        status_code = exc.code

    try:
        body = json.loads(raw)
    except ValueError:
        body = raw
    return {
        "status_code": status_code,
        "ok": 200 <= status_code < 300,
        "request": request_spec,
        "response": body,
    }


# ── 异步任务轮询 ──────────────────────────────────────────────────────


def poll_task(
    task_id: str,
    app_id: str,
    access_token: str,
    base_url: str = BASE_URL,
    max_retries: int = 15,
    interval: float = 3.0,
) -> dict:
    """轮询异步任务直到 success/failure。"""
    for i in range(max_retries):
        if i > 0:
            time.sleep(interval)
        result = call_api(
            "/amzStaServer/openapi/task-plan/operate",
            {"taskId": task_id},
            app_id=app_id,
            access_token=access_token,
            base_url=base_url,
        )
        resp = result.get("response", {})
        data = resp.get("data", {}) if isinstance(resp, dict) else {}
        status = data.get("taskStatus", "")
        if status in ("success", "failure", "local_failure"):
            return {
                "task_id": task_id,
                "task_status": status,
                "data": data,
                "poll_count": i + 1,
            }
    return {
        "task_id": task_id,
        "task_status": "timeout",
        "data": {},
        "poll_count": max_retries,
    }


# ── CLI ───────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="领星 STA 专用 API 调用器")
    parser.add_argument("--api-path", required=True, help="API 路径")
    parser.add_argument("--params", default="{}", help="JSON 格式业务参数")
    parser.add_argument(
        "--app-id", default=os.getenv("LINGXING_APP_ID"), help="领星 appId"
    )
    parser.add_argument(
        "--access-token",
        default=os.getenv("LINGXING_ACCESS_TOKEN"),
        help="access_token",
    )
    parser.add_argument("--base-url", default=os.getenv("LINGXING_BASE_URL", BASE_URL))
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--poll-task", help="轮询指定 taskId 直到完成")
    args = parser.parse_args()

    if not args.app_id or not args.access_token:
        sys.exit(
            "需要 --app-id 和 --access-token（或设置环境变量 LINGXING_APP_ID / LINGXING_ACCESS_TOKEN）"
        )

    if args.poll_task:
        result = poll_task(
            args.poll_task,
            app_id=args.app_id,
            access_token=args.access_token,
            base_url=args.base_url,
        )
    else:
        params = json.loads(args.params)
        result = call_api(
            args.api_path,
            params,
            app_id=args.app_id,
            access_token=args.access_token,
            base_url=args.base_url,
            timeout=args.timeout,
            dry_run=args.dry_run,
        )

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
