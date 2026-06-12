#!/usr/bin/env python3
"""
DashoContent Outreach — health monitor / auditor.

Two modes:

  python3 audit.py                # POST-RUN audit (default)
      Reads the repo's own state (output/emails.json, sent-log.json, caches,
      env keys) and reports whether the pipeline is healthy. Meant to run as an
      always() step at the end of the outreach workflow so every run self-reports.

  python3 audit.py --watchdog     # WATCHDOG audit
      Uses the GitHub Actions API (GH_TOKEN) to check whether the scheduled
      "DashoContent Daily Outreach" workflow actually RAN and SUCCEEDED. Catches
      the one failure the post-run audit can't: the run never starting (workflow
      disabled, YAML broken, runner outage). Meant to run from a separate daily
      monitor workflow.

Both modes post a health line to Slack and escalate to a loud ALERT when something
is wrong. Always exits 0 — monitoring must never fail the build it's watching.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

HERE        = Path(__file__).parent
EMAILS_JSON = HERE / "output" / "emails.json"
SENT_LOG    = HERE / "sent-log.json"
SITE_CACHE  = HERE / "site_research.json"
OPENER_CACHE = HERE / "personalized.json"

REPO = "contentdash/contentdash-gtm-sync"
OUTREACH_WORKFLOW = "dashocontent-outreach.yml"


# ─── Slack ────────────────────────────────────────────────────────────────────

def slack(text: str):
    url = os.environ.get("SLACK_WEBHOOK_URL")
    if not url:
        print("  (SLACK_WEBHOOK_URL not set — would have posted:)")
        print(text)
        return
    try:
        subprocess.run(
            ["curl", "-s", "-X", "POST", url,
             "-H", "Content-Type: application/json",
             "-d", json.dumps({"text": text})],
            capture_output=True, timeout=15,
        )
    except Exception as e:
        print(f"  ⚠ Slack post failed: {e}")


def _load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


# ─── Post-run audit ───────────────────────────────────────────────────────────

def post_run_audit() -> int:
    problems, warnings, facts = [], [], []

    emails = _load(EMAILS_JSON, None)
    if not emails:
        # generate.py never produced a queue → the run is broken.
        slack("🚨 *DashoContent Outreach — BROKEN*\n"
              "`output/emails.json` is missing or empty after generate. No emails "
              "could be queued this run. Check the Generate step logs.")
        print("ALERT: emails.json missing/empty")
        return 0

    log = _load(SENT_LOG, {"sent": []})
    sent1 = {e["to"] for e in log.get("sent", []) if e.get("email_num") == 1}

    total     = len(emails)
    already   = sum(1 for s in emails if s["to"] in sent1)
    remaining = total - already
    site_grounded = sum(1 for s in emails if s.get("scan_roast")) + _web_grounded(emails)
    generic = _generic_count(emails)

    facts.append(f"{total} leads in list · {already} contacted · *{remaining} remaining*")

    # Health signals
    if not os.environ.get("ANTHROPIC_API_KEY"):
        problems.append("ANTHROPIC_API_KEY missing → emails fell back to GENERIC template copy")
    if generic > 0:
        warnings.append(f"{generic} email(s) used the generic template (site unreachable / model empty)")
    if remaining == 0:
        warnings.append("List EXHAUSTED — every lead contacted. Add new leads to keep outreach running.")

    # Did this run actually send anything today?
    today = datetime.now(timezone.utc).date().isoformat()
    sent_today = sum(1 for e in log.get("sent", []) if str(e.get("sent_at", ""))[:10] == today)
    facts.append(f"{sent_today} sent today · {len(sent1)} sent all-time")
    if remaining > 0 and sent_today == 0:
        warnings.append(f"{remaining} new lead(s) queued but 0 sent today — check the Send step / Resend key")

    facts.append(f"caches: {len(_load(SITE_CACHE, {}))} sites · {len(_load(OPENER_CACHE, {}))} openers")

    if problems:
        head = "🚨 *DashoContent Outreach — needs attention*"
    elif warnings:
        head = "⚠️ *DashoContent Outreach — running, with notes*"
    else:
        head = "✅ *DashoContent Outreach — healthy*"

    lines = [head, *[f"• {f}" for f in facts]]
    for p in problems:
        lines.append(f"🔴 {p}")
    for w in warnings:
        lines.append(f"🟡 {w}")
    slack("\n".join(lines))
    print("\n".join(lines))
    return 0


def _web_grounded(emails) -> int:
    """Best-effort: count non-scan emails whose opener isn't a known template line."""
    try:
        from generate import SEGMENT_OPENERS
    except Exception:
        return 0
    templ = {v.strip() for seg in SEGMENT_OPENERS.values() for v in seg.values()}
    n = 0
    for s in emails:
        if s.get("scan_roast"):
            continue
        op = _opener(s)
        if op and op not in templ:
            n += 1
    return n


def _generic_count(emails) -> int:
    try:
        from generate import SEGMENT_OPENERS
    except Exception:
        return 0
    templ = {v.strip() for seg in SEGMENT_OPENERS.values() for v in seg.values()}
    return sum(1 for s in emails if not s.get("scan_roast") and _opener(s) in templ)


def _opener(s) -> str:
    lines = s.get("email1_body", "").split("\n")
    i = 2 if len(lines) > 1 and lines[1].startswith("I'm Fleire") else 1
    while i < len(lines) and lines[i].strip() == "":
        i += 1
    return lines[i].strip() if i < len(lines) else ""


# ─── Watchdog ─────────────────────────────────────────────────────────────────

def _gh_api(path: str, token: str):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "dashocontent-outreach-monitor",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def watchdog() -> int:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        print("watchdog: no GH_TOKEN — skipping")
        return 0
    try:
        data = _gh_api(
            f"/repos/{REPO}/actions/workflows/{OUTREACH_WORKFLOW}/runs?per_page=5", token)
    except Exception as e:
        slack(f"⚠️ *Outreach watchdog* couldn't reach the GitHub API: {e}")
        return 0

    runs = data.get("workflow_runs", [])
    if not runs:
        slack("🚨 *Outreach watchdog* — the outreach workflow has NO runs on record. "
              "Is it disabled? Re-enable: `gh workflow enable \"DashoContent Daily Outreach\"`")
        return 0

    latest = runs[0]
    status = latest.get("status")
    concl  = latest.get("conclusion")
    when   = latest.get("created_at", "")
    age_days = _age_days(when)

    if concl == "failure":
        slack(f"🚨 *Outreach run FAILED* ({when[:10]}). "
              f"Last run: {latest.get('html_url','')}\nThe daily send did not go out. Needs a look.")
    elif age_days is not None and age_days > 8:
        slack(f"🚨 *Outreach has not run in {age_days} days* (last: {when[:10]}). "
              f"Schedule may be broken or the workflow disabled.")
    else:
        # Quiet success ping (kept short so it isn't noisy)
        slack(f"✅ *Outreach watchdog* — last run {concl or status} on {when[:10]}.")
    return 0


def _age_days(iso: str):
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except Exception:
        return None


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--watchdog", action="store_true",
                        help="Check the GitHub Actions run history instead of repo state")
    args = parser.parse_args()
    try:
        return watchdog() if args.watchdog else post_run_audit()
    except Exception as e:
        # Monitoring must never fail the build.
        print(f"audit error (non-fatal): {e}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
