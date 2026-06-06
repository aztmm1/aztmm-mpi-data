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

# Category defaults — eliminate the "lands in Uncategorized" regression.
DEFAULT_CATEGORY_DAILY = 730419628   # Daily Pulse
DEFAULT_CATEGORY_WEEKLY = 730419629  # Weekly Pulse


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


# -----------------------------------------------------------------------------
# Degraded-mode guard
# -----------------------------------------------------------------------------
def check_degraded_mode(payload_dict: dict) -> bool:
    """Refuse to publish if upstream data is degraded. Return True if degraded.

    Heuristics:
      - explicit `degraded_mode: true` flag on the payload, OR
      - every sector day_change_pct is effectively zero (CBOE/SA settle race —
        the 17:00 ET cron fired before EOD bars settled, leaving us with flat
        zeros across the board). True zero-change across all sectors is
        practically impossible on a live trading day.
    """
    if not isinstance(payload_dict, dict):
        return False
    if payload_dict.get("degraded_mode") is True:
        return True
    sectors = payload_dict.get("sectors", [])
    if sectors and all(abs(float(s.get("day_change_pct", 0) or 0)) < 0.001 for s in sectors):
        return True
    return False


# -----------------------------------------------------------------------------
# Encoding / mojibake linter
# -----------------------------------------------------------------------------
# Patterns that appear when UTF-8 bytes get decoded under the wrong codec
# (commonly MacRoman or Latin-1) and then re-emitted as UTF-8. We refuse to
# publish if any of these are present — they're a tell that the payload was
# corrupted somewhere upstream.
MOJIBAKE_PATTERNS: list[tuple[str, str]] = [
    # ¬∑ -> · (middot, UTF-8 decoded as MacRoman)
    ("\u00ac\u2211",                      "· (middot, UTF-8 -> MacRoman)"),
    # ‚ñ≤ -> ▲ (up triangle, UTF-8 -> MacRoman)
    ("\u201a\u00f1\u2264",               "▲ (up triangle, UTF-8 -> MacRoman)"),
    # ‚ñº -> ▼ (down triangle, UTF-8 -> MacRoman)
    ("\u201a\u00f1\u00ba",               "▼ (down triangle, UTF-8 -> MacRoman)"),
    # ‚Äô -> ’ (right single quote, UTF-8 -> MacRoman)
    ("\u201a\u00c4\u00f4",               "’ (right single quote, UTF-8 -> MacRoman)"),
    # ‚Äú -> “ (left double quote, UTF-8 -> MacRoman)
    ("\u201a\u00c4\u00fa",               "“ (left double quote, UTF-8 -> MacRoman)"),
    # ‚Äù -> ” (right double quote, UTF-8 -> MacRoman)
    ("\u201a\u00c4\u00f9",               "” (right double quote, UTF-8 -> MacRoman)"),
    # ‚Äî -> — (em dash, UTF-8 -> MacRoman)
    ("\u201a\u00c4\u00ee",               "— (em dash, UTF-8 -> MacRoman)"),
    # â€™ -> ’ (right single quote, UTF-8 -> Latin1)
    ("\u00e2\u20ac\u2122",               "’ (right single quote, UTF-8 -> Latin1)"),
    # â€œ -> “ (left double quote, UTF-8 -> Latin1)
    ("\u00e2\u20ac\u0153",               "“ (left double quote, UTF-8 -> Latin1)"),
    # â€\x9d -> ” (right double quote, UTF-8 -> Latin1)
    ("\u00e2\u20ac\x9d",                 "” (right double quote, UTF-8 -> Latin1)"),
    # � replacement char (any encoding loss)
    ("\ufffd",                             "Replacement character (encoding loss)"),
]


