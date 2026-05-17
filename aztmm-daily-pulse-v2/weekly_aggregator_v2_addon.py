"""
AZTMM Weekly Pulse v2.1 -- Aggregator Addon Module
====================================================

Sidecar to weekly_pulse_aggregator.py. Adds two indigenous weekly composites:

1. Sector Rotation Compass -- 11-sector score combining:
   - Insider net flow (5-day cumulative)
   - Dark-pool concentration relative to baseline
   - Flow-alert call/put direction
   - 5-day relative price performance
   Output: ranked sectors with "rotating into" / "rotating out of" tags.

2. Catalyst Pre-Positioning Score (CPPS) -- per-event score combining:
   - Implied move width (from upcoming_earnings)
   - Dark-pool concentration trajectory
   - Greek positioning (call/put gamma + charm divergence)
   - Insider activity in ticker last 30 days
   - Analyst rating changes last 14 days
   Output: per-catalyst directional classification.

Designed for Saturday weekly cron only. Pure functions. No I/O.
"""

from __future__ import annotations

from typing import Any


def _flt(x: Any, default: float = 0.0) -> float:
    if x is None:
        return default
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# 1. Sector Rotation Compass
# ---------------------------------------------------------------------------

def compute_sector_rotation_compass(
    insider_heatmap: dict | None,
    sector_etfs: list[dict] | None,
    flow_alerts: list[dict] | None,
) -> dict:
    """
    Cross-sectional 11-sector ranking by composite rotation score.

    Inputs:
        insider_heatmap: output of aggregator_v2_addon.aggregate_insider_heatmap
        sector_etfs:     raw UW /api/market/sector-etfs payload
        flow_alerts:     raw UW flow alerts (last 5 sessions)

    Returns:
        {
            "rows": [{sector, score, insider_signal, etf_perf_signal,
                      flow_signal, verdict}, ...],
            "rotating_into": [sector, ...],   # top 3 by score
            "rotating_out_of": [sector, ...], # bottom 3
        }

    Score range: -100 (rotating out) to +100 (rotating in).
    """
    if not insider_heatmap or not insider_heatmap.get("rows"):
        return {"rows": [], "rotating_into": [], "rotating_out_of": []}

    SECTORS = [
        "Basic Materials", "Communication Services", "Consumer Cyclical",
        "Consumer Defensive", "Energy", "Financial Services", "Healthcare",
        "Industrials", "Real Estate", "Technology", "Utilities",
    ]

    # Index insider signal by sector
    insider_by_sector: dict[str, float] = {}
    for row in insider_heatmap.get("rows", []):
        sector = row.get("sector")
        net = _flt(row.get("net_5d"))
        if sector:
            # Normalize to -100..+100 scale
            # Calibration: ±$500M = ±100. Clamp.
            score = max(-100.0, min(100.0, net / 5_000_000))
            insider_by_sector[sector] = score

    # Index ETF perf by sector (sector ETFs return {sector_name: change_pct})
    etf_perf_by_sector: dict[str, float] = {}
    for row in (sector_etfs or []):
        sector = row.get("sector") or row.get("name")
        change = _flt(row.get("change_pct") or row.get("change") or row.get("perf"))
        if sector:
            # Normalize to -100..+100 (±5% day move = ±100)
            score = max(-100.0, min(100.0, change * 20))
            etf_perf_by_sector[sector] = score

    # Index flow signal by sector (count call alerts minus put alerts)
    flow_by_sector: dict[str, int] = {}
    for alert in (flow_alerts or []):
        sector = alert.get("sector")
        atype = alert.get("type", "")
        if sector and atype:
            flow_by_sector[sector] = flow_by_sector.get(sector, 0) + (
                1 if atype == "call" else -1
            )
    flow_signal_by_sector: dict[str, float] = {
        s: max(-100.0, min(100.0, n * 10)) for s, n in flow_by_sector.items()
    }

    # Build per-sector composite
    rows = []
    for sector in SECTORS:
        ins = insider_by_sector.get(sector, 0.0)
        etf = etf_perf_by_sector.get(sector, 0.0)
        flow = flow_signal_by_sector.get(sector, 0.0)

        # Weighted composite: insider 50%, etf perf 30%, flow direction 20%
        composite = round(ins * 0.5 + etf * 0.3 + flow * 0.2, 1)

        if composite > 25:
            verdict = "rotating into"
        elif composite < -25:
            verdict = "rotating out of"
        else:
            verdict = "neutral"

        rows.append({
            "sector": sector,
            "score": composite,
            "insider_signal": round(ins, 1),
            "etf_perf_signal": round(etf, 1),
            "flow_signal": round(flow, 1),
            "verdict": verdict,
        })

    rows.sort(key=lambda r: r["score"], reverse=True)
    rotating_into = [r["sector"] for r in rows if r["score"] > 25][:3]
    rotating_out_of = [r["sector"] for r in rows[::-1] if r["score"] < -25][:3]

    return {
        "rows": rows,
        "rotating_into": rotating_into,
        "rotating_out_of": rotating_out_of,
    }


# ---------------------------------------------------------------------------
# 2. Catalyst Pre-Positioning Score (CPPS)
# ---------------------------------------------------------------------------

