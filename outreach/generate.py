#!/usr/bin/env python3
"""
DashoContent Outreach Generator
Reads leads CSV → generates personalized 2-email sequences per segment + role.

Usage:
    python3 generate.py
    python3 generate.py --leads=outreach/enriched.csv

Output:
    output/preview.html   -review all emails before sending
    output/emails.json    -queue file for send.py
"""

import argparse
import csv
import json
import re
from pathlib import Path

LEADS_CSV   = Path(__file__).parent / "leads.csv"
SCANNED_CSV = Path(__file__).parent / "scanned.csv"
OUTPUT_DIR  = Path(__file__).parent / "output"
SENDER_NAME = "Fleire"

# ─── UTM Links ────────────────────────────────────────────────────────────────

UTM_LINKS = {
    "founder":      "https://dashocontent.com/?utm_source=email&utm_medium=outreach&utm_campaign=founder-cold&utm_content=v1",
    "content-team": "https://dashocontent.com/?utm_source=email&utm_medium=outreach&utm_campaign=content-team-cold&utm_content=v1",
    "agency":       "https://dashocontent.com/?utm_source=email&utm_medium=outreach&utm_campaign=agency-cold&utm_content=v1",
}

# ─── Company Name Cleaner ─────────────────────────────────────────────────────

_LEGAL_SUFFIXES = re.compile(
    r"""[,\s]*
    (
      Pte\.?\s*Ltd\.?  | Pvt\.?\s*Ltd\.?  | Co\.?,?\s*Ltd\.? |
      Ltd\.?           | Inc\.?           | Corp\.?          |
      LLC              | L\.L\.C\.        | LLP              |
      S\.A\.           | B\.V\.           | GmbH             |
      Group,?\s+Inc\.? | Holdings         | International    |
      Philippines      | Phil\.?          | Phils\.?
    )
    [,\s]*$
    """,
    re.VERBOSE | re.IGNORECASE,
)
_PARENS = re.compile(r"\s*\(.*?\)\s*$")


def clean_company(name: str) -> str:
    name = _PARENS.sub("", name.strip())
    for _ in range(3):  # handle stacked suffixes
        cleaned = _LEGAL_SUFFIXES.sub("", name).strip().strip(",").strip()
        if cleaned == name:
            break
        name = cleaned
    return name or name


# ─── First Name Extraction ────────────────────────────────────────────────────

GENERIC_PREFIXES = {
    "info", "contact", "office", "support", "hello", "sales", "admin",
    "mail", "team", "studio", "bookings", "booking", "inquiries", "hi",
    "noreply", "no-reply", "help", "service", "services", "business",
    "hey", "marketing", "growth", "ops", "press",
}


def extract_first_name(contact_name: str, email: str = "") -> str:
    if contact_name:
        parts = contact_name.strip().split()
        if parts:
            return parts[0].capitalize()

    if not email:
        return ""
    local = email.split("@")[0].lower().strip()
    base = re.split(r"[._\-+]", local)[0]
    if base in GENERIC_PREFIXES or len(base) < 3:
        return ""

    if "." in local:
        first_part = local.split(".")[0]
        if 3 <= len(first_part) <= 12 and first_part.isalpha():
            return first_part.capitalize()

    if 3 <= len(base) <= 12 and base.isalpha():
        return base.capitalize()

    return ""


# ─── Role Archetype Detection ─────────────────────────────────────────────────

def role_archetype(role: str) -> str:
    r = role.lower()
    if any(k in r for k in ("cmo", "chief marketing", "vp marketing", "vp of marketing",
                             "svp marketing", "head of marketing", "marketing director",
                             "director of marketing", "marketing officer",
                             "digital marketing head", "digital marketing director")):
        return "cmo"
    if any(k in r for k in ("ceo", "founder", "co-founder", "owner", "president",
                             "managing partner", "managing director", "chief executive",
                             "chairman", "chief operating", " coo", "chief revenue",
                             "chief commercial", "chief finance", "chief financial",
                             " cfo", "chief innovation", "general manager", "country manager",
                             "country director", "group director", "board director",
                             "consulting partner")):
        return "c_suite"
    if any(k in r for k in ("cco", "chief creative", "creative director", "creative officer",
                             "creative lead", "creatives lead", "ecd", "executive creative")):
        return "creative_lead"
    if any(k in r for k in ("head of growth", "growth manager", "growth lead",
                             "growth director", "head, growth", "head of digital")):
        return "growth_lead"
    if any(k in r for k in ("account director", "account manager", "business director",
                             "business development", "business unit", "bd director",
                             "client services", "client partner", "client success",
                             "accounts lead", "brand partnerships", "digital director",
                             "campaigns director")):
        return "account_lead"
    if any(k in r for k in ("head of content", "content director", "content manager",
                             "content lead", "editorial", "editor", "copywriter",
                             "content strategist")):
        return "content_lead"
    return "default"


