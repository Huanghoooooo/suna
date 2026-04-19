#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
LOCAL_TARGET = Path(__file__).resolve().with_name("core_api_executor.py")
LOCAL_REGISTRY = SKILL_ROOT / "data" / "api_registry.json"


def find_repo_root() -> Path | None:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "scripts" / "api_executor.py").exists() and (parent / "build" / "api_registry.json").exists():
            return parent
    return None


def resolve_assets() -> tuple[Path, Path]:
    if LOCAL_TARGET.exists() and LOCAL_REGISTRY.exists():
        return LOCAL_TARGET, LOCAL_REGISTRY

    if os.environ.get("LINGXING_API_REPO_ROOT"):
        root = Path(os.environ["LINGXING_API_REPO_ROOT"]).expanduser().resolve()
    else:
        root = find_repo_root()

    if root is None:
        raise SystemExit(
            "Could not locate local LingXing skill executor assets.\n"
            "Expected:\n"
            f"- {LOCAL_TARGET}\n"
            f"- {LOCAL_REGISTRY}\n"
            "If you are inside the source repo, run:\n"
            "python3 Skills/lingxing-openapi/scripts/sync_skill_assets.py"
        )

    target = root / "scripts" / "api_executor.py"
    registry = root / "build" / "api_registry.json"
    return target, registry


def main() -> int:
    target, registry = resolve_assets()
    if not target.exists():
        raise SystemExit(f"Missing executor tool: {target}")
    if not registry.exists():
        raise SystemExit(
            f"Missing registry file: {registry}\n"
            "Run `python3 Skills/lingxing-openapi/scripts/sync_skill_assets.py` or rebuild the registry first."
        )

    cmd = [sys.executable, str(target), "--registry", str(registry), *sys.argv[1:]]
    completed = subprocess.run(cmd)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
