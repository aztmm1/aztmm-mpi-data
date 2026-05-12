"""
AZTMM 0DTE Pulse — fetcher

Pulls today's 0DTE notable options flow + total-options-volume context.
All endpoints are server-side only. Output structure is intentionally
opaque about source attribution — only the aggregator sees endpoint names.

The upstream "?dte=0" filter on the flow-alerts endpoint is unreliable
(it returns mixed expiries). We therefore page through recent flow
alerts and filter client-side on `expiry == target_date`. This is the
authoritative 0DTE definition.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any

import requests
import yaml

logger = logging.getLogger("zerodte.fetcher")

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
            if r.status_code == 404:
                logger.debug("404 for %s", url)
                return {}
            if r.status_code == 429:
                wait = backoff * (4 ** attempt)
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
# 0DTE flow alerts — paginated
# ---------------------------------------------------------------------------

def fetch_zerodte_alerts(cfg: dict, target_date: str) -> list[dict]:
    """
    Page through recent flow-alerts and keep only those whose expiry
    matches `target_date`. The upstream dte filter is unreliable, so we
    rely on client-side date matching against the `expiry` field.
    """
    url = _build_url(cfg, "flow_alerts")
    page_limit = int(cfg["http"]["page_limit"])
    max_pages = int(cfg["http"]["max_pages"])

    kept: list[dict] = []
    seen_ids: set[str] = set()

    # Strategy: fetch sequential pages using ascending offset where supported,
    # or just one large pull if the API caps the page. We try with no offset
    # first and rely on `min_premium` paging if needed.
    for page in range(max_pages):
        params: dict[str, Any] = {"limit": page_limit}
        # On pages > 0, walk older by using `older_than` if supported via
        # the timestamp of the last row we saw. Some UW endpoints expose
        # an `older_than` ms param — pass it best-effort.
        if page > 0 and kept:
            try:
                oldest_ms = min(int(r.get("start_time") or 0) for r in kept)
                if oldest_ms > 0:
                    params["older_than"] = oldest_ms
            except Exception:  # noqa: BLE001
                pass

        payload = _get_json(url, params=params, cfg=cfg)
        rows = payload.get("data") or []
        if not rows:
            break

        added_this_page = 0
        for r in rows:
            rid = r.get("id")
            if not rid or rid in seen_ids:
                continue
            seen_ids.add(rid)
            if r.get("expiry") == target_date:
                kept.append(r)
                added_this_page += 1

        # If we got a full page but added nothing 0DTE for two iterations,
        # we've likely walked past today's tape.
        if added_this_page == 0 and page >= 1:
            break

    logger.info("fetched %d 0DTE alerts for %s", len(kept), target_date)
    return kept


# ---------------------------------------------------------------------------
# Total options volume — market-wide
# ---------------------------------------------------------------------------

def fetch_total_options_volume(cfg: dict, target_date: str) -> dict:
    """
    Returns the most recent total options volume row, with an indicator
    of whether it matches the target date.
    """
    url = _build_url(cfg, "total_options_vol")
    payload = _get_json(url, cfg=cfg)
    rows = payload.get("data") or []
    if not rows:
        return {}
    # Prefer row matching target_date, else most recent.
    matching = [r for r in rows if r.get("date") == target_date]
    row = matching[0] if matching else rows[0]
    return {
        "date": row.get("date"),
        "call_volume": _safe_int(row.get("call_volume")),
        "put_volume": _safe_int(row.get("put_volume")),
        "call_premium": _safe_float(row.get("call_premium")),
        "put_premium": _safe_float(row.get("put_premium")),
        "matched_target_date": bool(matching),
    }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def fetch_all(target_date: str, cfg: dict | None = None) -> dict:
    """
    Returns a raw bundle with today's 0DTE flow alerts + market-wide
    options volume context.
    """
    cfg = cfg or _load_config()

    bundle: dict[str, Any] = {
        "date": target_date,
        "alerts": [],
        "market_volume": {},
        "data_quality": {"endpoints_ok": 0, "endpoints_failed": 0},
    }

    # 1) 0DTE alerts
    try:
        alerts = fetch_zerodte_alerts(cfg, target_date)
        bundle["alerts"] = alerts
        bundle["data_quality"]["endpoints_ok"] += 1
    except Exception as e:  # noqa: BLE001
        logger.warning("0DTE alerts fetch failed: %s", e)
        bundle["data_quality"]["endpoints_failed"] += 1

    # 2) Market-wide options volume
    try:
        mv = fetch_total_options_volume(cfg, target_date)
        bundle["market_volume"] = mv
        if mv:
            bundle["data_quality"]["endpoints_ok"] += 1
        else:
            bundle["data_quality"]["endpoints_failed"] += 1
    except Exception as e:  # noqa: BLE001
        logger.warning("market volume fetch failed: %s", e)
        bundle["data_quality"]["endpoints_failed"] += 1

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
    logging.basicConfig(level=logging.INFO)
    bundle = fetch_all(args.date)
    json.dump(bundle, sys.stdout, indent=2, default=str)