# ─── Role-Aware Opening Lines ─────────────────────────────────────────────────

AGENCY_OPENER = {
    "c_suite":      "Most agencies I talk to have more client briefs than their team can handle.",
    "cmo":          "Client deliverables keep growing. The team doesn't.",
    "creative_lead":"The brief is usually not the problem. Getting the volume out is.",
    "account_lead": "Selling the work is one thing. Producing it fast enough is another.",
    "growth_lead":  "New business is moving. Content production usually isn't.",
    "content_lead": "Agencies put a lot on content leads. Quality and volume, both at the same time.",
    "default":      "More client work, same team. At some point it breaks.",
}

FOUNDER_OPENER = {
    "c_suite":      "Most founders I talk to are still doing most of the writing themselves.",
    "cmo":          "You know what needs to go out. You just don't always have time to write it.",
    "growth_lead":  "Content is on the plan. Actually publishing it consistently is another story.",
    "creative_lead":"The ideas are there. The time to write them usually isn't.",
    "account_lead": "Business dev takes priority. Content gets what's left.",
    "content_lead": "Small team doing content means you're always choosing between less or worse.",
    "default":      "Most people I talk to have good content ideas. Writing all of them is the hard part.",
}

CONTENT_TEAM_OPENER = {
    "cmo":          "Most in-house teams have the strategy. Writing enough content is where it slows down.",
    "c_suite":      "Most in-house content programs run fine until you try to publish more.",
    "content_lead": "Your team knows the brand. The limit is how much they can actually write.",
    "growth_lead":  "Content works as a channel. But only if you can publish enough of it.",
    "creative_lead":"Creative teams do the quality work. Volume is always the trade-off.",
    "account_lead": "Teams with a lot of stakeholders spend more time on revisions than writing.",
    "default":      "In-house teams usually pick one: publish more, or keep quality up.",
}

SEGMENT_OPENERS = {
    "agency":       AGENCY_OPENER,
    "founder":      FOUNDER_OPENER,
    "content-team": CONTENT_TEAM_OPENER,
}


# ─── Subject Line Generator ───────────────────────────────────────────────────

def possessive(name: str) -> str:
    return f"{name}'" if name.endswith("s") else f"{name}'s"


def generate_scan_subject(first_name: str, company: str, roast: str) -> str:
    """Subject for scan-personalized emails -quotes the roast to signal real research."""
    if first_name:
        return f'{first_name} - "{roast}"'
    return f'"{roast}" - {company}'


def generate_subject(first_name: str, company: str, segment: str, archetype: str) -> str:
    fn = first_name
    co = company
    cop = possessive(co)

    if archetype == "c_suite":
        if segment == "agency":
            return f"{fn} - who's producing for {cop} clients?" if fn else f"Who's producing for {cop} clients?"
        elif segment == "content-team":
            return f"{fn} - content output at {co}" if fn else f"Content output at {co}"
        else:
            return f"{fn} - who's writing for {co}?" if fn else f"Who's writing for {co}?"

    elif archetype == "cmo":
        if segment == "agency":
            return f"{fn} - content for {cop} clients" if fn else f"Content for {cop} clients"
        else:
            return f"{fn} - {cop} content output" if fn else f"{cop} content output"

    elif archetype == "creative_lead":
        if segment == "agency":
            return f"{fn} - volume vs. quality at {co}" if fn else f"Volume vs. quality at {co}"
        else:
            return f"{fn} - content output at {co}" if fn else f"Content output at {co}"

    elif archetype == "account_lead":
        if segment == "agency":
            return f"{fn} - content for {cop} clients" if fn else f"Content for {cop} clients"
        else:
            return f"{fn} - content at {co}" if fn else f"Content at {co}"

    elif archetype == "growth_lead":
        return f"{fn} - content output at {co}" if fn else f"Content output at {co}"

    elif archetype == "content_lead":
        return f"{fn} - content output at {co}" if fn else f"Content output at {co}"

    else:  # default
        if segment == "agency":
            return f"{fn} - content for {cop} clients" if fn else f"Content for {cop} clients"
        elif segment == "founder":
            return f"{fn} - who's writing for {co}?" if fn else f"Who's writing for {co}?"
        else:
            return f"{fn} - content at {co}" if fn else f"Content at {co}"


