"""
AZTMM Congress Trades Tracker - House Clerk PTR Fetcher
========================================================
PATH A LOCKED 2026-05-15 - free-source replacement for the UW-derived fetcher.

Source: House Clerk Periodic Transaction Report (PTR) feed
  Index:   https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.ZIP
  PTR pdf: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{year}/{docid}.pdf

Notes
-----
- House Clerk publishes PTRs as individual PDFs. The annual ZIP contains an
  XML index keyed by DocID/FilingType. We pull the ZIP, filter to FilingType=P
  in the trailing 30 days, then download + parse each PTR PDF with pdftotext.
- Senate equivalent (efdsearch.senate.gov) is phase 2; documented below.
- Output shape matches the previous public.json so the publisher + page
  template stay 1:1 with the old UW pipeline.
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import re
import subprocess
import sys
import time
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError
from xml.etree import ElementTree as ET

logger = logging.getLogger("congress.house_clerk")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

YEAR = datetime.utcnow().year
ZIP_URL = f"https://disclosures-clerk.house.gov/public_disc/financial-pdfs/{YEAR}FD.ZIP"
PTR_URL_FMT = "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{year}/{docid}.pdf"
USER_AGENT = "aztmm-congress-watch/2.0 (+contact: nikhil.kothari17@gmail.com)"
PTR_THROTTLE = 0.25
HTTP_TIMEOUT = 25
LOOKBACK_DAYS = 30

SECTOR_MAP = {
    "AAPL": "Technology", "MSFT": "Technology", "NVDA": "Technology",
    "GOOGL": "Technology", "GOOG": "Technology", "META": "Technology",
    "AMZN": "Consumer Discretionary", "TSLA": "Consumer Discretionary",
    "AVGO": "Technology", "ORCL": "Technology", "CRM": "Technology",
    "INTU": "Technology", "AMD": "Technology", "ADBE": "Technology",
    "NFLX": "Communication Services", "DIS": "Communication Services",
    "JPM": "Financials", "BAC": "Financials", "GS": "Financials",
    "MS": "Financials", "WFC": "Financials", "C": "Financials",
    "BRK.B": "Financials", "V": "Financials", "MA": "Financials",
    "LLY": "Health Care", "UNH": "Health Care", "JNJ": "Health Care",
    "PFE": "Health Care", "ABBV": "Health Care", "MRK": "Health Care",
    "TMO": "Health Care", "ABT": "Health Care",
    "XOM": "Energy", "CVX": "Energy", "COP": "Energy",
    "AESI": "Energy", "OXY": "Energy",
    "HD": "Consumer Discretionary", "MCD": "Consumer Discretionary",
    "CMG": "Consumer Discretionary", "NKE": "Consumer Discretionary",
    "WMT": "Consumer Staples", "COST": "Consumer Staples",
    "PG": "Consumer Staples", "KO": "Consumer Staples", "PEP": "Consumer Staples",
    "AMT": "Real Estate", "PLD": "Real Estate", "SPG": "Real Estate",
    "BA": "Industrials", "GE": "Industrials", "CAT": "Industrials",
    "PAYX": "Industrials", "STE": "Health Care",
    "T": "Communication Services", "VZ": "Communication Services",
    "SPY": "Index/ETF", "QQQ": "Index/ETF", "IWM": "Index/ETF",
    "VOO": "Index/ETF", "VTI": "Index/ETF",
}


@dataclass
class Trade:
    member: str
    state_dst: str
    ticker: str
    txn_type: str
    txn_date: str
    notification_date: str
    amount_range: str
    doc_id: str

    def as_public(self) -> dict[str, Any]:
        return {
            "member": self.member,
            "chamber": "House",
            "state_dst": self.state_dst,
            "ticker": self.ticker,
            "sector": SECTOR_MAP.get(self.ticker, "Other"),
            "txn_type": self.txn_type,
            "action": _action_label(self.txn_type),
            "txn_date": self.txn_date,
            "notification_date": self.notification_date,
            "amount_range": self.amount_range,
            "amount_midpoint": _midpoint(self.amount_range),
            "filing_url": (
                f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/"
                f"{YEAR}/{self.doc_id}.pdf"
            ),
        }


def _action_label(t: str) -> str:
    t = (t or "").strip().upper()
    if t.startswith("P"):
        return "acquisition"
    if t.startswith("S"):
        return "disposition"
    if t.startswith("E"):
        return "exchange"
    return "other"


def _midpoint(rng: str) -> float | None:
    if not rng:
        return None
    nums = [int(x.replace(",", "")) for x in re.findall(r"\$?([\d,]+)", rng)]
    if len(nums) >= 2:
        return (nums[0] + nums[1]) / 2.0
    if nums:
        return float(nums[0])
    return None


def _http_get(url: str, timeout: int = HTTP_TIMEOUT) -> bytes:
    req = urlrequest.Request(url, headers={"User-Agent": USER_AGENT})
    with urlrequest.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _pdftotext(pdf_bytes: bytes) -> str:
    proc = subprocess.run(
        ["pdftotext", "-layout", "-", "-"],
        input=pdf_bytes,
        capture_output=True,
        timeout=20,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"pdftotext failed: {proc.stderr[:200].decode(errors='replace')}")
    return proc.stdout.decode("utf-8", errors="replace")


def fetch_zip_index() -> list[dict[str, str]]:
    blob = _http_get(ZIP_URL)
    zf = zipfile.ZipFile(io.BytesIO(blob))
    xml_name = next(n for n in zf.namelist() if n.lower().endswith(".xml"))
    xml_bytes = zf.read(xml_name)
    root = ET.fromstring(xml_bytes)
    out = []
    for m in root.findall("Member"):
        out.append({
            "Last": (m.findtext("Last") or "").strip(),
            "First": (m.findtext("First") or "").strip(),
            "FilingType": (m.findtext("FilingType") or "").strip(),
            "StateDst": (m.findtext("StateDst") or "").strip(),
            "FilingDate": (m.findtext("FilingDate") or "").strip(),
            "DocID": (m.findtext("DocID") or "").strip(),
        })
    logger.info("zip index parsed: %d filings", len(out))
    return out


def filter_recent_ptrs(rows: list[dict[str, str]], lookback_days: int = LOOKBACK_DAYS,
                       today: datetime | None = None) -> list[dict[str, str]]:
    today = today or datetime.utcnow()
    cutoff = today - timedelta(days=lookback_days)
    out = []
    for r in rows:
        if r["FilingType"] != "P":
            continue
        try:
            d = datetime.strptime(r["FilingDate"], "%m/%d/%Y")
        except ValueError:
            continue
        if d < cutoff:
            continue
        if not r["DocID"]:
            continue
        r["_filed"] = d.strftime("%Y-%m-%d")
        out.append(r)
    out.sort(key=lambda r: r["_filed"], reverse=True)
    return out


_TXN_LINE_RX = re.compile(
    r"\(([A-Z][A-Z0-9.\-]{0,7})\)"
    r".*?"
    r"\s+([PSE])\s+"
    r"(\d{2}/\d{2}/\d{4})\s+"
    r"(\d{2}/\d{2}/\d{4})\s+"
    r"(\$[\d,]+\s*-\s*\$?[\d,]+|\$?[\d,]+\+?)"
)


def parse_ptr(text: str, *, member: str, state_dst: str, doc_id: str) -> list[Trade]:
    trades: list[Trade] = []
    for m in _TXN_LINE_RX.finditer(text):
        ticker, ttype, tdate, ndate, amount = m.groups()
        try:
            tdate_iso = datetime.strptime(tdate, "%m/%d/%Y").strftime("%Y-%m-%d")
            ndate_iso = datetime.strptime(ndate, "%m/%d/%Y").strftime("%Y-%m-%d")
        except ValueError:
            continue
        trades.append(Trade(
            member=member,
            state_dst=state_dst,
            ticker=ticker.upper().strip(),
            txn_type=ttype,
            txn_date=tdate_iso,
            notification_date=ndate_iso,
            amount_range=amount.strip(),
            doc_id=doc_id,
        ))
    return trades


def fetch_ptr(doc_id: str) -> bytes:
    url = PTR_URL_FMT.format(year=YEAR, docid=doc_id)
    return _http_get(url)


def _normalize_member_name(first: str, last: str) -> str:
    first = re.sub(r"\b(Hon\.|Dr|Dr\.|Mr\.|Mrs\.|Ms\.|Sr\.|Jr\.)\b", "", first).strip()
    first = re.sub(r'"[^"]*"', "", first).strip()
    first = first.split()[0] if first.split() else first
    return f"{first} {last}".strip()


def aggregate(trades: list[Trade], today: str) -> dict[str, Any]:
    trades_today = [t for t in trades if t.notification_date == today]
    members_today = sorted({t.member for t in trades_today})
    tickers_today = sorted({t.ticker for t in trades_today})

    sector_today = Counter(SECTOR_MAP.get(t.ticker, "Other") for t in trades_today)
    chamber_today = Counter(["House"] * len(trades_today))

    def is_large(t: Trade) -> bool:
        m = _midpoint(t.amount_range) or 0
        return m >= 100_000

    large_today = [t for t in trades_today if is_large(t)]

    def is_late(t: Trade) -> bool:
        try:
            td = datetime.strptime(t.txn_date, "%Y-%m-%d")
            nd = datetime.strptime(t.notification_date, "%Y-%m-%d")
            return (nd - td).days > 45
        except Exception:
            return False
    late_today = [t for t in trades_today if is_late(t)]

    by_member = Counter(t.member for t in trades_today)
    most_active = [
        {"member": m, "filings": c, "chamber": "House"}
        for m, c in by_member.most_common(5)
    ]

    by_ticker = defaultdict(list)
    for t in trades:
        by_ticker[t.ticker].append(t)
    ticker_clusters = []
    for ticker, group in by_ticker.items():
        members = sorted({g.member for g in group})
        if len(members) < 2:
            continue
        actions = Counter(_action_label(g.txn_type) for g in group)
        tilt = "balanced"
        if actions["acquisition"] > actions["disposition"]:
            tilt = "tilted toward acquisitions"
        elif actions["disposition"] > actions["acquisition"]:
            tilt = "tilted toward dispositions"
        dates = sorted(g.notification_date for g in group)
        ticker_clusters.append({
            "ticker": ticker,
            "sector": SECTOR_MAP.get(ticker, "Other"),
            "member_count": len(members),
            "members": members[:10],
            "filings_in_window": len(group),
            "window_start": dates[0],
            "window_end": dates[-1],
            "tilt": tilt,
        })
    ticker_clusters.sort(key=lambda c: (-c["member_count"], -c["filings_in_window"]))
    ticker_clusters = ticker_clusters[:5]

    by_sector = defaultdict(list)
    for t in trades:
        by_sector[SECTOR_MAP.get(t.ticker, "Other")].append(t)
    sector_clusters = []
    for sector, group in by_sector.items():
        members = sorted({g.member for g in group})
        if len(members) < 3 or sector == "Other":
            continue
        dates = sorted(g.notification_date for g in group)
        sector_clusters.append({
            "sector": sector,
            "member_count": len(members),
            "filings_in_window": len(group),
            "window_start": dates[0],
            "window_end": dates[-1],
        })
    sector_clusters.sort(key=lambda c: (-c["member_count"], -c["filings_in_window"]))
    sector_clusters = sector_clusters[:5]

    commentary = []
    if ticker_clusters:
        top = ticker_clusters[0]
        commentary.append(
            f"{top['ticker']} drew {top['member_count']} distinct members inside the "
            f"last {LOOKBACK_DAYS} days ({top['filings_in_window']} filings, {top['tilt']}). "
            f"That kind of cluster is worth noting - not chasing."
        )
        rest = [c['ticker'] for c in ticker_clusters[1:]]
        if rest:
            commentary.append(
                f"Other tickers showing multi-member activity in the same window: {', '.join(rest)}."
            )
    for sc in sector_clusters[:1]:
        commentary.append(
            f"{sc['member_count']} members disclosed trades in {sc['sector']} "
            f"this window - a sector-level cluster I'll keep an eye on."
        )
    if not trades_today and not commentary:
        commentary.append(
            "No new PTRs hit the Clerk feed today. The next House filing window "
            "will show up here when members submit their disclosures."
        )

    return {
        "trades_today": [t.as_public() for t in trades_today],
        "members_today": members_today,
        "tickers_today": tickers_today,
        "summary": {
            "filings_today": len(trades_today),
            "members_today": len(members_today),
            "tickers_today": len(tickers_today),
            "chamber_breakdown": dict(chamber_today),
            "sector_breakdown": dict(sector_today),
            "large_filings_today": len(large_today),
            "late_filings_today": len(late_today),
        },
        "most_active_today": most_active,
        "notable": {
            "ticker_clusters": ticker_clusters,
            "sector_clusters": sector_clusters,
            "large_filings": [t.as_public() for t in large_today],
            "late_filings": [t.as_public() for t in late_today],
        },
        "commentary": commentary,
    }


def run(today: str | None = None, *, max_filings: int = 50, out_dir: str = "publish-artifacts") -> dict[str, Any]:
    today = today or datetime.utcnow().strftime("%Y-%m-%d")
    os.makedirs(out_dir, exist_ok=True)

    rows = fetch_zip_index()
    ptrs = filter_recent_ptrs(rows, today=datetime.strptime(today, "%Y-%m-%d"))
    logger.info("recent PTRs in lookback window: %d", len(ptrs))

    trades: list[Trade] = []
    fetched = 0
    failed = 0
    for r in ptrs[:max_filings]:
        member = _normalize_member_name(r["First"], r["Last"])
        try:
            pdf_bytes = fetch_ptr(r["DocID"])
            text = _pdftotext(pdf_bytes)
            parsed = parse_ptr(text, member=member, state_dst=r["StateDst"], doc_id=r["DocID"])
            for p in parsed:
                if not p.notification_date:
                    p.notification_date = r["_filed"]
            trades.extend(parsed)
            fetched += 1
            time.sleep(PTR_THROTTLE)
        except (HTTPError, URLError, RuntimeError, subprocess.TimeoutExpired) as e:
            failed += 1
            logger.warning("PTR fetch/parse failed for DocID %s (%s): %s",
                           r["DocID"], member, e)
            continue

    logger.info("trades parsed: %d (from %d PTRs, %d failures)",
                len(trades), fetched, failed)

    agg = aggregate(trades, today=today)
    public = {
        "as_of": f"{today} 5:00 PM ET",
        "as_of_date": today,
        "refresh_label": "5:00 PM ET",
        "headline_metric": {
            "label": "Filings filed today",
            "value": agg["summary"]["filings_today"],
        },
        **agg,
        "data_quality": {
            "degraded": failed > 0,
            "endpoints_ok": fetched,
            "endpoints_failed": failed,
            "source": "House Clerk PTR feed (free, public)",
            "senate_status": "phase 2 - efdsearch.senate.gov scraper pending",
        },
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    public_path = os.path.join(out_dir, f"congress-{today}.public.json")
    with open(public_path, "w") as f:
        json.dump(public, f, indent=2)
    logger.info("wrote %s", public_path)

    return public


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Congress Watch - House Clerk PTR fetcher")
    ap.add_argument("--date", help="Target date YYYY-MM-DD (default: today UTC)")
    ap.add_argument("--max-filings", type=int, default=50)
    ap.add_argument("--out-dir", default="publish-artifacts")
    return ap.parse_args()


def main() -> int:
    args = _parse_args()
    payload = run(today=args.date, max_filings=args.max_filings, out_dir=args.out_dir)
    print(json.dumps({
        "status": "ok",
        "filings_today": payload["summary"]["filings_today"],
        "generated_at": payload["generated_at"],
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
