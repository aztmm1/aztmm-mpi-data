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
  - Top 10 single-trade events (by premium)
  - Per-sector Top 3 single-name flow
  - Aggregate flow leaders (top 15)
  - Cross-cutting flow themes
  - 12 notable data points (auto-generated from heuristics)

NOTE: All upstream/data-vendor identifiers are intentionally scrubbed here.
Output strings use generic labels ("notable options activity", "intraday
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
# Ticker -> sector mapping (top ~100 most active UW flow names)
# ---------------------------------------------------------------------------

TICKER_SECTOR = {
    # Technology (XLK)
    "NVDA": "XLK", "AMD": "XLK", "INTC": "XLK", "MU": "XLK", "AVGO": "XLK",
    "AAPL": "XLK", "MSFT": "XLK", "GOOGL": "XLK", "GOOG": "XLK",
    "AMAT": "XLK", "LRCX": "XLK", "KLAC": "XLK", "MRVL": "XLK", "QCOM": "XLK",
    "TXN": "XLK", "ADI": "XLK", "ON": "XLK", "NXPI": "XLK", "ORCL": "XLK",
    "CRM": "XLK", "NOW": "XLK", "ADBE": "XLK", "PANW": "XLK", "CRWD": "XLK",
    "ANET": "XLK", "CSCO": "XLK", "DELL": "XLK", "SMCI": "XLK", "ARM": "XLK",
    "PLTR": "XLK", "SNOW": "XLK", "TSM": "XLK", "ASML": "XLK", "IBM": "XLK",
    "NBIS": "XLK", "CRWV": "XLK", "NOK": "XLK", "WOLF": "XLK", "LFUS": "XLK",
    "APLD": "XLF",  # APLD listed financial sleeve via REIT exposure — see note
    # Communication Services (XLC)
    "META": "XLC", "NFLX": "XLC", "DIS": "XLC", "T": "XLC", "VZ": "XLC",
    "TMUS": "XLC", "EA": "XLC", "TTWO": "XLC", "RBLX": "XLC",
    # Consumer Discretionary (XLY)
    "AMZN": "XLY", "TSLA": "XLY", "HD": "XLY", "MCD": "XLY", "NKE": "XLY",
    "BKNG": "XLY", "SBUX": "XLY", "LOW": "XLY", "F": "XLY", "GM": "XLY",
    "DKNG": "XLY", "BABA": "XLY",
    # Consumer Staples (XLP)
    "WMT": "XLP", "COST": "XLP", "PG": "XLP", "KO": "XLP", "PEP": "XLP",
    "MDLZ": "XLP", "PM": "XLP", "MO": "XLP", "CL": "XLP", "GO": "XLP",
    # Financials (XLF)
    "JPM": "XLF", "BAC": "XLF", "WFC": "XLF", "GS": "XLF", "MS": "XLF",
    "C": "XLF", "AXP": "XLF", "BLK": "XLF", "V": "XLF", "MA": "XLF",
    "BRK.B": "XLF", "COIN": "XLF", "HOOD": "XLF", "SOFI": "XLF",
    # Health Care (XLV)
    "UNH": "XLV", "JNJ": "XLV", "LLY": "XLV", "PFE": "XLV", "ABBV": "XLV",
    "MRK": "XLV", "TMO": "XLV", "ABT": "XLV", "AMGN": "XLV", "DHR": "XLV",
    "BMY": "XLV", "CVS": "XLV", "GILD": "XLV",
    # Industrials (XLI)
    "BA": "XLI", "HON": "XLI", "UNP": "XLI", "CAT": "XLI", "UPS": "XLI",
    "DE": "XLI", "RTX": "XLI", "GE": "XLI", "LMT": "XLI", "NOC": "XLI",
    "MMM": "XLI",
    # Energy (XLE)
    "XOM": "XLE", "CVX": "XLE", "COP": "XLE", "EOG": "XLE", "SLB": "XLE",
    "OXY": "XLE", "MPC": "XLE", "PSX": "XLE", "VLO": "XLE", "MRO": "XLE",
    # Utilities (XLU)
    "NEE": "XLU", "SO": "XLU", "DUK": "XLU", "AEP": "XLU", "EXC": "XLU",
    "CEG": "XLU", "GEV": "XLU", "VST": "XLU",
    # Materials (XLB)
    "LIN": "XLB", "FCX": "XLB", "NEM": "XLB", "SHW": "XLB", "ECL": "XLB",
    "DD": "XLB", "GOLD": "XLB", "LAC": "XLB", "FBIN": "XLB",
    # Real Estate (XLRE)
    "AMT": "XLRE", "PLD": "XLRE", "CCI": "XLRE", "EQIX": "XLRE",
    "WELL": "XLRE", "O": "XLRE", "SPG": "XLRE", "DLR": "XLRE",
    "FRMI": "XLRE",
}

# Cross-cutting theme buckets
THEME_BUCKETS = {
    "semis": {"NVDA", "AMD", "INTC", "MU", "AVGO", "TSM", "QCOM", "MRVL",
              "LRCX", "AMAT", "KLAC", "ADI", "TXN", "SMH", "SOXL", "SOXS",
              "ON", "NXPI", "ASML", "WOLF"},
    "ai_cloud": {"NBIS", "MSFT", "GOOGL", "GOOG", "ORCL", "ARM", "IBM",
                 "CRWV", "PLTR", "SNOW", "CRWD", "NOW", "ANET"},
    "bear_etfs": {"SQQQ", "SPXS", "SOXS", "TZA", "TBT", "TBF", "SDOW", "SPXU"},
    "vol_hedges": {"UVXY", "VXX", "SVXY", "VIXY"},
    "intl_regional": {"EWY", "EWJ", "FXI", "KWEB", "INDA", "EWT", "EWG",
                      "EWZ", "EWA", "EWC", "EEM", "VWO", "EFA"},
}

# Index / ETF complex tickers (often appear in flow but aren't a sector name)
INDEX_COMPLEX = {"SPX", "SPXW", "SPY", "QQQ", "IWM", "DIA", "NDX", "RUT",
                 "VIX", "SLV", "GLD", "UVXY", "VXX", "TLT"}


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


def _sector_of(tkr: str) -> str | None:
    """Return XL? sector code for a ticker, or None if unknown / index."""
    if not tkr:
        return None
    if tkr in INDEX_COMPLEX:
        return None
    return TICKER_SECTOR.get(tkr.upper())


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
    cp_skew = (call_prem / put_prem) if put_prem > 0 else None

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
        "cp_skew": cp_skew,
        "cp_skew_fmt": f"{cp_skew:.1f}:1" if cp_skew is not None else "n/a",
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

def _sector_band(change_pct: float, net_premium: float | None = None) -> str:
    """Band by change%, but if change_pct is unpopulated (==0) fall back to net premium sign."""
    if change_pct >= LEADING_THRESHOLD_PCT:
        return "leading"
    if change_pct <= LAGGING_THRESHOLD_PCT:
        return "lagging"
    # Fallback when change_pct field is unpopulated (we observed this in May 2026)
    if change_pct == 0.0 and net_premium is not None:
        if net_premium > 5_000_000:
            return "leading-strong"
        if net_premium > 0:
            return "leading"
        if net_premium < 0:
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
            "band": _sector_band(change_pct, net_prem),
        })

    # Sector-only rows (drop SPY from leadership ranking)
    sector_rows = [r for r in rows if r["ticker"] != "SPY"]
    # Order by net premium (descending) for heatmap display (richer than pct change when change_pct comes back 0)
    sector_rows.sort(key=lambda r: r["net_premium"], reverse=True)
    leaders = sector_rows[:3]
    laggards = [r for r in sector_rows if r["net_premium"] < 0][-3:][::-1]
    if not laggards:
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