# ─── Email Templates ──────────────────────────────────────────────────────────

BODY_TEMPLATE = """{greeting}
{intro}
{opener}

{differentiator}

{role_value_line}

Want me to run a free brand voice audit on {company}? I'll scan your content and send you the results. Takes two minutes.

- {sender}
DashoContent"""

FOLLOWUP_SUBJECT = "Re: {original_subject}"

FOLLOWUP_BODY = """{greeting}

Just following up on my last email.

Still happy to run that free brand voice audit on {company} if you're open to it. I'll scan your content and send the results over.

- {sender}
DashoContent"""

SEGMENT_PHRASES = {
    "founder":      "founders and small teams",
    "content-team": "in-house content teams",
    "agency":       "agencies",
}

SEGMENT_DIFFERENTIATOR = {
    "agency": (
        "Unlike just adding a writer, DashoContent gives each client brand its own workspace "
        "with its own rules. Every draft is scored against them before it goes to the client. "
        "Revision loops stop being the default. Agencies using it report 60% fewer revision "
        "rounds and 40% faster delivery."
    ),
    "founder": (
        "Unlike hiring a writer, DashoContent builds your brand rules into the system first. "
        "Your voice, your audience, what you never say. Every draft is scored against them before "
        "you see it. The output sounds like you, not like a generic post."
    ),
    "content-team": (
        "Unlike just adding a writer, every draft is scored against your brand rules before your "
        "team reviews it. You get fewer revision rounds, faster approvals, and the same quality "
        "standard every time."
    ),
}

ROLE_VALUE_LINES = {
    "c_suite":      "You decide what goes out. We write it.",
    "cmo":          "You own the strategy. We do the writing.",
    "creative_lead":"You keep the creative direction. We handle the output.",
    "growth_lead":  "You plan the content. We produce it.",
    "account_lead": "Your team handles the clients. We handle the writing.",
    "content_lead": "Your team sets the standard. We multiply what they can ship.",
    "default":      "You decide the direction. We handle the writing.",
}


# ─── Scan Data ────────────────────────────────────────────────────────────────

def load_scan_data() -> dict:
    """Return dict keyed by company name for rows that have a roast."""
    if not SCANNED_CSV.exists():
        return {}
    with open(SCANNED_CSV, newline="", encoding="utf-8") as f:
        return {r["company"]: r for r in csv.DictReader(f) if r.get("roast")}


SCAN_BODY_TEMPLATE = """{greeting}
{intro}
I ran a quick scan on {company}. Your brand is coming across as "{roast}." {voice}.

{scan_context_line}

{differentiator_short}

Want me to send you the full scan results for {company}?

- {sender}
DashoContent"""

SCAN_CONTEXT_LINE = {
    "agency":       "The positioning is strong. But if the content going out to clients isn't hitting that mark consistently, the gap shows in every pitch.",
    "founder":      "Strong positioning. But it only holds if your content is consistently delivering on it.",
    "content-team": "That's solid brand clarity. The risk is drift, especially when output volume goes up.",
}

SCAN_DIFFERENTIATOR_SHORT = {
    "agency":       "DashoContent builds each client brand's rules into the system. Every draft is scored before it goes out. Agencies report 60% fewer revision rounds and 40% faster delivery.",
    "founder":      "DashoContent builds your brand rules into the system first. Every draft is scored against your actual voice before you see it.",
    "content-team": "DashoContent scores every draft against your brand rules before your team reviews it. Fewer revision rounds, same quality standard every time.",
}

SCAN_FOLLOWUP_BODY = """{greeting}

Following up. Still happy to send you the full {company} scan if you're curious.

- {sender}
DashoContent"""


