"""
Earnings Flow Flag Tracker -- Free-source fetcher (yfinance only).
PATH A LOCKED 2026-05-15: No Unusual Whales. Sources are yfinance earnings
calendar + yfinance EOD options chain.
"""
from __future__ import annotations
import argparse, json, math, sys, time
from datetime import datetime, date, timezone
from pathlib import Path
import yfinance as yf

WATCHLIST = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B", "AVGO",
    "LLY", "JPM", "V", "UNH", "XOM", "MA", "JNJ", "PG", "HD", "COST", "ABBV",
    "MRK", "CVX", "ADBE", "WMT", "CRM", "PEP", "BAC", "KO", "ORCL", "ACN",
    "MCD", "AMD", "TMO", "LIN", "CSCO", "ABT", "NFLX", "WFC", "DIS", "DHR",
    "INTC", "VZ", "QCOM", "INTU", "AMGN", "PFE", "TXN", "IBM", "PM", "GE",
]

def _sf(x):
    try:
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except (TypeError, ValueError):
        return None

def get_earnings_date(ticker):
    try:
        cal = ticker.calendar
        if isinstance(cal, dict):
            ed = cal.get("Earnings Date")
            if isinstance(ed, list) and ed:
                ed = ed[0]
            if hasattr(ed, "date"):
                return ed.date()
            if isinstance(ed, date):
                return ed
        df = ticker.get_earnings_dates(limit=8)
        if df is not None and not df.empty:
            today = datetime.utcnow().date()
            for idx in df.index:
                d = idx.date() if hasattr(idx, "date") else idx
                if d >= today:
                    return d
    except Exception:
        pass
    return None

def get_eps_estimate(ticker):
    try:
        cal = ticker.calendar
        if isinstance(cal, dict):
            eps = cal.get("Earnings Average") or cal.get("Earnings Estimate")
            if isinstance(eps, list) and eps:
                return _sf(eps[0])
            return _sf(eps)
    except Exception:
        pass
    return None

def get_spot(ticker):
    try:
        info = ticker.fast_info
        if hasattr(info, "last_price") and info.last_price:
            return _sf(info.last_price)
    except Exception:
        pass
    try:
        hist = ticker.history(period="5d", auto_adjust=False)
        if not hist.empty:
            return _sf(hist["Close"].iloc[-1])
    except Exception:
        pass
    return None

def pick_expiry_after(ticker, after_date):
    try:
        exps = ticker.options
        if not exps:
            return None
        for e in exps:
            try:
                d = datetime.strptime(e, "%Y-%m-%d").date()
            except ValueError:
                continue
            if d >= after_date:
                return e
        return exps[0] if exps else None
    except Exception:
        return None

def compute_implied_move(ticker, expiry, spot):
    try:
        chain = ticker.option_chain(expiry)
        calls, puts = chain.calls, chain.puts
        if calls is None or puts is None or calls.empty or puts.empty:
            return None, None, None, None
        calls = calls.copy(); puts = puts.copy()
        calls["dist"] = (calls["strike"] - spot).abs()
        puts["dist"] = (puts["strike"] - spot).abs()
        atm_c = calls.sort_values("dist").iloc[0]
        atm_p = puts.sort_values("dist").iloc[0]
        def mid(row):
            bid = _sf(row.get("bid")); ask = _sf(row.get("ask"))
            if bid and ask and bid > 0 and ask > 0:
                return (bid + ask) / 2.0
            return _sf(row.get("lastPrice"))
        c_px = mid(atm_c); p_px = mid(atm_p)
        if not c_px or not p_px or not spot:
            return None, None, None, None
        straddle = c_px + p_px
        im_pct = (straddle / spot) * 100.0
        iv = ((_sf(atm_c.get("impliedVolatility")) or 0) + (_sf(atm_p.get("impliedVolatility")) or 0)) / 2.0
        return (round(im_pct, 2),
                round(iv * 100.0, 2) if iv else None,
                int(_sf(atm_c.get("openInterest")) or 0),
                int(_sf(atm_p.get("openInterest")) or 0))
    except Exception:
        return None, None, None, None

def build_record(symbol, window_days=14, sleep_s=1.0):
    try:
        t = yf.Ticker(symbol)
        ed = get_earnings_date(t)
        if not ed:
            return None
        today = datetime.utcnow().date()
        delta = (ed - today).days
        if delta < 0 or delta > window_days:
            return None
        spot = get_spot(t)
        if not spot:
            return None
        expiry = pick_expiry_after(t, ed)
        if not expiry:
            return None
        im, iv, c_oi, p_oi = compute_implied_move(t, expiry, spot)
        time.sleep(sleep_s)
        return {"ticker": symbol, "earnings_date": ed.isoformat(),
                "days_to_earnings": delta, "spot": round(spot, 2),
                "implied_move_pct": im, "iv_atm": iv,
                "call_oi_atm": c_oi, "put_oi_atm": p_oi,
                "expiry_used": expiry, "eps_estimate": get_eps_estimate(t)}
    except Exception as e:
        print("  ! " + symbol + ": " + str(e), file=sys.stderr)
        return None