def _alert_signed_premium(a: dict) -> float:
    """Signed premium: call+ask=+, call+bid=-0.5, put+ask=-, put+bid=+0.5."""
    prem = _flt(a.get("total_premium") or a.get("premium"))
    opt_type = (a.get("type") or a.get("option_type") or "").lower()
    side = (a.get("side") or "").lower()
    sign = 1.0
    if opt_type.startswith("c"):
        sign = +1.0 if side != "bid" else -0.5
    elif opt_type.startswith("p"):
        sign = -1.0 if side != "bid" else +0.5
    return sign * prem


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
        bucket[tkr] += _alert_signed_premium(a)

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
# NEW Section A — Top 10 single-trade events
# ---------------------------------------------------------------------------

def _vol_oi_fmt(v: float, oi: float) -> str:
    if v > 0 and oi > 0:
        return f"{int(v):,} / {int(oi):,} ({v/oi:.1f}x)"
    if v > 0:
        return f"{int(v):,} / n/a"
    return "n/a"


def aggregate_top_trades(flow_alerts: list[dict], top_n: int = 10) -> dict:
    """Top single-trade flow events, ranked by total premium."""
    rows: list[dict] = []
    for a in flow_alerts or []:
        if not isinstance(a, dict):
            continue
        tkr = a.get("ticker") or a.get("symbol")
        if not tkr:
            continue
        prem = _flt(a.get("total_premium") or a.get("premium"))
        if prem <= 0:
            continue
        opt_type = (a.get("type") or a.get("option_type") or "").lower()
        kind = "Call" if opt_type.startswith("c") else ("Put" if opt_type.startswith("p") else "—")
        strike = _flt(a.get("strike"))
        # strike formatting: int if whole, else 1-dp
        if strike > 0 and abs(strike - round(strike)) < 1e-6:
            strike_fmt = f"${int(round(strike))}"
        elif strike > 0:
            strike_fmt = f"${strike:.1f}"
        else:
            strike_fmt = "—"
        expiry = a.get("expiry") or a.get("expiration") or ""
        dte = _int(a.get("dte"))
        vol = _flt(a.get("volume") or a.get("total_size") or a.get("size"))
        oi = _flt(a.get("open_interest") or a.get("oi"))
        v_oi_ratio = _flt(a.get("volume_oi_ratio") or a.get("vol_oi_ratio"))
        underlying = _flt(a.get("underlying_price") or a.get("spot") or a.get("price_at_trade"))
        if underlying > 0 and abs(underlying - round(underlying)) < 1e-6:
            spot_fmt = f"${int(round(underlying))}"
        elif underlying > 0:
            spot_fmt = f"${underlying:g}"
        else:
            spot_fmt = "—"

        rows.append({
            "ticker": tkr,
            "kind": kind,
            "kind_class": "val-pos" if kind == "Call" else ("val-neg" if kind == "Put" else ""),
            "strike_fmt": strike_fmt,
            "expiry": expiry,
            "dte": dte,
            "premium": prem,
            "premium_fmt": _fmt_money(prem),
            "volume": vol,
            "oi": oi,
            "v_oi": v_oi_ratio if v_oi_ratio > 0 else ((vol / oi) if (vol > 0 and oi > 0) else 0),
            "v_oi_fmt": _vol_oi_fmt(vol, oi),
            "spot_fmt": spot_fmt,
        })

    rows.sort(key=lambda r: r["premium"], reverse=True)
    rows = rows[:top_n]
    # Format strike+expiry combined for compact display
    for r in rows:
        if r["expiry"]:
            r["strike_expiry_fmt"] = f"{r['strike_fmt']} · {r['expiry']} ({r['dte']}d)"
        else:
            r["strike_expiry_fmt"] = r["strike_fmt"]
    return {"available": bool(rows), "rows": rows}