# ─── Segment Inference ────────────────────────────────────────────────────────

def infer_segment(row: dict) -> str:
    segment = row.get("segment", "").strip().lower()
    if segment in ("founder", "content-team", "agency"):
        return segment

    role    = (row.get("role", "") or row.get("contact_role", "")).lower()
    company = row.get("company", "").lower()

    if any(k in role for k in ("founder", "ceo", "owner", "solo", "head of")):
        return "founder"
    if any(k in role for k in ("agency", "account manager", "client")):
        return "agency"
    if any(k in company for k in ("agency", "media", "studio", "creative")):
        return "agency"
    if any(k in role for k in ("content", "marketing", "growth", "brand", "communications")):
        return "content-team"

    return "founder"


# ─── Generator ────────────────────────────────────────────────────────────────

def generate_sequence(row: dict, scan_data: dict | None = None) -> dict | None:
    email = (row.get("email") or "").strip()
    if not email or "@" not in email:
        return None

    company_raw  = (row.get("company") or row.get("account") or "").strip()
    contact_name = (row.get("contact_name") or row.get("primary_contact") or "").strip()
    company_url  = (row.get("company_url") or row.get("url") or "").strip()
    role         = (row.get("role") or row.get("contact_role") or "").strip()
    notes        = (row.get("notes") or "").strip()

    if not company_raw:
        return None

    company   = clean_company(company_raw)
    segment   = infer_segment(row)
    archetype = role_archetype(role)
    first_name = extract_first_name(contact_name, email)
    greeting  = f"Hi {first_name}," if first_name else "Hi,"

    scan = (scan_data or {}).get(company_raw) or (scan_data or {}).get(company)

    if scan and scan.get("roast"):
        subject = generate_scan_subject(first_name, company, scan["roast"])
    else:
        subject = generate_subject(first_name, company, segment, archetype)
    followup_subject = FOLLOWUP_SUBJECT.format(original_subject=subject)

    intro = "I'm Fleire. I founded DashoContent.\n" if archetype == "c_suite" else ""

    if scan and scan.get("roast"):
        body = SCAN_BODY_TEMPLATE.format(
            greeting=greeting,
            intro=intro,
            company=company,
            roast=scan["roast"],
            voice=scan["voice"],
            scan_context_line=SCAN_CONTEXT_LINE[segment],
            differentiator_short=SCAN_DIFFERENTIATOR_SHORT[segment],
            sender=SENDER_NAME,
        )
        followup_body = SCAN_FOLLOWUP_BODY.format(
            greeting=greeting,
            company=company,
            sender=SENDER_NAME,
        )
    else:
        opener = SEGMENT_OPENERS[segment].get(archetype) or SEGMENT_OPENERS[segment]["default"]
        role_value_line = ROLE_VALUE_LINES.get(archetype, ROLE_VALUE_LINES["default"])
        differentiator = SEGMENT_DIFFERENTIATOR[segment]
        body = BODY_TEMPLATE.format(
            greeting=greeting,
            intro=intro,
            opener=opener,
            differentiator=differentiator,
            role_value_line=role_value_line,
            company=company,
            sender=SENDER_NAME,
        )
        followup_body = FOLLOWUP_BODY.format(
            greeting=greeting,
            segment_phrase=SEGMENT_PHRASES[segment],
            company=company,
            sender=SENDER_NAME,
        )

    return {
        "segment":        segment,
        "archetype":      archetype,
        "to":             email,
        "company":        company,
        "company_raw":    company_raw,
        "contact_name":   contact_name,
        "first_name":     first_name,
        "role":           role,
        "company_url":    company_url,
        "notes":          notes,
        "scan_roast":     scan["roast"] if scan and scan.get("roast") else "",
        "email1_subject": subject,
        "email1_body":    body,
        "email1_utm":     UTM_LINKS[segment],
        "email2_subject": followup_subject,
        "email2_body":    followup_body,
    }


# ─── HTML Preview ─────────────────────────────────────────────────────────────

SEGMENT_COLORS = {
    "founder":      "#818cf8",
    "content-team": "#34d399",
    "agency":       "#fbbf24",
}

