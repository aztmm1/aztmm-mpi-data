#!/usr/bin/env python3
"""
AZTMM Tier 1B — Correction detection daemon.

Run daily at 02:00 UTC via CF Worker cron (and/or GH Actions schedule).

For each Pulse post published in the last 7 days:
  1. Fetch the current LIVE content from WP REST API.
  2. Read the stored `aztmm_content_hash` custom post meta.
  3. Compute a fresh SHA-256 over current content.
  4. If different -> compute a diff_summary, classify materiality, and
     append a correction_event to data/versions/{trading_date}.json.
  5. Update aztmm_content_hash + aztmm_version_id on the post (append-only;
     prior version_id is preserved in the manifest's correction_events log).
  6. Commit + push the manifest changes.

Exit code 0 always (do not break the cron); errors are logged to stderr.

Environment:
  WP_SITE, WP_USERNAME, WP_APP_PASSWORD   — WP REST credentials
  GITHUB_TOKEN                            — for repo write (CI default)
  AZTMM_REPO_ROOT                         — default: parent of this dir
  AZTMM_PULSE_CATEGORY_IDS                — comma-sep cat IDs (730419628,730419629)
  AZTMM_DRY_RUN=1                         — skip WP meta writes and git commits

Usage:
  python detect_corrections.py [--lookback-days 7] [--date YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import pathlib
import re
import sys
from datetime import datetime, timezone, timedelta

try:
    import requests
except ImportError:
    print("ERROR: requests not installed — run `pip install requests`", file=sys.stderr)
    sys.exit(0)


DEFAULT_WP_SITE = "aztmm.com"
DEFAULT_CATEGORY_IDS = [730419628, 730419629]  # Daily Pulse, Weekly Pulse


# -----------------------------------------------------------------------------
# Hashing
# -----------------------------------------------------------------------------
def sha256_short(s: str, n: int = 16) -> str:
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()[:n]


# -----------------------------------------------------------------------------
# Materiality classifier
# -----------------------------------------------------------------------------
MATERIAL_PATTERNS = [
    (r"MPI[:\s]+\d+",         "MPI value"),
    (r"[+\-]\d+\.\d+%",       "sector / pct delta"),
    (r"SPY\s*\$?\d+",         "SPY price"),
    (r"VIX\s+\d+",            "VIX value"),
    (r"<h[1-3]\b",            "heading content"),
    (r"\$\d{1,4}(?:\.\d{1,2})?\b",  "dollar figure"),
    (r"\b\d{1,3}(?:,\d{3})+\b",     "comma-grouped number"),
    (r"\bregime\s*[:=]\s*\w+", "regime label"),
]

MINOR_PATTERNS = [
    (r"<p[\s>]",                  "paragraph content"),
    (r"\b(said|noted|observed|wrote)\b", "narrative verb"),
    (r"<li[\s>]",                 "list item"),
]

COSMETIC_PATTERNS = [
    (r"^\s+$",   "whitespace only"),
    (r"^[\.,;!?\"'\-—–]+$", "punctuation only"),
]


def _strip_diff_markers(diff_text: str) -> str:
    """Return only the textual deltas (strip leading +/- markers)."""
    out = []
    for line in diff_text.splitlines():
        if line.startswith(("+++", "---", "@@")):
            continue
        if line.startswith(("+", "-")):
            out.append(line[1:])
        else:
            out.append(line)
    return "\n".join(out)


def _is_cosmetic_delta(diff_text: str) -> bool:
    """
    True iff the *textual* delta between added/removed lines reduces to
    whitespace + punctuation only. Diffs that only change spacing/punctuation
    around otherwise-identical text are treated as cosmetic.
    """
    plus = [l[1:] for l in diff_text.splitlines() if l.startswith("+") and not l.startswith("+++")]
    minus = [l[1:] for l in diff_text.splitlines() if l.startswith("-") and not l.startswith("---")]
    if not plus and not minus:
        return True

    def normalize(s: str) -> str:
        # Strip all whitespace + punctuation; leave only letters/digits.
        return re.sub(r"[\s\.,;!?\"'\-—–]+", "", s)

    norm_plus = "".join(normalize(l) for l in plus)
    norm_minus = "".join(normalize(l) for l in minus)
    return norm_plus == norm_minus


def classify_materiality(diff_text: str) -> tuple[str, list[str]]:
    """
    Classify a diff fragment as 'material', 'minor', or 'cosmetic'.

    Returns (label, reasons).
    """
    if not diff_text or not diff_text.strip():
        return ("cosmetic", ["empty diff"])

    reasons = []

    for pat, label in MATERIAL_PATTERNS:
        if re.search(pat, diff_text, re.MULTILINE):
            reasons.append(f"material:{label}")

    if reasons:
        return ("material", reasons)

    # Cosmetic check BEFORE minor: a whitespace-only change inside a <p> tag
    # should be cosmetic, not minor.
    if _is_cosmetic_delta(diff_text):
        return ("cosmetic", ["whitespace/punctuation only"])

    for pat, label in MINOR_PATTERNS:
        if re.search(pat, diff_text, re.MULTILINE):
            reasons.append(f"minor:{label}")

    if reasons:
        return ("minor", reasons)

    # Default: minor (some textual change that's not in the material list).
    return ("minor", ["unclassified text change"])


# -----------------------------------------------------------------------------
# Diff summarizer
# -----------------------------------------------------------------------------
def summarize_diff(before: str, after: str, max_examples: int = 3) -> tuple[str, str]:
    """
    Compute (one-line summary, full unified diff text).

    Summary mentions lines added/removed and top 1-3 examples.
    """
    b_lines = (before or "").splitlines()
    a_lines = (after or "").splitlines()
    diff_lines = list(
        difflib.unified_diff(b_lines, a_lines, lineterm="", n=1)
    )
    added = sum(1 for l in diff_lines if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in diff_lines if l.startswith("-") and not l.startswith("---"))

    examples = []
    for line in diff_lines:
        if line.startswith("+") and not line.startswith("+++"):
            examples.append(f"+ {line[1:].strip()[:80]}")
        elif line.startswith("-") and not line.startswith("---"):
            examples.append(f"- {line[1:].strip()[:80]}")
        if len(examples) >= max_examples:
            break

    summary = f"{added} line(s) added, {removed} line(s) removed"
    if examples:
        summary += "; examples: " + " | ".join(examples)

    return summary, "\n".join(diff_lines)


# -----------------------------------------------------------------------------
# WP REST helpers
# -----------------------------------------------------------------------------
class WPClient:
    def __init__(self, site: str, user: str, pw: str):
        self.base = f"https://{site}/wp-json/wp/v2"
        self.auth = (user, pw)
        self.session = requests.Session()

    def list_recent_pulse_posts(self, lookback_days: int, category_ids: list[int]) -> list[dict]:
        after = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()
        params = {
            "after":      after,
            "per_page":   30,
            "status":     "publish",
            "categories": ",".join(str(c) for c in category_ids),
            "_fields":    "id,date,modified,slug,title,link,categories",
        }
        r = self.session.get(f"{self.base}/posts", auth=self.auth, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def get_post_with_meta(self, post_id: int) -> dict:
        params = {"context": "edit", "_fields": "id,date,modified,content,meta,link,title"}
        r = self.session.get(f"{self.base}/posts/{post_id}", auth=self.auth, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def set_post_meta(self, post_id: int, key: str, value) -> bool:
        r = self.session.post(
            f"{self.base}/posts/{post_id}",
            auth=self.auth, json={"meta": {key: value}}, timeout=20,
        )
        return r.status_code in (200, 201)


# -----------------------------------------------------------------------------
# Manifest I/O
# -----------------------------------------------------------------------------
def find_manifest_for_post(versions_dir: pathlib.Path, post_id: int) -> pathlib.Path | None:
    """Search data/versions/*.json for the file whose `post_id` matches."""
    if not versions_dir.exists():
        return None
    for path in sorted(versions_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text())
            if int(data.get("post_id", -1)) == int(post_id):
                return path
        except Exception:
            continue
    return None


def append_correction_event(manifest_path: pathlib.Path, event: dict) -> None:
    """Append a correction event to the manifest file."""
    data = json.loads(manifest_path.read_text())
    events = data.get("correction_events", [])
    events.append(event)
    data["correction_events"] = events
    manifest_path.write_text(json.dumps(data, indent=2, sort_keys=False) + "\n")


# -----------------------------------------------------------------------------
# Core detection
# -----------------------------------------------------------------------------
def detect_one_post(wp: WPClient, post: dict, versions_dir: pathlib.Path, dry_run: bool) -> dict:
    """
    Detect correction on a single post.

    Returns a structured result dict:
      {status: 'no_change'|'correction_detected'|'no_manifest'|'error',
       post_id, materiality?, summary?, version_id_after?}
    """
    post_id = post["id"]
    result = {"post_id": post_id, "status": "no_change"}

    try:
        full = wp.get_post_with_meta(post_id)
    except Exception as e:
        return {"post_id": post_id, "status": "error", "error": f"fetch: {e}"}

    content = (full.get("content") or {}).get("raw") or (full.get("content") or {}).get("rendered") or ""
    meta = full.get("meta") or {}

    stored_hash = meta.get("aztmm_content_hash") or ""
    stored_version_id = meta.get("aztmm_version_id") or ""

    if not stored_hash:
        result["status"] = "no_baseline"
        result["note"] = "post has no aztmm_content_hash meta (pre-Tier-1B publish?)"
        return result

    current_hash = sha256_short(content, 16)
    if current_hash == stored_hash:
        return result  # no_change

    # Change detected.
    manifest_path = find_manifest_for_post(versions_dir, post_id)
    if not manifest_path:
        result["status"] = "no_manifest"
        result["note"] = f"post_id={post_id} hash mismatch but no manifest file found in {versions_dir}"
        return result

    manifest = json.loads(manifest_path.read_text())
    publish_event = manifest.get("publish_event", {})
    last_known_content = publish_event.get("_content_snapshot", "")
    # We don't actually store the full content in publish_event (would bloat the
    # repo). Instead, the BEFORE-side of the diff is reconstructed from any
    # previous correction_event['_content_after'] if present, else we mark the
    # diff as opaque (the hash change is the signal).
    prior_events = manifest.get("correction_events", [])
    if prior_events and "_content_after" in prior_events[-1]:
        before_content = prior_events[-1]["_content_after"]
    else:
        before_content = last_known_content

    summary, _full_diff = summarize_diff(before_content, content)
    diff_text_for_classify = "\n".join([
        l for l in _full_diff.splitlines()
        if l.startswith("+") or l.startswith("-")
    ])
    materiality, reasons = classify_materiality(diff_text_for_classify or content)

    now = datetime.now(timezone.utc)
    new_version_id = now.strftime("%Y%m%d-%H%M%S") + "-" + current_hash[:8]

    event = {
        "corrected_at":          now.isoformat().replace("+00:00", "Z"),
        "version_id_before":     stored_version_id,
        "version_id_after":      new_version_id,
        "content_hash_before":   stored_hash,
        "content_hash_after":    current_hash,
        "materiality":           materiality,
        "materiality_reasons":   reasons,
        "diff_summary":          summary,
        "subscriber_notification_recommended": (materiality == "material"),
        # NOTE: we deliberately do NOT persist `_content_after` here to keep
        # the manifest small. The next detection cycle treats the new content
        # hash as the baseline.
    }

    if not dry_run:
        append_correction_event(manifest_path, event)
        # Update WP meta — keep the original version_id immutable in the
        # manifest, but bump the live meta so the next detect cycle uses the
        # new content as baseline.
        wp.set_post_meta(post_id, "aztmm_content_hash", current_hash)
        wp.set_post_meta(post_id, "aztmm_version_id", new_version_id)
        wp.set_post_meta(post_id, "aztmm_last_correction_at", event["corrected_at"])
        wp.set_post_meta(post_id, "aztmm_last_correction_materiality", materiality)

    result.update({
        "status":                "correction_detected",
        "materiality":           materiality,
        "summary":               summary,
        "version_id_after":      new_version_id,
        "manifest":              str(manifest_path),
        "subscriber_notification_recommended": event["subscriber_notification_recommended"],
    })
    return result


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--lookback-days", type=int, default=7)
    p.add_argument("--date", help="Only check posts whose trading_date matches YYYY-MM-DD")
    p.add_argument("--dry-run", action="store_true",
                   help="Also enabled by AZTMM_DRY_RUN=1")
    args = p.parse_args()

    dry_run = args.dry_run or os.environ.get("AZTMM_DRY_RUN", "") in ("1", "true", "yes")

    site = os.environ.get("WP_SITE", DEFAULT_WP_SITE).strip()
    user = (os.environ.get("WP_USERNAME") or "").strip()
    pw = (os.environ.get("WP_APP_PASSWORD") or "").strip()
    if not (user and pw):
        print("WP_USERNAME / WP_APP_PASSWORD not set", file=sys.stderr)
        return 0  # don't break cron

    repo_root = os.environ.get("AZTMM_REPO_ROOT") or str(
        pathlib.Path(__file__).resolve().parent.parent
    )
    versions_dir = pathlib.Path(repo_root) / "aztmm-daily-pulse-v2" / "data" / "versions"
    versions_dir.mkdir(parents=True, exist_ok=True)

    cat_env = os.environ.get("AZTMM_PULSE_CATEGORY_IDS", "")
    category_ids = (
        [int(x) for x in cat_env.split(",") if x.strip()] if cat_env else DEFAULT_CATEGORY_IDS
    )

    wp = WPClient(site, user, pw)
    try:
        posts = wp.list_recent_pulse_posts(args.lookback_days, category_ids)
    except Exception as e:
        print(f"[detect_corrections] WP list failed: {e}", file=sys.stderr)
        return 0

    summary = {
        "checked":              0,
        "no_change":            0,
        "no_baseline":          0,
        "no_manifest":          0,
        "corrections_detected": 0,
        "material":             0,
        "minor":                0,
        "cosmetic":             0,
        "errors":               0,
        "details":              [],
    }

    for post in posts:
        summary["checked"] += 1
        result = detect_one_post(wp, post, versions_dir, dry_run)
        status = result.get("status", "error")
        if status == "no_change":
            summary["no_change"] += 1
        elif status == "no_baseline":
            summary["no_baseline"] += 1
        elif status == "no_manifest":
            summary["no_manifest"] += 1
            summary["details"].append(result)
        elif status == "correction_detected":
            summary["corrections_detected"] += 1
            mat = result.get("materiality", "minor")
            summary[mat] = summary.get(mat, 0) + 1
            summary["details"].append(result)
        else:
            summary["errors"] += 1
            summary["details"].append(result)

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
