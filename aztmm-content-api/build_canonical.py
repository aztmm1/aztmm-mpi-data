#!/usr/bin/env python3
"""
AZTMM Canonical Content API — generator

Single source of truth for every value the public site renders. Composes
data from mpi.json, tracker latest.json files, and the WP REST pulse feed
into one JSON document served from jsDelivr at:

    https://cdn.jsdelivr.net/gh/aztmm1/aztmm-mpi-data@main/data/canonical-content.json

Designed to be called as the final step of every EOD workflow (mpi-update,
daily-pulse-v2, weekly-pulse, congress-watch, options-gravity, earnings-flow,
insider-activity, squeeze-watch). Idempotent — safe to re-run.

Backwards-compat: every field is best-effort; if a source is missing, the
field is omitted rather than raising, so the hydrator falls back to the
page's hardcoded default.

Usage:
    python build_canonical.py --repo-root . --output data/canonical-content.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("canonical")

SCHEMA_VERSION = "1.0"

WP_SITE = "aztmm.com"
WP_POSTS = f"https://{WP_SITE}/wp-json/wp/v2/posts"
CAT_DAILY = 730419628
CAT_WEEKLY = 730419629

TRACKER_PATHS = {
    "congress_watch": "congress-trades-tracker/sample-output/latest.json",
    "options_gravity": "nope-max-pain-tracker/sample-output/latest.json",
    "earnings_flow": "earnings-flow-flag-tracker/sample-output/latest.json",
    "insider_activity": "insider-activity-tracker/sample-output/latest.json",
    "squeeze_watch": "squeeze-watch/sample-output/latest.json",
}


def _http_get_json(url: str, timeout: int = 15) -> Any | None:
    try:
        # 2026-08-05: WP.com edge-caches /wp-json responses and jsDelivr edge-caches
        # raw files. Without a cache buster this can read a stale page and pin
        # latest_daily_pulse to the previous day's post. Observed 2026-08-05: the
        # 23:00Z and 23:59Z runs both wrote post 3267 even though 3274 had been
        # live since 21:16Z, so the homepage advertised the prior day's condensed
        # fallback edition for five hours.
        sep = "&" if "?" in url else "?"
        bust = f"{sep}_cb={int(dt.datetime.now(dt.timezone.utc).timestamp())}"
        req = urllib.request.Request(url + bust, headers={
            "User-Agent": "aztmm-canonical/1.0",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError) as e:
        log.warning("GET %s failed: %s", url, e)
        return None


def _read_local_json(repo_root: Path, rel: str) -> Any | None:
    p = repo_root / rel
    if not p.exists():
        log.warning("missing: %s", p)
        return None
    try:
        return json.loads(p.read_text())
    except Exception as e:  # noqa: BLE001
        log.warning("parse %s failed: %s", p, e)
        return None


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s or "").replace(" ", " ").strip()


def _truncate(s: str, n: int = 280) -> str:
    s = (s or "").strip()
    if len(s) <= n:
        return s
    return s[: n - 1].rsplit(" ", 1)[0] + "…"


def build_mpi(mpi_doc: dict | None) -> dict | None:
    if not isinstance(mpi_doc, dict):
        return None
    d = mpi_doc.get("data") or {}
    conf = (d.get("confidence") or {})
    score = d.get("mpi_score")
    regime = d.get("regime_label") or d.get("regime") or d.get("mpi_label")
    regime = {"Sideways": "Neutral", "Bear": "Crisis"}.get(regime, regime)
    if score is None or regime is None:
        return None
    out = {
        "score": int(round(score)) if isinstance(score, (int, float)) else score,
        "regime": regime,
        "as_of": mpi_doc.get("asOf"),
        "computed_at": mpi_doc.get("computed_at"),
    }
    # 85% CI -> 0.85 confidence number for downstream consumers
    ci_level = conf.get("ci_level")
    if isinstance(ci_level, str) and ci_level.endswith("%"):
        try:
            out["confidence"] = round(int(ci_level.rstrip("%")) / 100, 2)
        except ValueError:
            pass
    if conf.get("ci_low") is not None and conf.get("ci_high") is not None:
        out["confidence_band"] = [conf["ci_low"], conf["ci_high"]]
    return out


def build_market(mpi_doc: dict | None) -> dict | None:
    if not isinstance(mpi_doc, dict):
        return None
    d = mpi_doc.get("data") or {}
    market = d.get("market") or {}
    vol = d.get("volatility") or {}
    out: dict[str, Any] = {}
    if market.get("spy_spot") is not None:
        out["spy_close"] = market["spy_spot"]
    if vol.get("vix") is not None:
        out["vix"] = vol["vix"]
    if vol.get("realized_vol_20d_pct") is not None:
        out["rv_30d"] = vol["realized_vol_20d_pct"]  # 20d is the closest available proxy
    if vol.get("vrp") is not None:
        out["vrp"] = vol["vrp"]
    # SPY week pct: not directly in mpi.json; compute later or leave out
    return out or None


def _wp_pulse(category: int) -> list[dict]:
    url = f"{WP_POSTS}?categories={category}&per_page=5&_fields=id,date,link,title,excerpt,slug"
    docs = _http_get_json(url)
    if not docs:  # one retry after a short pause -- WP.com edge flakes on back-to-back hits
        import time
        time.sleep(5)
        docs = _http_get_json(url)
    docs = docs or []
    out = []
    for p in docs:
        title = _strip_html((p.get("title") or {}).get("rendered", ""))
        snippet = _truncate(_strip_html((p.get("excerpt") or {}).get("rendered", "")))
        # WP returns ISO local-time without TZ; truncate to YYYY-MM-DD
        date_iso = (p.get("date") or "")[:10]
        out.append({
            "id": p.get("id"),
            "url": p.get("link"),
            "title": title,
            "date": date_iso,
            "snippet": snippet,
            "kind": "daily" if category == CAT_DAILY else "weekly",
        })
    return out


def build_pulses() -> tuple[dict | None, dict | None, list[dict]]:
    daily = _wp_pulse(CAT_DAILY)
    weekly = _wp_pulse(CAT_WEEKLY)
    latest_daily = daily[0] if daily else None
    latest_weekly = weekly[0] if weekly else None
    # merged recents (deduped by id, newest-first by date)
    merged: list[dict] = []
    seen: set[int] = set()
    for p in sorted(daily + weekly, key=lambda x: x.get("date") or "", reverse=True):
        pid = p.get("id")
        if pid in seen:
            continue
        seen.add(pid)
        merged.append(p)
        if len(merged) >= 5:
            break
    return latest_daily, latest_weekly, merged


def _as_of_from_tracker(doc: dict) -> str | None:
    # Prefer human-friendly as_of, fall back to as_of_date / date / week_ending
    for k in ("as_of", "as_of_date", "asof", "date", "week_ending", "generated_at"):
        v = doc.get(k)
        if isinstance(v, str) and v:
            return v
    return None


def _snippet_from_tracker(name: str, doc: dict) -> str | None:
    # Each tracker exposes different fields; pick whichever is most readable.
    if name == "congress_watch":
        s = doc.get("summary") or {}
        n = s.get("filings_today")
        if n is not None:
            return f"{int(n)} new Periodic Transaction Report filings today."
    if name == "options_gravity":
        # nope/max-pain — dashboard.html.j2 will have richer text; fall back to label
        return doc.get("methodology") or "EOD NOPE + max-pain snapshot."
    if name == "earnings_flow":
        s = _truncate(doc.get("summary_line") or doc.get("watching_line") or "")
        if s:
            return s
        cnt = doc.get("count")
        if cnt is not None:
            return f"{int(cnt)} names flagged in the EOD earnings-flow screen."
    if name == "insider_activity":
        return _truncate(doc.get("summary_line") or "")
    if name == "squeeze_watch":
        # Has summary_line in some runs; fall back to a generic
        if doc.get("summary_line"):
            return _truncate(doc["summary_line"])
        cnt = doc.get("count")
        if cnt is not None:
            return f"{int(cnt)} names cleared the squeeze screen today."
    return None


def build_trackers(repo_root: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for name, rel in TRACKER_PATHS.items():
        doc = _read_local_json(repo_root, rel)
        if not isinstance(doc, dict):
            continue
        rec: dict[str, Any] = {}
        as_of = _as_of_from_tracker(doc)
        if as_of:
            rec["as_of"] = as_of
        snippet = _snippet_from_tracker(name, doc)
        if snippet:
            rec["snippet"] = snippet
        if rec:
            out[name] = rec
    return out


def compose(repo_root: Path) -> dict:
    prev = _read_local_json(repo_root, "data/canonical-content.json") or {}
    mpi_doc = _read_local_json(repo_root, "data/mpi.json")
    if mpi_doc is None:
        # Fall back to jsDelivr if not in repo (e.g. running outside CI checkout)
        mpi_doc = _http_get_json(
            "https://cdn.jsdelivr.net/gh/aztmm1/aztmm-mpi-data@main/data/mpi.json"
        )

    latest_daily, latest_weekly, recent = build_pulses()

    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    mpi = build_mpi(mpi_doc)
    if mpi:
        payload["mpi"] = mpi
    market = build_market(mpi_doc)
    if market:
        payload["market"] = market
    if latest_daily:
        payload["latest_daily_pulse"] = latest_daily
    elif prev.get("latest_daily_pulse"):
        payload["latest_daily_pulse"] = prev["latest_daily_pulse"]
        log.warning("daily fetch empty -- carried forward previous latest_daily_pulse")
    if latest_weekly:
        payload["latest_weekly_pulse"] = latest_weekly
    elif prev.get("latest_weekly_pulse"):
        payload["latest_weekly_pulse"] = prev["latest_weekly_pulse"]
        log.warning("weekly fetch empty -- carried forward previous latest_weekly_pulse")
    if recent:
        payload["recent_pulses"] = recent
    elif prev.get("recent_pulses"):
        payload["recent_pulses"] = prev["recent_pulses"]
    trackers = build_trackers(repo_root)
    if trackers:
        payload["trackers"] = trackers
    return payload


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", default=".", help="Path to repo root (default: cwd)")
    ap.add_argument("--output", default="data/canonical-content.json",
                    help="Output path relative to repo-root")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo_root).resolve()
    if not repo_root.exists():
        log.error("repo-root does not exist: %s", repo_root)
        return 1

    payload = compose(repo_root)
    out_path = repo_root / args.output
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, default=str))
    log.info("wrote %s (%d bytes, %d top-level keys)",
             out_path, out_path.stat().st_size, len(payload))
    sys.stdout.write(json.dumps({
        "ok": True,
        "output": str(out_path),
        "keys": sorted(payload.keys()),
        "mpi_score": (payload.get("mpi") or {}).get("score"),
    }) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
