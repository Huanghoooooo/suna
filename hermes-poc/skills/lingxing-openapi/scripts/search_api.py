#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
LOCAL_TARGET = Path(__file__).resolve().with_name("core_search_api_registry.py")
LOCAL_REGISTRY = SKILL_ROOT / "data" / "api_registry.json"


def resolve_assets() -> tuple[Path, Path]:
    if LOCAL_TARGET.exists() and LOCAL_REGISTRY.exists():
        return LOCAL_TARGET, LOCAL_REGISTRY

    raise SystemExit(
        "Missing bundled LingXing OpenAPI assets.\n"
        f"Expected:\n- {LOCAL_TARGET}\n- {LOCAL_REGISTRY}"
    )


def main() -> int:
    target, registry = resolve_assets()
    if not target.exists():
        raise SystemExit(f"Missing search tool: {target}")
    if not registry.exists():
        raise SystemExit(f"Missing registry file: {registry}")

    cmd = [sys.executable, str(target), "--registry", str(registry), *sys.argv[1:]]
    completed = subprocess.run(cmd)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
