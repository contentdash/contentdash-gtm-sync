#!/usr/bin/env python3
"""
Outreach auto-refill — keep the cold-email list from running dry.

When the number of not-yet-emailed leads in enriched.csv drops below a threshold,
promote rows from lead_backlog.csv (a reserve of enriched-ready leads) into
enriched.csv so send.py always has fresh leads to work through. Posts a Slack
note on every refill and escalates to a loud alert when the backlog ITSELF runs
low — that's the signal to run a new sourcing pass (research agents + enrich_new).

lead_backlog.csv uses the SAME columns as enriched.csv.

Usage:
    python3 refill.py                          # check + refill if low
    python3 refill.py --threshold 20 --promote 30
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
ENRICHED = HERE / "enriched.csv"
BACKLOG = HERE / "lead_backlog.csv"
SENT_LOG = HERE / "sent-log.json"
FIELDS = ["email", "company", "contact_name", "role", "segment",
          "company_url", "notes", "source"]

DEFAULT_THRESHOLD = 20   # refill when fewer than this many leads remain unemailed
DEFAULT_PROMOTE = 40     # how many to move from the backlog per refill
BACKLOG_LOW = 25         # warn to source more when the backlog dips below this


def slack(text: str):
    url = os.environ.get("SLACK_WEBHOOK_URL")
    if not url:
        print("(SLACK_WEBHOOK_URL not set — would have posted:)")
        print(text)
        return
    try:
        subprocess.run(
            ["curl", "-s", "-X", "POST", url, "-H", "Content-Type: application/json",
             "-d", json.dumps({"text": text})],
            capture_output=True, timeout=15)
    except Exception as e:
        print(f"  ⚠ Slack post failed: {e}")


def _rows(path: Path) -> list:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _sent_email1() -> set:
    if not SENT_LOG.exists():
        return set()
    try:
        log = json.loads(SENT_LOG.read_text(encoding="utf-8"))
    except Exception:
        return set()
    return {e["to"] for e in log.get("sent", []) if e.get("email_num") == 1}


def _write(path: Path, rows: list, append: bool):
    exists = path.exists()
    mode = "a" if append else "w"
    with open(path, mode, newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if not append or not exists:
            w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in FIELDS})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=int, default=DEFAULT_THRESHOLD)
    ap.add_argument("--promote", type=int, default=DEFAULT_PROMOTE)
    args = ap.parse_args()

    enriched = _rows(ENRICHED)
    sent1 = _sent_email1()
    remaining = sum(1 for r in enriched if r.get("email") and r["email"] not in sent1)

    if remaining >= args.threshold:
        print(f"{remaining} unsent leads — above threshold {args.threshold}, no refill needed")
        return 0

    backlog = _rows(BACKLOG)
    if not backlog:
        slack(f"🚨 *Outreach refill* — only {remaining} unsent leads left and the backlog is EMPTY. "
              f"Run a sourcing pass (research agents → enrich_new.py) to add leads, or outreach stops.")
        print("backlog empty — alerted")
        return 0

    existing = {(r.get("email") or "").lower() for r in enriched if r.get("email")}
    domains = {e.split("@", 1)[1] for e in existing if "@" in e}
    companies = {(r.get("company") or "").strip().lower() for r in enriched}

    promote, keep = [], []
    for r in backlog:
        em = (r.get("email") or "").lower()
        dom = em.split("@", 1)[1] if "@" in em else ""
        co = (r.get("company") or "").strip().lower()
        if (len(promote) < args.promote and em and em not in existing
                and dom not in domains and co not in companies):
            promote.append(r)
            existing.add(em); domains.add(dom); companies.add(co)
        else:
            keep.append(r)

    if not promote:
        slack(f"⚠️ *Outreach refill* — {remaining} unsent, but every backlog lead is already in the "
              f"list. Backlog is effectively dry — run a sourcing pass.")
        return 0

    _write(ENRICHED, promote, append=True)
    _write(BACKLOG, keep, append=False)

    msg = (f"🔄 *Outreach refill* — promoted {len(promote)} leads into the active list "
           f"(was {remaining} unsent). Backlog now holds {len(keep)}.")
    if len(keep) < BACKLOG_LOW:
        msg += (f"\n⚠️ Backlog is low ({len(keep)} left) — schedule a sourcing pass soon so it "
                f"doesn't run out.")
    slack(msg)
    print(msg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
