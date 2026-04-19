#!/usr/bin/env python3
import json
import re
import sys
import urllib.parse
import urllib.request


ACTIVE_LISTS = {"🚀 TO-DO", "TO-DO", "IN PROGRESS", "PLANNING", "IN REVIEW"}


def get_json(url: str, token: str):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def post_json(url: str, token: str, payload: dict):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def likely_sku(task_text: str) -> str:
    t = task_text.lower()
    if "seo" in t or "link-building" in t or "search" in t:
        return "Performance & Search"
    if "boss" in t:
        return "BOSS"
    if "video repurposing" in t:
        return "Video Repurposing"
    if "brand rules" in t or "qa layer" in t:
        return "Brand Rules + QA Layer"
    return ""


def main():
    if len(sys.argv) != 4:
        print("Usage: enrich_pipeline_from_admin_board.py <admin-board.json> <spreadsheet-id> <access-token>", file=sys.stderr)
        sys.exit(1)

    admin_path, spreadsheet_id, token = sys.argv[1:4]
    with open(admin_path, "r", encoding="utf-8") as f:
        admin = json.load(f)

    list_names = {item["id"]: item["name"] for item in admin.get("lists", [])}
    active_cards = []
    for card in admin.get("cards", []):
        if card.get("closed"):
            continue
        list_name = list_names.get(card.get("idList"), "")
        if list_name not in ACTIVE_LISTS:
            continue
        active_cards.append(
            {
                "name": card.get("name", "").strip(),
                "desc": re.sub(r"\s+", " ", card.get("desc", "")).strip(),
                "list_name": list_name,
            }
        )

    range_name = urllib.parse.quote("Pipeline Ops!A1:Y500", safe="!':")
    values_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{range_name}"
    values = get_json(values_url, token).get("values", [])
    if not values:
        print(json.dumps({"updated_rows": 0, "matches": []}))
        return

    header = values[0]
    rows = values[1:]
    try:
        account_idx = header.index("Account")
        sku_idx = header.index("Likely SKU")
        next_step_idx = header.index("Next Step")
        notes_idx = header.index("Notes")
    except ValueError as e:
        raise SystemExit(f"Missing expected header: {e}")

    current_rows = []
    for i, row in enumerate(rows, start=2):
        padded = row + [""] * (len(header) - len(row))
        account = padded[account_idx].strip()
        if not account:
            continue
        current_rows.append({"row_num": i, "account": account, "norm": normalize(account), "row": padded})

    matches = []
    updates = []
    for current in current_rows:
        related = []
        for card in active_cards:
            hay = normalize(card["name"] + " " + card["desc"])
            acct = current["norm"]
            if len(acct) < 5:
                continue
            if acct in hay:
                related.append(card)
        if not related:
            continue

        next_steps = []
        notes = []
        sku = current["row"][sku_idx]
        for card in related:
            next_steps.append(card["name"])
            note = f"Admin task ({card['list_name']}): {card['name']}"
            if card["desc"]:
                note += f" | {card['desc']}"
            notes.append(note)
            derived_sku = likely_sku(card["name"] + " " + card["desc"])
            if derived_sku:
                sku = derived_sku

        next_step_value = " / ".join(next_steps[:2])
        existing_notes = current["row"][notes_idx]
        merged_notes = existing_notes
        for note in notes[:2]:
            if note not in merged_notes:
                merged_notes = f"{merged_notes} | {note}".strip(" |")

        updates.append(
            {
                "range": f"Pipeline Ops!M{current['row_num']}:S{current['row_num']}",
                "values": [[
                    sku,
                    current["row"][13],  # Founder Needed stays as-is
                    current["row"][14],  # Last Contact Date
                    next_step_value,
                    current["row"][16],  # Next Step Date stays as-is
                    current["row"][17],  # Last Activity Type
                    merged_notes,
                ]],
            }
        )
        matches.append({"account": current["account"], "tasks": [c["name"] for c in related]})

    if updates:
        batch_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchUpdate"
        post_json(batch_url, token, {"valueInputOption": "USER_ENTERED", "data": updates})

    print(json.dumps({"updated_rows": len(updates), "matches": matches}, ensure_ascii=False))


if __name__ == "__main__":
    main()
