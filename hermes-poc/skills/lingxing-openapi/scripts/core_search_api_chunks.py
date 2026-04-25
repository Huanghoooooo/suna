#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_/-]{1,}|[\u4e00-\u9fff]{1,8}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Search detailed API doc chunks.")
    parser.add_argument("query", help="Natural language query, field name, or error code.")
    parser.add_argument("--chunks", default="build/api_chunks.jsonl", help="Chunk JSONL path.")
    parser.add_argument("--api-path", help="Restrict to one API path.")
    parser.add_argument("--title", help="Restrict to one section title.")
    parser.add_argument("--top-k", type=int, default=6, help="How many chunks to return.")
    parser.add_argument("--json", action="store_true", help="Output JSON.")
    return parser.parse_args()


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_RE.findall(text or "")]


def score_chunk(query_tokens: list[str], chunk: dict) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    text = (chunk.get("text") or "").lower()
    title = (chunk.get("title") or "").lower()
    api_path = (chunk.get("api_path") or "").lower()

    for token in query_tokens:
        if token in title:
            score += 10
            reasons.append(f"title:{token}")
        if token in api_path:
            score += 9
            reasons.append(f"path:{token}")
        if token in text:
            score += 4
            reasons.append(f"text:{token}")

    if "参数名" in text:
        score += 2
    if "Json Object".lower() in text:
        score += 1

    return score, reasons[:6]


def main() -> None:
    args = parse_args()
    query_tokens = tokenize(args.query)
    results = []

    with Path(args.chunks).open("r", encoding="utf-8") as f:
        for line in f:
            chunk = json.loads(line)
            if args.api_path and chunk.get("api_path") != args.api_path:
                continue
            if args.title and chunk.get("title") != args.title:
                continue
            score, reasons = score_chunk(query_tokens, chunk)
            if score <= 0:
                continue
            results.append((score, reasons, chunk))

    results.sort(key=lambda item: (-item[0], item[2].get("title") or "", item[2].get("chunk_index") or 0))
    payload = []
    for score, reasons, chunk in results[: args.top_k]:
        payload.append(
            {
                "score": score,
                "reasons": reasons,
                "title": chunk.get("title"),
                "api_path": chunk.get("api_path"),
                "method": chunk.get("method"),
                "doc_url": chunk.get("doc_url"),
                "chunk_index": chunk.get("chunk_index"),
                "text": chunk.get("text"),
            }
        )

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    for index, item in enumerate(payload, start=1):
        print(f"{index}. [{item['score']}] {item['title']} {item['method']} {item['api_path']}")
        print(f"   reasons: {', '.join(item['reasons'])}")
        print(f"   doc_url: {item['doc_url'] or '-'}")
        print(f"   text: {item['text'][:800]}")


if __name__ == "__main__":
    main()
