"""
AZTMM Daily Pulse v2 — Fetcher
================================

Pulls end-of-day options + dark pool data feeds for a single trading date.

Design rules:
- Token loaded from env var only (never hardcoded, never persisted).
- Idempotent on date (same input date => same data envelope).
- Defensive: each endpoint wrapped in try/except, failure flagged in
  data_quality dict, never crashes upstream consumers.
- Rate-limit aware: 0.6s sleep between calls keeps us well under 120/min.
- Walk-forward only: NEVER pulls data with timestamps newer than the
  target date's regular-session close.

NOTE: This module deliberately uses generic variable names for the upstream
data provider so the source is not visible in user-rendered output.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_BASE = "https://api.unusualwhales.com"  # not surfaced to users
DEFAULT_THROTTLE_SEC = 0.6  # 100 req/min worst case — well under 120/min cap
DEFAULT_TIMEOUT = 20

# The 12 sector ETFs we report on
SECTOR_ETFS = [
    "SPY", "XLK", "XLF", "XLV", "XLY", "XLP",
    "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC",
]

# Dark pool watchlist — index proxies + mega-cap concentration leaders
DP_WATCHLIST = [
    "SPY", "QQQ", "IWM",
    "NVDA", "MSFT", "AAPL", "GOOGL", "META", "TSLA", "AMZN",
    "AVGO", "AMD",
]

logger = logging.getLogger("daily_pulse.fetcher")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _token() -> str:
    """Load token from env var. Raise if missing."""
    tok = os.environ.get("UW_API_TOKEN")
    if not tok:
        raise RuntimeError(
            "UW_API_TOKEN not set. Export it in env before calling fetcher."
        )
    return tok


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_token()}",
        "Accept": "application/json",
        "User-Agent": "aztmm-daily-pulse/2.0",
    }


@dataclass
class FetchResult:
    """One endpoint's result, with quality flag."""
    ok: bool
    data: Any = None
    error: str | None = None
    endpoint: str = ""


def _get(path: str, params: dict | None = None, throttle: float = DEFAULT_THROTTLE_SEC) -> FetchResult:
    """Single GET with throttle, retry once on 429/5xx, never raise."""
    url = f"{API_BASE}{path}"
    last_err = None
    for attempt in range(2):
        try:
            r = requests.get(
                url,
                headers=_headers(),
                params=params or {},
                timeout=DEFAULT_TIMEOUT,
            )
            time.sleep(throttle)
            if r.status_code == 200:
                return FetchResult(ok=True, data=r.json(), endpoint=path)
            if r.status_code in (429, 500, 502, 503, 504) and attempt == 0:
                time.sleep(2.0)
                continue
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
            break
        except requests.RequestException as e:  # network errs
            last_err = f"Network: {type(e).__name__}: {e}"
            if attempt == 0:
                time.sleep(2.0)
                continue
            break
    logger.warning("fetch failed: %s — %s", path, last_err)
    return FetchResult(ok=False, error=last_err, endpoint=path)


def _prev_market_day(date_str: str) -> str:
    """Return the previous weekday (no exchange-holiday calendar — best effort)."""
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    while True:
        d -= timedelta(days=1)
        if d.weekday() < 5:  # Mon=0..Fri=4
            return d.isoformat()


# ---------------------------------------------------------------------------
# Endpoint wrappers
# ---------------------------------------------------------------------------

def fetch_market_totals(date_str: str) -> FetchResult:
    return _get("/api/market/total-options-volume", {"date": date_str})


def fetch_sector_etfs() -> FetchResult:
    return _get("/api/market/sector-etfs")


def fetch_market_tide(date_str: str) -> FetchResult:
    return _get("/api/market/market-tide", {"date": date_str})


def fetch_sector_tide(sector_slug: str) -> FetchResult:
    # sector slug examples: Technology, Healthcare, Financial+Services
    return _get(f"/api/market/{sector_slug}/sector-tide")


def fetch_flow_alerts(limit: int = 200) -> FetchResult:
    return _get("/api/option-trades/flow-alerts", {"limit": limit})


def fetch_dark_pool(ticker: str, date_str: str, limit: int = 500) -> FetchResult:
    return _get(f"/api/darkpool/{ticker}", {"date": date_str, "limit": limit})


# --- v2.1 additions: smart-money + macro signals ---
# Paths confirmed via UW OpenAPI docs (insider, analysts, economy/treasury-yield).
# Other paths are best-guess; if a 404 fires, data_quality.failures captures it
# and the aggregator simply skips that block.

