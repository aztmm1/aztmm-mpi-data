"""
AZTMM Earnings Flow Flag — fetcher

Pulls:
  1. The forward-window earnings calendar (next N trading days),
     intersecting the premarket + afterhours endpoints by date.
  2. Per-ticker recent flow-alerts for every name with earnings in the
     window, so the aggregator can flag names whose tape ran hot today.

All endpoints are server-side only. Source attribution never appears in
the public payload.

Probe results documented in README:
  - /api/earnings/afterhours?date=YYYY-MM-DD  -> {"data":[{symbol, report_date,
    report_time, sector, marketcap, has_options, is_s_p_500, street_mean_est, ...}]}
  - /api/earnings/premarket?date=YYYY-MM-DD   -> same shape with report_time=premarket
  - /api/option-trades/flow-alerts?ticker_symbol=T -> {"data":[{ticker, type,
    total_premium, total_size, expiry, strike, ...}]}
  - /api/market/economic-calendar             -> macro events only, NO earnings rows
    in current sample, so we deliberately use the dedicated earnings endpoints.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests
import yaml

logger = logging.getLogger("earnings_flow.fetcher")

ROOT = Path(__file__).parent
CONFIG_PATH = ROOT / "config.yml"

# Reusable connection-pooled session so we don't burn TLS handshake time
# on every per-ticker flow-alert call (123+ calls in a typical run).
_SESSION: requests.Session | None = None


def _session() -> requests.Session:
    global _SESSION
    if _SESSION is None:
        s = requests.Session()
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10, pool_maxsize=50, max_retries=0,
        )
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        _SESSION = s
    return _SESSION


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
    sess = _session()

    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            r = sess.get(url, headers=headers, params=params, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 404:
                logger.debug("404 for %s", url)
                return {}
            if r.status_code == 429:
                # Linear backoff capped at ~5s — exponential growth here
                # tanked the run when many concurrent workers hit the
                # rate ceiling at once. Smaller, predictable wait gets
                # us back in the throttle window quickly.
                wait = min(backoff * (attempt + 1), 5.0)
                logger.warning("429 for %s — sleeping %.1fs (attempt %d)", url, wait, attempt + 1)
                time.sleep(wait)
                last_err = RuntimeError("HTTP 429: rate limited")
                continue
            last_err = RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        except requests.RequestException as e:  # noqa: BLE001
            last_err = e
        time.sleep(backoff * (2 ** attempt))
    logger.warning("fetch failed for %s: %s", url, last_err)
    return {}


def _build_url(cfg: dict, endpoint_key: str) -> str:
    return cfg["http"]["base_url"] + cfg["endpoints"][endpoint_key]


# ---------------------------------------------------------------------------
# Trading-day window helpers
# ---------------------------------------------------------------------------

def _is_weekday(d: datetime) -> bool:
    return d.weekday() < 5


def forward_trading_dates(start: str, n: int, include_start: bool = False) -> list[str]:
    """
    Return up to `n` future trading dates (weekday-only) starting from `start`.
    If include_start is False, the start date itself is skipped.
    Holidays are approximated by weekday-only (no holiday calendar bundled
    here — the upstream endpoint simply returns empty data for holidays).
    """
    d = datetime.strptime(start, "%Y-%m-%d")
    out: list[str] = []
    if include_start and _is_weekday(d):
        out.append(d.strftime("%Y-%m-%d"))
    # Walk forward day by day; stop when we have n weekday entries
    cursor = d
    while len(out) < n:
        cursor = cursor + timedelta(days=1)
        if _is_weekday(cursor):
            out.append(cursor.strftime("%Y-%m-%d"))
    return out


# ---------------------------------------------------------------------------
# Earnings calendar — forward window
# ---------------------------------------------------------------------------

def fetch_earnings_for_date(cfg: dict, date: str) -> list[dict]:
    """
    Pull both premarket + afterhours earnings for the given date and
    return a merged list with `report_time` preserved.
    """
    merged: list[dict] = []
    for endpoint_key in ("earnings_premarket", "earnings_afterhours"):
        url = _build_url(cfg, endpoint_key)
        payload = _get_json(url, params={"date": date}, cfg=cfg)
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not rows:
            continue
        for r in rows:
            # ensure report_date matches the requested date (defensive)
            rd = r.get("report_date")
            if rd and rd != date:
                continue
            merged.append(r)
    return merged


def fetch_forward_earnings(cfg: dict, target_date: str) -> dict[str, list[dict]]:
    """
    Returns {date_str: [earnings_row, ...]} for the forward window.
    """
    n = int(cfg["window"]["forward_trading_days"])
    include_today = bool(cfg["window"]["include_today"])
    dates = forward_trading_dates(target_date, n, include_start=include_today)
    out: dict[str, list[dict]] = {}
    for d in dates:
        rows = fetch_earnings_for_date(cfg, d)
        out[d] = rows
        logger.info("earnings for %s: %d names", d, len(rows))
    return out


# ---------------------------------------------------------------------------
# Universe filter
# ---------------------------------------------------------------------------

def safe_float(v: Any) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def safe_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def passes_universe(row: dict, cfg: dict) -> bool:
    """
    Apply market-cap floor, ADV floor, has-options gate.

    Note: the earnings rows from afterhours/premarket include `marketcap`
    and `has_options` but not ADV directly. ADV is enforced later in
    the per-ticker flow check (where we have the open_interest /
    volume context) — here we apply the structural filters we have.
    """
    u = cfg["universe"]
    mc = safe_float(row.get("marketcap"))
    if mc and mc < u["min_marketcap_usd"]:
        return False
    if u.get("exclude_no_options", True):
        # `has_options` is sometimes None — treat None as unknown and let
        # the flow probe weed it out (no flow-alerts implies no options).
        if row.get("has_options") is False:
            return False
    return True


# ---------------------------------------------------------------------------
# Per-ticker flow alerts
# ---------------------------------------------------------------------------

def fetch_flow_alerts_for_ticker(cfg: dict, ticker: str, today: str) -> list[dict]:
    """
    Pull recent flow-alerts for the given ticker. We filter client-side
    to alerts whose `created_at` falls on `today` (ET-day, but the
    timestamp itself is UTC — we accept the loose window since the
    snapshot is end-of-day).
    """
    url = _build_url(cfg, "flow_alerts")
    limit = int(cfg["http"]["flow_alerts_limit"])
    params = {"ticker_symbol": ticker, "limit": limit}
    payload = _get_json(url, params=params, cfg=cfg)
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not rows:
        return []
    # Filter to today by created_at prefix (YYYY-MM-DD)
    today_rows: list[dict] = []
    for a in rows:
        ts = a.get("created_at") or ""
        if ts[:10] == today:
            today_rows.append(a)
    return today_rows


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def fetch_all(target_date: str, cfg: dict | None = None) -> dict:
    """
    Returns a raw bundle:
      {
        date: target_date,
        forward_window: [date_str, ...],
        earnings_by_date: { date: [earnings_rows] },
        universe_tickers: [T, ...],   # post-universe-filter set of upcoming reporters
        flow_alerts_by_ticker: { T: [alerts_today] },
        data_quality: { endpoints_ok, endpoints_failed, tickers_probed }
      }
    """
    cfg = cfg or _load_config()
    bundle: dict[str, Any] = {
        "date": target_date,
        "forward_window": [],
        "earnings_by_date": {},
        "universe_tickers": [],
        "flow_alerts_by_ticker": {},
        "data_quality": {"endpoints_ok": 0, "endpoints_failed": 0, "tickers_probed": 0},
    }

    # 1. Forward earnings calendar
    try:
        earnings_by_date = fetch_forward_earnings(cfg, target_date)
        bundle["forward_window"] = list(earnings_by_date.keys())
        bundle["earnings_by_date"] = earnings_by_date
        if any(rows for rows in earnings_by_date.values()):
            bundle["data_quality"]["endpoints_ok"] += 1
        else:
            bundle["data_quality"]["endpoints_failed"] += 1
    except Exception as e:  # noqa: BLE001
        logger.warning("earnings fetch failed: %s", e)
        bundle["data_quality"]["endpoints_failed"] += 1
        return bundle

    # 2. Universe filter + dedup of tickers across the window
    universe_set: dict[str, dict] = {}  # ticker -> earliest earnings row
    max_scan = int(cfg["universe"].get("max_names_scanned", 150))
    for d, rows in earnings_by_date.items():
        for r in rows:
            if not passes_universe(r, cfg):
                continue
            sym = (r.get("symbol") or "").upper().strip()
            if not sym:
                continue
            # Keep the earliest report_date entry per ticker
            if sym not in universe_set:
                annotated = dict(r)
                annotated["_report_date"] = d
                universe_set[sym] = annotated
            else:
                if d < universe_set[sym].get("_report_date", "9999-99-99"):
                    annotated = dict(r)
                    annotated["_report_date"] = d
                    universe_set[sym] = annotated

    # Sort by marketcap desc so the most-liquid names go first if we truncate
    sorted_pairs = sorted(
        universe_set.items(),
        key=lambda kv: (-safe_float(kv[1].get("marketcap")), kv[0])
    )
    if len(sorted_pairs) > max_scan:
        sorted_pairs = sorted_pairs[:max_scan]
        universe_set = dict(sorted_pairs)

    tickers = [k for k, _ in sorted_pairs]
    bundle["universe_tickers"] = tickers
    bundle["earnings_universe_meta"] = universe_set  # used later by aggregator

    # 3. Per-ticker flow probe — parallelized via thread pool. The session
    # is connection-pooled, the underlying requests are I/O-bound, and
    # the upstream is fine with 8 concurrent connections at this volume.
    # UW flow-alerts is per-second rate-limited; concurrent workers
    # caused hard 429s in testing. Serial walk with a small inter-call
    # delay is fastest in practice. ~0.15s per call * 130 calls ~= 20s.
    inter_call = max(0.0, float(cfg["http"].get("inter_call_sleep", 0)))
    for sym in tickers:
        try:
            alerts = fetch_flow_alerts_for_ticker(cfg, sym, target_date)
            bundle["flow_alerts_by_ticker"][sym] = alerts
            bundle["data_quality"]["tickers_probed"] += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("flow probe failed for %s: %s", sym, e)
            bundle["flow_alerts_by_ticker"][sym] = []
        if inter_call:
            time.sleep(inter_call)

    return bundle


if __name__ == "__main__":
    import json, sys, argparse
    p = argparse.ArgumentParser()
    p.add_argument("--date", required=True, help="YYYY-MM-DD target snapshot date")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO)
    bundle = fetch_all(args.date)
    # earnings_universe_meta is internal — strip from stdout for cleanliness
    out = dict(bundle)
    out.pop("earnings_universe_meta", None)
    json.dump(out, sys.stdout, indent=2, default=str)
