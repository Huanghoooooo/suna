#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
LOCAL_TARGET = Path(__file__).resolve().with_name("core_search_api_chunks.py")
LOCAL_CHUNKS = SKILL_ROOT / "data" / "api_chunks.jsonl"


def resolve_assets() -> tuple[Path, Path]:
    if LOCAL_TARGET.exists() and LOCAL_CHUNKS.exists():
        return LOCAL_TARGET, LOCAL_CHUNKS

    raise SystemExit(
        "Missing bundled LingXing OpenAPI detail assets.\n"
        f"Expected:\n- {LOCAL_TARGET}\n- {LOCAL_CHUNKS}"
    )


def main() -> int:
    target, chunks = resolve_assets()
    if not target.exists():
        raise SystemExit(f"Missing detail search tool: {target}")
    if not chunks.exists():
        raise SystemExit(f"Missing chunk file: {chunks}")

    cmd = [sys.executable, str(target), "--chunks", str(chunks), *sys.argv[1:]]
    completed = subprocess.run(cmd)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