ARCHETYPE_LABELS = {
    "c_suite":      "C-Suite",
    "cmo":          "CMO/VP Mktg",
    "creative_lead":"Creative Lead",
    "growth_lead":  "Growth Lead",
    "account_lead": "Account Lead",
    "content_lead": "Content Lead",
    "default":      "—",
}


def render_html(sequences: list[dict]) -> str:
    cards = ""
    for s in sequences:
        color      = SEGMENT_COLORS.get(s["segment"], "#9ca3af")
        body1_html = s["email1_body"].replace("\n", "<br>")
        body2_html = s["email2_body"].replace("\n", "<br>")
        name_tag   = f" &nbsp;·&nbsp; Hi {s['first_name']}" if s["first_name"] else ""
        role_tag   = f" &nbsp;·&nbsp; {s['role']}" if s["role"] else ""
        arch_label = ARCHETYPE_LABELS.get(s["archetype"], s["archetype"])
        scan_badge = ' &nbsp;<span class="badge scan">⚡ scan</span>' if s.get("scan_roast") else ""
        cards += f"""
        <div class="card">
          <div class="card-header">
            <div class="meta">
              <span class="badge" style="background:{color}">{s['segment']}</span>
              <span class="badge arch">{arch_label}</span>{scan_badge}
              <span class="business">{s['company']}</span>{role_tag}
            </div>
            <div class="to">To: <strong>{s['to']}</strong>{name_tag}</div>
          </div>
          <div class="email-block">
            <div class="email-label">Email 1 -Cold Outreach</div>
            <div class="subject">Subject: {s['email1_subject']}</div>
            <div class="body">{body1_html}</div>
            <div class="utm-note">UTM: {s['email1_utm']}</div>
          </div>
          <div class="email-block followup">
            <div class="email-label">Email 2 -Follow-up (send 3–5 days after if no reply)</div>
            <div class="subject">Subject: {s['email2_subject']}</div>
            <div class="body">{body2_html}</div>
          </div>
        </div>"""

    total   = len(sequences)
    founder = sum(1 for s in sequences if s["segment"] == "founder")
    team    = sum(1 for s in sequences if s["segment"] == "content-team")
    agency  = sum(1 for s in sequences if s["segment"] == "agency")

    # Archetype breakdown
    arch_counts = {}
    for s in sequences:
        k = s["archetype"]
        arch_counts[k] = arch_counts.get(k, 0) + 1
    arch_rows = "".join(
        f'<tr><td>{ARCHETYPE_LABELS.get(k, k)}</td><td>{v}</td></tr>'
        for k, v in sorted(arch_counts.items(), key=lambda x: -x[1])
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>DashoContent Outreach Preview -{total} leads</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
            background: #0f172a; color: #e2e8f0; padding: 2rem; }}
    h1 {{ font-size: 1.4rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem; }}
    .subtitle {{ color: #64748b; font-size: 0.85rem; margin-bottom: 2rem; }}
    .stats {{ display: flex; gap: 1.5rem; margin-bottom: 2rem; flex-wrap: wrap; align-items: flex-start; }}
    .stat {{ background: #1e293b; border-radius: 8px; padding: 0.75rem 1.25rem; }}
    .stat-num {{ font-size: 1.5rem; font-weight: 700; color: #fff; }}
    .stat-label {{ font-size: 0.75rem; color: #64748b; margin-top: 0.1rem; }}
    .arch-table {{ background: #1e293b; border-radius: 8px; padding: 0.75rem 1.25rem; }}
    .arch-table table {{ border-collapse: collapse; font-size: 0.8rem; }}
    .arch-table td {{ padding: 0.15rem 0.75rem 0.15rem 0; color: #94a3b8; }}
    .arch-table td:last-child {{ color: #fff; font-weight: 600; text-align: right; }}
    .card {{ background: #1e293b; border-radius: 12px; margin-bottom: 1.5rem;
             border: 1px solid #334155; overflow: hidden; }}
    .card-header {{ padding: 1rem 1.25rem; border-bottom: 1px solid #334155;
                    display: flex; justify-content: space-between; align-items: center;
                    flex-wrap: wrap; gap: 0.5rem; }}
    .meta {{ display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }}
    .business {{ font-weight: 600; color: #f1f5f9; }}
    .to {{ font-size: 0.85rem; color: #94a3b8; }}
    .badge {{ font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.6rem;
              border-radius: 999px; color: #0f172a; }}
    .badge.arch {{ background: #334155; color: #94a3b8; }}
    .badge.scan {{ background: #064e3b; color: #6ee7b7; }}
    .email-block {{ padding: 1.25rem; }}
    .email-block.followup {{ background: #0f172a; border-top: 1px solid #1e293b; }}
    .email-label {{ font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
                    letter-spacing: 0.08em; color: #475569; margin-bottom: 0.75rem; }}
    .subject {{ font-size: 0.9rem; font-weight: 600; color: #c7d2fe;
                margin-bottom: 0.75rem; padding-bottom: 0.5rem;
                border-bottom: 1px solid #1e293b; }}
    .body {{ font-size: 0.875rem; color: #94a3b8; line-height: 1.7; }}
    .utm-note {{ margin-top: 0.75rem; font-size: 0.72rem; color: #475569;
                 font-family: monospace; word-break: break-all; }}
  </style>
</head>
<body>
  <h1>DashoContent -Outreach Preview</h1>
  <p class="subtitle">Review all emails before sending. Nothing has been sent.</p>
  <div class="stats">
    <div class="stat"><div class="stat-num">{total}</div><div class="stat-label">Total leads</div></div>
    <div class="stat"><div class="stat-num">{founder}</div><div class="stat-label">Founders</div></div>
    <div class="stat"><div class="stat-num">{team}</div><div class="stat-label">Content teams</div></div>
    <div class="stat"><div class="stat-num">{agency}</div><div class="stat-label">Agencies</div></div>
    <div class="arch-table">
      <table><tr><td colspan="2" style="color:#475569;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;padding-bottom:0.4rem">Archetypes</td></tr>
      {arch_rows}</table>
    </div>
  </div>
  {cards}
</body>
</html>"""


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--leads", default=str(LEADS_CSV), help="Path to leads CSV")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(exist_ok=True)

    leads_path = Path(args.leads)
    if not leads_path.exists():
        print(f"ERROR: Leads file not found: {leads_path}")
        print(f"Columns expected: email, company, contact_name, role, segment, company_url, notes")
        raise SystemExit(1)

    with open(leads_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    scan_data = load_scan_data()
    if scan_data:
        print(f"✓ Scan data loaded for {len(scan_data)} companies")
    else:
        print(f"  No scanned.csv found -using archetype copy for all leads")

    sequences = []
    skipped   = []
    seen_emails = set()

    for row in rows:
        result = generate_sequence(row, scan_data)
        if result:
            if result["to"] in seen_emails:
                continue
            seen_emails.add(result["to"])
            sequences.append(result)
        else:
            skipped.append(row)

    segment_order = {"founder": 0, "content-team": 1, "agency": 2}
    sequences.sort(key=lambda s: (segment_order.get(s["segment"], 9), s["company"]))

    (OUTPUT_DIR / "preview.html").write_text(render_html(sequences), encoding="utf-8")
    (OUTPUT_DIR / "emails.json").write_text(json.dumps(sequences, indent=2, ensure_ascii=False), encoding="utf-8")

    scan_personalized = sum(1 for s in sequences if s.get("scan_roast"))
    print(f"✓ {len(sequences)} sequences generated  ({len(skipped)} skipped — missing email or company)")
    print(f"  {scan_personalized} scan-personalized  |  {len(sequences) - scan_personalized} archetype fallback")
    print(f"\nOutputs:")
    print(f"  {OUTPUT_DIR}/preview.html   ← open this to review")
    print(f"  {OUTPUT_DIR}/emails.json")
    print(f"\nBreakdown:")
    for seg in ("founder", "content-team", "agency"):
        count = sum(1 for s in sequences if s["segment"] == seg)
        if count:
            print(f"  {seg:>14}: {count}")

    print(f"\nArchetypes:")
    arch_counts: dict[str, int] = {}
    for s in sequences:
        arch_counts[s["archetype"]] = arch_counts.get(s["archetype"], 0) + 1
    for k, v in sorted(arch_counts.items(), key=lambda x: -x[1]):
        print(f"  {ARCHETYPE_LABELS.get(k, k):>16}: {v}")


if __name__ == "__main__":
    main()
