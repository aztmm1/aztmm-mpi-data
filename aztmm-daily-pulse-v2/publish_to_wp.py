"""
WordPress REST API publish shim.

Called by the GH Actions workflow after run_daily_pulse.py emits a payload JSON.
Reads:
    WP_SITE         e.g. "aztmm.com"
    WP_USERNAME     e.g. "nikhil"
    WP_APP_PASSWORD WordPress application password (NOT account password)

If the payload root is `{"_action": "wpcom.publish_post", "payload": {...}}`
or just `{...}` (the bare post payload), both shapes are handled.

Featured-image policy: every published post defaults to the AZTMM HLDGS
seal (media id 1033). Payload can override via featured_media key.

Belt-and-suspenders vendor-leak guard:
    Before the WP REST POST, the post content is scanned for vendor names,
    admin-path leaks, and other "should never appear publicly" patterns.
    If anything matches, we refuse to publish and exit with code 2 so the
    workflow can still preserve the payload for manual review.
"""

from __future__ import annotations

import json
import os
import re
import sys

import requests

DEFAULT_SITE = "aztmm.com"
DEFAULT_FEATURED_MEDIA = 1033  # AZTMM HLDGS green seal


# -----------------------------------------------------------------------------
# Vendor-leak linter
# -----------------------------------------------------------------------------
# Each entry is (label, compiled_regex). `re.I` is used unless the term is
# legitimately case-sensitive (e.g. "BBS" — we want the all-caps acronym, not
# random substrings in words like "abbess"). For "Trade Alert" we require the
# capitalized vendor-product form so generic "trade alert" copy doesn't trip.
_VENDOR_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("Unusual Whales",        re.compile(r"\bunusual\s+whales\b", re.I)),
    ("BlackBoxStocks",        re.compile(r"\bblackbox\s*stocks\b", re.I)),
    ("BlackBox",              re.compile(r"\bblack\s*box\b", re.I)),
    ("BBS (acronym)",         re.compile(r"\bBBS\b")),  # case-sensitive
    ("FlowAlgo",              re.compile(r"\bflow\s*algo\b", re.I)),
    ("Cheddar Flow",          re.compile(r"\bcheddar\s*flow\b", re.I)),
    ("Cheddar",               re.compile(r"\bcheddar\b", re.I)),
    # "Trade Alert" — vendor product. Match either the registered-mark form,
    # the proper-noun two-word form preceded by quotes / from / by / via, or
    # an explicit lowercase mention of the vendor "trade-alert.com".
    ("Trade Alert (vendor)",  re.compile(r"Trade Alert\s*®")),
    ("Trade Alert (vendor)",  re.compile(r"\btrade[\- ]alert\.com\b", re.I)),
    ("Trade Alert (vendor)",  re.compile(r"\b(?:from|by|via|courtesy of|source[:\- ])\s+Trade Alert\b")),
    ("Settings -> (admin)",   re.compile(r"Settings\s*(?:->|→|&rarr;|&#8594;)", re.I)),
    ("wp-admin URL leak",     re.compile(r"\bwp[\-‐‑]admin\b", re.I)),
    ("polygon.io",            re.compile(r"\bpolygon\.io\b", re.I)),
]


def lint_for_vendor_leaks(content: str) -> list[str]:
    """
    Scan post content for blacklisted vendor names / admin-path leaks.

    Returns a list of human-readable error strings (one per hit). Empty list
    means the content is clean and safe to publish.
    """
    if not content:
        return []

    hits: list[str] = []
    seen: set[tuple[str, int, int]] = set()  # de-dupe across overlapping patterns

    lines = content.splitlines() or [content]

    for label, pat in _VENDOR_PATTERNS:
        for m in pat.finditer(content):
            start = m.start()
            # Locate (line_no, col) for the match
            line_no = content.count("\n", 0, start) + 1
            line_start = content.rfind("\n", 0, start) + 1
            col = start - line_start + 1
            key = (label, line_no, col)
            if key in seen:
                continue
            seen.add(key)
            # Snippet: the matched line, trimmed to ~140 chars around the hit
            line_text = lines[line_no - 1] if line_no - 1 < len(lines) else m.group(0)
            snippet = line_text.strip()
            if len(snippet) > 160:
                # Center on the match
                local_col = max(col - line_start, 0)
                a = max(0, local_col - 60)
                b = min(len(snippet), a + 160)
                snippet = ("..." if a > 0 else "") + snippet[a:b] + ("..." if b < len(snippet) else "")
            hits.append(
                f"  [{label}] line {line_no} col {col}: matched {m.group(0)!r} -> {snippet!r}"
            )
    return hits


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: publish_to_wp.py PAYLOAD.json", file=sys.stderr)
        return 1
    with open(sys.argv[1]) as f:
        blob = json.load(f)
    if isinstance(blob, dict) and "_action" in blob:
        payload = blob.get("payload") or {}
    else:
        payload = blob

    if not payload:
        print("empty payload", file=sys.stderr)
        return 2

    # -------------------------------------------------------------------------
    # Vendor-leak linter (belt + suspenders). Runs BEFORE the WP REST POST.
    # -------------------------------------------------------------------------
    scan_blob = "\n".join(
        str(payload.get(k, "") or "") for k in ("title", "content", "excerpt", "slug")
    )
    hits = lint_for_vendor_leaks(scan_blob)
    if hits:
        print("[publish_to_wp] VENDOR-LEAK LINTER: refusing to publish", file=sys.stderr)
        print(f"[publish_to_wp] {len(hits)} blacklisted term(s) found in payload:", file=sys.stderr)
        for h in hits:
            print(h, file=sys.stderr)
        print(
            "[publish_to_wp] payload preserved for manual review; exiting 2",
            file=sys.stderr,
        )
        return 2

    site = os.environ.get("WP_SITE", DEFAULT_SITE).strip()
    user = (os.environ.get("WP_USERNAME") or "").strip()
    pw = (os.environ.get("WP_APP_PASSWORD") or "").strip()
    if not (user and pw):
        print("WP_USERNAME / WP_APP_PASSWORD not set", file=sys.stderr)
        return 3

    url = f"https://{site}/wp-json/wp/v2/posts"
    r = requests.post(url, auth=(user, pw), json={
        "title": payload["title"],
        "content": payload["content"],
        "excerpt": payload.get("excerpt", ""),
        "status": payload.get("status", "publish"),
        "slug": payload.get("slug"),
        "featured_media": payload.get("featured_media", DEFAULT_FEATURED_MEDIA),
    }, timeout=30)
    if r.status_code not in (200, 201):
        print(f"wp publish failed: {r.status_code} {r.text[:400]}", file=sys.stderr)
        return 4
    body = r.json()
    print(json.dumps({
        "status": "ok",
        "post_id": body.get("id"),
        "link": body.get("link"),
        "wp_status": body.get("status"),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
