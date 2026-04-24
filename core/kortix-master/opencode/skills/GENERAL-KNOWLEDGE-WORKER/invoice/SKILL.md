---
name: invoice
description: Generate Amazon EU commercial invoices and credit notes from bundled XLSX templates. Use when the user asks to create, modify, or export invoices, commercial invoices, 发票, 开发票, 修改发票, invoice, or credit note/贷记单.
---

# Invoice Skill

Generate commercial invoices and credit notes by filling the bundled XLSX templates in `templates/`.

This skill is portable: all paths are resolved relative to this skill folder. Do not depend on the original project checkout, `~/.claude`, `~/.codex`, or any machine-specific absolute path.

## Quick Start

Use the generator script from this skill directory:

```bash
python3 generate.py --store "崔佳佳" --country "德国" \
  --order "305-7644530-2706742" --invoice-num "RO-305-7644530-2706742" \
  --date "2026-04-24" --delivery "2026-04-20" \
  --customer "Test GmbH\nStreet 1\nBerlin\n10115\nGermany" \
  --product "Wireless Headphones Pro Max" --qty 2 --price 89.99
```

Install runtime dependency if needed:

```bash
python3 -m pip install -r requirements.txt
```

## Workflow

1. Collect the required invoice fields from the user.
2. Run `python3 generate.py --list-stores` if the store name is unclear.
3. Run `python3 generate.py --list-countries` if the country is unclear.
4. Generate XLSX with `generate.py`.
5. If the user asks for PDF, add `--pdf`. PDF export requires LibreOffice or `soffice`.
6. Return the generated file path under this skill's `output/` folder.

## Required Fields

- `store`: store/template name, for example `崔佳佳`, `班威`, `ROB`
- `country`: `德国`, `英国`, `法国`, `意大利`, or `西班牙`
- `order`: Amazon order number
- `invoice-num`: invoice number; if omitted, the script defaults to the order number
- `date`: invoice date
- `delivery`: delivery date
- `customer`: multiline buyer name/address, using `\n` between lines in CLI arguments
- `product`: product description
- `qty`: quantity
- `price`: unit price
- `currency`: optional, defaults to `EUR`

## Credit Notes

Use `--credit-note` for 贷记单:

```bash
python3 generate.py --store "崔佳佳" --country "西班牙" --credit-note \
  --order "404-1890227-2099530" --invoice-num "CN-404-1890227-2099530" \
  --date "2026-04-24" --delivery "2026-02-20" \
  --customer "JG PROFESSIONAL\nCalle Mayor 1\nMadrid\n28001\nSpain" \
  --product "Document Shredder" --qty 1 --price 359.98
```

The script writes credit note prices as negative values automatically.

## JSON Input

For automation, pass a JSON object with the script field names:

```bash
python3 generate.py --json '{"store":"崔佳佳","country":"德国","order_number":"305-7644530-2706742","invoice_number":"RO-305-7644530-2706742","invoice_date":"2026-04-24","delivery_date":"2026-04-20","customer_info":"Test GmbH\nStreet 1\nBerlin\n10115\nGermany","product_description":"Wireless Headphones","quantity":2,"unit_price":89.99,"currency":"EUR"}'
```

Use `"credit_note": true` in JSON for a credit note.

## Package Contents

- `SKILL.md`: skill instructions and trigger metadata
- `generate.py`: portable invoice generator
- `requirements.txt`: Python dependencies
- `templates/`: bundled store templates
- `output/`: generated invoices; do not treat existing files here as source templates
