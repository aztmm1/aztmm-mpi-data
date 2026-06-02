#!/usr/bin/env python3
"""
AZTMM MPI + HMM Auto-Update Pipeline
=====================================

Computes the daily Market Pulse Index (MPI), 3-state Gaussian HMM regime label,
and Pulse Compass probabilities from FREE public data sources only:

  * FRED API (yields, credit spreads, M2, dollar)        — needs free FRED_API_KEY
  * StockAnalysis.com (SPY/QQQ/sectors/UUP=DXY proxy)     — no key, no rate limit
  * CBOE EOD CSV (^VIX, ^VIX3M)                           — no key, public CDN
  * yfinance (legacy fallback only)                       — no key, often blocked from CI
  * CBOE daily put/call CSV                              — no key (web scrape)
  * AAII weekly sentiment (best-effort, Wed cadence)     — no key (web scrape)
  * CNN Fear & Greed JSON endpoint                       — no key

Output JSON conforms to the existing seed schema (schema_version 2.0).

Schedule self-gates on America/New_York clock:
  * Pre-market window  : 09:00 - 09:30 ET
  * Post-close window  : 16:00 - 16:50 ET
  * Mon-Fri only, NYSE-holiday aware (pandas_market_calendars)

Failsafe model: any source 5xx/timeout sets data_quality="degraded" and the
field falls back to the previous published value (read from the existing
on-disk mpi.json). Script never raises; every error is logged and written
into a `warnings` list in the output JSON.

Usage
-----
  python mpi_hmm_pipeline.py                 # full run, write data/mpi.json
  python mpi_hmm_pipeline.py --dry-run       # compute + print, no write
  python mpi_hmm_pipeline.py --mock          # use canned data, no network
  python mpi_hmm_pipeline.py --force         # ignore time/holiday gate
  python mpi_hmm_pipeline.py --output PATH   # custom output path
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import math
import os
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

# Optional heavy deps: import lazily so --mock works without them
try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None  # type: ignore

try:
    import pandas as pd
except Exception:
    pd = None  # type: ignore

try:
    import requests
except Exception:
    requests = None  # type: ignore


# ---------------------------------------------------------------------------
# Constants & configuration
# ---------------------------------------------------------------------------

NY_TZ = ZoneInfo("America/New_York")
UTC = timezone.utc

# Run windows (ET). Morning 09:00-09:30 uses prior-session close.
# Evening 17:55-18:30 is the post-close EOD slot (moved from 16:00-16:50
# on 2026-05-14 because SA/CBOE EOD bars publish ~17:30-21:51 ET).
WINDOWS_ET = [(9, 0, 9, 30), (17, 55, 18, 30)]  # (h_lo, m_lo, h_hi, m_hi)

# FRED series IDs — see https://fred.stlouisfed.org/
FRED_SERIES = {
    "dgs10":   "DGS10",          # 10-year Treasury
    "dgs2":    "DGS2",           # 2-year Treasury
    "t10y2y":  "T10Y2Y",         # 10y-2y spread
    "hy_oas":  "BAMLH0A0HYM2",   # ICE BofA US High Yield OAS
    "ig_oas":  "BAMLC0A0CM",     # ICE BofA US Corporate OAS
    "vixcls":  "VIXCLS",         # VIX EOD (backup)
    "dxy":     "DTWEXBGS",       # Trade-weighted broad dollar
    "m2":      "M2SL",           # M2 (monthly, for liquidity proxy trend)
}

# yfinance tickers (Yahoo symbols)
YF_INDICES = {
    "spy":   "SPY",
    "qqq":   "QQQ",
    "iwm":   "IWM",
    "vix":   "^VIX",
    "vix3m": "^VIX3M",
    "vix9d": "^VIX9D",
    "vvix":  "^VVIX",
    "skew":  "^SKEW",
    "dxy":   "DX-Y.NYB",
    "crude": "CL=F",
    "gold":  "GC=F",
}

# Sector ETFs for rotation sleeve
SECTORS = {
    "xlu": "XLU",  # utilities (defensive)
    "xlp": "XLP",  # staples (defensive)
    "xlv": "XLV",  # health care (defensive-ish)
    "xly": "XLY",  # discretionary (cyclical)
    "xlk": "XLK",  # tech (cyclical)
    "xlf": "XLF",  # financials (cyclical)
    "xli": "XLI",  # industrials (cyclical)
}


# ---------------------------------------------------------------------------
# Market data adapters (replacing yfinance for CI reliability)
# ---------------------------------------------------------------------------
# StockAnalysis.com serves a free no-auth JSON history endpoint that works
# from GH Actions runner IPs (yfinance is consistently 429'd from CI).
# CBOE EOD CSVs cover ^VIX and ^VIX3M (StockAnalysis lacks index symbols).
# UUP (Invesco DB Dollar Bullish ETF) is used as a DX-Y.NYB proxy, since
# the score_currency function only consumes Close + 50d MA.
SA_BASE_URL = "https://stockanalysis.com/api/symbol/s/{sym}/history"
SA_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}
# Map "label expected by scorers" -> "StockAnalysis lookup symbol"
SA_TICKERS_MAIN: Dict[str, str] = {
    "SPY":  "SPY",
    "QQQ":  "QQQ",
    "IWM":  "IWM",
    "XLU":  "XLU",
    "XLP":  "XLP",
    "XLV":  "XLV",
    "XLY":  "XLY",
    "XLK":  "XLK",
    "XLF":  "XLF",
    "XLI":  "XLI",
    "DX-Y.NYB": "UUP",  # ETF proxy for the dollar
}
CBOE_VIX_URL    = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv"
CBOE_VIX3M_URL  = "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv"


def _sa_history(symbol: str, range_: str = "5Y", retries: int = 2) -> Optional["pd.DataFrame"]:
    """Fetch daily OHLC history from StockAnalysis.com. Returns None on fail."""
    if pd is None:
        return None
    url = SA_BASE_URL.format(sym=symbol.lower()) + f"?range={range_}&period=Daily"
    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            import urllib.request
            req = urllib.request.Request(url, headers=SA_HEADERS)
            with urllib.request.urlopen(req, timeout=20) as r:
                text = r.read().decode("utf-8")
            j = json.loads(text)
            if j.get("status") != 200 or not j.get("data"):
                last_err = RuntimeError(f"non-200 payload: {str(j)[:120]}")
                continue
            rows = j["data"]
            df = pd.DataFrame(rows)
            df["Date"] = pd.to_datetime(df["t"])
            df = df.rename(columns={
                "o": "Open", "h": "High", "l": "Low", "c": "Close", "v": "Volume",
            })
            df = df[["Date", "Open", "High", "Low", "Close", "Volume"]]
            df = df.set_index("Date").sort_index()
            return df
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(0.4 * (attempt + 1))
    log.warning("StockAnalysis %s fetch failed: %s", symbol, last_err)
    return None


def _cboe_index_history(url: str) -> Optional["pd.DataFrame"]:
    """Fetch a CBOE EOD index CSV (VIX, VIX3M, etc) -> OHLC DataFrame."""
    if pd is None:
        return None
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={"User-Agent": SA_HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8")
        df = pd.read_csv(io.StringIO(text))
        df.columns = [c.strip().upper() for c in df.columns]
        date_col = "DATE" if "DATE" in df.columns else df.columns[0]
        close_col = "CLOSE" if "CLOSE" in df.columns else df.columns[-1]
        df["Date"] = pd.to_datetime(df[date_col], errors="coerce")
        df = df.dropna(subset=["Date"])
        df = df.rename(columns={close_col: "Close"})
        for src_col, dst_col in (("OPEN", "Open"), ("HIGH", "High"), ("LOW", "Low")):
            if src_col in df.columns:
                df = df.rename(columns={src_col: dst_col})
        for col in ("Open", "High", "Low"):
            if col not in df.columns:
                df[col] = df["Close"]
        df["Volume"] = 0
        df = df.set_index("Date").sort_index()
        return df[["Open", "High", "Low", "Close", "Volume"]]
    except Exception as e:  # noqa: BLE001
        log.warning("CBOE %s fetch failed: %s", url, e)
        return None



# CBOE daily put/call CSV — public download, no key
CBOE_PUTCALL_URL = (
    "https://cdn.cboe.com/data/us/options/market_statistics/daily/"
    "equity_pc_ratio_history.csv"
)

# CNN Fear & Greed — internal JSON endpoint, no key
CNN_FG_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
CNN_FG_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AZTMM-MPI/1.0; +https://aztmm.com)"
}

# AAII weekly sentiment — best-effort. The official .xls download requires
# session cookies; we use a community CSV mirror as primary, fall back to None.
AAII_CSV_FALLBACK = (
    "https://raw.githubusercontent.com/psinopoli/AAII-Sentiment/master/"
    "sentiment.csv"
)

SCHEMA_VERSION = "2.0"
STALE_THRESHOLD_HOURS = 18

# Sub-indicator weights (sum to 1.0). Tunable.
MPI_WEIGHTS = {
    "trend":      0.15,
    "breadth":    0.10,
    "volatility": 0.15,
    "yield_curve": 0.10,
    "credit":     0.10,
    "sentiment":  0.15,
    "rotation":   0.10,
    "currency":   0.05,
    "liquidity":  0.10,
}
assert abs(sum(MPI_WEIGHTS.values()) - 1.0) < 1e-9, "MPI weights must sum to 1"


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
def _tg_notify(text: str) -> None:
    """Best-effort Telegram notification — never raises. Reads creds from env or
    a local .telegram_creds file. Silently no-ops if creds missing."""
    try:
        import os as _os, urllib.parse as _up, urllib.request as _ur
        token = _os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        chat = _os.environ.get("TELEGRAM_CHAT_ID", "").strip()
        if not token or not chat:
            # Try loading from a sibling file path (GitHub Actions can write it)
            for cred_path in (".telegram_creds", _os.path.expanduser("~/.telegram_creds")):
                if _os.path.isfile(cred_path):
                    with open(cred_path) as _f:
                        for line in _f:
                            if line.startswith("TELEGRAM_BOT_TOKEN="):
                                token = line.split("=", 1)[1].strip()
                            elif line.startswith("TELEGRAM_CHAT_ID="):
                                chat = line.split("=", 1)[1].strip()
                    if token and chat:
                        break
        if not token or not chat:
            return  # silent no-op when no creds
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        data = _up.urlencode({"chat_id": chat, "text": text}).encode()
        req = _ur.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        _ur.urlopen(req, timeout=5).read()
    except Exception:
        pass  # never raise from notification path


log = logging.getLogger("mpi_hmm")


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------

def _compute_data_quality(ctx: "RunContext") -> str:
    """Honest data_quality flag based on degraded state and warning count.

    - degraded (hard failure flagged via ctx.degrade) -> "degraded"
    - 3+ warnings -> "degraded"
    - 1-2 warnings -> "partial"
    - 0 warnings -> "ok"
    """
    if getattr(ctx, "degraded", False):
        return "degraded"
    n = len(getattr(ctx, "warnings", []) or [])
    if n >= 3:
        return "degraded"
    if n >= 1:
        return "partial"
    return "ok"



@dataclass
class RunContext:
    now_utc: datetime
    now_et:  datetime
    warnings: List[str] = field(default_factory=list)
    degraded: bool = False
    last_good: Optional[Dict[str, Any]] = None

    def warn(self, msg: str) -> None:
        log.warning(msg)
        self.warnings.append(msg)

    def degrade(self, msg: str) -> None:
        self.warn("DEGRADED: " + msg)
        self.degraded = True


# ---------------------------------------------------------------------------
# Utility: HTTP w/ retry
# ---------------------------------------------------------------------------

def _http_get(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 15.0,
    retries: int = 2,
) -> Optional[bytes]:
    if requests is None:
        return None
    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, headers=headers or {}, timeout=timeout)
            if 200 <= r.status_code < 300:
                return r.content
            last_err = RuntimeError(f"{url} -> HTTP {r.status_code}")
        except Exception as e:  # noqa: BLE001
            last_err = e
        time.sleep(1.5 * (attempt + 1))
    log.warning("GET failed for %s: %s", url, last_err)
    return None


# ---------------------------------------------------------------------------
# Source loaders
# ---------------------------------------------------------------------------

def _load_fred(ctx: RunContext) -> Dict[str, Optional[float]]:
    """Pull recent FRED series via fredapi. Returns latest values per key."""
    out: Dict[str, Optional[float]] = {k: None for k in FRED_SERIES}
    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        ctx.degrade("FRED_API_KEY not set; macro sleeve will use last-good")
        return out
    try:
        from fredapi import Fred  # type: ignore
        fred = Fred(api_key=api_key)
        for k, sid in FRED_SERIES.items():
            try:
                s = fred.get_series(sid)
                if s is None or s.dropna().empty:
                    ctx.warn(f"FRED {sid}: empty series")
                    continue
                out[k] = float(s.dropna().iloc[-1])
            except Exception as e:  # noqa: BLE001
                ctx.warn(f"FRED {sid} fetch failed: {e}")
    except Exception as e:  # noqa: BLE001
        ctx.degrade(f"fredapi import/connect failed: {e}")
    return out


def _load_yfinance_fallback(ctx: RunContext) -> Dict[str, Any]:
    """Legacy yfinance path. Used as fallback if StockAnalysis+CBOE fails.

    yfinance is unreliable from GitHub Actions IPs (HTTP 429), so we try
    StockAnalysis.com + CBOE first via _load_market_data, and only fall
    back here if the primary source returns nothing usable.
    """
    out: Dict[str, Any] = {}
    try:
        import yfinance as yf  # type: ignore
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"yfinance import failed (fallback unavailable): {e}")
        return out

    tickers = list(YF_INDICES.values()) + list(SECTORS.values())
    try:
        df = yf.download(
            tickers=" ".join(tickers),
            period="2y",
            interval="1d",
            progress=False,
            auto_adjust=True,
            group_by="ticker",
            threads=True,
        )
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"yfinance fallback download failed: {e}")
        return out

    if df is None or len(df) == 0:
        ctx.warn("yfinance fallback returned empty frame")
        return out

    out["raw"] = df
    out["latest"] = {}
    level0 = list(df.columns.get_level_values(0))
    for nice, sym in {**YF_INDICES, **SECTORS}.items():
        try:
            if sym not in level0:
                continue
            close = df[sym]["Close"].dropna()
            if close.empty:
                continue
            val = float(close.iloc[-1])
            if math.isnan(val):
                continue
            out["latest"][nice] = val
        except Exception:  # noqa: BLE001
            continue
    return out


def _load_market_data(ctx: RunContext) -> Dict[str, Any]:
    """Primary equities/ETF + VIX loader.

    Pulls SPY/QQQ/IWM/sector ETFs/UUP from StockAnalysis.com (no auth, no
    rate limit, GH-runner-friendly), VIX/VIX3M from CBOE EOD CSV. Builds a
    yfinance-compatible multi-index DataFrame so existing scorers see
    yfd["raw"][SYMBOL]["Close"] exactly as before.

    On total failure, degrades to _load_yfinance_fallback. yfinance is
    intentionally a backup, not the primary, since CI runner IPs get
    Yahoo HTTP-429d.
    """
    out: Dict[str, Any] = {}
    if pd is None:
        ctx.degrade("pandas unavailable for market data load")
        return out

    frames: Dict[str, "pd.DataFrame"] = {}
    failed: List[str] = []

    # --- StockAnalysis.com (equities, ETFs, dollar proxy) ---
    for label, lookup in SA_TICKERS_MAIN.items():
        df = _sa_history(lookup, range_="5Y")
        if df is None or df.empty:
            failed.append(f"SA:{lookup}({label})")
            ctx.warn(f"market-data: StockAnalysis {label}<-{lookup} unavailable")
            continue
        frames[label] = df
        time.sleep(0.15)  # gentle pacing

    # --- Date-freshness assertion (post-close EOD bar must be published) ---
    # If the close-of-day MPI run fires (>=17:00 ET) but SPY's last bar is
    # still yesterday, StockAnalysis hasn't rolled the EOD bar yet. Abort
    # cleanly so we publish nothing stale; the next cron slot will retry.
    # (Morning run at 09:15 ET is exempt — it intentionally uses prior
    # session close.) Added 2026-05-14 after data-staleness incident.
    if "SPY" in frames and pd is not None:
        try:
            spy_last_date = pd.Timestamp(frames["SPY"].index[-1]).date()
            try: ctx.market_asof = spy_last_date.strftime("%Y-%m-%d")
            except Exception: pass
            today_et = ctx.now_et.date()
            # Weekend-aware: expected last bar is most recent trading day (Mon-Fri).
            # If today is Sat/Sun, expected is the prior Friday.
            expected_last = today_et
            while expected_last.weekday() >= 5:  # 5=Sat, 6=Sun
                expected_last -= timedelta(days=1)
            # Honor --force: skip the assert entirely so manual reruns aren't blocked
            force_mode = bool(getattr(ctx, "force", False))
            if (not force_mode) and ctx.now_et.hour >= 17 and spy_last_date < expected_last:
                ctx.degrade(
                    f"market-data: SPY EOD not yet published "
                    f"(frame ends {spy_last_date}, expected last trading day {expected_last}). "
                    f"Aborting close-of-day MPI run to avoid stale snapshot."
                )
                raise SystemExit(0)  # graceful exit; cron will retry next slot
            if spy_last_date < expected_last:
                ctx.warn(f"market-data: SPY frame ends {spy_last_date}, expected {expected_last} (force=on, proceeding)")
        except SystemExit:
            raise
        except Exception as _e:  # noqa: BLE001
            ctx.warn(f"market-data: SPY date-freshness check skipped ({_e})")

    # --- CBOE EOD CSV (VIX, VIX3M) ---
    vix_df = _cboe_index_history(CBOE_VIX_URL)
    if vix_df is not None and not vix_df.empty:
        frames["^VIX"] = vix_df
    else:
        failed.append("CBOE:^VIX")
        ctx.warn("market-data: CBOE VIX history unavailable")

    vix3m_df = _cboe_index_history(CBOE_VIX3M_URL)
    if vix3m_df is not None and not vix3m_df.empty:
        frames["^VIX3M"] = vix3m_df
    else:
        ctx.warn("market-data: CBOE VIX3M history unavailable (term-shape will fall back)")

    # --- If we have nothing, defer to yfinance fallback ---
    critical = {"SPY", "QQQ", "IWM", "XLU", "XLP", "XLV", "XLY", "XLK", "XLF", "XLI", "^VIX"}
    have = set(frames.keys())
    missing_critical = critical - have
    if missing_critical:
        ctx.warn(
            "market-data primary missing critical: "
            + ",".join(sorted(missing_critical))
            + " -> trying yfinance fallback"
        )
        yf_out = _load_yfinance_fallback(ctx)
        if yf_out.get("raw") is not None and len(yf_out["raw"]) > 0:
            ctx.warn("market-data: yfinance fallback succeeded")
            return yf_out
        # both failed
        ctx.degrade(
            "market-data: both StockAnalysis+CBOE and yfinance fallback failed; "
            f"missing={sorted(missing_critical)} sa_failed={failed}"
        )
        return out

    # Build the multi-index DataFrame the scorers consume
    multi = pd.concat(frames, axis=1)
    out["raw"] = multi
    out["latest"] = {}
    # Populate the same nice-name lookups the legacy code wrote.
    label_to_nice = {
        "SPY": "spy", "QQQ": "qqq", "IWM": "iwm",
        "^VIX": "vix", "^VIX3M": "vix3m",
        "DX-Y.NYB": "dxy",
        "XLU": "xlu", "XLP": "xlp", "XLV": "xlv",
        "XLY": "xly", "XLK": "xlk", "XLF": "xlf", "XLI": "xli",
    }
    for label, df in frames.items():
        try:
            close = df["Close"].dropna()
            if close.empty:
                continue
            val = float(close.iloc[-1])
            if math.isnan(val):
                continue
            nice = label_to_nice.get(label, label.lower().replace("^", "").replace("-", ""))
            out["latest"][nice] = val
        except Exception:  # noqa: BLE001
            continue
    log.info("market-data primary OK: %d series, latest SPY=%.2f",
             len(frames), out["latest"].get("spy", float("nan")))
    return out


def _load_yfinance(ctx: RunContext) -> Dict[str, Any]:
    """Public entrypoint preserved for build_payload(). Delegates to the
    StockAnalysis+CBOE primary loader, with yfinance as fallback inside.
    """
    return _load_market_data(ctx)


def _load_cnn_fear_greed(ctx: RunContext) -> Optional[float]:
    """Returns CNN F&G value 0-100, or None on failure."""
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    body = _http_get(f"{CNN_FG_URL}/{today}", headers=CNN_FG_HEADERS)
    if body is None:
        ctx.warn("CNN F&G fetch failed")
        return None
    try:
        j = json.loads(body)
        v = j.get("fear_and_greed", {}).get("score")
        if v is None:
            return None
        return float(v)
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"CNN F&G parse failed: {e}")
        return None


def _load_cboe_putcall(ctx: RunContext) -> Optional[float]:
    """Pull total put/call ratio (latest day) from CBOE public CSV."""
    body = _http_get(CBOE_PUTCALL_URL)
    if body is None or pd is None:
        ctx.warn("CBOE put/call fetch failed")
        return None
    try:
        # CBOE CSV has a couple header rows
        text = body.decode("utf-8", errors="ignore")
        # Find first row that looks like a date header
        lines = text.splitlines()
        start = 0
        for i, ln in enumerate(lines):
            if "DATE" in ln.upper() and "RATIO" in ln.upper():
                start = i
                break
        df = pd.read_csv(io.StringIO("\n".join(lines[start:])))
        # Most recent row
        ratio_col = next(
            (c for c in df.columns if "RATIO" in c.upper() or "P/C" in c.upper()),
            None,
        )
        if ratio_col is None or df.empty:
            return None
        val = pd.to_numeric(df[ratio_col], errors="coerce").dropna().iloc[-1]
        return float(val)
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"CBOE put/call parse failed: {e}")
        return None


def _load_aaii(ctx: RunContext) -> Optional[float]:
    """Returns AAII bull-bear spread (bull% - bear%), or None on failure.

    Note: the community AAII mirror has been deleted. Until a replacement
    source is wired in, this function returns None and logs at INFO level
    so it does NOT degrade data_quality. CNN F&G carries the sentiment
    sleeve alone in the meantime.
    """
    body = _http_get(AAII_CSV_FALLBACK)
    if body is None or pd is None:
        # Silently skip: no ctx.warn() -> no entry in public "warnings" list,
        # no degradation of data_quality. CNN F&G covers sentiment for now.
        log.info("AAII source unavailable; using CNN F&G alone for sentiment")
        return None
    try:
        df = pd.read_csv(io.BytesIO(body))
        # Expect columns Bullish, Bearish (case may vary)
        bull_col = next((c for c in df.columns if "bull" in c.lower()), None)
        bear_col = next((c for c in df.columns if "bear" in c.lower()), None)
        if bull_col is None or bear_col is None or df.empty:
            return None
        bull = pd.to_numeric(df[bull_col], errors="coerce").dropna().iloc[-1]
        bear = pd.to_numeric(df[bear_col], errors="coerce").dropna().iloc[-1]
        # If values look like 0..1, scale up
        if bull < 1 and bear < 1:
            bull *= 100
            bear *= 100
        return float(bull - bear)
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"AAII parse failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Sub-indicator scoring (each returns 0..100)
# ---------------------------------------------------------------------------

def _clip01(x: float) -> float:
    return max(0.0, min(100.0, x))


def _percentile_rank(series, value: float) -> float:
    """Return percentile (0..100) of `value` within `series`."""
    if series is None:
        return 50.0
    try:
        if pd is not None and hasattr(series, "dropna"):
            arr = np.asarray(series.dropna().to_numpy(), dtype=float).flatten()
        else:
            arr = np.asarray(series, dtype=float).flatten()
    except Exception:
        return 50.0
    arr = arr[~np.isnan(arr)] if arr.size else arr
    if arr.size < 2 or value is None or (isinstance(value, float) and math.isnan(value)):
        return 50.0
    rank = float((arr < float(value)).sum()) / float(arr.size)
    return rank * 100.0


def score_trend(yfd: Dict[str, Any], ctx: RunContext) -> Tuple[float, Dict[str, Any]]:
    """SPY 50d vs 200d MA + slope of 50d MA."""
    detail: Dict[str, Any] = {}
    try:
        close = yfd["raw"]["SPY"]["Close"].dropna()
        if close.empty:
            raise RuntimeError("SPY close series empty")
        ma50 = close.rolling(50).mean().iloc[-1]
        ma200 = close.rolling(200).mean().iloc[-1]
        spot = close.iloc[-1]
        # Component 1: spot vs 200d (golden/death cross flavor)
        cross_ratio = (ma50 - ma200) / ma200 * 100  # %
        # Component 2: 50d slope (10d change)
        slope = (close.rolling(50).mean().iloc[-1] - close.rolling(50).mean().iloc[-11]) \
            / close.rolling(50).mean().iloc[-11] * 100
        # Map to 0..100: each component contributes 50pts. Center = 50.
        # +5% cross ratio -> ~85; -5% -> ~15
        s1 = 50 + cross_ratio * 7
        s2 = 50 + slope * 10
        score = _clip01(0.6 * s1 + 0.4 * s2)
        detail = {
            "spy_close": round(float(spot), 2),
            "ma50": round(float(ma50), 2),
            "ma200": round(float(ma200), 2),
            "cross_ratio_pct": round(float(cross_ratio), 3),
            "ma50_slope_pct": round(float(slope), 3),
        }
        return score, detail
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"trend score failed: {e}")
        return 50.0, {"error": str(e)}


def score_breadth(yfd: Dict[str, Any], ctx: RunContext) -> Tuple[float, Dict[str, Any]]:
    """
    Proxy breadth via QQQ-vs-IWM relative strength + SPY equal-weight not
    available without RSP, so we approximate with sector ETF dispersion:
    higher cyclical-vs-defensive ratio = positive breadth.
    """
    try:
        raw = yfd["raw"]
        # cyclical avg = mean(XLY, XLK, XLF, XLI) close, defensive = mean(XLU, XLP, XLV)
        cycl = pd.concat([raw[s]["Close"] for s in ("XLY", "XLK", "XLF", "XLI")], axis=1).mean(axis=1)
        defs = pd.concat([raw[s]["Close"] for s in ("XLU", "XLP", "XLV")], axis=1).mean(axis=1)
        ratio = (cycl / defs).dropna()
        if ratio.empty:
            raise RuntimeError("breadth ratio empty after dropna")
        # Compare current ratio vs 1y percentile
        last = float(ratio.iloc[-1])
        pct = _percentile_rank(ratio.iloc[-252:], last)
        # Also include IWM/SPY ratio for small-cap breadth
        small_big = (raw["IWM"]["Close"] / raw["SPY"]["Close"]).dropna().iloc[-252:]
        small_pct = _percentile_rank(small_big, float(small_big.iloc[-1]))
        score = _clip01(0.6 * pct + 0.4 * small_pct)
        return score, {
            "cyclical_defensive_ratio": round(last, 4),
            "cyc_def_percentile_1y": round(pct, 1),
            "iwm_spy_percentile_1y": round(small_pct, 1),
        }
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"breadth score failed: {e}")
        return 50.0, {"error": str(e)}


def score_volatility(yfd: Dict[str, Any], ctx: RunContext) -> Tuple[float, Dict[str, Any]]:
    """Low VIX percentile + contango term shape -> bullish (high score)."""
    try:
        raw = yfd["raw"]
        vix = raw["^VIX"]["Close"].dropna()
        vix3m = raw["^VIX3M"]["Close"].dropna() if "^VIX3M" in raw.columns.get_level_values(0) else None
        vix_last = float(vix.iloc[-1])
        # 1y percentile (low vol = high score, so invert)
        pct = _percentile_rank(vix.iloc[-252:], vix_last)
        s_pct = 100.0 - pct
        # Term structure
        term_shape = "n/a"
        s_term = 50.0
        if vix3m is not None and not vix3m.empty:
            v3m_last = float(vix3m.iloc[-1])
            if v3m_last > vix_last:
                term_shape = "Contango"
                s_term = 70.0
            elif v3m_last < vix_last:
                term_shape = "Backwardation"
                s_term = 25.0
            else:
                term_shape = "Flat"
        score = _clip01(0.7 * s_pct + 0.3 * s_term)
        return score, {
            "vix": round(vix_last, 2),
            "vix3m": round(float(vix3m.iloc[-1]), 2) if vix3m is not None and not vix3m.empty else None,
            "vix_percentile_1y": round(pct, 1),
            "term_shape": term_shape,
        }
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"volatility score failed: {e}")
        return 50.0, {"error": str(e)}


def score_yield_curve(fred: Dict[str, Optional[float]], ctx: RunContext) -> Tuple[float, Dict[str, Any]]:
    """Steeper curve (positive 10y-2y) -> bullish."""
    try:
        spread = fred.get("t10y2y")
        if spread is None and fred.get("dgs10") is not None and fred.get("dgs2") is not None:
            spread = fred["dgs10"] - fred["dgs2"]
        if spread is None:
            return 50.0, {"error": "no t10y2y"}
        # -1.0% -> 10, 0% -> 50, +1% -> 90
        score = _clip01(50 + spread * 40)
        return score, {
            "t10y2y_pct": round(float(spread), 3),
            "dgs10": fred.get("dgs10"),
            "dgs2": fred.get("dgs2"),
        }
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"yield curve score failed: {e}")
        return 50.0, {"error": str(e)}


def score_credit(fred: Dict[str, Optional[float]], ctx: RunContext) -> Tuple[float, Dict[str, Any]]:
    """Tight HY OAS -> bullish. Typical HY OAS range ~3% (tight) to ~10% (wide)."""
    try:
        hy = fred.get("hy_oas")
        ig = fred.get("ig_oas")
        if hy is None:
            return 50.0, {"error": "no hy_oas"}
        # HY OAS 3% -> 90, 5% -> 60, 8% -> 20
        score = _clip01(120 - hy * 12)
        return score, {
            "hy_oas_pct": round(float(hy), 3),
            "ig_oas_pct": round(float(ig), 3) if ig is not None else None,
        }
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"credit score failed: {e}")
        return 50.0, {"error": str(e)}


def score_sentiment(
    cnn: Optional[float],
    aaii_spread: Optional[float],
    putcall: Optional[float],
    ctx: RunContext,
) -> Tuple[float, Dict[str, Any]]:
    """Composite sentiment from 3 sources, each scored 0..100."""
    parts: List[float] = []
    detail: Dict[str, Any] = {}
    if cnn is not None:
        parts.append(float(cnn))  # already 0..100
        detail["cnn_fg"] = round(float(cnn), 1)
    if aaii_spread is not None:
        # AAII bull-bear spread typically -30..+30. Map: -30 -> 10, 0 -> 50, +30 -> 90
        s = _clip01(50 + (aaii_spread * 4 / 3))
        parts.append(s)
        detail["aaii_spread_pp"] = round(float(aaii_spread), 1)
        detail["aaii_score"] = round(s, 1)
    if putcall is not None:
        # Put/Call ~0.7 -> very bullish, 1.0 -> neutral, 1.3 -> bearish (contrarian: 1.3 = bullish)
        # We use direct interpretation (lower P/C = bullish): 0.6 -> 90, 1.0 -> 50, 1.4 -> 10
        s = _clip01(50 + (1.0 - putcall) * 100)
        parts.append(s)
        detail["putcall"] = round(float(putcall), 3)
        detail["putcall_score"] = round(s, 1)
    if not parts:
        ctx.warn("sentiment: no sources available, defaulting 50")
        return 50.0, {"error": "no sources"}
    score = float(np.mean(parts)) if np is not None else sum(parts) / len(parts)
    return _clip01(score), detail


def score_rotation(yfd: Dict[str, Any], ctx: RunContext) -> Tuple[float, Dict[str, Any]]:
    """XLU/XLY ratio: rising = defensive rotation = bearish."""
    try:
        raw = yfd["raw"]
        xlu = raw["XLU"]["Close"].dropna()
        xly = raw["XLY"]["Close"].dropna()
        ratio = (xlu / xly).dropna().iloc[-252:]
        if ratio.empty:
            raise RuntimeError("XLU/XLY ratio empty")
        last = float(ratio.iloc[-1])
        pct = _percentile_rank(ratio, last)
        # High XLU/XLY percentile = defensive = bearish, so invert
        score = _clip01(100.0 - pct)
        return score, {
            "xlu_xly_ratio": round(last, 4),
            "xlu_xly_percentile_1y": round(pct, 1),
        }
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"rotation score failed: {e}")
        return 50.0, {"error": str(e)}


def score_currency(yfd: Dict[str, Any], ctx: RunContext) -> Tuple[float, Dict[str, Any]]:
    """Stable/declining USD proxy (UUP ETF) + steady crude = bullish risk on.

    Note: We fetch the UUP ETF (Invesco DB Dollar Bullish Fund) as a proxy for
    DXY because direct ^DXY / DX-Y.NYB access from CI runners is unreliable.
    UUP tracks DXY directionally but at a different absolute scale (~1:4 ratio),
    so we report the UUP price/MA directly rather than mis-labeling it as DXY.
    The momentum score (vs 50d MA) is directionally identical either way.
    """
    try:
        raw = yfd["raw"]
        try:
            # DX-Y.NYB key in the frame is actually fed by UUP (see SA_TO_LEGACY).
            uup = raw["DX-Y.NYB"]["Close"].dropna()
        except Exception:
            return 50.0, {"error": "no usd proxy"}
        uup_last = float(uup.iloc[-1])
        ma50 = float(uup.rolling(50).mean().iloc[-1])
        # Below 50d MA -> dollar weakening -> bullish stocks
        diff = (uup_last - ma50) / ma50 * 100
        # +2% above MA -> 25, -2% below -> 75
        s = _clip01(50 - diff * 12.5)
        return s, {
            "uup": round(uup_last, 3),
            "uup_50d_ma": round(ma50, 3),
            "uup_vs_ma_pct": round(diff, 3),
            "note": "UUP ETF used as USD proxy; do not interpret as DXY level",
        }
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"currency score failed: {e}")
        return 50.0, {"error": str(e)}


def score_liquidity(fred: Dict[str, Optional[float]], ctx: RunContext) -> Tuple[float, Dict[str, Any]]:
    """M2 trend proxy. We don't pull series here; use M2 latest level vs simple heuristic."""
    # Without series-level access we can't compute YoY easily; we mark this as
    # a placeholder neutral with a warning. Future: cache 24mo of M2 to compute
    # trailing 12-month % change.
    m2 = fred.get("m2")
    if m2 is None:
        return 50.0, {"note": "M2 unavailable; using neutral 50"}
    # We assume positive M2 growth is bullish but without history we can only
    # return a soft positive bias if M2 number is above 21,000 (post-2024 floor).
    score = 55.0 if m2 > 21000 else 45.0
    return score, {"m2_latest": round(float(m2), 1), "note": "trend proxy"}