# ---------------------------------------------------------------------------
# NEW Section B — Per-sector top 3 single-name flow
# ---------------------------------------------------------------------------

def aggregate_sector_top_names(flow_alerts: list[dict]) -> dict:
    """Bucket flow alerts by ticker -> sector, take top 3 per sector by aggregate premium."""
    by_sector: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for a in flow_alerts or []:
        if not isinstance(a, dict):
            continue
        tkr = (a.get("ticker") or a.get("symbol") or "").upper()
        if not tkr:
            continue
        sec = _sector_of(tkr)
        if not sec:
            continue
        prem = _flt(a.get("total_premium") or a.get("premium"))
        if prem <= 0:
            continue
        by_sector[sec][tkr] += prem

    # Build the 11-sector grid in canonical order
    sector_order = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK",
                    "XLP", "XLRE", "XLU", "XLV", "XLY"]
    blocks = []
    for sec in sector_order:
        tickers = by_sector.get(sec, {})
        top3 = sorted(tickers.items(), key=lambda kv: kv[1], reverse=True)[:3]
        blocks.append({
            "sector_code": sec,
            "sector_name": SECTOR_ETF_NAMES.get(sec, sec),
            "rows": [
                {"ticker": t, "premium": p, "premium_fmt": _fmt_money(p)}
                for t, p in top3
            ],
            "empty": not top3,
        })
    return {"available": True, "blocks": blocks}


# ---------------------------------------------------------------------------
# NEW Section C — Aggregate flow leaders (top 15 names)
# ---------------------------------------------------------------------------

def aggregate_flow_leaders(flow_alerts: list[dict], top_n: int = 15) -> dict:
    """Sum total premium and trade count per ticker; rank top N."""
    by_ticker: dict[str, dict] = defaultdict(lambda: {"premium": 0.0, "trades": 0})
    for a in flow_alerts or []:
        if not isinstance(a, dict):
            continue
        tkr = (a.get("ticker") or a.get("symbol") or "").upper()
        if not tkr:
            continue
        prem = _flt(a.get("total_premium") or a.get("premium"))
        if prem <= 0:
            continue
        by_ticker[tkr]["premium"] += prem
        by_ticker[tkr]["trades"] += 1

    rows = []
    for tkr, agg in sorted(by_ticker.items(), key=lambda kv: kv[1]["premium"], reverse=True)[:top_n]:
        sec = _sector_of(tkr)
        sec_label = f"{SECTOR_ETF_NAMES[sec]} ({sec})" if sec else "—"
        rows.append({
            "ticker": tkr,
            "premium": agg["premium"],
            "premium_fmt": _fmt_money(agg["premium"]),
            "trades": agg["trades"],
            "sector_label": sec_label,
        })
    return {"available": bool(rows), "rows": rows}


