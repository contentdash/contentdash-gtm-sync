#!/usr/bin/env python3
"""
DashoContent Outreach — free live web research.

For each lead we already know the company's email domain (e.g. adscholars.com).
This fetches the company's OWN homepage over plain HTTP — no search API, no paid
key, runs headlessly in CI — and extracts their real positioning in their own
words (title + meta description + a visible-text snippet). generate.py feeds that
to the personalizer so the opening line is grounded in what the company actually
does, not a guess.

Results are cached in site_research.json keyed by domain, so re-runs are free and
we only ever hit each site once.
"""

from __future__ import annotations

import json
import re
import urllib.request
import urllib.error
from pathlib import Path

CACHE_PATH = Path(__file__).parent / "site_research.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
READ_CAP    = 400_000   # bytes
SNIPPET_CAP = 700       # chars of visible body text

# Free email providers — no company site behind these.
GENERIC_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
    "aol.com", "proton.me", "protonmail.com", "ymail.com", "live.com",
}

_NAV_NOISE = re.compile(
    r"^(home|about|about us|services|contact|contact us|menu|login|sign in|"
    r"careers|blog|news|products|solutions|skip to content)$", re.I)


def load_cache() -> dict:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8")


def domain_from_email(email: str) -> str:
    if "@" not in (email or ""):
        return ""
    dom = email.split("@", 1)[1].strip().lower()
    return "" if dom in GENERIC_DOMAINS else dom


def _get(url: str) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        with urllib.request.urlopen(req, timeout=12) as r:
            ctype = r.headers.get("Content-Type", "")
            if "html" not in ctype and ctype:
                return None
            return r.read(READ_CAP).decode("utf-8", "replace")
    except (urllib.error.HTTPError, urllib.error.URLError, Exception):
        return None


def _meta(html: str, *names: str) -> str:
    for n in names:
        m = re.search(
            rf'<meta[^>]+(?:name|property)=["\']{re.escape(n)}["\'][^>]+content=["\'](.*?)["\']',
            html, re.I | re.S)
        if not m:
            m = re.search(
                rf'<meta[^>]+content=["\'](.*?)["\'][^>]+(?:name|property)=["\']{re.escape(n)}["\']',
                html, re.I | re.S)
        if m and m.group(1).strip():
            return re.sub(r"\s+", " ", m.group(1)).strip()
    return ""


def _visible_snippet(html: str) -> str:
    body = re.sub(r"<(script|style|noscript|svg|head)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    body = re.sub(r"<[^>]+>", " ", body)
    body = re.sub(r"&[a-z#0-9]+;", " ", body)
    body = re.sub(r"\s+", " ", body).strip()
    # Drop a leading run of bare nav words to get to real copy.
    words = body.split(" ")
    cleaned = [w for w in words if not _NAV_NOISE.match(w)]
    return " ".join(cleaned)[:SNIPPET_CAP]


def fetch_site_research(domain: str) -> dict:
    """Return {title, description, snippet} for a domain, or {} if nothing usable."""
    if not domain:
        return {}
    html = _get(f"https://{domain}") or _get(f"https://www.{domain}")
    if not html:
        return {}

    title = ""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if m:
        title = re.sub(r"\s+", " ", m.group(1)).strip()[:140]

    description = _meta(html, "description", "og:description", "twitter:description")[:300]
    snippet = _visible_snippet(html)

    if not (description or (snippet and len(snippet) > 60) or title):
        return {}
    return {"title": title, "description": description, "snippet": snippet}


def research_for_lead(email: str, cache: dict | None = None) -> dict:
    """Cached lookup by email domain. Returns {} for generic/failed domains."""
    domain = domain_from_email(email)
    if not domain:
        return {}
    if cache is not None and domain in cache:
        return cache[domain] or {}
    result = fetch_site_research(domain)
    if cache is not None:
        cache[domain] = result
    return result


def as_prompt_block(research: dict) -> str:
    """Render research dict as a compact block for the personalizer prompt."""
    if not research:
        return ""
    parts = []
    if research.get("title"):
        parts.append(f"Site title: {research['title']}")
    if research.get("description"):
        parts.append(f"Their own tagline/description: {research['description']}")
    if research.get("snippet"):
        parts.append(f"Homepage copy excerpt: {research['snippet']}")
    return "\n".join(parts)
