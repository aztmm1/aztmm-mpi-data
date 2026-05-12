"""
AZTMM 0DTE Pulse — aggregator

Takes the raw 0DTE alert bundle + total-options-volume context and
produces the dual public/internal output.

Public side: top-N tickers by 0DTE premium, call/put tilt label, market
share of 0DTE volume, journal-style commentary. No model weights, no
endpoint names, no advisory language.

Internal side: per-ticker raw premium dollars, alert counts, raw
call/put splits, all unfiltered rows preserved.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("zerodte.aggregator")

ROOT = Path(__file__).parent
CONFIG_PATH = ROOT / "config.yml"


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _safe_float(v: Any) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


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


def _fmt_int(x: int | float) -> str:
    return f"{int(x):,}"


def _fmt_ratio(x: float, digits: int = 2) -> str:
    return f"{x:.{digits}f}x"


def _fmt_pct(x: float, digits: int = 1) -> str:
    return f"{x:.{digits}f}%"


# ---------------------------------------------------------------------------
# Filtering + per-ticker rollup
# ---------------------------------------------------------------------------

def _passes_threshold(alert: dict, thresholds: dict) -> bool:
    prem = _safe_float(alert.get("total_premium"))
    size = int(alert.get("total_size") or 0)
    return prem >= thresholds["min_total_premium_usd"] and size >= thresholds["min_total_size"]


def _rollup_by_ticker(alerts: list[dict]) -> dict[str, dict]:
    by_ticker: dict[str, dict] = defaultdict(lambda: {
        "ticker": None,
        "alert_count": 0,
        "call_alert_count": 0,
        "put_alert_count": 0,
        "call_premium": 0.0,
        "put_premium": 0.0,
        "total_premium": 0.0,
        "total_size": 0,
        "sectors": set(),
    })
    for a in alerts:
        t = a.get("ticker") or "?"
        rec = by_ticker[t]
        rec["ticker"] = t
        rec["alert_count"] += 1
        prem = _safe_float(a.get("total_premium"))
        rec["total_premium"] += prem
        rec["total_size"] += int(a.get("total_size") or 0)
        typ = (a.get("type") or "").lower()
        if typ == "call":
            rec["call_alert_count"] += 1
            rec["call_premium"] += prem
        elif typ == "put":
            rec["put_alert_count"] += 1
            rec["put_premium"] += prem
        sec = a.get("sector")
        if sec:
            rec["sectors"].add(sec)
    # Cast sets -> sorted lists for serialisation
    for rec in by_ticker.values():
        rec["sectors"] = sorted(rec["sectors"])
    return by_ticker


# ---------------------------------------------------------------------------
# Tilt labels (no advisory words)
# ---------------------------------------------------------------------------

def tilt_label(call_prem: float, put_prem: float, tilt_bands: dict) -> str:
    """Returns a non-advisory descriptive tilt label."""
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


def _prints_phrase(n: int) -> str:
    """Grammar-aware noun phrase for print count."""
    return "1 print" if n == 1 else f"{n} prints"


# ---------------------------------------------------------------------------
# Narrative + summary builders
# ---------------------------------------------------------------------------

def _commentary_for(rec: dict) -> str:
    """One observation line per highlighted ticker. Pure observation language."""
    t = rec["ticker"]
    label = rec["tilt_label"]
    prem_fmt = _fmt_premium(rec["total_premium"])
    alerts = rec["alert_count"]
    if label == "no notable activity":
        return f"{t} surfaced {alerts} 0DTE notable prints tonight but the dollar weight was modest."
    if label in ("heavily call-tilted", "all call-side"):
        return (
            f"{t} drew {prem_fmt} of notable 0DTE premium tonight across {_prints_phrase(alerts)}, "
            f"with the dollar weight {label.replace('-', ' ')}."
        )
    if label in ("heavily put-tilted",):
        return (
            f"{t} drew {prem_fmt} of notable 0DTE premium across {_prints_phrase(alerts)}, "
            f"with the dollar weight heavily on the put side."
        )
    if label == "put-tilted":
        return (
            f"{t} drew {prem_fmt} of notable 0DTE premium across {_prints_phrase(alerts)}, "
            f"with the dollar weight leaning put-side."
        )
    if label == "call-tilted":
        return (
            f"{t} drew {prem_fmt} of notable 0DTE premium across {_prints_phrase(alerts)}, "
            f"with the dollar weight leaning call-side."
        )
    return (
        f"{t} drew {prem_fmt} of notable 0DTE premium across {_prints_phrase(alerts)}, "
        f"with call and put weight roughly balanced tonight."
    )


def _summary_line(public_rows: list[dict], total_prem: float, n_alerts: int,
                  market_share_pct: float) -> str:
    if not public_rows:
        return (
            "Today's 0DTE tape was quiet by the notable-print bar — no tickers cleared "
            "the threshold for inclusion in tonight's pulse."
        )
    n_calls = sum(1 for r in public_rows if "call" in r["tilt_label"])
    n_puts = sum(1 for r in public_rows if "put" in r["tilt_label"])
    tilt_phrase = ""
    if n_calls > n_puts * 1.5:
        tilt_phrase = " The dollar weight across the top names leaned call-side."
    elif n_puts > n_calls * 1.5:
        tilt_phrase = " The dollar weight across the top names leaned put-side."
    else:
        tilt_phrase = " Call and put weight across the top names was mixed."
    share_phrase = ""
    if market_share_pct > 0:
        if market_share_pct >= 0.1:
            share_phrase = f" 0DTE notable prints accounted for roughly {market_share_pct:.2f}% of today's total options dollar volume."
        else:
            share_phrase = f" 0DTE notable prints accounted for roughly {market_share_pct:.3f}% of today's total options dollar volume — a small slice."
    return (
        f"Today's 0DTE tape carried {_fmt_premium(total_prem)} of notable premium across "
        f"{n_alerts} prints; {len(public_rows)} tickers cleared the bar for inclusion.{tilt_phrase}{share_phrase}"
    )


def _watching_line(public_rows: list[dict]) -> str:
    """Forward-looking question — never a prediction."""
    if not public_rows:
        return "Going into tomorrow's open I'll be watching whether the 0DTE tape comes back."
    top = public_rows[0]["ticker"]
    return (
        f"Going into tomorrow's open I'll be watching whether the same names — "
        f"{top} in particular — keep showing up on the 0DTE tape, or whether tonight's "
        f"activity was a one-session story."
    )


# ---------------------------------------------------------------------------
# Main aggregate
# ---------------------------------------------------------------------------

def aggregate(bundle: dict, cfg: dict | None = None) -> dict:
    cfg = cfg or _load_config()
    thresholds = cfg["thresholds"]
    tilt_bands = cfg["tilt_bands"]

    raw_alerts: list[dict] = bundle.get("alerts") or []
    qualifying = [a for a in raw_alerts if _passes_threshold(a, thresholds)]

    by_ticker = _rollup_by_ticker(qualifying)

    # Decorate with tilt label + sort by total_premium desc
    records: list[dict] = []
    for rec in by_ticker.values():
        rec["tilt_label"] = tilt_label(rec["call_premium"], rec["put_premium"], tilt_bands)
        # premium ratio is internal-only
        rec["_call_put_premium_ratio"] = (
            rec["call_premium"] / rec["put_premium"] if rec["put_premium"] > 0
            else (float("inf") if rec["call_premium"] > 0 else 0.0)
        )
        records.append(rec)
    records.sort(key=lambda r: r["total_premium"], reverse=True)

    top_public_n = thresholds["top_tickers_public"]
    top_internal_n = thresholds["top_tickers_internal"]
    top_commentary_n = thresholds["commentary_top_n"]

    # Total premium across qualifying alerts (for the summary line)
    total_prem = sum(r["total_premium"] for r in records)
    n_alerts = sum(r["alert_count"] for r in records)

    # Market share of 0DTE vs total options dollar volume
    mv = bundle.get("market_volume") or {}
    market_call_prem = _safe_float(mv.get("call_premium"))
    market_put_prem = _safe_float(mv.get("put_premium"))
    market_total = market_call_prem + market_put_prem
    market_share_pct = (total_prem / market_total * 100.0) if market_total > 0 else 0.0

    # Market-wide call/put dollar tilt (separate from 0DTE notable prints)
    market_call_put_ratio = (market_call_prem / market_put_prem) if market_put_prem > 0 else 0.0
    if market_call_prem == 0 and market_put_prem == 0:
        market_tilt = "no data"
    elif market_call_put_ratio >= 1.25:
        market_tilt = "call-tilted"
    elif market_call_put_ratio >= 0.80:
        market_tilt = "balanced"
    else:
        market_tilt = "put-tilted"

    # ---- Public side ----
    public_rows: list[dict] = []
    for r in records[:top_public_n]:
        cp_total = r["call_premium"] + r["put_premium"]
        call_share = (r["call_premium"] / cp_total * 100.0) if cp_total > 0 else 0.0
        put_share = 100.0 - call_share if cp_total > 0 else 0.0
        public_rows.append({
            "ticker": r["ticker"],
            "sectors": r["sectors"],
            "alert_count": r["alert_count"],
            "total_premium_fmt": _fmt_premium(r["total_premium"]),
            "total_size_fmt": _fmt_int(r["total_size"]),
            "tilt_label": r["tilt_label"],
            "call_share_fmt": _fmt_pct(call_share),
            "put_share_fmt": _fmt_pct(put_share),
        })

    commentary: list[str] = []
    for r in records[:top_commentary_n]:
        commentary.append(_commentary_for(r))

    # Headline metric for the 30-day trend sparkline: total 0DTE notable
    # premium in millions of dollars (numeric).
    total_prem_musd = round(total_prem / 1_000_000.0, 3)

    public = {
        "date": bundle["date"],
        "as_of": f"{bundle['date']} 5:00 PM ET",
        "summary_line": _summary_line(public_rows, total_prem, n_alerts, market_share_pct),
        "watching_line": _watching_line(public_rows),
        "rows": public_rows,
        "commentary": commentary,
        "headline_metric": {
            "label": "Total 0DTE notable premium ($M)",
            "value": total_prem_musd,
        },
        "tape_totals": {
            "notable_prints": n_alerts,
            "tickers_in_pulse": len(records),
            "total_notable_premium_fmt": _fmt_premium(total_prem),
            "market_share_of_options_dollar_volume_fmt": _fmt_pct(market_share_pct, 3) if market_share_pct < 0.1 else _fmt_pct(market_share_pct, 2),
        },
        "market_context": {
            "tilt": market_tilt,
        },
        "data_quality_degraded": (
            bundle.get("data_quality", {}).get("endpoints_failed", 0)
            > bundle.get("data_quality", {}).get("endpoints_ok", 0)
        ),
    }

    # ---- Internal side ----
    internal_rows: list[dict] = []
    for r in records[:top_internal_n]:
        internal_rows.append({
            "ticker": r["ticker"],
            "sectors": r["sectors"],
            "alert_count": r["alert_count"],
            "call_alert_count": r["call_alert_count"],
            "put_alert_count": r["put_alert_count"],
            "call_premium": r["call_premium"],
            "put_premium": r["put_premium"],
            "total_premium": r["total_premium"],
            "total_size": r["total_size"],
            "tilt_label": r["tilt_label"],
            "call_put_premium_ratio": r["_call_put_premium_ratio"],
        })

    internal = {
        "date": bundle["date"],
        "as_of": f"{bundle['date']} 5:00 PM ET",
        "thresholds": thresholds,
        "tilt_bands": tilt_bands,
        "raw_alert_count": len(raw_alerts),
        "qualifying_alert_count": len(qualifying),
        "tickers_in_pulse": len(records),
        "rows": internal_rows,
        "market_volume": bundle.get("market_volume") or {},
        "market_share_of_options_dollar_volume_pct": market_share_pct,
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
