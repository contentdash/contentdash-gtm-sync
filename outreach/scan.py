#!/usr/bin/env python3
"""
DashoContent Brand Scanner
For each unique company in enriched.csv:
  1. Resolves the real website URL from the LinkedIn company page
  2. Runs the URL through app.dashocontent.com/scan
  3. Extracts: roast, voice dimensions, speaks_to audience
  4. Writes results to scanned.csv

Usage:
    python3.11 scan.py              # scan all companies
    python3.11 scan.py --resume     # skip already-scanned companies
    python3.11 scan.py --limit=5    # first N companies only

Requirements:
    gstack browse skill must be installed
    (~/.claude/skills/gstack/browse/dist/browse)
"""

import argparse
import csv
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ENRICHED_CSV = Path(__file__).parent / "enriched.csv"
SCANNED_CSV  = Path(__file__).parent / "scanned.csv"
BROWSE_BIN   = Path.home() / ".claude/skills/gstack/browse/dist/browse"
SCAN_URL     = "https://app.dashocontent.com/scan"
DELAY        = 5   # seconds between scans


# ─── Browse helper ────────────────────────────────────────────────────────────

def browse(cmd: str) -> str:
    result = subprocess.run(
        [str(BROWSE_BIN)] + cmd.split(),
        capture_output=True, text=True, timeout=60,
    )
    return result.stdout.strip()


def browse_text() -> str:
    return browse("text")


# ─── Step 1: Resolve real website ────────────────────────────────────────────

_SKIP_DOMAINS = {"linkedin.com", "lnkd.in", "facebook.com", "instagram.com",
                 "twitter.com", "x.com", "youtube.com", "tiktok.com"}


def _extract_url(text: str) -> str:
    """Pick the first non-social, non-LinkedIn URL from page text."""
    for m in re.finditer(r'https?://(?:www\.)?([^\s/\"<>]+\.[a-z]{2,})', text):
        domain = m.group(1).split("/")[0].lower()
        if not any(s in domain for s in _SKIP_DOMAINS):
            return m.group(0).split("?")[0].rstrip("/.,")
    return ""


def _google_lookup(company_name: str) -> str:
    """Search Google for the company's official website."""
    query = company_name.replace(" ", "+") + "+official+website"
    try:
        browse(f"goto https://www.google.com/search?q={query}")
        time.sleep(3)
        text = browse_text()
        url = _extract_url(text)
        if url:
            # Skip Google domains
            if "google." not in url and "goo.gl" not in url:
                return url
    except Exception:
        pass
    return ""


def resolve_website(company_url: str, company_name: str = "") -> str:
    """Resolve a real website URL.

    If company_url is a LinkedIn URL, try the LinkedIn page first,
    then fall back to a Google search.
    If company_url is already a real URL, return it as-is.
    """
    if not company_url:
        return _google_lookup(company_name) if company_name else ""

    if "linkedin.com" not in company_url:
        return company_url  # already a real URL

    try:
        browse(f"goto {company_url}")
        time.sleep(5)
        text = browse_text()

        # LinkedIn shows: Website\nhttps://... in the About section
        m = re.search(r'Website\s+(\bhttps?://[^\s\n]+)', text)
        if m:
            url = m.group(1).strip()
            if not any(s in url for s in _SKIP_DOMAINS):
                return url

        # If the page has company content, try extracting any domain
        if "About us" in text or "Company size" in text:
            url = _extract_url(text)
            if url:
                return url

    except Exception as e:
        print(f"    ⚠  LinkedIn fetch error: {e}")

    # LinkedIn blocked or no website listed — fall back to Google
    if company_name:
        print(f"    ↳ LinkedIn blocked — trying Google")
        return _google_lookup(company_name)

    return ""


# ─── Step 2: Run DashoContent brand scan ─────────────────────────────────────

def run_scan(website_url: str) -> dict:
    """
    Submit URL to app.dashocontent.com/scan.
    Successful scan redirects to /scan/{id} — read results there.
    """
    empty = {"roast": "", "voice": "", "speaks_to": ""}

    if not website_url:
        return empty

    try:
        browse(f"goto {SCAN_URL}")
        time.sleep(2)

        # Refresh refs so @e3/@e4 are valid on this page load
        browse("snapshot -i")
        time.sleep(0.3)

        browse(f"fill @e3 {website_url}")
        time.sleep(0.5)
        browse("click @e4")

        # Wait for redirect to /scan/{id} (up to 60s)
        for _ in range(20):
            time.sleep(3)
            current_url = browse("url")
            if "/scan/" in current_url and current_url.rstrip("/") != SCAN_URL.rstrip("/"):
                # Landed on result page — read it
                text = browse_text()
                return parse_scan(text)
            # Check for inline error (scan failed without redirect)
            text = browse_text()
            if "taking longer" in text.lower() or "try again" in text.lower():
                return empty

        print("    ⚠  Scan timed out")
        return empty

    except Exception as e:
        print(f"    ⚠  Scan failed: {e}")
        return empty


