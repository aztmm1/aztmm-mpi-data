#!/usr/bin/env python3
"""AZTMM Accountability Ledger — extract observations from the Daily Pulse and score them.

Nightly pipeline (GitHub Actions, $0 infra):
  1. EXTRACT  — fetch the latest Daily Pulse post(s) from the public WordPress REST API,
                parse the "Names on our radar" table, the "What to watch" bullets, and the
                regime strip into structured, append-only ledger rows.
  2. SCORE    — resolve open rows past their horizon against end-of-day auto-adjusted
                closes (yfinance), using trading-day offsets taken from the price index
                itself (never calendar-day arithmetic).
  3. EMIT     — data/calls.json (full append-only history) and
                accountability-ledger/sample-output/latest.{json,html} (daily snapshot,
                satisfies the daily-update guarantee: latest.json always carries a fresh
                `date` key).

Status vocabulary is strictly: open / hit / invalidated / unresolved.
History is append-only: resolved rows are never modified, ids are never duplicated.

Dependencies: Python 3.10+ stdlib, beautifulsoup4 (parsing backend stays html.parser),
yfinance (only needed for the scoring step; install both in the workflow).

Exit codes: 0 = success, 3 = nothing to do (no new rows, no score changes, snapshot
already fresh for today), anything else = real failure.
"""

from __future__ import annotations

import argparse
import bisect
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover - tz database missing
    ET = None

API_URL = (
    "https://public-api.wordpress.com/wp/v2/sites/aztmm.com/posts"
    "?categories=730419628&per_page=3&_fields=id,date,link,title,content,slug"
)

USER_AGENT = "aztmm-accountability-ledger/1.0 (+https://aztmm.com)"

# Direction inference vocabularies (matched as lowercase substrings).
BULLISH_WORDS = (
    "call buying", "accumulation", "floor", "support", "upside", "call sweep",
)
BEARISH_WORDS = (
    "put buying", "distribution", "hedging", "downside", "breakdown",
)

# Tickers we always accept in "What to watch" bullets.
KNOWN_TICKERS = {"SPY", "QQQ", "IWM", "VIX"}

# Uppercase tokens that look like tickers but are not.
TICKER_BLOCKLIST = {
    "A", "I", "AM", "PM", "ET", "EST", "EDT", "EOD", "IV", "OI", "ATM", "OTM",
    "ITM", "DTE", "ETF", "AI", "CEO", "CFO", "FED", "FOMC", "CPI", "PPI",
    "GDP", "USD", "NBBO", "MPI", "VS", "VWAP", "OPEX", "YTD", "EPS", "PE",
    "THE", "AND", "FOR", "NOT", "ALL", "OUR", "EOW", "LOD", "HOD", "RSI",
    "MACD", "SMA", "EMA", "USA", "UK", "EU", "Q", "QQ",
}

TICKER_RE = re.compile(r"\$?\b([A-Z]{1,5})\b")

STATEMENT_LIMIT_RADAR = 200
STATEMENT_LIMIT_WATCH = 250


def log(msg: str) -> None:
    print(f"[ledger] {msg}", file=sys.stderr)


def today_et() -> str:
    if ET is not None:
        return datetime.now(ET).strftime("%Y-%m-%d")
    return datetime.utcnow().strftime("%Y-%m-%d")


def clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def truncate(s: str, limit: int) -> str:
    s = clean_text(s)
    if len(s) <= limit:
        return s
    return s[: limit - 1].rstrip() + "…"


def infer_direction(text: str) -> str:
    """Return 'up', 'down', or 'watch' (no directional read) from observation text."""
    t = text.lower()
    bull = sum(1 for w in BULLISH_WORDS if w in t)
    bear = sum(1 for w in BEARISH_WORDS if w in t)
    if bull > bear:
        return "up"
    if bear > bull:
        return "down"
    return "watch"


def first_ticker(text: str) -> str | None:
    """First ticker-like token in a bullet, with a blocklist for common words."""
    for m in TICKER_RE.finditer(text):
        tok = m.group(1)
        if tok in KNOWN_TICKERS:
            return tok
        if tok in TICKER_BLOCKLIST:
            continue
        # Require either a $ prefix or length >= 2 to cut single-letter noise.
        if text[m.start()] == "$" or len(tok) >= 2:
            return tok
    return None


