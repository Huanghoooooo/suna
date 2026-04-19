#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

import requests


DEFAULT_BASE_URL = "https://openapi.lingxing.com"
TOKEN_API_PATH = "/api/auth-server/oauth/access-token"
REFRESH_API_PATH = "/api/auth-server/oauth/refresh"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Execute Lingxing APIs from the local API registry."
    )
    parser.add_argument(
        "--registry", default="build/api_registry.json", help="Registry JSON path."
    )
    parser.add_argument("--id", help="Registry record id.")
    parser.add_argument("--api-path", help="API path to execute.")
    parser.add_argument("--name", help="API display name to execute.")
    parser.add_argument("--params", help="Inline JSON params.")
    parser.add_argument("--params-file", help="JSON file containing request params.")
    parser.add_argument("--config-file", help="Optional JSON config file.")
    parser.add_argument(
        "--base-url",
        default=os.getenv("LINGXING_BASE_URL", DEFAULT_BASE_URL),
        help="Base URL.",
    )
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds.")
    parser.add_argument(
        "--dry-run", action="store_true", help="Only print the computed request."
    )
    parser.add_argument("--json", action="store_true", help="Force JSON output.")
    return parser.parse_args()


def load_json_file(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_params(args: argparse.Namespace) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if args.params_file:
        params.update(load_json_file(args.params_file))
    if args.params:
        params.update(json.loads(args.params))
    return params


def load_runtime_config(args: argparse.Namespace) -> dict[str, Any]:
    cfg = {
        "app_id": os.getenv("LINGXING_APP_ID"),
        "app_secret": os.getenv("LINGXING_APP_SECRET"),
        "access_token": os.getenv("LINGXING_ACCESS_TOKEN"),
        "refresh_token": os.getenv("LINGXING_REFRESH_TOKEN"),
    }
    if args.config_file:
        cfg.update(load_json_file(args.config_file))
    return cfg


def choose_record(args: argparse.Namespace, registry: list[dict]) -> dict:
    for record in registry:
        if args.id and record["id"] == args.id:
            return record
        if args.api_path and record["api_path"] == args.api_path:
            return record
        if args.name and record["name"] == args.name:
            return record
    raise SystemExit("No registry record matched `--id`, `--api-path`, or `--name`.")


def canonical_sign_value(value: Any) -> str | None:
    if value == "":
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def build_sign_input(
    business_params: dict[str, Any], app_id: str, access_token: str, timestamp: str
) -> str:
    sign_params: dict[str, str] = {
        "access_token": access_token,
        "app_key": app_id,
        "timestamp": timestamp,
    }
    for key, value in business_params.items():
        normalized = canonical_sign_value(value)
        if normalized is None:
            continue
        sign_params[key] = normalized

    items = sorted(sign_params.items(), key=lambda item: item[0])
    return "&".join(f"{key}={value}" for key, value in items)


def pkcs5_pad(data: bytes, block_size: int = 16) -> bytes:
    padding = block_size - (len(data) % block_size)
    return data + bytes([padding]) * padding


def aes_ecb_encrypt_base64(plaintext: str, key: str) -> str:
    key_bytes = key.encode("utf-8")
    if len(key_bytes) not in {16, 24, 32}:
        raise SystemExit(
            "app_id length must be 16, 24, or 32 bytes for AES ECB signing."
        )

    openssl_names = {
        16: "aes-128-ecb",
        24: "aes-192-ecb",
        32: "aes-256-ecb",
    }
    proc = subprocess.run(
        [
            "openssl",
            "enc",
            f"-{openssl_names[len(key_bytes)]}",
            "-base64",
            "-nosalt",
            "-nopad",
            "-K",
            key_bytes.hex(),
        ],
        input=pkcs5_pad(plaintext.encode("utf-8")),
        capture_output=True,
        check=True,
    )
    return proc.stdout.decode("utf-8").strip()


def generate_sign(
    business_params: dict[str, Any], app_id: str, access_token: str, timestamp: str
) -> tuple[str, str]:
    sign_input = build_sign_input(
        business_params, app_id=app_id, access_token=access_token, timestamp=timestamp
    )
    md5_upper = hashlib.md5(sign_input.encode("utf-8")).hexdigest().upper()
    sign = aes_ecb_encrypt_base64(md5_upper, app_id)
    return sign, sign_input


def build_request(
    record: dict, params: dict[str, Any], cfg: dict[str, Any], base_url: str
) -> dict[str, Any]:
    api_path = record["api_path"]
    method = record["method"].upper()
    url = f"{base_url.rstrip('/')}{api_path}"
    headers: dict[str, str] = {}
    query: dict[str, str] = {}
    body: Any = None
    sign_input = None

    if api_path == TOKEN_API_PATH:
        headers["Content-Type"] = "multipart/form-data"
        body = {
            "appId": params.get("appId") or cfg.get("app_id"),
            "appSecret": params.get("appSecret") or cfg.get("app_secret"),
        }
        return {
            "url": url,
            "method": method,
            "headers": headers,
            "query": query,
            "body": body,
            "sign_input": None,
        }

    if api_path == REFRESH_API_PATH:
        headers["Content-Type"] = "multipart/form-data"
        body = {
            "appId": params.get("appId") or cfg.get("app_id"),
            "refreshToken": params.get("refreshToken") or cfg.get("refresh_token"),
        }
        return {
            "url": url,
            "method": method,
            "headers": headers,
            "query": query,
            "body": body,
            "sign_input": None,
        }

    app_id = cfg.get("app_id")
    access_token = cfg.get("access_token")
    if not app_id or not access_token:
        raise SystemExit(
            "Business APIs require app_id and access_token. Set env vars or use --config-file."
        )

    timestamp = str(int(time.time()))
    business_params = params.copy()
    sign, sign_input = generate_sign(
        business_params, app_id=app_id, access_token=access_token, timestamp=timestamp
    )
    query = {
        "access_token": access_token,
        "app_key": app_id,
        "timestamp": timestamp,
        "sign": sign,
    }

    if method == "GET":
        for key, value in business_params.items():
            if value == "":
                continue
            query[key] = canonical_sign_value(value) or ""
    else:
        headers["Content-Type"] = "application/json"
        body = business_params

    return {
        "url": url,
        "method": method,
        "headers": headers,
        "query": query,
        "body": body,
        "sign_input": sign_input,
    }


def execute_request(request_spec: dict[str, Any], timeout: int) -> requests.Response:
    method = request_spec["method"]
    url = request_spec["url"]
    headers = request_spec["headers"]
    query = request_spec["query"]
    body = request_spec["body"]

    if request_spec["url"].endswith(TOKEN_API_PATH) or request_spec["url"].endswith(
        REFRESH_API_PATH
    ):
        return requests.request(method, url, params=query, data=body, timeout=timeout)

    if method == "GET":
        return requests.request(
            method, url, params=query, headers=headers, timeout=timeout
        )

    return requests.request(
        method, url, params=query, headers=headers, json=body, timeout=timeout
    )


def main() -> None:
    args = parse_args()
    registry = json.loads(Path(args.registry).read_text(encoding="utf-8"))
    record = choose_record(args, registry)
    params = load_params(args)
    cfg = load_runtime_config(args)
    request_spec = build_request(record, params=params, cfg=cfg, base_url=args.base_url)

    payload = {
        "record": {
            "id": record["id"],
            "name": record["name"],
            "method": record["method"],
            "api_path": record["api_path"],
        },
        "request": request_spec,
    }

    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    response = execute_request(request_spec, timeout=args.timeout)
    try:
        body = response.json()
    except ValueError:
        body = response.text

    result = {
        "status_code": response.status_code,
        "ok": response.ok,
        "record": payload["record"],
        "request": {
            "url": request_spec["url"],
            "method": request_spec["method"],
            "headers": request_spec["headers"],
            "query": request_spec["query"],
            "body": request_spec["body"],
        },
        "response": body,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