def parse_scan(text: str) -> dict:
    """Extract roast, voice dimensions, and speaks_to from /scan/{id} result page."""
    roast     = ""
    voice     = ""
    speaks_to = ""

    # Brand Roast — appears as: Brand Roast "The sculptor shaping..."
    m = re.search(r'Brand Roast\s*["“]([^"”]+)["”]', text)
    if m:
        roast = m.group(1).strip()

    # Voice — text between "Voice" and "Speaks To": "VoiceModernMatureComplex"
    # Split on capital letters to get individual dimensions
    m = re.search(r'Voice(.*?)Speaks To', text, re.DOTALL)
    if m:
        raw = m.group(1).strip()
        parts = re.findall(r'[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*', raw)
        voice = " · ".join(parts) if parts else ""

    # Speaks To — text between "Speaks To" and "Purpose"
    m = re.search(r'Speaks To(.*?)Purpose', text, re.DOTALL)
    if m:
        raw = m.group(1).strip()
        roles = [r.strip() for r in re.split(r'\n|(?<=[a-z])(?=[A-Z])', raw) if r.strip()][:3]
        speaks_to = ", ".join(roles)

    return {"roast": roast, "voice": voice, "speaks_to": speaks_to}


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", action="store_true",
                        help="Skip companies already in scanned.csv")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    if not BROWSE_BIN.exists():
        print(f"ERROR: browse binary not found at {BROWSE_BIN}")
        sys.exit(1)

    # Load unique companies from enriched.csv
    # company → (linkedin_url, email_domain_url)
    _GENERIC_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"}
    with open(ENRICHED_CSV, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    companies = {}  # company → (linkedin_url, email_domain_url)
    for r in rows:
        co = r["company"]
        if co not in companies:
            li_url = r.get("company_url", "")
            email = r.get("email", "")
            domain = email.split("@")[1].strip() if "@" in email else ""
            email_url = f"https://{domain}" if domain and domain not in _GENERIC_DOMAINS else ""
            companies[co] = (li_url, email_url)

    # Load already-scanned companies if resuming
    done = set()
    if args.resume and SCANNED_CSV.exists():
        with open(SCANNED_CSV, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                done.add(r["company"])
        print(f"Resuming — {len(done)} already scanned")

    targets = [(co, li_url, email_url)
               for co, (li_url, email_url) in companies.items()
               if co not in done]
    if args.limit:
        targets = targets[:args.limit]

    print(f"Scanning {len(targets)} companies...\n")

    fieldnames = ["company", "real_url", "roast", "voice", "speaks_to"]
    mode = "a" if (args.resume and SCANNED_CSV.exists()) else "w"
    out_f  = open(SCANNED_CSV, mode, newline="", encoding="utf-8")
    writer = csv.DictWriter(out_f, fieldnames=fieldnames)
    if mode == "w":
        writer.writeheader()

    for i, (company, linkedin_url, email_url) in enumerate(targets, 1):
        print(f"[{i}/{len(targets)}] {company}")

        # Step 1: resolve real website — email domain is most reliable
        if email_url:
            real_url = email_url
            print(f"  ✓ {real_url}  (email domain)")
        else:
            print(f"  Resolving website from LinkedIn...")
            real_url = resolve_website(linkedin_url, company)
            if real_url:
                print(f"  ✓ {real_url}")
        if not real_url:
            print(f"  ✗ No website found — skipping scan")
            writer.writerow({"company": company, "real_url": "", "roast": "",
                             "voice": "", "speaks_to": ""})
            out_f.flush()
            continue

        # Step 2: run brand scan
        print(f"  Scanning {real_url}...")
        result = run_scan(real_url)

        if result["roast"]:
            print(f"  ✓ Roast: \"{result['roast']}\"")
            print(f"    Voice: {result['voice']}")
            print(f"    Speaks to: {result['speaks_to']}")
        else:
            print(f"  ✗ Scan returned no results — will use fallback copy")

        writer.writerow({
            "company":   company,
            "real_url":  real_url,
            "roast":     result["roast"],
            "voice":     result["voice"],
            "speaks_to": result["speaks_to"],
        })
        out_f.flush()
        time.sleep(DELAY)

    out_f.close()
    scanned = sum(1 for r in csv.DictReader(open(SCANNED_CSV)) if r["roast"])
    print(f"\nDone. {scanned}/{len(companies)} companies scanned successfully → {SCANNED_CSV}")
    print(f"Run: python3.11 generate.py --leads=enriched.csv to regenerate emails")


if __name__ == "__main__":
    main()
