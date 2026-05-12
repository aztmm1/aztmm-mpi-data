"""
AZTMM Congress Trades Tracker - Orchestrator
=============================================

End-to-end:
  fetch -> aggregate -> render -> brand-check -> dual-output write

CLI:
  --date YYYY-MM-DD : target date (default: today UTC)
  --dry-run         : do everything except WP push (always safe locally)
  --force-publish   : status='publish' on the WP page (default: draft)
  --out-dir         : override output dir (default: sample-output/)

Idempotent: re-running with the same --date overwrites the same dated files.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

# Local imports (this directory)
sys.path.insert(0, str(Path(__file__).parent))

from fetcher import fetch_daily_data  # noqa: E402
from aggregator import aggregate  # noqa: E402
from publisher import (  # noqa: E402
    render_html,
    brand_check,
    sanitize_public_json,
    build_page_payload,
    write_needs_review,
    update_history,
    build_sparkline_context,
)

ROOT = Path(__file__).parent
DEFAULT_CONFIG = ROOT / "config.yml"
DEFAULT_TEMPLATE = ROOT / "dashboard.html.j2"
DEFAULT_OUT_DIR = ROOT / "sample-output"
NEEDS_REVIEW_DIR = ROOT / "data" / "needs-review"
LOG_DIR = ROOT / "data" / "run-logs"
HISTORY_PATH = ROOT / "data" / "history.json"

logger = logging.getLogger("congress.run")


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _is_market_day(d: datetime) -> bool:
    return d.weekday() < 5


def _write_run_log(date: str, log: dict) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    p = LOG_DIR / f"{date}.json"
    p.write_text(json.dumps(log, indent=2, default=str))
    return p


def _load_config(path: Path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def _stub_raw(date_str: str) -> dict:
    """When UW_API_KEY is missing OR fetch is skipped, build a minimal stub.
    The stub uses the response shape verified by the probe (recent-trades),
    so the rest of the pipeline (aggregator, publisher) runs end-to-end."""
    sample = [
        {"name": "Tina Smith", "ticker": "DXCM", "issuer": "spouse", "is_active": True,
         "transaction_date": "2026-05-07", "politician_id": "stub-1",
         "reporter": "Tina Smith", "txn_type": "Sell",
         "amounts": "$100,001 - $250,000", "notes": "DexCom, Inc. - Common Stock",
         "filed_at_date": date_str, "member_type": "senate"},
        {"name": "Tina Smith", "ticker": "PODD", "issuer": "spouse", "is_active": True,
         "transaction_date": "2026-05-07", "politician_id": "stub-1",
         "reporter": "Tina Smith", "txn_type": "Sell",
         "amounts": "$100,001 - $250,000", "notes": "Insulet Corporation - Common Stock",
         "filed_at_date": date_str, "member_type": "senate"},
        {"name": "Greg Stanton", "ticker": "TCNNF", "issuer": "spouse",
         "is_active": True, "transaction_date": "2026-05-06",
         "politician_id": "stub-2", "reporter": "Hon. Greg Stanton",
         "txn_type": "Sell", "amounts": "$15,001 - $50,000",
         "notes": "TRULIEVE CANNABIS CORP", "filed_at_date": date_str,
         "member_type": "house"},
        {"name": "Nancy Pelosi", "ticker": "NVDA", "issuer": "spouse",
         "is_active": True, "transaction_date": "2026-05-02",
         "politician_id": "stub-3", "reporter": "Hon. Nancy Pelosi",
         "txn_type": "Purchase", "amounts": "$1,000,001 - $5,000,000",
         "notes": "NVIDIA Corporation - Common Stock",
         "filed_at_date": date_str, "member_type": "house"},
        {"name": "Josh Gottheimer", "ticker": "NVDA", "issuer": "self",
         "is_active": True, "transaction_date": "2026-05-05",
         "politician_id": "stub-4", "reporter": "Hon. Josh Gottheimer",
         "txn_type": "Purchase", "amounts": "$15,001 - $50,000",
         "notes": "NVIDIA Corporation - Common Stock",
         "filed_at_date": date_str, "member_type": "house"},
        {"name": "Daniel Goldman", "ticker": "AAPL", "issuer": "joint",
         "is_active": True, "transaction_date": "2026-05-04",
         "politician_id": "stub-5", "reporter": "Hon. Daniel Goldman",
         "txn_type": "Purchase", "amounts": "$50,001 - $100,000",
         "notes": "Apple Inc. - Common Stock",
         "filed_at_date": date_str, "member_type": "house"},
        {"name": "Susan Collins", "ticker": "JPM", "issuer": "spouse",
         "is_active": True, "transaction_date": "2026-05-03",
         "politician_id": "stub-6", "reporter": "Susan Collins",
         "txn_type": "Sell", "amounts": "$500,001 - $1,000,000",
         "notes": "JPMorgan Chase & Co.",
         "filed_at_date": date_str, "member_type": "senate"},
    ]
    late = [
        {"name": "Donald J Trump", "ticker": None, "issuer": "undisclosed",
         "transaction_date": "2026-03-10", "politician_id": "stub-x",
         "reporter": "Donald J Trump", "txn_type": "Buy",
         "amounts": "$500,001 - $1,000,000", "notes": "BLACK BELT MUNI BOND",
         "filed_at_date": date_str, "member_type": "executive"},
    ]
    return {
        "date": date_str,
        "recent_trades": sample,
        "late_reports": late,
        "trader_view": sample,
        "member_views": {},
        "data_quality": {
            "endpoints_ok": 0, "endpoints_failed": 0,
            "failures": [], "degraded": False,
            "stub": True,
        },
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run AZTMM Congress Watch")
    parser.add_argument("--date", default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-publish", action="store_true")
    parser.add_argument("--out-dir", default=None)
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--template", default=str(DEFAULT_TEMPLATE))
    parser.add_argument("--use-stub", action="store_true",
                        help="Skip network calls and use stub data (for testing).")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    target_date = args.date or _today_utc()
    out_dir = Path(args.out_dir) if args.out_dir else DEFAULT_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    log: dict = {
        "date": target_date,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "dry_run": args.dry_run,
        "force_publish": args.force_publish,
        "steps": [],
    }

    # 0. Skip if not a market day
    d = datetime.strptime(target_date, "%Y-%m-%d")
    if not _is_market_day(d):
        log["status"] = "skipped_non_market_day"
        _write_run_log(target_date, log)
        logger.info("non-market day %s - skipping", target_date)
        return 0

    # 1. Config
    try:
        cfg = _load_config(Path(args.config))
        log["steps"].append({"step": "load_config", "ok": True})
    except Exception as e:  # noqa: BLE001
        log["status"] = "config_failed"
        log["error"] = str(e)
        _write_run_log(target_date, log)
        return 2

    # 2. Fetch (or stub)
    use_stub = args.use_stub or not (
        os.environ.get("UW_API_KEY") or os.environ.get("UW_API_TOKEN")
    )
    try:
        if use_stub:
            raw = _stub_raw(target_date)
            log["steps"].append({"step": "fetch", "ok": True, "mode": "stub"})
        else:
            raw = fetch_daily_data(target_date, member_drilldown_limit=3)
            log["steps"].append({
                "step": "fetch", "ok": True, "mode": "live",
                "endpoints_ok": raw["data_quality"]["endpoints_ok"],
                "endpoints_failed": raw["data_quality"]["endpoints_failed"],
            })
    except Exception as e:  # noqa: BLE001
        log["status"] = "fetch_failed"
        log["error"] = str(e)
        _write_run_log(target_date, log)
        return 3

    # 3. Aggregate
    try:
        result = aggregate(raw, cfg)
        public = result["public"]
        internal = result["internal"]
        log["steps"].append({
            "step": "aggregate", "ok": True,
            "filings_today": public["summary"]["filings_today"],
            "clusters": len(public["notable"]["ticker_clusters"]),
            "large": public["summary"]["large_filings_today"],
            "late": public["summary"]["late_filings_today"],
        })
    except Exception as e:  # noqa: BLE001
        log["status"] = "aggregate_failed"
        log["error"] = str(e)
        _write_run_log(target_date, log)
        return 4

    # 3a. Sanitize public payload (belt-and-suspenders, before render)
    public_sanitized = sanitize_public_json(public)

    # 3b. Update rolling history + build sparkline context
    try:
        headline = public_sanitized.get("headline_metric") or {}
        history_data = update_history(
            HISTORY_PATH,
            tracker_slug="congress-trades-tracker",
            label=headline.get("label", "Filings filed today"),
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
            "headline_metric_label": "Filings filed today",
            "sparkline_placeholder": "Building history - sparkline appears after a few days.",
        }
        log["steps"].append({"step": "update_history", "ok": False, "error": str(e)})

    # 4. Render HTML
    try:
        render_ctx = {**public_sanitized, **sparkline_ctx}
        html = render_html(render_ctx, args.template)
        log["steps"].append({"step": "render", "ok": True, "html_bytes": len(html)})
    except Exception as e:  # noqa: BLE001
        log["status"] = "render_failed"
        log["error"] = str(e)
        _write_run_log(target_date, log)
        return 5

    # 5. Brand-policy scrub on rendered HTML
    chk = brand_check(html)
    log["steps"].append({"step": "brand_check", "ok": chk["ok"], "hits": chk["hits"]})
    if not chk["ok"]:
        nr = write_needs_review(html, chk["hits"], NEEDS_REVIEW_DIR, target_date)
        log["status"] = "blocked_brand_check"
        log["needs_review_path"] = str(nr)
        _write_run_log(target_date, log)
        logger.warning("BRAND-POLICY BLOCK: %s", chk["hits"])
        return 6

    # 6. Dual-output write
    public_path = out_dir / f"congress-{target_date}.public.json"
    internal_path = out_dir / f"congress-{target_date}.internal.json"
    html_path = out_dir / f"congress-{target_date}.html"

    public_path.write_text(json.dumps(public_sanitized, indent=2, default=str))
    internal_path.write_text(json.dumps(internal, indent=2, default=str))
    html_path.write_text(html)
    log["steps"].append({
        "step": "write_outputs", "ok": True,
        "public": str(public_path), "internal": str(internal_path),
        "html": str(html_path),
    })

    # 7. WP payload (emitted on stdout in dry-run)
    payload = build_page_payload(
        public_sanitized,
        html,
        slug="congress-watch",
    )
    payload_path = out_dir / f"congress-{target_date}-wp-payload.json"
    payload_path.write_text(json.dumps(
        {"_action": "wpcom.upsert_page", "payload": payload}, indent=2,
    ))

    if args.dry_run:
        log["status"] = "dry_run_ok"
        _write_run_log(target_date, log)
        sys.stdout.write(json.dumps({
            "status": "dry_run_ok",
            "date": target_date,
            "public_path": str(public_path),
            "internal_path": str(internal_path),
            "html_path": str(html_path),
            "filings_today": public["summary"]["filings_today"],
            "clusters": len(public["notable"]["ticker_clusters"]),
            "brand_check_ok": True,
        }, indent=2))
        return 0

    # Live publish: emit payload metadata; orchestrator wraps wpcom-MCP.
    log["status"] = "payload_emitted"
    if args.force_publish:
        payload["status"] = "publish"
    sys.stdout.write(json.dumps({
        "_action": "wpcom.upsert_page",
        "payload": {k: v for k, v in payload.items() if k != "content"},
        "content_bytes": len(payload["content"]),
    }, indent=2))
    _write_run_log(target_date, log)
    return 0


if __name__ == "__main__":
    sys.exit(main())
