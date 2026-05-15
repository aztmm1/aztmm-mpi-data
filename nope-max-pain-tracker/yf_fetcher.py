"""
AZTMM NOPE & Max-Pain Tracker -- yfinance Fetcher (Path A locked, 2026-05-15)
Replaces UW-based fetcher. EOD options chain from yfinance + math.

Methodology:
  MAX PAIN (classic):
    payout(K) = sum_calls(max(K - Sk, 0) * OI_call) + sum_puts(max(Sk - K, 0) * OI_put)
    max_pain = argmin payout(K)
  NOPE (delta-volume, normalised by share volume, percent units):
    NOPE = (sum(call_delta * call_vol) + sum(put_delta * put_vol)) / share_vol * 100
    BS delta with sigma=0.25, r=0.045, T = days_to_exp/365.
Universe: SPY, SPX (via SPY chain proxy), QQQ.
"""
from __future__ import annotations
import json, math, time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, date
from pathlib import Path
import yfinance as yf

UNIVERSE = ["SPY", "SPX", "QQQ"]
SPX_PROXY = "SPY"
SIGMA, RISK_FREE = 0.25, 0.045
MAGNET_PCT = 1.0
THROTTLE = 0.4


def _isnan(x):
    try: return math.isnan(float(x))
    except (TypeError, ValueError): return False


def _norm_cdf(x): return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bs_delta(S, K, T, sigma, r, is_call):
    if S <= 0 or K <= 0 or T <= 0 or sigma <= 0:
        if is_call: return 1.0 if S > K else 0.0
        return -1.0 if S < K else 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * math.sqrt(T))
    return _norm_cdf(d1) if is_call else _norm_cdf(d1) - 1.0


@dataclass
class ExpiryRow:
    expiry: str; type: str; max_pain_strike: float
    total_oi_calls: int; total_oi_puts: int; magnet: bool
    oi_fallback_used_volume: bool = False

@dataclass
class TickerRow:
    ticker: str; spot: float; share_volume: int; nope_score: float
    expiries: list = field(default_factory=list)
    data_quality: dict = field(default_factory=dict)


def _compute_max_pain(calls_df, puts_df):
    call_strikes = list(calls_df["strike"])
    call_oi = [int(x) if x and not _isnan(x) else 0 for x in calls_df["openInterest"]]
    put_strikes = list(puts_df["strike"])
    put_oi  = [int(x) if x and not _isnan(x) else 0 for x in puts_df["openInterest"]]
    used_fallback=False
    if sum(call_oi)==0 and sum(put_oi)==0:
        used_fallback=True
        call_oi=[int(x) if x and not _isnan(x) else 0 for x in calls_df["volume"].fillna(0)]
        put_oi =[int(x) if x and not _isnan(x) else 0 for x in puts_df["volume"].fillna(0)]
    strikes = sorted(set(call_strikes + put_strikes))
    if not strikes: return (0.0, 0, 0, used_fallback)
    best_K, best_pain = strikes[0], None
    for K in strikes:
        pain = 0.0
        for sk, oi in zip(call_strikes, call_oi):
            if K > sk and oi > 0: pain += (K - sk) * oi
        for sk, oi in zip(put_strikes, put_oi):
            if sk > K and oi > 0: pain += (sk - K) * oi
        if best_pain is None or pain < best_pain:
            best_pain, best_K = pain, K
    return (float(best_K), sum(call_oi), sum(put_oi), used_fallback)


def _nope_contrib(calls_df, puts_df, S, T):
    total = 0.0
    for _, row in calls_df.iterrows():
        K, V = float(row.get("strike", 0) or 0), float(row.get("volume", 0) or 0)
        if _isnan(V) or V <= 0 or K <= 0: continue
        total += bs_delta(S, K, T, SIGMA, RISK_FREE, True) * V
    for _, row in puts_df.iterrows():
        K, V = float(row.get("strike", 0) or 0), float(row.get("volume", 0) or 0)
        if _isnan(V) or V <= 0 or K <= 0: continue
        total += bs_delta(S, K, T, SIGMA, RISK_FREE, False) * V
    return total


def _pick_expiries(all_exp, today):
    parsed = []
    for s in all_exp:
        try:
            d = datetime.strptime(s, "%Y-%m-%d").date()
            if d > today: parsed.append(d)
        except ValueError: pass
    parsed.sort()
    if not parsed: return []
    near = parsed[0]
    monthly = None
    for d in parsed:
        if d.weekday() == 4 and 15 <= d.day <= 21 and d > near:
            monthly = d; break
    out = [(near.strftime("%Y-%m-%d"), "near")]
    if monthly and monthly != near:
        out.append((monthly.strftime("%Y-%m-%d"), "monthly"))
    return out


def fetch_one(label):
    chain_t = SPX_PROXY if label == "SPX" else label
    tk = yf.Ticker(chain_t)
    h = tk.history(period="2d", auto_adjust=False)
    if h is None or h.empty:
        return TickerRow(label, 0.0, 0, 0.0, [], {"error": "no spot history"})
    spot = float(h["Close"].iloc[-1])
    svol = int(h["Volume"].iloc[-1]) if not _isnan(h["Volume"].iloc[-1]) else 0
    all_exp = list(tk.options or [])
    if not all_exp:
        return TickerRow(label, spot, svol, 0.0, [], {"error": "no options chain"})
    today = date.today()
    picks = _pick_expiries(all_exp, today)
    exps, nope_num = [], 0.0
    for exp_str, exp_type in picks:
        try: ch = tk.option_chain(exp_str)
        except Exception: continue
        if ch.calls.empty and ch.puts.empty: continue
        exp_d = datetime.strptime(exp_str, "%Y-%m-%d").date()
        T = max((exp_d - today).days, 1) / 365.0
        nope_num += _nope_contrib(ch.calls, ch.puts, spot, T)
        mp, c_oi, p_oi, fb = _compute_max_pain(ch.calls, ch.puts)
        mag = abs(spot - mp) / spot * 100.0 <= MAGNET_PCT if spot > 0 else False
        exps.append(ExpiryRow(exp_str, exp_type, mp, c_oi, p_oi, mag, fb))
        time.sleep(THROTTLE)
    nope = (nope_num / svol * 100.0) if svol > 0 else 0.0
    return TickerRow(label, round(spot, 2), svol, round(nope, 3), exps,
                     {"expiries_priced": len(exps), "expiries_picked": len(picks)})


def run(out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for t in UNIVERSE:
        try: rows.append(fetch_one(t))
        except Exception as e:
            rows.append(TickerRow(t, 0.0, 0, 0.0, [], {"error": str(e)[:200]}))
        time.sleep(THROTTLE)
    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "as_of_date": date.today().strftime("%Y-%m-%d"),
        "methodology": "yfinance EOD chain; BS delta sigma=0.25 r=0.045; classic max-pain; NOPE = sum(delta*volume)/share_volume*100",
        "source": "yfinance",
        "path": "A-locked-2026-05-15",
        "universe": UNIVERSE,
        "tickers": [{
            "ticker": r.ticker, "spot": r.spot, "share_volume": r.share_volume,
            "nope_score": r.nope_score,
            "expiries": [asdict(e) for e in r.expiries],
            "data_quality": r.data_quality,
        } for r in rows],
    }
    out = out_dir / f"nope-maxpain-{payload['as_of_date']}.public.json"
    out.write_text(json.dumps(payload, indent=2))
    (out_dir / "latest.json").write_text(json.dumps(payload, indent=2))
    return out


if __name__ == "__main__":
    print(f"wrote {run(Path(__file__).parent / 'sample-output')}")