# ---------------------------------------------------------------------------
# EXTRACT
# ---------------------------------------------------------------------------

def fetch_posts() -> list[dict]:
    """Fetch the latest Daily Pulse posts from the public WP REST API (3 retries)."""
    last_err: Exception | None = None
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(API_URL, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                posts = json.loads(resp.read().decode("utf-8"))
            if not isinstance(posts, list):
                raise ValueError("unexpected API payload (not a list)")
            return posts
        except Exception as e:  # noqa: BLE001 - keep the run alive
            last_err = e
            log(f"WP API fetch attempt {attempt}/3 failed: {e}")
            if attempt < 3:
                time.sleep(10)
    log(f"WP API unreachable after 3 attempts ({last_err}); skipping extraction.")
    return []


def extract_rows_from_post(post: dict) -> list[dict]:
    """Parse one rendered Daily Pulse post into ledger rows."""
    from bs4 import BeautifulSoup  # declared in the workflow; backend is html.parser

    slug = post.get("slug") or f"post-{post.get('id', 'unknown')}"
    post_date = str(post.get("date", ""))[:10]
    content = post.get("content") or {}
    html = content.get("rendered") if isinstance(content, dict) else str(content)
    if not html or not post_date:
        log(f"post {slug}: missing content or date; skipped")
        return []

    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []

    def base_row(row_id: str, row_type: str) -> dict:
        return {
            "id": row_id,
            "date": post_date,
            "type": row_type,
            "ticker": None,
            "statement": "",
            "direction": "watch",
            "horizon_days": 21,
            "status": "open",
            "ret_5d": None,
            "ret_21d": None,
            "resolved_date": None,
            "note": None,
        }

    # --- radar table: header Ticker | Signal | Read -------------------------
    for table in soup.find_all("table"):
        header = [clean_text(th.get_text()).lower() for th in table.find_all("th")]
        if header[:3] != ["ticker", "signal", "read"]:
            continue
        body = table.find("tbody") or table
        for tr in body.find_all("tr"):
            cells = [clean_text(td.get_text()) for td in tr.find_all("td")]
            if len(cells) < 3:
                continue
            ticker = cells[0].upper().lstrip("$")
            if not re.fullmatch(r"[A-Z]{1,6}", ticker):
                continue
            statement = truncate(f"{cells[1]} — {cells[2]}", STATEMENT_LIMIT_RADAR)
            row = base_row(f"{slug}:{ticker}", "radar")
            row.update(
                ticker=ticker,
                statement=statement,
                direction=infer_direction(f"{cells[1]} {cells[2]}"),
                horizon_days=21,
            )
            rows.append(row)
        break  # one radar table per post

    # --- "What to watch into ..." bullets -----------------------------------
    for heading in soup.find_all(["h2", "h3"]):
        if not clean_text(heading.get_text()).lower().startswith("what to watch"):
            continue
        ul = heading.find_next("ul")
        if ul is None:
            break
        for i, li in enumerate(ul.find_all("li"), start=1):
            text = clean_text(li.get_text())
            if not text:
                continue
            row = base_row(f"{slug}:watch{i}", "watch")
            row.update(
                ticker=first_ticker(text),
                statement=truncate(text, STATEMENT_LIMIT_WATCH),
                direction=infer_direction(text),
                horizon_days=1,
                ret_5d=None,
                ret_21d=None,
            )
            row["ret_1d"] = None
            rows.append(row)
        break

    # --- regime strip --------------------------------------------------------
    strip = soup.find(class_="dp-strip")
    strip_text = clean_text(strip.get_text(" ")) if strip else clean_text(soup.get_text(" "))
    m = re.search(r"Regime\s+([A-Za-z]+(?:\s*[·•]\s*[A-Za-z]+)?)", strip_text)
    if m:
        label = clean_text(m.group(1))
        word = label.split()[0].lower()
        direction = {"bull": "up", "bear": "down", "crisis": "down", "neutral": "flat"}.get(word)
        if direction is None:
            log(f"post {slug}: unrecognized regime label '{label}'; no regime row")
        else:
            row = base_row(f"{slug}:regime", "regime")
            row.update(
                ticker="SPY",
                statement=f"Regime {label}",
                direction=direction,
                horizon_days=21,
            )
            rows.append(row)

    return rows


# ---------------------------------------------------------------------------
# SCORE
# ---------------------------------------------------------------------------

def yf_symbol(ticker: str) -> str:
    return "^VIX" if ticker == "VIX" else ticker


def download_closes(tickers: list[str], start: str) -> dict[str, tuple[list[str], list[float]]]:
    """Batch-download auto-adjusted daily closes. Retries 3x; never raises."""
    try:
        import yfinance as yf
        import pandas as pd
    except Exception as e:  # pragma: no cover
        log(f"yfinance unavailable ({e}); scoring skipped.")
        return {}

    symbols = sorted({yf_symbol(t) for t in tickers})
    df = None
    for attempt in range(1, 4):
        try:
            df = yf.download(
                symbols,
                start=start,
                auto_adjust=True,
                progress=False,
                group_by="ticker",
                threads=False,
            )
            if df is None or df.empty:
                raise RuntimeError("empty price frame")
            break
        except Exception as e:  # noqa: BLE001
            log(f"yfinance download attempt {attempt}/3 failed: {e}")
            df = None
            if attempt < 3:
                time.sleep(10)
    if df is None:
        log("price download failed after 3 attempts; partial run, scoring skipped.")
        return {}

    # Partial-bar guard: production runs after the close, but a manual run during
    # market hours would see an incomplete intraday bar for today. Never score
    # against it — only trust today's bar after 16:15 ET.
    max_date = today_et()
    if ET is not None:
        now = datetime.now(ET)
        if (now.hour, now.minute) < (16, 15):
            max_date = (now - timedelta(days=1)).strftime("%Y-%m-%d")

    out: dict[str, tuple[list[str], list[float]]] = {}
    for t in {t for t in tickers}:
        sym = yf_symbol(t)
        try:
            if isinstance(df.columns, pd.MultiIndex):
                series = df[sym]["Close"].dropna()
            else:
                series = df["Close"].dropna()
            pairs = [
                (d.strftime("%Y-%m-%d"), float(v))
                for d, v in zip(series.index, series.values)
                if d.strftime("%Y-%m-%d") <= max_date
            ]
            if not pairs:
                raise ValueError("no completed sessions")
            out[t] = ([p[0] for p in pairs], [p[1] for p in pairs])
        except Exception as e:  # noqa: BLE001
            log(f"no usable close series for {t} ({sym}): {e}")
    return out


def entry_pos(dates: list[str], entry_date: str) -> int:
    """Rightmost session <= entry_date in the price index, or -1."""
    return bisect.bisect_right(dates, entry_date) - 1


def fwd_return(dates: list[str], closes: list[float], pos: int, n: int):
    """Return (return, session_date) n trading days after pos, or (None, None)."""
    if pos < 0 or pos + n >= len(dates) or closes[pos] == 0:
        return None, None
    return closes[pos + n] / closes[pos] - 1.0, dates[pos + n]


def pct(x: float) -> str:
    return f"{x * 100:+.2f}%"


def score_rows(calls: list[dict]) -> int:
    """Resolve open rows past horizon; refresh checkpoints. Returns count changed."""
    open_rows = [r for r in calls if r.get("status") == "open"]
    if not open_rows:
        log("no open rows to score.")
        return 0

    tickers = sorted({r["ticker"] for r in open_rows if r.get("ticker")} | {"SPY"})
    earliest = min(r["date"] for r in open_rows)
    start = (datetime.strptime(earliest, "%Y-%m-%d") - timedelta(days=10)).strftime("%Y-%m-%d")
    prices = download_closes(tickers, start)
    if not prices:
        return 0  # partial run; nothing scored, nothing crashed

    spy = prices.get("SPY")
    if spy is None:
        log("SPY series missing; cannot establish the trading calendar. Scoring skipped.")
        return 0
    spy_dates, spy_closes = spy

    def sessions_elapsed(entry_date: str) -> int:
        """Completed trading sessions after entry_date, per the SPY index."""
        return len(spy_dates) - 1 - entry_pos(spy_dates, entry_date)

    changed = 0
    today = today_et()
    for row in open_rows:
        try:
            before = json.dumps(row, sort_keys=True)
            horizon = int(row.get("horizon_days", 21))
            entry = row["date"]
            elapsed = sessions_elapsed(entry)

            series = prices.get(row.get("ticker")) if row.get("ticker") else None

            if series is not None:
                dates, closes = series
                pos = entry_pos(dates, entry)
                # Refresh checkpoints whenever data allows (open rows only).
                if row["type"] in ("radar", "regime"):
                    r5, _ = fwd_return(dates, closes, pos, 5)
                    r21, _ = fwd_return(dates, closes, pos, 21)
                    if r5 is not None:
                        row["ret_5d"] = round(r5, 4)
                    if r21 is not None:
                        row["ret_21d"] = round(r21, 4)
                elif row["type"] == "watch":
                    r1, _ = fwd_return(dates, closes, pos, 1)
                    if r1 is not None:
                        row["ret_1d"] = round(r1, 4)

            if elapsed < horizon:
                # Horizon not reached yet — stays open; only checkpoints may move.
                if json.dumps(row, sort_keys=True) != before:
                    changed += 1
                continue

            # --- horizon reached: resolve ---------------------------------
            if row.get("ticker") and series is None:
                row.update(status="unresolved", resolved_date=today, note="no price data")
            elif row["type"] == "regime":
                dates, closes = series
                pos = entry_pos(dates, entry)
                ret, rdate = fwd_return(dates, closes, pos, 21)
                if ret is None:
                    continue  # SPY data not deep enough yet; keep open
                d = row.get("direction")
                ok = (d == "up" and ret > 0) or (d == "down" and ret < 0) or (
                    d == "flat" and abs(ret) < 0.02
                )
                row.update(
                    status="hit" if ok else "invalidated",
                    resolved_date=rdate,
                    ret_21d=round(ret, 4),
                    note=f"SPY 21-session move {pct(ret)} vs regime read '{d}'",
                )
            elif row["type"] == "radar":
                if row.get("direction") not in ("up", "down"):
                    row.update(
                        status="unresolved",
                        resolved_date=today,
                        note="no directional read — logged for calibration only",
                    )
                else:
                    dates, closes = series
                    pos = entry_pos(dates, entry)
                    ret, rdate = fwd_return(dates, closes, pos, horizon)
                    if ret is None:
                        continue  # ticker series shorter than SPY calendar; keep open
                    signed = ret if row["direction"] == "up" else -ret
                    if signed >= 0.01:
                        status = "hit"
                    elif signed <= -0.01:
                        status = "invalidated"
                    else:
                        status = "unresolved"
                    row.update(
                        status=status,
                        resolved_date=rdate,
                        ret_21d=round(ret, 4),
                        note=f"{horizon}-session move {pct(ret)} vs '{row['direction']}' (±1% band)",
                    )
            elif row["type"] == "watch":
                if row.get("direction") not in ("up", "down") or series is None:
                    row.update(status="unresolved", resolved_date=today, note="manual review")
                else:
                    dates, closes = series
                    pos = entry_pos(dates, entry)
                    ret, rdate = fwd_return(dates, closes, pos, 1)
                    if ret is None:
                        continue
                    signed = ret if row["direction"] == "up" else -ret
                    if signed >= 0.0025:
                        status = "hit"
                    elif signed <= -0.0025:
                        status = "invalidated"
                    else:
                        status = "unresolved"
                    row.update(
                        status=status,
                        resolved_date=rdate,
                        ret_1d=round(ret, 4),
                        note=f"next-session move {pct(ret)} vs '{row['direction']}' (±0.25% band)",
                    )
            else:
                row.update(status="unresolved", resolved_date=today, note="unknown row type")

            if json.dumps(row, sort_keys=True) != before:
                changed += 1
        except Exception as e:  # noqa: BLE001 - one bad row never kills the run
            log(f"scoring error on {row.get('id')}: {e}")
    return changed


# ---------------------------------------------------------------------------
# EMIT
# ---------------------------------------------------------------------------

def rate(hit: int, invalidated: int, resolved_count: int):
    if resolved_count < 5 or (hit + invalidated) == 0:
        return None
    return round(hit / (hit + invalidated), 2)


def build_latest(calls: list[dict]) -> dict:
    statuses = [r["status"] for r in calls]
    totals = {
        "open": statuses.count("open"),
        "resolved": sum(1 for s in statuses if s != "open"),
        "hit": statuses.count("hit"),
        "invalidated": statuses.count("invalidated"),
        "unresolved": statuses.count("unresolved"),
    }

    radar = [r for r in calls if r["type"] == "radar"]
    radar_resolved = [r for r in radar if r["status"] != "open"]
    hit_rate_21d = rate(
        sum(1 for r in radar_resolved if r["status"] == "hit"),
        sum(1 for r in radar_resolved if r["status"] == "invalidated"),
        len(radar_resolved),
    )

    # 5-session checkpoint calibration on directional radar rows with data.
    checkpoint = [
        r for r in radar
        if r.get("direction") in ("up", "down") and r.get("ret_5d") is not None
    ]
    h5 = i5 = 0
    for r in checkpoint:
        signed = r["ret_5d"] if r["direction"] == "up" else -r["ret_5d"]
        if signed >= 0.01:
            h5 += 1
        elif signed <= -0.01:
            i5 += 1
    hit_rate_5d = rate(h5, i5, len(checkpoint))

    regime = [r for r in calls if r["type"] == "regime" and r["status"] != "open"]
    regime_alignment_21d = rate(
        sum(1 for r in regime if r["status"] == "hit"),
        sum(1 for r in regime if r["status"] == "invalidated"),
        len(regime),
    )

    rows = sorted(calls, key=lambda r: (r["date"], r["id"]), reverse=True)[:30]
    run_date = today_et()
    return {
        "as_of": run_date,
        "date": run_date,
        "totals": totals,
        "hit_rate_5d": hit_rate_5d,
        "hit_rate_21d": hit_rate_21d,
        "regime_alignment_21d": regime_alignment_21d,
        "rows": rows,
    }


def esc(s) -> str:
    s = "" if s is None else str(s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_html(latest: dict) -> str:
    t = latest["totals"]
    fmt = lambda v: "—" if v is None else f"{v:.2f}"  # noqa: E731
    body_rows = []
    for r in latest["rows"]:
        ret = r.get("ret_21d")
        if r["type"] == "watch":
            ret = r.get("ret_1d")
        ret_s = "—" if ret is None else f"{ret * 100:+.2f}%"
        body_rows.append(
            "<tr>"
            f"<td>{esc(r['date'])}</td>"
            f"<td>{esc(r['type'])}</td>"
            f"<td>{esc(r.get('ticker') or '—')}</td>"
            f"<td>{esc(r.get('direction'))}</td>"
            f"<td class='stmt'>{esc(r['statement'])}</td>"
            f"<td class='s-{esc(r['status'])}'>{esc(r['status'])}</td>"
            f"<td>{ret_s}</td>"
            "</tr>"
        )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AZTMM Accountability Ledger — {esc(latest['as_of'])}</title>
<style>
  body{{background:#0b0f1a;color:#e6e9ff;font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;
       margin:0;padding:24px;font-size:13px;line-height:1.5}}
  h1{{font-size:16px;letter-spacing:1.5px;text-transform:uppercase;color:#22d3ee;margin:0 0 4px}}
  .meta{{color:#64748b;margin-bottom:16px}}
  .totals span{{margin-right:14px;color:#94a3b8}}
  .totals strong{{color:#e6e9ff}}
  table{{border-collapse:collapse;width:100%;margin-top:14px}}
  th,td{{padding:7px 10px;border-bottom:1px solid rgba(148,163,184,.15);text-align:left;vertical-align:top}}
  th{{color:#64748b;text-transform:uppercase;font-size:11px;letter-spacing:1px}}
  .stmt{{color:#94a3b8;max-width:480px}}
  .s-open{{color:#c9a961}} .s-hit{{color:#34d399}} .s-invalidated{{color:#fb7185}} .s-unresolved{{color:#94a3b8}}
  footer{{margin-top:20px;color:#64748b;font-size:11px}}
</style>
</head>
<body>
<h1>Accountability Ledger</h1>
<div class="meta">as of {esc(latest['as_of'])} · every dated observation, scored against EOD closes · misses stay on the page</div>
<div class="totals">
  <span>open <strong>{t['open']}</strong></span>
  <span>resolved <strong>{t['resolved']}</strong></span>
  <span>hit <strong>{t['hit']}</strong></span>
  <span>invalidated <strong>{t['invalidated']}</strong></span>
  <span>unresolved <strong>{t['unresolved']}</strong></span>
  <span>21-session hit rate <strong>{fmt(latest['hit_rate_21d'])}</strong></span>
  <span>regime alignment <strong>{fmt(latest['regime_alignment_21d'])}</strong></span>
</div>
<table>
<thead><tr><th>Date</th><th>Type</th><th>Ticker</th><th>Direction</th><th>Observation</th><th>Status</th><th>Move</th></tr></thead>
<tbody>
{chr(10).join(body_rows)}
</tbody>
</table>
<footer>Personal observations of one trader. Not investment advice. Hit rates are calibration, not performance marketing; sample sizes under 5 show as —.</footer>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="AZTMM Accountability Ledger")
    ap.add_argument("--repo-root", default=".", help="repository root (default: cwd)")
    ap.add_argument("--dry-run", action="store_true", help="no writes; print summary")
    ap.add_argument("--skip-extract", action="store_true", help="skip WP fetch/extract")
    ap.add_argument("--skip-score", action="store_true", help="skip price scoring")
    ap.add_argument(
        "--post-file",
        help="path to a JSON file with one post object {slug,date,content:{rendered}} "
        "(testing/offline; replaces the WP API fetch)",
    )
    args = ap.parse_args()

    root = os.path.abspath(args.repo_root)
    calls_path = os.path.join(root, "data", "calls.json")
    out_dir = os.path.join(root, "accountability-ledger", "sample-output")
    latest_path = os.path.join(out_dir, "latest.json")
    html_path = os.path.join(out_dir, "latest.html")

    calls: list[dict] = []
    if os.path.exists(calls_path):
        try:
            with open(calls_path, encoding="utf-8") as f:
                calls = json.load(f)
        except Exception as e:
            log(f"FATAL: could not parse existing {calls_path}: {e}")
            return 1
    existing_ids = {r["id"] for r in calls}

    # ----- EXTRACT ----------------------------------------------------------
    new_rows: list[dict] = []
    if not args.skip_extract:
        if args.post_file:
            with open(args.post_file, encoding="utf-8") as f:
                posts = [json.load(f)]
        else:
            posts = fetch_posts()
        for post in posts:
            try:
                for row in extract_rows_from_post(post):
                    if row["id"] in existing_ids:
                        continue  # append-only: never duplicate, never modify
                    existing_ids.add(row["id"])
                    new_rows.append(row)
            except Exception as e:  # noqa: BLE001
                log(f"extraction failed for post {post.get('slug')}: {e}")
        calls.extend(new_rows)
        log(f"extracted {len(new_rows)} new row(s) from {len(posts)} post(s)")

    # ----- SCORE ------------------------------------------------------------
    scored = 0
    if not args.skip_score:
        scored = score_rows(calls)
        log(f"updated {scored} row(s) during scoring")

    calls.sort(key=lambda r: (r["date"], r["id"]))
    latest = build_latest(calls)

    # ----- nothing to do? ---------------------------------------------------
    if not new_rows and scored == 0:
        prior_as_of = None
        if os.path.exists(latest_path):
            try:
                with open(latest_path, encoding="utf-8") as f:
                    prior_as_of = json.load(f).get("as_of")
            except Exception:
                prior_as_of = None
        if prior_as_of == latest["as_of"]:
            log("nothing to do: no new rows, no score changes, snapshot already fresh.")
            return 3

    summary = (
        f"as_of={latest['as_of']} new_rows={len(new_rows)} scored={scored} "
        f"totals={json.dumps(latest['totals'])} "
        f"hit_rate_21d={latest['hit_rate_21d']} hit_rate_5d={latest['hit_rate_5d']} "
        f"regime_alignment_21d={latest['regime_alignment_21d']}"
    )

    if args.dry_run:
        print(f"[dry-run] {summary}")
        for r in new_rows:
            print(f"[dry-run] new: {r['id']} type={r['type']} dir={r['direction']} "
                  f"ticker={r['ticker']} :: {r['statement'][:80]}")
        return 0

    os.makedirs(os.path.dirname(calls_path), exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    with open(calls_path, "w", encoding="utf-8") as f:
        json.dump(calls, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(latest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(build_html(latest))
    print(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
