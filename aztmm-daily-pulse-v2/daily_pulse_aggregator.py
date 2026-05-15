"""
AZTMM Daily Pulse v2 — Aggregator (v3 template port)
=====================================================

Pure functions. No I/O.

Input:  the dict shape produced by daily_pulse_fetcher.fetch_daily_data()
Output: a single structured dict ready to drop into the v3 Jinja template
        (daily_pulse_template.html.j2).

The v3 template expects these top-level keys:
  - post_date_display          "Thursday May 14, 2026"
  - headline                   one-sentence neutral observation (80-110 chars)
  - mpi_score / mpi_label
  - regime_short / regime_confidence_label
  - key_metric_label/value/caption
  - hero_underline_color       (#0ea5e9 default, #10b981 if tells fire,
                                #fb7185 if catalyst dominates)
  - tells                      list of {ticker, sub_header, observation, accent_color}
                                EMPTY when no name scores >=80 internal conviction
                                (triggers Quiet Tape panel in template)
  - changes                    list of 3 {arrow, arrow_color, text}
  - catalysts                  list of 1-2 {text}
  - appendix_url               full URL to today's web post
  - data_quality               (passed through for the data-quality footnote)

The legacy "scenario" / "sector" / "watchlist" etc. fields remain in the
returned dict for backward compatibility with the payload JSON consumers
(history sparkline + sample-output payloads), but the v3 template does not
render them.

CONVICTION SCORE: a composite-conviction score (0-100) is computed per
ticker from flow + dark-pool signals. Names with conviction >= 80 surface
as "tells" in the rendered post. The score itself is INTERNAL — it must
never appear in user-visible output (brand_check enforces).
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

# Loose sector classification for tell sub-headers (consumer cyclical, etc.)
TICKER_SECTOR = {
    "NVDA": "Technology", "MSFT": "Technology", "AAPL": "Technology",
    "GOOGL": "Communication", "GOOG": "Communication", "META": "Communication",
    "TSLA": "Consumer cyclical", "AMZN": "Consumer cyclical",
    "AVGO": "Technology", "AMD": "Technology", "QCOM": "Technology",
    "INTC": "Technology", "TSM": "Technology", "CRM": "Technology",
    "ORCL": "Technology", "ADBE": "Technology", "MU": "Technology",
    "JPM": "Financials", "BAC": "Financials", "GS": "Financials",
    "XOM": "Energy", "CVX": "Energy",
    "UNH": "Health care", "JNJ": "Health care",
    "WMT": "Consumer staples", "PG": "Consumer staples",
}

LEADING_THRESHOLD_PCT = 0.5
LAGGING_THRESHOLD_PCT = -0.5

MEGA_PRINT_SHARES = 100_000
TECH_NARROW_TOP_N = 5
TECH_NARROW_RATIO = 0.55

DEFENSIVE_SECTORS = {"XLV", "XLP", "XLU"}
CYCLICAL_SECTORS = {"XLK", "XLY", "XLC", "XLI", "XLB"}

CONVICTION_GATE = 80


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


def _fmt_date_long(date_str: str) -> str:
    """'2026-05-14' -> 'Thursday May 14, 2026'."""
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
        return d.strftime("%A %B %-d, %Y")
    except (ValueError, TypeError):
        return date_str or ""


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
    # Call/put premium ratio — useful for the "Tape" key-metric pill
    if put_prem > 0:
        out["call_put_premium_ratio"] = call_prem / put_prem
        out["call_put_premium_ratio_fmt"] = f"Call {call_prem/put_prem:.1f}×"
    elif put_prem == 0 and call_prem > 0:
        out["call_put_premium_ratio"] = None
        out["call_put_premium_ratio_fmt"] = "Call dominant"
    else:
        out["call_put_premium_ratio"] = None
        out["call_put_premium_ratio_fmt"] = "n/a"
    return out


# ---------------------------------------------------------------------------
# Section 2 — Sector heatmap (kept for back-compat)
# ---------------------------------------------------------------------------

def _sector_band(change_pct: float) -> str:
    if change_pct >= LEADING_THRESHOLD_PCT:
        return "leading"
    if change_pct <= LAGGING_THRESHOLD_PCT:
        return "lagging"
    return "neutral"


def aggregate_sector_heatmap(sector_etfs: list[dict]) -> dict:
    rows: list[dict] = []
    for s in sector_etfs or []:
        ticker = s.get("ticker") or s.get("symbol")
        if not ticker:
            continue
        change_pct = _flt(s.get("change_percent") or s.get("change_pct"))
        call_prem = _flt(s.get("call_premium"))
        put_prem = _flt(s.get("put_premium"))
        net_prem = call_prem - put_prem

        close = _flt(s.get("close") or s.get("price") or s.get("last"))
        rows.append({
            "ticker": ticker,
            "name": SECTOR_ETF_NAMES.get(ticker, ticker),
            "change_pct": change_pct,
            "change_pct_fmt": _fmt_pct(change_pct),
            "close": close,
            "call_premium": call_prem,
            "call_premium_fmt": _fmt_money(call_prem),
            "put_premium": put_prem,
            "put_premium_fmt": _fmt_money(put_prem),
            "net_premium": net_prem,
            "net_premium_fmt": _fmt_money(net_prem),
            "band": _sector_band(change_pct),
        })

    sector_rows = [r for r in rows if r["ticker"] != "SPY"]
    sector_rows.sort(key=lambda r: r["change_pct"], reverse=True)
    leaders = sector_rows[:3]
    laggards = sector_rows[-3:][::-1]

    spy_row = next((r for r in rows if r["ticker"] == "SPY"), None)

    return {
        "rows": rows,
        "sector_rows": sector_rows,
        "leaders": leaders,
        "laggards": laggards,
        "spy": spy_row,
    }


# ---------------------------------------------------------------------------
# Section 3 — Intraday tide
# ---------------------------------------------------------------------------

def aggregate_intraday_tide(market_tide: list[dict], prev_market_tide: list[dict] | None = None) -> dict:
    if not market_tide:
        return {"available": False}
    last = market_tide[-1] if isinstance(market_tide, list) else None
    if not isinstance(last, dict):
        return {"available": False}

    net_call_prem = _flt(last.get("net_call_premium"))
    net_put_prem = _flt(last.get("net_put_premium"))
    net_volume = _flt(last.get("net_volume"))

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
# Section 4 — Premium concentration (back-compat)
# ---------------------------------------------------------------------------

TECH_TICKERS = {
    "NVDA", "MSFT", "AAPL", "GOOGL", "GOOG", "META", "TSLA", "AMZN",
    "AVGO", "AMD", "QCOM", "INTC", "TSM", "CRM", "ORCL", "ADBE", "MU",
    "QQQ", "XLK", "SMH",
}


def aggregate_premium_concentration(flow_alerts: list[dict]) -> dict:
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
# Section 5 — Dark pool
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


def _dp_largest_print(prints: list[dict]) -> dict | None:
    if not prints:
        return None
    largest = None
    for p in prints:
        if not isinstance(p, dict):
            continue
        if largest is None or _int(p.get("size")) > _int(largest.get("size")):
            largest = p
    return largest


def aggregate_darkpool(darkpool: dict, prev_darkpool: dict | None = None) -> dict:
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
# Section 6 — Alert preset counts (back-compat)
# ---------------------------------------------------------------------------

def aggregate_alert_presets(flow_alerts: list[dict]) -> dict:
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
# Section 7 — Scenario scorecard (back-compat for payload + sparkline)
# ---------------------------------------------------------------------------

def classify_scenario(market_totals, sector, tide, presets, concentration):
    score = 0
    reasons: list[str] = []
    sec_rows = sector.get("sector_rows", [])
    leading_n = sum(1 for r in sec_rows if r["band"] == "leading")
    lagging_n = sum(1 for r in sec_rows if r["band"] == "lagging")
    if leading_n > lagging_n:
        score += 1; reasons.append(f"Sector breadth tilts up ({leading_n} vs {lagging_n})")
    elif lagging_n > leading_n:
        score -= 1; reasons.append(f"Sector breadth tilts down ({lagging_n} vs {leading_n})")

    def_leaders = sum(1 for r in sec_rows if r["ticker"] in DEFENSIVE_SECTORS and r["band"] == "leading")
    cyc_leaders = sum(1 for r in sec_rows if r["ticker"] in CYCLICAL_SECTORS and r["band"] == "leading")
    if cyc_leaders > def_leaders:
        score += 1; reasons.append(f"Cyclicals lead defensives ({cyc_leaders} vs {def_leaders})")
    elif def_leaders > cyc_leaders:
        score -= 1; reasons.append(f"Defensives lead cyclicals ({def_leaders} vs {cyc_leaders})")

    if tide.get("available"):
        if tide["eod_net_call_premium"] > 0:
            score += 1; reasons.append("Intraday options tape closed net-call positive")
        else:
            score -= 1; reasons.append("Intraday options tape closed net-call negative")

    pc = market_totals.get("pc_ratio") if market_totals.get("available") else None
    if pc is not None:
        if pc < 0.85:
            score += 1; reasons.append(f"P/C ratio bullish ({pc:.2f})")
        elif pc > 1.05:
            score -= 1; reasons.append(f"P/C ratio bearish ({pc:.2f})")

    counts = presets.get("counts", {}) if presets else {}
    ub = counts.get("unusually_bullish", 0); ubear = counts.get("unusually_bearish", 0)
    if ub > ubear:
        score += 1; reasons.append(f"Bullish-flagged alerts > bearish ({ub} vs {ubear})")
    elif ubear > ub:
        score -= 1; reasons.append(f"Bearish-flagged alerts > bullish ({ubear} vs {ub})")

    dcc = counts.get("deep_conviction_calls", 0); dcp = counts.get("deep_conviction_puts", 0)
    if dcc > dcp:
        score += 1; reasons.append(f"High-conviction call flow > put ({dcc} vs {dcp})")
    elif dcp > dcc:
        score -= 1; reasons.append(f"High-conviction put flow > call ({dcp} vs {dcc})")

    if counts.get("put_sells", 0) >= 20:
        score += 1; reasons.append(f"Heavy put-selling ({counts.get('put_sells',0)} alerts)")

    if concentration.get("narrowing"):
        score -= 1; reasons.append(f"Tech narrowing onto {concentration.get('narrowing_ticker')}")

    if score >= 4:
        label = "BULL"; headline = "Risk-on tape: broad participation, conviction flow leans long."
    elif score <= -4:
        label = "BEAR"; headline = "Risk-off tape: distribution across the board."
    elif score >= 1:
        label = "BASE (BULL TILT)"; headline = "Mixed tape with a slight risk-on lean."
    elif score <= -1:
        label = "BASE (BEAR TILT)"; headline = "Mixed tape with a slight risk-off lean."
    else:
        label = "BASE"; headline = "Balanced tape — no decisive signal end-of-day."

    return {"score": score, "label": label, "headline": headline, "reasons": reasons}


# ---------------------------------------------------------------------------
# v3 — TELL CANDIDATES (composite conviction)
# ---------------------------------------------------------------------------

def _ticker_alerts(flow_alerts: list[dict], ticker: str) -> list[dict]:
    return [a for a in (flow_alerts or [])
            if isinstance(a, dict)
            and (a.get("ticker") or a.get("symbol")) == ticker]


def _ticker_flow_signals(alerts: list[dict]) -> dict:
    """Per-ticker flow stats used by both conviction + observation."""
    call_ask_prem = 0.0
    put_ask_prem = 0.0
    call_oi_buildup = 0
    longest_dte_call = 0
    iv_ranks: list[float] = []
    spots: list[float] = []
    strike_counter: Counter = Counter()
    expiry_set: set = set()

    for a in alerts:
        if not isinstance(a, dict):
            continue
        prem = _flt(a.get("total_premium") or a.get("premium"))
        opt_type = (a.get("type") or a.get("option_type") or "").lower()
        side = (a.get("side") or "").lower()
        is_call = opt_type.startswith("c")
        is_put = opt_type.startswith("p")
        ask_side = side in ("ask", "above_ask", "at_ask")
        dte = _int(a.get("dte"))
        strike = _flt(a.get("strike"))
        spot = _flt(a.get("underlying_price") or a.get("spot"))
        ivr = _flt(a.get("iv_rank") or a.get("ivr"))
        expiry = a.get("expiry") or a.get("expiration")

        if ivr > 0:
            iv_ranks.append(ivr)
        if spot > 0:
            spots.append(spot)
        if is_call and ask_side:
            call_ask_prem += prem
            if strike > 0:
                strike_counter[(round(strike, 0), expiry or "?")] += 1
            if expiry:
                expiry_set.add(expiry)
            if dte > longest_dte_call:
                longest_dte_call = dte
        if is_put and ask_side:
            put_ask_prem += prem
        v_oi = _flt(a.get("volume_oi_ratio") or a.get("vol_oi_ratio"))
        if v_oi >= 3 and is_call and ask_side:
            call_oi_buildup += 1

    top_strike = strike_counter.most_common(1)[0] if strike_counter else None
    iv_rank_avg = sum(iv_ranks) / len(iv_ranks) if iv_ranks else None
    spot = spots[-1] if spots else None
    ratio = (call_ask_prem / put_ask_prem) if put_ask_prem > 0 else None

    return {
        "call_ask_prem": call_ask_prem,
        "put_ask_prem": put_ask_prem,
        "call_put_ask_ratio": ratio,
        "call_oi_buildup_alerts": call_oi_buildup,
        "longest_dte_call": longest_dte_call,
        "iv_rank_avg": iv_rank_avg,
        "spot": spot,
        "top_strike": top_strike,
        "expiry_breadth": len(expiry_set),
    }


def _conviction_score(flow: dict, dp_total: float, dp_mega: int) -> int:
    """
    Composite conviction (0-100). INTERNAL.

    Weights:
      Flow imbalance (call/put ask ratio): up to 35
      Premium scale (call-ask $):           up to 20
      Dark-pool premium absorption:         up to 25
      Mega-print count:                     up to 10
      OI buildup alerts:                    up to 5
      Multi-expiry breadth:                 up to 5
    """
    s = 0.0
    r = flow.get("call_put_ask_ratio")
    if r is not None:
        if r >= 5: s += 35
        elif r >= 3: s += 25
        elif r >= 2: s += 15
        elif r >= 1.5: s += 8
    call_ask = flow.get("call_ask_prem", 0)
    if call_ask >= 100_000_000: s += 20
    elif call_ask >= 25_000_000: s += 15
    elif call_ask >= 10_000_000: s += 10
    elif call_ask >= 5_000_000: s += 5
    if dp_total >= 1_000_000_000: s += 25
    elif dp_total >= 500_000_000: s += 18
    elif dp_total >= 250_000_000: s += 10
    elif dp_total >= 100_000_000: s += 5
    if dp_mega >= 20: s += 10
    elif dp_mega >= 10: s += 6
    elif dp_mega >= 5: s += 3
    s += min(flow.get("call_oi_buildup_alerts", 0), 5)
    s += min(flow.get("expiry_breadth", 0), 5)
    return int(min(100, round(s)))


def _largest_dp_share_print(prints: list[dict]) -> int:
    largest = 0
    for p in prints or []:
        if not isinstance(p, dict):
            continue
        sz = _int(p.get("size"))
        if sz > largest:
            largest = sz
    return largest


def _format_shares(n: int) -> str:
    if n >= 1_000_000: return f"{n/1_000_000:.1f}M-share"
    if n >= 1_000:     return f"{n/1_000:.0f}K-share"
    return f"{n}-share"


def _observation_text(ticker: str, flow: dict, dp_total: float, dp_mega: int,
                      dp_largest: int) -> str:
    """
    Render a 3-4 sentence descriptive observation. HTML-safe — only <strong>
    + white-space:nowrap are used to keep numbers from line-breaking.
    """
    r = flow.get("call_put_ask_ratio")
    call_ask = flow.get("call_ask_prem", 0)
    put_ask = flow.get("put_ask_prem", 0)
    top_strike = flow.get("top_strike")
    ivr = flow.get("iv_rank_avg")
    parts: list[str] = []

    # Sentence 1: the flow imbalance
    if r is not None and call_ask > 0:
        strike_str = ""
        if top_strike and top_strike[0] and top_strike[0][0]:
            strike_val = top_strike[0][0]
            strike_str = f" at the <strong style=\"white-space:nowrap;\">${strike_val:.0f}</strong> strike"
        parts.append(
            f"<strong style=\"white-space:nowrap;\">{_fmt_money(call_ask)}</strong> call-ask vs "
            f"<strong style=\"white-space:nowrap;\">{_fmt_money(put_ask)}</strong> put-ask"
            f"{strike_str} &mdash; a <strong style=\"white-space:nowrap;\">{r:.1f}×</strong> dominance."
        )
    elif call_ask > 0:
        parts.append(
            f"Single-side call-ask concentration: <strong style=\"white-space:nowrap;\">{_fmt_money(call_ask)}</strong> "
            f"on the call side with negligible put-side participation."
        )

    # Sentence 2: dark-pool absorption
    if dp_total > 0:
        share_clause = ""
        if dp_largest >= 500_000:
            share_clause = f" including a single {_format_shares(dp_largest)} print"
        parts.append(
            f"Dark pool absorbed <strong style=\"white-space:nowrap;\">{_fmt_money(dp_total)}</strong>{share_clause}."
        )

    # Sentence 3: IV-rank / cheap-premium framing OR multi-expiry framing
    if ivr is not None and ivr <= 30:
        parts.append(
            f"IV rank sits at <strong style=\"white-space:nowrap;\">{int(round(ivr))}</strong> &mdash; "
            f"institutions are paying historically cheap premium to express direction here."
        )
    elif ivr is not None and ivr >= 70:
        parts.append(
            f"IV rank sits at <strong style=\"white-space:nowrap;\">{int(round(ivr))}</strong> &mdash; "
            f"premium isn't cheap, which means buyers are paying up rather than waiting."
        )
    elif flow.get("expiry_breadth", 0) >= 3:
        parts.append(
            f"OI built across <strong style=\"white-space:nowrap;\">{flow['expiry_breadth']} expiries</strong>, "
            f"the kind of multi-month laddering institutions use when they expect a multi-week grind."
        )

    # Sentence 4: pattern observation (NEVER prescriptive)
    if r and r >= 5:
        parts.append("The pattern is the kind institutions ladder-buy into when they expect a multi-week grind.")
    elif dp_mega >= 10:
        parts.append("Mega-print clustering at the close is the signature of end-of-day institutional accumulation.")

    return " ".join(parts)


def _classify_accent(flow: dict) -> str:
    """Border accent: emerald=call-side, cyan=mixed, rose=put-side."""
    r = flow.get("call_put_ask_ratio")
    if r is None:
        return "#0ea5e9"
    if r >= 2.0:
        return "#10b981"
    if r <= 0.5:
        return "#fb7185"
    return "#0ea5e9"


def aggregate_tells(flow_alerts: list[dict], darkpool: dict) -> list[dict]:
    """
    Surface the 1-2 names with composite conviction >= CONVICTION_GATE (80).

    Conviction is computed per ticker from a fusion of flow imbalance,
    premium scale, and dark-pool absorption. The score itself is INTERNAL
    and never written into the output observation.
    """
    if not flow_alerts and not darkpool:
        return []

    candidate_tickers: set[str] = set()
    for a in flow_alerts or []:
        if isinstance(a, dict):
            t = a.get("ticker") or a.get("symbol")
            if t and t not in {"SPY", "QQQ", "IWM"}:
                candidate_tickers.add(t)
    for t in (darkpool or {}).keys():
        if t and t not in {"SPY", "QQQ", "IWM"}:
            candidate_tickers.add(t)

    scored: list[dict] = []
    for tkr in candidate_tickers:
        alerts = _ticker_alerts(flow_alerts, tkr)
        prints = (darkpool or {}).get(tkr) or []
        flow = _ticker_flow_signals(alerts)
        dp_total = _dp_total_premium(prints)
        dp_mega = _dp_mega_count(prints)
        dp_largest = _largest_dp_share_print(prints)
        conviction = _conviction_score(flow, dp_total, dp_mega)
        if conviction < CONVICTION_GATE:
            continue
        sector = TICKER_SECTOR.get(tkr, "Single-name")
        spot = flow.get("spot")
        sub_header = f"{sector}"
        if spot:
            sub_header += f" · spot ${spot:,.2f}"
        observation = _observation_text(tkr, flow, dp_total, dp_mega, dp_largest)
        accent = _classify_accent(flow)
        scored.append({
            "ticker": tkr,
            "sub_header": sub_header,
            "observation": observation,
            "accent_color": accent,
            "_conviction": conviction,  # INTERNAL — must not appear in rendered HTML
            "_flow": flow,
            "_dp_total": dp_total,
        })

    scored.sort(key=lambda r: r["_conviction"], reverse=True)
    out = scored[:2]
    # Strip internal fields before returning
    for o in out:
        o.pop("_conviction", None)
        o.pop("_flow", None)
        o.pop("_dp_total", None)
    return out


# ---------------------------------------------------------------------------
# v3 — HEADLINE + KEY METRIC + CHANGES + CATALYSTS
# ---------------------------------------------------------------------------

def _build_headline(tide: dict, market_totals: dict, sector: dict, has_tells: bool) -> str:
    """Compose a 1-sentence neutral observation (80-110 chars)."""
    parts = []
    if tide.get("available") and tide.get("eod_net_call_premium", 0) > 0:
        parts.append("Call-heavy tape")
    elif tide.get("available") and tide.get("eod_net_call_premium", 0) < 0:
        parts.append("Put-heavy tape")
    else:
        parts.append("Tape stayed mixed")

    if market_totals.get("available"):
        ratio = market_totals.get("call_put_premium_ratio")
        if ratio and ratio >= 3:
            parts[-1] = f"Call-heavy tape ({ratio:.1f}×)"
        elif ratio and ratio <= 0.5:
            parts[-1] = f"Put-heavy tape (1:{1/ratio:.1f})"

    sec = sector.get("leaders", [])
    if sec:
        top = sec[0]
        parts.append(f"{top['name']} led ({top['change_pct_fmt']})")

    if has_tells:
        parts.append("standout single-name positioning surfaced")
    else:
        parts.append("no single-name positioning stood out")

    headline = "; ".join(parts) + "."
    # Cap at ~120 chars for the email hero band
    if len(headline) > 120:
        headline = headline[:117].rstrip(",;") + "..."
    return headline


def _build_key_metric(has_tells: bool, market_totals: dict, sector: dict) -> dict:
    """When tells fire -> 'Tape'/call ratio. Otherwise 'Key Level'/SPY level."""
    if has_tells and market_totals.get("available"):
        ratio = market_totals.get("call_put_premium_ratio")
        if ratio is not None:
            label = "Tape"
            value = f"Call {ratio:.1f}×"
            if ratio >= 3:
                caption = "Heavy bull skew"
            elif ratio >= 1.5:
                caption = "Call-tilted tape"
            elif ratio <= 0.5:
                caption = "Heavy bear skew"
            elif ratio <= 0.67:
                caption = "Put-tilted tape"
            else:
                caption = "Balanced"
            return {"label": label, "value": value, "caption": caption}

    # Quiet-tape fallback: SPY key level
    spy = sector.get("spy") or {}
    spy_close = _flt(spy.get("close") or spy.get("price"))
    if spy_close > 0:
        return {
            "label": "Key Level",
            "value": f"SPY ${spy_close:.0f}",
            "caption": "Above gamma flip" if spy.get("change_pct", 0) > 0 else "Watch gamma flip",
        }
    return {"label": "Key Level", "value": "SPY —", "caption": "Awaiting close"}


def _build_changes(market_totals: dict, tide: dict, sector: dict, darkpool: dict) -> list[dict]:
    """Pick the 3 most material day-over-day moves."""
    changes: list[dict] = []
    spy = sector.get("spy") or {}
    spy_change = _flt(spy.get("change_pct") or spy.get("change_percent"))
    spy_close = _flt(spy.get("close") or spy.get("price"))
    if spy_close > 0:
        arrow = "▲" if spy_change >= 0 else "▼"
        color = "#10b981" if spy_change >= 0 else "#ef4444"
        changes.append({
            "arrow": arrow,
            "arrow_color": color,
            "text": (f"SPY closed <strong style=\"color:{color};white-space:nowrap;\">${spy_close:.2f}</strong> "
                     f"({_fmt_pct(spy_change)}). Index tape held in line with the broader read."),
        })

    if market_totals.get("available"):
        cp = market_totals.get("call_premium", 0)
        pp = market_totals.get("put_premium", 0)
        ratio = market_totals.get("call_put_premium_ratio")
        if cp > 0 or pp > 0:
            if ratio is not None:
                ratio_str = f"{ratio:.1f}×"
                ratio_dir = "call-heavy" if ratio >= 1 else "put-heavy"
            else:
                ratio_str = "n/a"
                ratio_dir = "mixed"
            arrow = "▲" if ratio and ratio >= 1 else "▼"
            color = "#10b981" if ratio and ratio >= 1 else "#ef4444"
            changes.append({
                "arrow": arrow,
                "arrow_color": color,
                "text": (f"Net call premium <strong style=\"white-space:nowrap;\">{_fmt_money(cp)}</strong> vs "
                         f"put <strong style=\"white-space:nowrap;\">{_fmt_money(pp)}</strong> = "
                         f"<strong style=\"white-space:nowrap;\">{ratio_str}</strong> {ratio_dir}."),
            })

    dp_rows = darkpool.get("rows", [])
    if dp_rows:
        # Pick top SPY/QQQ row if present, else top
        top_dp = next((r for r in dp_rows if r["ticker"] == "SPY"), None) or dp_rows[0]
        mega = top_dp.get("mega_print_count", 0)
        changes.append({
            "arrow": "●",
            "arrow_color": "#0ea5e9",
            "text": (f"Dark pool <strong style=\"white-space:nowrap;\">{top_dp['total_premium_fmt']}</strong> on "
                     f"{top_dp['ticker']}, {mega} mega-print{'s' if mega != 1 else ''}. "
                     f"End-of-day institutional accumulation pattern."),
        })

    # Pad if fewer than 3
    if len(changes) < 3 and tide.get("available"):
        net = tide.get("eod_net_call_premium", 0)
        arrow = "▲" if net > 0 else "▼"
        color = "#10b981" if net > 0 else "#ef4444"
        changes.append({
            "arrow": arrow,
            "arrow_color": color,
            "text": (f"EOD cumulative net call premium "
                     f"<strong style=\"white-space:nowrap;\">{tide['eod_net_call_premium_fmt']}</strong>. "
                     f"Tape {tide.get('shape', 'closed mid-range')}."),
        })

    return changes[:3]


def _build_catalysts(econ_cal: list[dict] | None) -> list[dict]:
    """
    Pull 1-2 items from the aggregated economic-calendar feed.

    The fetcher does not yet expose an econ-cal endpoint, so this function
    is data-tolerant: pass `econ_cal=[...]` when available, otherwise an
    empty list. Template skips the section entirely if catalysts == [].

    Each econ_cal item is expected to look like:
        {"when": "Fri 8:30 AM ET", "name": "Empire State Mfg. (May)",
         "prev": "11", "forecast": "6.5", "implication": "A miss <5 ..."}
    """
    if not econ_cal:
        return []
    out = []
    for it in econ_cal[:2]:
        if not isinstance(it, dict):
            continue
        when = it.get("when") or ""
        name = it.get("name") or ""
        prev = it.get("prev") or ""
        forecast = it.get("forecast") or ""
        implication = it.get("implication") or ""
        header = f"<strong>{when} — {name}.</strong>"
        prev_fc = ""
        if prev or forecast:
            prev_fc = f" Prev&nbsp;{prev} · Forecast&nbsp;{forecast}."
        out.append({"text": f"{header}{prev_fc} {implication}".strip()})
    return out


def _hero_underline(has_tells: bool, has_catalysts: bool) -> str:
    """Cyan default, emerald when tells fire, rose when catalyst dominates."""
    if has_catalysts and not has_tells:
        return "#fb7185"
    if has_tells:
        return "#10b981"
    return "#0ea5e9"


def _mpi_label(score: int) -> str:
    if score >= 65: return "Bull"
    if score <= 35: return "Bear"
    return "Sideways"


def _regime_short(mpi_score: int) -> str:
    if mpi_score >= 75: return "Bull · late"
    if mpi_score >= 60: return "Bull · early"
    if mpi_score >= 45: return "Sideways"
    if mpi_score >= 30: return "Bear · early"
    return "Bear · late"


def _regime_confidence_label(mpi_score: int) -> str:
    # Higher absolute distance from 50 -> higher confidence
    dist = abs(mpi_score - 50)
    if dist >= 25: return "High confidence"
    if dist >= 15: return "Moderate confidence"
    return "Low confidence"


# ---------------------------------------------------------------------------
# Top-level orchestrator
# ---------------------------------------------------------------------------

def aggregate(raw: dict, prev_raw: dict | None = None) -> dict:
    """Single entry point. Returns the dict the v3 Jinja template expects."""
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

    # v3 fields
    tells = aggregate_tells(raw.get("flow_alerts") or [], raw.get("darkpool") or {})
    has_tells = len(tells) > 0
    catalysts = _build_catalysts(raw.get("econ_cal"))
    has_catalysts = len(catalysts) > 0

    # MPI: prefer raw.mpi_snapshot if pipeline supplies it; fall back to a
    # heuristic mapped from the scenario score (-8..+8 -> 0..100).
    mpi_snap = raw.get("mpi_snapshot") or {}
    if isinstance(mpi_snap, dict) and "score" in mpi_snap:
        mpi_score = _int(mpi_snap.get("score"))
    else:
        mpi_score = max(0, min(100, 50 + scenario.get("score", 0) * 5))
    mpi_label = mpi_snap.get("label") if isinstance(mpi_snap, dict) and mpi_snap.get("label") else _mpi_label(mpi_score)
    regime_short = mpi_snap.get("regime_short") if isinstance(mpi_snap, dict) and mpi_snap.get("regime_short") else _regime_short(mpi_score)
    regime_conf = mpi_snap.get("confidence_label") if isinstance(mpi_snap, dict) and mpi_snap.get("confidence_label") else _regime_confidence_label(mpi_score)

    key_metric = _build_key_metric(has_tells, market_totals, sector)
    headline = _build_headline(tide, market_totals, sector, has_tells)
    changes = _build_changes(market_totals, tide, sector, darkpool)
    hero_underline = _hero_underline(has_tells, has_catalysts)

    target_date = raw.get("date") or ""
    post_date_display = _fmt_date_long(target_date)
    appendix_url = raw.get("appendix_url") or (
        f"https://aztmm.com/{target_date.replace('-', '/')}/daily-pulse-options-flow-dark-pool-{target_date}/"
        if target_date else "https://aztmm.com/"
    )

    out = {
        # --- v3 template fields ---
        "post_date_display": post_date_display,
        "headline": headline,
        "mpi_score": mpi_score,
        "mpi_label": mpi_label,
        "regime_short": regime_short,
        "regime_confidence_label": regime_conf,
        "key_metric_label": key_metric["label"],
        "key_metric_value": key_metric["value"],
        "key_metric_caption": key_metric["caption"],
        "hero_underline_color": hero_underline,
        "tells": tells,
        "changes": changes,
        "catalysts": catalysts,
        "appendix_url": appendix_url,

        # --- back-compat / payload-consumer fields ---
        "date": target_date,
        "prev_date": raw.get("prev_date"),
        "scenario": scenario,
        "market_totals": market_totals,
        "sector": sector,
        "tide": tide,
        "concentration": concentration,
        "darkpool": darkpool,
        "presets": presets,
        "data_quality": raw.get("data_quality", {}),
        "generated_at_iso": datetime.utcnow().isoformat() + "Z",
        "headline_metric": {
            "label": "MPI",
            "value": mpi_score,
        },
    }
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse, json, sys
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--prev", default=None)
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
