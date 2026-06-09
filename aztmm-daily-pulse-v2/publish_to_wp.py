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

import hashlib
import json
import os
import pathlib
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


# =============================================================================
# TIER 1C — EXTENSIBLE QUALITY GATE
# =============================================================================
# Architecture:
#   * quality_checks.yaml lives next to this file. Each entry is one check with
#     a `type` selecting a small interpreter below. Adding a check of a known
#     type is a single-file YAML edit; no Python edits required.
#   * Anomaly history (rolling window of numerical metrics) is persisted in
#     data/anomaly_history.json which the workflow's "Commit run logs" step
#     already adds to git, so history accumulates run-over-run.
#   * Backward compatible: if quality_checks.yaml is missing OR PyYAML cannot
#     be imported, quality_gate() falls back to the original hardcoded 5 checks.
#   * Severity model: only severity=='block' failures fail the gate. 'warn' and
#     'log' surface in stderr but do not hold the draft — promote-then-observe.
# =============================================================================

_QUALITY_CHECKS_YAML = os.path.join(os.path.dirname(__file__), "quality_checks.yaml")
_ANOMALY_HISTORY_JSON = os.path.join(os.path.dirname(__file__), "data", "anomaly_history.json")


def load_quality_checks() -> dict | None:
    """Load YAML config. Returns None if missing or yaml unavailable."""
    if not os.path.exists(_QUALITY_CHECKS_YAML):
        return None
    try:
        import yaml  # type: ignore
    except ImportError:
        print(
            "[publish_to_wp] PyYAML not installed; quality_checks.yaml ignored, "
            "falling back to hardcoded 5-check gate",
            file=sys.stderr,
        )
        return None
    try:
        with open(_QUALITY_CHECKS_YAML) as f:
            cfg = yaml.safe_load(f) or {}
    except Exception as e:
        print(f"[publish_to_wp] failed to parse quality_checks.yaml: {e}", file=sys.stderr)
        return None
    if not isinstance(cfg, dict) or "checks" not in cfg:
        return None
    return cfg


def _walk_dotted(obj, path: str):
    cur = obj
    for key in (path or "").split("."):
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(key)
        else:
            return None
    return cur


def _load_anomaly_history() -> dict:
    if not os.path.exists(_ANOMALY_HISTORY_JSON):
        return {}
    try:
        with open(_ANOMALY_HISTORY_JSON) as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _save_anomaly_history(history: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_ANOMALY_HISTORY_JSON), exist_ok=True)
        with open(_ANOMALY_HISTORY_JSON, "w") as f:
            json.dump(history, f, indent=2, sort_keys=True)
    except Exception as e:
        print(f"[publish_to_wp] failed to write anomaly_history.json: {e}", file=sys.stderr)


