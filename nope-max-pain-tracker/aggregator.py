"""
AZTMM NOPE & Max-Pain Tracker — Aggregator
===========================================

Pure functions. No I/O.

Input:  the dict shape produced by fetcher.fetch_all()
Output: an internal dict (rich) AND a public dict (scrubbed) for the
        publisher to write to internal.json and public.json respectively.

Notable computations:
  - End-of-session NOPE per ticker (last bar of /nope timeseries)
  - 30-day rolling NOPE per index (one EOD reading per day)
  - Near-expiry max-pain per ticker + magnet-zone flag
  - Spot vs max-pain distance
  - Observational commentary lines
  - Optional NOPE proxy if /nope endpoint is unavailable

NOTE: Output strings never reference the upstream data provider or any model
weighting. Public output strips the underlying methodology fields entirely.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

logger = logging.getLogger("nope_max_pain.aggregator")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _flt(x: Any, default: float | None = 0.0) -> float | None:
    if x is None:
        return default
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _fmt_pct(p: float) -> str:
    return f"{p:+.2f}%"


def _fmt_strike(s: float | None) -> str:
    if s is None:
        return "n/a"
    if abs(s) >= 1000:
        return f"${s:,.0f}"
    return f"${s:.0f}"


def _fmt_spot(s: float | None) -> str:
    if s is None:
        return "n/a"
    return f"${s:.2f}"


def _nope_band(nope: float | None, bands: dict) -> str:
    if nope is None:
        return "unavailable"
    if nope >= bands["high_pos"]:
        return "deeply-positive"
    if nope >= bands["low_pos"]:
        return "positive"
    if nope <= bands["high_neg"]:
        return "deeply-negative"
    if nope <= bands["low_neg"]:
        return "negative"
    return "neutral"


def _nope_band_phrase(band: str) -> str:
    return {
        "deeply-positive": "deeply positive",
        "positive": "positive",
        "neutral": "near zero",
        "negative": "negative",
        "deeply-negative": "deeply negative",
        "unavailable": "not available",
    }.get(band, "near zero")


# ---------------------------------------------------------------------------
# NOPE — current reading + 30-day series
# ---------------------------------------------------------------------------

def _current_nope_from_series(series: list[dict]) -> dict:
    """Return the latest NOPE bar (the timeseries is reverse-chronological in the source)."""
    if not series:
        return {"available": False}
    # The source orders newest-first per probe. Pick the first valid record.
    last = None
    for row in series:
        if isinstance(row, dict) and row.get("nope") is not None:
            last = row
            break
    if not last:
        return {"available": False}
    return {
        "available": True,
        "nope": _flt(last.get("nope")),
        "nope_fill": _flt(last.get("nope_fill")),
        "call_vol": int(_flt(last.get("call_vol")) or 0),
        "put_vol": int(_flt(last.get("put_vol")) or 0),
        "stock_vol": int(_flt(last.get("stock_vol")) or 0),
        "call_delta": _flt(last.get("call_delta")),
        "put_delta": _flt(last.get("put_delta")),
        "timestamp": last.get("timestamp"),
    }


def _nope_proxy_from_greeks(greek_exposure: list[dict]) -> dict:
    """
    Fallback NOPE proxy when /nope is unavailable on the plan.

    Proxy: from greek-exposure (per-date), use the most recent row's
    call_delta + put_delta. NOPE proxy = (call_delta + put_delta) / 1e6
    so values fall in a comparable range to native NOPE.

    Note: we deliberately keep this conservative. The exact formula is
    internal-only and never published.
    """
    if not greek_exposure:
        return {"available": False}
    last = None
    # greek-exposure is forward-chronological; pick the latest
    for row in reversed(greek_exposure):
        if isinstance(row, dict):
            last = row
            break
    if not last:
        return {"available": False}
    cd = _flt(last.get("call_delta")) or 0.0
    pd = _flt(last.get("put_delta")) or 0.0
    proxy = (cd + pd) / 1_000_000.0
    return {
        "available": True,
        "nope": proxy,
        "nope_fill": None,
        "call_vol": None,
        "put_vol": None,
        "stock_vol": None,
        "call_delta": cd,
        "put_delta": pd,
        "timestamp": last.get("date"),
        "proxy": True,
    }


def _build_30d_series(nope_series: list[dict], lookback_days: int) -> list[dict]:
    """
    Compress the minute-bar timeseries into one bar per trading date.

    We take the *last* bar of each date (end-of-session reading).
    """
    if not nope_series:
        return []
    by_date: dict[str, dict] = {}
    for row in nope_series:
        if not isinstance(row, dict):
            continue
        ts = row.get("timestamp")
        if not ts:
            continue
        date_part = ts[:10]
        nope = _flt(row.get("nope"))
        if nope is None:
            continue
        existing = by_date.get(date_part)
        if existing is None or ts > existing["_ts"]:
            by_date[date_part] = {"date": date_part, "nope": nope, "_ts": ts}
    # Sort ascending
    rows = sorted(by_date.values(), key=lambda r: r["date"])
    # Take last N
    rows = rows[-lookback_days:]
    return [{"date": r["date"], "nope": r["nope"]} for r in rows]


# ---------------------------------------------------------------------------
# Max-pain
# ---------------------------------------------------------------------------

def _select_near_expiry(max_pain_rows: list[dict], target_date: str) -> dict | None:
    """Pick the closest expiry strictly >= target_date."""
    if not max_pain_rows:
        return None
    candidates = []
    for r in max_pain_rows:
        if not isinstance(r, dict):
            continue
        expiry = r.get("expiry")
        if not expiry or expiry < target_date:
            continue
        candidates.append(r)
    if not candidates:
        return None
    candidates.sort(key=lambda r: r["expiry"])
    return candidates[0]


def _select_monthly_expiry(max_pain_rows: list[dict], target_date: str) -> dict | None:
    """Pick the next monthly expiry (3rd Friday) on or after target date."""
    if not max_pain_rows:
        return None
    tgt = datetime.strptime(target_date, "%Y-%m-%d").date()
    candidates = []
    for r in max_pain_rows:
        if not isinstance(r, dict):
            continue
        expiry_str = r.get("expiry")
        if not expiry_str:
            continue
        try:
            d = datetime.strptime(expiry_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        if d < tgt:
            continue
        # 3rd Friday: weekday==4 (Friday) and day in 15..21
        if d.weekday() == 4 and 15 <= d.day <= 21:
            candidates.append(r)
    if not candidates:
        return None
    candidates.sort(key=lambda r: r["expiry"])
    return candidates[0]


def _aggregate_max_pain(ticker: str, max_pain_rows: list[dict], target_date: str,
                        magnet_pct: float) -> dict:
    out: dict[str, Any] = {"available": False, "ticker": ticker}
    if not max_pain_rows:
        return out

    near = _select_near_expiry(max_pain_rows, target_date)
    monthly = _select_monthly_expiry(max_pain_rows, target_date)

    if not near:
        return out

    spot = _flt(near.get("close"))
    mp = _flt(near.get("max_pain"))
    distance_pct = None
    magnet_zone = False
    direction = "n/a"
    if spot and mp and spot > 0:
        distance_pct = ((spot - mp) / spot) * 100.0
        direction = "above" if spot > mp else ("below" if spot < mp else "at")
        magnet_zone = abs(distance_pct) <= magnet_pct

    out = {
        "available": True,
        "ticker": ticker,
        "spot": spot,
        "spot_fmt": _fmt_spot(spot),
        "near": {
            "expiry": near.get("expiry"),
            "max_pain": mp,
            "max_pain_fmt": _fmt_strike(mp),
            "upper_strike": _flt(near.get("next_upper_strike")),
            "lower_strike": _flt(near.get("next_lower_strike")),
        },
        "monthly": None,
        "distance_pct": distance_pct,
        "distance_pct_fmt": (_fmt_pct(distance_pct) if distance_pct is not None else "n/a"),
        "direction": direction,
        "magnet_zone": magnet_zone,
    }
    if monthly:
        out["monthly"] = {
            "expiry": monthly.get("expiry"),
            "max_pain": _flt(monthly.get("max_pain")),
            "max_pain_fmt": _fmt_strike(_flt(monthly.get("max_pain"))),
        }
    return out


# ---------------------------------------------------------------------------
# OI change — what shifted max-pain
# ---------------------------------------------------------------------------

def _summarize_oi_change(oi_rows: list[dict], min_contracts: int) -> dict:
    """Top contributors to today's OI shift, internal-only."""
    if not oi_rows:
        return {"available": False, "top_calls": [], "top_puts": []}
    calls = []
    puts = []
    for r in oi_rows:
        if not isinstance(r, dict):
            continue
        sym = r.get("option_symbol") or ""
        diff = _flt(r.get("oi_diff_plain")) or 0.0
        if abs(diff) < min_contracts:
            continue
        # Symbol shape: SPY260512C00718000 -> option type "C" or "P" at index 6 (after 3-char root)
        # but root length varies; rely on presence of 'C' or 'P' before strike digits.
        # Use a robust scan instead.
        is_call = None
        for i, ch in enumerate(sym):
            if ch in ("C", "P") and i >= 1 and sym[i-1].isdigit():
                is_call = (ch == "C")
                break
        row = {
            "symbol": sym,
            "oi_change": diff,
            "current_oi": int(_flt(r.get("curr_oi")) or 0),
            "volume": int(_flt(r.get("volume")) or 0),
        }
        if is_call is True:
            calls.append(row)
        elif is_call is False:
            puts.append(row)

    calls.sort(key=lambda r: abs(r["oi_change"]), reverse=True)
    puts.sort(key=lambda r: abs(r["oi_change"]), reverse=True)
    return {
        "available": bool(calls or puts),
        "top_calls": calls[:5],
        "top_puts": puts[:5],
    }