# ---------------------------------------------------------------------------
# HMM regime
# ---------------------------------------------------------------------------

def fit_hmm_regime(yfd: Dict[str, Any], ctx: RunContext) -> Dict[str, Any]:
    """3-state Gaussian HMM on SPY weekly log returns + 20d realized vol.

    To get a stable 3-state fit we want ~5+ years of weekly data. The yfinance
    download in this pipeline pulls 2y for speed; to give the HMM enough
    samples we re-download SPY for 10y here (small extra call).
    """
    try:
        from hmmlearn.hmm import GaussianHMM  # type: ignore
    except Exception as e:  # noqa: BLE001
        ctx.degrade(f"hmmlearn import failed: {e}")
        return {"state": "Sideways", "confidence": 0.33,
                "probs": {"Bull": 0.33, "Sideways": 0.34, "Bear": 0.33}, "error": str(e)}
    try:
        # Use the existing series first; if too short for HMM, fetch 10y from
        # StockAnalysis.com (yfinance is unreliable from CI IPs).
        close = yfd.get("raw", {}).get("SPY", {}).get("Close")
        if close is not None:
            close = close.dropna()
        if close is None or close.empty or len(close) < 1500:
            df10 = _sa_history("SPY", range_="10Y")
            if df10 is None or df10.empty:
                # last-ditch yfinance fallback
                try:
                    import yfinance as yf  # type: ignore
                    hist = yf.download("SPY", period="10y", interval="1d",
                                       progress=False, auto_adjust=True)
                    close = hist["Close"].dropna() if hist is not None else None
                except Exception:
                    close = None
            else:
                close = df10["Close"].dropna()
        if close is None or close.empty:
            raise RuntimeError("SPY history unavailable for HMM")
        # Weekly returns (Friday close)
        weekly = close.resample("W-FRI").last().dropna()
        log_ret = np.log(weekly).diff().dropna()
        # 20d realized vol on daily series, resample weekly
        daily_ret = np.log(close).diff().dropna()
        rv20 = daily_ret.rolling(20).std() * math.sqrt(252)
        rv20_w = rv20.resample("W-FRI").last().reindex(log_ret.index).ffill()
        X = np.column_stack([log_ret.values, rv20_w.values])
        # Drop any NaN rows
        mask = ~np.isnan(X).any(axis=1)
        X = X[mask]
        if X.shape[0] < 60:
            ctx.warn("HMM: insufficient data, returning neutral")
            return {"state": "Sideways", "confidence": 0.33,
                    "probs": {"Bull": 0.33, "Sideways": 0.34, "Bear": 0.33}}
        model = GaussianHMM(
            n_components=3,
            covariance_type="full",
            n_iter=500,
            random_state=42,
            tol=1e-4,
        )
        model.fit(X)
        states = model.predict(X)
        probs = model.predict_proba(X)
        # Sort states by mean weekly return: lowest -> Bear, mid -> Sideways, top -> Bull
        means = model.means_[:, 0]  # mean of return dim
        order = np.argsort(means)
        labels = {int(order[0]): "Bear", int(order[1]): "Sideways", int(order[2]): "Bull"}
        last_state_idx = int(states[-1])
        last_probs = probs[-1]
        prob_map = {labels[i]: float(last_probs[i]) for i in range(3)}
        # Order keys deterministically
        prob_map = {k: round(prob_map.get(k, 0.0), 4) for k in ("Bull", "Sideways", "Bear")}
        return {
            "state": labels[last_state_idx],
            "confidence": round(float(last_probs[last_state_idx]), 4),
            "probs": prob_map,
            "trans_diag": [round(float(model.transmat_[i, i]), 4) for i in range(3)],
        }
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"HMM fit failed: {e}\n{traceback.format_exc()}")
        return {"state": "Sideways", "confidence": 0.33,
                "probs": {"Bull": 0.33, "Sideways": 0.34, "Bear": 0.33}, "error": str(e)}