def detect_structural_anomaly(post_id, content: str, payload: dict, check: dict) -> str | None:
    """Compare current section count to median of last N published posts.

    Returns a description string when the new draft has dropped >= max_section_drop
    sections relative to the median of the last N posts in the same category.
    Returns None on insufficient history or no anomaly.
    """
    n = int(check.get("compare_n", 10))
    post_type = (payload.get("post_type") or "daily").lower()
    cat_id = DEFAULT_CATEGORY_DAILY if post_type != "weekly" else DEFAULT_CATEGORY_WEEKLY
    site = os.environ.get("WP_SITE", DEFAULT_SITE).strip() or DEFAULT_SITE

    url = (
        f"https://{site}/wp-json/wp/v2/posts"
        f"?categories={cat_id}&per_page={n}&status=publish&_fields=id,content"
    )
    try:
        r = requests.get(url, timeout=20)
        if r.status_code != 200:
            return None
        recent_posts = r.json()
    except Exception:
        return None

    if not isinstance(recent_posts, list) or len(recent_posts) < 3:
        return None  # not enough history yet

    def count_sections(html: str) -> int:
        if not html:
            return 0
        return len(re.findall(r"<h[1-3]\b", html, re.IGNORECASE))

    section_counts = sorted(
        count_sections(((p.get("content") or {}).get("rendered")) or "")
        for p in recent_posts
    )
    median_sections = section_counts[len(section_counts) // 2]

    current_sections = count_sections(content or "")
    drop = median_sections - current_sections
    max_drop = int(check.get("max_section_drop", 2))

    if drop >= max_drop:
        return (
            f"section count anomaly: current={current_sections}, "
            f"median(last {len(section_counts)})={median_sections}, drop={drop}"
        )
    return None


def detect_numerical_anomaly(payload: dict, check: dict, persist: bool = True) -> str | None:
    """Z-score check against last N values stored in data/anomaly_history.json.

    Always appends the current value to the rolling window when persist=True
    so future runs have history. Returns an anomaly string only when |z| > max_z
    with enough history (>=5 prior samples).
    """
    field_path = check.get("field") or ""
    if not field_path:
        return None
    n = int(check.get("compare_n", 10))
    max_z = float(check.get("max_z_score", 3.0))

    current_value = _walk_dotted(payload, field_path)
    if not isinstance(current_value, (int, float)):
        return None

    history = _load_anomaly_history()
    field_history = list(history.get(field_path, []))

    anomaly_msg: str | None = None
    if len(field_history) >= 5:
        window = field_history[-n:]
        mean = sum(window) / len(window)
        variance = sum((v - mean) ** 2 for v in window) / len(window)
        stddev = variance ** 0.5
        if stddev > 0:
            z = abs((float(current_value) - mean) / stddev)
            if z > max_z:
                anomaly_msg = (
                    f"{field_path}={current_value} is {z:.2f}σ from mean "
                    f"{mean:.2f} (last {len(window)} values, stddev={stddev:.2f})"
                )

    if persist:
        field_history.append(float(current_value))
        history[field_path] = field_history[-n:]
        _save_anomaly_history(history)

    return anomaly_msg


def quality_gate_v2(post_id, content: str, payload: dict, config: dict) -> tuple[bool, list[dict]]:
    """Config-driven quality gate.

    Returns (passed, structured_failures). Each failure is
    {check, severity, detail}. Only severity=='block' counts against the gate.
    """
    failures: list[dict] = []

    for check in config.get("checks", []):
        if not isinstance(check, dict):
            continue
        check_name = check.get("name", "<unnamed>")
        check_type = check.get("type", "")
        severity = check.get("severity", "block")
        if not check.get("enabled", True):
            continue

        try:
            if check_type == "regex_absence":
                for pattern in check.get("patterns", []):
                    matches = re.findall(pattern, content or "", re.IGNORECASE)
                    if matches:
                        failures.append({
                            "check": check_name,
                            "severity": severity,
                            "detail": (
                                f"pattern {pattern!r} matched {len(matches)}x; "
                                f"sample={matches[:3]}"
                            ),
                        })

            elif check_type == "payload_field":
                field = check.get("field")
                expected = check.get("expected")
                op = check.get("op", "eq")
                actual = _walk_dotted(payload, field) if field else None
                fail = False
                if op == "eq" and actual != expected:
                    fail = True
                elif op == "neq" and actual == expected:
                    fail = True
                elif op == "gt" and not (isinstance(actual, (int, float)) and actual > expected):
                    fail = True
                elif op == "lt" and not (isinstance(actual, (int, float)) and actual < expected):
                    fail = True
                if fail:
                    failures.append({
                        "check": check_name,
                        "severity": severity,
                        "detail": f"{field}={actual!r} op={op} expected={expected!r}",
                    })

            elif check_type == "sector_sanity":
                sectors = payload.get("sectors", []) if isinstance(payload, dict) else []
                if sectors:
                    pct = float(check.get("min_nonzero_pct", 33))
                    required = max(1, int(pct * len(sectors) / 100))
                    nonzero = sum(
                        1 for s in sectors
                        if abs(float(s.get("day_change_pct", 0) or 0)) >= 0.01
                    )
                    if nonzero < required:
                        failures.append({
                            "check": check_name,
                            "severity": severity,
                            "detail": (
                                f"only {nonzero}/{len(sectors)} sectors nonzero "
                                f"(need >= {required})"
                            ),
                        })

            elif check_type == "freshness":
                field = check.get("field", "mpi")
                max_age = float(check.get("max_age_hours", 24))
                block = payload.get(field, {}) if isinstance(payload, dict) else {}
                ts_str = ""
                if isinstance(block, dict):
                    ts_str = str(block.get("computed_at") or block.get("asOf") or "")
                if ts_str:
                    try:
                        ca = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                        if ca.tzinfo is None:
                            ca = ca.replace(tzinfo=timezone.utc)
                        age_hours = (datetime.now(timezone.utc) - ca).total_seconds() / 3600.0
                        if age_hours > max_age:
                            failures.append({
                                "check": check_name,
                                "severity": severity,
                                "detail": f"{field} stale: {age_hours:.1f}h (max {max_age:.1f}h)",
                            })
                    except Exception as e:
                        failures.append({
                            "check": check_name,
                            "severity": "warn",
                            "detail": f"freshness parse error: {e}",
                        })

            elif check_type == "anomaly_structure":
                msg = detect_structural_anomaly(post_id, content or "", payload, check)
                if msg:
                    failures.append({"check": check_name, "severity": severity, "detail": msg})

            elif check_type == "anomaly_numerical":
                msg = detect_numerical_anomaly(payload, check, persist=True)
                if msg:
                    failures.append({"check": check_name, "severity": severity, "detail": msg})

            elif check_type == "word_count":
                stripped = re.sub(r"<[^>]+>", " ", content or "")
                word_count = len(re.findall(r"\w+", stripped))
                min_words = int(check.get("min", 200))
                max_words = int(check.get("max", 8000))
                if word_count < min_words:
                    failures.append({
                        "check": check_name,
                        "severity": severity,
                        "detail": f"too short: {word_count} words (min {min_words})",
                    })
                elif word_count > max_words:
                    failures.append({
                        "check": check_name,
                        "severity": severity,
                        "detail": f"too long: {word_count} words (max {max_words})",
                    })

            else:
                failures.append({
                    "check": check_name,
                    "severity": "warn",
                    "detail": f"unknown check type {check_type!r}",
                })

        except Exception as e:
            failures.append({
                "check": check_name,
                "severity": "warn",
                "detail": f"check error: {e}",
            })

    blocking = [f for f in failures if f.get("severity") == "block"]
    return (len(blocking) == 0, failures)


# -----------------------------------------------------------------------------
# QUALITY GATE — legacy 5-check shim + v2 dispatcher (backwards compatible).
# -----------------------------------------------------------------------------
def quality_gate(post_id, content: str, payload: dict) -> tuple[bool, list[str]]:
    """Returns (passed: bool, failures: list[str]).

    If quality_checks.yaml + PyYAML are available, delegates to quality_gate_v2
    and flattens structured failures into legacy string form (tagged with
    severity). Otherwise runs the original hardcoded five checks unchanged.
    """
    config = load_quality_checks()
    if config is not None:
        passed, structured = quality_gate_v2(post_id, content, payload, config)
        flat: list[str] = []
        for f in structured:
            flat.append(
                f"[{f.get('severity','?').upper()}] {f.get('check','?')}: {f.get('detail','')}"
            )
        return (passed, flat)

    # ------------------ Fallback: original 5-check gate ------------------
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
# Tier 1B — Versioned publishing + version manifest
# -----------------------------------------------------------------------------
# Every promote-to-publish writes an immutable version snapshot to:
#   - WP custom post meta (aztmm_* keys, show_in_rest=False)
#   - Git-tracked manifest at aztmm-daily-pulse-v2/data/versions/{YYYY-MM-DD}.json
#
# Hashes use SHA256. Version IDs are append-only. The data/versions manifest
# accumulates correction events later (see aztmm-versioning/detect_corrections.py).
def _sha256_short(s: str, n: int = 16) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:n]