def render_html(records, asof_str):
    rows = []
    for r in sorted(records, key=lambda x: (x["days_to_earnings"], x["ticker"])):
        im = r.get("implied_move_pct")
        im_s = ("&plusmn;" + str(im) + "%") if im is not None else "&mdash;"
        iv = r.get("iv_atm")
        iv_s = (str(iv) + "%") if iv is not None else "&mdash;"
        c_oi = r.get("call_oi_atm") or 0
        p_oi = r.get("put_oi_atm") or 0
        rows.append(
            "<tr>"
            + "<td style=\"padding:8px 12px;font-weight:600;\">" + r["ticker"] + "</td>"
            + "<td style=\"padding:8px 12px;\">" + r["earnings_date"] + "</td>"
            + "<td style=\"padding:8px 12px;text-align:center;\">" + str(r["days_to_earnings"]) + "d</td>"
            + "<td style=\"padding:8px 12px;text-align:right;\">$" + str(r["spot"]) + "</td>"
            + "<td style=\"padding:8px 12px;text-align:right;\">" + im_s + "</td>"
            + "<td style=\"padding:8px 12px;text-align:right;\">" + iv_s + "</td>"
            + "<td style=\"padding:8px 12px;text-align:right;\">" + "{:,}".format(c_oi) + "</td>"
            + "<td style=\"padding:8px 12px;text-align:right;\">" + "{:,}".format(p_oi) + "</td>"
            + "</tr>")
    table = "\n".join(rows) if rows else "<tr><td colspan=\"8\" style=\"padding:24px;text-align:center;opacity:.6;\">No names within 14-day earnings window.</td></tr>"
    return (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;background:#0f172a;padding:20px;border-radius:12px;\">\n"
        "  <div style=\"display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;\">\n"
        "    <div>\n"
        "      <div style=\"font-size:18px;font-weight:700;color:#f8fafc;\">Earnings Flow &mdash; 14-day window</div>\n"
        "      <div style=\"font-size:12px;opacity:.6;\">Source: yfinance EOD options chain. Updated " + asof_str + ".</div>\n"
        "    </div>\n"
        "    <div style=\"font-size:11px;opacity:.5;\">Observation only &middot; not advice</div>\n"
        "  </div>\n"
        "  <div style=\"overflow-x:auto;\">\n"
        "  <table style=\"width:100%;border-collapse:collapse;font-size:13px;\">\n"
        "    <thead><tr style=\"background:#1e293b;color:#94a3b8;text-align:left;\">\n"
        "      <th style=\"padding:10px 12px;\">Ticker</th>\n"
        "      <th style=\"padding:10px 12px;\">Earnings</th>\n"
        "      <th style=\"padding:10px 12px;text-align:center;\">DTE</th>\n"
        "      <th style=\"padding:10px 12px;text-align:right;\">Spot</th>\n"
        "      <th style=\"padding:10px 12px;text-align:right;\">Implied Move</th>\n"
        "      <th style=\"padding:10px 12px;text-align:right;\">ATM IV</th>\n"
        "      <th style=\"padding:10px 12px;text-align:right;\">ATM Call OI</th>\n"
        "      <th style=\"padding:10px 12px;text-align:right;\">ATM Put OI</th>\n"
        "    </tr></thead>\n"
        "    <tbody>\n      " + table + "\n    </tbody>\n"
        "  </table></div>\n"
        "  <div style=\"margin-top:14px;font-size:11px;opacity:.5;line-height:1.5;\">\n"
        "    Implied move = ATM straddle / spot at nearest post-earnings expiry. EOD-only updates. Observation log, not recommendations.\n"
        "  </div>\n</div>")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="sample-output")
    ap.add_argument("--universe-size", type=int, default=50)
    ap.add_argument("--window-days", type=int, default=14)
    ap.add_argument("--sleep", type=float, default=1.0)
    args = ap.parse_args()
    universe = WATCHLIST[: args.universe_size]
    today = datetime.utcnow().date()
    asof = today.isoformat()
    print("[yf_fetcher] PATH A LOCKED 2026-05-15. Universe=" + str(len(universe)) + " window=" + str(args.window_days) + "d", flush=True)
    records = []
    for i, sym in enumerate(universe, 1):
        print("  [" + str(i) + "/" + str(len(universe)) + "] " + sym + "...", flush=True)
        rec = build_record(sym, window_days=args.window_days, sleep_s=args.sleep)
        if rec:
            print("    -> earnings " + rec["earnings_date"] + " (D-" + str(rec["days_to_earnings"]) + ") IM=" + str(rec.get("implied_move_pct")) + "%", flush=True)
            records.append(rec)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    now_utc = datetime.now(timezone.utc)
    public = {"asof": asof, "as_of": asof, "as_of_date": asof, "date": asof,
              "computed_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
              "generated_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
              "source": "yfinance",
              "universe_size": len(universe), "window_days": args.window_days,
              "count": len(records), "records": records,
              "path_a_locked": "2026-05-15"}
    (out_dir / ("earnings-flow-" + asof + ".public.json")).write_text(json.dumps(public, indent=2))
    (out_dir / "latest.json").write_text(json.dumps(public, indent=2))
    html = render_html(records, asof)
    (out_dir / ("earnings-flow-" + asof + ".html")).write_text(html)
    (out_dir / "latest.html").write_text(html)
    print("[yf_fetcher] Wrote " + str(len(records)) + " records -> " + str(out_dir) + "/", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