# ---------------------------------------------------------------------------
# Per-ticker rollup
# ---------------------------------------------------------------------------

def _ticker_rollup(ticker: str, payload: dict, config: dict, target_date: str) -> dict:
    nope_series = payload.get("nope") or []
    current = _current_nope_from_series(nope_series)
    proxy_used = False
    if not current.get("available"):
        # Try proxy from greek-exposure
        proxy = _nope_proxy_from_greeks(payload.get("greek_exposure") or [])
        if proxy.get("available"):
            current = proxy
            proxy_used = True

    band = _nope_band(current.get("nope") if current.get("available") else None, config["nope_bands"])
    mp = _aggregate_max_pain(ticker, payload.get("max_pain") or [], target_date, config["max_pain"]["magnet_pct_threshold"])
    oi = _summarize_oi_change(payload.get("oi_change") or [], config["commentary"]["oi_shift_min_contracts"])

    return {
        "ticker": ticker,
        "nope": current,
        "nope_band": band,
        "nope_band_phrase": _nope_band_phrase(band),
        "nope_proxy_used": proxy_used,
        "max_pain": mp,
        "oi_change": oi,
    }


# ---------------------------------------------------------------------------
# Cross-ticker observations
# ---------------------------------------------------------------------------

def _build_commentary(rollups: dict[str, dict], config: dict) -> list[str]:
    """2-4 observational commentary lines. No advisory language."""
    notes: list[str] = []

    # 1. Magnet-zone observation
    magnets = []
    for tkr, r in rollups.items():
        mp = r.get("max_pain", {})
        if mp.get("available") and mp.get("magnet_zone"):
            magnets.append((tkr, mp))
    if magnets:
        names = ", ".join(m[0] for m in magnets[:5])
        notes.append(
            f"Spot prices for {names} are within "
            f"{config['commentary']['magnet_zone_pct']:.0f}% of their near-expiry "
            f"max-pain strike — historically that's been a magnet zone into expiry."
        )

    # 2. NOPE polarity across megacaps
    megacaps = [t for t in config["megacap_tickers"] if t in rollups]
    if megacaps:
        pos = [t for t in megacaps if rollups[t]["nope_band"] in ("positive", "deeply-positive")]
        neg = [t for t in megacaps if rollups[t]["nope_band"] in ("negative", "deeply-negative")]
        if len(pos) == 1 and len(neg) >= len(megacaps) - 2:
            notes.append(
                f"{pos[0]} is the only megacap with positive net options pressure today; "
                f"the rest of the cohort reads neutral-to-negative."
            )
        elif len(neg) == 1 and len(pos) >= len(megacaps) - 2:
            notes.append(
                f"{neg[0]} is the only megacap with negative net options pressure today; "
                f"the rest of the cohort reads neutral-to-positive."
            )
        elif len(pos) >= len(megacaps) - 1:
            notes.append(
                f"Net options pressure across the megacap cohort reads broadly positive "
                f"({len(pos)} of {len(megacaps)} names)."
            )
        elif len(neg) >= len(megacaps) - 1:
            notes.append(
                f"Net options pressure across the megacap cohort reads broadly negative "
                f"({len(neg)} of {len(megacaps)} names)."
            )

    # 3. Index NOPE polarity
    index_polarity = []
    for tkr in config["index_tickers"]:
        r = rollups.get(tkr)
        if not r:
            continue
        band = r["nope_band"]
        if band == "unavailable":
            continue
        index_polarity.append((tkr, band, r["nope"].get("nope")))
    if index_polarity:
        all_neg = all(b in ("negative", "deeply-negative") for _, b, _ in index_polarity)
        all_pos = all(b in ("positive", "deeply-positive") for _, b, _ in index_polarity)
        if all_neg:
            notes.append(
                "All three index proxies (SPY, QQQ, IWM) print negative net options "
                "pressure together — that's an alignment worth noting."
            )
        elif all_pos:
            notes.append(
                "All three index proxies (SPY, QQQ, IWM) print positive net options "
                "pressure together — broad-tape demand for upside convexity."
            )

    # 4. Max-pain shift commentary for index proxies (rough — based on near vs monthly distance)
    for tkr in config["index_tickers"]:
        r = rollups.get(tkr)
        if not r:
            continue
        mp = r.get("max_pain", {})
        if not mp.get("available") or not mp.get("monthly"):
            continue
        near_mp = mp["near"]["max_pain"]
        monthly_mp = mp["monthly"]["max_pain"]
        if near_mp and monthly_mp and abs(near_mp - monthly_mp) >= 5:
            direction = "higher" if monthly_mp > near_mp else "lower"
            notes.append(
                f"{tkr} max-pain steps {direction} from the near expiry "
                f"({mp['near']['max_pain_fmt']}) to the next monthly "
                f"({mp['monthly']['max_pain_fmt']}) — open interest has built up "
                f"away from current spot at the longer-dated tenor."
            )
            break  # only need one of these

    return notes[:4]


