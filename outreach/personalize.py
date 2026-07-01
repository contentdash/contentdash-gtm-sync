#!/usr/bin/env python3
"""
DashoContent Outreach Personalizer
Writes ONE warm, specific opening line per lead, grounded in real data
(role + company + research note + optional brand-scan roast) via the Anthropic API.

Why this exists:
  generate.py used to slot every lead into a fixed segment+role template, so 178/180
  prospects got near-identical copy. This replaces the generic opener with a line that
  reads as personally written — grounded ONLY in facts we actually have, never invented.

Used by generate.py. No-op (returns None) if ANTHROPIC_API_KEY is not set, so the
generator falls back to the legacy template opener cleanly.

Cache: openers are cached by email in personalized.json so re-runs are free and stable.
"""

from __future__ import annotations

import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path

CACHE_PATH = Path(__file__).parent / "personalized.json"
API_URL    = "https://api.anthropic.com/v1/messages"
# The opening line is the hook — the single most important sentence in the email.
MODEL      = "claude-sonnet-4-6"
MAX_TOKENS = 160
MAX_CHARS  = 320  # reject anything longer than ~2 sentences; signals the model rambled

SYSTEM_PROMPT = (
    "You write the FIRST LINE of a cold outreach email for DashoContent, a service that "
    "produces on-brand marketing content (copy, graphics, short-form video) for brands and "
    "agencies, with every draft scored against the brand's own rules before it ships.\n\n"
    "You are given REAL data about the recipient: their role, and — when available — copy "
    "pulled live from their company's own website (their actual positioning, in their words). "
    "Write ONE opening — at most two short sentences, under 35 words — that reads as if it was "
    "personally written for this exact person. Rules:\n"
    "- GROUND IT IN WHAT THEY ACTUALLY DO. When website copy is provided, reference something "
    "concrete and true from it (what they build, who they serve, their niche) so the line could "
    "not have been sent to any other company.\n"
    "- Use ONLY the facts provided. Never invent metrics, awards, funding, news, client names, "
    "or claims that are not in the supplied data. If something isn't stated, don't assert it.\n"
    "- No greeting (it's added separately). No 'I'm Fleire'. No pitch or CTA yet. Just a warm, "
    "specific observation that earns the next line.\n"
    "- Do NOT use the recipient's first name in the line, and never refer to the company by the "
    "recipient's name — refer to the company by its company name or 'your team'.\n"
    "- Sound like a peer who did their homework, not a salesperson. Plain, direct, human. "
    "No buzzwords, no 'I hope this finds you well', no em-dash-stuffed hype, no flattery.\n"
    "- Land naturally on the tension of producing enough on-brand content for an organisation "
    "like theirs.\n"
    "- If no website copy is given and the other facts are thin, write a clean line about their "
    "role at the company and that content-production tension. Do not fabricate to fill the gap.\n"
    "Return ONLY the line itself, no quotes, no preamble."
)


def load_cache() -> dict:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8")


def _call_anthropic(api_key: str, user_prompt: str, retries: int = 3, system: str = SYSTEM_PROMPT) -> str:
    payload = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "temperature": 0.7,
        "system": system,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    data = json.dumps(payload).encode("utf-8")
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            API_URL,
            data=data,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                body = json.load(resp)
            parts = body.get("content", [])
            text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
            return text.strip()
        except urllib.error.HTTPError as exc:
            # 429 / 5xx are transient — back off and retry
            if exc.code in (429, 500, 502, 503, 529) and attempt < retries:
                time.sleep(min(20.0, 2.0 * (2 ** attempt)))
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries:
                time.sleep(2.0 * (2 ** attempt))
                continue
            raise
    return ""


def _build_user_prompt(first_name, company, role, segment, notes, scan_roast, site_text) -> str:
    lines = [
        f"Person first name: {first_name or 'unknown'}",
        f"Role/title: {role or 'unknown'}",
        f"Company: {company}",
        f"Segment: {segment} (agency = runs client work; founder = small brand/owner; "
        f"content-team = in-house marketing team)",
    ]
    if site_text:
        lines.append(
            "LIVE from their own website (their real positioning — use this as the main hook):\n"
            + site_text
        )
    lines.append(f"Research note (secondary): {notes or '(none)'}")
    if scan_roast:
        lines.append(
            f"Brand-scan read of their content's current voice: \"{scan_roast}\" "
            f"(you may reference this as an observation about how their brand comes across)"
        )
    return "\n".join(lines)


def personalize_opener(
    *,
    first_name: str,
    company: str,
    role: str,
    segment: str,
    notes: str,
    scan_roast: str = "",
    site_text: str = "",
    email: str = "",
    api_key: str | None = None,
    cache: dict | None = None,
) -> str | None:
    """Return a personalized opening line, or None to signal the caller should fall
    back to the legacy template opener (no key, empty result, or API failure)."""
    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    # Include a research marker in the cache key so adding live site data
    # regenerates the opener rather than serving a stale notes-only one.
    cache_key = (email or f"{company}|{role}") + ("|web" if site_text else "")
    if cache is not None and cache_key in cache:
        return cache[cache_key] or None

    try:
        line = _call_anthropic(
            api_key,
            _build_user_prompt(first_name, company, role, segment, notes, scan_roast, site_text),
        )
    except Exception as exc:
        print(f"    ⚠ personalize failed for {company} ({role}): {exc}")
        return None

    line = (line or "").strip().strip('"').strip()
    if not line or len(line) > MAX_CHARS:
        return None

    if cache is not None:
        cache[cache_key] = line
    return line


FOLLOWUP_SYSTEM_PROMPT = (
    "You write the body line of a SHORT second-touch follow-up email for DashoContent "
    "(on-brand content production + brand governance). The recipient already got one "
    "personalized email and didn't reply.\n"
    "Write ONE short nudge — a single sentence, under 25 words — that gently re-raises "
    "without being pushy. Rules:\n"
    "- Ground it in what the company actually does (use the website copy if given); make it "
    "feel like a continuation, not a copy-paste of the first email.\n"
    "- Use ONLY the facts provided. Never invent metrics, news, or claims.\n"
    "- No greeting, no 'I'm Fleire', no sign-off, no CTA (those are added separately). "
    "Do not use the recipient's first name.\n"
    "- Warm, low-pressure, human. No 'just circling back' cliché openers, no guilt-tripping.\n"
    "Return ONLY the sentence, no quotes, no preamble."
)


def personalize_followup(
    *,
    first_name: str,
    company: str,
    role: str,
    segment: str,
    notes: str,
    site_text: str = "",
    email: str = "",
    api_key: str | None = None,
    cache: dict | None = None,
) -> str | None:
    """Short personalized nudge for the Email-2 follow-up, or None to fall back to
    the generic follow-up body."""
    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    cache_key = (email or f"{company}|{role}") + "|fu"
    if cache is not None and cache_key in cache:
        return cache[cache_key] or None

    try:
        line = _call_anthropic(
            api_key,
            _build_user_prompt(first_name, company, role, segment, notes, "", site_text),
            system=FOLLOWUP_SYSTEM_PROMPT,
        )
    except Exception as exc:
        print(f"    ⚠ personalize_followup failed for {company} ({role}): {exc}")
        return None

    line = (line or "").strip().strip('"').strip()
    if not line or len(line) > MAX_CHARS:
        return None

    if cache is not None:
        cache[cache_key] = line
    return line
