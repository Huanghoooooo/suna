#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_/-]{1,}|[\u4e00-\u9fff]{1,8}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search the local API registry for likely candidate APIs.")
    parser.add_argument("query", help="Natural language query or API keyword.")
    parser.add_argument("--registry", default="build/api_registry.json", help="Registry JSON path.")
    parser.add_argument("--top-k", type=int, default=8, help="How many candidates to return.")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of plain text.")
    return parser.parse_args()


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_RE.findall(text or "")]


def score_record(query: str, query_tokens: list[str], record: dict) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    name = (record.get("name") or "").lower()
    api_path = (record.get("api_path") or "").lower()
    summary = (record.get("summary") or "").lower()
    aliases = [item.lower() for item in record.get("aliases") or []]
    keywords = [item.lower() for item in record.get("keywords") or []]
    intents = [item.lower() for item in record.get("intent_examples") or []]
    params = [item.lower() for item in (record.get("required_params") or []) + (record.get("optional_params") or [])]

    for token in query_tokens:
        if token in name:
            score += 12
            reasons.append(f"name:{token}")
        if token in api_path:
            score += 10
            reasons.append(f"path:{token}")
        if any(token in item for item in aliases):
            score += 9
            reasons.append(f"alias:{token}")
        if any(token in item for item in intents):
            score += 8
            reasons.append(f"intent:{token}")
        if any(token in item for item in keywords):
            score += 6
            reasons.append(f"keyword:{token}")
        if token in summary:
            score += 5
            reasons.append(f"summary:{token}")
        if any(token in item for item in params):
            score += 3
            reasons.append(f"param:{token}")

    if query.lower() in name:
        score += 20
        reasons.append("full_name")
    if query.lower() in api_path:
        score += 16
        reasons.append("full_path")

    return score, reasons[:6]


def main() -> None:
    args = parse_args()
    registry = json.loads(Path(args.registry).read_text(encoding="utf-8"))
    query_tokens = tokenize(args.query)

    ranked = []
    for record in registry:
        score, reasons = score_record(args.query, query_tokens, record)
        if score <= 0:
            continue
        ranked.append((score, reasons, record))

    ranked.sort(key=lambda item: (-item[0], item[2]["name"], item[2]["api_path"]))
    results = []
    for score, reasons, record in ranked[: args.top_k]:
        results.append(
            {
                "score": score,
                "reasons": reasons,
                "id": record["id"],
                "name": record["name"],
                "domain": record["domain"],
                "api_path": record["api_path"],
                "method": record["method"],
                "summary": record["summary"],
                "required_params": record["required_params"][:8],
                "doc_url": record["doc_url"],
            }
        )

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return

    for index, item in enumerate(results, start=1):
        print(f"{index}. [{item['score']}] {item['name']} {item['method']} {item['api_path']}")
        print(f"   domain: {item['domain']}")
        print(f"   summary: {item['summary']}")
        print(f"   required_params: {', '.join(item['required_params']) if item['required_params'] else '-'}")
        print(f"   reasons: {', '.join(item['reasons'])}")
        print(f"   doc_url: {item['doc_url'] or '-'}")


if __name__ == "__main__":
    main()
