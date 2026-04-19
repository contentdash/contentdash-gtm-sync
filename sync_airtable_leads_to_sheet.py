#!/usr/bin/env python3
"""
Poll Airtable inbound leads and upsert them into the DashoContent Pipeline Ops sheet.

Free-path architecture:
  Airtable PAT -> local scheduled script -> Google Apps Script webhook -> Google Sheet

Why this exists:
  - avoids paid Airtable Automations / Run a script
  - deterministic upsert by Airtable record ID
  - defaults new inbound leads onto Charlene's plate
  - does not overwrite Charlene/Fleire's manual pipeline management on existing rows

Usage:
  python3 sync_airtable_leads_to_sheet.py \
    --airtable-pat "$AIRTABLE_PAT" \
    --webhook-url "https://script.google.com/macros/s/.../exec?token=..." \
    --state-path "./airtable_sync_state.json"
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from typing import Dict, List, Tuple
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


BASE_ID = "appdOhglYCp56PrrY"
TABLE_NAME = "Table 1"
SOURCE_SYSTEM = "Airtable"


def clean(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(clean(v) for v in value if clean(v))
    return str(value).strip()


def parse_airtable_date(value: str) -> str:
    if not value:
        return ""
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError:
        return ""
    return parsed.date().isoformat()


def numeric_value(fields: Dict[str, object]) -> str:
    budget_estimate = fields.get("Budget estimate")
    if isinstance(budget_estimate, (int, float)):
        return str(int(budget_estimate) if float(budget_estimate).is_integer() else budget_estimate)
    return ""


def infer_sku(fields: Dict[str, object]) -> str:
    raw_parts = [
        clean(fields.get("Are you interested in any of our off-the-menu services?")),
        clean(fields.get("What brings you here?")),
        clean(fields.get("What was the MAIN PROBLEM that you want to solve with DashoContent?")),
        clean(fields.get("Is there anything else you'd like the DashoContent team to take note of?")),
    ]
    raw = " | ".join(part.lower() for part in raw_parts if part)

    mappings = [
        ("Performance & Search", ["seo", "search", "paid ads", "google ads", "facebook ads", "tiktok ads", "linkedin ads"]),
        ("Video Repurposing", ["video", "podcast"]),
        ("Unlimited Copies", ["copywriting", "web", "email", "blog", "pr", "ebook", "product description"]),
        ("Social Media Growth Pack", ["community outreach", "influencer", "ugc", "social media"]),
        ("Unlimited Graphics", ["logo", "branding", "graphics", "design"]),
        ("Consultation", ["consult", "strategy"]),
    ]
    for sku, keywords in mappings:
        if any(keyword in raw for keyword in keywords):
            return sku
    return "Unsure"


def build_notes(fields: Dict[str, object]) -> str:
    chunks = []
    for label in [
        "Brand Name(s)",
        "Your Email",
        "Your mobile number",
        "Where are you mainly located?",
        "Which industry is your brand in?",
        "What brings you here?",
        "How did you hear about DashoContent?",
        "Referral Source",
        "What is your estimated monthly budget for social media content creation?",
        "Go-live timeline",
        "Decision timeline",
        "What was the MAIN PROBLEM that you want to solve with DashoContent?",
        "Current pain points",
        "How does your brand want to use social and digital media?",
        "How does your brand want to use AI?",
        "Do you currently use AI tools? For which use cases?",
        "Are you interested in any of our off-the-menu services?",
        "Is there anything else you'd like the DashoContent team to take note of?",
    ]:
        value = clean(fields.get(label))
        if value:
            chunks.append(f"{label}: {value}")
    return "\n\n".join(chunks)


def lead_source(fields: Dict[str, object]) -> str:
    heard = clean(fields.get("How did you hear about DashoContent?"))
    referral = clean(fields.get("Referral Source"))
    if heard and referral:
        return f"{heard} / {referral}"[:100]
    return heard or referral or "Airtable site form"


def account_name(fields: Dict[str, object]) -> str:
    company = clean(fields.get("Your company name"))
    brand = clean(fields.get("Brand Name(s)"))
    return company or brand


def source_url(record_id: str) -> str:
    return f"https://airtable.com/{BASE_ID}/{record_id}"


def airtable_records(pat: str) -> List[Dict[str, object]]:
    records: List[Dict[str, object]] = []
    offset = None
    while True:
        url = f"https://api.airtable.com/v0/{BASE_ID}/{quote(TABLE_NAME)}?pageSize=100"
        if offset:
            url += f"&offset={quote(offset)}"
        req = Request(url, headers={"Authorization": f"Bearer {pat}"})
        with urlopen(req, timeout=30) as resp:
            payload = json.load(resp)
        records.extend(payload.get("records", []))
        offset = payload.get("offset")
        if not offset:
            return records


def map_record(record: Dict[str, object]) -> Dict[str, str]:
    fields = record.get("fields", {})
    created_time_raw = clean(record.get("createdTime"))
    return {
        "sourceSystem": SOURCE_SYSTEM,
        "sourceRecordId": clean(record.get("id")),
        "sourceRecordUrl": source_url(clean(record.get("id"))),
        "createdTime": created_time_raw,
        "account": account_name(fields),
        "primaryContact": clean(fields.get("Name")),
        "primaryContactRole": clean(fields.get("Your designation")),
        "companyUrl": clean(fields.get("Your company website:")),
        "leadSource": lead_source(fields),
        "notes": build_notes(fields),
        "likelySku": infer_sku(fields),
        "value": numeric_value(fields),
    }


def load_state(state_path: str) -> Dict[str, str]:
    if not os.path.exists(state_path):
        return {}
    with open(state_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def save_state(state_path: str, state: Dict[str, str]) -> None:
    tmp_path = f"{state_path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp_path, state_path)


def post_to_webhook(webhook_url: str, payload: Dict[str, str]) -> Dict[str, object]:
    last_error = None
    for attempt in range(1, 4):
        request = Request(
            webhook_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=60) as response:
                body = response.read().decode("utf-8", errors="replace")
            if not body.strip():
                raise RuntimeError("Webhook returned empty body")
            return json.loads(body)
        except (HTTPError, URLError, json.JSONDecodeError, RuntimeError) as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(attempt * 2)
            else:
                raise RuntimeError(
                    f"Webhook failed for {payload.get('sourceRecordId')}: {exc}"
                ) from exc
    raise RuntimeError(str(last_error))


def sync(webhook_url: str, airtable_pat: str, state_path: str) -> Tuple[int, int]:
    state = load_state(state_path)
    inserted = 0
    updated = 0
    records = airtable_records(airtable_pat)

    for index, record in enumerate(records, start=1):
        mapped = map_record(record)
        if not mapped["account"]:
            continue
        record_id = mapped["sourceRecordId"]
        fingerprint = json.dumps(mapped, sort_keys=True)
        if state.get(record_id) == fingerprint:
            continue
        result = post_to_webhook(webhook_url, mapped)
        action = result.get("action")
        if action == "updated":
            updated += 1
        elif action == "inserted":
            inserted += 1
        state[record_id] = fingerprint
        save_state(state_path, state)
        if index % 10 == 0:
            print(json.dumps({"processed": index, "inserted": inserted, "updated": updated}), flush=True)

    return inserted, updated


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--airtable-pat", required=True)
    parser.add_argument("--webhook-url", required=True)
    parser.add_argument("--state-path", required=True)
    args = parser.parse_args()

    inserted, updated = sync(args.webhook_url, args.airtable_pat, args.state_path)
    print(json.dumps({"inserted": inserted, "updated": updated}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
