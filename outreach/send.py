#!/usr/bin/env python3
"""
DashoContent Outreach Sender
Sends personalized emails via Resend as fleire@contentdash.app.

Usage:
    python3 send.py                     # dry-run — previews all unsent, sends nothing
    python3 send.py --batch=5           # dry-run, first 5 only
    python3 send.py --batch=5 --send    # sends batch of 5
    python3 send.py --followup --send   # sends follow-ups for non-responders
    python3 send.py --delay=60 --send   # custom delay between emails (default: 60s)
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

EMAILS_JSON   = Path(__file__).parent / "output" / "emails.json"
SENT_LOG      = Path(__file__).parent / "sent-log.json"
ENV_FILE      = Path(__file__).parent / ".env"
DEFAULT_DELAY = 60
FROM_EMAIL    = "fleire@contentdash.app"
FROM_NAME     = "Fleire"
ALERT_TO      = ["fleire@thirdteam.org", "info@contentdash.app"]


# ─── Config ───────────────────────────────────────────────────────────────────

def load_env():
    if not ENV_FILE.exists():
        return
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ.setdefault(key.strip(), val.strip())


def get_config() -> dict:
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        print("\nERROR: RESEND_API_KEY not set.")
        print(f"Create a .env file at: {ENV_FILE}")
        print(f"See env.example for the required format.\n")
        sys.exit(1)
    return {"RESEND_API_KEY": key}


# ─── Sent Log ─────────────────────────────────────────────────────────────────

def load_sent_log() -> dict:
    if SENT_LOG.exists():
        return json.loads(SENT_LOG.read_text())
    return {"sent": []}


def save_sent_log(log: dict):
    SENT_LOG.write_text(json.dumps(log, indent=2))


def already_sent(log: dict, to: str, email_num: int) -> bool:
    return any(
        e["to"] == to and e["email_num"] == email_num
        for e in log["sent"]
    )


def record_sent(log: dict, lead: dict, email_num: int, subject: str):
    log["sent"].append({
        "to":        lead["to"],
        "company":   lead["company"],
        "email_num": email_num,
        "subject":   subject,
        "sent_at":   datetime.now().isoformat(),
    })


# ─── Resend ───────────────────────────────────────────────────────────────────

def _resend_post(api_key: str, payload: dict):
    result = subprocess.run(
        [
            "curl", "-s", "-X", "POST", "https://api.resend.com/emails",
            "-H", f"Authorization: Bearer {api_key}",
            "-H", "Content-Type: application/json",
            "-d", json.dumps(payload),
        ],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"curl error: {result.stderr}")
    return json.loads(result.stdout)


def send_email(config: dict, to: str, subject: str, body: str):
    result = _resend_post(config["RESEND_API_KEY"], {
        "from":    f"{FROM_NAME} <{FROM_EMAIL}>",
        "to":      [to],
        "subject": subject,
        "text":    body,
    })
    if "id" not in result:
        raise RuntimeError(f"Resend error: {result}")


def send_alert(config: dict, subject: str, body: str):
    try:
        _resend_post(config["RESEND_API_KEY"], {
            "from":    f"DashoContent Outreach <{FROM_EMAIL}>",
            "to":      ALERT_TO,
            "subject": f"[DashoContent Outreach] {subject}",
            "text":    body,
        })
    except Exception as e:
        print(f"  ⚠  Alert email failed: {e}")


# ─── Output ───────────────────────────────────────────────────────────────────

def print_preview(lead: dict, email_num: int, subject: str, body: str, index: int, total: int):
    bar = "─" * 62
    tag = "EMAIL 1 — Cold Outreach" if email_num == 1 else "EMAIL 2 — Follow-up"
    print(f"\n{bar}")
    print(f"  [{index}/{total}]  {tag}")
    print(f"  To:       {lead['to']}")
    print(f"  Company:  {lead['company']}")
    print(f"  Segment:  {lead['segment']}")
    print(f"  Subject:  {subject}")
    print(bar)
    for line in body.split("\n"):
        print(f"  {line}")
    print()


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="DashoContent Outreach Sender")
    parser.add_argument("--send",     action="store_true", help="Actually send (default is dry-run)")
    parser.add_argument("--batch",    type=int, default=None, help="Max emails to process")
    parser.add_argument("--followup", action="store_true",   help="Send Email 2 (follow-ups) instead of Email 1")
    parser.add_argument("--delay",    type=int, default=DEFAULT_DELAY, help=f"Seconds between sends (default: {DEFAULT_DELAY})")
    args = parser.parse_args()

    load_env()
    config = get_config() if args.send else {}

    if not EMAILS_JSON.exists():
        print("ERROR: output/emails.json not found. Run generate.py first.")
        sys.exit(1)

    emails    = json.loads(EMAILS_JSON.read_text())
    log       = load_sent_log()
    email_num = 2 if args.followup else 1
    subj_key  = "email2_subject" if args.followup else "email1_subject"
    body_key  = "email2_body"    if args.followup else "email1_body"

    if args.followup:
        queue = [
            e for e in emails
            if already_sent(log, e["to"], 1) and not already_sent(log, e["to"], 2)
        ]
    else:
        queue = [e for e in emails if not already_sent(log, e["to"], 1)]

    if args.batch:
        queue = queue[:args.batch]

    mode = "SENDING" if args.send else "DRY RUN — no emails will be sent"
    print(f"\n{'='*62}")
    print(f"  DashoContent Outreach — {mode}")
    print(f"  Mode:  {'Email 1 (cold outreach)' if email_num == 1 else 'Email 2 (follow-up)'}")
    print(f"  Queue: {len(queue)} emails")
    if args.send:
        print(f"  From:  {FROM_NAME} <{FROM_EMAIL}>")
        print(f"  Delay: {args.delay}s between sends")
    print(f"{'='*62}")

    if not queue:
        if args.followup:
            print("\n  No follow-ups to send.")
            e1 = sum(1 for e in emails if already_sent(log, e["to"], 1))
            e2 = sum(1 for e in emails if already_sent(log, e["to"], 2))
            print(f"  Email 1 sent: {e1}  |  Email 2 sent: {e2}")
        else:
            print("\n  No unsent emails in queue. All leads may already be contacted.")
        print()
        sys.exit(0)

    sent_count = 0
    failed     = []

    for i, lead in enumerate(queue, 1):
        subject = lead[subj_key]
        body    = lead[body_key]

        print_preview(lead, email_num, subject, body, i, len(queue))

        if not args.send:
            continue

        try:
            send_email(config, lead["to"], subject, body)
            record_sent(log, lead, email_num, subject)
            save_sent_log(log)
            sent_count += 1
            print(f"  ✓  Sent → {lead['to']}")

            if i < len(queue):
                print(f"  Waiting {args.delay}s...\n")
                time.sleep(args.delay)

        except Exception as e:
            failed.append({"to": lead["to"], "error": str(e)})
            print(f"  ✗  Failed → {lead['to']}: {e}")

    total_sent_all = sum(1 for e in emails if already_sent(log, e["to"], 1))
    remaining      = len(emails) - total_sent_all

    print(f"\n{'='*62}")
    if args.send:
        print(f"  Done.  {sent_count} sent today  |  {len(failed)} failed")
        print(f"  Total sent so far: {total_sent_all}/{len(emails)}  |  Remaining: {remaining}")
        if failed:
            print(f"\n  Failed:")
            for f in failed:
                print(f"    {f['to']}: {f['error']}")
        print(f"  Log: {SENT_LOG}")

        if failed and sent_count == 0:
            send_alert(config,
                subject=f"❌ Batch failed — 0/{len(queue)} sent",
                body=f"All {len(queue)} sends failed today.\n\n" +
                     "\n".join(f"  {f['to']}: {f['error']}" for f in failed) +
                     "\n\nCheck send.py logs."
            )
        elif failed:
            send_alert(config,
                subject=f"⚠️ Batch partial — {sent_count} sent, {len(failed)} failed",
                body=f"{sent_count} emails sent today, {len(failed)} failed.\n\n"
                     f"Progress: {total_sent_all}/{len(emails)} leads contacted.\n\n"
                     f"Failed:\n" + "\n".join(f"  {f['to']}: {f['error']}" for f in failed)
            )
        elif remaining == 0:
            send_alert(config,
                subject="✅ All done — full list contacted",
                body=f"All {len(emails)} leads have been contacted.\n\n"
                     f"Sent today: {sent_count}\n"
                     f"Total: {total_sent_all}/{len(emails)}\n\n"
                     f"Time to review replies and run follow-ups:\n"
                     f"  cd outreach && python3 send.py --followup --send"
            )
        else:
            send_alert(config,
                subject=f"✅ Batch sent — {sent_count} today, {remaining} remaining",
                body=f"{sent_count} emails sent today.\n\n"
                     f"Progress: {total_sent_all}/{len(emails)} leads contacted.\n"
                     f"Remaining: {remaining}\n\n"
                     f"Next batch fires next send day at 9am PHT."
            )
    else:
        print(f"  Dry run complete — {len(queue)} emails previewed, nothing sent.")
        print(f"  Add --send to send for real.")
    print(f"{'='*62}\n")


if __name__ == "__main__":
    main()