# ---------------------------------------------------------------------------
# NEW Section D — Cross-cutting flow themes
# ---------------------------------------------------------------------------

THEME_LABELS = {
    "semis": "Semiconductors aggregate",
    "ai_cloud": "AI / cloud names",
    "bear_etfs": "Inverse / bear ETFs",
    "vol_hedges": "Volatility hedges",
    "intl_regional": "International / regional ETFs",
}

THEME_MIN_PREM = 100_000  # < $100K, theme is "effectively quiet"


def aggregate_themes(flow_alerts: list[dict]) -> dict:
    """For each themed bucket, sum premium and compute a journal note."""
    totals = {k: 0.0 for k in THEME_BUCKETS}
    top_in_bucket: dict[str, dict[str, float]] = {k: defaultdict(float) for k in THEME_BUCKETS}

    for a in flow_alerts or []:
        if not isinstance(a, dict):
            continue
        tkr = (a.get("ticker") or a.get("symbol") or "").upper()
        if not tkr:
            continue
        prem = _flt(a.get("total_premium") or a.get("premium"))
        if prem <= 0:
            continue
        for theme, members in THEME_BUCKETS.items():
            if tkr in members:
                totals[theme] += prem
                top_in_bucket[theme][tkr] += prem

    themes_out = []
    for k in ["semis", "ai_cloud", "bear_etfs", "vol_hedges", "intl_regional"]:
        total = totals.get(k, 0.0)
        names = sorted(top_in_bucket[k].items(), key=lambda kv: kv[1], reverse=True)[:3]
        quiet = total < THEME_MIN_PREM
        themes_out.append({
            "key": k,
            "label": THEME_LABELS[k],
            "total_premium": total,
            "total_premium_fmt": _fmt_money(total),
            "top_names": [{"ticker": t, "premium_fmt": _fmt_money(p)} for t, p in names],
            "quiet": quiet,
        })
    return {"available": True, "themes": themes_out}


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
                if pct >= 100:
                    row["pct_class"] = "pct-surge"
                elif pct >= 0:
                    row["pct_class"] = "pct-up"
                else:
                    row["pct_class"] = "pct-down"
            else:
                row["pct_change_vs_prev"] = None
                row["pct_change_fmt"] = "n/a"
                row["pct_class"] = ""
        else:
            row["pct_change_vs_prev"] = None
            row["pct_change_fmt"] = "n/a"
            row["pct_class"] = ""
        rows.append(row)

    rows.sort(key=lambda r: r["total_premium"], reverse=True)
    return {"available": bool(rows), "rows": rows[:10]}


# ---------------------------------------------------------------------------
# Section 6 — Unusual alert preset counts
# ---------------------------------------------------------------------------

