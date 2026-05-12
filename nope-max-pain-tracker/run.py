"""
AZTMM NOPE & Max-Pain Tracker — Orchestrator
=============================================

Runs end-to-end:
  fetch -> aggregate -> dual-output write -> render -> brand-check -> publish

Outputs written:
  - sample-output/nope-maxpain-{date}.internal.json   (raw, repo-only)
  - sample-output/nope-maxpain-{date}.public.json     (scrubbed, jsDelivr)
  - sample-output/nope-maxpain-{date}.html            (rendered page)
  - sample-output/latest.json                          (symlink-style copy)

CLI:
  --date YYYY-MM-DD : target date (default: today UTC)
  --dry-run         : do everything except publish
  --force-publish   : update WP page (else only emit payload)
  --tickers CSV     : override ticker list (default: from config.yml)
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

import yaml

from fetcher import fetch_all
from aggregator import aggregate
from publisher import (
    render_html,
    brand_check,
    brand_check_public_json,
    build_page_payload,
    write_needs_review,
    update_history,
    build_sparkline_context,
)

ROOT = Path(__file__).parent
CONFIG_PATH = ROOT / "config.yml"
TEMPLATE_PATH = ROOT / "dashboard.html.j2"
SAMPLE_DIR = ROOT / "sample-output"
DATA_DIR = ROOT / "data"
LOG_DIR = DATA_DIR / "logs"
INCIDENT_DIR = DATA_DIR / "incidents"
NEEDS_REVIEW_DIR = DATA_DIR / "needs-review"
HISTORY_PATH = DATA_DIR / "history.json"

logger = logging.getLogger("nope_max_pain.run")


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _is_market_day(d: datetime) -> bool:
    return d.weekday() < 5


def write_run_log(date: str, log: dict) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"{date}.json"
    p.write_text(json.dumps(log, indent=2, default=str))
    return p


def write_incident(date: str, reason: str, detail: dict) -> Path:
    INCIDENT_DIR.mkdir(parents=True, exist_ok=True)
    seq = int(time.time())
    p = INCIDENT_DIR / f"{date}-{seq}.json"
    p.write_text(json.dumps({"date": date, "reason": reason, "detail": detail}, indent=2, default=str))
    return p


def macos_notify(title: str, msg: str) -> None:
    try:
        subprocess.run(
            ["osascript", "-e", f'display notification "{msg}" with title "{title}"'],
            check=False, timeout=5,
        )
    except Exception:  # noqa: BLE001
        pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-publish", action="store_true")
    parser.add_argument("--tickers", default=None,
                        help="CSV override of full ticker universe")
    parser.add_argument("--no-fetch", action="store_true",
                        help="Skip fetching; expect cached raw JSON in data/raw/{date}.json")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    with open(CONFIG_PATH) as f:
        config = yaml.safe_load(f)

    if args.tickers:
        override = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
        # Split user override back into index_tickers/megacap_tickers, prefer order
        config["index_tickers"] = [t for t in override if t in ("SPY", "QQQ", "IWM")]
        config["megacap_tickers"] = [t for t in override if t not in ("SPY", "QQQ", "IWM")]

    target_date = args.date or _today_utc()
    log = {
        "date": target_date,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "dry_run": args.dry_run,
        "force_publish": args.force_publish,
        "steps": [],
    }

    d = datetime.strptime(target_date, "%Y-%m-%d")
    if not _is_market_day(d):
        log["status"] = "skipped_non_market_day"
        write_run_log(target_date, log)
        logger.info("non-market day %s — skipping", target_date)
        return 0

    # 1. Fetch
    tickers = config["index_tickers"] + config["megacap_tickers"]
    raw_cache = DATA_DIR / "raw" / f"{target_date}.json"
    raw: dict
    if args.no_fetch and raw_cache.exists():
        raw = json.loads(raw_cache.read_text())
        log["steps"].append({"step": "fetch", "ok": True, "cached": True})
    else:
        try:
            raw = fetch_all(tickers, target_date)
            raw_cache.parent.mkdir(parents=True, exist_ok=True)
            raw_cache.write_text(json.dumps(raw, indent=2, default=str))
            log["steps"].append({
                "step": "fetch", "ok": True,
                "endpoints_ok": raw["data_quality"]["endpoints_ok"],
                "endpoints_failed": raw["data_quality"]["endpoints_failed"],
                "failures": raw["data_quality"]["failures"][:10],
            })
        except Exception as e:  # noqa: BLE001
            write_incident(target_date, "fetch_failed", {"err": str(e)})
            macos_notify("AZTMM Options Gravity", f"Fetch failed for {target_date}: {e}")
            log["status"] = "fetch_failed"
            log["error"] = str(e)
            write_run_log(target_date, log)
            return 2

    # 2. Aggregate
    try:
        result = aggregate(raw, config)
        log["steps"].append({
            "step": "aggregate", "ok": True,
            "tickers_seen": len(result["public"]["tickers"]),
            "commentary_lines": len(result["public"]["commentary"]),
        })
    except Exception as e:  # noqa: BLE001
        write_incident(target_date, "aggregate_failed", {"err": str(e)})
        log["status"] = "aggregate_failed"
        log["error"] = str(e)
        write_run_log(target_date, log)
        return 3

    # 3. Dual-output write (idempotent on date)
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)
    internal_path = SAMPLE_DIR / f"nope-maxpain-{target_date}.internal.json"
    public_path = SAMPLE_DIR / f"nope-maxpain-{target_date}.public.json"
    internal_path.write_text(json.dumps(result["internal"], indent=2, default=str))
    public_path.write_text(json.dumps(result["public"], indent=2, default=str))
    # `latest.json` copy for the page's default snapshot URL
    (SAMPLE_DIR / "latest.json").write_text(json.dumps(result["public"], indent=2, default=str))
    log["steps"].append({"step": "write_jsons", "ok": True})

    # 4. Brand-check the public JSON
    json_check = brand_check_public_json(result["public"])
    log["steps"].append({"step": "brand_check_json", "ok": json_check["ok"], "hits": json_check["hits"]})
    if not json_check["ok"]:
        write_incident(target_date, "brand_check_json_failed",
                       {"hits": json_check["hits"]})
        macos_notify("AZTMM Options Gravity",
                     f"Brand check (JSON) BLOCKED for {target_date}: {json_check['hits']}")
        log["status"] = "blocked_brand_check_json"
        write_run_log(target_date, log)
        return 5

    # 4b. Update rolling history + build sparkline context
    try:
        headline = result["public"].get("headline_metric") or {}
        history_data = update_history(
            HISTORY_PATH,
            tracker_slug="nope-max-pain-tracker",
            label=headline.get("label", "SPY NOPE reading"),
            date=target_date,
            value=headline.get("value"),
        )
        sparkline_ctx = build_sparkline_context(history_data, lookback=30)
        log["steps"].append({
            "step": "update_history", "ok": True,
            "points": len(history_data.get("points", [])),
            "sparkline_available": sparkline_ctx.get("sparkline_available", False),
        })
    except Exception as e:  # noqa: BLE001
        sparkline_ctx = {
            "sparkline_available": False,
            "headline_metric_label": "SPY NOPE reading",
            "sparkline_placeholder": "Building history - sparkline appears after a few days.",
        }
        log["steps"].append({"step": "update_history", "ok": False, "error": str(e)})

    # 5. Render
    try:
        render_ctx = {**result["public"], **sparkline_ctx}
        html = render_html(render_ctx, TEMPLATE_PATH)
        log["steps"].append({"step": "render", "ok": True, "html_bytes": len(html)})
    except Exception as e:  # noqa: BLE001
        write_incident(target_date, "render_failed", {"err": str(e)})
        log["status"] = "render_failed"
        log["error"] = str(e)
        write_run_log(target_date, log)
        return 4

    html_path = SAMPLE_DIR / f"nope-maxpain-{target_date}.html"
    html_path.write_text(html)
    log["steps"].append({"step": "write_html", "ok": True})

    # 6. Brand-check the rendered HTML
    html_check = brand_check(html)
    log["steps"].append({"step": "brand_check_html", "ok": html_check["ok"], "hits": html_check["hits"]})
    if not html_check["ok"]:
        nr = write_needs_review(html, html_check["hits"], NEEDS_REVIEW_DIR, target_date)
        write_incident(target_date, "brand_check_failed",
                       {"hits": html_check["hits"], "needs_review_path": str(nr)})
        macos_notify("AZTMM Options Gravity",
                     f"Brand check BLOCKED for {target_date}: {html_check['hits']}")
        log["status"] = "blocked_brand_check"
        write_run_log(target_date, log)
        logger.warning("brand check blocked publish; needs-review at %s", nr)
        return 5

    # 7. Build WP payload + (optional) publish
    page_id_env = os.environ.get("AZTMM_OPTIONS_GRAVITY_PAGE_ID")
    page_id = int(page_id_env) if page_id_env and page_id_env.isdigit() else None
    payload = build_page_payload(result["public"], html, page_id=page_id)
    log["payload"] = {k: v for k, v in payload.items() if k != "content"}
    log["payload"]["content_bytes"] = len(payload["content"])

    if args.dry_run or not args.force_publish:
        log["status"] = "dry_run_ok" if args.dry_run else "payload_emitted"
        write_run_log(target_date, log)
        sys.stdout.write(json.dumps({
            "status": log["status"],
            "date": target_date,
            "html_bytes": len(html),
            "public_path": str(public_path),
            "internal_path": str(internal_path),
            "html_path": str(html_path),
            "commentary_lines": len(result["public"]["commentary"]),
        }, indent=2))
        return 0

    # Live publish handled by the GH Actions wrapper (see workflow.yml)
    sys.stdout.write(json.dumps({
        "_action": "wpcom.update_page",
        "payload": payload,
    }, indent=2))
    log["status"] = "payload_emitted"
    write_run_log(target_date, log)
    return 0


if __name__ == "__main__":
    sys.exit(main())
