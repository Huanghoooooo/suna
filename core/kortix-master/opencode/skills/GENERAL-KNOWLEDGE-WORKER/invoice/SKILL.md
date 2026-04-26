---
name: invoice
description: Generate Amazon/EU commercial invoices and credit notes from bundled XLSX templates. Use when a workflow needs to list invoice templates or sheets, create invoices, create credit notes, or fill invoice spreadsheets from structured order, shipment, or ERP data.
---

# Invoice Skill

Use `generate.py` from this skill directory. The script is self-contained and resolves templates relative to this folder.

## Core Commands

List store templates:

```bash
python generate.py --list-stores
```

List business sheets for a store:

```bash
python generate.py --store "MIRAJ" --list-sheets
```

Generate an invoice:

```bash
python generate.py --store "崔佳佳" --sheet "德国" \
  --order "305-7644530-2706742" --invoice-num "RO-305-7644530-2706742" \
  --date "2026-04-26" --delivery "2026-04-25" \
  --customer "Test GmbH\nStreet 1\nBerlin\n10115\nGermany" \
  --product "Wireless Headphones" --qty 2 --price 89.99 --currency EUR
```

Generate a credit note:

```bash
python generate.py --store "ROB" --sheet "贷记单" --credit-note \
  --order "404-1890227-2099530" --invoice-num "CN-404-1890227-2099530" \
  --date "2026-04-26" --delivery "2026-04-25" \
  --customer "Buyer\nAddress" --product "Returned item" --qty 1 --price 359.98
```

## Inputs

- `store`: template name, for example `崔佳佳`, `班威`, `ROB`.
- `sheet`: exact worksheet name. Prefer this for automation.
- `country`: backward-compatible alias for common sheets such as `德国`, `英国`, `法国`, `意大利`, `西班牙`, `波兰`, `德语发票`.
- `order`, `invoice-num`, `date`, `delivery`, `customer`, `product`, `qty`, `price`, `currency`.
- `--json`: accepts the same fields as JSON, using script names such as `order_number`, `invoice_date`, `customer_info`, `product_description`, `unit_price`.

## Template Behavior

- The script discovers target cells from labels in each sheet instead of fixed coordinates.
- Supported business sheets include standard invoice pages, `贷记单`, `波兰`, and `德语发票`.
- Helper sheets such as `税率计算` are not generation targets.
- Generated XLSX files are written under this skill's `output/` folder.
- PDF export requires LibreOffice or `soffice`; use `--pdf` only when available.
