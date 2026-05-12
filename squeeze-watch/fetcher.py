"""
AZTMM Squeeze Watch — fetcher

Pulls short-pressure and options-context data for the candidate universe.
All endpoints are server-side only. Output structure is intentionally
opaque about source attribution — only the aggregator sees endpoint names.
"""
from __future__ import annotations

import concurrent.futures
import logging
import os
import time
from pathlib import Path
from typing import Any

import requests
import yaml

logger = logging.getLogger("squeeze.fetcher")

ROOT = Path(__file__).parent
CONFIG_PATH = ROOT / "config.yml"


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _auth_header() -> dict:
    token = os.environ.get("UW_API_KEY") or os.environ.get("UW_API_TOKEN")
    if not token:
        raise RuntimeError(
            "UW_API_KEY (or UW_API_TOKEN) env var not set — refusing to fetch."
        )
    return {"Authorization": f"Bearer {token}"}


def _get_json(url: str, params: dict | None = None, cfg: dict | None = None) -> dict:
    cfg = cfg or _load_config()
    headers = _auth_header()
    timeout = cfg["http"]["timeout_seconds"]
    max_retries = cfg["http"]["max_retries"]
    backoff = cfg["http"]["backoff_seconds"]

    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            r = requests.get(url, headers=headers, params=params, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            # 404s aren't worth retrying
            if r.status_code == 404:
                logger.debug("404 for %s", url)
                return {}
            # 429 — rate limit. Back off harder.
            if r.status_code == 429:
                wait = backoff * (4 ** attempt)
                logger.debug("429 for %s — sleeping %.1fs", url, wait)
                time.sleep(wait)
                last_err = RuntimeError("HTTP 429: rate limited")
                continue
            last_err = RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        except requests.RequestException as e:  # noqa: BLE001
            last_err = e
        time.sleep(backoff * (2 ** attempt))
    logger.warning("fetch failed for %s: %s", url, last_err)
    return {}


def _build_url(cfg: dict, endpoint_key: str, ticker: str | None = None) -> str:
    base = cfg["http"]["base_url"]
    path = cfg["endpoints"][endpoint_key]
    if ticker:
        path = path.replace("{ticker}", ticker)
    return base + path


# ---------------------------------------------------------------------------
# Per-ticker fetchers
# ---------------------------------------------------------------------------

def fetch_short_interest(cfg: dict, ticker: str) -> dict:
    """Returns most-recent short-interest-as-pct-of-float row, or {}."""
    url = _build_url(cfg, "shorts_interest_float", ticker)
    data = _get_json(url, cfg=cfg).get("data") or []
    if not data:
        return {}
    # Pick most-recent row by market_date
    try:
        row = max(data, key=lambda r: r.get("market_date", ""))
    except (ValueError, TypeError):
        return {}
    return {
        "market_date": row.get("market_date"),
        "days_to_cover": _safe_float(row.get("days_to_cover_returned")),
        "short_interest_pct_float": _safe_float(row.get("percent_returned")),
    }


def fetch_ftds(cfg: dict, ticker: str) -> dict:
    """Returns aggregated FTD context — recent total quantity, last date."""
    url = _build_url(cfg, "shorts_ftds", ticker)
    data = _get_json(url, cfg=cfg).get("data") or []
    if not data:
        return {"total_recent_qty": 0, "last_date": None}
    # Sum last 10 entries (most recent)
    recent = data[:10]
    total_qty = sum(int(r.get("quantity") or 0) for r in recent)
    last_date = recent[0].get("date") if recent else None
    return {"total_recent_qty": total_qty, "last_date": last_date}


def fetch_short_volume_ratio(cfg: dict, ticker: str) -> dict:
    """Returns most-recent short-volume-as-pct-of-total-volume."""
    url = _build_url(cfg, "shorts_volume_ratio", ticker)
    payload = _get_json(url, cfg=cfg)
    rows = payload.get("si") or payload.get("data") or []
    if not rows:
        return {}
    row = rows[0]
    return {
        "market_date": row.get("market_date"),
        "short_volume_ratio": _safe_float(row.get("short_volume_ratio")),
        "short_volume": _safe_int(row.get("short_volume")),
        "total_volume": _safe_int(row.get("total_volume")),
    }


def fetch_flow_alerts(cfg: dict, ticker: str) -> dict:
    """Recent options flow alerts — counts and call/put split."""
    url = _build_url(cfg, "flow_alerts")
    payload = _get_json(url, params={"ticker_symbol": ticker, "limit": 200}, cfg=cfg)
    alerts = payload.get("data") or []
    if not alerts:
        return {
            "alert_count": 0,
            "call_alert_count": 0,
            "put_alert_count": 0,
            "call_put_alert_ratio": 0.0,
            "total_premium": 0.0,
        }
    call_count = 0
    put_count = 0
    total_premium = 0.0
    for a in alerts:
        chain = a.get("option_chain", "") or ""
        # OCC option chains: ...{C|P}{strike} — last C or P before 8-digit strike marks type
        is_call = "C" in chain[-9:] and "P" not in chain[-9:-8] if len(chain) >= 9 else False
        is_put = "P" in chain[-9:] and "C" not in chain[-9:-8] if len(chain) >= 9 else False
        # Simpler robust parse:
        if len(chain) >= 9:
            typ_char = chain[-9]
            if typ_char == "C":
                call_count += 1
            elif typ_char == "P":
                put_count += 1
        total_premium += _safe_float(a.get("total_ask_side_prem")) + _safe_float(a.get("total_bid_side_prem"))
    ratio = (call_count / put_count) if put_count > 0 else (float(call_count) if call_count > 0 else 0.0)
    return {
        "alert_count": len(alerts),
        "call_alert_count": call_count,
        "put_alert_count": put_count,
        "call_put_alert_ratio": ratio,
        "total_premium": total_premium,
    }


def fetch_greek_exposure(cfg: dict, ticker: str) -> dict:
    """Returns most-recent GEX context."""
    url = _build_url(cfg, "greek_exposure", ticker)
    data = _get_json(url, cfg=cfg).get("data") or []
    if not data:
        return {}
    # Most recent row by date
    try:
        row = max(data, key=lambda r: r.get("date", ""))
    except (ValueError, TypeError):
        return {}
    call_gamma = _safe_float(row.get("call_gamma"))
    put_gamma = _safe_float(row.get("put_gamma"))
    # Net gamma exposure = call_gamma + put_gamma (puts already negative)
    gex = call_gamma + put_gamma
    return {
        "date": row.get("date"),
        "net_gex": gex,
        "call_gamma": call_gamma,
        "put_gamma": put_gamma,
    }


def fetch_stock_info(cfg: dict, ticker: str) -> dict:
    """Returns market cap + avg-30 volume for liquidity gating."""
    url = _build_url(cfg, "stock_info", ticker)
    payload = _get_json(url, cfg=cfg)
    info = payload.get("data") or {}
    if not info:
        return {}
    return {
        "ticker": ticker,
        "marketcap": _safe_float(info.get("marketcap")),
        "avg30_volume": _safe_float(info.get("avg30_volume")),
        "sector": info.get("sector"),
        "has_options": bool(info.get("has_options")),
    }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def _fetch_ticker_slices(cfg: dict, ticker: str) -> tuple[str, dict | None, str | None]:
    """Run liquidity gate then all per-ticker fetches. Returns
    (ticker, slices_or_None, filter_reason_or_None)."""
    info = fetch_stock_info(cfg, ticker)
    if not info:
        return (ticker, None, "no_info")
    min_cap = cfg["universe_filters"]["min_market_cap_usd"]
    min_vol = cfg["universe_filters"]["min_avg_daily_volume_shares"]
    if info["marketcap"] < min_cap:
        return (ticker, None, "below_market_cap_floor")
    if info["avg30_volume"] < min_vol:
        return (ticker, None, "below_volume_floor")
    if not info["has_options"]:
        return (ticker, None, "no_options")

    slices: dict[str, Any] = {"info": info}
    for key, fn in [
        ("short_interest", fetch_short_interest),
        ("ftds", fetch_ftds),
        ("short_volume_ratio", fetch_short_volume_ratio),
        ("flow_alerts", fetch_flow_alerts),
        ("greek_exposure", fetch_greek_exposure),
    ]:
        try:
            slices[key] = fn(cfg, ticker)
        except Exception as e:  # noqa: BLE001
            logger.warning("fetch %s/%s failed: %s", ticker, key, e)
            slices[key] = {}
    return (ticker, slices, None)


def fetch_all(date: str, cfg: dict | None = None, max_workers: int = 4) -> dict:
    """
    For each candidate ticker that passes the liquidity gate, fetch the
    five data slices. Returns the raw bundle keyed by ticker.
    """
    cfg = cfg or _load_config()
    universe = cfg["candidate_universe"]

    bundle: dict[str, Any] = {
        "date": date,
        "tickers": {},
        "data_quality": {"endpoints_ok": 0, "endpoints_failed": 0, "tickers_filtered": []},
    }

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {ex.submit(_fetch_ticker_slices, cfg, t): t for t in universe}
        for fut in concurrent.futures.as_completed(futs):
            ticker, slices, reason = fut.result()
            if slices is None:
                bundle["data_quality"]["tickers_filtered"].append(
                    {"ticker": ticker, "reason": reason}
                )
                continue
            for k in ("short_interest", "ftds", "short_volume_ratio", "flow_alerts", "greek_exposure"):
                if slices.get(k):
                    bundle["data_quality"]["endpoints_ok"] += 1
                else:
                    bundle["data_quality"]["endpoints_failed"] += 1
            bundle["tickers"][ticker] = slices

    return bundle


# ---------------------------------------------------------------------------
# Type coercion helpers
# ---------------------------------------------------------------------------

def _safe_float(v: Any) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _safe_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


if __name__ == "__main__":
    import json, sys, argparse
    p = argparse.ArgumentParser()
    p.add_argument("--date", required=True)
    args = p.parse_args()
    bundle = fetch_all(args.date)
    json.dump(bundle, sys.stdout, indent=2, default=str)
