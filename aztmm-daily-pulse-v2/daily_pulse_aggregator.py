"""
AZTMM Daily Pulse v2 — Aggregator
==================================

Pure functions. No I/O.

Input:  the dict shape produced by daily_pulse_fetcher.fetch_daily_data()
Output: a single structured dict ready to drop into the Jinja template.

Notable computations:
  - 11-sector heatmap with leading/neutral/lagging bands
  - 8-signal scenario scorecard (BULL / BEAR / BASE / DEFENSIVE ROTATION / RISK-OFF NARROWING)
  - Tech narrowing detector
  - Dark pool concentration shifts vs prior day
  - Intraday tide direction (end-of-session cumulative net premium)
  - Mega-print counts per ticker (>=100K shares)

NOTE: All upstream/data-vendor identifiers are intentionally scrubbed here.
Output strings use generic labels ("unusual options alerts", "intraday
options tape", "end-of-day flow"). The publisher will run an additional
brand-policy scrubber.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

logger = logging.getLogger("daily_pulse.aggregator")

# ---------------------------------------------------------------------------
# Constants & thresholds
# ---------------------------------------------------------------------------

SECTOR_ETF_NAMES = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLV": "Health Care",
    "XLY": "Consumer Discretionary",
    "XLP": "Consumer Staples",
    "XLE": "Energy",
    "XLI": "Industrials",
    "XLB": "Materials",
    "XLU": "Utilities",
    "XLRE": "Real Estate",
    "XLC": "Communication Services",
    "SPY": "S&P 500 (broad market)",
}

LEADING_THRESHOLD_PCT = 0.5    # change% >= 0.5 -> leading
LAGGING_THRESHOLD_PCT = -0.5   # change% <= -0.5 -> lagging

MEGA_PRINT_SHARES = 100_000
TECH_NARROW_TOP_N = 5
TECH_NARROW_RATIO = 0.55  # top-1 ticker >= 55% of top-5 abs premium => narrowing

DEFENSIVE_SECTORS = {"XLV", "XLP", "XLU"}
CYCLICAL_SECTORS = {"XLK", "XLY", "XLC", "XLI", "XLB"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _flt(x: Any, default: float = 0.0) -> float:
    if x is None:
        return default
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _int(x: Any, default: int = 0) -> int:
    if x is None:
        return default
    try:
        return int(x)
    except (TypeError, ValueError):
        return default


def _fmt_money(n: float) -> str:
    """e.g. 1_234_567_890 -> '$1.23B', 12_345_678 -> '$12.3M', else '$X.XK'."""
    sign = "-" if n < 0 else ""
    n = abs(n)
    if n >= 1e9:
        return f"{sign}${n/1e9:.2f}B"
    if n >= 1e6:
        return f"{sign}${n/1e6:.1f}M"
    if n >= 1e3:
        return f"{sign}${n/1e3:.1f}K"
    return f"{sign}${n:.0f}"


def _fmt_pct(p: float) -> str:
    return f"{p:+.2f}%"


# ---------------------------------------------------------------------------
# Section 1 — Market totals
# ---------------------------------------------------------------------------

def aggregate_market_totals(today: dict | None, prev: dict | None) -> dict:
    if not today:
        return {"available": False}

    call_vol = _int(today.get("call_volume"))
    put_vol = _int(today.get("put_volume"))
    call_prem = _flt(today.get("call_premium"))
    put_prem = _flt(today.get("put_premium"))
    pc_ratio = (put_vol / call_vol) if call_vol > 0 else None

    out = {
        "available": True,
        "call_volume": call_vol,
        "put_volume": put_vol,
        "call_premium": call_prem,
        "put_premium": put_prem,
        "call_premium_fmt": _fmt_money(call_prem),
        "put_premium_fmt": _fmt_money(put_prem),
        "pc_ratio": pc_ratio,
        "pc_ratio_fmt": f"{pc_ratio:.2f}" if pc_ratio is not None else "n/a",
    }
    if prev:
        prev_call = _flt(prev.get("call_premium"))
        prev_put = _flt(prev.get("put_premium"))
        out["call_premium_delta"] = call_prem - prev_call
        out["put_premium_delta"] = put_prem - prev_put
        out["call_premium_delta_fmt"] = _fmt_money(call_prem - prev_call)
        out["put_premium_delta_fmt"] = _fmt_money(put_prem - prev_put)
    return out


# ---------------------------------------------------------------------------
# Section 2 — Sector heatmap
# ---------------------------------------------------------------------------

def _sector_band(change_pct: float) -> str:
    if change_pct >= LEADING_THRESHOLD_PCT:
        return "leading"
    if change_pct <= LAGGING_THRESHOLD_PCT:
        return "lagging"
    return "neutral"


def aggregate_sector_heatmap(sector_etfs: list[dict]) -> dict:
    """Build the 11-sector + SPY heatmap (excludes SPY from leadership ranking)."""
    rows: list[dict] = []
    for s in sector_etfs or []:
        ticker = s.get("ticker") or s.get("symbol")
        if not ticker:
            continue
        change_pct = _flt(s.get("change_percent") or s.get("change_pct"))
        call_prem = _flt(s.get("call_premium"))
        put_prem = _flt(s.get("put_premium"))
        net_prem = call_prem - put_prem

        # in_out_flow: list of date->flow change pairs, latest first by convention
        in_out_flow = s.get("in_out_flow") or []
        latest_flow = None
        if isinstance(in_out_flow, list) and in_out_flow:
            try:
                latest_flow = _flt(in_out_flow[0].get("flow") if isinstance(in_out_flow[0], dict) else in_out_flow[0])
            except Exception:
                latest_flow = None

        rows.append({
            "ticker": ticker,
            "name": SECTOR_ETF_NAMES.get(ticker, ticker),
            "change_pct": change_pct,
            "change_pct_fmt": _fmt_pct(change_pct),
            "call_premium": call_prem,
            "call_premium_fmt": _fmt_money(call_prem),
            "put_premium": put_prem,
            "put_premium_fmt": _fmt_money(put_prem),
            "net_premium": net_prem,
            "net_premium_fmt": _fmt_money(net_prem),
            "latest_flow": latest_flow,
            "band": _sector_band(change_pct),
        })

    # Sector-only rows (drop SPY from leadership ranking)
    sector_rows = [r for r in rows if r["ticker"] != "SPY"]
    sector_rows.sort(key=lambda r: r["change_pct"], reverse=True)
    leaders = sector_rows[:3]
    laggards = sector_rows[-3:][::-1]

    return {
        "rows": rows,
        "sector_rows": sector_rows,
        "leaders": leaders,
        "laggards": laggards,
    }


# ---------------------------------------------------------------------------
# Section 3 — Intraday tide direction
# ---------------------------------------------------------------------------

def aggregate_intraday_tide(market_tide: list[dict], prev_market_tide: list[dict] | None = None) -> dict:
    """Pull final cumulative net call premium from the day's 5-min bars."""
    if not market_tide:
        return {"available": False}

    # Bars are typically chronological; use the last one
    last = market_tide[-1] if isinstance(market_tide, list) else None
    if not isinstance(last, dict):
        return {"available": False}

    net_call_prem = _flt(last.get("net_call_premium"))
    net_put_prem = _flt(last.get("net_put_premium"))
    net_volume = _flt(last.get("net_volume"))

    # Shape: did we close near the high, low, or in the middle of the day's range?
    series = [_flt(b.get("net_call_premium")) for b in market_tide if isinstance(b, dict)]
    if series:
        hi, lo = max(series), min(series)
        if hi - lo > 0:
            pos = (net_call_prem - lo) / (hi - lo)
        else:
            pos = 0.5
    else:
        pos = 0.5

    if pos >= 0.75:
        shape = "closed at session highs (steady accumulation)"
    elif pos <= 0.25:
        shape = "closed at session lows (steady distribution)"
    else:
        shape = "closed mid-range (chop)"

    return {
        "available": True,
        "eod_net_call_premium": net_call_prem,
        "eod_net_put_premium": net_put_prem,
        "eod_net_volume": net_volume,
        "eod_net_call_premium_fmt": _fmt_money(net_call_prem),
        "eod_net_put_premium_fmt": _fmt_money(net_put_prem),
        "shape": shape,
        "direction": "positive" if net_call_prem > 0 else "negative",
    }


