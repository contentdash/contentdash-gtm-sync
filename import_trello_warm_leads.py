#!/usr/bin/env python3
import json
import re
import sys
from datetime import datetime, timezone


LIST_TO_STAGE = {
    "Leads": "ICP Fit",
    "VCs & Angels": "ICP Fit",
    "Contacted": "ICP Fit",
    "Discovery": "Discovery Booked",
    "Estimating": "Routed + Pitched",
    "Quoted": "Proposal Out",
    "Closing": "Multi-Threaded",
    "Won": "Kickoff / Won",
    "Lost": "Closed Lost",
    "Deferred": "",
}

DESCRIPTOR_KEYWORDS = {
    "partnership",
    "platform",
    "branding",
    "website migration",
    "event marketing & lead generation",
    "mcn collaboration",
    "nda",
}

COMPANY_HINTS = {
    "inc",
    "corp",
    "corporation",
    "agency",
    "ventures",
    "venture",
    "properties",
    "property",
    "builders",
    "security",
    "consulting",
    "tech",
    "enterprise",
    "regency",
    "city",
    "global",
    "social",
    "paints",
    "home",
    "ai",
    "ph",
    "law",
    "advisors",
    "works",
}


def created_date_from_trello_id(card_id: str) -> str:
    try:
        ts = int(card_id[:8], 16)
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return ""


def clean_text(value: str) -> str:
    value = value or ""
    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", value)
    value = value.replace('"‌"', "").replace("\u200c", "")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def extract_url(desc: str) -> str:
    if not desc:
        return ""
    match = re.search(r"https?://[^\s)>\"]+", desc)
    return match.group(0) if match else ""


def looks_company(text: str) -> bool:
    lowered = text.lower()
    return any(hint in lowered for hint in COMPANY_HINTS) or "." in text


def parse_name(raw_name: str):
    name = raw_name.strip()
    note = ""

    m = re.match(r"^(.*?)\s*\((.*?)\)\s*$", name)
    if m:
        account = m.group(1).strip()
        inside = m.group(2).strip()
        if inside.lower() in DESCRIPTOR_KEYWORDS:
            note = inside
            return account, "", note
        return account, inside, note

    if " - " in name:
        left, right = [part.strip() for part in name.split(" - ", 1)]
        right_lower = right.lower()

        if right_lower in DESCRIPTOR_KEYWORDS:
            return left, "", right

        if "@" in right:
            return left, left, f"Email: {right}"

        if looks_company(left) and not looks_company(right):
            return left, right, note

        if looks_company(right) and not looks_company(left):
            return right, left, note

        return left, right, note

    return name, "", note


def derive_channel(labels, name, list_name):
    label_set = set(labels)
    lowered = name.lower()

    if list_name == "VCs & Angels":
        return "Strategic"
    if "REFERRAL" in label_set:
        return "Partner"
    if "partnership" in lowered or "collaboration" in lowered or "resell" in lowered:
        return "Partner"
    if labels:
        return "Direct"
    return ""


def derive_reply_status(list_name):
    if list_name in {"Leads", "VCs & Angels"}:
        return "No Reply"
    if list_name == "Contacted":
        return "Follow-Up Sent"
    if list_name == "Deferred":
        return "Not Now"
    if list_name == "Lost":
        return "Dead"
    if list_name in {"Discovery", "Estimating", "Quoted", "Closing", "Won"}:
        return "Interested"
    return ""


def derive_booking_flags(list_name):
    qual = ""
    discovery = ""
    if list_name in {"Discovery", "Estimating", "Quoted", "Closing", "Won"}:
        qual = "Y"
        discovery = "Y"
    return qual, discovery


def derive_lead_source(labels):
    return ", ".join(labels)


def build_notes(card, list_name, parsed_note):
    parts = [f"Source board list: {list_name}"]
    labels = [label.get("name", "") for label in card.get("labels", []) if label.get("name")]
    if labels:
        parts.append(f"Labels: {', '.join(labels)}")
    if parsed_note:
        parts.append(f"Name note: {parsed_note}")
    desc = clean_text(card.get("desc", ""))
    if desc:
        parts.append(f"Desc: {desc}")
    if card.get("url"):
        parts.append(f"Trello: {card['url']}")
    return " | ".join(parts)


def main():
    if len(sys.argv) != 2:
        print("Usage: import_trello_warm_leads.py <trello-export.json>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        data = json.load(f)

    lists_by_id = {item["id"]: item["name"] for item in data.get("lists", [])}

    rows = []
    for card in data.get("cards", []):
        if card.get("closed"):
            continue

        list_name = lists_by_id.get(card.get("idList"), "")
        labels = [label.get("name", "") for label in card.get("labels", []) if label.get("name")]
        account, primary_contact, parsed_note = parse_name(card.get("name", ""))
        stage = LIST_TO_STAGE.get(list_name, "")
        qual_booked, discovery_booked = derive_booking_flags(list_name)
        last_contact = (card.get("dateLastActivity") or "")[:10]
        created_date = created_date_from_trello_id(card.get("id", ""))

        row = [
            account,
            primary_contact,
            "",
            extract_url(card.get("desc", "")),
            derive_channel(labels, card.get("name", ""), list_name),
            derive_lead_source(labels),
            "",
            stage,
            "",
            derive_reply_status(list_name),
            qual_booked,
            discovery_booked,
            "Unsure",
            "",
            last_contact,
            "",
            "",
            "",
            build_notes(card, list_name, parsed_note),
            created_date,
        ]
        rows.append(row)

    rows.sort(key=lambda r: ((r[14] or ""), r[0]), reverse=True)
    json.dump({"rows": rows}, sys.stdout)


if __name__ == "__main__":
    main()