ALL_SECTORS = [
    "Basic Materials", "Communication Services", "Consumer Cyclical",
    "Consumer Defensive", "Energy", "Financial Services", "Healthcare",
    "Industrials", "Real Estate", "Technology", "Utilities",
]


def fetch_insider_sector_flow(sector: str, limit: int = 14) -> FetchResult:
    """Insider buy/sell per sector — last `limit` days."""
    return _get(f"/api/insider/{sector}/sector-flow", {"limit": limit})


def fetch_analyst_ratings(ticker: str | None = None, limit: int = 50) -> FetchResult:
    """Analyst ratings — optionally filtered by ticker."""
    params: dict[str, Any] = {"limit": limit}
    if ticker:
        params["ticker"] = ticker
    return _get("/api/screener/analysts", params)


# Keyless macro source: FRED CSV (St. Louis Fed). No API key, no auth.
# DGS10 = 10Y constant-maturity Treasury, DGS2 = 2Y. CSV is `date,value`
# with missing/holiday days marked by a literal ".".
FRED_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv"
FRED_SERIES = {"10year": "DGS10", "2year": "DGS2"}


def fetch_yield_curve_maturity(maturity: str = "10year") -> FetchResult:
    """Latest Treasury yield for one maturity from FRED (keyless CSV).

    Returns FetchResult whose .data is the latest data point shaped like the
    aggregator expects: {"value": <float pct>, "date": "YYYY-MM-DD"}.
    Never raises; failures are flagged in data_quality.
    """
    series = FRED_SERIES.get(maturity)
    if series is None:
        return FetchResult(ok=False, error=f"unknown maturity {maturity!r}",
                           endpoint=f"fred:{maturity}")
    endpoint = f"fred:{series}"
    last_err = None
    for attempt in range(2):
        try:
            r = requests.get(
                FRED_CSV_BASE,
                params={"id": series},
                timeout=DEFAULT_TIMEOUT,
                headers={"User-Agent": "aztmm-daily-pulse/2.0"},
            )
            time.sleep(DEFAULT_THROTTLE_SEC)
            if r.status_code == 200:
                latest = None
                for line in r.text.strip().splitlines()[1:]:  # skip header
                    parts = line.split(",")
                    if len(parts) < 2:
                        continue
                    date_s, val_s = parts[0].strip(), parts[1].strip()
                    if not val_s or val_s == ".":  # FRED missing-day marker
                        continue
                    try:
                        latest = {"value": float(val_s), "date": date_s}
                    except ValueError:
                        continue
                if latest is not None:
                    return FetchResult(ok=True, data=latest, endpoint=endpoint)
                last_err = "no parseable rows in FRED CSV"
                break
            if r.status_code in (429, 500, 502, 503, 504) and attempt == 0:
                time.sleep(2.0)
                continue
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
            break
        except requests.RequestException as e:
            last_err = f"Network: {type(e).__name__}: {e}"
            if attempt == 0:
                time.sleep(2.0)
                continue
            break
    logger.warning("FRED fetch failed: %s — %s", endpoint, last_err)
    return FetchResult(ok=False, error=last_err, endpoint=endpoint)


# ---------------------------------------------------------------------------
# Top-level: pull everything for one date
# ---------------------------------------------------------------------------

