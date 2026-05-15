"""
AZTMM Earnings Flow Flag — aggregator

Intersects:
  upcoming-earnings (next 5 trading days, universe-filtered)
        ∩
  notable-flow-today (per-ticker flow alerts clearing the floor)

Produces the dual public / internal output.

Public side: ticker, est_date_label (Mon/Tue/Wed/Thu/Fri or tomorrow),
report_time (premarket/postmarket), sector, call-put tilt label,
total premium of qualifying alerts today, one-line observation.
No model weights, no endpoint names, no advisory language.

Internal side: every flagged ticker with raw per-alert numbers,
all earnings rows, all flow-alerts.

Headline metric (for the 30-day sparkline) = COUNT of flagged names.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

from fetcher import safe_float, safe_int

logger = logging.getLogger("earnings_flow.aggregator")

ROOT = Path(__file__).parent
CONFIG_PATH = ROOT / "config.yml"


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------

def _fmt_premium(x: float) -> str:
    sign = "-" if x < 0 else ""
    a = abs(x)
    if a >= 1e9:
        return f"{sign}${a/1e9:.2f}B"
    if a >= 1e6:
        return f"{sign}${a/1e6:.1f}M"
    if a >= 1e3:
        return f"{sign}${a/1e3:.0f}K"
    return f"{sign}${a:.0f}"


def _fmt_pct(x: float, digits: int = 0) -> str:
    return f"{x:.{digits}f}%"


def _fmt_int(x: int | float) -> str:
    return f"{int(x):,}"


# ---------------------------------------------------------------------------
# Date label helpers
# ---------------------------------------------------------------------------

_DOW_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _date_label(report_date: str, today: str) -> str:
    """
    Human-friendly label:
      same-week dates -> day-of-week ("Mon", "Tue", ...)
      tomorrow -> "tomorrow"
      else -> "Mon" with date hint
    """
    try:
        r = datetime.strptime(report_date, "%Y-%m-%d")
        t = datetime.strptime(today, "%Y-%m-%d")
    except (TypeError, ValueError):
        return report_date
    delta = (r.date() - t.date()).days
    if delta <= 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if delta <= 7:
        return _DOW_SHORT[r.weekday()]
    return f"{_DOW_SHORT[r.weekday()]} {report_date}"


def _report_time_label(report_time: str | None) -> str:
    if not report_time:
        return "during market hours"
    rt = report_time.lower()
    if rt == "premarket":
        return "before the open"
    if rt == "postmarket":
        return "after the close"
    return "during market hours"


# ---------------------------------------------------------------------------
# Tilt labels (mirrors 0DTE pattern)
# ---------------------------------------------------------------------------

def tilt_label(call_prem: float, put_prem: float, tilt_bands: dict) -> str:
    if put_prem <= 0 and call_prem <= 0:
        return "no notable activity"
    if put_prem <= 0:
        return "all call-side"
    ratio = call_prem / put_prem
    if ratio >= tilt_bands["heavily_call_tilted"]:
        return "heavily call-tilted"
    if ratio >= tilt_bands["call_tilted"]:
        return "call-tilted"
    if ratio >= tilt_bands["balanced_lower"]:
        return "balanced"
    if ratio >= tilt_bands["put_tilted"]:
        return "put-tilted"
    return "heavily put-tilted"


# ---------------------------------------------------------------------------
# Per-ticker alert rollup
# ---------------------------------------------------------------------------

def _rollup_alerts(alerts: list[dict]) -> dict:
    """
    Roll up flow alerts for one ticker into call / put premium, count,
    sector. Defensive against missing fields.
    """
    rec = {
        "alert_count": 0,
        "call_alert_count": 0,
        "put_alert_count": 0,
        "call_premium": 0.0,
        "put_premium": 0.0,
        "total_premium": 0.0,
        "total_size": 0,
        "sector": None,
        "marketcap": 0.0,
    }
    for a in alerts:
        prem = safe_float(a.get("total_premium"))
        size = safe_int(a.get("total_size"))
        rec["alert_count"] += 1
        rec["total_premium"] += prem
        rec["total_size"] += size
        t = (a.get("type") or "").lower()
        if t == "call":
            rec["call_alert_count"] += 1
            rec["call_premium"] += prem
        elif t == "put":
            rec["put_alert_count"] += 1
            rec["put_premium"] += prem
        sec = a.get("sector")
        if sec and not rec["sector"]:
            rec["sector"] = sec
        mc = safe_float(a.get("marketcap"))
        if mc > rec["marketcap"]:
            rec["marketcap"] = mc
    return rec


def _passes_flow_floor(rollup: dict, agg_alerts: list[dict], thresholds: dict) -> bool:
    """
    A ticker qualifies if at least `min_alerts_per_ticker` of today's
    flow alerts cleared the per-alert premium + size floor.
    """
    min_prem = thresholds["min_total_premium_usd"]
    min_size = thresholds["min_total_size"]
    min_alerts = thresholds["min_alerts_per_ticker"]
    qualifying = 0
    for a in agg_alerts:
        prem = safe_float(a.get("total_premium"))
        size = safe_int(a.get("total_size"))
        if prem >= min_prem and size >= min_size:
            qualifying += 1
    return qualifying >= min_alerts


# ---------------------------------------------------------------------------
# Public observation lines
# ---------------------------------------------------------------------------

def _observation_for(row: dict) -> str:
    """Per-row one-line observation. Pure observation, no advice."""
    t = row["ticker"]
    tilt = row["tilt_label"]
    prem_fmt = _fmt_premium(row["total_premium"])
    when = row["est_date_label"]
    rt = row["report_time_label"]
    when_phrase = f"reporting {when} {rt}" if when not in ("today", "during market hours") else f"reporting {when}"
    if when == "tomorrow":
        when_phrase = f"reporting tomorrow {rt}"
    if when == "today":
        when_phrase = f"reporting later today {rt}".strip()
    base = f"{t}, an upcoming reporter ({when_phrase}), drew {prem_fmt} of qualifying options interest on today's tape"
    if tilt == "heavily call-tilted" or tilt == "all call-side":
        return base + " with the dollar weight heavily on the call side."
    if tilt == "call-tilted":
        return base + " with the dollar weight leaning call-side."
    if tilt == "heavily put-tilted":
        return base + " with the dollar weight heavily on the put side."
    if tilt == "put-tilted":
        return base + " with the dollar weight leaning put-side."
    if tilt == "balanced":
        return base + " with call and put weight roughly balanced."
    return base + "."


def _commentary_for(row: dict) -> str:
    return _observation_for(row)


def _summary_line(public_rows: list[dict], window_start: str, window_end: str,
                  earnings_count: int) -> str:
    if not public_rows:
        return (
            f"Of the names reporting between {window_start} and {window_end}, none cleared "
            "today's bar for notable options interest. The tape was quiet on the upcoming-reporter set."
        )
    n_call = sum(1 for r in public_rows if "call" in r["tilt_label"])
    n_put = sum(1 for r in public_rows if "put" in r["tilt_label"])
    tilt_phrase = ""
    if n_call > n_put * 1.5:
        tilt_phrase = " Of tonight's flagged names, the dollar weight on the tape leaned call-side."
    elif n_put > n_call * 1.5:
        tilt_phrase = " Of tonight's flagged names, the dollar weight on the tape leaned put-side."
    elif public_rows:
        tilt_phrase = " Call and put weight across tonight's flagged names was mixed."
    return (
        f"Of the {earnings_count} names scheduled to report between {window_start} and {window_end}, "
        f"{len(public_rows)} cleared today's bar for notable options interest.{tilt_phrase}"
    )


def _watching_line(public_rows: list[dict]) -> str:
    if not public_rows:
        return "Going into tomorrow I'll be watching whether the names on this week's report calendar start drawing options interest."
    top = public_rows[0]["ticker"]
    return (
        f"Going into the reports I'll be watching whether the options interest in "
        f"{top} keeps building into the print, or whether today's tape was a one-session story."
    )


# ---------------------------------------------------------------------------
# Public row builder
# ---------------------------------------------------------------------------

def _public_row(rec: dict, ticker: str, report_date: str, report_time: str | None,
                today: str, sector_fallback: str | None) -> dict:
    cp_total = rec["call_premium"] + rec["put_premium"]
    call_share = (rec["call_premium"] / cp_total * 100.0) if cp_total > 0 else 0.0
    put_share = 100.0 - call_share if cp_total > 0 else 0.0
    return {
        "ticker": ticker,
        "sector": rec.get("sector") or sector_fallback or "—",
        "report_date": report_date,
        "est_date_label": _date_label(report_date, today),
        "report_time": report_time or "",
        "report_time_label": _report_time_label(report_time),
        "alert_count": rec["alert_count"],
        "total_premium": rec["total_premium"],
        "total_premium_fmt": _fmt_premium(rec["total_premium"]),
        "tilt_label": rec["tilt_label"],
        "call_share_fmt": _fmt_pct(call_share, 0),
        "put_share_fmt": _fmt_pct(put_share, 0),
    }


# ---------------------------------------------------------------------------
# Main aggregate
# ---------------------------------------------------------------------------

def aggregate(bundle: dict, cfg: dict | None = None) -> dict:
    cfg = cfg or _load_config()
    thresholds = cfg["flow"]
    tilt_bands = cfg["tilt_bands"]
    out_cfg = cfg["output"]

    today = bundle["date"]
    forward_window: list[str] = bundle.get("forward_window") or []
    window_start = forward_window[0] if forward_window else today
    window_end = forward_window[-1] if forward_window else today

    earnings_meta: dict[str, dict] = bundle.get("earnings_universe_meta") or {}
    flow_by_ticker: dict[str, list[dict]] = bundle.get("flow_alerts_by_ticker") or {}

    earnings_count = len(earnings_meta)

    # Build flagged records
    flagged_records: list[dict] = []
    for ticker, earnings_row in earnings_meta.items():
        alerts = flow_by_ticker.get(ticker) or []
        if not alerts:
            continue
        rollup = _rollup_alerts(alerts)
        # Floor check
        if not _passes_flow_floor(rollup, alerts, thresholds):
            continue
        rollup["tilt_label"] = tilt_label(
            rollup["call_premium"], rollup["put_premium"], tilt_bands
        )
        # Decorate with earnings metadata for sorting + rendering
        report_date = earnings_row.get("_report_date") or earnings_row.get("report_date") or today
        report_time = earnings_row.get("report_time")
        sector_fallback = earnings_row.get("sector")
        row = _public_row(rollup, ticker, report_date, report_time, today, sector_fallback)
        # internal carry-overs
        row["_rollup"] = rollup
        row["_marketcap"] = safe_float(earnings_row.get("marketcap"))
        row["_is_sp500"] = bool(earnings_row.get("is_s_p_500"))
        flagged_records.append(row)

    # Sort: by report_date asc (nearest first), then total_premium desc
    flagged_records.sort(key=lambda r: (r["report_date"], -r["total_premium"]))

    top_pub = out_cfg["top_flagged_public"]
    top_int = out_cfg["top_flagged_internal"]
    com_top = out_cfg["commentary_top_n"]

    public_rows = []
    for r in flagged_records[:top_pub]:
        public_rows.append({
            k: v for k, v in r.items() if not k.startswith("_")
        })

    # Sort commentary by total premium desc (most active first), regardless of date
    commentary_recs = sorted(flagged_records, key=lambda r: -r["total_premium"])[:com_top]
    commentary = [_commentary_for(r) for r in commentary_recs]

    # ---- Public side ----
    public = {
        "date": today,
        "as_of": f"{today} 5:00 PM ET",
        "window_start": window_start,
        "window_end": window_end,
        "summary_line": _summary_line(public_rows, window_start, window_end, earnings_count),
        "watching_line": _watching_line(public_rows),
        "rows": public_rows,
        "commentary": commentary,
        "headline_metric": {
            "label": "Flagged upcoming reporters",
            "value": len(flagged_records),
        },
        "tape_totals": {
            "upcoming_reporters_in_window": earnings_count,
            "flagged_names": len(flagged_records),
            "window_start": window_start,
            "window_end": window_end,
        },
        "data_quality_degraded": (
            bundle.get("data_quality", {}).get("endpoints_failed", 0)
            > bundle.get("data_quality", {}).get("endpoints_ok", 0)
        ),
    }

    # ---- Internal side ----
    internal_rows = []
    for r in flagged_records[:top_int]:
        roll = r["_rollup"]
        internal_rows.append({
            "ticker": r["ticker"],
            "sector": r["sector"],
            "report_date": r["report_date"],
            "report_time": r["report_time"],
            "marketcap": r["_marketcap"],
            "is_sp500": r["_is_sp500"],
            "alert_count": roll["alert_count"],
            "call_alert_count": roll["call_alert_count"],
            "put_alert_count": roll["put_alert_count"],
            "call_premium": roll["call_premium"],
            "put_premium": roll["put_premium"],
            "total_premium": roll["total_premium"],
            "total_size": roll["total_size"],
            "tilt_label": r["tilt_label"],
        })

    internal = {
        "date": today,
        "as_of": f"{today} 5:00 PM ET",
        "window_start": window_start,
        "window_end": window_end,
        "thresholds": thresholds,
        "universe_filters": cfg["universe"],
        "tilt_bands": tilt_bands,
        "earnings_universe_size": earnings_count,
        "flagged_count": len(flagged_records),
        "rows": internal_rows,
        "earnings_by_date": bundle.get("earnings_by_date") or {},
        "data_quality": bundle.get("data_quality") or {},
    }

    return {"public": public, "internal": internal}


if __name__ == "__main__":
    import json, sys, argparse
    p = argparse.ArgumentParser()
    p.add_argument("--bundle", required=True)
    args = p.parse_args()
    with open(args.bundle) as f:
        bundle = json.load(f)
    out = aggregate(bundle)
    json.dump(out, sys.stdout, indent=2, default=str)
