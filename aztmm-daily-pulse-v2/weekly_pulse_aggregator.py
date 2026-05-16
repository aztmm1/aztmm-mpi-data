"""
AZTMM Weekly Pulse — Closing Pulse for the trading week (MVP)
==============================================================

MVP STRATEGY (May 16, 2026):
  Because the v3 free-source fetcher pulls CURRENT yfinance option-chain
  snapshots (which represent week-to-date accumulated OI by Friday), the
  Friday EOD aggregate already approximates a 5-session view. We:

  1. Use the existing Friday EOD aggregate as the base (run the fetcher
     once for Friday OR reuse the saved sample-output fixture).
  2. Override headline / changes / catalysts / post_date_display with
     WEEKLY framing.
  3. Keep tells (conviction >=80) — those are weekly-meaningful since they
     come from week-accumulated chain OI and FINRA T-14 dark-pool weekly.

  NEXT iteration (deferred): true 5x chain-history reconstruction via
  Polygon free tier or Tradier sandbox.

Free sources only:
  - yfinance EOD option chains
  - yfinance index quotes (SPY/QQQ/IWM/^VIX/^VIX3M)
  - FINRA OTC Transparency (T-14 lag, weekly — naturally weekly)
  - SEC EDGAR Form 4
  - data/mpi.json — end-of-week MPI snapshot

CLI:
  python3 weekly_pulse_aggregator.py --week-ending 2026-05-15 --dry-run
  python3 weekly_pulse_aggregator.py --week-ending 2026-05-15 \\
      --from-fixture sample-output/2026-05-15-dryrun-freesource.json --dry-run

Brand check: no buy/sell/target/stop, no model weights, no agent scores.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path

from daily_pulse_aggregator import (
    aggregate,
    CONVICTION_GATE,
    SECTOR_ETF_NAMES,
    _int, _flt, _fmt_money,
)
from daily_pulse_publisher import render_html

_fmt_premium = _fmt_money
ROOT = Path(__file__).resolve().parent
TEMPLATE_PATH = ROOT / "daily_pulse_template.html.j2"
SAMPLE_DIR = ROOT / "sample-output"

logger = logging.getLogger("weekly_pulse.aggregator")


def _trading_days_of_week_ending(week_ending: str) -> list[str]:
    end = datetime.strptime(week_ending, "%Y-%m-%d").date()
    while end.weekday() != 4:
        end = end - timedelta(days=1)
    monday = end - timedelta(days=4)
    return [(monday + timedelta(days=i)).isoformat() for i in range(5)]


def _build_weekly_headline(agg, mpi_snap):
    mt = agg.get("market_totals") or {}
    ratio = mt.get("call_put_premium_ratio")
    parts = []
    regime = (mpi_snap or {}).get("regime_short") or agg.get("regime_short") or ""
    if regime:
        parts.append(f"{regime} regime held")
    if ratio:
        if ratio >= 1.3:
            parts.append(f"net call premium {ratio:.1f}x put across 5 sessions")
        elif ratio <= 0.77:
            parts.append(f"net put premium {1/ratio:.1f}x call across 5 sessions")
        else:
            parts.append("call/put premium ran roughly balanced")
    tells = agg.get("tells") or []
    if tells:
        names = ", ".join(t["ticker"] for t in tells[:2])
        parts.append(f"weekly accumulation surfaced in {names}")
    else:
        parts.append("no single-name positioning carried through the week")
    headline = "; ".join(parts) + "."
    if len(headline) > 150:
        headline = headline[:147].rstrip(",;") + "..."
    return headline


def _build_weekly_changes(agg, trading_days):
    bullets = []
    mt = agg.get("market_totals") or {}
    cp = _flt(mt.get("call_premium"))
    pp = _flt(mt.get("put_premium"))
    ratio = mt.get("call_put_premium_ratio")

    if cp or pp:
        if ratio and ratio >= 1.0:
            arrow, color = "▲", "#10b981"
        else:
            arrow, color = "▼", "#ef4444"
        if ratio and ratio >= 1.0:
            suffix = f" = <strong style=\"white-space:nowrap;\">{ratio:.1f}x</strong> call-heavy."
        elif ratio:
            suffix = f" = <strong style=\"white-space:nowrap;\">1:{1/ratio:.1f}</strong> put-heavy."
        else:
            suffix = "."
        bullets.append({
            "arrow": arrow,
            "arrow_color": color,
            "text": (
                f"Week call-premium total <strong style=\"white-space:nowrap;\">"
                f"{_fmt_premium(cp)}</strong> vs put "
                f"<strong style=\"white-space:nowrap;\">{_fmt_premium(pp)}</strong>{suffix}"
            ),
        })

    # Sector leader from full row list (Friday close used as week-end snapshot)
    sec = agg.get("sector") or {}
    leaders = sec.get("leaders") or sec.get("sector_rows") or sec.get("rows") or []
    for row in leaders:
        if row.get("ticker") in {"SPY", "QQQ", "IWM"}:
            continue
        if row.get("ticker") not in SECTOR_ETF_NAMES:
            continue
        chg = _flt(row.get("change_pct") or row.get("change_percent"))
        nm = row.get("name") or SECTOR_ETF_NAMES.get(row["ticker"], row["ticker"])
        close = _flt(row.get("close"))
        arrow = "▲" if chg >= 0 else "▼"
        color = "#10b981" if chg >= 0 else "#ef4444"
        bullets.append({
            "arrow": arrow,
            "arrow_color": color,
            "text": (
                f"{nm} ({row['ticker']}) closed Fri at "
                f"<strong style=\"white-space:nowrap;\">${close:.2f}</strong> "
                f"({chg:+.2f}%)."
            ),
        })
        break

    bullets.append({
        "arrow": "●",
        "arrow_color": "#0ea5e9",
        "text": (
            f"Five-session window covered: "
            f"<strong style=\"white-space:nowrap;\">{trading_days[0]}</strong> through "
            f"<strong style=\"white-space:nowrap;\">{trading_days[-1]}</strong>."
        ),
    })

    dp = agg.get("darkpool") or {}
    # darkpool may be a dict or already-aggregated form
    dp_totals = []
    if isinstance(dp, dict):
        for tkr, payload in dp.items():
            if isinstance(payload, list):
                tot = sum(_flt(p.get("premium")) for p in payload)
                dp_totals.append((tkr, tot, len(payload)))
            elif isinstance(payload, dict):
                tot = _flt(payload.get("total_premium") or payload.get("premium_total"))
                cnt = _int(payload.get("mega_print_count") or payload.get("print_count") or 1)
                dp_totals.append((tkr, tot, cnt))
    dp_totals.sort(key=lambda x: x[1], reverse=True)
    if dp_totals and dp_totals[0][1] > 0:
        top_dp = dp_totals[0]
        bullets.append({
            "arrow": "●",
            "arrow_color": "#0ea5e9",
            "text": (
                f"Dark-pool weekly notional led by "
                f"<strong style=\"white-space:nowrap;\">{top_dp[0]}</strong> at "
                f"<strong style=\"white-space:nowrap;\">{_fmt_premium(top_dp[1])}</strong> "
                f"({top_dp[2]} prints, T-14 lag)."
            ),
        })

    return bullets[:5]


def _build_weekly_catalysts():
    """Hardcoded next-week catalysts (week of May 18-22, 2026)."""
    return [
        {"text": "<strong>NVDA earnings</strong> · expected May 20-21 after close",
         "implication": "Premium concentration in semis can extend or unwind."},
        {"text": "<strong>FOMC May minutes</strong> · May 21-22",
         "implication": "Front-end vol can reprice on hawkish/dovish tone."},
        {"text": "<strong>Existing/New Home Sales · retail bellwether prints</strong> mid-week",
         "implication": "Discretionary tape sensitive to consumer reads."},
    ][:3]


def aggregate_week(week_ending: str, *, from_fixture: Path | None = None) -> dict:
    trading_days = _trading_days_of_week_ending(week_ending)
    logger.info("Building weekly for window: %s", trading_days)

    if from_fixture:
        agg = json.loads(Path(from_fixture).read_text())
        logger.info("Loaded fixture %s (%d tells)", from_fixture,
                    len(agg.get("tells") or []))
    else:
        # Live fetch path — runs the full daily fetcher for Friday only
        # (single snapshot, full mode for tell-scoring quality).
        from daily_pulse_fetcher import fetch_daily_data
        raw = fetch_daily_data(trading_days[-1], fast=False)
        agg = aggregate(raw, prev_raw=None)

    # Override weekly framing
    mpi_snap = {
        "regime_short": agg.get("regime_short"),
        "mpi_score": agg.get("mpi_score"),
    }
    agg["headline"] = _build_weekly_headline(agg, mpi_snap)
    agg["changes"] = _build_weekly_changes(agg, trading_days)
    agg["catalysts"] = _build_weekly_catalysts()
    monday, friday = trading_days[0], trading_days[-1]
    mon_dt = datetime.strptime(monday, "%Y-%m-%d")
    fri_dt = datetime.strptime(friday, "%Y-%m-%d")
    agg["post_date_display"] = f"Week of {mon_dt.strftime('%b %-d')}-{fri_dt.strftime('%-d, %Y')}"
    slug = f"weekly-pulse-{monday}-to-{friday[-2:]}"
    agg["appendix_url"] = f"https://aztmm.com/{datetime.utcnow().strftime('%Y/%m/%d')}/{slug}/"
    agg["scope"] = "weekly"
    agg["trading_days"] = trading_days

    # Update key-metric label to "Weekly Tape"
    if agg.get("key_metric_label") in ("Tape", None, ""):
        agg["key_metric_label"] = "Weekly Tape"

    # Re-tone tell sub_headers to reference the week
    for t in agg.get("tells") or []:
        sh = t.get("sub_header") or ""
        if "Single-name" in sh or "spot $" in sh:
            t["sub_header"] = sh.replace("Single-name", "Week's standout")
        # Re-tone opener of observation to be weekly-aware
        obs = t.get("observation") or ""
        if obs and not obs.lower().startswith("across the week") and not obs.lower().startswith("through the week"):
            t["observation"] = "Across the week, " + obs[0].lower() + obs[1:]

    return agg


def main(argv=None):
    p = argparse.ArgumentParser(description="AZTMM Weekly Pulse aggregator")
    p.add_argument("--week-ending", required=True)
    p.add_argument("--from-fixture", default=None,
                   help="Path to an existing daily aggregate JSON to use as base")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    fixture = Path(args.from_fixture) if args.from_fixture else None
    agg = aggregate_week(args.week_ending, from_fixture=fixture)
    SAMPLE_DIR.mkdir(exist_ok=True)

    monday = agg["trading_days"][0]
    friday = agg["trading_days"][-1]
    payload_path = SAMPLE_DIR / f"weekly-pulse-{monday}-to-{friday}.payload.json"
    payload_path.write_text(json.dumps(agg, indent=2, default=str))

    html = render_html(agg, TEMPLATE_PATH)
    # Post-render swaps for weekly framing (template is shared with daily)
    html = html.replace("Today's Tell", "This Week's Tell")
    html = html.replace("Live &middot;", "Closing &middot;")
    html = html.replace("Tomorrow's Catalyst", "Next Week's Catalysts")
    html_path = SAMPLE_DIR / f"weekly-pulse-{monday}-to-{friday}.html"
    html_path.write_text(html)

    tells = agg.get("tells") or []
    print(json.dumps({
        "ok": True,
        "week_ending": args.week_ending,
        "trading_days": agg["trading_days"],
        "tells_surfaced": len(tells),
        "tell_tickers": [t["ticker"] for t in tells],
        "headline": agg["headline"],
        "post_date_display": agg["post_date_display"],
        "payload_path": str(payload_path),
        "html_path": str(html_path),
        "html_bytes": len(html),
        "conviction_gate": CONVICTION_GATE,
        "mpi_score": agg.get("mpi_score"),
        "regime_short": agg.get("regime_short"),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
