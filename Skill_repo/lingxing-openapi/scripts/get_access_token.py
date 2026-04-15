#!/usr/bin/env python3
import argparse
import json
import sys
import urllib.parse
import urllib.request


TOKEN_URL = "https://openapi.lingxingerp.com/api/auth-server/oauth/access-token"


def main() -> int:
    parser = argparse.ArgumentParser(description="Get LingXing access_token")
    parser.add_argument("--app-id", required=True, help="LingXing appId")
    parser.add_argument("--app-secret", required=True, help="LingXing appSecret")
    args = parser.parse_args()

    form = urllib.parse.urlencode({
        "appId": args.app_id,
        "appSecret": args.app_secret,
    }).encode("utf-8")

    req = urllib.request.Request(
        TOKEN_URL,
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        print(json.dumps({"ok": False, "raw": body}, ensure_ascii=False))
        return 1

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