# ---------------------------------------------------------------------------
# Section 4 — Premium concentration (tech vs non-tech)
# ---------------------------------------------------------------------------

# Loose mapping for routing top tickers — extend as needed
TECH_TICKERS = {
    "NVDA", "MSFT", "AAPL", "GOOGL", "GOOG", "META", "TSLA", "AMZN",
    "AVGO", "AMD", "QCOM", "INTC", "TSM", "CRM", "ORCL", "ADBE", "MU",
    "QQQ", "XLK", "SMH",
}


def aggregate_premium_concentration(flow_alerts: list[dict]) -> dict:
    """Aggregate alerts by ticker, signed by call/put bias and ask/bid side."""
    if not flow_alerts:
        return {"available": False, "tech": [], "non_tech": [], "narrowing": False}

    bucket: dict[str, float] = defaultdict(float)
    for a in flow_alerts:
        if not isinstance(a, dict):
            continue
        tkr = a.get("ticker") or a.get("symbol")
        if not tkr:
            continue
        prem = _flt(a.get("total_premium") or a.get("premium"))
        opt_type = (a.get("type") or a.get("option_type") or "").lower()
        side = (a.get("side") or "").lower()

        # Sign: call+ask = +, call+bid = -, put+ask = -, put+bid = +
        sign = 1.0
        if opt_type.startswith("c"):
            sign = +1.0 if side != "bid" else -0.5
        elif opt_type.startswith("p"):
            sign = -1.0 if side != "bid" else +0.5
        bucket[tkr] += sign * prem

    sorted_tkrs = sorted(bucket.items(), key=lambda kv: abs(kv[1]), reverse=True)

    tech_rows: list[dict] = []
    non_tech_rows: list[dict] = []
    for tkr, net in sorted_tkrs:
        row = {"ticker": tkr, "net_premium": net, "net_premium_fmt": _fmt_money(net)}
        if tkr in TECH_TICKERS:
            tech_rows.append(row)
        else:
            non_tech_rows.append(row)
        if len(tech_rows) >= 5 and len(non_tech_rows) >= 5:
            break

    # Tech narrowing: top-1 abs vs sum of top-5 abs
    narrowing = False
    narrowing_ticker = None
    if len(tech_rows) >= TECH_NARROW_TOP_N:
        top5 = tech_rows[:TECH_NARROW_TOP_N]
        total = sum(abs(r["net_premium"]) for r in top5)
        if total > 0:
            top1 = max(top5, key=lambda r: abs(r["net_premium"]))
            ratio = abs(top1["net_premium"]) / total
            if ratio >= TECH_NARROW_RATIO:
                narrowing = True
                narrowing_ticker = top1["ticker"]

    return {
        "available": True,
        "tech": tech_rows[:5],
        "non_tech": non_tech_rows[:5],
        "narrowing": narrowing,
        "narrowing_ticker": narrowing_ticker,
    }


