"""
AZTMM Daily Pulse v2.1 -- Aggregator Addon Module
=================================================

Sidecar to daily_pulse_aggregator.py. Contains:
- aggregate_insider_heatmap()  -- 11-sector insider $ rollup
- aggregate_yield_curve()      -- 10Y/2Y snapshot + spread
- apply_v2_fields()            -- single entry to enrich existing `out` dict
                                  with insider_heatmap, yield_curve, smds,
                                  rtdi, mpci_spy/qqq/nvda

Usage in daily_pulse_aggregator.py:
    from aggregator_v2_addon import apply_v2_fields
    # ... existing aggregate() builds `out` dict ...
    out = apply_v2_fields(out, raw, mpi_score)
    return out

Pure functions. No I/O. Missing fields → neutral defaults + metadata flags.
"""

from __future__ import annotations

from typing import Any


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


# ---------------------------------------------------------------------------
# Aggregators
# ---------------------------------------------------------------------------

def aggregate_insider_heatmap(insider_sector_flow: dict | None) -> dict:
    """
    Roll up the 11-sector insider flow into a single heatmap summary.

    Input:  {sector: [day_row, ...]} from fetcher.fetch_insider_sector_flow.
    Output: {
        "rows": [{sector, net_5d, net_buy, net_sell, direction}, ...],
        "net_total_5d": float,
        "sectors_net_buying": int,
        "biggest_seller": {sector, net_5d},
        "biggest_buyer": {sector, net_5d},
    }
    """
    if not insider_sector_flow or not isinstance(insider_sector_flow, dict):
        return {
            "rows": [],
            "net_total_5d": 0.0,
            "sectors_net_buying": 0,
            "biggest_seller": None,
            "biggest_buyer": None,
        }

    rows = []
    net_total = 0.0
    for sector, day_rows in insider_sector_flow.items():
        if not isinstance(day_rows, list):
            continue
        net_buy = 0.0
        net_sell = 0.0
        for r in day_rows:
            premium = _flt(r.get("premium"))
            bs = r.get("buy_sell", "")
            # Defensive: flip sign if sell+positive
            if bs == "sell" and premium > 0:
                premium = -premium
            if premium > 0:
                net_buy += premium
            else:
                net_sell += premium
        net_5d = net_buy + net_sell
        direction = (
            "buying" if net_5d > 0
            else ("selling" if net_5d < 0 else "flat")
        )
        rows.append({
            "sector": sector,
            "net_5d": round(net_5d, 0),
            "net_buy": round(net_buy, 0),
            "net_sell": round(net_sell, 0),
            "direction": direction,
        })
        net_total += net_5d

    rows.sort(key=lambda r: r["net_5d"])  # most negative first
    sectors_buying = sum(1 for r in rows if r["net_5d"] > 0)
    biggest_seller = rows[0] if rows and rows[0]["net_5d"] < 0 else None
    biggest_buyer = rows[-1] if rows and rows[-1]["net_5d"] > 0 else None

    return {
        "rows": rows,
        "net_total_5d": round(net_total, 0),
        "sectors_net_buying": sectors_buying,
        "biggest_seller": biggest_seller,
        "biggest_buyer": biggest_buyer,
    }


def aggregate_yield_curve(yield_10y: dict | None, yield_2y: dict | None) -> dict:
    """
    Distill the yield curve into a one-line snapshot.

    Inputs: latest data points from /api/economy/treasury-yield.
    Output: {y10, y2, spread_bps, shape, as_of}
    """
    if not yield_10y or not yield_2y:
        return {
            "y10": None, "y2": None, "spread_bps": None,
            "shape": "unknown", "as_of": None,
        }

    y10 = _flt(
        yield_10y.get("value")
        or yield_10y.get("yield")
        or yield_10y.get("data")
    )
    y2 = _flt(
        yield_2y.get("value")
        or yield_2y.get("yield")
        or yield_2y.get("data")
    )
    spread = round((y10 - y2) * 100)  # bps

    if spread < -10:
        shape = "inverted"
    elif spread < 25:
        shape = "flat"
    else:
        shape = "normal"

    return {
        "y10": round(y10, 2),
        "y2": round(y2, 2),
        "spread_bps": spread,
        "shape": shape,
        "as_of": yield_10y.get("date") or yield_10y.get("as_of"),
    }


# ---------------------------------------------------------------------------
# Single entry point for aggregator.py
# ---------------------------------------------------------------------------

def apply_v2_fields(out: dict, raw: dict, mpi_score: float | int | None) -> dict:
    """
    Enrich existing aggregator `out` dict with v2.1 indigenous scores
    and smart-money / macro aggregations.

    Args:
        out:       existing aggregator output dict (mutated + returned)
        raw:       full fetcher payload
        mpi_score: latest MPI value (0-100) for RTDI computation

    Returns:
        the same `out` dict, with new keys appended:
        - insider_heatmap, yield_curve
        - smds, rtdi, mpci_spy, mpci_qqq, mpci_nvda
    """
    out["insider_heatmap"] = aggregate_insider_heatmap(
        raw.get("insider_sector_flow")
    )
    out["yield_curve"] = aggregate_yield_curve(
        raw.get("yield_10y"), raw.get("yield_2y")
    )

    # Indigenous scoring -- defensive import
    try:
        from scoring import compute_smds, compute_rtdi, compute_mpci
        out["smds"] = compute_smds(raw)
        out["rtdi"] = compute_rtdi(raw, mpi_value=mpi_score)
        out["mpci_spy"] = compute_mpci(raw, "SPY")
        out["mpci_qqq"] = compute_mpci(raw, "QQQ")
        out["mpci_nvda"] = compute_mpci(raw, "NVDA", min_print_size=10_000)
    except ImportError:
        out["smds"] = {"score": 50.0, "direction": "unknown",
                       "metadata": {"missing": ["scoring_module"]}}
        out["rtdi"] = {"score": 50.0, "diverging": False,
                       "metadata": {"missing": ["scoring_module"]}}
        out["mpci_spy"] = {"alert": False, "metadata": {"missing": ["scoring_module"]}}
        out["mpci_qqq"] = {"alert": False, "metadata": {"missing": ["scoring_module"]}}
        out["mpci_nvda"] = {"alert": False, "metadata": {"missing": ["scoring_module"]}}

    return out
