"""
AZTMM Daily Pulse v2 — Indigenous Scoring Models
=================================================

Three proprietary composites built on the existing fetcher data:

1. SMDS — Smart Money Divergence Score
   Detects when regime/tape says one thing and smart money does another.

2. RTDI — Regime-Tape Divergence Index
   Quantifies how much the MPI regime model and the day's options tape disagree.

3. MPCI — Mega-Print Concentration Index
   Z-score of single-day dark-pool prints vs 30-day rolling average per ticker.

Design rules:
- Pure functions: take aggregator output, return scores. No I/O.
- Defensive: missing data -> neutral score (50/100) + flag in metadata.
- Documented thresholds inline (no magic numbers).
"""

from __future__ import annotations

import statistics
from typing import Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_float(x: Any, default: float = 0.0) -> float:
    """Best-effort coerce to float."""
    if x is None:
        return default
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


# ---------------------------------------------------------------------------
# 1. SMDS — Smart Money Divergence Score
# ---------------------------------------------------------------------------

def compute_smds(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Aggregate net insider $ flow across all 11 sectors and compute a divergence
    score against the regime composite.

    Inputs (from fetcher payload):
        - insider_sector_flow: {sector: [day_row, ...]}
        - market_tide / market_totals: regime direction proxy

    Returns:
        {
            "score": 0-100 (50 = no divergence; >70 = strong bearish-insider divergence; <30 = strong bullish-insider divergence),
            "net_insider_5d": float ($),
            "sectors_net_buying": [str],
            "sectors_net_selling_heavy": [str],  # top 3 dumpers
            "direction": "bullish" | "bearish" | "neutral",
            "metadata": {"missing": [...], "as_of": str}
        }
    """
    insider = payload.get("insider_sector_flow", {})
    if not insider:
        return {"score": 50.0, "direction": "neutral", "metadata": {"missing": ["insider_sector_flow"]}}

    # Aggregate net $ per sector (positive = net buy, negative = net sell)
    per_sector_net: dict[str, float] = {}
    for sector, rows in insider.items():
        if not isinstance(rows, list):
            continue
        net = 0.0
        for row in rows:
            premium = _safe_float(row.get("premium"))
            buy_sell = row.get("buy_sell", "")
            # Per UW, premium is signed when sell, but defensive: flip if needed
            if buy_sell == "sell" and premium > 0:
                premium = -premium
            net += premium
        per_sector_net[sector] = net

    net_total = sum(per_sector_net.values())
    sectors_net_buying = [s for s, n in per_sector_net.items() if n > 0]
    sorted_sellers = sorted(per_sector_net.items(), key=lambda kv: kv[1])  # most negative first
    sectors_dumping = [s for s, n in sorted_sellers[:3] if n < -50_000_000]  # >-$50M = "heavy dumper"

    # Score: net negative insider flow => bearish-insider divergence => higher score (>50)
    # Calibrated against the May 2026 observation: -$2.5B net = ~80 score
    if net_total >= 0:
        # Insiders net buying — bullish-insider tilt
        score = 50.0 - min(30.0, abs(net_total) / 5_000_000_000 * 30.0)
        direction = "bullish-insider"
    else:
        # Insiders net selling — bearish-insider divergence
        score = 50.0 + min(40.0, abs(net_total) / 5_000_000_000 * 40.0)
        direction = "bearish-insider"

    return {
        "score": round(_clamp(score), 1),
        "net_insider_5d": round(net_total, 0),
        "sectors_net_buying": sectors_net_buying,
        "sectors_net_selling_heavy": sectors_dumping,
        "direction": direction,
        "metadata": {
            "missing": [],
            "per_sector_net": {s: round(n, 0) for s, n in per_sector_net.items()},
        },
    }


# ---------------------------------------------------------------------------
# 2. RTDI — Regime-Tape Divergence Index
# ---------------------------------------------------------------------------

def compute_rtdi(payload: dict[str, Any], mpi_value: float | None = None) -> dict[str, Any]:
    """
    Quantify divergence between AZTMM's MPI regime score and the day's options tape.

    Args:
        payload: full fetcher output (uses market_totals + market_tide)
        mpi_value: latest MPI value (0-100). If None, returns metadata flag.

    Logic:
        Tape signal = premium-weighted P/C ratio direction.
            - Call premium >> Put premium => bullish tape
            - Put premium > Call premium => bearish tape
        Regime signal = MPI > 50 = Bull regime, < 50 = Bear regime.
        Divergence = |tape_signal - regime_signal|, normalized to 0-100.

    Returns:
        {
            "score": 0-100 (50 = no divergence; >70 = strong divergence),
            "regime": "Bull" | "Bear" | "Neutral",
            "tape": "bullish" | "bearish" | "neutral",
            "diverging": bool,
            "metadata": {...}
        }
    """
    mt = payload.get("market_totals") or {}
    call_prem = _safe_float(mt.get("call_premium"))
    put_prem = _safe_float(mt.get("put_premium"))

    if call_prem + put_prem == 0:
        return {"score": 50.0, "regime": "Unknown", "tape": "unknown", "diverging": False,
                "metadata": {"missing": ["market_totals"]}}

    # Premium-weighted P/C ratio (UW: smaller = more bullish)
    pc_ratio = put_prem / call_prem if call_prem else 1.0
    # Normalize: pc_ratio of 0.5 = very bullish (1.0), 1.5 = very bearish (-1.0)
    tape_score = max(-1.0, min(1.0, (1.0 - pc_ratio) / 0.5))  # +1 fully bullish, -1 fully bearish

    if mpi_value is None:
        return {"score": 50.0, "regime": "Unknown", "tape": "bullish" if tape_score > 0.2 else ("bearish" if tape_score < -0.2 else "neutral"),
                "diverging": False, "metadata": {"missing": ["mpi_value"]}}

    # Normalize MPI: 50 = neutral, 100 = full bull, 0 = full bear
    regime_score = (mpi_value - 50.0) / 50.0  # +1 fully bull, -1 fully bear

    divergence = abs(tape_score - regime_score)  # range 0 to 2
    # Map divergence 0-2 to score 50-100
    score = 50.0 + (divergence / 2.0) * 50.0
    diverging = divergence > 0.5

    regime_label = "Bull" if regime_score > 0.1 else ("Bear" if regime_score < -0.1 else "Neutral")
    tape_label = "bullish" if tape_score > 0.2 else ("bearish" if tape_score < -0.2 else "neutral")

    return {
        "score": round(_clamp(score), 1),
        "regime": regime_label,
        "tape": tape_label,
        "diverging": diverging,
        "metadata": {
            "tape_score": round(tape_score, 3),
            "regime_score": round(regime_score, 3),
            "pc_ratio": round(pc_ratio, 3),
        },
    }


# ---------------------------------------------------------------------------
# 3. MPCI — Mega-Print Concentration Index
# ---------------------------------------------------------------------------

def compute_mpci(payload: dict[str, Any], ticker: str = "SPY", min_print_size: int = 100_000) -> dict[str, Any]:
    """
    Z-score of today's dark-pool block-print count vs 30-day rolling average.

    Args:
        payload: fetcher output with darkpool[ticker]
        ticker: which ticker to score (default SPY)
        min_print_size: minimum shares to qualify as a "mega-print"

    NOTE: this is a single-day snapshot. For real z-score, the aggregator
    needs to maintain a 30-day rolling state. This function returns
    today's mega-print count and the aggregator handles the z-score.

    Returns:
        {
            "ticker": str,
            "mega_print_count": int,
            "total_premium": float,
            "biggest_print": float,
            "alert": bool,  # True if visibly elevated (>20 prints)
            "metadata": {...}
        }
    """
    prints = payload.get("darkpool", {}).get(ticker, [])
    if not isinstance(prints, list):
        return {"ticker": ticker, "mega_print_count": 0, "total_premium": 0.0,
                "biggest_print": 0.0, "alert": False, "metadata": {"missing": [ticker]}}

    mega_prints = [p for p in prints if _safe_float(p.get("size")) >= min_print_size]
    total_prem = sum(_safe_float(p.get("premium")) for p in mega_prints)
    biggest = max((_safe_float(p.get("premium")) for p in mega_prints), default=0.0)

    return {
        "ticker": ticker,
        "mega_print_count": len(mega_prints),
        "total_premium": round(total_prem, 0),
        "biggest_print": round(biggest, 0),
        # Calibration: from May 2026 observation, $4.91B SPY day = 23 mega-prints.
        # Alert threshold: >20 prints or >$3B total.
        "alert": len(mega_prints) > 20 or total_prem > 3_000_000_000,
        "metadata": {
            "min_print_size": min_print_size,
            "total_prints_seen": len(prints),
        },
    }


# ---------------------------------------------------------------------------
# Top-level: compute all scores
# ---------------------------------------------------------------------------

def compute_all_scores(payload: dict[str, Any], mpi_value: float | None = None) -> dict[str, Any]:
    """Compute all three indigenous scores in one call."""
    return {
        "smds": compute_smds(payload),
        "rtdi": compute_rtdi(payload, mpi_value),
        "mpci_spy": compute_mpci(payload, "SPY"),
        "mpci_qqq": compute_mpci(payload, "QQQ"),
        "mpci_nvda": compute_mpci(payload, "NVDA", min_print_size=10_000),
    }
