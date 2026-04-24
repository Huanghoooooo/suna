#!/usr/bin/env python3
"""
Portable Invoice Generator — 便携式发票生成器

Generates commercial invoices and credit notes by filling data into xlsx templates.
Works on macOS / Linux / Windows. Python 3.9+ required.

Usage:
    python3 generate.py --store "崔佳佳" --country "德国" \
        --order "305-7644530-2706742" --invoice-num "RO-305-7644530-2706742" \
        --date "2026-04-24" --delivery "2026-04-20" \
        --customer "Testkunde GmbH\nMusterstr. 123\nBerlin\n10115\nGermany" \
        --product "Wireless Headphones Pro Max" --qty 2 --price 89.99 \
        --currency EUR

    python3 generate.py --help
"""

import argparse
import os
import shutil
import subprocess
import sys
from copy import copy
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import openpyxl
from openpyxl.utils import get_column_letter

# --- Paths: relative to this script's location ---
SKILL_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = SKILL_DIR / "templates"
OUTPUT_DIR = SKILL_DIR / "output"

# --- Country config ---
COUNTRY_SHEET = {
    "德国": "德国", "germany": "德国",
    "英国": "英国", "uk": "英国",
    "法国": "法国", "france": "法国",
    "意大利": "意大利", "italy": "意大利",
    "西班牙": "西班牙", "spain": "西班牙",
}
DISPLAY_COUNTRIES = ["德国", "英国", "法国", "意大利", "西班牙"]

# --- Store → template auto-detection ---
STORE_TEMPLATES = {}  # populated at runtime by scanning templates/


