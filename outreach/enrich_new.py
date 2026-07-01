#!/usr/bin/env python3
"""
Enrich NEW outbound leads (company + website) into enriched.csv.

Takes a simple CSV of newly-sourced companies and, reusing enrich.py's scraper,
finds a real contact email from each company's own site, dedupes against the
existing enriched.csv (by domain + company), and appends rows in the enriched.csv
schema so generate.py / send.py pick them up automatically on the next run.

Input CSV columns (header required): company, website, segment, notes, source
  segment: one of agency | content-team | founder (optional — inferred if blank)

Usage:
    python3 enrich_new.py --input new_leads.csv
    python3 enrich_new.py --input new_leads.csv --limit 10

Prints a quality breakdown: named-contact emails vs generic (info@/hello@) vs
none-found (which need a decision-maker research pass before they're worth sending).
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

from enrich import scrape_company, domain_from_url, infer_segment

ENRICHED = Path(__file__).parent / "enriched.csv"
FIELDS = ["email", "company", "contact_name", "role", "segment",
          "company_url", "notes", "source"]

GENERIC_LOCALS = {
    "info", "hello", "contact", "hi", "inquiries", "inquiry", "sales",
    "marketing", "admin", "office", "team", "care", "customercare",
    "support", "ph", "mail", "general",
}
# Preference order when several emails are found on a site.
PREFERRED_GENERIC = ["marketing@", "hello@", "info@", "inquiries@", "contact@", "sales@"]


def _is_generic(email: str) -> bool:
    local = email.split("@", 1)[0].lower()
    return local in GENERIC_LOCALS


_BAD_LOCAL = re.compile(r"[^a-z0-9._%+\-]", re.I)          # image/junk locals have odd chars
_IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", "@2x", "@3x")
_JUNK_DOMAINS = {
    "example.com", "company.com", "info.com", "domain.com", "email.com",
    "sentry.io", "ingest.us.sentry.io", "yourdomain.com", "test.com",
}


def _valid_for_company(email: str, site_domain: str) -> bool:
    """An email is only usable if it actually belongs to THIS company: its domain
    must match the company's website domain. Kills image filenames, placeholders,
    telemetry DSNs, and third-party vendor addresses that the raw regex picks up."""
    if "@" not in email or not site_domain:
        return False
    local, _, dom = email.partition("@")
    dom = dom.lower().lstrip("www.")
    site = site_domain.lower().lstrip("www.")
    if any(x in email.lower() for x in _IMG_EXT):
        return False
    if dom in _JUNK_DOMAINS or "." not in dom:
        return False
    if _BAD_LOCAL.search(local):
        return False
    # domain must equal the company site domain (or a subdomain of it)
    return dom == site or dom.endswith("." + site) or site.endswith("." + dom)


def _best_email(emails: set, domain: str) -> str:
    # Only consider emails that genuinely belong to this company's domain.
    pool = sorted(e for e in emails if _valid_for_company(e, domain))
    if not pool:
        return ""
    # 1) a real named (non-generic) address is best
    for e in pool:
        if not _is_generic(e):
            return e
    # 2) otherwise the most useful generic inbox
    for pref in PREFERRED_GENERIC:
        for e in pool:
            if e.startswith(pref):
                return e
    return pool[0]


def _existing() -> tuple[set, set]:
    doms, comps = set(), set()
    if ENRICHED.exists():
        with open(ENRICHED, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                e = (r.get("email") or "")
                if "@" in e:
                    doms.add(e.split("@", 1)[1].lower())
                comps.add((r.get("company") or "").strip().lower())
    return doms, comps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    with open(args.input, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if args.limit:
        rows = rows[:args.limit]

    doms, comps = _existing()
    added, dup, named, generic, none_found = [], 0, 0, 0, []

    for r in rows:
        company = (r.get("company") or "").strip()
        website = (r.get("website") or r.get("company_url") or "").strip()
        seg_hint = (r.get("segment") or "").strip().lower()
        notes = (r.get("notes") or "").strip()
        source = (r.get("source") or "web-research").strip()
        if not company or not website:
            continue

        domain = domain_from_url(website)
        if company.lower() in comps or (domain and domain in doms):
            dup += 1
            continue

        emails = scrape_company(website, domain, company)
        best = _best_email(emails, domain)
        if not best:
            none_found.append((company, website))
            continue

        if _is_generic(best):
            generic += 1
        else:
            named += 1

        seg = seg_hint if seg_hint in ("agency", "content-team", "founder") \
            else infer_segment("", company)
        added.append({
            "email": best,
            "company": company,
            "contact_name": "",
            "role": "",
            "segment": seg,
            "company_url": website,
            "notes": notes or f"Sourced via {source}",
            "source": "web-research-2026-07",
        })
        doms.add(domain)
        comps.add(company.lower())
        print(f"  ✓ {company:<30} {best}")

    if added:
        write_header = not ENRICHED.exists()
        with open(ENRICHED, "a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            if write_header:
                w.writeheader()
            for a in added:
                w.writerow(a)

    print(f"\nAdded {len(added)} leads  ({named} named-contact, {generic} generic inbox)"
          f"  |  {dup} dupes skipped  |  {len(none_found)} no email found")
    if none_found:
        print("No email found (need a decision-maker research pass before sending):")
        for c, u in none_found:
            print(f"  • {c} — {u}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
