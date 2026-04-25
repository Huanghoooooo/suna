---
name: lingxing-openapi
description: Search, inspect, sign, and call LingXing ERP OpenAPI endpoints from bundled API registry data. Use when a workflow needs to discover LingXing APIs, inspect parameters, get access tokens, generate signed requests, or dry-run/execute LingXing business APIs.
---

# LingXing OpenAPI Skill

This skill is self-contained under `hermes-poc/skills/lingxing-openapi`. Use the bundled scripts and data files; do not depend on the original API repository or `suna` checkout.

## Workflow

1. Search candidate APIs when the path is unknown.
2. Inspect API details for parameters and response fields.
3. Get or refresh `access_token` when needed.
4. Dry-run the signed request.
5. Execute only after the user confirms any write operation.

## Scripts

Search the registry:

```bash
python scripts/search_api.py "店铺列表" --json
```

Inspect documentation chunks:

```bash
python scripts/search_api_details.py "店铺列表" --api-path "/erp/sc/data/seller/lists"
```

Get token:

```bash
python scripts/get_access_token.py --app-id "$LINGXING_APP_ID" --app-secret "$LINGXING_APP_SECRET"
```

Generate a signed request:

```bash
python scripts/sign_request.py --app-id "$LINGXING_APP_ID" --access-token "$LINGXING_ACCESS_TOKEN" --param offset=0
```

Dry-run or execute an API:

```bash
python scripts/call_api.py \
  --api-path "/erp/sc/data/seller/lists" \
  --params '{}' \
  --dry-run
```

## Runtime Inputs

- `LINGXING_APP_ID`
- `LINGXING_APP_SECRET`
- `LINGXING_ACCESS_TOKEN`
- Optional `LINGXING_REFRESH_TOKEN`
- Optional `LINGXING_BASE_URL`, defaulting to `https://openapi.lingxingerp.com`.

## Rules

- Public parameters go in the URL query: `access_token`, `app_key`, `timestamp`, `sign`.
- POST business parameters go in the JSON body and participate in signing.
- Arrays and objects participate in signing as compact JSON strings.
- Token endpoints use form data and do not require `sign`.
- Always dry-run new request shapes before real execution.
- Do not run write APIs without an explicit confirmation card.

## Bundled Assets

- `data/api_registry.json`: API index.
- `data/api_chunks.jsonl`: detailed API documentation chunks.
- `data/api_registry_kb.jsonl`: compact knowledge-base form.
- `scripts/core_*`: local search and execution engines used by the wrapper scripts.
