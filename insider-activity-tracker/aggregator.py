"""
AZTMM Insider Activity — aggregator

Takes the raw Form 4 transaction bundle for the trailing-7-day window
and produces the dual public/internal output.

Public side: top buyers + top sellers + sector roll-up + observation
commentary. No model weights, no endpoint names, no advisory language.

Internal side: per-ticker raw values, code-level breakdown, all
unfiltered rows preserved for re-processing.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from pathlib import Path
from typing import Any

import yaml

from fetcher import safe_float, safe_int

logger = logging.getLogger("insider.aggregator")

ROOT = Path(__file__).parent
CONFIG_PATH = ROOT / "config.yml"


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Formatters
# ---------------------------------------------------------------------------

def _fmt_dollar(x: float) -> str:
    sign = "-" if x < 0 else ""
    a = abs(x)
    if a >= 1e9:
        return f"{sign}${a/1e9:.2f}B"
    if a >= 1e6:
        return f"{sign}${a/1e6:.1f}M"
    if a >= 1e3:
        return f"{sign}${a/1e3:.0f}K"
    return f"{sign}${a:.0f}"


def _fmt_int(x: int | float) -> str:
    return f"{int(x):,}"


def _fmt_shares(n: int) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M shares"
    if n >= 1_000:
        return f"{n/1_000:.0f}K shares"
    return f"{n:,} shares"


# ---------------------------------------------------------------------------
# Value computation (handles upstream data quirks)
# ---------------------------------------------------------------------------

def _row_value(row: dict) -> tuple[int, float]:
    """
    Return (shares_abs, dollar_value) for the transaction.

    Quirks handled:
      - `amount` is signed (negative for dispositions / sells); we use
        the absolute value for share count + dollar weight.
      - `price` is per-share for most rows but occasionally an
        aggregated total when `transactions` > 1. We detect the
        anomaly by comparing `price` to `stock_price` (the closing
        market price). If `price` is more than 5x `stock_price`, we
        fall back to `stock_price` for the per-share figure.
    """
    shares = abs(safe_int(row.get("amount")))
    price = safe_float(row.get("price"))
    stock_price = safe_float(row.get("stock_price"))

    # If reported price looks aggregated (>> stock_price) or zero, fall
    # back to stock_price.
    per_share = price
    if stock_price > 0:
        if per_share <= 0 or per_share > stock_price * 5:
            per_share = stock_price
    elif per_share <= 0:
        per_share = 0.0

    value = shares * per_share
    return shares, value


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------

def _passes_threshold(row: dict, thresholds: dict) -> bool:
    """Apply market-cap floor + transaction-value floor."""
    mc = safe_float(row.get("marketcap"))
    if mc and mc < thresholds["min_marketcap_usd"]:
        return False
    _, value = _row_value(row)
    if value < thresholds["min_transaction_value"]:
        return False
    return True


def _role_label(row: dict) -> str:
    """Plain-English role for the filer. No internal jargon."""
    title = (row.get("officer_title") or "").strip()
    is_dir = bool(row.get("is_director"))
    is_off = bool(row.get("is_officer"))
    is_10p = bool(row.get("is_ten_percent_owner"))
    if title:
        return title
    if is_off and is_dir:
        return "Officer & Director"
    if is_off:
        return "Officer"
    if is_dir:
        return "Director"
    if is_10p:
        return "10% Owner"
    return "Insider"


def _format_name(raw_name: str | None) -> str:
    """LAST FIRST -> First Last (title case) for display."""
    if not raw_name:
        return "—"
    name = raw_name.strip()
    return " ".join(p.capitalize() for p in name.split())


# ---------------------------------------------------------------------------
# Per-ticker rollup
# ---------------------------------------------------------------------------

def _rollup_by_ticker(rows: list[dict], txn_codes: dict) -> dict[str, dict]:
    """
    For each ticker, accumulate:
      - buy_value (sum across P rows)
      - sell_value (sum across S rows)
      - other_value (M/A/D/F/G/X)
      - filers (set of distinct owner names)
      - per-code counts
    """
    buy_codes = set(txn_codes["buys"])
    sell_codes = set(txn_codes["sells"])

    by_ticker: dict[str, dict] = defaultdict(lambda: {
        "ticker": None,
        "sector": None,
        "marketcap": 0.0,
        "buy_value": 0.0,
        "sell_value": 0.0,
        "other_value": 0.0,
        "buy_shares": 0,
        "sell_shares": 0,
        "buy_filings": 0,
        "sell_filings": 0,
        "other_filings": 0,
        "filers_buys": set(),
        "filers_sells": set(),
        "code_counts": defaultdict(int),
        "is_sp500": False,
    })

    for r in rows:
        t = r.get("ticker") or "?"
        rec = by_ticker[t]
        rec["ticker"] = t
        rec["sector"] = rec["sector"] or r.get("sector")
        mc = safe_float(r.get("marketcap"))
        if mc > rec["marketcap"]:
            rec["marketcap"] = mc
        rec["is_sp500"] = rec["is_sp500"] or bool(r.get("is_s_p_500"))

        code = (r.get("transaction_code") or "").upper()
        shares, value = _row_value(r)
        rec["code_counts"][code] += 1

        owner = r.get("owner_name") or ""

        if code in buy_codes:
            rec["buy_value"] += value
            rec["buy_shares"] += shares
            rec["buy_filings"] += 1
            if owner:
                rec["filers_buys"].add(owner)
        elif code in sell_codes:
            rec["sell_value"] += value
            rec["sell_shares"] += shares
            rec["sell_filings"] += 1
            if owner:
                rec["filers_sells"].add(owner)
        else:
            rec["other_value"] += value
            rec["other_filings"] += 1

    # Cast sets -> sorted lists for serialisation
    for rec in by_ticker.values():
        rec["filers_buys"] = sorted(rec["filers_buys"])
        rec["filers_sells"] = sorted(rec["filers_sells"])
        rec["code_counts"] = dict(rec["code_counts"])
    return by_ticker


def _rollup_by_sector(by_ticker: dict[str, dict]) -> list[dict]:
    by_sec: dict[str, dict] = defaultdict(lambda: {
        "sector": None,
        "buy_value": 0.0,
        "sell_value": 0.0,
        "tickers_with_buys": set(),
        "tickers_with_sells": set(),
    })
    for rec in by_ticker.values():
        sec = rec.get("sector") or "Unclassified"
        s = by_sec[sec]
        s["sector"] = sec
        s["buy_value"] += rec["buy_value"]
        s["sell_value"] += rec["sell_value"]
        if rec["buy_value"] > 0:
            s["tickers_with_buys"].add(rec["ticker"])
        if rec["sell_value"] > 0:
            s["tickers_with_sells"].add(rec["ticker"])
    out = []
    for s in by_sec.values():
        s["tickers_with_buys"] = sorted(s["tickers_with_buys"])
        s["tickers_with_sells"] = sorted(s["tickers_with_sells"])
        s["net_value"] = s["buy_value"] - s["sell_value"]
        out.append(s)
    out.sort(key=lambda x: x["buy_value"] + x["sell_value"], reverse=True)
    return out


# ---------------------------------------------------------------------------
# Narrative + summary builders (observation language only)
# ---------------------------------------------------------------------------

def _summary_line(buyers: list[dict], sellers: list[dict],
                  total_buy: float, total_sell: float, n_filings: int) -> str:
    if not buyers and not sellers:
        return (
            "This week's Form 4 tape was quiet — no company cleared the bar "
            "for inclusion in the rollup."
        )
    tilt = ""
    if total_buy > total_sell * 1.5 and total_buy > 0:
        tilt = " Dollar weight across the week's qualifying filings leaned to the buy side."
    elif total_sell > total_buy * 1.5 and total_sell > 0:
        tilt = " Dollar weight across the week's qualifying filings leaned to the sell side."
    elif total_buy > 0 or total_sell > 0:
        tilt = " Dollar weight across the week's qualifying filings was mixed between buys and sells."
    return (
        f"This week's Form 4 tape carried {_fmt_dollar(total_buy)} of qualifying open-market buys "
        f"and {_fmt_dollar(total_sell)} of qualifying open-market sells across {n_filings} filings.{tilt}"
    )


def _watching_line(buyers: list[dict], sellers: list[dict]) -> str:
    if not buyers and not sellers:
        return "Going into next week I'll be watching whether Form 4 filings pick back up."
    top_buy = buyers[0]["ticker"] if buyers else None
    top_sell = sellers[0]["ticker"] if sellers else None
    if top_buy and top_sell:
        return (
            f"Going into next week I'll be watching whether the open-market buying in "
            f"{top_buy} and the open-market selling in {top_sell} continue, or whether "
            f"this week's pattern was a one-week story."
        )
    if top_buy:
        return (
            f"Going into next week I'll be watching whether the open-market buying in "
            f"{top_buy} keeps showing up in the Form 4 stream, or whether the week's "
            f"pattern was a one-week story."
        )
    return (
        f"Going into next week I'll be watching whether the open-market selling in "
        f"{top_sell} continues across additional filings, or whether the week's pattern fades."
    )


def _commentary_for(rec: dict, side: str) -> str:
    """One observation line per highlighted ticker. Pure observation language."""
    t = rec["ticker"]
    if side == "buy":
        value = rec["buy_value"]
        n_filers = len(rec["filers_buys"])
        n_filings = rec["buy_filings"]
        filer_phrase = (
            f"{n_filers} distinct insiders" if n_filers > 1 else "a single insider"
        )
        filing_phrase = f"{n_filings} filing{'s' if n_filings != 1 else ''}"
        return (
            f"{t} drew {_fmt_dollar(value)} of qualifying open-market insider buying this week "
            f"across {filing_phrase} from {filer_phrase}."
        )
    else:
        value = rec["sell_value"]
        n_filers = len(rec["filers_sells"])
        n_filings = rec["sell_filings"]
        filer_phrase = (
            f"{n_filers} distinct insiders" if n_filers > 1 else "a single insider"
        )
        filing_phrase = f"{n_filings} filing{'s' if n_filings != 1 else ''}"
        return (
            f"{t} saw {_fmt_dollar(value)} of qualifying open-market insider selling this week "
            f"across {filing_phrase} from {filer_phrase}."
        )


# ---------------------------------------------------------------------------
# Public row builders
# ---------------------------------------------------------------------------

def _public_buyer_row(rec: dict) -> dict:
    return {
        "ticker": rec["ticker"],
        "sector": rec["sector"] or "—",
        "buy_value_fmt": _fmt_dollar(rec["buy_value"]),
        "buy_shares_fmt": _fmt_shares(rec["buy_shares"]),
        "buy_filings": rec["buy_filings"],
        "distinct_filers": len(rec["filers_buys"]),
    }


def _public_seller_row(rec: dict) -> dict:
    return {
        "ticker": rec["ticker"],
        "sector": rec["sector"] or "—",
        "sell_value_fmt": _fmt_dollar(rec["sell_value"]),
        "sell_shares_fmt": _fmt_shares(rec["sell_shares"]),
        "sell_filings": rec["sell_filings"],
        "distinct_filers": len(rec["filers_sells"]),
    }


def _public_sector_row(s: dict) -> dict:
    return {
        "sector": s["sector"],
        "buy_value_fmt": _fmt_dollar(s["buy_value"]),
        "sell_value_fmt": _fmt_dollar(s["sell_value"]),
        "net_value_fmt": _fmt_dollar(s["net_value"]),
        "buyer_count": len(s["tickers_with_buys"]),
        "seller_count": len(s["tickers_with_sells"]),
    }


# ---------------------------------------------------------------------------
# Main aggregate
# ---------------------------------------------------------------------------

def aggregate(bundle: dict, cfg: dict | None = None) -> dict:
    cfg = cfg or _load_config()
    thresholds = cfg["thresholds"]
    txn_codes = cfg["transaction_codes"]

    raw_rows: list[dict] = bundle.get("transactions") or []
    qualifying = [r for r in raw_rows if _passes_threshold(r, thresholds)]

    by_ticker = _rollup_by_ticker(qualifying, txn_codes)

    # Build buyer and seller lists, sorted by dollar value desc
    buyer_recs = [r for r in by_ticker.values() if r["buy_value"] > 0]
    buyer_recs.sort(key=lambda r: r["buy_value"], reverse=True)
    seller_recs = [r for r in by_ticker.values() if r["sell_value"] > 0]
    seller_recs.sort(key=lambda r: r["sell_value"], reverse=True)

    sector_rows = _rollup_by_sector(by_ticker)

    top_pub = thresholds["top_buyers_public"]
    top_int = thresholds["top_buyers_internal"]
    sec_top = thresholds["sector_top_n"]
    com_top = thresholds["commentary_top_n"]

    # Totals
    total_buy = sum(r["buy_value"] for r in buyer_recs)
    total_sell = sum(r["sell_value"] for r in seller_recs)
    n_filings = sum(r["buy_filings"] + r["sell_filings"] + r["other_filings"]
                    for r in by_ticker.values())

    # ---- Public side ----
    public_buyers = [_public_buyer_row(r) for r in buyer_recs[:top_pub]]
    public_sellers = [_public_seller_row(r) for r in seller_recs[:top_pub]]
    public_sectors = [_public_sector_row(s) for s in sector_rows[:sec_top]]

    commentary: list[str] = []
    for r in buyer_recs[:com_top]:
        commentary.append(_commentary_for(r, "buy"))
    for r in seller_recs[:com_top]:
        commentary.append(_commentary_for(r, "sell"))

    public = {
        "week_ending": bundle["week_ending"],
        "window_start": bundle["window_start"],
        "window_end": bundle["window_end"],
        "as_of": f"{bundle['week_ending']} 5:00 PM ET",
        "summary_line": _summary_line(public_buyers, public_sellers,
                                       total_buy, total_sell, n_filings),
        "watching_line": _watching_line(public_buyers, public_sellers),
        "buyers": public_buyers,
        "sellers": public_sellers,
        "sectors": public_sectors,
        "commentary": commentary,
        "tape_totals": {
            "total_filings": n_filings,
            "qualifying_filings": len(qualifying),
            "buyer_tickers": len(buyer_recs),
            "seller_tickers": len(seller_recs),
            "total_buy_value_fmt": _fmt_dollar(total_buy),
            "total_sell_value_fmt": _fmt_dollar(total_sell),
        },
        "data_quality_degraded": (
            bundle.get("fallback_used", False)
            or bundle.get("data_quality", {}).get("endpoints_failed", 0)
            > bundle.get("data_quality", {}).get("endpoints_ok", 0)
        ),
    }

    # ---- Internal side ----
    internal_buyers = []
    for r in buyer_recs[:top_int]:
        internal_buyers.append({
            "ticker": r["ticker"],
            "sector": r["sector"],
            "marketcap": r["marketcap"],
            "buy_value": r["buy_value"],
            "buy_shares": r["buy_shares"],
            "buy_filings": r["buy_filings"],
            "filers_buys": r["filers_buys"],
            "code_counts": r["code_counts"],
            "is_sp500": r["is_sp500"],
        })
    internal_sellers = []
    for r in seller_recs[:top_int]:
        internal_sellers.append({
            "ticker": r["ticker"],
            "sector": r["sector"],
            "marketcap": r["marketcap"],
            "sell_value": r["sell_value"],
            "sell_shares": r["sell_shares"],
            "sell_filings": r["sell_filings"],
            "filers_sells": r["filers_sells"],
            "code_counts": r["code_counts"],
            "is_sp500": r["is_sp500"],
        })

    internal = {
        "week_ending": bundle["week_ending"],
        "window_start": bundle["window_start"],
        "window_end": bundle["window_end"],
        "as_of": f"{bundle['week_ending']} 5:00 PM ET",
        "thresholds": thresholds,
        "transaction_codes": txn_codes,
        "raw_row_count": len(raw_rows),
        "qualifying_row_count": len(qualifying),
        "ticker_count": len(by_ticker),
        "buyers": internal_buyers,
        "sellers": internal_sellers,
        "sectors": [
            {
                "sector": s["sector"],
                "buy_value": s["buy_value"],
                "sell_value": s["sell_value"],
                "net_value": s["net_value"],
                "tickers_with_buys": s["tickers_with_buys"],
                "tickers_with_sells": s["tickers_with_sells"],
            }
            for s in sector_rows
        ],
        "totals": {
            "total_buy_value": total_buy,
            "total_sell_value": total_sell,
            "net_value": total_buy - total_sell,
            "n_filings": n_filings,
        },
        "fallback_used": bundle.get("fallback_used", False),
        "data_quality": bundle.get("data_quality") or {},
    }

    return {"public": public, "internal": internal}


if __name__ == "__main__":
    import json, sys, argparse
    p = argparse.ArgumentParser()
    p.add_argument("--bundle", required=True)
    args = p.parse_args()
    with open(args.bundle) as f:
        bundle = json.load(f)
    out = aggregate(bundle)
    json.dump(out, sys.stdout, indent=2, default=str)