# ---------------------------------------------------------------------------
# Section 5 — Dark pool concentration
# ---------------------------------------------------------------------------

def _dp_total_premium(prints: list[dict]) -> float:
    return sum(_flt(p.get("premium")) for p in prints if isinstance(p, dict))


def _dp_mega_count(prints: list[dict]) -> int:
    n = 0
    for p in prints:
        if not isinstance(p, dict):
            continue
        if _int(p.get("size")) >= MEGA_PRINT_SHARES:
            n += 1
    return n


def aggregate_darkpool(darkpool: dict, prev_darkpool: dict | None = None) -> dict:
    """Build top-N table by total dark pool premium today."""
    rows = []
    for tkr, prints in (darkpool or {}).items():
        total = _dp_total_premium(prints)
        mega = _dp_mega_count(prints)
        row = {
            "ticker": tkr,
            "total_premium": total,
            "total_premium_fmt": _fmt_money(total),
            "mega_print_count": mega,
            "print_count": len(prints) if isinstance(prints, list) else 0,
        }
        if prev_darkpool and tkr in prev_darkpool:
            prev_total = _dp_total_premium(prev_darkpool[tkr])
            if prev_total > 0:
                pct = (total - prev_total) / prev_total * 100.0
                row["pct_change_vs_prev"] = pct
                row["pct_change_fmt"] = _fmt_pct(pct)
            else:
                row["pct_change_vs_prev"] = None
                row["pct_change_fmt"] = "n/a"
        rows.append(row)

    rows.sort(key=lambda r: r["total_premium"], reverse=True)
    return {"available": bool(rows), "rows": rows[:10]}