class InvoiceGenerator:
    def __init__(self):
        self.templates_dir = TEMPLATES_DIR
        self.output_dir = OUTPUT_DIR
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._scan_templates()

    def _scan_templates(self):
        """Auto-discover store templates."""
        STORE_TEMPLATES.clear()
        for f in sorted(self.templates_dir.glob("*.xlsx")):
            name = f.stem.replace("invoice 模板-", "").replace("invoice模板-", "")
            if name and name != f.stem:
                STORE_TEMPLATES[name] = f

    def list_stores(self):
        return sorted(STORE_TEMPLATES.keys())

    def list_countries(self):
        return DISPLAY_COUNTRIES

    def find_template(self, store_name: str) -> Path:
        # exact match
        if store_name in STORE_TEMPLATES:
            return STORE_TEMPLATES[store_name]
        # fuzzy match
        for name, fpath in STORE_TEMPLATES.items():
            if store_name in name or name in store_name:
                return fpath
        raise FileNotFoundError(
            f"No template found for store '{store_name}'.\n"
            f"Available: {self.list_stores()}"
        )

    def find_sheet(self, wb: openpyxl.Workbook, country: str, credit_note: bool = False) -> str:
        if credit_note:
            target = "贷记单"
        else:
            target = COUNTRY_SHEET.get(country, country)

        if target in wb.sheetnames:
            return target
        # fuzzy
        for s in wb.sheetnames:
            if target in s or s in target:
                return s
        raise ValueError(f"Sheet '{target}' not found. Available: {wb.sheetnames}")

    def generate(self, **kwargs) -> Path:
        """
        Generate an invoice.

        Required args:
            store, country, order_number, invoice_date, delivery_date,
            customer_info, product_description, quantity, unit_price

        Optional args:
            invoice_number (defaults to order_number),
            credit_note (bool), currency (default EUR)
        """
        store = kwargs["store"]
        country = kwargs["country"]
        order_number = kwargs["order_number"]
        invoice_number = kwargs.get("invoice_number", order_number)
        credit_note = kwargs.get("credit_note", False)
        currency = kwargs.get("currency", "EUR")
        invoice_date = self._parse_date(kwargs["invoice_date"])
        delivery_date = self._parse_date(kwargs["delivery_date"])
        customer_info = kwargs["customer_info"]
        product_description = kwargs["product_description"]
        quantity = kwargs["quantity"]
        unit_price = kwargs["unit_price"]

        # Copy template
        template_path = self.find_template(store)
        safe_store = store.replace("/", "-").replace(" ", "_")
        safe_order = order_number.replace("/", "-").replace("#", "").strip()
        suffix = "credit_note" if credit_note else "invoice"
        output_xlsx = self.output_dir / f"{safe_store}_{country}_{safe_order}_{suffix}.xlsx"
        shutil.copy(template_path, output_xlsx)

        # Fill
        wb = openpyxl.load_workbook(output_xlsx)
        sheet_name = self.find_sheet(wb, country, credit_note)
        ws = wb[sheet_name]

        if credit_note:
            self._fill_credit_note(ws, invoice_date, customer_info, order_number,
                                   invoice_number, delivery_date,
                                   product_description, quantity, unit_price, currency)
        else:
            self._fill_invoice(ws, invoice_date, customer_info, order_number,
                               invoice_number, delivery_date,
                               product_description, quantity, unit_price, currency)

        wb.save(output_xlsx)
        wb.close()
        return output_xlsx

    # ── Fill helpers ──

    def _safe_set(self, ws, coord, value):
        cell = ws[coord]
        for mr in ws.merged_cells.ranges:
            if cell.coordinate in mr:
                anchor = f"{get_column_letter(mr.min_col)}{mr.min_row}"
                ws[anchor].value = value
                return
        cell.value = value

    def _fill_invoice(self, ws, invoice_date, customer_info, order_number,
                      invoice_number, delivery_date,
                      product_description, quantity, unit_price, currency):
        self._safe_set(ws, "E8", invoice_date)
        self._safe_set(ws, "B9", customer_info)
        self._safe_set(ws, "E9", f"# {order_number}")
        self._safe_set(ws, "B10", invoice_number)
        self._safe_set(ws, "B11", delivery_date)
        self._safe_set(ws, "B13", product_description)
        self._safe_set(ws, "C13", quantity)
        self._safe_set(ws, "D13", unit_price)
        self._safe_set(ws, "E13", "=D13*C13")
        self._safe_set(ws, "E14", "=E13")
        self._safe_set(ws, "D12", f"Unit price({currency})")
        self._safe_set(ws, "E12", f"Total Amount({currency})")

    def _fill_credit_note(self, ws, invoice_date, customer_info, order_number,
                          invoice_number, delivery_date,
                          product_description, quantity, unit_price, currency):
        self._safe_set(ws, "E6", invoice_date)
        self._safe_set(ws, "B7", customer_info)
        self._safe_set(ws, "E7", f"# {order_number}")
        self._safe_set(ws, "B8", invoice_number)
        self._safe_set(ws, "B9", delivery_date)
        self._safe_set(ws, "B11", product_description)
        self._safe_set(ws, "C11", quantity)
        self._safe_set(ws, "D11", -abs(unit_price))
        self._safe_set(ws, "E11", "=(D11)")
        self._safe_set(ws, "E12", "=E11")
        self._safe_set(ws, "D10", f"Unit price({currency})")
        self._safe_set(ws, "E10", f"Total Amount({currency})")

    # ── PDF export ──

    def export_pdf(self, xlsx_path: Path) -> Path:
        pdf_path = xlsx_path.with_suffix(".pdf")
        for cmd in ["libreoffice", "soffice"]:
            try:
                r = subprocess.run(
                    [cmd, "--headless", "--convert-to", "pdf",
                     "--outdir", str(xlsx_path.parent), str(xlsx_path)],
                    capture_output=True, text=True, timeout=30,
                )
                if r.returncode == 0 and pdf_path.exists():
                    return pdf_path
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
        raise RuntimeError(
            "LibreOffice not found. Install it:\n"
            "  macOS:  brew install libreoffice\n"
            "  Linux:  sudo apt install libreoffice-impress\n"
            "  Windows: https://www.libreoffice.org/download/"
        )

    # ── Utils ──

    def _parse_date(self, value) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, date):
            return datetime(value.year, value.month, value.day)
        if isinstance(value, (int, float)):
            return datetime(1899, 12, 30) + __import__("datetime").timedelta(days=int(value))

        s = str(value).strip()
        for fmt in [
            "%Y-%m-%d", "%Y/%m/%d",
            "%d,%B,%Y", "%d,%b,%Y",
            "%d %B %Y", "%d %b %Y",
            "%d %B,%Y", "%d %b,%Y",
            "%B %d, %Y", "%b %d, %Y",
            "%d-%m-%Y", "%d/%m/%Y",
        ]:
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        raise ValueError(f"Cannot parse date: '{value}'")


