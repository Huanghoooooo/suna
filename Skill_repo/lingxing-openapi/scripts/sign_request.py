#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import subprocess
import sys
import urllib.parse
from typing import Dict

try:
    from Crypto.Cipher import AES  # type: ignore
except Exception:  # pragma: no cover
    AES = None


def pkcs5_pad(data: bytes, block_size: int = 16) -> bytes:
    pad_len = block_size - (len(data) % block_size)
    return data + bytes([pad_len]) * pad_len


def normalize_value(raw: str):
    if raw == "null":
        return None
    return raw


def build_params(access_token: str, app_id: str, timestamp: str, pairs: list[str]) -> Dict[str, object]:
    params: Dict[str, object] = {
        "access_token": access_token,
        "app_key": app_id,
        "timestamp": timestamp,
    }
    for pair in pairs:
        if "=" not in pair:
            raise ValueError(f"Invalid --param value: {pair}")
        key, value = pair.split("=", 1)
        params[key] = normalize_value(value)
    return params


def stringify_for_sign(value: object) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if value is None:
        return "null"
    return str(value)


def lingxing_sign(params: Dict[str, object], app_id: str) -> tuple[str, str, str]:
    parts = []
    for key in sorted(params.keys()):
        value = params[key]
        if value == "":
            continue
        parts.append(f"{key}={stringify_for_sign(value)}")

    raw = "&".join(parts)
    md5_upper = hashlib.md5(raw.encode("utf-8")).hexdigest().upper()

    key_bytes = app_id.encode("utf-8")
    if len(key_bytes) not in (16, 24, 32):
        raise ValueError("appId length must be valid for AES key size, usually 16 bytes")

    if AES is not None:
        cipher = AES.new(key_bytes, AES.MODE_ECB)
        encrypted = cipher.encrypt(pkcs5_pad(md5_upper.encode("utf-8")))
    else:
        encrypted = encrypt_with_openssl(md5_upper, key_bytes)

    sign_base64 = base64.b64encode(encrypted).decode("utf-8")
    sign_encoded = urllib.parse.quote(sign_base64, safe="")
    return raw, md5_upper, sign_encoded


def encrypt_with_openssl(md5_upper: str, key_bytes: bytes) -> bytes:
    cmd = [
        "openssl",
        "enc",
        "-aes-128-ecb",
        "-K",
        key_bytes.hex(),
        "-nosalt",
    ]
    try:
        result = subprocess.run(
            cmd,
            input=md5_upper.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except Exception as exc:
        raise RuntimeError(f"OpenSSL AES encryption failed: {exc}") from exc
    return result.stdout


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate LingXing sign")
    parser.add_argument("--app-id", required=True, help="LingXing appId")
    parser.add_argument("--access-token", required=True, help="LingXing access_token")
    parser.add_argument("--timestamp", help="Unix timestamp, defaults to current time")
    parser.add_argument(
        "--param",
        action="append",
        default=[],
        help="Business param in key=value format; may be repeated",
    )
    args = parser.parse_args()

    timestamp = args.timestamp
    if not timestamp:
        import time
        timestamp = str(int(time.time()))

    try:
        params = build_params(args.access_token, args.app_id, timestamp, args.param)
        raw, md5_upper, sign = lingxing_sign(params, args.app_id)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1

    print(json.dumps({
        "ok": True,
        "timestamp": timestamp,
        "raw": raw,
        "md5_upper": md5_upper,
        "sign": sign,
        "query": f"{raw}&sign={sign}",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
