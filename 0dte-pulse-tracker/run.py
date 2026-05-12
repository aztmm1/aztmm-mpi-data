"""
AZTMM 0DTE Pulse — orchestrator

Runs end-to-end:
  fetch -> aggregate -> render -> brand-check -> dual-output write

CLI:
  --date YYYY-MM-DD   target date (default: today UTC)
  --dry-run           do everything except write final outputs
  --force-publish     reserved for the GH workflow wrapper
  --force-refresh     re-run even if dated artefact exists
  --out-dir PATH      override sample-output

Idempotent: re-running for the same date overwrites the dated artefacts.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from fetcher import fetch_all
from aggregator import aggregate
from publisher import (
    render_html,
    brand_check,
    write_outputs,
    update_history,
    build_sparkline_context,
)

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
LOG_DIR = DATA_DIR / "logs"
SAMPLE_DIR = ROOT / "sample-output"
TEMPLATE_PATH = ROOT / "dashboard.html.j2"
HISTORY_PATH = DATA_DIR / "history.json"

logger = logging.getLogger("zerodte.run")


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _is_market_day(d: datetime) -> bool:
    return d.weekday() < 5


def write_run_log(date: str, log: dict) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"{date}.json"
    p.write_text(json.dumps(log, indent=2, default=str))
    return p


def main() -> int:
    parser = argparse.ArgumentParser(description="Run AZTMM 0DTE Pulse")
    parser.add_argument("--date", default=None, help="YYYY-MM-DD (default: today UTC)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-publish", action="store_true", help="reserved")
    parser.add_argument("--out-dir", default=None,
                        help="Override output directory (default: sample-output/)")
    parser.add_argument("--force-refresh", action="store_true",
                        help="Re-run even if the dated public artefact already exists")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    target_date = args.date or _today_utc()
    out_dir = Path(args.out_dir) if args.out_dir else SAMPLE_DIR

    log = {
        "date": target_date,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "dry_run": args.dry_run,
        "steps": [],
    }

    d = datetime.strptime(target_date, "%Y-%m-%d")
    if not _is_market_day(d):
        log["status"] = "skipped_non_market_day"
        write_run_log(target_date, log)
        logger.info("non-market day %s — skipping", target_date)
        return 0

    # 0a. Idempotency guard
    pub_path = out_dir / f"0dte-{target_date}.public.json"
    if pub_path.exists() and not args.force_refresh:
        log["status"] = "skipped_already_ran"
        log["existing_path"] = str(pub_path)
        write_run_log(target_date, log)
        sys.stdout.write(json.dumps({
            "status": "skipped_already_ran",
            "date": target_date,
            "existing_path": str(pub_path),
            "hint": "pass --force-refresh to re-run",
        }, indent=2))
        sys.stdout.write("\n")
        return 0

    # 1. Fetch
    try:
        bundle = fetch_all(target_date)
        log["steps"].append({
            "step": "fetch", "ok": True,
            "raw_alerts": len(bundle.get("alerts") or []),
            "endpoints_ok": bundle["data_quality"]["endpoints_ok"],
            "endpoints_failed": bundle["data_quality"]["endpoints_failed"],
        })
    except Exception as e:  # noqa: BLE001
        log["status"] = "fetch_failed"
        log["error"] = str(e)
        write_run_log(target_date, log)
        logger.error("fetch failed: %s", e)
        return 2

    # 2. Aggregate
    try:
        agg = aggregate(bundle)
        log["steps"].append({
            "step": "aggregate", "ok": True,
            "rows_public": len(agg["public"]["rows"]),
            "rows_internal": len(agg["internal"]["rows"]),
        })
    except Exception as e:  # noqa: BLE001
        log["status"] = "aggregate_failed"
        log["error"] = str(e)
        write_run_log(target_date, log)
        logger.error("aggregate failed: %s", e)
        return 3

    # 2b. Update rolling history + build sparkline context
    try:
        headline = agg["public"].get("headline_metric") or {}
        history_data = update_history(
            HISTORY_PATH,
            tracker_slug="0dte-pulse-tracker",
            label=headline.get("label", "Total 0DTE notable premium ($M)"),
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
            "headline_metric_label": "Total 0DTE notable premium ($M)",
            "sparkline_placeholder": "Building history - sparkline appears after a few days.",
        }
        log["steps"].append({"step": "update_history", "ok": False, "error": str(e)})

    # 3. Render
    try:
        render_ctx = {**agg["public"], **sparkline_ctx}
        html = render_html(render_ctx, TEMPLATE_PATH)
        log["steps"].append({"step": "render", "ok": True, "html_bytes": len(html)})
    except Exception as e:  # noqa: BLE001
        log["status"] = "render_failed"
        log["error"] = str(e)
        write_run_log(target_date, log)
        logger.error("render failed: %s", e)
        return 4

    # 4. Brand check
    check = brand_check(html)
    log["steps"].append({"step": "brand_check", "ok": check["ok"], "hits": check["hits"]})
    if not check["ok"]:
        log["status"] = "blocked_brand_check"
        write_run_log(target_date, log)
        logger.error("BRAND CHECK BLOCKED publish; hits=%s", check["hits"])
        (DATA_DIR / "needs-review").mkdir(parents=True, exist_ok=True)
        nr_path = DATA_DIR / "needs-review" / f"0dte-{target_date}-NEEDS-REVIEW.html"
        nr_path.write_text(
            f"<!-- BRAND-POLICY BLOCK: hits = {check['hits']!r} -->\n" + html
        )
        return 5

    # 5. Write dual outputs
    paths = write_outputs(agg, html, out_dir, target_date)
    log["steps"].append({"step": "write_outputs", "ok": True, "paths": paths})

    if args.dry_run:
        log["status"] = "dry_run_ok"
    else:
        log["status"] = "payload_emitted"

    write_run_log(target_date, log)

    sys.stdout.write(json.dumps({
        "status": log["status"],
        "date": target_date,
        "rows_public": len(agg["public"]["rows"]),
        "summary": agg["public"]["summary_line"],
        "paths": paths,
        "brand_check": check,
    }, indent=2))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