def lint_for_encoding_issues(content: str) -> list[str]:
    """Scan post content for mojibake / encoding-loss markers.

    Returns a list of human-readable error strings. Empty list = clean.
    """
    findings: list[str] = []
    if not content:
        return findings
    for pattern, description in MOJIBAKE_PATTERNS:
        for match in re.finditer(pattern, content):
            line_no = content[: match.start()].count("\n") + 1
            findings.append(
                f"[encoding] line {line_no}: matched {match.group()!r} -> should be {description}"
            )
    return findings


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: publish_to_wp.py PAYLOAD.json", file=sys.stderr)
        return 1
    try:
        with open(sys.argv[1]) as f:
            raw = f.read().strip()
    except OSError as e:
        print(f"cannot read payload file: {e}", file=sys.stderr)
        return 1

    if not raw:
        # Empty payload typically means run_daily_pulse skipped (non-market day,
        # cron fired late). Treat as a controlled skip, not a hard error.
        print("[publish_to_wp] empty payload — treating as skipped run", file=sys.stderr)
        return 0

    try:
        blob = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[publish_to_wp] payload is not valid JSON: {e}", file=sys.stderr)
        return 1

    if isinstance(blob, dict) and blob.get("_action") == "noop":
        print(f"[publish_to_wp] sentinel noop received "
              f"(reason={blob.get('reason')}, date={blob.get('date')}) — skipping",
              file=sys.stderr)
        return 0

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

    # -------------------------------------------------------------------------
    # Degraded-mode guard — refuse to publish if upstream data hasn't settled.
    # -------------------------------------------------------------------------
    if check_degraded_mode(payload):
        print(
            "[publish_to_wp] DEGRADED MODE detected — refusing to publish. "
            "Will retry on next cron tick.",
            file=sys.stderr,
        )
        return 3  # exit code 3 = degraded, distinct from 2=linter

    # -------------------------------------------------------------------------
    # Encoding / mojibake linter — AUTO-REPAIR known patterns, then re-scan.
    # ------------------------------------------------------------------------
    # Policy update 2026-06-06: refusing to publish on mojibake silently breaks
    # the entire daily/weekly publish pipeline (see incident 2026-06-06). We
    # now auto-repair the known mojibake patterns in-place, log the repairs,
    # and only refuse to publish if UNKNOWN encoding loss (e.g. U+FFFD) remains.
    initial_issues = lint_for_encoding_issues(scan_blob)
    if initial_issues:
        print(f"[publish_to_wp] {len(initial_issues)} encoding issue(s) detected — attempting auto-repair", file=sys.stderr)
        repaired = 0
        for field in ("title", "content", "excerpt", "slug"):
            if field not in payload or not isinstance(payload[field], str):
                continue
            v = payload[field]
            for bad, good_desc in MOJIBAKE_PATTERNS:
                if bad == "�":
                    # U+FFFD is genuine encoding loss — cannot recover, leave as-is
                    continue
                if bad in v:
                    # Map to the proper Unicode codepoint based on description.
                    fix = {
                        "·": "·", "▲": "▲", "▼": "▼",
                        "’": "’", "“": "“", "”": "”",
                        "—": "—",
                    }
                    # description string starts with the good char + " (..."
                    good_char = good_desc.split(" ")[0]
                    v = v.replace(bad, good_char)
                    repaired += 1
            payload[field] = v
        # Re-scan after repair
        scan_blob = "\n".join(str(payload.get(k, "") or "") for k in ("title", "content", "excerpt", "slug"))
        residual = lint_for_encoding_issues(scan_blob)
        print(f"[publish_to_wp] auto-repaired {repaired} pattern occurrence(s); {len(residual)} residual issue(s)", file=sys.stderr)
        if residual:
            print("[publish_to_wp] residual ENCODING ISSUES (U+FFFD or unmapped) — refusing to publish", file=sys.stderr)
            for issue in residual:
                print(f"  {issue}", file=sys.stderr)
            return 4

    site = os.environ.get("WP_SITE", DEFAULT_SITE).strip()
    user = (os.environ.get("WP_USERNAME") or "").strip()
    pw = (os.environ.get("WP_APP_PASSWORD") or "").strip()
    if not (user and pw):
        print("WP_USERNAME / WP_APP_PASSWORD not set", file=sys.stderr)
        return 5

    # Category default — eliminate the "lands in Uncategorized" regression.
    # Payload may set `post_type` to "daily" (default) or "weekly", or may
    # explicitly set `categories` to override.
    post_type = (payload.get("post_type") or "daily").lower()
    if post_type == "weekly":
        default_cats = [DEFAULT_CATEGORY_WEEKLY]
    else:
        default_cats = [DEFAULT_CATEGORY_DAILY]  # safe default for unknown types
    payload_categories = payload.get("categories") or default_cats

    url = f"https://{site}/wp-json/wp/v2/posts"
    r = requests.post(url, auth=(user, pw), json={
        "title": payload["title"],
        "content": payload["content"],
        "excerpt": payload.get("excerpt", ""),
        "status": payload.get("status", "publish"),
        "slug": payload.get("slug"),
        "featured_media": payload.get("featured_media", DEFAULT_FEATURED_MEDIA),
        "categories": payload_categories,
    }, timeout=30)
    if r.status_code not in (200, 201):
        print(f"wp publish failed: {r.status_code} {r.text[:400]}", file=sys.stderr)
        return 6
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
