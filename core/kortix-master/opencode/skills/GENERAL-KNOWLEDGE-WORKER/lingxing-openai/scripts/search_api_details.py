#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
LOCAL_TARGET = Path(__file__).resolve().with_name("core_search_api_chunks.py")
LOCAL_CHUNKS = SKILL_ROOT / "data" / "api_chunks.jsonl"


def find_repo_root() -> Path | None:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "scripts" / "search_api_chunks.py").exists() and (parent / "build").exists():
            return parent
    return None


def resolve_assets() -> tuple[Path, Path]:
    if LOCAL_TARGET.exists() and LOCAL_CHUNKS.exists():
        return LOCAL_TARGET, LOCAL_CHUNKS

    if os.environ.get("LINGXING_API_REPO_ROOT"):
        root = Path(os.environ["LINGXING_API_REPO_ROOT"]).expanduser().resolve()
    else:
        root = find_repo_root()

    if root is None:
        raise SystemExit(
            "Could not locate local LingXing skill detail assets.\n"
            "Expected:\n"
            f"- {LOCAL_TARGET}\n"
            f"- {LOCAL_CHUNKS}\n"
            "If you are inside the source repo, run:\n"
            "python3 Skills/lingxing-openapi/scripts/sync_skill_assets.py"
        )

    target = root / "scripts" / "search_api_chunks.py"
    chunks = root / "build" / "api_chunks.jsonl"
    return target, chunks


def main() -> int:
    target, chunks = resolve_assets()
    if not target.exists():
        raise SystemExit(f"Missing detail search tool: {target}")
    if not chunks.exists():
        raise SystemExit(
            f"Missing chunk file: {chunks}\n"
            "Run `python3 Skills/lingxing-openapi/scripts/sync_skill_assets.py` or rebuild chunks first."
        )

    cmd = [sys.executable, str(target), "--chunks", str(chunks), *sys.argv[1:]]
    completed = subprocess.run(cmd)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
