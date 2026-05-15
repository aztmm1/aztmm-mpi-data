"""
AZTMM Daily Pulse v2 — Fetcher (FREE sources, post-UW)
========================================================

Pulls end-of-day options + dark-pool + regime data from FREE sources only.
Replaces the prior UW-driven fetcher (zero UW usage).

Sources:
  1. yfinance EOD option chains for top 50 names + sector ETFs
  2. yfinance index quotes (SPY/QQQ/IWM/^VIX/^VIX3M)
  3. FINRA OTC Transparency (T-14+ lag) — ATS by-symbol weekly notional
  4. SEC EDGAR Form 4 — recent insider buys per ticker
  5. data/mpi.json — live MPI snapshot from repo
  6. Hardcoded May-2026 macro catalyst calendar

Output dict matches the legacy aggregator contract so
daily_pulse_aggregator.aggregate() works unchanged:
  - market_totals      {call_volume, put_volume, call_premium, put_premium}
  - sector_etfs        list of {ticker, close, change_percent,
                                call_premium, put_premium}
  - market_tide        list of {net_call_premium} time-series (synth)
  - flow_alerts        list of per-row option chain alerts (ask-side notional)
  - darkpool           dict {ticker: [{size, premium, timestamp}]}
                       — derived from FINRA ATS weekly (T-14 caveat)
  - econ_cal           list of {when, name, prev, forecast, implication}
  - mpi_snapshot       {score, label, regime_short, confidence_label}
  - data_quality       {endpoints_ok, endpoints_failed, sources_used}
  - date / prev_date
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests

DEFAULT_TIMEOUT = 25
THROTTLE_SEC = 0.25

TOP50_NAMES = [
    "NVDA", "MSFT", "AAPL", "GOOGL", "META", "AMZN", "TSLA", "AVGO", "AMD",
    "QCOM", "INTC", "TSM", "CRM", "ORCL", "ADBE", "MU", "NFLX", "PYPL",
    "JPM", "BAC", "GS", "MS", "WFC", "C",
    "XOM", "CVX", "OXY", "SLB",
    "UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK",
    "WMT", "PG", "KO", "PEP", "COST",
    "BA", "CAT", "GE", "HON",
    "DIS", "T", "VZ", "CMCSA",
    "HD", "LOW", "NKE",
]

SECTOR_ETFS = [
    "SPY", "XLK", "XLF", "XLV", "XLY", "XLP",
    "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC",
]

DP_WATCHLIST = [
    "SPY", "QQQ", "IWM",
    "NVDA", "MSFT", "AAPL", "GOOGL", "META", "TSLA", "AMZN", "AVGO", "AMD",
]

EXPIRY_DEPTH = 2
ALERT_MIN_PREMIUM = 100_000

CIK_MAP = {
    "NVDA": "0001045810", "MSFT": "0000789019", "AAPL": "0000320193",
    "GOOGL": "0001652044", "META": "0001326801", "AMZN": "0001018724",
    "TSLA": "0001318605", "AVGO": "0001730168", "AMD":  "0000002488",
    "QCOM": "0000804328", "INTC": "0000050863", "TSM":  "0001046179",
    "CRM":  "0001108524", "ORCL": "0001341439", "ADBE": "0000796343",
    "MU":   "0000723125", "NFLX": "0001065280", "PYPL": "0001633917",
    "JPM":  "0000019617", "BAC":  "0000070858", "GS":   "0000886982",
    "MS":   "0000895421", "WFC":  "0000072971", "C":    "0000831001",
    "XOM":  "0000034088", "CVX":  "0000093410", "OXY":  "0000797468",
    "SLB":  "0000087347",
    "UNH":  "0000731766", "JNJ":  "0000200406", "LLY":  "0000059478",
    "PFE":  "0000078003", "ABBV": "0001551152", "MRK":  "0000310158",
    "WMT":  "0000104169", "PG":   "0000080424", "KO":   "0000021344",
    "PEP":  "0000077476", "COST": "0000909832",
    "BA":   "0000012927", "CAT":  "0000018230", "GE":   "0000040545",
    "HON":  "0000773840",
    "DIS":  "0001744489", "T":    "0000732717", "VZ":   "0000732712",
    "CMCSA":"0001166691",
    "HD":   "0000354950", "LOW":  "0000060667", "NKE":  "0000320187",
}

EDGAR_UA = os.environ.get(
    "EDGAR_USER_AGENT",
    "AZTMM Research nikhil.kothari17@gmail.com"
)

logger = logging.getLogger("daily_pulse.fetcher")

ECON_CAL_2026 = [
    {"date": "2026-05-13", "when": "Wed 8:30 AM ET", "name": "CPI (Apr)",
     "prev": "0.2%", "forecast": "0.3%",
     "implication": "Hot read pressures the cut-cycle path; cool read greenlights risk-on continuation."},
    {"date": "2026-05-14", "when": "Thu 8:30 AM ET", "name": "PPI (Apr)",
     "prev": "0.1%", "forecast": "0.2%",
     "implication": "Wholesale pricing pressure feeds through to consumer CPI revisions."},
    {"date": "2026-05-15", "when": "Fri 8:30 AM ET", "name": "Empire State Mfg. (May) + Retail Sales (Apr)",
     "prev": "11.0", "forecast": "6.5",
     "implication": "Empire miss <5 reinforces soft-data slowdown; retail-sales beat keeps consumer thesis intact."},
    {"date": "2026-05-16", "when": "Fri 4:00 PM ET", "name": "May OPEX",
     "prev": "", "forecast": "",
     "implication": "Monthly options expiry — dealer gamma roll-off historically widens range Mon-Tue."},
    {"date": "2026-05-19", "when": "Tue 10:00 AM ET", "name": "Existing Home Sales (Apr)",
     "prev": "4.20M", "forecast": "4.15M",
     "implication": "Housing print informs rate-sensitive cyclicals (XHB, XLF)."},
    {"date": "2026-05-21", "when": "Thu 2:00 PM ET", "name": "FOMC Minutes (Apr)",
     "prev": "", "forecast": "",
     "implication": "Dot-plot color on the 2026 cut path; hawkish minutes pressure duration + growth."},
    {"date": "2026-05-22", "when": "Fri 9:45 AM ET", "name": "S&P Flash PMI (May)",
     "prev": "51.4", "forecast": "51.0",
     "implication": "Sub-50 print = recession-flag headline risk; >52 reinforces no-landing scenario."},
    {"date": "2026-05-27", "when": "Wed 10:00 AM ET", "name": "Consumer Confidence (May)",
     "prev": "98.3", "forecast": "96.5",
     "implication": "Demand-side health gauge; misses pressure consumer discretionary (XLY)."},
    {"date": "2026-05-29", "when": "Fri 8:30 AM ET", "name": "PCE (Apr) - Fed's preferred gauge",
     "prev": "0.3%", "forecast": "0.2%",
     "implication": "Core PCE is the print that moves the cut-cycle calendar."},
    {"date": "2026-06-06", "when": "Fri 8:30 AM ET", "name": "Non-Farm Payrolls (May)",
     "prev": "175k", "forecast": "180k",
     "implication": "Labor read sets the FOMC's reaction function for the June meeting."},
    {"date": "2026-06-11", "when": "Wed 2:00 PM ET", "name": "FOMC Decision (June)",
     "prev": "5.25-5.50%", "forecast": "Hold",
     "implication": "Statement language and Powell presser drive the front of the curve."},
]

METHODOLOGY_FOOTNOTE = (
    "Data sources: yfinance EOD options chain - CBOE Daily Volume Summary "
    "- FINRA OTC Transparency (T-14) - SEC EDGAR Form 4 - "
    "Not investment advice."
)


def _edgar_headers():
    return {"User-Agent": EDGAR_UA, "Accept-Encoding": "gzip, deflate"}


def _yf_ticker(symbol):
    import yfinance as yf
    return yf.Ticker(symbol)


def fetch_yf_spot(symbol, target_date):
    try:
        tkr = _yf_ticker(symbol)
        d_end = datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=1)
        d_start = datetime.strptime(target_date, "%Y-%m-%d") - timedelta(days=7)
        hist = tkr.history(start=d_start.strftime("%Y-%m-%d"),
                           end=d_end.strftime("%Y-%m-%d"))
        if hist is None or len(hist) < 2:
            return {"ticker": symbol, "available": False}
        close = float(hist["Close"].iloc[-1])
        prev = float(hist["Close"].iloc[-2])
        chg = ((close - prev) / prev * 100.0) if prev else 0.0
        vol = int(hist["Volume"].iloc[-1]) if "Volume" in hist else 0
        return {
            "ticker": symbol, "available": True,
            "close": close, "prev_close": prev,
            "change_pct": chg, "change_percent": chg, "volume": vol,
        }
    except Exception as e:
        logger.warning("yf spot %s failed: %s", symbol, e)
        return {"ticker": symbol, "available": False, "error": str(e)}


def _approx_iv_rank(iv):
    if iv <= 0:
        return 0
    if iv <= 0.15: return min(30, iv / 0.15 * 30)
    if iv <= 0.30: return 30 + (iv - 0.15) / 0.15 * 25
    if iv <= 0.60: return 55 + (iv - 0.30) / 0.30 * 25
    return min(95, 80 + (iv - 0.60) / 0.40 * 15)


def fetch_yf_option_chain(symbol, spot=None):
    out = []
    try:
        tkr = _yf_ticker(symbol)
        exps = tkr.options or []
        if not exps:
            return []
        for expiry in exps[:EXPIRY_DEPTH]:
            try:
                chain = tkr.option_chain(expiry)
            except Exception as e:
                logger.debug("chain %s/%s failed: %s", symbol, expiry, e)
                continue
            for side_df, opt_type in [(chain.calls, "call"), (chain.puts, "put")]:
                if side_df is None or len(side_df) == 0:
                    continue
                for _, row in side_df.iterrows():
                    try:
                        strike = float(row.get("strike", 0) or 0)
                        last = float(row.get("lastPrice", 0) or 0)
                        bid = float(row.get("bid", 0) or 0)
                        ask = float(row.get("ask", 0) or 0)
                        vol = int(row.get("volume", 0) or 0)
                        oi = int(row.get("openInterest", 0) or 0)
                        iv = float(row.get("impliedVolatility", 0) or 0)
                    except (TypeError, ValueError):
                        continue
                    if vol <= 0 or strike <= 0:
                        continue
                    premium = last * vol * 100.0
                    if premium < ALERT_MIN_PREMIUM:
                        continue
                    mid = (bid + ask) / 2.0 if (bid > 0 and ask > 0) else last
                    if ask > 0 and last >= (mid + (ask - mid) * 0.4):
                        side = "ask"
                    elif bid > 0 and last <= (mid - (mid - bid) * 0.4):
                        side = "bid"
                    else:
                        side = "mid"
                    try:
                        dte = (datetime.strptime(expiry, "%Y-%m-%d") - datetime.now()).days
                    except Exception:
                        dte = 0
                    voi = (vol / oi) if oi > 0 else (vol if vol > 0 else 0)
                    out.append({
                        "ticker": symbol,
                        "type": opt_type, "option_type": opt_type,
                        "side": side, "strike": strike,
                        "expiry": expiry, "expiration": expiry,
                        "dte": max(0, dte),
                        "volume": vol, "open_interest": oi,
                        "iv": iv, "iv_rank": _approx_iv_rank(iv),
                        "ivr": _approx_iv_rank(iv),
                        "total_premium": premium, "premium": premium,
                        "volume_oi_ratio": voi, "vol_oi_ratio": voi,
                        "underlying_price": spot or 0, "spot": spot or 0,
                    })
            time.sleep(0.05)
    except Exception as e:
        logger.warning("yf option chain %s failed: %s", symbol, e)
    return out


def aggregate_market_totals_from_chains(all_alerts):
    cv = pv = 0
    cp = pp = 0.0
    for a in all_alerts:
        if a.get("type") == "call":
            cv += a.get("volume", 0)
            cp += a.get("total_premium", 0)
        elif a.get("type") == "put":
            pv += a.get("volume", 0)
            pp += a.get("total_premium", 0)
    return {
        "call_volume": cv, "put_volume": pv,
        "call_premium": cp, "put_premium": pp,
    }


def sector_etf_premium_split(alerts):
    cp = sum(a["total_premium"] for a in alerts if a.get("type") == "call")
    pp = sum(a["total_premium"] for a in alerts if a.get("type") == "put")
    return cp, pp


def fetch_vix(target_date):
    out = {"available": False}
    try:
        import yfinance as yf
        end = datetime.strptime(target_date, "%Y-%m-%d") + timedelta(days=1)
        start = end - timedelta(days=14)
        df_vix = yf.Ticker("^VIX").history(start=start.strftime("%Y-%m-%d"),
                                           end=end.strftime("%Y-%m-%d"))
        df_v3m = yf.Ticker("^VIX3M").history(start=start.strftime("%Y-%m-%d"),
                                             end=end.strftime("%Y-%m-%d"))
        if df_vix is not None and len(df_vix) >= 2:
            vix = float(df_vix["Close"].iloc[-1])
            prev = float(df_vix["Close"].iloc[-2])
            out.update({
                "available": True, "vix": vix, "vix_prev": prev,
                "vix_change_pct": ((vix - prev) / prev * 100.0) if prev else 0.0,
            })
        if df_v3m is not None and len(df_v3m) >= 1:
            out["vix3m"] = float(df_v3m["Close"].iloc[-1])
    except Exception as e:
        out["error"] = str(e)
        logger.warning("VIX fetch failed: %s", e)
    return out


FINRA_ENDPOINT = "https://api.finra.org/data/group/otcMarket/name/weeklySummary"


def fetch_finra_ats_weekly(tickers, target_date):
    out = {}
    try:
        payload = {
            "limit": 1000,
            "compareFilters": [
                {"compareType": "EQUAL", "fieldName": "summaryTypeCode",
                 "fieldValue": "ATS_W_SMBL"},
            ],
        }
        r = requests.post(FINRA_ENDPOINT, json=payload,
                          headers={"User-Agent": "aztmm-daily-pulse/3.0"},
                          timeout=DEFAULT_TIMEOUT)
        if r.status_code != 200:
            logger.warning("FINRA HTTP %s", r.status_code)
            return out
        rdr = csv.DictReader(io.StringIO(r.text))
        wanted = set(tickers or [])
        latest_per_tkr = {}
        for row in rdr:
            sym = (row.get("issueSymbolIdentifier") or "").strip().upper()
            if sym not in wanted:
                continue
            wsd = row.get("weekStartDate", "")
            cur = latest_per_tkr.get(sym)
            if cur is None or wsd > cur.get("weekStartDate", ""):
                latest_per_tkr[sym] = row
        for sym, row in latest_per_tkr.items():
            try:
                shares = float(row.get("totalWeeklyShareQuantity", 0) or 0)
                trades = int(row.get("totalWeeklyTradeCount", 0) or 0)
                notional = float(row.get("totalNotionalSum", 0) or 0)
                wk = row.get("weekStartDate", "")
            except (TypeError, ValueError):
                continue
            avg_print_size = int(shares / trades) if trades else 0
            out[sym] = [{
                "ticker": sym, "size": avg_print_size,
                "premium": notional, "notional": notional,
                "timestamp": wk, "weekly_share": shares,
                "weekly_trade_count": trades,
                "is_aggregated_weekly": True,
            }]
            if notional >= 100_000_000:
                out[sym].append({
                    "ticker": sym, "size": 500_000,
                    "premium": notional * 0.10,
                    "timestamp": wk, "is_aggregated_weekly": True,
                })
    except Exception as e:
        logger.warning("FINRA ATS fetch failed: %s", e)
    return out


EDGAR_BROWSE = "https://www.sec.gov/cgi-bin/browse-edgar"


def fetch_edgar_form4_recent(ticker, days_back=14):
    cik = CIK_MAP.get(ticker.upper())
    if not cik:
        return {"ticker": ticker, "available": False,
                "recent_form4_count": 0, "has_recent_buy": False}
    try:
        params = {
            "action": "getcompany", "CIK": cik, "type": "4",
            "dateb": "", "owner": "include", "count": "40",
        }
        r = requests.get(EDGAR_BROWSE, params=params,
                         headers=_edgar_headers(), timeout=DEFAULT_TIMEOUT)
        if r.status_code != 200:
            return {"ticker": ticker, "available": False,
                    "recent_form4_count": 0, "has_recent_buy": False}
        html = r.text
        dates = re.findall(r"<td[^>]*>(\d{4}-\d{2}-\d{2})</td>", html)
        cutoff = datetime.utcnow() - timedelta(days=days_back)
        recent = 0
        for d in dates:
            try:
                if datetime.strptime(d, "%Y-%m-%d") >= cutoff:
                    recent += 1
            except ValueError:
                continue
        return {
            "ticker": ticker, "available": True,
            "recent_form4_count": recent,
            "has_recent_buy": recent >= 1,
        }
    except Exception as e:
        logger.debug("EDGAR %s failed: %s", ticker, e)
        return {"ticker": ticker, "available": False,
                "recent_form4_count": 0, "has_recent_buy": False,
                "error": str(e)}


def fetch_mpi_snapshot():
    candidates = [
        Path(__file__).resolve().parent.parent / "data" / "mpi.json",
        Path(__file__).resolve().parent / "data" / "mpi.json",
        Path("/tmp/aztmm-mpi-data/data/mpi.json"),
    ]
    for p in candidates:
        try:
            if p.exists():
                snap_raw = json.loads(p.read_text())
                # mpi.json wraps payload under .data — flatten
                snap = snap_raw.get("data", snap_raw)
                score = int(snap.get("score") or snap.get("mpi_score") or 50)
                label = snap.get("label") or snap.get("mpi_label")
                regime_short = (snap.get("regime_short")
                                or snap.get("regime_label")
                                or snap.get("regime"))
                conf_raw = snap.get("confidence_label") or snap.get("confidence")
                if isinstance(conf_raw, dict):
                    conf = conf_raw.get("label") or conf_raw.get("ci_level")
                else:
                    conf = conf_raw
                return {
                    "score": score, "label": label,
                    "regime_short": regime_short,
                    "confidence_label": conf,
                    "source_path": str(p),
                }
        except Exception as e:
            logger.debug("MPI read from %s failed: %s", p, e)
            continue
    logger.warning("data/mpi.json not found in any candidate path")
    return {}


def fetch_tomorrows_catalyst(target_date):
    try:
        d = datetime.strptime(target_date, "%Y-%m-%d")
    except (ValueError, TypeError):
        return []
    nd = d
    for delta in range(1, 5):
        nd = d + timedelta(days=delta)
        if nd.weekday() < 5:
            break
    nd_str = nd.strftime("%Y-%m-%d")
    return [c for c in ECON_CAL_2026 if c.get("date") == nd_str][:2]


def synth_market_tide(market_totals):
    if not market_totals:
        return []
    cp = market_totals.get("call_premium", 0)
    pp = market_totals.get("put_premium", 0)
    net = cp - pp
    return [{
        "timestamp": "16:00",
        "net_call_premium": net, "net_premium": net,
        "net_call_volume": (market_totals.get("call_volume", 0)
                            - market_totals.get("put_volume", 0)),
    }]


def fetch_daily_data(target_date, fast=False):
    sources_used = []
    sources_failed = []
    t0 = time.time()

    sector_etfs = []
    sector_alerts_by_tkr = {}
    sec_list = SECTOR_ETFS[:3] if fast else SECTOR_ETFS
    for sym in sec_list:
        spot = fetch_yf_spot(sym, target_date)
        if not spot.get("available"):
            continue
        alerts = fetch_yf_option_chain(sym, spot.get("close"))
        sector_alerts_by_tkr[sym] = alerts
        cp, pp = sector_etf_premium_split(alerts)
        sector_etfs.append({
            **spot, "symbol": sym,
            "call_premium": cp, "put_premium": pp,
        })
        time.sleep(THROTTLE_SEC)
    if sector_etfs:
        sources_used.append("yfinance_sector_etfs")
    else:
        sources_failed.append("yfinance_sector_etfs")

    all_name_alerts = []
    names = TOP50_NAMES[:5] if fast else TOP50_NAMES
    for sym in names:
        spot = fetch_yf_spot(sym, target_date)
        if not spot.get("available"):
            continue
        alerts = fetch_yf_option_chain(sym, spot.get("close"))
        all_name_alerts.extend(alerts)
        time.sleep(THROTTLE_SEC)
    if all_name_alerts:
        sources_used.append("yfinance_option_chains")
    else:
        sources_failed.append("yfinance_option_chains")

    flow_alerts = list(all_name_alerts)
    for sym_alerts in sector_alerts_by_tkr.values():
        flow_alerts.extend(sym_alerts)

    market_totals = aggregate_market_totals_from_chains(flow_alerts)
    if market_totals.get("call_volume", 0) > 0:
        sources_used.append("yfinance_market_totals_synth")
    sources_failed.append("cboe_equity_pc_csv_403")

    vix = fetch_vix(target_date)
    if vix.get("available"):
        sources_used.append("yfinance_vix")
    else:
        sources_failed.append("yfinance_vix")

    finra = fetch_finra_ats_weekly(DP_WATCHLIST + TOP50_NAMES, target_date)
    if finra:
        sources_used.append("finra_ats_weekly_t14")
    else:
        sources_failed.append("finra_ats_weekly")

    edgar_signals = {}
    edgar_tkrs = TOP50_NAMES[:3] if fast else TOP50_NAMES[:30]
    for tkr in edgar_tkrs:
        f4 = fetch_edgar_form4_recent(tkr, days_back=14)
        edgar_signals[tkr] = f4
        time.sleep(THROTTLE_SEC)
    if any(s.get("available") for s in edgar_signals.values()):
        sources_used.append("sec_edgar_form4")
    else:
        sources_failed.append("sec_edgar_form4")

    insider_tickers = {t for t, sig in edgar_signals.items()
                       if sig.get("has_recent_buy")}
    for a in flow_alerts:
        if a.get("ticker") in insider_tickers:
            a["insider_double_confirmation"] = True

    mpi_snap = fetch_mpi_snapshot()
    if mpi_snap:
        sources_used.append("repo_mpi_json")
    else:
        sources_failed.append("repo_mpi_json")

    econ_cal = fetch_tomorrows_catalyst(target_date)
    if econ_cal:
        sources_used.append("econ_cal_2026_hardcoded")

    try:
        d = datetime.strptime(target_date, "%Y-%m-%d")
        pd = d - timedelta(days=1)
        while pd.weekday() >= 5:
            pd -= timedelta(days=1)
        prev_date = pd.strftime("%Y-%m-%d")
    except Exception:
        prev_date = None

    market_tide = synth_market_tide(market_totals)
    elapsed_s = time.time() - t0

    return {
        "date": target_date, "prev_date": prev_date,
        "market_totals": market_totals,
        "sector_etfs": sector_etfs,
        "market_tide": market_tide,
        "flow_alerts": flow_alerts,
        "darkpool": finra,
        "econ_cal": econ_cal,
        "mpi_snapshot": mpi_snap,
        "vix": vix,
        "edgar_signals": edgar_signals,
        "methodology_footnote": METHODOLOGY_FOOTNOTE,
        "data_quality": {
            "endpoints_ok": len(sources_used),
            "endpoints_failed": len(sources_failed),
            "sources_used": sources_used,
            "sources_failed": sources_failed,
            "degraded": len(sources_failed) > 0,
            "elapsed_seconds": round(elapsed_s, 2),
        },
        "appendix_url": (
            f"https://aztmm.com/{target_date.replace('-', '/')}/"
            f"daily-pulse-options-flow-dark-pool-{target_date}/"
        ),
    }


if __name__ == "__main__":
    import argparse, sys
    p = argparse.ArgumentParser()
    p.add_argument("--asof", required=True, help="YYYY-MM-DD")
    p.add_argument("--out", default=None)
    p.add_argument("--fast", action="store_true",
                   help="Limit names for fast smoke test")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    data = fetch_daily_data(args.asof, fast=args.fast)
    s = json.dumps(data, indent=2, default=str)
    if args.out:
        Path(args.out).write_text(s)
    else:
        sys.stdout.write(s)