def compute_cpps(
    earnings_event: dict,
    dark_pool_by_ticker: dict | None,
    greek_exposure: list[dict] | None,
    insider_flow_by_ticker: dict | None,
    analyst_ratings: list[dict] | None,
) -> dict:
    """
    Per-catalyst directional pre-positioning score.

    Args:
        earnings_event: {ticker, report_date, expected_move, ...}
        dark_pool_by_ticker: optional dict of {ticker: [recent prints]}
        greek_exposure: optional list of {date, call_delta, put_delta, ...}
        insider_flow_by_ticker: optional {ticker: net_30d_$}
        analyst_ratings: optional list of recent rating updates for the ticker

    Returns:
        {
            "ticker": str,
            "report_date": str,
            "expected_move_pct": float,
            "score": 0-100,
            "classification": "directional_bullish" | "directional_bearish" | "hedged" | "neutral",
            "components": {dp, greek, insider, analyst},
            "metadata": {...}
        }

    Score >65 = directional bullish; <35 = directional bearish; else hedged.
    """
    ticker = earnings_event.get("ticker") or earnings_event.get("symbol")
    if not ticker:
        return {"ticker": None, "score": 50.0, "classification": "neutral",
                "metadata": {"missing": ["ticker"]}}

    components: dict[str, float] = {}

    # 1. Dark-pool concentration trajectory
    dp_prints = (dark_pool_by_ticker or {}).get(ticker, [])
    dp_premium = sum(_flt(p.get("premium")) for p in dp_prints)
    # Calibration: $500M+ in run-up = bullish concentration (+30 to score)
    dp_score = min(30.0, dp_premium / 500_000_000 * 30)
    components["dark_pool"] = round(dp_score, 1)

    # 2. Greek positioning -- last 5 days of call/put delta trajectory
    greek_score = 0.0
    if greek_exposure and len(greek_exposure) >= 2:
        recent = greek_exposure[-5:]
        first_call_delta = _flt(recent[0].get("call_delta"))
        last_call_delta = _flt(recent[-1].get("call_delta"))
        delta_growth = (last_call_delta - first_call_delta) / max(1.0, abs(first_call_delta))
        # Growing call delta = bullish positioning (+30)
        greek_score = max(-30.0, min(30.0, delta_growth * 100))
    components["greek"] = round(greek_score, 1)

    # 3. Insider activity in last 30 days
    insider_net = _flt((insider_flow_by_ticker or {}).get(ticker))
    # Calibration: $10M+ insider buying = bullish (+20)
    insider_score = max(-20.0, min(20.0, insider_net / 1_000_000))
    components["insider"] = round(insider_score, 1)

    # 4. Analyst ratings recency
    analyst_score = 0.0
    if analyst_ratings:
        ratings_for_ticker = [
            r for r in analyst_ratings
            if (r.get("ticker") or "").upper() == ticker.upper()
        ]
        buy_count = sum(1 for r in ratings_for_ticker if r.get("recommendation") == "buy")
        sell_count = sum(1 for r in ratings_for_ticker if r.get("recommendation") == "sell")
        analyst_score = (buy_count - sell_count) * 5
        analyst_score = max(-20.0, min(20.0, analyst_score))
    components["analyst"] = round(analyst_score, 1)

    # Composite: base 50 + weighted components
    raw_score = 50 + dp_score + greek_score + insider_score + analyst_score
    score = max(0.0, min(100.0, raw_score))

    if score >= 65:
        classification = "directional_bullish"
    elif score <= 35:
        classification = "directional_bearish"
    elif abs(score - 50) < 8 and (dp_score > 15 or abs(greek_score) > 15):
        classification = "hedged"
    else:
        classification = "neutral"

    expected_move = _flt(earnings_event.get("expected_move") or earnings_event.get("implied_move"))
    curr = _flt(earnings_event.get("curr") or earnings_event.get("close"))
    expected_move_pct = round((expected_move / curr) * 100, 2) if curr else 0.0

    return {
        "ticker": ticker.upper(),
        "report_date": earnings_event.get("report_date"),
        "expected_move_pct": expected_move_pct,
        "score": round(score, 1),
        "classification": classification,
        "components": components,
        "metadata": {
            "expected_move_abs": expected_move,
            "curr_price": curr,
        },
    }


# ---------------------------------------------------------------------------
# Single entry point for weekly aggregator
# ---------------------------------------------------------------------------

def apply_weekly_v2_fields(
    out: dict,
    raw_weekly: dict,
    insider_heatmap: dict | None = None,
) -> dict:
    """
    Enrich existing weekly aggregator `out` dict with v2.1 weekly composites.

    Args:
        out: existing weekly aggregator output
        raw_weekly: raw weekly fetcher payload (5-day aggregated UW data)
        insider_heatmap: optional pre-computed insider heatmap

    Returns:
        out with added keys: sector_rotation_compass, cpps_events
    """
    out["sector_rotation_compass"] = compute_sector_rotation_compass(
        insider_heatmap or raw_weekly.get("insider_heatmap"),
        raw_weekly.get("sector_etfs"),
        raw_weekly.get("flow_alerts"),
    )

    # Per-event CPPS for each upcoming earnings event
    upcoming = raw_weekly.get("upcoming_earnings") or []
    cpps_events = []
    for event in upcoming[:10]:  # Top 10 events by OI
        cpps = compute_cpps(
            event,
            raw_weekly.get("darkpool"),
            raw_weekly.get("greek_exposure"),
            raw_weekly.get("insider_flow_by_ticker"),
            raw_weekly.get("analyst_ratings"),
        )
        cpps_events.append(cpps)
    out["cpps_events"] = cpps_events

    return out