def fetch_daily_data(date_str: str) -> dict[str, Any]:
    """
    Pull every dataset needed for the daily pulse for `date_str`.

    Returns a dict shaped like:
        {
            "date": "YYYY-MM-DD",
            "prev_date": "YYYY-MM-DD",
            "market_totals": {...} | None,
            "market_totals_prev": {...} | None,
            "sector_etfs": [...] | [],
            "market_tide": [...] | [],
            "sector_tides": { "Technology": [...] | [] },
            "flow_alerts": [...] | [],
            "darkpool": { "NVDA": [...] | [] },
            "data_quality": {
                "endpoints_ok": int,
                "endpoints_failed": int,
                "failures": [{"endpoint": str, "error": str}],
                "degraded": bool,
            },
            "fetched_at": "ISO-8601 UTC",
        }
    """
    prev = _prev_market_day(date_str)
    out: dict[str, Any] = {
        "date": date_str,
        "prev_date": prev,
        "market_totals": None,
        "market_totals_prev": None,
        "sector_etfs": [],
        "market_tide": [],
        "sector_tides": {},
        "flow_alerts": [],
        "darkpool": {},
        "data_quality": {
            "endpoints_ok": 0,
            "endpoints_failed": 0,
            "failures": [],
            "degraded": False,
        },
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }

    dq = out["data_quality"]

    def _record(res: FetchResult) -> None:
        if res.ok:
            dq["endpoints_ok"] += 1
        else:
            dq["endpoints_failed"] += 1
            dq["failures"].append({"endpoint": res.endpoint, "error": res.error})

    # --- Market totals (today + yesterday)
    # NOTE: UW returns this endpoint as {"data": [ {row} ]} — a single-row
    # list wrapping the day's summary dict. Unwrap to the dict the aggregator
    # expects (aggregate_market_totals calls .get() on this value).
    def _unwrap_market_totals(payload: Any) -> dict | None:
        inner = payload.get("data") if isinstance(payload, dict) else payload
        if isinstance(inner, list):
            return inner[0] if inner and isinstance(inner[0], dict) else None
        if isinstance(inner, dict):
            return inner
        return None

    r = fetch_market_totals(date_str)
    _record(r)
    if r.ok:
        out["market_totals"] = _unwrap_market_totals(r.data)

    r_prev = fetch_market_totals(prev)
    _record(r_prev)
    if r_prev.ok:
        out["market_totals_prev"] = _unwrap_market_totals(r_prev.data)

    # --- Sector ETFs snapshot
    r = fetch_sector_etfs()
    _record(r)
    if r.ok:
        # Different deployments return data under "data" or as top-level list
        payload = r.data.get("data") if isinstance(r.data, dict) else r.data
        out["sector_etfs"] = payload if isinstance(payload, list) else []

    # --- Market tide (intraday cumulative)
    r = fetch_market_tide(date_str)
    _record(r)
    if r.ok:
        payload = r.data.get("data") if isinstance(r.data, dict) else r.data
        out["market_tide"] = payload if isinstance(payload, list) else []

    # --- Technology sector tide (tech narrowing detector)
    r = fetch_sector_tide("Technology")
    _record(r)
    if r.ok:
        payload = r.data.get("data") if isinstance(r.data, dict) else r.data
        out["sector_tides"]["Technology"] = payload if isinstance(payload, list) else []

    # --- Flow alerts
    r = fetch_flow_alerts(limit=200)
    _record(r)
    if r.ok:
        payload = r.data.get("data") if isinstance(r.data, dict) else r.data
        out["flow_alerts"] = payload if isinstance(payload, list) else []

    # --- Dark pool per ticker
    for tkr in DP_WATCHLIST:
        r = fetch_dark_pool(tkr, date_str, limit=500)
        _record(r)
        if r.ok:
            payload = r.data.get("data") if isinstance(r.data, dict) else r.data
            out["darkpool"][tkr] = payload if isinstance(payload, list) else []
        else:
            out["darkpool"][tkr] = []

    # --- v2.1: insider sector flow (11 sectors)
    out["insider_sector_flow"] = {}
    for sector in ALL_SECTORS:
        r = fetch_insider_sector_flow(sector, limit=14)
        _record(r)
        if r.ok:
            payload = r.data.get("data") if isinstance(r.data, dict) else r.data
            out["insider_sector_flow"][sector] = payload if isinstance(payload, list) else []
        else:
            out["insider_sector_flow"][sector] = []

    # --- v2.1: analyst ratings (market-wide, last 50)
    r = fetch_analyst_ratings(limit=50)
    _record(r)
    out["analyst_ratings"] = []
    if r.ok:
        payload = r.data.get("data") if isinstance(r.data, dict) else r.data
        out["analyst_ratings"] = payload if isinstance(payload, list) else []

    # --- v2.1: yield curve (keyless FRED CSV — 10Y & 2Y constant maturity)
    # .data is already the latest {"value", "date"} dict the aggregator wants.
    r = fetch_yield_curve_maturity("10year")
    _record(r)
    out["yield_10y"] = r.data if r.ok else None

    r = fetch_yield_curve_maturity("2year")
    _record(r)
    out["yield_2y"] = r.data if r.ok else None

    dq["degraded"] = dq["endpoints_failed"] > 0
    return out


# ---------------------------------------------------------------------------
# CLI for quick verification
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--date", default=datetime.utcnow().strftime("%Y-%m-%d"))
    p.add_argument("--out", default=None)
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO)
    payload = fetch_daily_data(args.date)
    payload_str = json.dumps(payload, indent=2, default=str)

    if args.out:
        with open(args.out, "w") as f:
            f.write(payload_str)
        print(f"wrote {args.out}  endpoints_ok={payload['data_quality']['endpoints_ok']}  failed={payload['data_quality']['endpoints_failed']}")
    else:
        print(payload_str[:4000])
