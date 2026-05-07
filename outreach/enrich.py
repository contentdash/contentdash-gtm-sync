#!/usr/bin/env python3
"""
DashoContent Outreach Enricher (free tier)
For each ICP-qualified company, scrapes their website to find/verify real emails.

Usage:
    python3.11 enrich.py                    # enriches all ICP YES companies
    python3.11 enrich.py --limit=10         # first 10 companies only
    python3.11 enrich.py --resume           # skip companies already in enriched.csv
"""

import argparse
import csv
import json
import re
import ssl
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

XLSX        = Path.home() / "Downloads" / "2026 Outreach List - DMAP.xlsx"
OUTPUT_CSV  = Path(__file__).parent / "enriched.csv"
DELAY       = 2   # seconds between requests — be polite

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36"
}

EMAIL_RE = re.compile(r'\b[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}\b')

IGNORE_EMAILS = {
    "example@", "test@", "user@", "email@", "noreply@", "no-reply@",
    "privacy@", "legal@", "dmca@", "abuse@", "support@", "help@",
    "info@sentry", "wixpress.com", "squarespace.com", "wpengine.com",
    "wordpress.com", "cloudflare.com", "schema.org",
}

CONTACT_PATHS = [
    "/contact", "/contact-us", "/about", "/about-us", "/team",
    "/our-team", "/company", "/people", "/leadership",
]

SEGMENT_MAP = {
    "agency":       ["agency", "media", "advertising", "creative", "marketing",
                     "digital", "production", "studio", "pr ", "public relations"],
    "content-team": ["content", "brand", "growth", "communications", "publisher",
                     "editorial", "magazine", "news"],
    "founder":      ["founder", "ceo", "owner", "president", "managing director",
                     "managing partner", "chief executive"],
}


# ─── Excel reader (stdlib only) ───────────────────────────────────────────────

def _xlsx_strings(z):
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    with z.open("xl/sharedStrings.xml") as f:
        tree = ET.parse(f)
    return [
        "".join(t.text or "" for t in si.findall(f".//{{{ns}}}t"))
        for si in tree.findall(f".//{{{ns}}}si")
    ]


def _xlsx_rows(z, sheet_index, strings):
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    with z.open(f"xl/worksheets/sheet{sheet_index}.xml") as f:
        tree = ET.parse(f)
    rows = []
    for row in tree.findall(f".//{{{ns}}}row"):
        cells = []
        for c in row.findall(f"{{{ns}}}c"):
            t = c.get("t", "")
            v = c.find(f"{{{ns}}}v")
            if v is None or v.text is None:
                cells.append("")
            elif t == "s":
                cells.append(strings[int(v.text)])
            else:
                cells.append(v.text)
        rows.append(cells)
    return rows


def load_xlsx():
    if not XLSX.exists():
        print(f"ERROR: {XLSX} not found")
        sys.exit(1)
    z = zipfile.ZipFile(XLSX)
    strings = _xlsx_strings(z)

    def sheet_rows(idx):
        rows = _xlsx_rows(z, idx, strings)
        if not rows:
            return []
        headers = rows[0]
        return [
            {headers[i]: (row[i] if i < len(row) else "") for i in range(len(headers))}
            for row in rows[1:]
            if any(row)
        ]

    stage1 = sheet_rows(1)
    stage2 = sheet_rows(2)
    return stage1, stage2


# ─── Email helpers ────────────────────────────────────────────────────────────

def clean_email(raw):
    m = EMAIL_RE.search(raw or "")
    return m.group(0).lower() if m else ""


def is_junk(email):
    if not email:
        return True
    return any(junk in email for junk in IGNORE_EMAILS)


def infer_segment(role, company):
    text = ((role or "") + " " + (company or "")).lower()
    for seg, keywords in SEGMENT_MAP.items():
        if any(k in text for k in keywords):
            return seg
    return "founder"


def domain_from_url(url):
    if not url:
        return ""
    try:
        parsed = urllib.parse.urlparse(url if "://" in url else "https://" + url)
        return parsed.netloc.lstrip("www.")
    except Exception:
        return ""


# ─── HTTP fetch ───────────────────────────────────────────────────────────────

def fetch(url, timeout=8):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            charset = "utf-8"
            ct = resp.headers.get("Content-Type", "")
            if "charset=" in ct:
                charset = ct.split("charset=")[-1].strip().split(";")[0]
            return resp.read().decode(charset, errors="ignore")
    except Exception:
        return ""


def find_emails_on_page(html, domain):
    found = set()
    for email in EMAIL_RE.findall(html):
        email = email.lower().strip(".,;>\"'")
        if is_junk(email):
            continue
        # Prefer emails on this domain, but collect any real-looking one
        if domain and domain in email:
            found.add(email)
        elif "@" in email and not any(j in email for j in IGNORE_EMAILS):
            found.add(email)
    return found


def scrape_company(base_url, domain, company_name):
    """Visit homepage + common contact paths; return all found emails."""
    all_emails = set()

    if not base_url:
        return all_emails

    if "://" not in base_url:
        base_url = "https://" + base_url

    # Homepage
    html = fetch(base_url)
    if html:
        all_emails.update(find_emails_on_page(html, domain))

    # Contact/about/team subpages
    for path in CONTACT_PATHS:
        if all_emails:  # stop once we found something
            break
        url = base_url.rstrip("/") + path
        html = fetch(url)
        if html:
            all_emails.update(find_emails_on_page(html, domain))
        time.sleep(0.5)

    return all_emails


