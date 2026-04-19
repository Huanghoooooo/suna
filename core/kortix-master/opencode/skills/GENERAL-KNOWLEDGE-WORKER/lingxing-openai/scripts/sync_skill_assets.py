#!/usr/bin/env python3
from __future__ import annotations

import shutil
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILL_SCRIPTS = SKILL_ROOT / "scripts"
SKILL_DATA = SKILL_ROOT / "data"
REPO_ROOT = Path(__file__).resolve().parents[3]

SCRIPT_MAPPINGS = {
    REPO_ROOT / "scripts" / "search_api_registry.py": SKILL_SCRIPTS / "core_search_api_registry.py",
    REPO_ROOT / "scripts" / "search_api_chunks.py": SKILL_SCRIPTS / "core_search_api_chunks.py",
    REPO_ROOT / "scripts" / "api_executor.py": SKILL_SCRIPTS / "core_api_executor.py",
}

DATA_MAPPINGS = {
    REPO_ROOT / "build" / "api_registry.json": SKILL_DATA / "api_registry.json",
    REPO_ROOT / "build" / "api_registry_kb.jsonl": SKILL_DATA / "api_registry_kb.jsonl",
    REPO_ROOT / "build" / "api_chunks.jsonl": SKILL_DATA / "api_chunks.jsonl",
}


def copy_file(src: Path, dst: Path) -> None:
    if not src.exists():
        raise SystemExit(f"Missing source file: {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"copied {src} -> {dst}")


def main() -> int:
    for src, dst in SCRIPT_MAPPINGS.items():
        copy_file(src, dst)
    for src, dst in DATA_MAPPINGS.items():
        copy_file(src, dst)
    print("\nLingXing skill assets are now self-contained under Skills/lingxing-openapi/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
