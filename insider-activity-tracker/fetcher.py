"""
AZTMM Insider Activity — fetcher

Pulls the trailing-7-day window of Form 4 insider transactions ending on
the target Friday. All endpoints are server-side only — endpoint names
and source attribution never appear in the public payload.

The upstream `start_date` / `end_date` query filters work, so we use
them to bound the page-walk. Pagination is via `?page=N` (server-capped
at limit=500, has_more flag terminates).

If the primary endpoint is completely unavailable, an SEC EDGAR Form 4
RSS pull serves as a degraded-data fallback (returns the most-recent
filings list with reduced fields).
"""
from __future__ import annotations

import logging
import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests
import yaml

logger = logging.getLogger("insider.fetcher")

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
# Week window helper
# ---------------------------------------------------------------------------

def week_window(week_ending: str, trailing_days: int = 7) -> tuple[str, str]:
    """
    Returns (start_date, end_date) inclusive YYYY-MM-DD strings for the
    trailing-N-day window ending on `week_ending`.
    """
    end = datetime.strptime(week_ending, "%Y-%m-%d").date()
    start = end - timedelta(days=trailing_days - 1)
    return start.isoformat(), end.isoformat()


# ---------------------------------------------------------------------------
# Insider transactions — paginated, week-bounded
# ---------------------------------------------------------------------------

def fetch_insider_transactions(cfg: dict, week_ending: str) -> list[dict]:
    """
    Walk pages of /api/insider/transactions filtered to the trailing-7-day
    window. Dedup on row `id`. Returns the raw list.

    Note: the upstream server-side date filter is sometimes loose
    (returns some rows just outside the window), so we re-filter
    client-side on `transaction_date` strictly within [start, end].
    """
    url = _build_url(cfg, "insider_transactions")
    page_limit = int(cfg["http"]["page_limit"])
    max_pages = int(cfg["http"]["max_pages"])
    trailing_days = int(cfg["period"]["trailing_days"])

    start, end = week_window(week_ending, trailing_days)
    kept: list[dict] = []
    seen_ids: set[str] = set()

    for page in range(1, max_pages + 1):
        params: dict[str, Any] = {
            "limit": page_limit,
            "start_date": start,
            "end_date": end,
            "page": page,
        }
        payload = _get_json(url, params=params, cfg=cfg)
        rows = payload.get("data") or []
        if not rows:
            break

        added_this_page = 0
        all_outside = True
        for r in rows:
            rid = r.get("id")
            if not rid or rid in seen_ids:
                continue
            seen_ids.add(rid)
            tdate = r.get("transaction_date")
            if not tdate:
                continue
            if start <= tdate <= end:
                kept.append(r)
                added_this_page += 1
                all_outside = False
            else:
                # row outside window — don't keep, but record that
                # not everything on this page was outside
                pass

        has_more = payload.get("has_more")
        # Stop when server says no more, or we paged past the window
        # entirely (all rows older than start).
        if not has_more:
            break
        if all_outside and added_this_page == 0 and page > 1:
            break

    logger.info(
        "fetched %d insider transactions for week ending %s (window %s..%s)",
        len(kept), week_ending, start, end,
    )
    return kept


# ---------------------------------------------------------------------------
# SEC EDGAR fallback (degraded mode)
# ---------------------------------------------------------------------------

def fetch_edgar_fallback(cfg: dict) -> list[dict]:
    """
    Degraded-mode pull: SEC EDGAR Form-4 atom feed. Only used when the
    primary endpoint is fully down. Returns minimal-shape rows.
    """
    fb = cfg.get("fallback", {})
    url = fb.get("sec_edgar_atom")
    if not url:
        return []
    try:
        r = requests.get(
            url,
            headers={"User-Agent": fb.get("user_agent", "AZTMM-tracker")},
            timeout=cfg["http"]["timeout_seconds"],
        )
        if r.status_code != 200:
            logger.warning("EDGAR fallback HTTP %d", r.status_code)
            return []
        root = ET.fromstring(r.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        out: list[dict] = []
        for entry in root.findall("atom:entry", ns):
            title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
            updated = (entry.findtext("atom:updated", default="", namespaces=ns) or "").strip()
            out.append({
                "id": f"edgar:{updated}:{title[:60]}",
                "ticker": None,
                "owner_name": None,
                "transaction_date": updated[:10] if updated else None,
                "transaction_code": None,
                "amount": None,
                "price": None,
                "marketcap": None,
                "sector": None,
                "is_director": None,
                "is_officer": None,
                "is_ten_percent_owner": None,
                "officer_title": None,
                "edgar_title": title,
                "source": "edgar-fallback",
            })
        logger.info("EDGAR fallback returned %d entries", len(out))
        return out
    except Exception as e:  # noqa: BLE001
        logger.warning("EDGAR fallback failed: %s", e)
        return []


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def fetch_all(week_ending: str, cfg: dict | None = None) -> dict:
    """
    Returns a raw bundle of insider transactions for the trailing-7-day
    window ending on `week_ending` (YYYY-MM-DD, expected Friday).
    """
    cfg = cfg or _load_config()
    start, end = week_window(week_ending, cfg["period"]["trailing_days"])

    bundle: dict[str, Any] = {
        "week_ending": week_ending,
        "window_start": start,
        "window_end": end,
        "transactions": [],
        "fallback_used": False,
        "data_quality": {"endpoints_ok": 0, "endpoints_failed": 0},
    }

    try:
        rows = fetch_insider_transactions(cfg, week_ending)
        bundle["transactions"] = rows
        if rows:
            bundle["data_quality"]["endpoints_ok"] += 1
        else:
            bundle["data_quality"]["endpoints_failed"] += 1
    except Exception as e:  # noqa: BLE001
        logger.warning("primary fetch failed: %s", e)
        bundle["data_quality"]["endpoints_failed"] += 1

    # Only invoke EDGAR fallback if primary returned literally zero rows
    if not bundle["transactions"]:
        edgar_rows = fetch_edgar_fallback(cfg)
        if edgar_rows:
            bundle["transactions"] = edgar_rows
            bundle["fallback_used"] = True

    return bundle


# ---------------------------------------------------------------------------
# Type coercion helpers
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


if __name__ == "__main__":
    import json, sys, argparse
    p = argparse.ArgumentParser()
    p.add_argument("--week-ending", required=True, help="YYYY-MM-DD (Friday)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO)
    bundle = fetch_all(args.week_ending)
    json.dump(bundle, sys.stdout, indent=2, default=str)