# ---------------------------------------------------------------------------
# Section 6 — Unusual alert preset counts
# ---------------------------------------------------------------------------

def aggregate_alert_presets(flow_alerts: list[dict]) -> dict:
    """
    Reproduce the gold-standard preset counts using alert-field heuristics:
      - Unusually Bullish: V/OI >= 3, calls, ask-side
      - Unusually Bearish: V/OI >= 3, puts, ask-side
      - Deep Conviction Calls: premium >= $1M, single-leg, calls, ask-side
      - Deep Conviction Puts: premium >= $1M, single-leg, puts, ask-side
      - Long-Term Calls: DTE > 60, calls, ask-side
      - Put Sells: puts, bid-side
      - Cheap Calls: premium <= $5, calls, DTE <= 14
    """
    counts = Counter()
    top_alerts = []

    for a in flow_alerts or []:
        if not isinstance(a, dict):
            continue
        prem = _flt(a.get("total_premium") or a.get("premium"))
        size = _int(a.get("total_size") or a.get("size"))
        opt_type = (a.get("type") or a.get("option_type") or "").lower()
        side = (a.get("side") or "").lower()
        is_call = opt_type.startswith("c")
        is_put = opt_type.startswith("p")
        ask_side = side in ("ask", "above_ask", "at_ask")
        bid_side = side in ("bid", "below_bid", "at_bid")
        v_oi = _flt(a.get("volume_oi_ratio") or a.get("vol_oi_ratio"))
        dte = _int(a.get("dte"))
        is_single_leg = bool(a.get("is_single_leg", True))
        price = _flt(a.get("price"))

        if v_oi >= 3 and is_call and ask_side:
            counts["unusually_bullish"] += 1
        if v_oi >= 3 and is_put and ask_side:
            counts["unusually_bearish"] += 1
        if prem >= 1_000_000 and is_call and ask_side and is_single_leg:
            counts["deep_conviction_calls"] += 1
        if prem >= 1_000_000 and is_put and ask_side and is_single_leg:
            counts["deep_conviction_puts"] += 1
        if dte > 60 and is_call and ask_side:
            counts["long_term_calls"] += 1
        if is_put and bid_side:
            counts["put_sells"] += 1
        if price > 0 and price <= 5 and is_call and dte <= 14 and dte > 0:
            counts["cheap_calls"] += 1

        # Hold candidate for "top unusual"
        if is_single_leg and ask_side and prem >= 500_000:
            top_alerts.append({
                "ticker": a.get("ticker") or a.get("symbol"),
                "premium": prem,
                "premium_fmt": _fmt_money(prem),
                "type": "call" if is_call else ("put" if is_put else "?"),
                "strike": _flt(a.get("strike")),
                "expiry": a.get("expiry") or a.get("expiration"),
                "dte": dte,
                "v_oi": v_oi,
                "size": size,
            })

    top_alerts.sort(key=lambda x: x["premium"], reverse=True)
    return {
        "available": bool(flow_alerts),
        "counts": dict(counts),
        "top_alerts": top_alerts[:3],
        "total_alerts_scanned": len(flow_alerts or []),
    }


# ---------------------------------------------------------------------------
# Section 7 — Scenario scorecard
# ---------------------------------------------------------------------------