def aggregate_alert_presets(flow_alerts: list[dict]) -> dict:
    """
    Reproduce preset counts using alert-field heuristics:
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
    score = 0
    reasons: list[str] = []

    # 1. Sector breadth (use net_premium sign when change_pct is missing)
    sec_rows = sector.get("sector_rows", [])
    pos_n = sum(1 for r in sec_rows if r["net_premium"] > 0)
    neg_n = sum(1 for r in sec_rows if r["net_premium"] < 0)
    if pos_n > neg_n:
        score += 1
        reasons.append(f"Sector breadth tilts up ({pos_n} net-positive vs {neg_n} net-negative)")
    elif neg_n > pos_n:
        score -= 1
        reasons.append(f"Sector breadth tilts down ({neg_n} net-negative vs {pos_n} net-positive)")

    # 2. Defensive vs cyclical (positive net premium proxy)
    def_pos = sum(1 for r in sec_rows if r["ticker"] in DEFENSIVE_SECTORS and r["net_premium"] > 0)
    cyc_pos = sum(1 for r in sec_rows if r["ticker"] in CYCLICAL_SECTORS and r["net_premium"] > 0)
    if cyc_pos > def_pos:
        score += 1
        reasons.append(f"Cyclicals lead defensives ({cyc_pos} vs {def_pos})")
    elif def_pos > cyc_pos:
        score -= 1
        reasons.append(f"Defensives lead cyclicals ({def_pos} vs {cyc_pos}) — rotation risk")

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
        reasons.append(f"Bullish-flagged notable activity > bearish-flagged ({ub} vs {ubear})")
    elif ubear > ub:
        score -= 1
        reasons.append(f"Bearish-flagged notable activity > bullish-flagged ({ubear} vs {ub})")

    # 6. Deep conviction calls vs puts
    dcc = counts.get("deep_conviction_calls", 0)
    dcp = counts.get("deep_conviction_puts", 0)
    if dcc > dcp:
        score += 1
        reasons.append(f"High-conviction call flow > put flow ({dcc} vs {dcp})")
    elif dcp > dcc:
        score -= 1
        reasons.append(f"High-conviction put flow > call flow ({dcp} vs {dcc})")

    # 7. Put sells
    if counts.get("put_sells", 0) >= 20:
        score += 1
        reasons.append(f"Heavy put-selling activity ({counts.get('put_sells', 0)} notable)")

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
    elif def_pos > cyc_pos and (tide.get("eod_net_call_premium", 0) < 0 if tide.get("available") else False):
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
# NEW Section E — 12 notable data points
# ---------------------------------------------------------------------------

def build_notable_points(market_totals, sector, tide, top_trades, leaders,
                         themes, darkpool, concentration, presets) -> list[str]:
    """Heuristic 12-item list of one-line observations.

    All strings are observation-voice (past tense, descriptive only).
    Each item may contain inline span classes (.pos/.neg/.warn/.accent) for
    template highlighting. The publisher's brand scrub will fail on any
    advisory verb so this stays conservative.
    """
    notes: list[str] = []

    # 1. Call/put premium skew
    if market_totals.get("available"):
        cp_skew = market_totals.get("cp_skew")
        cp_fmt = market_totals.get("cp_skew_fmt") or "n/a"
        notes.append(
            f"Call premium printed <strong>{market_totals['call_premium_fmt']}</strong> against put "
            f"premium of <strong>{market_totals['put_premium_fmt']}</strong> &mdash; a {cp_fmt} skew across the session."
        )

    # 2. EOD tide
    if tide.get("available"):
        eod = tide["eod_net_call_premium"]
        cls = "pos" if eod > 0 else "neg"
        direction_phrase = "paid for upside through the bell" if eod > 0 else "leaned to protection through the bell"
        notes.append(
            f"End-of-day cumulative net call premium closed at <span class=\"{cls}\">{tide['eod_net_call_premium_fmt']}</span> "
            f"&mdash; the option tape {direction_phrase}."
        )

    # 3. Biggest sector net (positive)
    sec_rows = sector.get("sector_rows", [])
    pos_sorted = sorted([r for r in sec_rows if r["net_premium"] > 0],
                        key=lambda r: r["net_premium"], reverse=True)
    if pos_sorted:
        top_sec = pos_sorted[0]
        notes.append(
            f"{top_sec['name']} ({top_sec['ticker']}) net call premium hit "
            f"<span class=\"pos\">{top_sec['net_premium_fmt']}</span> &mdash; the largest one-sector net in today's heatmap."
        )

    # 4. Most call-skewed sector (call/put ratio)
    skewed = []
    for r in sec_rows:
        if r["put_premium"] > 0 and r["call_premium"] > 0:
            ratio = r["call_premium"] / r["put_premium"]
            skewed.append((r, ratio))
    skewed.sort(key=lambda kv: kv[1], reverse=True)
    if skewed:
        r, ratio = skewed[0]
        notes.append(
            f"{r['name']} ({r['ticker']}) posted a <strong>{ratio:.1f}:1 call-to-put ratio</strong> on "
            f"{r['call_premium_fmt']} of call premium &mdash; the most call-skewed sector in the book."
        )

    # 5. Inverted sectors (negative net)
    neg_rows = [r for r in sec_rows if r["net_premium"] < 0]
    if neg_rows:
        neg_rows.sort(key=lambda r: r["net_premium"])
        if len(neg_rows) >= 2:
            r1, r2 = neg_rows[0], neg_rows[1]
            notes.append(
                f"{r1['name']} ({r1['ticker']}) <span class=\"neg\">inverted</span> at {r1['net_premium_fmt']} "
                f"and {r2['name']} ({r2['ticker']}) at <span class=\"neg\">{r2['net_premium_fmt']}</span> "
                f"&mdash; defense was selective, not broad."
            )
        else:
            r1 = neg_rows[0]
            notes.append(
                f"{r1['name']} ({r1['ticker']}) <span class=\"neg\">inverted</span> at "
                f"{r1['net_premium_fmt']} &mdash; the only sector with put premium &gt; call premium today."
            )

    # 6. Biggest single trade event
    tt_rows = top_trades.get("rows", [])
    if tt_rows:
        t = tt_rows[0]
        notes.append(
            f"Today's largest single-trade event was a <strong>{t['ticker']} {t['strike_fmt']} "
            f"{t['kind'].lower()}</strong> dated {t['expiry']} at <span class=\"pos\">{t['premium_fmt']}</span> in premium."
        )

    # 7. Top aggregate flow leader
    ld_rows = leaders.get("rows", [])
    if ld_rows:
        top_ld = ld_rows[0]
        notes.append(
            f"Aggregate notable flow on <strong>{top_ld['ticker']}</strong> totaled {top_ld['premium_fmt']} "
            f"across {top_ld['trades']} trade{'s' if top_ld['trades'] != 1 else ''} &mdash; the top single-name in the notable-flow book."
        )

    # 8. Top trade #2 (second-largest single trade) — separate notable
    if len(tt_rows) >= 2:
        t2 = tt_rows[1]
        v_oi_phrase = f"on a {t2['v_oi']:.1f}x volume-to-OI ratio" if t2.get("v_oi") and t2["v_oi"] > 0 else ""
        notes.append(
            f"<strong>{t2['ticker']} {t2['strike_fmt']} {t2['kind'].lower()}</strong> expiring "
            f"{t2['expiry']} printed {t2['premium_fmt']}{(' ' + v_oi_phrase) if v_oi_phrase else ''}."
        )

    # 9. Biggest dark pool day-over-day surge
    dp_rows = darkpool.get("rows", [])
    surges = [r for r in dp_rows if r.get("pct_change_vs_prev") is not None and r["pct_change_vs_prev"] > 0]
    surges.sort(key=lambda r: r["pct_change_vs_prev"], reverse=True)
    if surges:
        s = surges[0]
        notes.append(
            f"{s['ticker']} dark pool ran <span class=\"warn\">{s['total_premium_fmt']} with "
            f"{s['mega_print_count']} mega-print{'s' if s['mega_print_count'] != 1 else ''} (&ge;100K shares), "
            f"up {s['pct_change_vs_prev']:.0f}% from prior session</span> &mdash; the biggest day-over-day surge in the dark-pool tape."
        )

    # 10. SPY/QQQ mega-print count leader
    spy_qqq = [r for r in dp_rows if r["ticker"] in ("SPY", "QQQ")]
    if spy_qqq:
        spy_qqq.sort(key=lambda r: r["mega_print_count"], reverse=True)
        s = spy_qqq[0]
        notes.append(
            f"{s['ticker']} dark pool held <strong>{s['mega_print_count']} mega-prints</strong> on "
            f"{s['total_premium_fmt']} premium &mdash; mega-print count is the line and it stayed elevated."
        )

    # 11. Semis aggregate
    themes_list = themes.get("themes", [])
    semis = next((t for t in themes_list if t["key"] == "semis"), None)
    if semis and semis["total_premium"] >= THEME_MIN_PREM:
        notes.append(
            f"Combined semi-complex notable premium reached <span class=\"pos\">{semis['total_premium_fmt']}</span> "
            f"&mdash; the heaviest single-theme concentration in the notable-flow tape today."
        )
    elif semis:
        notes.append(
            f"Semi-complex notable premium was light today at {semis['total_premium_fmt']} &mdash; "
            f"the heaviest names were quiet in the notable-flow tape."
        )

    # 12. Hedge gauge (bear ETFs + vol hedges + intl)
    bear = next((t for t in themes_list if t["key"] == "bear_etfs"), None)
    vol = next((t for t in themes_list if t["key"] == "vol_hedges"), None)
    intl = next((t for t in themes_list if t["key"] == "intl_regional"), None)
    if bear and vol:
        total_hedge = (bear["total_premium"] + vol["total_premium"])
        if total_hedge < THEME_MIN_PREM:
            notes.append(
                "Combined inverse-ETF and volatility-hedge notable premium was effectively zero today "
                "&mdash; the tape did not pay for protection."
            )
        else:
            notes.append(
                f"Combined inverse-ETF + volatility-hedge notable premium totaled {_fmt_money(total_hedge)} "
                f"&mdash; modest hedge demand but not broad."
            )
    elif intl and intl["total_premium"] >= THEME_MIN_PREM:
        top_intl = intl["top_names"][0]["ticker"] if intl["top_names"] else "—"
        notes.append(
            f"International / regional ETF notable premium totaled {intl['total_premium_fmt']} "
            f"(led by {top_intl}) &mdash; the only cross-regional flow tilt in the book."
        )

    # Cap to 12 — heuristic order above already prioritizes the most informative
    return notes[:12]


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
            f"Watch <strong>{worst['name']} ({worst['ticker']})</strong> at "
            f"{worst['net_premium_fmt']} net option premium: another inverted session would extend "
            "today's defensive read; a swing back to net-positive would call it a one-day shakeout."
        )
    # Dark pool follow-through
    dp_rows = darkpool.get("rows", [])
    surges = [r for r in dp_rows if r.get("pct_change_vs_prev") is not None and r["pct_change_vs_prev"] > 100]
    surges.sort(key=lambda r: r["pct_change_vs_prev"], reverse=True)
    if surges:
        top = surges[0]
        items.append(
            f"<strong>{top['ticker']} dark pool follow-through.</strong> Mega-print activity ran "
            f"+{top['pct_change_vs_prev']:.0f}% to {top['total_premium_fmt']} today. If tomorrow holds "
            "above that band it's a theme; if it fades back to the prior baseline, today was a one-day "
            "institutional rebalance and nothing more."
        )
    elif dp_rows:
        top = dp_rows[0]
        items.append(
            f"<strong>{top['ticker']} dark pool baseline.</strong> Another session above "
            f"{top['total_premium_fmt']} with {top['mega_print_count']}+ mega-prints would mark continued institutional accumulation."
        )
    # Tech narrowing follow-through
    if concentration.get("narrowing"):
        items.append(
            f"<strong>Tech breadth.</strong> If {concentration.get('narrowing_ticker')} is again the only "
            "tech name carrying flow tomorrow, the narrowing thesis confirms; broader participation would reset it."
        )
    # Scenario watch
    if "DEFENSIVE" in scenario["label"]:
        items.append(
            "<strong>Rotation read.</strong> A quick recovery in Tech / Discretionary at tomorrow's open "
            "would reset today's rotation to noise; continuation would mark a regime shift."
        )
    elif scenario["label"] == "BULL":
        items.append(
            "<strong>Follow-through.</strong> If leaders continue making higher highs into tomorrow's close, the risk-on read confirms."
        )
    elif scenario["label"] == "BEAR":
        items.append(
            "<strong>Stabilization.</strong> A tape that holds today's lows by lunch tomorrow would be the first sign sellers are exhausted."
        )
    return items[:4]


# ---------------------------------------------------------------------------
# Narrative builder (the "What I noticed today" block)
# ---------------------------------------------------------------------------

def _span(value: str, cls: str) -> str:
    return f"<span class=\"{cls}\">{value}</span>"


def build_narrative(market_totals: dict, sector: dict, tide: dict,
                    concentration: dict, darkpool: dict,
                    leaders: dict, themes: dict) -> list[str]:
    """Return 3-5 paragraphs of journal-voice narrative (HTML strings)."""
    paragraphs: list[str] = []

    # Paragraph 1: option-book lopsidedness + EOD tide
    if market_totals.get("available") and tide.get("available"):
        cp_skew = market_totals.get("cp_skew") or 0
        eod = tide["eod_net_call_premium"]
        eod_cls = "pos" if eod > 0 else "neg"
        skew_phrase = f"{cp_skew:.1f}:1" if cp_skew else "skew"
        direction = "paying for upside through the bell" if eod > 0 else "paying for protection through the bell"
        paragraphs.append(
            "The first thing that jumped out was the lopsidedness of the option book. "
            f"<strong>Call premium printed {_span(market_totals['call_premium_fmt'], 'pos')} "
            f"against put premium of {_span(market_totals['put_premium_fmt'], 'neg')}</strong> "
            f"&mdash; a {skew_phrase} skew &mdash; "
            f"and the P/C volume ratio held at {_span(market_totals['pc_ratio_fmt'], 'accent')} all session. "
            f"The EOD cumulative net call premium closed at <strong>{_span(tide['eod_net_call_premium_fmt'], eod_cls)}</strong>, "
            f"which is the tell I pay attention to. Tape participants were {direction}. "
            "Whether that conviction holds tomorrow is a separate question, but the read on today was clean."
        )

    # Paragraph 2: sector tape
    sec_rows = sector.get("sector_rows", [])
    pos_sorted = sorted([r for r in sec_rows if r["net_premium"] > 0],
                        key=lambda r: r["net_premium"], reverse=True)
    neg_sorted = sorted([r for r in sec_rows if r["net_premium"] < 0],
                        key=lambda r: r["net_premium"])
    if pos_sorted:
        top_sec = pos_sorted[0]
        para2 = (
            f"What stood out next was the sector tape. {top_sec['name']} ({top_sec['ticker']}) ran "
            f"<strong>{top_sec['call_premium_fmt']} in call premium against {top_sec['put_premium_fmt']} in puts</strong> "
            f"&mdash; a net of <span class=\"pos\">{top_sec['net_premium_fmt']}</span> that led the heatmap. "
        )
        if len(pos_sorted) >= 2:
            r2 = pos_sorted[1]
            if r2["put_premium"] > 0:
                ratio = r2["call_premium"] / r2["put_premium"]
                para2 += (
                    f"{r2['name']} ({r2['ticker']}) was the second-tier read at "
                    f"<span class=\"pos\">{r2['net_premium_fmt']}</span> net, with a "
                    f"{ratio:.1f}:1 call-to-put ratio. "
                )
        paragraphs.append(para2)

    # Paragraph 3: inversions / cracks
    if neg_sorted:
        if len(neg_sorted) >= 2:
            r1, r2 = neg_sorted[0], neg_sorted[1]
            paragraphs.append(
                f"The cracks were in {r1['name'].lower()} and {r2['name'].lower()}. "
                f"<strong>{r1['ticker']} inverted</strong> with {r1['call_premium_fmt']} call against {r1['put_premium_fmt']} put "
                f"for a net of <span class=\"neg\">{r1['net_premium_fmt']}</span>, and {r2['ticker']} did the same at "
                f"<span class=\"neg\">{r2['net_premium_fmt']}</span>. Defense was selective today, not broad &mdash; "
                "the tape didn't hedge everything, it hedged the cyclicals."
            )
        else:
            r1 = neg_sorted[0]
            paragraphs.append(
                f"The one crack was in {r1['name'].lower()} ({r1['ticker']}), which inverted at "
                f"<span class=\"neg\">{r1['net_premium_fmt']}</span> net &mdash; isolated rather than systemic."
            )

    # Paragraph 4: aggregate flow / index complex
    ld_rows = leaders.get("rows", [])
    if ld_rows:
        top3 = ld_rows[:3]
        names = ", ".join(f"<strong>{r['ticker']}</strong> ({r['premium_fmt']})" for r in top3)
        paragraphs.append(
            f"Single-name aggregate flow lined up as {names} at the top of the notable-flow book. "
            "Where the index complex (SPX, SPXW, SPY, QQQ, IWM) shows up in this list is the part I tag and watch the next session "
            "&mdash; index-side flow doesn't move like single-name flow."
        )

    # Paragraph 5: dark pool tape
    dp_rows = darkpool.get("rows", [])
    surges = [r for r in dp_rows if r.get("pct_change_vs_prev") is not None and r["pct_change_vs_prev"] > 100]
    surges.sort(key=lambda r: r["pct_change_vs_prev"], reverse=True)
    if surges:
        s = surges[0]
        spy = next((r for r in dp_rows if r["ticker"] == "SPY"), None)
        spy_phrase = (
            f"SPY ran {spy['total_premium_fmt']} with {spy['mega_print_count']} mega-prints (each &ge;100K shares)"
            if spy else "SPY was in baseline range"
        )
        paragraphs.append(
            f"And then the dark pool tape: <strong>{s['ticker']} at "
            f"<span class=\"warn\">{s['total_premium_fmt']} in mega-print activity, "
            f"up {s['pct_change_vs_prev']:.0f}% from prior session</span></strong> &mdash; the single biggest day-over-day surge today. "
            f"{spy_phrase}. "
            f"The {s['ticker']} print is the one I want to see tomorrow: if it sustains, it's a theme; if it fades, today was a one-day institutional rebalance."
        )
    elif dp_rows:
        top = dp_rows[0]
        paragraphs.append(
            f"On the dark pool side, {top['ticker']} held the top slot at {top['total_premium_fmt']} with "
            f"{top['mega_print_count']} mega-prints. Nothing exotic in the tape, but the mega-print count is the line I watch and it stayed in range."
        )

    return paragraphs


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

    # NEW sections
    top_trades = aggregate_top_trades(raw.get("flow_alerts") or [])
    sector_top_names = aggregate_sector_top_names(raw.get("flow_alerts") or [])
    flow_leaders = aggregate_flow_leaders(raw.get("flow_alerts") or [])
    themes = aggregate_themes(raw.get("flow_alerts") or [])

    scenario = classify_scenario(market_totals, sector, tide, presets, concentration)
    watchlist = build_watchlist(scenario, sector, darkpool, concentration)
    narrative = build_narrative(market_totals, sector, tide, concentration,
                                darkpool, flow_leaders, themes)
    notable_points = build_notable_points(market_totals, sector, tide,
                                          top_trades, flow_leaders, themes,
                                          darkpool, concentration, presets)

    # Compose a richer hero subtitle when context allows
    subtitle = None
    sec_rows = sector.get("sector_rows", [])
    pos_sec = [r for r in sec_rows if r["net_premium"] > 0]
    if pos_sec and tide.get("available"):
        top_sec = max(pos_sec, key=lambda r: r["net_premium"])
        subtitle = (
            f"A tape where the option book ran {market_totals.get('cp_skew_fmt') or 'lopsided'}, "
            f"{top_sec['name']} hogged the call book, and the dark-pool tape produced the day's most-watched surprise."
        )

    return {
        "date": raw.get("date"),
        "prev_date": raw.get("prev_date"),
        "scenario": scenario,
        "subtitle": subtitle,
        "market_totals": market_totals,
        "sector": sector,
        "tide": tide,
        "concentration": concentration,
        "darkpool": darkpool,
        "presets": presets,
        "top_trades": top_trades,
        "sector_top_names": sector_top_names,
        "flow_leaders": flow_leaders,
        "themes": themes,
        "notable_points": notable_points,
        "narrative": narrative,
        "watchlist": watchlist,
        "data_quality": raw.get("data_quality", {}),
        "generated_at_iso": datetime.utcnow().isoformat() + "Z",
        "headline_metric": {
            "label": "Scenario score",
            "value": scenario.get("score"),
        },
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
