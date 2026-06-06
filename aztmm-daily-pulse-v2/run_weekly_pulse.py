"""
AZTMM Weekly Pulse — Orchestrator
==================================

Companion to run_daily_pulse.py. Runs the existing weekly_pulse_aggregator
end-to-end and emits a WP-ready payload to stdout — matching the daily
pulse payload shape so publish_to_wp.py can ingest it unchanged.

CLI:
  python3 run_weekly_pulse.py --week-ending 2026-06-05
  python3 run_weekly_pulse.py                          # auto-detects last Friday
  python3 run_weekly_pulse.py --out-dir publish-artifacts/

Auto-rolls non-Friday week-ending dates back to the most recent Friday so
GH-Actions cron delays don't break Saturday runs.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from weekly_pulse_aggregator import aggregate_week, SAMPLE_DIR, TEMPLATE_PATH
from daily_pulse_publisher import render_html, build_post_payload, brand_check

ROOT = Path(__file__).parent
logger = logging.getLogger("weekly_pulse.run")


def _last_friday_et() -> str:
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("America/New_York"))
    except ImportError:
        now = datetime.now(timezone.utc) - timedelta(hours=4)
    d = now.date()
    # weekday(): Mon=0..Sun=6. Friday=4.
    # If today IS Friday and before market close (~16:00 ET), the prior Friday
    # is safer. But the cron fires Saturday 09:00 ET, so today=Sat=5 -> roll to Fri.
    while d.weekday() != 4:
        d -= timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="AZTMM Weekly Pulse orchestrator")
    p.add_argument("--week-ending", default=None,
                   help="Friday date YYYY-MM-DD (default: most recent Friday in ET)")
    p.add_argument("--from-fixture", default=None)
    p.add_argument("--out-dir", default=None)
    p.add_argument("--status", default="publish",
                   help="WP status: 'publish' or 'draft' (default 'publish')")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    week_ending = args.week_ending or _last_friday_et()
    logger.info("week ending: %s", week_ending)

    # Validate: week-ending must be a Friday for the WP slug convention.
    d = datetime.strptime(week_ending, "%Y-%m-%d")
    if d.weekday() != 4:
        # roll back to the prior Friday
        while d.weekday() != 4:
            d -= timedelta(days=1)
        week_ending = d.strftime("%Y-%m-%d")
        logger.info("rolled week-ending back to Friday %s", week_ending)

    fixture = Path(args.from_fixture) if args.from_fixture else None
    agg = aggregate_week(week_ending, from_fixture=fixture)
    monday = agg["trading_days"][0]
    friday = agg["trading_days"][-1]

    # Render HTML via the shared template, then apply weekly-only string swaps.
    html = render_html(agg, TEMPLATE_PATH)
    html = html.replace("Today's Tell", "This Week's Tell")
    html = html.replace("Live &middot;", "Closing &middot;")
    html = html.replace("Tomorrow's Catalyst", "Next Week's Catalysts")
    html = html.replace("Closing Pulse", "Weekly Pulse")

    # Build payload, then OVERRIDE daily defaults for weekly framing.
    payload = build_post_payload(agg, html, status=args.status)
    # Title: "Weekly Pulse — Week of June 1–5, 2026"
    month_name = datetime.strptime(monday, "%Y-%m-%d").strftime("%B")
    m_day = datetime.strptime(monday, "%Y-%m-%d").day
    f_day = datetime.strptime(friday, "%Y-%m-%d").day
    year = datetime.strptime(friday, "%Y-%m-%d").year
    payload["title"] = f"Weekly Pulse — Week of {month_name} {m_day}–{f_day}, {year}"
    payload["slug"] = f"weekly-pulse-{monday}-to-{friday}"
    # Use numeric category IDs so WP REST API actually routes the post.
    # 730419629 = "Weekly Pulse" category on aztmm.com.
    payload["categories"] = [730419629]
    payload["tags"] = ["weekly-pulse"]
    payload["post_type"] = "weekly"  # signals to publish_to_wp.py the right default cat

    wrapped = {"_action": "wpcom.publish_post", "payload": payload}

    if args.out_dir:
        out = Path(args.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "payload.json").write_text(json.dumps(wrapped, indent=2, default=str))
        (out / f"weekly-pulse-{monday}-to-{friday}.html").write_text(html)
        (out / f"weekly-pulse-{monday}-to-{friday}.payload.json").write_text(
            json.dumps(wrapped, indent=2, default=str))
        # Brand check log
        bc = brand_check(html)
        (out / f"weekly-pulse-{monday}-to-{friday}.brand-check.json").write_text(
            json.dumps(bc, indent=2))

    # Emit to stdout for the GH Actions step
    print(json.dumps(wrapped, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