# ---------------------------------------------------------------------------
# Composite assembly
# ---------------------------------------------------------------------------

def regime_label(score: float) -> Tuple[str, str]:
    if score >= 70:
        return "Bull", "Bull"
    if score >= 55:
        return "Bull", "Bull · early"
    if score >= 45:
        return "Sideways", "Sideways"
    if score >= 30:
        return "Bear", "Bear · cautious"
    return "Bear", "Bear"


def signal_from_score(score: float) -> Dict[str, str]:
    if score >= 65:
        return {"bias": "Bullish", "strength": "High"}
    if score >= 55:
        return {"bias": "Bullish", "strength": "Medium"}
    if score >= 45:
        return {"bias": "Neutral", "strength": "Low"}
    if score >= 35:
        return {"bias": "Bearish", "strength": "Medium"}
    return {"bias": "Bearish", "strength": "High"}


def compute_compass(
    mpi: float,
    hmm_probs: Dict[str, float],
    term_shape: str,
) -> Dict[str, Any]:
    """
    Probability-up / flat / down derived from MPI + HMM + term structure.
    Calibrated to match the existing seed: MPI=79 + Bull HMM -> ~0.55/0.27/0.18.
    """
    bull_p = hmm_probs.get("Bull", 0.33)
    bear_p = hmm_probs.get("Bear", 0.33)
    sf = hmm_probs.get("Sideways", 0.34)
    # Base: 0.40 / 0.30 / 0.30 when MPI is neutral
    p_up = 0.40 + 0.0034 * (mpi - 50) + 0.06 * (bull_p - 0.33) - 0.06 * (bear_p - 0.33)
    p_down = 0.30 - 0.0034 * (mpi - 50) - 0.06 * (bull_p - 0.33) + 0.06 * (bear_p - 0.33)
    if term_shape == "Backwardation":
        p_up -= 0.04
        p_down += 0.04
    elif term_shape == "Contango":
        p_up += 0.015
        p_down -= 0.015
    p_up   = max(0.05, min(0.85, p_up))
    p_down = max(0.05, min(0.85, p_down))
    # Sideways probability — anchor on HMM Sideways state with some slack
    p_flat_target = 0.30 + 0.20 * (sf - 0.33)
    p_flat = max(0.05, min(0.60, p_flat_target))
    # Normalize so all three sum to 1
    total = p_up + p_flat + p_down
    p_up /= total
    p_flat /= total
    p_down /= total
    if p_up >= 0.50 and p_up - p_down > 0.10:
        bias = "Bullish"
    elif p_down >= 0.50 and p_down - p_up > 0.10:
        bias = "Bearish"
    else:
        bias = "Neutral"
    confidence = round(max(p_up, p_flat, p_down), 4)
    return {
        "bias": bias,
        "confidence": confidence,
        "probability_up":   round(p_up, 4),
        "probability_flat": round(p_flat, 4),
        "probability_down": round(p_down, 4),
    }