def pick_best_email(emails, domain, first_name, last_name):
    """Prefer firstname@ or firstname.lastname@ on the company domain."""
    on_domain  = [e for e in emails if domain and domain in e]
    off_domain = [e for e in emails if not domain or domain not in e]

    fn = (first_name or "").lower()
    ln = (last_name or "").lower()

    for pool in (on_domain, off_domain):
        for pattern in (
            f"{fn}@", f"{fn}.{ln}@", f"{fn[0]}{ln}@" if fn and ln else None,
            f"{fn}{ln[0]}@" if fn and ln else None,
        ):
            if not pattern:
                continue
            for e in pool:
                if e.startswith(pattern):
                    return e
        if pool:
            return sorted(pool)[0]  # alphabetical fallback

    return ""


def verify_inferred(inferred_str, domain):
    """
    For an "Inferred: a@x.com, b@x.com, ..." string,
    try each variation against the company website mailto: links.
    """
    raw = re.sub(r"inferred\s*[:\-]", "", inferred_str, flags=re.I)
    variations = [clean_email(v) for v in raw.split(",") if clean_email(v)]
    if not variations:
        return ""

    # Try homepage + contact page, look for any of our variations mentioned
    # (some sites list email in a mailto: href or plain text)
    if not domain:
        return variations[0]

    base = "https://" + domain
    for path in ["", "/contact", "/about"]:
        html = fetch(base + path)
        if not html:
            continue
        for v in variations:
            if v in html:
                return v
        time.sleep(0.3)

    # Fall back to most common pattern: firstname@domain
    return variations[0]


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit",  type=int, default=None)
    parser.add_argument("--resume", action="store_true",
                        help="Skip companies already written to enriched.csv")
    args = parser.parse_args()

    print("Loading Excel...")
    stage1, stage2 = load_xlsx()

    # ICP YES companies from stage-1
    icp_companies = {}
    for row in stage1:
        icp = (row.get("ICP MATCH (Y OR N)") or "").strip().upper()
        name = (row.get("Company Name (Full Official Name)") or "").strip()
        url  = (row.get("Company Url") or "").strip()
        if icp == "YES" and name:
            icp_companies[name.lower()] = {
                "company": name,
                "company_url": url,
            }
    print(f"ICP YES companies: {len(icp_companies)}")

    # Build contact map from stage-2 (all rows, not just real emails)
    contacts_by_company = {}
    for row in stage2:
        company = (row.get("Company") or "").strip()
        if not company:
            continue
        key = company.lower()
        if key not in contacts_by_company:
            contacts_by_company[key] = []
        contacts_by_company[key].append(row)

    # Load already-done companies if resuming
    done = set()
    if args.resume and OUTPUT_CSV.exists():
        with open(OUTPUT_CSV, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                done.add(r.get("company", "").lower())
        print(f"Resuming — {len(done)} companies already done")

    # Decide which companies to process
    targets = [
        v for k, v in icp_companies.items()
        if k not in done
    ]
    if args.limit:
        targets = targets[:args.limit]

    print(f"Processing {len(targets)} companies...\n")

    fieldnames = ["email", "company", "contact_name", "role",
                  "segment", "company_url", "notes", "source"]
    mode = "a" if (args.resume and OUTPUT_CSV.exists()) else "w"
    out_f  = open(OUTPUT_CSV, mode, newline="", encoding="utf-8")
    writer = csv.DictWriter(out_f, fieldnames=fieldnames)
    if mode == "w":
        writer.writeheader()

    total_found = 0

    for i, target in enumerate(targets, 1):
        company     = target["company"]
        company_url = target["company_url"]
        domain      = domain_from_url(company_url)
        key         = company.lower()

        print(f"[{i}/{len(targets)}] {company}  ({domain or company_url})")

        contacts = contacts_by_company.get(key, [])
        rows_written = 0

        for contact in contacts:
            first  = (contact.get("First Name") or "").strip()
            last   = (contact.get("Last Name") or "").strip()
            role   = (contact.get("Role") or "").strip()
            email_raw = (contact.get("Company Email (Real or Inferred variations) ") or
                         contact.get("Company Email (Real or Inferred variations)") or "").strip()

            email  = ""
            source = ""

            if email_raw and "inferred" not in email_raw.lower():
                # Real confirmed email
                email  = clean_email(email_raw)
                source = "confirmed"
            elif email_raw and "inferred" in email_raw.lower():
                # Try to verify from website
                email  = verify_inferred(email_raw, domain)
                source = "verified-inferred" if email else "inferred-fallback"

            if not email or is_junk(email):
                continue

            segment = infer_segment(role, company)
            row = {
                "email":        email,
                "company":      company,
                "contact_name": f"{first} {last}".strip(),
                "role":         role,
                "segment":      segment,
                "company_url":  company_url,
                "notes":        (contact.get("Profile Summary") or "")[:120],
                "source":       source,
            }
            writer.writerow(row)
            out_f.flush()
            rows_written += 1
            total_found  += 1
            print(f"  ✓ {email}  [{source}]")

        # If no contacts in stage-2, scrape the website directly
        if rows_written == 0 and company_url:
            print(f"  Scraping {company_url}...")
            emails = scrape_company(company_url, domain, company)
            if emails:
                email = pick_best_email(emails, domain, "", "")
                if email and not is_junk(email):
                    segment = infer_segment("", company)
                    writer.writerow({
                        "email":        email,
                        "company":      company,
                        "contact_name": "",
                        "role":         "",
                        "segment":      segment,
                        "company_url":  company_url,
                        "notes":        "",
                        "source":       "scraped",
                    })
                    out_f.flush()
                    total_found += 1
                    print(f"  ✓ {email}  [scraped]")
            else:
                print(f"  ✗ No email found")

        time.sleep(DELAY)

    out_f.close()

    print(f"\n{'='*50}")
    print(f"Done. {total_found} emails found → {OUTPUT_CSV}")
    print(f"Run: python3.11 generate.py --leads={OUTPUT_CSV}")


if __name__ == "__main__":
    main()
