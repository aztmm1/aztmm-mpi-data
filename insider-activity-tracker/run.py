"""
AZTMM Insider Activity — orchestrator

Runs end-to-end:
  fetch -> aggregate -> render -> brand-check -> dual-output write

CLI:
  --week-ending YYYY-MM-DD   target Friday (default: most recent Friday <= today UTC)
  --dry-run                  do everything except write final outputs
  --force-publish            reserved for the GH workflow wrapper
  --force-refresh            re-run even if dated artefact exists
  --out-dir PATH             override sample-output

Idempotent: re-running for the same week-ending date overwrites the
dated artefacts.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fetcher import fetch_all
from aggregator import aggregate
from publisher import render_html, brand_check, write_outputs

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
LOG_DIR = DATA_DIR / "logs"
SAMPLE_DIR = ROOT / "sample-output"
TEMPLATE_PATH = ROOT / "dashboard.html.j2"

logger = logging.getLogger("insider.run")


def _most_recent_friday(today: datetime | None = None) -> str:
    today = today or datetime.now(timezone.utc)
    # weekday(): Mon=0..Sun=6. Want most recent Friday <= today.
    days_back = (today.weekday() - 4) % 7
    fri = today - timedelta(days=days_back)
    return fri.strftime("%Y-%m-%d")


def write_run_log(week_ending: str, log: dict) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"{week_ending}.json"
    p.write_text(json.dumps(log, indent=2, default=str))
    return p


def main() -> int:
    parser = argparse.ArgumentParser(description="Run AZTMM Insider Activity")
    parser.add_argument("--week-ending", default=None,
                        help="YYYY-MM-DD Friday (default: most recent Friday)")
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

    week_ending = args.week_ending or _most_recent_friday()
    out_dir = Path(args.out_dir) if args.out_dir else SAMPLE_DIR

    log: dict = {
        "week_ending": week_ending,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "dry_run": args.dry_run,
        "steps": [],
    }

    # 0a. Idempotency guard
    pub_path = out_dir / f"insider-{week_ending}.public.json"
    if pub_path.exists() and not args.force_refresh:
        log["status"] = "skipped_already_ran"
        log["existing_path"] = str(pub_path)
        write_run_log(week_ending, log)
        sys.stdout.write(json.dumps({
            "status": "skipped_already_ran",
            "week_ending": week_ending,
            "existing_path": str(pub_path),
            "hint": "pass --force-refresh to re-run",
        }, indent=2))
        sys.stdout.write("\n")
        return 0

    # 1. Fetch
    try:
        bundle = fetch_all(week_ending)
        log["steps"].append({
            "step": "fetch", "ok": True,
            "raw_transactions": len(bundle.get("transactions") or []),
            "window_start": bundle.get("window_start"),
            "window_end": bundle.get("window_end"),
            "fallback_used": bundle.get("fallback_used", False),
            "endpoints_ok": bundle["data_quality"]["endpoints_ok"],
            "endpoints_failed": bundle["data_quality"]["endpoints_failed"],
        })
    except Exception as e:  # noqa: BLE001
        log["status"] = "fetch_failed"
        log["error"] = str(e)
        write_run_log(week_ending, log)
        logger.error("fetch failed: %s", e)
        return 2

    # 2. Aggregate
    try:
        agg = aggregate(bundle)
        log["steps"].append({
            "step": "aggregate", "ok": True,
            "buyers_public": len(agg["public"]["buyers"]),
            "sellers_public": len(agg["public"]["sellers"]),
            "qualifying_filings": agg["public"]["tape_totals"]["qualifying_filings"],
        })
    except Exception as e:  # noqa: BLE001
        log["status"] = "aggregate_failed"
        log["error"] = str(e)
        write_run_log(week_ending, log)
        logger.error("aggregate failed: %s", e)
        return 3

    # 3. Render
    try:
        html = render_html(agg["public"], TEMPLATE_PATH)
        log["steps"].append({"step": "render", "ok": True, "html_bytes": len(html)})
    except Exception as e:  # noqa: BLE001
        log["status"] = "render_failed"
        log["error"] = str(e)
        write_run_log(week_ending, log)
        logger.error("render failed: %s", e)
        return 4

    # 4. Brand check
    check = brand_check(html)
    log["steps"].append({"step": "brand_check", "ok": check["ok"], "hits": check["hits"]})
    if not check["ok"]:
        log["status"] = "blocked_brand_check"
        write_run_log(week_ending, log)
        logger.error("BRAND CHECK BLOCKED publish; hits=%s", check["hits"])
        (DATA_DIR / "needs-review").mkdir(parents=True, exist_ok=True)
        nr_path = DATA_DIR / "needs-review" / f"insider-{week_ending}-NEEDS-REVIEW.html"
        nr_path.write_text(
            f"<!-- BRAND-POLICY BLOCK: hits = {check['hits']!r} -->\n" + html
        )
        return 5

    # 5. Write dual outputs
    if not args.dry_run:
        paths = write_outputs(agg, html, out_dir, week_ending)
        log["steps"].append({"step": "write_outputs", "ok": True, "paths": paths})
        log["status"] = "payload_emitted"
    else:
        paths = {}
        log["status"] = "dry_run_ok"

    write_run_log(week_ending, log)

    sys.stdout.write(json.dumps({
        "status": log["status"],
        "week_ending": week_ending,
        "buyers_public": len(agg["public"]["buyers"]),
        "sellers_public": len(agg["public"]["sellers"]),
        "summary": agg["public"]["summary_line"],
        "paths": paths,
        "brand_check": check,
    }, indent=2))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
