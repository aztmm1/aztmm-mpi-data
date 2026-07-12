#!/usr/bin/env python3
"""AZTMM public QA self-audit (rubric v2.2, CI edition).

Nightly scorer for the published data surface. Writes data/qa.json.
Ground truth comes from the same public sources the pipeline draws on
(Stooq for SPY closes, CBOE for VIX closes); site checks use the public
WordPress REST API. Stdlib only - no secrets, no deps.

Grade: A>=90 B>=80 C>=70 D>=60 else F. Any CRITICAL fail caps at C.
Checks that cannot be evaluated (source unreachable) award their points
but are flagged unverified=true in the output - disclosed, never hidden.
"""
import csv
import io
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROOT = next(p for p in Path(__file__).resolve().parents if (p / "data" / "mpi.json").exists())

HOLIDAYS_2026 = {"2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
                 "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
                 "2026-11-26", "2026-12-25"}


def is_trading_day(d):
    return d.weekday() < 5 and d.strftime("%Y-%m-%d") not in HOLIDAYS_2026


def last_completed_session(now_et):
    """Most recent trading day whose close (16:00 ET) has passed."""
    d = now_et.date()
    if now_et.hour < 16 or not is_trading_day(d):
        d -= timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "aztmm-qa/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def fetch_json(url):
    return json.loads(fetch(url))


def stooq_close(symbol, date_str):
    d = date_str.replace("-", "")
    txt = fetch(f"https://stooq.com/q/d/l/?s={symbol}&d1={d}&d2={d}&i=d")
    rows = list(csv.DictReader(io.StringIO(txt)))
    return float(rows[0]["Close"]) if rows else None


def cboe_vix_close(date_str):
    txt = fetch("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv")
    for row in csv.DictReader(io.StringIO(txt)):
        raw = row.get("DATE") or row.get("Date") or ""
        try:
            iso = datetime.strptime(raw, "%m/%d/%Y").strftime("%Y-%m-%d")
        except ValueError:
            iso = raw
        if iso == date_str:
            return float(row.get("CLOSE") or row.get("Close"))
    return None


def band_label(score):
    if score > 60:
        return "Bull"
    if score < 40:
        return "Bear"
    return "Neutral"