def expected_move(spy: float, vix: float, days: int = 1) -> Tuple[float, float]:
    """
    1-sigma N-day expected move using trading-day convention to match the
    existing seed methodology: SPY * VIX/100 * sqrt(days/252).
    """
    sigma_pct = (vix / 100.0) * math.sqrt(days / 252.0)
    return round(spy * sigma_pct, 2), round(sigma_pct, 4)


def compute_confidence_band(score: float) -> Dict[str, Any]:
    """Return 85% CI band approximated as score +/- 5pts, clipped 0..100."""
    return {
        "ci_level": "85%",
        "ci_low":  int(max(0, score - 5)),
        "ci_high": int(min(100, score + 5)),
    }


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def _scrub_nans(obj: Any) -> Any:
    """Recursively replace NaN/Inf with None so json.dumps(allow_nan=False) is safe."""
    if isinstance(obj, dict):
        return {k: _scrub_nans(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_scrub_nans(v) for v in obj]
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if np is not None and isinstance(obj, (np.floating,)):
        f = float(obj)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    if np is not None and isinstance(obj, (np.integer,)):
        return int(obj)
    return obj


def gate_clock(ctx: RunContext, force: bool) -> bool:
    """Return True if we should run, False if we should exit cleanly."""
    if force:
        return True
    et = ctx.now_et
    if et.weekday() >= 5:
        log.info("weekend (%s) — skipping", et.strftime("%a"))
        return False
    # Holiday check
    try:
        import pandas_market_calendars as mcal  # type: ignore
        nyse = mcal.get_calendar("NYSE")
        sched = nyse.schedule(start_date=et.date(), end_date=et.date())
        if sched.empty:
            log.info("[gate_holiday] NYSE closed today — exiting cleanly")
            return False
    except Exception as e:  # noqa: BLE001
        ctx.warn(f"[gate_holiday] calendar check failed ({e}) — proceeding")
    # Window check
    in_window = False
    for h_lo, m_lo, h_hi, m_hi in WINDOWS_ET:
        lo = et.replace(hour=h_lo, minute=m_lo, second=0, microsecond=0)
        hi = et.replace(hour=h_hi, minute=m_hi, second=0, microsecond=0)
        if lo <= et <= hi:
            in_window = True
            break
    if not in_window:
        log.info("outside target window (%s ET) — skipping", et.strftime("%H:%M"))
    return in_window


def load_last_good(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception as e:  # noqa: BLE001
        log.warning("could not parse last-good %s: %s", path, e)
        return None


def _resolve_asof(ctx) -> str:
    """Return YYYY-MM-DD for the latest closed trading day this run reflects.
    Priority: ctx.market_asof (set during market-data load) > most recent weekday
    on/before today's ET date. Prevents post-midnight runs from labeling next day."""
    try:
        d = getattr(ctx, "market_asof", None)
        if d:
            return d if isinstance(d, str) else d.strftime("%Y-%m-%d")
    except Exception:
        pass
    et = ctx.now_et.date()
    # walk back to most recent weekday (Mon-Fri)
    while et.weekday() >= 5:
        et = et.replace(day=et.day-1) if et.day > 1 else et
        from datetime import timedelta as _td
        et = et - _td(days=1)
    return et.strftime("%Y-%m-%d")



def build_payload(ctx: RunContext, mock: bool = False) -> Dict[str, Any]:
    """Run all loaders + scorers, return final payload dict."""
    if mock:
        return _mock_payload(ctx)

    # --- Load sources (each is failsafe internally) ---
    fred = _load_fred(ctx)
    yfd = _load_yfinance(ctx)
    cnn = _load_cnn_fear_greed(ctx)
    aaii = _load_aaii(ctx)
    pc = _load_cboe_putcall(ctx)

    # --- Score sub-indicators ---
    s_trend, d_trend = score_trend(yfd, ctx)
    s_breadth, d_breadth = score_breadth(yfd, ctx)
    s_vol, d_vol = score_volatility(yfd, ctx)
    s_yc, d_yc = score_yield_curve(fred, ctx)
    s_credit, d_credit = score_credit(fred, ctx)
    s_sent, d_sent = score_sentiment(cnn, aaii, pc, ctx)
    s_rot, d_rot = score_rotation(yfd, ctx)
    s_curr, d_curr = score_currency(yfd, ctx)
    s_liq, d_liq = score_liquidity(fred, ctx)

    sub = {
        "trend":      {"score": round(s_trend, 1), **d_trend},
        "breadth":    {"score": round(s_breadth, 1), **d_breadth},
        "volatility": {"score": round(s_vol, 1), **d_vol},
        "yield_curve": {"score": round(s_yc, 1), **d_yc},
        "credit":     {"score": round(s_credit, 1), **d_credit},
        "sentiment":  {"score": round(s_sent, 1), **d_sent},
        "rotation":   {"score": round(s_rot, 1), **d_rot},
        "currency":   {"score": round(s_curr, 1), **d_curr},
        "liquidity":  {"score": round(s_liq, 1), **d_liq},
    }

    mpi = (
        s_trend * MPI_WEIGHTS["trend"]
        + s_breadth * MPI_WEIGHTS["breadth"]
        + s_vol * MPI_WEIGHTS["volatility"]
        + s_yc * MPI_WEIGHTS["yield_curve"]
        + s_credit * MPI_WEIGHTS["credit"]
        + s_sent * MPI_WEIGHTS["sentiment"]
        + s_rot * MPI_WEIGHTS["rotation"]
        + s_curr * MPI_WEIGHTS["currency"]
        + s_liq * MPI_WEIGHTS["liquidity"]
    )
    mpi = round(_clip01(mpi))

    # --- Market data (SPY, VIX, term) ---
    latest = yfd.get("latest", {})
    spy = float(latest.get("spy") or 0)
    vix = float(latest.get("vix") or 0)
    vix3m = float(latest.get("vix3m") or 0)
    em_abs, em_pct = expected_move(spy, vix, 1) if spy and vix else (0.0, 0.0)
    vrp = round(vix - (d_trend.get("ma50_slope_pct", 0) or 0), 2) if vix else 0.0
    # Better VRP: VIX - 20d realized vol (annualized %)
    try:
        close = yfd["raw"]["SPY"]["Close"].dropna()
        rv20 = float(np.log(close).diff().rolling(20).std().iloc[-1] * math.sqrt(252) * 100)
        vrp = round(vix - rv20, 2)
    except Exception:
        rv20 = None

    # --- Flat-penny SPY+VIX soft-warn (stale-fetch canary) ---
    # If both SPY and VIX are essentially unchanged day-over-day, that's a
    # strong signal that today's fetch returned yesterday's bar (the failure
    # mode behind the 2026-05-14 incident). Compare to the prior session's
    # close from the loaded frames (iloc[-2]).
    try:
        raw = yfd.get("raw")
        if raw is not None and spy and vix:
            spy_close = raw["SPY"]["Close"].dropna()
            vix_close = raw["^VIX"]["Close"].dropna()
            if len(spy_close) >= 2 and len(vix_close) >= 2:
                spy_yest = float(spy_close.iloc[-2])
                vix_yest = float(vix_close.iloc[-2])
                spy_delta_pct = abs(spy - spy_yest) / spy_yest if spy_yest else 0.0
                vix_delta_pct = abs(vix - vix_yest) / max(vix_yest, 0.01)
                if spy_delta_pct < 0.0005 and vix_delta_pct < 0.005:
                    import sys
                    print(
                        f"WARN: SPY+VIX both ~flat day-over-day "
                        f"(SPY Δ{spy_delta_pct*100:.3f}%, "
                        f"VIX Δ{vix_delta_pct*100:.3f}%). "
                        f"Possible stale-data fetch. Check pipeline logs.",
                        file=sys.stderr,
                    )
                    ctx.warn(
                        f"stale-data canary: SPY+VIX both flat dod "
                        f"(SPY {spy_delta_pct*100:.3f}%, VIX {vix_delta_pct*100:.3f}%)"
                    )
    except Exception as _e:  # noqa: BLE001
        ctx.warn(f"flat-penny canary skipped ({_e})")

    term_shape = d_vol.get("term_shape", "n/a")

    # --- HMM ---
    hmm = fit_hmm_regime(yfd, ctx)

    # --- Regime/compass/signal ---
    regime, regime_lbl = regime_label(mpi)
    sig = signal_from_score(mpi)
    ci = compute_confidence_band(mpi)
    compass = compute_compass(mpi, hmm["probs"], term_shape)

    payload: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "computed_at":    ctx.now_utc.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "asOf":           _resolve_asof(ctx),
        "stale_threshold_hours": STALE_THRESHOLD_HOURS,
        "data_quality":   _compute_data_quality(ctx),
        "data": {
            "mpi_score":  mpi,
            "mpi_label":  regime,
            "regime":     regime,
            "regime_label": regime_lbl,
            "confidence": ci,
            "signal":     sig,
            "market": {
                "spy_spot":             round(spy, 2) if spy else None,
                "expected_move_1sigma": em_abs,
                "expected_move_pct":    em_pct,
            },
            "volatility": {
                "vix":    round(vix, 2) if vix else None,
                "vix3m":  round(vix3m, 2) if vix3m else None,
                "vrp":    vrp,
                "term_shape": term_shape,
                "realized_vol_20d_pct": round(rv20, 2) if rv20 is not None else None,
            },
            "compass": compass,
            "hmm": {
                "state":      hmm["state"],
                "confidence": hmm["confidence"],
                "probs":      hmm["probs"],
            },
            "sub_indicators": sub,
        },
        "warnings": ctx.warnings,
        "source_versions": {
            "schema": SCHEMA_VERSION,
            "weights": MPI_WEIGHTS,
        },
    }
    return payload


# ---------------------------------------------------------------------------
# Mock payload (for --mock and CI smoke tests)
# ---------------------------------------------------------------------------

def _mock_payload(ctx: RunContext) -> Dict[str, Any]:
    """Returns a payload that matches the live schema but uses static numbers."""
    mpi = 79
    hmm_probs = {"Bull": 0.78, "Sideways": 0.16, "Bear": 0.06}
    term_shape = "Contango"
    spy, vix, vix3m = 731.58, 17.08, 18.40
    em_abs, em_pct = expected_move(spy, vix, 1)
    sub = {
        "trend":       {"score": 82.0, "spy_close": spy, "ma50": 715.0, "ma200": 670.0,
                         "cross_ratio_pct": 6.71, "ma50_slope_pct": 1.24},
        "breadth":     {"score": 71.0, "cyclical_defensive_ratio": 1.42,
                         "cyc_def_percentile_1y": 78.0, "iwm_spy_percentile_1y": 64.0},
        "volatility":  {"score": 78.0, "vix": vix, "vix3m": vix3m,
                         "vix_percentile_1y": 24.0, "term_shape": term_shape},
        "yield_curve": {"score": 65.0, "t10y2y_pct": 0.41, "dgs10": 4.32, "dgs2": 3.91},
        "credit":      {"score": 80.0, "hy_oas_pct": 3.32, "ig_oas_pct": 0.92},
        "sentiment":   {"score": 74.0, "cnn_fg": 72.0, "aaii_spread_pp": 18.5,
                         "putcall": 0.78, "putcall_score": 72.0, "aaii_score": 74.7},
        "rotation":    {"score": 76.0, "xlu_xly_ratio": 0.412, "xlu_xly_percentile_1y": 22.0},
        "currency":    {"score": 68.0, "dxy": 102.10, "dxy_50d_ma": 103.40, "dxy_vs_ma_pct": -1.26},
        "liquidity":   {"score": 55.0, "m2_latest": 21850.4, "note": "trend proxy"},
    }
    regime, regime_lbl = regime_label(mpi)
    return {
        "schema_version": SCHEMA_VERSION,
        "computed_at":    ctx.now_utc.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "asOf":           _resolve_asof(ctx),
        "stale_threshold_hours": STALE_THRESHOLD_HOURS,
        "data_quality":   "ok",
        "data": {
            "mpi_score":  mpi,
            "mpi_label":  regime,
            "regime":     regime,
            "regime_label": regime_lbl,
            "confidence": compute_confidence_band(mpi),
            "signal":     signal_from_score(mpi),
            "market": {
                "spy_spot":             spy,
                "expected_move_1sigma": em_abs,
                "expected_move_pct":    em_pct,
            },
            "volatility": {
                "vix": vix, "vix3m": vix3m, "vrp": 2.84,
                "term_shape": term_shape, "realized_vol_20d_pct": 14.24,
            },
            "compass":  compute_compass(mpi, hmm_probs, term_shape),
            "hmm":      {"state": "Bull", "confidence": 0.78, "probs": hmm_probs},
            "sub_indicators": sub,
        },
        "warnings": ["mock mode: no network calls"],
        "source_versions": {"schema": SCHEMA_VERSION, "weights": MPI_WEIGHTS, "mode": "mock"},
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="AZTMM MPI + HMM pipeline")
    parser.add_argument("--dry-run", action="store_true",
                        help="Compute and print, do not write file")
    parser.add_argument("--mock", action="store_true",
                        help="Use canned data (no network calls)")
    parser.add_argument("--force", action="store_true",
                        help="Skip clock/holiday gate")
    parser.add_argument("--output", default="data/mpi.json",
                        help="Output JSON path (relative to cwd)")
    args = parser.parse_args(argv)

    now_utc = datetime.now(UTC)
    now_et = now_utc.astimezone(NY_TZ)
    ctx = RunContext(now_utc=now_utc, now_et=now_et)

    log.info("AZTMM MPI pipeline start  utc=%s  et=%s",
             now_utc.isoformat(), now_et.isoformat())

    if not gate_clock(ctx, args.force or args.dry_run or args.mock):
        log.info("gate closed; exiting cleanly")
        _tg_notify(f"ℹ️ MPI cron gate-closed at {ctx.now_et.strftime('%a %H:%M ET')} (weekend/holiday/window) — no commit, normal")
        return 0

    out_path = Path(args.output).resolve()
    ctx.last_good = load_last_good(out_path)

    try:
        payload = build_payload(ctx, mock=args.mock)
    except Exception as e:  # noqa: BLE001
        log.error("build_payload crashed: %s\n%s", e, traceback.format_exc())
        if ctx.last_good:
            payload = ctx.last_good
            payload.setdefault("warnings", []).append(f"crashed, served last-good: {e}")
            payload["data_quality"] = "degraded"
        else:
            log.error("no last-good available; exit 1")
            return 1

    payload = _scrub_nans(payload)

    # ------------------------------------------------------------------
    # Build PUBLIC + INTERNAL payloads.
    # The jsDelivr CDN serves data/mpi.json raw and publicly, so the public
    # copy must NOT leak internal debug fields (data_quality, warnings,
    # source_versions.weights, transition_matrix, posterior, per-component
    # weight/raw_value/error).  The internal copy keeps everything for the
    # WP proxy / debugging consumers.
    # ------------------------------------------------------------------
    internal_payload = payload  # full version, includes all debug fields

    # Deep copy via JSON round-trip so we can strip safely.
    try:
        public_payload = json.loads(json.dumps(internal_payload, default=str))
    except (TypeError, ValueError):
        public_payload = json.loads(json.dumps(_scrub_nans(internal_payload), default=str))

    # Strip top-level internals.
    public_payload.pop("data_quality", None)
    public_payload.pop("warnings", None)
    if isinstance(public_payload.get("source_versions"), dict):
        public_payload["source_versions"].pop("weights", None)

    # Strip nested HMM internals + per-component debug fields.
    if isinstance(public_payload.get("data"), dict):
        data_blk = public_payload["data"]
        data_blk.pop("transition_matrix", None)
        hmm_blk = data_blk.get("hmm")
        if isinstance(hmm_blk, dict):
            hmm_blk.pop("transition_matrix", None)
            hmm_blk.pop("posterior", None)
        sub_blk = data_blk.get("sub_indicators")
        if isinstance(sub_blk, dict):
            for k in list(sub_blk.keys()):
                comp = sub_blk[k]
                if isinstance(comp, dict):
                    comp.pop("weight", None)
                    comp.pop("raw_value", None)
                    comp.pop("error", None)

    def _serialize(obj: Dict[str, Any]) -> str:
        try:
            return json.dumps(obj, indent=2, sort_keys=False,
                              allow_nan=False, ensure_ascii=False)
        except (TypeError, ValueError) as e:
            log.error("JSON serialization failed (%s); attempting permissive fallback", e)
            return json.dumps(obj, indent=2, sort_keys=False, default=str)

    public_str = _serialize(public_payload)
    internal_str = _serialize(internal_payload)

    # Back-compat: keep out_str as the public output for any downstream usage.
    out_str = public_str

    if args.dry_run:
        print(out_str)
        return 0

    # Compare with prior to skip no-op commits (compare PUBLIC file, which is
    # the canonical CDN artifact).
    prior_str = out_path.read_text() if out_path.exists() else ""
    # Strip computed_at for diff comparison (always changes)
    def _strip_volatile(s: str) -> str:
        try:
            obj = json.loads(s)
            obj.pop("computed_at", None)
            obj.pop("warnings", None)
            return json.dumps(obj, sort_keys=True)
        except Exception:
            return s

    # Derive internal output path: data/mpi.json -> data/mpi-internal.json
    internal_path = out_path.with_name(out_path.stem + "-internal" + out_path.suffix)

    public_changed = _strip_volatile(out_str) != _strip_volatile(prior_str)
    prior_internal_str = internal_path.read_text() if internal_path.exists() else ""
    internal_changed = _strip_volatile(internal_str) != _strip_volatile(prior_internal_str)

    # Force-rewrite if asOf changed (new calendar day) OR prior is stale (>4h old)
    # — prevents the silent no-op when scheduled runs land on identical-looking data.
    force_rewrite = False
    try:
        import json as _json
        cur_asof = _json.loads(out_str).get("asOf")
        prior_obj = _json.loads(prior_str) if prior_str else {}
        prior_asof = prior_obj.get("asOf")
        prior_computed = prior_obj.get("computed_at", "")
        if cur_asof and prior_asof and cur_asof != prior_asof:
            force_rewrite = True
            log.info("dedup-override: asOf changed %s -> %s; forcing rewrite", prior_asof, cur_asof)
        elif prior_computed:
            from datetime import datetime as _dt, timezone as _tz
            try:
                prior_ts = _dt.fromisoformat(prior_computed.replace("Z", "+00:00"))
                age_h = (_dt.now(_tz.utc) - prior_ts).total_seconds() / 3600
                if age_h > 4:
                    force_rewrite = True
                    log.info("dedup-override: prior payload age=%.1fh > 4h; forcing rewrite", age_h)
            except Exception:
                pass
    except Exception as _e:
        log.warning("dedup-override check failed: %s", _e)

    if not public_changed and not internal_changed and not force_rewrite:
        log.info("payload unchanged from prior AND prior is fresh (<4h); skipping write to save commit")
        # Telegram notify so we know this happened
        _tg_notify("ℹ️ MPI cron skipped: payload unchanged + prior <4h old")
        return 0

    # If force_rewrite triggered, mark BOTH as changed so writes happen
    if force_rewrite:
        public_changed = True
        internal_changed = True

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if public_changed:
        out_path.write_text(out_str + "\n")
        log.info("wrote %s (%d bytes, public)", out_path, len(out_str))
    else:
        log.info("public payload unchanged; skipping write to %s", out_path)

    if internal_changed:
        internal_path.write_text(internal_str + "\n")
        log.info("wrote %s (%d bytes, internal)", internal_path, len(internal_str))
    else:
        log.info("internal payload unchanged; skipping write to %s", internal_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
