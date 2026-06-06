"""
WordPress REST API publish shim — TWO-PHASE PUBLISH (2026-06-06).

Architecture (the single most important fix this week):

    PHASE 1: POST as DRAFT (status=draft) — Jetpack does NOT email subscribers.
    PHASE 2: Quality gate runs 5 checks against the LIVE post content + payload.
    PHASE 3: IF ALL PASS -> PATCH status=publish -> Jetpack emails subscribers.
             IF ANY FAIL -> stays draft + Resend alert fires + log.

Exit codes (used by the workflow + CF Worker watchdog):
    0 = published successfully (quality gate passed, subscribers will be emailed)
    2 = vendor-leak linter blocked (legacy)
    3 = degraded mode (legacy)
    4 = encoding issues residual (legacy)
    5 = WP credentials missing
    6 = WP REST POST/PATCH failed
    7 = held as draft (quality gate failed but recoverable — watchdog will retry)
    8 = held as draft + watchdog already retried (needs human approval)

REUSE_DRAFT_ID env var:
    When set (by watchdog), we REPLACE that draft instead of creating a new post.
    This prevents the watchdog from spawning duplicate drafts on retry.

Called by the GH Actions workflow after run_daily_pulse.py emits a payload JSON.

Reads (env):
    WP_SITE         e.g. "aztmm.com"
    WP_USERNAME     e.g. "nikhil"
    WP_APP_PASSWORD WordPress application password (NOT account password)
    RESEND_API_KEY  optional — if set, "held draft" alerts go to operator
    REUSE_DRAFT_ID  optional int — patch this draft instead of POSTing new one
    WATCHDOG_RETRY  optional "1"/"true" — flag to mark exit 8 vs 7 on gate fail
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

import requests

DEFAULT_SITE = "aztmm.com"
DEFAULT_FEATURED_MEDIA = 1033  # AZTMM HLDGS green seal

# Category defaults — eliminate the "lands in Uncategorized" regression.
DEFAULT_CATEGORY_DAILY = 730419628   # Daily Pulse
DEFAULT_CATEGORY_WEEKLY = 730419629  # Weekly Pulse

RESEND_API = "https://api.resend.com/emails"
OPERATOR_EMAIL = "nikhil.kothari17@gmail.com"


# -----------------------------------------------------------------------------
# Vendor-leak linter
# -----------------------------------------------------------------------------
_VENDOR_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("Unusual Whales",        re.compile(r"\bunusual\s+whales\b", re.I)),
    ("BlackBoxStocks",        re.compile(r"\bblackbox\s*stocks\b", re.I)),
    ("BlackBox",              re.compile(r"\bblack\s*box\b", re.I)),
    ("BBS (acronym)",         re.compile(r"\bBBS\b")),  # case-sensitive
    ("FlowAlgo",              re.compile(r"\bflow\s*algo\b", re.I)),
    ("Cheddar Flow",          re.compile(r"\bcheddar\s*flow\b", re.I)),
    ("Cheddar",               re.compile(r"\bcheddar\b", re.I)),
    ("Trade Alert (vendor)",  re.compile(r"Trade Alert\s*®")),
    ("Trade Alert (vendor)",  re.compile(r"\btrade[\- ]alert\.com\b", re.I)),
    ("Trade Alert (vendor)",  re.compile(r"\b(?:from|by|via|courtesy of|source[:\- ])\s+Trade Alert\b")),
    ("Settings -> (admin)",   re.compile(r"Settings\s*(?:->|→|&rarr;|&#8594;)", re.I)),
    ("wp-admin URL leak",     re.compile(r"\bwp[\-‐‑]admin\b", re.I)),
    ("polygon.io",            re.compile(r"\bpolygon\.io\b", re.I)),
]


def lint_for_vendor_leaks(content: str) -> list[str]:
    if not content:
        return []
    hits: list[str] = []
    seen: set[tuple[str, int, int]] = set()
    lines = content.splitlines() or [content]
    for label, pat in _VENDOR_PATTERNS:
        for m in pat.finditer(content):
            start = m.start()
            line_no = content.count("\n", 0, start) + 1
            line_start = content.rfind("\n", 0, start) + 1
            col = start - line_start + 1
            key = (label, line_no, col)
            if key in seen:
                continue
            seen.add(key)
            line_text = lines[line_no - 1] if line_no - 1 < len(lines) else m.group(0)
            snippet = line_text.strip()
            if len(snippet) > 160:
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
MOJIBAKE_PATTERNS: list[tuple[str, str]] = [
    ("¬∑",                      "· (middot, UTF-8 -> MacRoman)"),
    ("‚ñ≤",               "▲ (up triangle, UTF-8 -> MacRoman)"),
    ("‚ñº",               "▼ (down triangle, UTF-8 -> MacRoman)"),
    ("‚Äô",               "’ (right single quote, UTF-8 -> MacRoman)"),
    ("‚Äú",               "“ (left double quote, UTF-8 -> MacRoman)"),
    ("‚Äù",               "” (right double quote, UTF-8 -> MacRoman)"),
    ("‚Äî",               "— (em dash, UTF-8 -> MacRoman)"),
    ("â€™",               "’ (right single quote, UTF-8 -> Latin1)"),
    ("â€œ",               "“ (left double quote, UTF-8 -> Latin1)"),
    ("â€\x9d",                 "” (right double quote, UTF-8 -> Latin1)"),
    ("�",                             "Replacement character (encoding loss)"),
]


def lint_for_encoding_issues(content: str) -> list[str]:
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


# -----------------------------------------------------------------------------
# QUALITY GATE — five checks. Returns (passed, failures).
# -----------------------------------------------------------------------------
def quality_gate(post_id, content: str, payload: dict) -> tuple[bool, list[str]]:
    """
    Five-check quality gate run on the LIVE draft post content + source payload.

    Returns (passed: bool, failures: list[str]).
    """
    failures: list[str] = []

    # Check 1: degraded_mode flag
    if isinstance(payload, dict) and payload.get("degraded_mode") is True:
        failures.append("CHECK-1 degraded_mode=True in payload")

    # Check 2: mojibake / encoding loss on the LIVE content
    encoding_issues = lint_for_encoding_issues(content or "")
    if encoding_issues:
        failures.append(f"CHECK-2 mojibake found: {len(encoding_issues)} hit(s) - first: {encoding_issues[0]}")

    # Check 3: vendor leaks on the LIVE content
    vendor_leaks = lint_for_vendor_leaks(content or "")
    if vendor_leaks:
        failures.append(f"CHECK-3 vendor leaks: {len(vendor_leaks)} hit(s) - first:{vendor_leaks[0]}")

    # Check 4: sector data sanity (not all 0%)
    sectors = payload.get("sectors", []) if isinstance(payload, dict) else []
    if sectors:
        try:
            nonzero = sum(
                1 for s in sectors
                if abs(float(s.get("day_change_pct", 0) or 0)) >= 0.01
            )
            threshold = max(1, len(sectors) // 3)
            if nonzero < threshold:
                failures.append(
                    f"CHECK-4 sector data sanity: only {nonzero}/{len(sectors)} sectors have nonzero day_change_pct (need >= {threshold})"
                )
        except (TypeError, ValueError) as e:
            failures.append(f"CHECK-4 sector parse error: {e}")

    # Check 5: MPI freshness (within 24h)
    mpi_data = payload.get("mpi", {}) if isinstance(payload, dict) else {}
    if mpi_data:
        computed_at_str = str(mpi_data.get("computed_at", "") or "")
        if not computed_at_str:
            if not mpi_data.get("asOf"):
                failures.append("CHECK-5 MPI freshness: no computed_at or asOf in mpi block")
        else:
            try:
                ca = datetime.fromisoformat(computed_at_str.replace("Z", "+00:00"))
                if ca.tzinfo is None:
                    ca = ca.replace(tzinfo=timezone.utc)
                age = datetime.now(timezone.utc) - ca
                if age > timedelta(hours=24):
                    failures.append(
                        f"CHECK-5 MPI stale: computed {age.total_seconds()/3600:.1f}h ago"
                    )
            except Exception as e:
                failures.append(f"CHECK-5 MPI freshness parse error: {e}")

    return (len(failures) == 0, failures)


# -----------------------------------------------------------------------------
# Promote draft -> publish (triggers Jetpack subscriber emails)
# -----------------------------------------------------------------------------
def promote_to_publish(site: str, user: str, pw: str, post_id: int) -> tuple[bool, dict]:
    """PATCH the draft to status=publish. This is when subscribers get the email."""
    url = f"https://{site}/wp-json/wp/v2/posts/{post_id}"
    # WP REST treats POST on /posts/{id} as update — same as PATCH.
    r = requests.post(
        url,
        auth=(user, pw),
        json={"status": "publish"},
        timeout=30,
    )
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text[:400]}
    return (r.status_code in (200, 201), body)


# -----------------------------------------------------------------------------
# Held-draft notification (Resend HTTP API)
# -----------------------------------------------------------------------------
def notify_held_for_review(post_id: int, draft_link: str, failures: list[str], reason: str = "quality_gate_failed") -> bool:
    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key:
        print("[publish_to_wp] RESEND_API_KEY missing; skipping held-draft notification", file=sys.stderr)
        return False
    site = os.environ.get("WP_SITE", DEFAULT_SITE).strip() or DEFAULT_SITE
    from_addr = os.environ.get("FROM_ADDR", "AZTMM Pipeline <onboarding@resend.dev>")
    preview_url = f"https://{site}/?p={post_id}&preview=true"
    failure_html = "<ul>" + "".join(f"<li><code>{f}</code></li>" for f in failures) + "</ul>"
    html = f"""
    <div style="font-family:ui-sans-serif,system-ui;color:#111;line-height:1.5;">
      <h2 style="color:#c1121f;margin:0 0 8px;">AZTMM Draft Held - Quality Gate Failed</h2>
      <p><b>Reason:</b> {reason}</p>
      <p><b>Post ID:</b> {post_id}</p>
      <p><b>Edit (admin):</b> <a href="https://{site}/wp-admin/post.php?post={post_id}&action=edit">open in WP admin</a></p>
      <p><b>Preview:</b> <a href="{preview_url}">{preview_url}</a></p>
      <p><b>Draft URL:</b> <a href="{draft_link}">{draft_link}</a></p>
      <h3>Failures</h3>
      {failure_html}
      <p style="color:#666;font-size:12px;">CF Worker watchdog will retry from fresh data on next tick. If second attempt also fails, you'll get a "human approval needed" email.</p>
    </div>
    """
    payload = {
        "from": from_addr,
        "to": [OPERATOR_EMAIL],
        "subject": f"AZTMM Draft Held - Quality Gate Failed (post {post_id})",
        "html": html,
    }
    req = urllib.request.Request(
        RESEND_API,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read().decode()
            print(f"[publish_to_wp] held-draft alert sent: HTTP {r.status} {body[:200]}", file=sys.stderr)
            return True
    except urllib.error.HTTPError as e:
        print(f"[publish_to_wp] Resend HTTPError {e.code}: {e.read().decode()[:300]}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[publish_to_wp] Resend failed: {e}", file=sys.stderr)
        return False


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
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

    # ------------------------------------------------------------------
    # Pre-flight linters (kept for backwards compat with existing workflow).
    # These run BEFORE we even POST a draft so we don't spam the WP trash.
    # ------------------------------------------------------------------
    scan_blob = "\n".join(
        str(payload.get(k, "") or "") for k in ("title", "content", "excerpt", "slug")
    )
    hits = lint_for_vendor_leaks(scan_blob)
    if hits:
        print("[publish_to_wp] VENDOR-LEAK LINTER: refusing to publish", file=sys.stderr)
        print(f"[publish_to_wp] {len(hits)} blacklisted term(s) found in payload:", file=sys.stderr)
        for h in hits:
            print(h, file=sys.stderr)
        print("[publish_to_wp] payload preserved for manual review; exiting 2", file=sys.stderr)
        return 2

    if check_degraded_mode(payload):
        print(
            "[publish_to_wp] DEGRADED MODE detected — refusing to publish. "
            "Will retry on next cron tick.",
            file=sys.stderr,
        )
        return 3

    # Encoding auto-repair (unchanged from prior policy).
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
                    continue
                if bad in v:
                    good_char = good_desc.split(" ")[0]
                    v = v.replace(bad, good_char)
                    repaired += 1
            payload[field] = v
        scan_blob = "\n".join(str(payload.get(k, "") or "") for k in ("title", "content", "excerpt", "slug"))
        residual = lint_for_encoding_issues(scan_blob)
        print(f"[publish_to_wp] auto-repaired {repaired} pattern occurrence(s); {len(residual)} residual issue(s)", file=sys.stderr)
        if residual:
            print("[publish_to_wp] residual ENCODING ISSUES (U+FFFD or unmapped) — refusing to publish", file=sys.stderr)
            for issue in residual:
                print(f"  {issue}", file=sys.stderr)
            return 4

    # ------------------------------------------------------------------
    # WP creds + category routing
    # ------------------------------------------------------------------
    site = os.environ.get("WP_SITE", DEFAULT_SITE).strip()
    user = (os.environ.get("WP_USERNAME") or "").strip()
    pw = (os.environ.get("WP_APP_PASSWORD") or "").strip()
    if not (user and pw):
        print("WP_USERNAME / WP_APP_PASSWORD not set", file=sys.stderr)
        return 5

    post_type = (payload.get("post_type") or "daily").lower()
    if post_type == "weekly":
        default_cats = [DEFAULT_CATEGORY_WEEKLY]
    else:
        default_cats = [DEFAULT_CATEGORY_DAILY]
    payload_categories = payload.get("categories") or default_cats

    # ------------------------------------------------------------------
    # PHASE 1 — POST as DRAFT (or PATCH a reused draft).
    # Jetpack does NOT email subscribers for status=draft.
    # ------------------------------------------------------------------
    reuse_id_raw = os.environ.get("REUSE_DRAFT_ID", "").strip()
    reuse_id = None
    if reuse_id_raw:
        try:
            reuse_id = int(reuse_id_raw)
            print(f"[publish_to_wp] PHASE 1 — REUSE_DRAFT_ID={reuse_id} (watchdog retry, replacing draft)", file=sys.stderr)
        except ValueError:
            print(f"[publish_to_wp] REUSE_DRAFT_ID invalid: {reuse_id_raw!r}; ignoring", file=sys.stderr)

    base_body = {
        "title": payload["title"],
        "content": payload["content"],
        "excerpt": payload.get("excerpt", ""),
        "status": "draft",   # HARDCODED. Always draft on first write.
        "slug": payload.get("slug"),
        "featured_media": payload.get("featured_media", DEFAULT_FEATURED_MEDIA),
        "categories": payload_categories,
    }

    if reuse_id is not None:
        url = f"https://{site}/wp-json/wp/v2/posts/{reuse_id}"
    else:
        url = f"https://{site}/wp-json/wp/v2/posts"
    r = requests.post(url, auth=(user, pw), json=base_body, timeout=30)

    if r.status_code not in (200, 201):
        print(f"[publish_to_wp] PHASE 1 wp draft POST failed: {r.status_code} {r.text[:400]}", file=sys.stderr)
        return 6

    body = r.json()
    post_id = body.get("id")
    draft_link = body.get("link", f"https://{site}/?p={post_id}")
    live_content = body.get("content", {}).get("raw") or body.get("content", {}).get("rendered") or payload.get("content", "")
    print(f"[publish_to_wp] PHASE 1 OK — draft post id={post_id} status={body.get('status')} link={draft_link}", file=sys.stderr)

    # ------------------------------------------------------------------
    # PHASE 2 — Quality gate (5 checks)
    # ------------------------------------------------------------------
    passed, failures = quality_gate(post_id, live_content, payload)

    if not passed:
        print(f"[publish_to_wp] PHASE 2 QUALITY GATE FAILED — {len(failures)} failure(s):", file=sys.stderr)
        for f_ in failures:
            print(f"  - {f_}", file=sys.stderr)
        notify_held_for_review(post_id, draft_link, failures, reason="quality_gate_failed")
        watchdog_retry = os.environ.get("WATCHDOG_RETRY", "").strip().lower() in ("1", "true", "yes")
        print(json.dumps({
            "status": "held",
            "post_id": post_id,
            "draft_link": draft_link,
            "wp_status": "draft",
            "failures": failures,
            "exit_code": 8 if watchdog_retry else 7,
        }, indent=2))
        return 8 if watchdog_retry else 7

    print(f"[publish_to_wp] PHASE 2 OK — quality gate passed (0 failures)", file=sys.stderr)

    # ------------------------------------------------------------------
    # PHASE 3 — Promote draft -> publish. THIS triggers Jetpack subscriber emails.
    # ------------------------------------------------------------------
    ok, promote_body = promote_to_publish(site, user, pw, post_id)
    if not ok:
        print(f"[publish_to_wp] PHASE 3 promote-to-publish FAILED: {promote_body}", file=sys.stderr)
        # The draft is still safe in WP. Notify and exit 6 — this is a
        # network/REST failure, not a content quality failure.
        notify_held_for_review(post_id, draft_link, [f"PHASE 3 PATCH publish failed: {str(promote_body)[:300]}"], reason="promote_failed")
        return 6

    print(json.dumps({
        "status": "ok",
        "post_id": post_id,
        "link": promote_body.get("link", draft_link),
        "wp_status": promote_body.get("status"),
        "phase": "promoted",
        "quality_gate": "passed",
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