def main():
    now_utc = datetime.now(timezone.utc)
    now_et = now_utc.astimezone(ET)
    lcs = last_completed_session(now_et)
    lcs_str = lcs.strftime("%Y-%m-%d")

    mpi = json.loads((ROOT / "data" / "mpi.json").read_text())
    canon = json.loads((ROOT / "data" / "canonical-content.json").read_text())
    ledger = json.loads(
        (ROOT / "accountability-ledger" / "sample-output" / "latest.json").read_text())

    d = mpi["data"]
    sub = d["sub_indicators"]
    checks = []

    def add(cid, cat, pts, crit, ok, detail, unverified=False):
        checks.append({"id": cid, "category": cat, "points": pts,
                       "critical": crit, "pass": bool(ok),
                       "unverified": unverified, "detail": detail})

    # ---- FRESHNESS (20) ----
    computed = datetime.fromisoformat(mpi["computed_at"].replace("Z", "+00:00"))
    post_close = datetime.combine(lcs, datetime.min.time(), ET).replace(hour=18)
    add("F1", "freshness", 5, False,
        computed >= post_close.astimezone(timezone.utc) and mpi["asOf"] >= lcs_str,
        f"computed_at {mpi['computed_at']} vs {lcs_str} 18:00 ET window; asOf {mpi['asOf']}")

    c_mpi = canon.get("mpi", {})
    gen = canon.get("generated_at", "")
    add("F2", "freshness", 5, False,
        c_mpi.get("computed_at") == mpi["computed_at"] and gen >= mpi["computed_at"],
        f"canonical embeds {c_mpi.get('computed_at')} (mpi {mpi['computed_at']}); generated {gen}")

    try:
        posts = fetch_json("https://public-api.wordpress.com/wp/v2/sites/aztmm.com/posts"
                           "?per_page=10&_fields=slug,date,status")
        dailies = [p for p in posts if p["slug"].startswith("daily-pulse")]
        latest_daily = dailies[0]["date"][:10] if dailies else "none"
        add("F3", "freshness", 4, False, latest_daily == lcs_str,
            f"latest daily pulse {latest_daily} vs last session {lcs_str}")
        weekly = any("weekly-pulse" in p["slug"] for p in posts)
        add("F4", "freshness", 2, False, weekly,
            "weekly pulse present in last 10 posts" if weekly else "no weekly pulse in last 10 posts")
    except Exception as e:
        add("F3", "freshness", 4, False, True, f"WP API unreachable ({e})", unverified=True)
        add("F4", "freshness", 2, False, True, f"WP API unreachable ({e})", unverified=True)

    f5_ok, f5_note = True, []
    for slug in ("squeeze-watch", "insider-activity"):
        try:
            fetch(f"https://aztmm.com/{slug}/")
            f5_ok = False
            f5_note.append(f"/{slug}/ still publicly served")
        except Exception:
            f5_note.append(f"/{slug}/ not public (ok)")
    add("F5", "freshness", 4, False, f5_ok, "; ".join(f5_note))

    # ---- CONSISTENCY (20) ----
    add("C1", "consistency", 6, True, d["mpi_score"] == c_mpi.get("score"),
        f"mpi {d['mpi_score']} vs canonical {c_mpi.get('score')}")
    add("C2", "consistency", 6, True, mpi["asOf"] == c_mpi.get("as_of"),
        f"asOf {mpi['asOf']} vs canonical {c_mpi.get('as_of')}")
    spy_spot = d["market"]["spy_spot"]
    add("C3", "consistency", 4, False, spy_spot == canon.get("market", {}).get("spy_close"),
        f"spy_spot {spy_spot} vs canonical {canon.get('market', {}).get('spy_close')}")
    add("C4", "consistency", 4, False, d["regime_label"] == c_mpi.get("regime"),
        f"regime_label '{d['regime_label']}' vs canonical '{c_mpi.get('regime')}'")

    # ---- METHODOLOGY (25) ----
    add("M1", "methodology", 10, True, d["mpi_label"] == band_label(d["mpi_score"]),
        f"label '{d['mpi_label']}' for score {d['mpi_score']} (band {band_label(d['mpi_score'])})")
    add("M3", "methodology", 8, False, d["regime"] == d["hmm"]["state"],
        f"regime '{d['regime']}' vs HMM state '{d['hmm']['state']}'")
    ci = d["confidence"]
    add("M4", "methodology", 3, False, ci["ci_low"] <= d["mpi_score"] <= ci["ci_high"],
        f"CI {ci['ci_low']}-{ci['ci_high']} brackets {d['mpi_score']}")
    bad = {k: v["score"] for k, v in sub.items() if not 0 <= v["score"] <= 100}
    add("M5", "methodology", 4, False, not bad, f"out-of-range sub-scores: {bad or 'none'}")

    # ---- HONESTY (20) ----
    try:
        spy_true = stooq_close("spy.us", mpi["asOf"])
        add("H1", "honesty", 8, True,
            spy_true is not None and abs(spy_spot - spy_true) <= 0.05,
            f"spy_spot {spy_spot} vs Stooq {spy_true} for {mpi['asOf']}")
    except Exception as e:
        add("H1", "honesty", 8, True, True, f"Stooq unreachable ({e})", unverified=True)
    try:
        vix_true = cboe_vix_close(mpi["asOf"])
        vix_pub = d["volatility"]["vix"]
        add("H2", "honesty", 6, False,
            vix_true is not None and abs(vix_pub - vix_true) <= 0.05,
            f"vix {vix_pub} vs CBOE {vix_true} for {mpi['asOf']}")
    except Exception as e:
        add("H2", "honesty", 6, False, True, f"CBOE unreachable ({e})", unverified=True)

    nulls = [r["ticker"] for r in ledger.get("rows", [])
             if r.get("type") == "watch" and r.get("horizon_days") == 1
             and r.get("resolved_date") and r.get("ticker")
             and r.get("note") != "no price data" and r.get("ret_1d") is None]
    add("H3", "honesty", 6, False, not nulls,
        f"resolved 1-day ticker rows with null ret_1d: {nulls or 'none'}")

    # ---- INTEGRITY (15) ----
    flat = json.dumps(sub).lower()
    add("I1", "integrity", 3, False,
        "aaii" not in flat and "putcall" not in flat and "put_call" not in flat,
        "retired feeds (AAII, put/call) absent from payload")
    i2_ok = (abs(sub["sentiment"]["score"] - sub["sentiment"].get("cnn_fg", -1)) < 0.11
             and "proxy" in sub["currency"].get("note", "").lower()
             and not any(k in flat for k in ("skew", "vix9d", "vix6m", "crude", "tips")))
    add("I2", "integrity", 7, False, i2_ok,
        "payload matches the reconciled Data Sources accounting (2026-07-07)")
    src = json.dumps(mpi.get("source_versions", {})).lower()
    add("I3", "integrity", 5, True,
        "weights" not in src and "transmat" not in json.dumps(d["hmm"]).lower(),
        "no MPI weights or HMM transition matrix in public payload")

    # ---- SCORE ----
    score = sum(c["points"] for c in checks if c["pass"])
    critical_fail = any(c["critical"] and not c["pass"] for c in checks)
    grade = ("A" if score >= 90 else "B" if score >= 80 else
             "C" if score >= 70 else "D" if score >= 60 else "F")
    if critical_fail and grade in ("A", "B"):
        grade = "C"
    cats = {}
    for c in checks:
        cats.setdefault(c["category"], [0, 0])
        cats[c["category"]][1] += c["points"]
        if c["pass"]:
            cats[c["category"]][0] += c["points"]

    out = {
        "schema_version": "1.0",
        "rubric": "v2.2",
        "generated_at": now_utc.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "as_of_session": lcs_str,
        "score": score,
        "grade": grade,
        "critical_fail": critical_fail,
        "categories": {k: {"earned": v[0], "max": v[1]} for k, v in cats.items()},
        "unverified_count": sum(1 for c in checks if c.get("unverified")),
        "checks": checks,
    }
    dest = ROOT / "data" / "qa.json"
    dest.write_text(json.dumps(out, indent=2) + chr(10))
    print(f"AZTMM QA = {score}/100 - grade {grade}"
          + (" (capped: critical fail)" if critical_fail else ""))
    for c in checks:
        flag = "PASS" if c["pass"] else "FAIL"
        if c.get("unverified"):
            flag += "?"
        print(f"  {c['id']:3} {flag:5} {c['detail']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