# ---------------------------------------------------------------------------
# Top-level orchestrator
# ---------------------------------------------------------------------------

def aggregate(raw: dict, config: dict) -> dict:
    """
    Returns:
      {
        "internal": {...},  # rich
        "public":   {...},  # scrubbed, for jsDelivr + page
      }
    """
    target_date = raw["date"]

    rollups: dict[str, dict] = {}
    all_tickers = config["index_tickers"] + config["megacap_tickers"]
    for tkr in all_tickers:
        payload = raw["tickers"].get(tkr) or {}
        rollups[tkr] = _ticker_rollup(tkr, payload, config, target_date)

    commentary = _build_commentary(rollups, config)

    # Build 30-day NOPE chart series per index ticker
    chart_series: dict[str, list[dict]] = {}
    for tkr in config["nope_chart"]["charted_tickers"]:
        ticker_payload = raw["tickers"].get(tkr) or {}
        series = _build_30d_series(
            ticker_payload.get("nope") or [],
            config["nope_chart"]["lookback_days"],
        )
        chart_series[tkr] = series

    # ---- INTERNAL (raw, rich, for repo only) ----
    internal = {
        "date": target_date,
        "generated_at_iso": datetime.utcnow().isoformat() + "Z",
        "data_quality": raw.get("data_quality", {}),
        "tickers": rollups,
        "nope_chart": chart_series,
        "commentary": commentary,
    }

    # ---- PUBLIC (scrubbed, minimal, for jsDelivr) ----
    # Strip: raw delta numbers, volume internals, OI symbol-level detail, proxy flag
    public_tickers = []
    for tkr in all_tickers:
        r = rollups[tkr]
        nope_obj = r.get("nope") or {}
        mp_obj = r.get("max_pain") or {}
        row = {
            "ticker": tkr,
            "nope": (round(nope_obj["nope"], 2) if nope_obj.get("available") else None),
            "nope_band": r["nope_band"],
            "max_pain": None,
            "max_pain_expiry": None,
            "spot": None,
            "distance_pct": None,
            "magnet_zone": False,
        }
        if mp_obj.get("available"):
            row["max_pain"] = mp_obj["near"]["max_pain"]
            row["max_pain_fmt"] = mp_obj["near"]["max_pain_fmt"]
            row["max_pain_expiry"] = mp_obj["near"]["expiry"]
            row["spot"] = mp_obj["spot"]
            row["spot_fmt"] = mp_obj["spot_fmt"]
            row["distance_pct"] = (round(mp_obj["distance_pct"], 2)
                                   if mp_obj["distance_pct"] is not None else None)
            row["distance_pct_fmt"] = mp_obj["distance_pct_fmt"]
            row["direction"] = mp_obj["direction"]
            row["magnet_zone"] = mp_obj["magnet_zone"]
            if mp_obj.get("monthly"):
                row["monthly_max_pain"] = mp_obj["monthly"]["max_pain"]
                row["monthly_max_pain_fmt"] = mp_obj["monthly"]["max_pain_fmt"]
                row["monthly_expiry"] = mp_obj["monthly"]["expiry"]
        public_tickers.append(row)

    public_chart = {tkr: series for tkr, series in chart_series.items()}

    # Headline metric for the 30-day trend sparkline: SPY NOPE reading.
    spy_row = next((r for r in public_tickers if r.get("ticker") == "SPY"), None)
    spy_nope = spy_row.get("nope") if spy_row else None

    public = {
        "date": target_date,
        "as_of_stamp": f"{target_date} 5:00 PM ET",
        "generated_at_iso": internal["generated_at_iso"],
        "index_tickers": config["index_tickers"],
        "megacap_tickers": config["megacap_tickers"],
        "tickers": public_tickers,
        "nope_chart": public_chart,
        "commentary": commentary,
        "degraded": raw.get("data_quality", {}).get("degraded", False),
        "headline_metric": {
            "label": "SPY NOPE reading",
            "value": spy_nope,
        },
    }

    return {"internal": internal, "public": public}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import json as _json
    import yaml

    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="JSON file produced by fetcher")
    p.add_argument("--config", required=True, help="config.yml path")
    p.add_argument("--out-internal", default=None)
    p.add_argument("--out-public", default=None)
    args = p.parse_args()

    with open(args.input) as f:
        raw = _json.load(f)
    with open(args.config) as f:
        cfg = yaml.safe_load(f)

    result = aggregate(raw, cfg)
    if args.out_internal:
        with open(args.out_internal, "w") as f:
            f.write(_json.dumps(result["internal"], indent=2, default=str))
    if args.out_public:
        with open(args.out_public, "w") as f:
            f.write(_json.dumps(result["public"], indent=2, default=str))
    if not (args.out_internal or args.out_public):
        print(_json.dumps(result["public"], indent=2, default=str)[:3000])