# ═══════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════

def main():
    p = argparse.ArgumentParser(
        description="便携式发票生成器 — Portable Commercial Invoice Generator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 generate.py --store "崔佳佳" --country "德国" \\
      --order "305-7644530-2706742" --date "2026-04-24" --delivery "2026-04-20" \\
      --customer "Testkunde GmbH\\nMusterstr. 123\\nBerlin\\n10115\\nGermany" \\
      --product "Wireless Headphones Pro Max" --qty 2 --price 89.99

  python3 generate.py --store "崔佳佳" --country "西班牙" --credit-note \\
      --order "404-1890227-2099530" --date "2026-04-24" --delivery "2026-02-20" \\
      --customer "JG PROFESSIONAL\\nCalle Mayor 1\\nMadrid\\n28001\\nSpain" \\
      --product "Document Shredder" --qty 1 --price -359.98

  python3 generate.py --list-stores
  python3 generate.py --list-countries
        """,
    )

    p.add_argument("--store", help="店铺名 (e.g. 崔佳佳, 班威, ROB)")
    p.add_argument("--country", help="国家 (德国/英国/法国/意大利/西班牙)")
    p.add_argument("--order", dest="order_number", help="订单号")
    p.add_argument("--invoice-num", dest="invoice_number", help="发票号 (默认同订单号)")
    p.add_argument("--date", dest="invoice_date", help="开票日期")
    p.add_argument("--delivery", dest="delivery_date", help="发货日期")
    p.add_argument("--customer", dest="customer_info", help="买家信息 (多行用 \\n 分隔)")
    p.add_argument("--product", dest="product_description", help="产品描述")
    p.add_argument("--qty", dest="quantity", type=int, help="数量")
    p.add_argument("--price", dest="unit_price", type=float, help="单价")
    p.add_argument("--currency", default="EUR", help="币种 (默认 EUR)")
    p.add_argument("--credit-note", action="store_true", help="生成贷记单")
    p.add_argument("--pdf", action="store_true", help="同时导出 PDF")
    p.add_argument("--list-stores", action="store_true", help="列出可用店铺")
    p.add_argument("--list-countries", action="store_true", help="列出支持的国家")
    p.add_argument("--json", help="JSON 格式输入 (替代命令行参数)")

    args = p.parse_args()
    gen = InvoiceGenerator()

    if args.list_stores:
        print("Available stores:")
        for s in gen.list_stores():
            print(f"  - {s}")
        return

    if args.list_countries:
        print("Supported countries:")
        for c in gen.list_countries():
            print(f"  - {c}")
        return

    # Build data from args or json
    if args.json:
        import json
        data = json.loads(args.json)
    else:
        missing = []
        for field in ["store", "country", "order_number", "invoice_date",
                       "delivery_date", "customer_info", "product_description"]:
            if not getattr(args, field, None):
                missing.append(field)
        if args.quantity is None:
            missing.append("quantity")
        if args.unit_price is None:
            missing.append("unit_price")
        if missing:
            p.error(f"Missing required fields: {', '.join(missing)}")

        data = {
            "store": args.store,
            "country": args.country,
            "order_number": args.order_number,
            "invoice_number": args.invoice_number or args.order_number,
            "invoice_date": args.invoice_date,
            "delivery_date": args.delivery_date,
            "customer_info": args.customer_info.replace("\\n", "\n"),
            "product_description": args.product_description,
            "quantity": args.quantity,
            "unit_price": args.unit_price,
            "credit_note": args.credit_note,
            "currency": args.currency,
        }

    result = gen.generate(**data)
    print(f"✅ Generated: {result}")

    if args.pdf:
        try:
            pdf = gen.export_pdf(result)
            print(f"✅ PDF exported: {pdf}")
        except RuntimeError as e:
            print(f"⚠️  {e}")


if __name__ == "__main__":
    main()
