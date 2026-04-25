---
name: lingxing-sta-workflow
description: Create and inspect LingXing ERP STA/FBA inbound shipments. Use when a workflow needs STA shipment creation, packing, placement, carrier selection, delivery windows, FBA shipment numbers, or shipment-to-invoice follow-up data.
---

# LingXing STA Workflow Skill

This skill drives the STA workflow with LingXing OpenAPI. It is bundled inside `hermes-poc/skills/lingxing-sta-workflow` and does not depend on the original `suna` checkout.

## Scripts

Use `scripts/sta_api_caller.py` for individual STA API calls and dry-runs:

```bash
python scripts/sta_api_caller.py \
  --api-path "/amzStaServer/openapi/inbound-plan/detail" \
  --params '{"sid":18426,"inboundPlanId":"wfxxx"}' \
  --app-id "$LINGXING_APP_ID" \
  --access-token "$LINGXING_ACCESS_TOKEN"
```

Use `scripts/sta_workflow_runner.py` only after explicit user confirmation because it performs write operations:

```bash
python scripts/sta_workflow_runner.py \
  --sid 18426 --msku "Q9-CH" --quantity 1 \
  --address-line1 "123 Test Avenue" --city "Los Angeles" \
  --state "CA" --postal-code "90001" --shipper-name "Test Sender"
```

## Runtime Inputs

- `LINGXING_APP_ID`
- `LINGXING_APP_SECRET`
- `LINGXING_ACCESS_TOKEN`
- Optional `LINGXING_BASE_URL`, defaulting to `https://openapi.lingxingerp.com`.

## Workflow Guardrails

- Treat `createInboundPlan`, `setPackingInformation`, `generatePlacementOptions`, `confirmPlacementOption`, `generateTransportList`, `generateDeliveryDateList`, and `setDeliveryService` as write operations. Require a structured confirmation card before running them.
- Use `--dry-run` before new request shapes.
- Do not rerun `createInboundPlan` for an existing test shipment.
- Poll async task ids through `/amzStaServer/openapi/task-plan/operate`.
- Keep calls serial; STA endpoints can be sensitive to rate limits.
- For US addresses, pass state abbreviations such as `CA`, not full state names.

## Shipment Completion Definition

For the Hermes POC, "shipment creation complete" means the STA plan has an `inboundPlanId`, a shipment has a `shipmentConfirmationId`/FBA number, and current detail can be read from `inbound-plan/detail`. This is not the same as physical carrier pickup or final logistics completion.