def classify_scenario(
    market_totals: dict,
    sector: dict,
    tide: dict,
    presets: dict,
    concentration: dict,
) -> dict:
    """
    8-signal scorecard. Each signal contributes +1 (bull) or -1 (bear).

    Signals:
      1. Sector breadth: leaders > laggards?
      2. Defensive vs cyclical: which group has more leaders?
      3. EOD intraday tide: positive vs negative cumulative net call premium
      4. P/C ratio: < 0.85 bull, > 1.05 bear
      5. Unusually Bullish vs Bearish count
      6. Deep Conviction Calls vs Puts
      7. Put sells (vol selling => bullish)
      8. Tech narrowing flag (-1 if narrowing => risk concentration)
    """
    score = 0
    reasons: list[str] = []

    # 1. Sector breadth
    sec_rows = sector.get("sector_rows", [])
    leading_n = sum(1 for r in sec_rows if r["band"] == "leading")
    lagging_n = sum(1 for r in sec_rows if r["band"] == "lagging")
    if leading_n > lagging_n:
        score += 1
        reasons.append(f"Sector breadth tilts up ({leading_n} leading vs {lagging_n} lagging)")
    elif lagging_n > leading_n:
        score -= 1
        reasons.append(f"Sector breadth tilts down ({lagging_n} lagging vs {leading_n} leading)")

    # 2. Defensive vs cyclical
    def_leaders = sum(1 for r in sec_rows if r["ticker"] in DEFENSIVE_SECTORS and r["band"] == "leading")
    cyc_leaders = sum(1 for r in sec_rows if r["ticker"] in CYCLICAL_SECTORS and r["band"] == "leading")
    if cyc_leaders > def_leaders:
        score += 1
        reasons.append(f"Cyclicals lead defensives ({cyc_leaders} vs {def_leaders})")
    elif def_leaders > cyc_leaders:
        score -= 1
        reasons.append(f"Defensives lead cyclicals ({def_leaders} vs {cyc_leaders}) — rotation risk")

    # 3. EOD tide
    if tide.get("available"):
        if tide["eod_net_call_premium"] > 0:
            score += 1
            reasons.append("Intraday options tape closed net-call positive")
        else:
            score -= 1
            reasons.append("Intraday options tape closed net-call negative")

    # 4. P/C ratio
    pc = market_totals.get("pc_ratio") if market_totals.get("available") else None
    if pc is not None:
        if pc < 0.85:
            score += 1
            reasons.append(f"P/C ratio bullish ({pc:.2f})")
        elif pc > 1.05:
            score -= 1
            reasons.append(f"P/C ratio bearish ({pc:.2f})")

    # 5. Unusually bullish vs bearish
    counts = presets.get("counts", {}) if presets else {}
    ub = counts.get("unusually_bullish", 0)
    ubear = counts.get("unusually_bearish", 0)
    if ub > ubear:
        score += 1
        reasons.append(f"Bullish-flagged alerts > bearish-flagged ({ub} vs {ubear})")
    elif ubear > ub:
        score -= 1
        reasons.append(f"Bearish-flagged alerts > bullish-flagged ({ubear} vs {ub})")

    # 6. Deep conviction calls vs puts
    dcc = counts.get("deep_conviction_calls", 0)
    dcp = counts.get("deep_conviction_puts", 0)
    if dcc > dcp:
        score += 1
        reasons.append(f"High-conviction call flow > put flow ({dcc} vs {dcp})")
    elif dcp > dcc:
        score -= 1
        reasons.append(f"High-conviction put flow > call flow ({dcp} vs {dcc})")

    # 7. Put sells (vol-selling, implicit bullish)
    if counts.get("put_sells", 0) >= 20:
        score += 1
        reasons.append(f"Heavy put-selling activity ({counts.get('put_sells', 0)} alerts)")

    # 8. Tech narrowing
    if concentration.get("narrowing"):
        score -= 1
        reasons.append(f"Tech leadership narrowing onto a single name ({concentration.get('narrowing_ticker')})")

    # --- Map score => label
    if score >= 4:
        label = "BULL"
        headline = "Risk-on tape: broad participation, conviction flow leans long."
    elif score <= -4:
        label = "BEAR"
        headline = "Risk-off tape: distribution across the board."
    elif def_leaders > cyc_leaders and (tide.get("eod_net_call_premium", 0) < 0 if tide.get("available") else False):
        label = "DEFENSIVE ROTATION"
        headline = "Defensives lead, cyclicals fade — investors rotating into safety."
    elif concentration.get("narrowing") and score < 0:
        label = "RISK-OFF NARROWING"
        headline = "Tape thinning into one or two names — breadth deteriorating."
    elif score >= 1:
        label = "BASE (BULL TILT)"
        headline = "Mixed tape with a slight risk-on lean."
    elif score <= -1:
        label = "BASE (BEAR TILT)"
        headline = "Mixed tape with a slight risk-off lean."
    else:
        label = "BASE"
        headline = "Balanced tape — no decisive signal end-of-day."

    return {
        "score": score,
        "label": label,
        "headline": headline,
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Section 8 — "What to watch"
# ---------------------------------------------------------------------------

def build_watchlist(scenario: dict, sector: dict, darkpool: dict, concentration: dict) -> list[str]:
    items: list[str] = []
    # Sector follow-through
    laggards = sector.get("laggards", [])
    if laggards:
        worst = laggards[0]
        items.append(
            f"Watch {worst['name']} ({worst['ticker']}) {worst['change_pct_fmt']}: a green open "
            "tomorrow would suggest today's weakness was a one-day shakeout, not the start of a trend."
        )
    # Dark pool follow-through
    dp_rows = darkpool.get("rows", [])
    if dp_rows:
        top = dp_rows[0]
        items.append(
            f"Watch {top['ticker']} dark pool prints: another session above {top['total_premium_fmt']} "
            f"with {top['mega_print_count']}+ mega-prints would confirm institutional accumulation."
        )
    # Tech narrowing follow-through
    if concentration.get("narrowing"):
        items.append(
            f"Watch broader tech participation: if {concentration.get('narrowing_ticker')} is the only "
            "name carrying flow again, leadership narrowing thesis confirms."
        )
    # Scenario watch
    if "DEFENSIVE" in scenario["label"]:
        items.append(
            "Watch tomorrow's open: a quick recovery in Tech/Discretionary would reset today's rotation "
            "to noise; continuation would mark a regime shift."
        )
    elif scenario["label"] == "BULL":
        items.append(
            "Watch for follow-through: if leaders continue making higher highs into the close tomorrow, "
            "the risk-on read is confirmed."
        )
    elif scenario["label"] == "BEAR":
        items.append(
            "Watch for stabilization: a tape that holds today's lows by lunch tomorrow would be the first "
            "sign sellers are exhausted."
        )
    return items[:3]


# ---------------------------------------------------------------------------
# Top-level orchestrator
# ---------------------------------------------------------------------------

def aggregate(raw: dict, prev_raw: dict | None = None) -> dict:
    """Single entry point. Returns the dict the Jinja template expects."""
    market_totals = aggregate_market_totals(
        raw.get("market_totals"),
        raw.get("market_totals_prev"),
    )
    sector = aggregate_sector_heatmap(raw.get("sector_etfs") or [])
    tide = aggregate_intraday_tide(raw.get("market_tide") or [])
    concentration = aggregate_premium_concentration(raw.get("flow_alerts") or [])
    presets = aggregate_alert_presets(raw.get("flow_alerts") or [])
    darkpool = aggregate_darkpool(
        raw.get("darkpool") or {},
        (prev_raw or {}).get("darkpool") if prev_raw else None,
    )

    scenario = classify_scenario(market_totals, sector, tide, presets, concentration)
    watchlist = build_watchlist(scenario, sector, darkpool, concentration)

    return {
        "date": raw.get("date"),
        "prev_date": raw.get("prev_date"),
        "scenario": scenario,
        "market_totals": market_totals,
        "sector": sector,
        "tide": tide,
        "concentration": concentration,
        "darkpool": darkpool,
        "presets": presets,
        "watchlist": watchlist,
        "data_quality": raw.get("data_quality", {}),
        "generated_at_iso": datetime.utcnow().isoformat() + "Z",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse, json, sys
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="JSON file produced by fetcher")
    p.add_argument("--prev", default=None, help="Optional prev-day JSON for DP deltas")
    p.add_argument("--out", default=None)
    args = p.parse_args()

    with open(args.input) as f:
        raw = json.load(f)
    prev = None
    if args.prev:
        with open(args.prev) as f:
            prev = json.load(f)
    agg = aggregate(raw, prev)
    out_str = json.dumps(agg, indent=2, default=str)
    if args.out:
        with open(args.out, "w") as f:
            f.write(out_str)
    else:
        sys.stdout.write(out_str)
