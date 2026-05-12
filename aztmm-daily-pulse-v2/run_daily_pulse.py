"""
AZTMM Daily Pulse v2 — Orchestrator
====================================

Runs end-to-end:
  fetch -> aggregate -> render -> brand-check -> publish-draft

Logging:
  - Per-run JSON log: data/daily-pulse-logs/{date}.json
  - Per-incident JSON: data/incidents/{date}-{seq}.json

CLI:
  --dry-run        : do everything except publish
  --date YYYY-MM-DD: override target date (default: today UTC)
  --force-publish  : publish status='publish' (otherwise 'draft')

Publish step delegates to the wpcom-mcp-content-authoring MCP tool. This
orchestrator emits the payload to stdout in --dry-run; in live mode, the
caller (GH Actions workflow) wraps this script and forwards the payload
to the WP-MCP via a small shim. Decoupling keeps secrets out of this code.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from daily_pulse_fetcher import fetch_daily_data
from daily_pulse_aggregator import aggregate
from daily_pulse_publisher import (
    render_html,
    brand_check,
    build_post_payload,
    write_needs_review,
)

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
LOG_DIR = DATA_DIR / "daily-pulse-logs"
INCIDENT_DIR = DATA_DIR / "incidents"
NEEDS_REVIEW_DIR = DATA_DIR / "needs-review"
TEMPLATE_PATH = ROOT / "daily_pulse_template.html.j2"

logger = logging.getLogger("daily_pulse.run")


# ---------------------------------------------------------------------------
# Market-day predicate (best effort — no exchange-holiday calendar)
# ---------------------------------------------------------------------------

def _is_market_day(d: datetime) -> bool:
    return d.weekday() < 5  # Mon-Fri only


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Per-incident logging
# ---------------------------------------------------------------------------

def write_incident(date: str, reason: str, detail: dict) -> Path:
    INCIDENT_DIR.mkdir(parents=True, exist_ok=True)
    seq = int(time.time())
    p = INCIDENT_DIR / f"{date}-{seq}.json"
    p.write_text(json.dumps({"date": date, "reason": reason, "detail": detail}, indent=2, default=str))
    return p


def macos_notify(title: str, msg: str) -> None:
    """Best-effort macOS notification — never raises."""
    try:
        subprocess.run(
            ["osascript", "-e", f'display notification "{msg}" with title "{title}"'],
            check=False,
            timeout=5,
        )
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------------------
# Per-run logging
# ---------------------------------------------------------------------------

def write_run_log(date: str, log: dict) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"{date}.json"
    p.write_text(json.dumps(log, indent=2, default=str))
    return p


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Run AZTMM Daily Pulse v2")
    parser.add_argument("--date", default=None, help="YYYY-MM-DD (default: today UTC)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-publish", action="store_true",
                        help="Publish status='publish' (default: draft)")
    parser.add_argument("--out-dir", default=None,
                        help="If set, write rendered HTML and payload here")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    target_date = args.date or _today_utc()
    log = {
        "date": target_date,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "dry_run": args.dry_run,
        "force_publish": args.force_publish,
        "steps": [],
    }

    # 0. Skip if not a market day (best-effort weekday check)
    d = datetime.strptime(target_date, "%Y-%m-%d")
    if not _is_market_day(d):
        log["status"] = "skipped_non_market_day"
        write_run_log(target_date, log)
        logger.info("non-market day %s — skipping", target_date)
        return 0

    # 1. Fetch
    try:
        raw = fetch_daily_data(target_date)
        log["steps"].append({"step": "fetch", "ok": True,
                             "endpoints_ok": raw["data_quality"]["endpoints_ok"],
                             "endpoints_failed": raw["data_quality"]["endpoints_failed"]})
    except Exception as e:  # noqa: BLE001
        write_incident(target_date, "fetch_failed", {"err": str(e)})
        macos_notify("AZTMM Daily Pulse", f"Fetch failed for {target_date}: {e}")
        log["status"] = "fetch_failed"
        log["error"] = str(e)
        write_run_log(target_date, log)
        return 2

    # 1a. Optional prev-day fetch for DP deltas (best effort)
    prev_raw = None
    try:
        prev_raw = fetch_daily_data(raw["prev_date"])
        log["steps"].append({"step": "fetch_prev", "ok": True,
                             "endpoints_ok": prev_raw["data_quality"]["endpoints_ok"]})
    except Exception as e:  # noqa: BLE001
        log["steps"].append({"step": "fetch_prev", "ok": False, "error": str(e)})

    # 2. Aggregate
    try:
        agg = aggregate(raw, prev_raw)
        log["steps"].append({"step": "aggregate", "ok": True,
                             "scenario": agg["scenario"]["label"],
                             "score": agg["scenario"]["score"]})
    except Exception as e:  # noqa: BLE001
        write_incident(target_date, "aggregate_failed", {"err": str(e)})
        macos_notify("AZTMM Daily Pulse", f"Aggregate failed for {target_date}: {e}")
        log["status"] = "aggregate_failed"
        log["error"] = str(e)
        write_run_log(target_date, log)
        return 3

    # 3. Render
    try:
        html = render_html(agg, TEMPLATE_PATH)
        log["steps"].append({"step": "render", "ok": True, "html_bytes": len(html)})
    except Exception as e:  # noqa: BLE001
        write_incident(target_date, "render_failed", {"err": str(e)})
        log["status"] = "render_failed"
        log["error"] = str(e)
        write_run_log(target_date, log)
        return 4

    # 4. Brand check
    check = brand_check(html)
    log["steps"].append({"step": "brand_check", "ok": check["ok"], "hits": check["hits"]})
    if not check["ok"]:
        nr = write_needs_review(html, check["hits"], NEEDS_REVIEW_DIR, target_date)
        write_incident(target_date, "brand_check_failed",
                       {"hits": check["hits"], "needs_review_path": str(nr)})
        macos_notify("AZTMM Daily Pulse",
                     f"Brand check BLOCKED for {target_date}: {check['hits']}")
        log["status"] = "blocked_brand_check"
        write_run_log(target_date, log)
        logger.warning("brand check blocked publish; needs-review at %s", nr)
        return 5

    # 5. Build payload
    status = "publish" if args.force_publish else "draft"
    payload = build_post_payload(agg, html, status=status)
    log["payload"] = {k: v for k, v in payload.items() if k != "content"}
    log["payload"]["content_bytes"] = len(payload["content"])

    # 5a. Optional artifact write
    if args.out_dir:
        out = Path(args.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / f"daily-pulse-{target_date}.html").write_text(html)
        (out / f"daily-pulse-{target_date}-payload.json").write_text(
            json.dumps(payload, indent=2)
        )

    # 6. Publish (or dry-run print)
    if args.dry_run:
        log["status"] = "dry_run_ok"
        write_run_log(target_date, log)
        # Emit payload metadata only to stdout (NOT secrets/content)
        sys.stdout.write(json.dumps({
            "status": "dry_run_ok",
            "date": target_date,
            "scenario": agg["scenario"]["label"],
            "headline": agg["scenario"]["headline"],
            "html_bytes": len(html),
        }, indent=2))
        return 0

    # Live publish: the orchestrator delegates to a wrapper that wires
    # the wpcom-mcp-content-authoring MCP into the workflow. We emit the
    # payload as JSON on stdout for the wrapper to pick up.
    sys.stdout.write(json.dumps({
        "_action": "wpcom.publish_post",
        "payload": payload,
    }, indent=2))
    log["status"] = "payload_emitted"
    write_run_log(target_date, log)
    return 0


if __name__ == "__main__":
    sys.exit(main())