def wp_set_post_meta(site: str, user: str, pw: str, post_id: int, key: str, value) -> bool:
    """Set a single custom post meta via WP REST API. Returns success bool."""
    url = f"https://{site}/wp-json/wp/v2/posts/{post_id}"
    try:
        r = requests.post(
            url, auth=(user, pw),
            json={"meta": {key: value}},
            timeout=20,
        )
        if r.status_code not in (200, 201):
            print(f"[publish_to_wp] wp_set_post_meta {key} -> HTTP {r.status_code}: {r.text[:200]}", file=sys.stderr)
            return False
        return True
    except Exception as e:
        print(f"[publish_to_wp] wp_set_post_meta {key} failed: {e}", file=sys.stderr)
        return False


def write_version_metadata(site: str, user: str, pw: str, post_id: int,
                           payload: dict, content_html: str,
                           manifest_dir: str = None) -> dict:
    """
    Write immutable version metadata to:
      1. WP custom post meta (aztmm_version_id, aztmm_content_hash, etc.)
      2. Git-tracked version manifest data/versions/{YYYY-MM-DD}.json

    Returns a dict with the version_event for downstream logging.
    """
    now = datetime.now(timezone.utc)
    content_hash = _sha256_short(content_html or "", 16)
    payload_hash = _sha256_short(
        json.dumps(payload, sort_keys=True, default=str), 16
    )
    version_id = now.strftime("%Y%m%d-%H%M%S") + "-" + content_hash[:8]
    run_id = os.environ.get("GITHUB_RUN_ID", "manual")

    meta_keys = {
        "aztmm_version_id":          version_id,
        "aztmm_content_hash":        content_hash,
        "aztmm_payload_hash":        payload_hash,
        "aztmm_published_at":        now.isoformat().replace("+00:00", "Z"),
        "aztmm_quality_gate_passed": "true",
        "aztmm_publish_run_id":      str(run_id),
    }

    meta_written = 0
    for k, v in meta_keys.items():
        if wp_set_post_meta(site, user, pw, post_id, k, v):
            meta_written += 1

    print(
        f"[publish_to_wp] version_id={version_id} content_hash={content_hash} "
        f"payload_hash={payload_hash} meta_written={meta_written}/{len(meta_keys)}",
        file=sys.stderr,
    )

    publish_event = {
        "version_id":          version_id,
        "published_at":        meta_keys["aztmm_published_at"],
        "content_hash":        content_hash,
        "payload_hash":        payload_hash,
        "quality_gate_passed": True,
        "run_id":              str(run_id),
        "meta_written":        f"{meta_written}/{len(meta_keys)}",
    }

    # Write/append to repo manifest data/versions/{YYYY-MM-DD}.json.
    # Daily Pulse "date" is the trading date inside the payload; fall back to
    # today UTC if not present.
    target_date = None
    if isinstance(payload, dict):
        target_date = payload.get("date") or payload.get("trading_date")
    if not target_date:
        target_date = now.strftime("%Y-%m-%d")
    target_date = str(target_date)[:10]

    if manifest_dir is None:
        # Default location relative to this file (works in CI checkout).
        script_dir = pathlib.Path(__file__).resolve().parent
        manifest_dir = str(script_dir / "data" / "versions")

    manifest_path = pathlib.Path(manifest_dir) / f"{target_date}.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    manifest = {
        "post_id": post_id,
        "trading_date": target_date,
        "publish_event": publish_event,
        "correction_events": [],
    }

    # If a manifest already exists (re-publish, watchdog retry), preserve
    # the original publish_event under a `superseded_publish_events` list and
    # append correction_events through.
    if manifest_path.exists():
        try:
            prior = json.loads(manifest_path.read_text())
            superseded = prior.get("superseded_publish_events", [])
            if prior.get("publish_event"):
                superseded.append(prior["publish_event"])
            manifest["superseded_publish_events"] = superseded
            manifest["correction_events"] = prior.get("correction_events", [])
        except Exception as e:
            print(f"[publish_to_wp] prior manifest unreadable, overwriting: {e}", file=sys.stderr)

    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n")
    print(f"[publish_to_wp] version manifest written: {manifest_path}", file=sys.stderr)

    return publish_event


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

    # Even when passed, surface any non-blocking notices (warn / log).
    if failures:
        print(
            f"[publish_to_wp] PHASE 2 OK — gate passed with {len(failures)} non-blocking notice(s):",
            file=sys.stderr,
        )
        for f_ in failures:
            print(f"  - {f_}", file=sys.stderr)
    else:
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

    # ------------------------------------------------------------------
    # PHASE 4 (Tier 1B) — Write immutable version metadata.
    # Best-effort: failure here does NOT undo the publish.
    # ------------------------------------------------------------------
    publish_event = {}
    try:
        # Prefer the final live HTML returned by promote (rendered) over the
        # draft snapshot, so the content_hash matches what subscribers see.
        final_content = (
            promote_body.get("content", {}).get("raw")
            or promote_body.get("content", {}).get("rendered")
            or live_content
            or payload.get("content", "")
        )
        publish_event = write_version_metadata(
            site, user, pw, post_id, payload, final_content,
        )
    except Exception as e:
        print(f"[publish_to_wp] PHASE 4 version metadata FAILED (non-fatal): {e}", file=sys.stderr)

    print(json.dumps({
        "status": "ok",
        "post_id": post_id,
        "link": promote_body.get("link", draft_link),
        "wp_status": promote_body.get("status"),
        "phase": "promoted",
        "quality_gate": "passed",
        "version_event": publish_event,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
