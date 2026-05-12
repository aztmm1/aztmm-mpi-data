"""
AZTMM NOPE & Max-Pain Tracker — Fetcher
========================================

Pulls end-of-day options-gravity data per ticker for a single trading date.

Endpoints used (kept internal — never surfaced in output):
  - /api/stock/{T}/nope          — minute-bar net options pressure timeseries
  - /api/stock/{T}/max-pain      — per-expiry max-pain strike + spot context
  - /api/stock/{T}/greek-exposure— per-date GEX (gamma/delta/charm/vanna)
  - /api/stock/{T}/oi-change     — top OI changes per strike

Design rules:
  - Token loaded from env var only (UW_API_KEY, alias UW_API_TOKEN).
  - Idempotent on date.
  - Defensive: each call wrapped; failures recorded in data_quality.
  - Rate-limit aware: 0.6s sleep between calls.
  - If /nope is unavailable on the plan, the aggregator computes a NOPE proxy
    from chain delta totals — this module just records the failure.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import requests

API_BASE = "https://api.unusualwhales.com"   # internal — not user-visible
DEFAULT_THROTTLE_SEC = 0.6
DEFAULT_TIMEOUT = 20

logger = logging.getLogger("nope_max_pain.fetcher")


def _token() -> str:
    tok = os.environ.get("UW_API_KEY") or os.environ.get("UW_API_TOKEN")
    if not tok:
        raise RuntimeError(
            "UW_API_KEY (or UW_API_TOKEN) not set. Export it in env first."
        )
    return tok


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_token()}",
        "Accept": "application/json",
        "User-Agent": "aztmm-options-gravity/1.0",
    }


@dataclass
class FetchResult:
    ok: bool
    data: Any = None
    error: str | None = None
    endpoint: str = ""


def _get(path: str, params: dict | None = None, throttle: float = DEFAULT_THROTTLE_SEC) -> FetchResult:
    url = f"{API_BASE}{path}"
    last_err = None
    for attempt in range(2):
        try:
            r = requests.get(url, headers=_headers(), params=params or {}, timeout=DEFAULT_TIMEOUT)
            time.sleep(throttle)
            if r.status_code == 200:
                return FetchResult(ok=True, data=r.json(), endpoint=path)
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
    logger.warning("fetch failed: %s — %s", path, last_err)
    return FetchResult(ok=False, error=last_err, endpoint=path)


def _prev_market_day(date_str: str) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    while True:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            return d.isoformat()


# ---------------------------------------------------------------------------
# Per-endpoint wrappers
# ---------------------------------------------------------------------------

def fetch_nope(ticker: str, date_str: str | None = None) -> FetchResult:
    params = {"date": date_str} if date_str else None
    return _get(f"/api/stock/{ticker}/nope", params)


def fetch_max_pain(ticker: str) -> FetchResult:
    return _get(f"/api/stock/{ticker}/max-pain")


def fetch_greek_exposure(ticker: str) -> FetchResult:
    return _get(f"/api/stock/{ticker}/greek-exposure")


def fetch_oi_change(ticker: str, date_str: str | None = None) -> FetchResult:
    params = {"date": date_str} if date_str else None
    return _get(f"/api/stock/{ticker}/oi-change", params)


# ---------------------------------------------------------------------------
# Top-level orchestration
# ---------------------------------------------------------------------------

def fetch_for_ticker(ticker: str, date_str: str) -> dict[str, Any]:
    """Pull all four data feeds for one ticker."""
    out: dict[str, Any] = {
        "ticker": ticker,
        "nope": None,
        "max_pain": None,
        "greek_exposure": None,
        "oi_change": None,
        "failures": [],
    }

    r = fetch_nope(ticker, date_str)
    if r.ok:
        payload = r.data.get("data") if isinstance(r.data, dict) else r.data
        out["nope"] = payload if isinstance(payload, list) else []
    else:
        out["failures"].append({"endpoint": r.endpoint, "error": r.error})

    r = fetch_max_pain(ticker)
    if r.ok:
        payload = r.data.get("data") if isinstance(r.data, dict) else r.data
        out["max_pain"] = payload if isinstance(payload, list) else []
    else:
        out["failures"].append({"endpoint": r.endpoint, "error": r.error})

    r = fetch_greek_exposure(ticker)
    if r.ok:
        payload = r.data.get("data") if isinstance(r.data, dict) else r.data
        out["greek_exposure"] = payload if isinstance(payload, list) else []
    else:
        out["failures"].append({"endpoint": r.endpoint, "error": r.error})

    r = fetch_oi_change(ticker, date_str)
    if r.ok:
        payload = r.data.get("data") if isinstance(r.data, dict) else r.data
        out["oi_change"] = payload if isinstance(payload, list) else []
    else:
        out["failures"].append({"endpoint": r.endpoint, "error": r.error})

    return out


def fetch_all(tickers: list[str], date_str: str) -> dict[str, Any]:
    """Pull data for every ticker for `date_str`."""
    prev = _prev_market_day(date_str)
    out: dict[str, Any] = {
        "date": date_str,
        "prev_date": prev,
        "tickers": {},
        "data_quality": {
            "endpoints_ok": 0,
            "endpoints_failed": 0,
            "failures": [],
            "degraded": False,
        },
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }
    dq = out["data_quality"]

    for tkr in tickers:
        ticker_data = fetch_for_ticker(tkr, date_str)
        out["tickers"][tkr] = ticker_data
        # Per-ticker, 4 endpoints attempted
        n_failed = len(ticker_data["failures"])
        dq["endpoints_failed"] += n_failed
        dq["endpoints_ok"] += 4 - n_failed
        for f in ticker_data["failures"]:
            dq["failures"].append({**f, "ticker": tkr})

    dq["degraded"] = dq["endpoints_failed"] > 0
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--date", default=datetime.utcnow().strftime("%Y-%m-%d"))
    p.add_argument("--tickers", default="SPY,QQQ,IWM,NVDA,MSFT,AAPL,GOOGL,META,TSLA,AMZN")
    p.add_argument("--out", default=None)
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO)
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    payload = fetch_all(tickers, args.date)
    text = json.dumps(payload, indent=2, default=str)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
        print(f"wrote {args.out}  ok={payload['data_quality']['endpoints_ok']}  fail={payload['data_quality']['endpoints_failed']}")
    else:
        print(text[:3000])
