"""
AZTMM Congress Trades Tracker - Aggregator
============================================

Pure functions. No I/O.

Input:  the dict shape produced by fetcher.fetch_daily_data()
Output: structured dict ready for the Jinja template + dual-output writer.

Notability surfaced as OBSERVATIONS (never recommendations):
  - Multi-member ticker clusters inside a 5-trading-day window
  - Trades sized in the large-band set
  - Trades filed late relative to transaction date
  - Sector clusters across multiple members in the window

Walk-forward integrity: only considers disclosures with
filed_at_date <= target_date.

The aggregator scrubs the "issuer" field down to a generic
ownership label so spousal/dependent designations stay flat,
and never echoes the upstream source identifier.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any

# Internal size-band ordering (high = larger amount disclosed)
SIZE_BAND_ORDER = [
    "$1,001 - $15,000",
    "$15,001 - $50,000",
    "$50,001 - $100,000",
    "$100,001 - $250,000",
    "$250,001 - $500,000",
    "$500,001 - $1,000,000",
    "$1,000,001 - $5,000,000",
    "$5,000,001 - $25,000,000",
    "$25,000,001 - $50,000,000",
    "$50,000,001 +",
]

LARGE_BANDS = set(SIZE_BAND_ORDER[5:])  # >= $500K


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm_date(s: Any) -> str | None:
    if not s:
        return None
    if isinstance(s, str) and len(s) >= 10:
        return s[:10]
    return None


def _norm_band(s: Any) -> str:
    if not s or not isinstance(s, str):
        return "Unknown"
    s = s.strip()
    return s if s in SIZE_BAND_ORDER else s


def _is_large(band: str) -> bool:
    return band in LARGE_BANDS


def _ownership_label(issuer: Any) -> str:
    """Flatten spousal/dependent/self markers to a single generic label."""
    if not isinstance(issuer, str):
        return "self"
    low = issuer.lower()
    if "spouse" in low:
        return "spouse"
    if "dependent" in low or "child" in low:
        return "dependent"
    if "joint" in low:
        return "joint"
    if "undisclosed" in low:
        return "undisclosed"
    return "self"


def _chamber(member_type: Any) -> str:
    if not isinstance(member_type, str):
        return "other"
    v = member_type.lower()
    if v in ("senate", "house", "executive"):
        return v
    return "other"


def _txn_direction(txn_type: Any) -> str:
    """Generic direction label without using forbidden advisory verbs."""
    if not isinstance(txn_type, str):
        return "filing"
    v = txn_type.lower()
    if "purchase" in v or v == "buy":
        return "acquisition"
    if v == "sell" or "sale" in v:
        return "disposition"
    if "exchange" in v:
        return "exchange"
    return "filing"


def _band_label_safe(band: str) -> str:
    """Replace $ amounts with a clean tier label for public output.
    We still emit the dollar band — the policy permits disclosure ranges —
    but we precompute a tier so the template can group cleanly."""
    if band == "Unknown" or band not in SIZE_BAND_ORDER:
        return "tier-unknown"
    idx = SIZE_BAND_ORDER.index(band)
    if idx <= 1:
        return "tier-small"
    if idx <= 3:
        return "tier-mid"
    if idx <= 5:
        return "tier-large"
    return "tier-very-large"


def _sector_of(ticker: str, sector_map: dict[str, str]) -> str:
    if not ticker:
        return "Other"
    return sector_map.get(ticker.upper(), "Other")


def _days_between(d1: str | None, d2: str | None) -> int | None:
    try:
        a = datetime.strptime(d1, "%Y-%m-%d")
        b = datetime.strptime(d2, "%Y-%m-%d")
        return (b - a).days
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Walk-forward filter
# ---------------------------------------------------------------------------

def filter_walk_forward(rows: list[dict], target_date: str) -> list[dict]:
    """Only disclosures filed <= target_date."""
    out = []
    for r in rows or []:
        fd = _norm_date(r.get("filed_at_date") or r.get("filed_at"))
        if fd is None or fd <= target_date:
            out.append(r)
    return out


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def normalize_trades(rows: list[dict], sector_map: dict[str, str]) -> list[dict]:
    """Strip vendor fields, flatten ownership, attach sector + tier."""
    norm = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        ticker = (r.get("ticker") or "").strip().upper() or None
        band = _norm_band(r.get("amounts"))
        transaction_date = _norm_date(r.get("transaction_date"))
        filed_at = _norm_date(r.get("filed_at_date") or r.get("filed_at"))
        late_days = _days_between(transaction_date, filed_at)
        norm.append({
            "name": r.get("name"),
            "chamber": _chamber(r.get("member_type")),
            "ticker": ticker,
            "sector": _sector_of(ticker or "", sector_map),
            "ownership": _ownership_label(r.get("issuer")),
            "direction": _txn_direction(r.get("txn_type")),
            "amount_band": band,
            "size_tier": _band_label_safe(band),
            "is_large": _is_large(band),
            "transaction_date": transaction_date,
            "filed_at_date": filed_at,
            "filing_lag_days": late_days,
            # description scrubbed: drop stock-symbol-in-prose to keep ticker as the canonical field
            "instrument": (r.get("notes") or "").split("[")[0].strip()[:100] or None,
        })
    return norm


# ---------------------------------------------------------------------------
# Notability detectors
# ---------------------------------------------------------------------------

def detect_ticker_clusters(trades: list[dict], window_days: int, min_members: int) -> list[dict]:
    """
    Tickers disclosed by >= min_members distinct members within the most-recent
    window_days span. Operates on filed_at_date.
    """
    by_ticker: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        if t["ticker"]:
            by_ticker[t["ticker"]].append(t)

    clusters: list[dict] = []
    for ticker, ts in by_ticker.items():
        # Sort newest first by filing date
        ts_sorted = sorted(
            [x for x in ts if x["filed_at_date"]],
            key=lambda x: x["filed_at_date"],
            reverse=True,
        )
        if not ts_sorted:
            continue
        newest = ts_sorted[0]["filed_at_date"]
        cutoff = (datetime.strptime(newest, "%Y-%m-%d") - timedelta(days=window_days)).strftime("%Y-%m-%d")
        in_window = [x for x in ts_sorted if x["filed_at_date"] >= cutoff]
        members = sorted({x["name"] for x in in_window if x["name"]})
        if len(members) >= min_members:
            directions = Counter(x["direction"] for x in in_window)
            # Tilt label without advisory verbs
            net = directions.get("acquisition", 0) - directions.get("disposition", 0)
            if net > 0:
                tilt = "tilted toward acquisitions"
            elif net < 0:
                tilt = "tilted toward dispositions"
            else:
                tilt = "mixed"
            clusters.append({
                "ticker": ticker,
                "sector": in_window[0]["sector"],
                "member_count": len(members),
                "members": members,
                "filings_in_window": len(in_window),
                "window_start": cutoff,
                "window_end": newest,
                "tilt": tilt,
            })
    clusters.sort(key=lambda c: (c["member_count"], c["filings_in_window"]), reverse=True)
    return clusters


def detect_sector_clusters(trades: list[dict], window_days: int, min_members: int) -> list[dict]:
    """Sectors with disclosures from >= min_members distinct members in the window."""
    by_sector: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        if t["sector"] and t["sector"] != "Other":
            by_sector[t["sector"]].append(t)

    out: list[dict] = []
    for sector, ts in by_sector.items():
        ts_sorted = sorted(
            [x for x in ts if x["filed_at_date"]],
            key=lambda x: x["filed_at_date"],
            reverse=True,
        )
        if not ts_sorted:
            continue
        newest = ts_sorted[0]["filed_at_date"]
        cutoff = (datetime.strptime(newest, "%Y-%m-%d") - timedelta(days=window_days)).strftime("%Y-%m-%d")
        in_window = [x for x in ts_sorted if x["filed_at_date"] >= cutoff]
        members = sorted({x["name"] for x in in_window if x["name"]})
        if len(members) >= min_members:
            out.append({
                "sector": sector,
                "member_count": len(members),
                "filings_in_window": len(in_window),
                "window_start": cutoff,
                "window_end": newest,
            })
    out.sort(key=lambda c: c["member_count"], reverse=True)
    return out


def detect_large_size_trades(trades: list[dict], target_date: str) -> list[dict]:
    """Trades in the large-bands set, filed on the target date."""
    out = []
    for t in trades:
        if t["is_large"] and t["filed_at_date"] == target_date:
            out.append(t)
    out.sort(key=lambda t: SIZE_BAND_ORDER.index(t["amount_band"])
             if t["amount_band"] in SIZE_BAND_ORDER else -1,
             reverse=True)
    return out


def detect_late_filings(late_rows: list[dict], target_date: str, sector_map: dict[str, str],
                        late_window_days: int) -> list[dict]:
    """Disclosures from the late-reports feed, filed on target_date, with a delay flag."""
    norm = normalize_trades(late_rows, sector_map)
    out = []
    for t in norm:
        if t["filed_at_date"] != target_date:
            continue
        lag = t["filing_lag_days"]
        if lag is None or lag >= late_window_days:
            out.append({**t, "is_late": True})
    out.sort(key=lambda t: (t["filing_lag_days"] or 0), reverse=True)
    return out


# ---------------------------------------------------------------------------
# Commentary builder (observation voice)
# ---------------------------------------------------------------------------

def build_commentary(target_date: str, todays: list[dict],
                     ticker_clusters: list[dict], sector_clusters: list[dict],
                     large_today: list[dict], late_today: list[dict]) -> list[str]:
    """
    Build journal-style observations. No advisory verbs. No source disclosure.
    """
    obs: list[str] = []

    if not todays and not large_today and not late_today and not ticker_clusters:
        obs.append(
            f"Tonight's disclosure window was quiet - no new filings dated {target_date}."
        )
        return obs

    if todays:
        chamber_counts = Counter(t["chamber"] for t in todays)
        parts = []
        if chamber_counts.get("house"):
            parts.append(f"{chamber_counts['house']} House")
        if chamber_counts.get("senate"):
            parts.append(f"{chamber_counts['senate']} Senate")
        if chamber_counts.get("executive"):
            parts.append(f"{chamber_counts['executive']} Executive")
        if parts:
            obs.append(
                f"Tonight's filings showed {len(todays)} disclosures - {', '.join(parts)}."
            )

    if large_today:
        names = sorted({t["name"] for t in large_today if t["name"]})[:4]
        obs.append(
            f"Notable disclosures from today include larger-tier filings from "
            f"{', '.join(names)}{' and others' if len({t['name'] for t in large_today}) > 4 else ''}. "
            f"I'm watching whether the same names file again next week."
        )

    if ticker_clusters:
        top = ticker_clusters[0]
        obs.append(
            f"{top['ticker']} drew {top['member_count']} distinct members inside the "
            f"last 5 trading days ({top['filings_in_window']} filings, {top['tilt']}). "
            f"That kind of cluster is worth noting - not chasing."
        )
        if len(ticker_clusters) > 1:
            extras = ", ".join(c["ticker"] for c in ticker_clusters[1:4])
            obs.append(
                f"Other tickers showing multi-member activity in the same window: {extras}."
            )

    if sector_clusters:
        top = sector_clusters[0]
        obs.append(
            f"{top['member_count']} members disclosed trades in {top['sector']} this week - "
            f"a sector-level cluster I'll keep an eye on."
        )

    if late_today:
        n = len(late_today)
        max_lag = max((t["filing_lag_days"] or 0) for t in late_today)
        obs.append(
            f"{n} filing{'s' if n != 1 else ''} arrived late tonight "
            f"(longest lag {max_lag} days from transaction). Late filings are a timing color cue, "
            f"nothing more."
        )

    return obs


# ---------------------------------------------------------------------------
# Public/internal output partitioning
# ---------------------------------------------------------------------------

# Fields exposed in the PUBLIC snapshot (no vendor IDs, no upstream metadata).
PUBLIC_TRADE_FIELDS = (
    "name", "chamber", "ticker", "sector", "ownership", "direction",
    "amount_band", "size_tier", "is_large", "transaction_date", "filed_at_date",
    "filing_lag_days", "instrument",
)


def _public_trade(t: dict) -> dict:
    return {k: t.get(k) for k in PUBLIC_TRADE_FIELDS}


def _public_cluster(c: dict) -> dict:
    return {
        "ticker": c["ticker"],
        "sector": c.get("sector", "Other"),
        "member_count": c["member_count"],
        "members": c["members"],
        "filings_in_window": c["filings_in_window"],
        "window_start": c["window_start"],
        "window_end": c["window_end"],
        "tilt": c["tilt"],
    }


def _public_sector(s: dict) -> dict:
    return dict(s)


# ---------------------------------------------------------------------------
# Top-level orchestrator
# ---------------------------------------------------------------------------

def aggregate(raw: dict, config: dict) -> dict:
    """Single entry point. Returns (public_dict, internal_dict, html_context)."""
    target_date = raw.get("date")
    sector_map = config.get("sector_map", {}) or {}
    notability = config.get("notability", {}) or {}

    # Walk-forward filter
    recent_wf = filter_walk_forward(raw.get("recent_trades", []), target_date)
    late_wf = filter_walk_forward(raw.get("late_reports", []), target_date)

    # Normalize
    trades = normalize_trades(recent_wf, sector_map)
    todays = [t for t in trades if t["filed_at_date"] == target_date]

    # Notability detectors
    ticker_clusters = detect_ticker_clusters(
        trades,
        window_days=int(notability.get("cluster_window_days", 5)),
        min_members=int(notability.get("cluster_min_members", 2)),
    )
    sector_clusters = detect_sector_clusters(
        trades,
        window_days=int(notability.get("cluster_window_days", 5)),
        min_members=int(notability.get("sector_cluster_min_members", 3)),
    )
    large_today = detect_large_size_trades(trades, target_date)
    late_today = detect_late_filings(
        late_wf, target_date, sector_map,
        int(notability.get("late_window_days", 45)),
    )

    # Per-chamber + per-sector counts (today only)
    chamber_breakdown = dict(Counter(t["chamber"] for t in todays))
    sector_breakdown_today = dict(Counter(t["sector"] for t in todays))
    most_active_today = [
        {"name": n, "filings": c}
        for n, c in Counter(t["name"] for t in todays if t["name"]).most_common(5)
    ]

    commentary = build_commentary(
        target_date, todays, ticker_clusters, sector_clusters, large_today, late_today,
    )

    # Common shell.
    # `generated_at` is the canonical snapshot stamp for the target session.
    # It's derived from `target_date` (not wall clock) so re-runs are byte-identical.
    as_of_label = f"{target_date} 5:00 PM ET"
    generated_at = f"{target_date}T21:00:00Z"  # 5 PM ET in EDT (canonical stamp)
    wall_clock = datetime.utcnow().isoformat() + "Z"

    public = {
        "as_of": as_of_label,
        "as_of_date": target_date,
        "refresh_label": "5:00 PM ET",
        "summary": {
            "filings_today": len(todays),
            "members_today": len({t["name"] for t in todays if t["name"]}),
            "tickers_today": len({t["ticker"] for t in todays if t["ticker"]}),
            "chamber_breakdown": chamber_breakdown,
            "sector_breakdown": sector_breakdown_today,
            "large_filings_today": len(large_today),
            "late_filings_today": len(late_today),
        },
        "most_active_today": most_active_today,
        "trades_today": [_public_trade(t) for t in todays][:60],
        "notable": {
            "ticker_clusters": [_public_cluster(c) for c in ticker_clusters[:5]],
            "sector_clusters": [_public_sector(s) for s in sector_clusters[:3]],
            "large_filings": [_public_trade(t) for t in large_today[:10]],
            "late_filings": [_public_trade(t) for t in late_today[:10]],
        },
        "commentary": commentary,
        "data_quality": {
            "degraded": bool(raw.get("data_quality", {}).get("degraded")),
            "endpoints_ok": int(raw.get("data_quality", {}).get("endpoints_ok", 0)),
            "endpoints_failed": int(raw.get("data_quality", {}).get("endpoints_failed", 0)),
        },
        "generated_at": generated_at,
    }

    internal = {
        **public,
        "wall_clock_generated_at": wall_clock,
        "raw_counts": {
            "recent_trades_raw": len(raw.get("recent_trades", []) or []),
            "late_reports_raw": len(raw.get("late_reports", []) or []),
            "trader_view_raw": len(raw.get("trader_view", []) or []),
            "member_views": {k: len(v) for k, v in (raw.get("member_views") or {}).items()},
        },
        "raw_data_quality": raw.get("data_quality", {}),
        "notability_config": notability,
        "fetched_at": raw.get("fetched_at"),
        # Full normalized trade list (private)
        "all_trades_normalized": trades,
        "all_clusters_full": ticker_clusters,
        "all_sector_clusters_full": sector_clusters,
    }

    return {"public": public, "internal": internal}
