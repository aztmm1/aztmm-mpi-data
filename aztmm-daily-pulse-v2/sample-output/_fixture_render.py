"""
Sample renderer for May 11 + May 12, 2026.

Builds realistic raw-data dicts in the same shape the fetcher produces,
runs aggregate(), renders the template, brand-checks, and writes the
HTML to disk. No network calls.

The May 12 fixture encodes the conditions described in the task:
  - XLV +1.96%, XLP +1.28%, XLF +0.78%, XLE +0.70%, XLU +0.11% (defensive green)
  - XLK -1.51%, XLY -0.90%, XLI -0.39%, XLB -0.23% (cyclical red)
  - XLK call premium -$396.24M, put premium +$103M
  - EOD cumulative net call premium -$486.9M (vs +$277M Mon)
  - Top tech net premium: NVDA +$43M, QCOM -$49M, AAPL +$20M, TSM -$17M
  - DP: MSFT $3.77B, SPY $2.31B, NVDA $870M (-62% vs Mon), QQQ $338M (-81% vs Mon)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

from daily_pulse_aggregator import aggregate  # noqa: E402
from daily_pulse_publisher import render_html, brand_check  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers to fabricate fetcher-shape fixtures
# ---------------------------------------------------------------------------

def _mk_market_totals(call_prem: float, put_prem: float, call_vol: int, put_vol: int) -> dict:
    return {
        "call_volume": call_vol,
        "put_volume": put_vol,
        "call_premium": call_prem,
        "put_premium": put_prem,
    }


def _mk_sector(ticker: str, change_pct: float, call_prem: float, put_prem: float,
               latest_flow: float = 0.0) -> dict:
    return {
        "ticker": ticker,
        "change_percent": change_pct,
        "call_premium": call_prem,
        "put_premium": put_prem,
        "in_out_flow": [{"date": "2026-05-12", "flow": latest_flow}],
    }


def _mk_tide_series(close_net_call: float, close_net_put: float, n_bars: int = 81,
                    shape: str = "decline") -> list[dict]:
    """Build 81 5-min bars ending at close_net_call (linear path)."""
    bars = []
    for i in range(n_bars):
        frac = i / (n_bars - 1)
        if shape == "decline":
            ncp = close_net_call * frac
            npp = close_net_put * frac
        elif shape == "rally":
            ncp = close_net_call * frac
            npp = close_net_put * frac
        else:
            ncp = close_net_call * frac
            npp = close_net_put * frac
        bars.append({
            "net_call_premium": ncp,
            "net_put_premium": npp,
            "net_volume": (ncp + npp) / 50.0,
            "timestamp": f"2026-05-12T{9 + (i*5)//60:02d}:{(i*5)%60:02d}:00",
        })
    return bars


def _mk_alert(ticker: str, opt_type: str, side: str, prem: float, v_oi: float = 1.0,
              dte: int = 14, strike: float = 100.0, price: float = 1.5,
              single_leg: bool = True, size: int = 1000) -> dict:
    return {
        "ticker": ticker,
        "type": opt_type,        # "call" / "put"
        "side": side,            # "ask" / "bid"
        "total_premium": prem,
        "volume_oi_ratio": v_oi,
        "dte": dte,
        "strike": strike,
        "expiry": "2026-05-30",
        "price": price,
        "is_single_leg": single_leg,
        "total_size": size,
    }


def _mk_dp_prints(total_prem: float, n_prints: int = 50, mega_count: int = 5) -> list[dict]:
    prints = []
    # mega prints
    if mega_count > 0:
        per_mega = (total_prem * 0.7) / mega_count
        for _ in range(mega_count):
            prints.append({"size": 150_000, "premium": per_mega, "price": per_mega / 150_000})
    # smaller prints
    n_small = n_prints - mega_count
    if n_small > 0:
        per_small = (total_prem * 0.3) / n_small
        for _ in range(n_small):
            prints.append({"size": 10_000, "premium": per_small, "price": per_small / 10_000})
    return prints


# ---------------------------------------------------------------------------
# May 12, 2026 — DEFENSIVE ROTATION
# ---------------------------------------------------------------------------

def fixture_2026_05_12() -> dict:
    return {
        "date": "2026-05-12",
        "prev_date": "2026-05-11",
        "market_totals": _mk_market_totals(
            call_prem=58_400_000_000.0,
            put_prem=44_100_000_000.0,
            call_vol=24_800_000,
            put_vol=23_900_000,
        ),
        "market_totals_prev": _mk_market_totals(
            call_prem=62_200_000_000.0,
            put_prem=41_800_000_000.0,
            call_vol=25_600_000,
            put_vol=21_500_000,
        ),
        "sector_etfs": [
            _mk_sector("SPY", -0.42, 1_200_000_000, 1_350_000_000, -150e6),
            _mk_sector("XLV", +1.96, 380_000_000, 110_000_000, +270e6),
            _mk_sector("XLP", +1.28, 145_000_000, 60_000_000, +85e6),
            _mk_sector("XLF", +0.78, 220_000_000, 140_000_000, +80e6),
            _mk_sector("XLE", +0.70, 195_000_000, 130_000_000, +65e6),
            _mk_sector("XLU", +0.11, 90_000_000, 70_000_000, +20e6),
            _mk_sector("XLRE", -0.05, 70_000_000, 75_000_000, -5e6),
            _mk_sector("XLB", -0.23, 110_000_000, 130_000_000, -20e6),
            _mk_sector("XLI", -0.39, 180_000_000, 220_000_000, -40e6),
            _mk_sector("XLC", -0.71, 240_000_000, 305_000_000, -65e6),
            _mk_sector("XLY", -0.90, 310_000_000, 410_000_000, -100e6),
            # XLK is the headline: massive call selling
            _mk_sector("XLK", -1.51, 50_000_000, 446_240_000, -396_240_000),
        ],
        "market_tide": _mk_tide_series(close_net_call=-486_900_000.0,
                                       close_net_put=+103_000_000.0,
                                       shape="decline"),
        "sector_tides": {},
        "flow_alerts": _build_flow_alerts_2026_05_12(),
        "darkpool": {
            "MSFT": _mk_dp_prints(3_770_000_000, n_prints=80, mega_count=18),
            "SPY":  _mk_dp_prints(2_310_000_000, n_prints=60, mega_count=12),
            "NVDA": _mk_dp_prints(870_000_000, n_prints=40, mega_count=6),
            "AAPL": _mk_dp_prints(540_000_000, n_prints=30, mega_count=4),
            "GOOGL": _mk_dp_prints(410_000_000, n_prints=25, mega_count=3),
            "AMZN": _mk_dp_prints(395_000_000, n_prints=20, mega_count=3),
            "QQQ":  _mk_dp_prints(338_000_000, n_prints=22, mega_count=2),
            "META": _mk_dp_prints(280_000_000, n_prints=18, mega_count=2),
            "AVGO": _mk_dp_prints(220_000_000, n_prints=15, mega_count=2),
            "TSLA": _mk_dp_prints(195_000_000, n_prints=14, mega_count=1),
            "AMD":  _mk_dp_prints(140_000_000, n_prints=11, mega_count=1),
            "IWM":  _mk_dp_prints(98_000_000, n_prints=10, mega_count=1),
        },
        "data_quality": {
            "endpoints_ok": 18,
            "endpoints_failed": 0,
            "failures": [],
            "degraded": False,
        },
        "fetched_at": "2026-05-12T21:05:00Z",
    }


def _build_flow_alerts_2026_05_12() -> list[dict]:
    """Build a realistic flow-alert list matching the day's narrative."""
    alerts = []

    # NVDA — still net-bid: bullish flow
    for _ in range(8):
        alerts.append(_mk_alert("NVDA", "call", "ask", 3_500_000, v_oi=4.2, dte=30,
                                strike=950, price=12.0, size=2500))
    for _ in range(3):
        alerts.append(_mk_alert("NVDA", "put", "bid", 800_000, v_oi=2.0, dte=14,
                                strike=900, price=4.0))

    # QCOM — massive call selling (bearish)
    for _ in range(7):
        alerts.append(_mk_alert("QCOM", "call", "bid", 4_200_000, v_oi=5.0, dte=30,
                                strike=180, price=3.0, size=5000))
    for _ in range(4):
        alerts.append(_mk_alert("QCOM", "put", "ask", 1_500_000, v_oi=3.5, dte=21,
                                strike=170, price=2.5))

    # AAPL — small bullish bid
    for _ in range(5):
        alerts.append(_mk_alert("AAPL", "call", "ask", 1_500_000, v_oi=3.1, dte=30,
                                strike=200, price=4.0))

    # TSM — call selling
    for _ in range(4):
        alerts.append(_mk_alert("TSM", "call", "bid", 2_200_000, v_oi=4.0, dte=30,
                                strike=180, price=5.0))

    # MSFT — modestly long-dated calls
    for _ in range(3):
        alerts.append(_mk_alert("MSFT", "call", "ask", 1_200_000, v_oi=3.2, dte=90,
                                strike=450, price=8.0))

    # XLV / UNH — defensives bid
    for _ in range(6):
        alerts.append(_mk_alert("UNH", "call", "ask", 2_400_000, v_oi=4.5, dte=30,
                                strike=520, price=7.0))
    for _ in range(4):
        alerts.append(_mk_alert("XLV", "call", "ask", 1_600_000, v_oi=3.0, dte=21,
                                strike=160, price=2.0))

    # JPM / financials bid
    for _ in range(4):
        alerts.append(_mk_alert("JPM", "call", "ask", 1_800_000, v_oi=3.0, dte=30,
                                strike=210, price=5.0))

    # SPY puts (hedging)
    for _ in range(5):
        alerts.append(_mk_alert("SPY", "put", "ask", 2_800_000, v_oi=3.5, dte=14,
                                strike=510, price=4.5))

    # QQQ puts (hedging)
    for _ in range(6):
        alerts.append(_mk_alert("QQQ", "put", "ask", 2_400_000, v_oi=4.0, dte=14,
                                strike=440, price=4.0))

    # Put-sells across multiple names (vol selling)
    for tkr in ["XLV", "XLP", "XLF", "JPM", "UNH", "BAC", "WFC", "C",
                "PG", "KO", "PEP", "MRK", "JNJ", "ABBV", "LLY",
                "GS", "MS", "BLK", "SCHW", "CME", "ICE", "AXP"]:
        alerts.append(_mk_alert(tkr, "put", "bid", 400_000, v_oi=2.0, dte=21,
                                strike=100, price=2.0))

    # Cheap short-dated calls
    for tkr in ["F", "GE", "PLTR", "SOFI", "RIVN"]:
        alerts.append(_mk_alert(tkr, "call", "ask", 80_000, v_oi=2.0, dte=7,
                                strike=15, price=0.25))

    return alerts


# ---------------------------------------------------------------------------
# May 11, 2026 — Prior session (Monday, broadly green)
# ---------------------------------------------------------------------------

def fixture_2026_05_11() -> dict:
    return {
        "date": "2026-05-11",
        "prev_date": "2026-05-08",
        "market_totals": _mk_market_totals(
            call_prem=62_200_000_000.0,
            put_prem=41_800_000_000.0,
            call_vol=25_600_000,
            put_vol=21_500_000,
        ),
        "market_totals_prev": _mk_market_totals(
            call_prem=59_000_000_000.0,
            put_prem=42_500_000_000.0,
            call_vol=24_900_000,
            put_vol=22_100_000,
        ),
        "sector_etfs": [
            _mk_sector("SPY", +0.74, 1_400_000_000, 1_050_000_000, +350e6),
            _mk_sector("XLK", +1.42, 720_000_000, 320_000_000, +400e6),
            _mk_sector("XLC", +1.18, 320_000_000, 180_000_000, +140e6),
            _mk_sector("XLY", +1.05, 410_000_000, 260_000_000, +150e6),
            _mk_sector("XLI", +0.62, 240_000_000, 170_000_000, +70e6),
            _mk_sector("XLF", +0.55, 230_000_000, 180_000_000, +50e6),
            _mk_sector("XLB", +0.32, 130_000_000, 100_000_000, +30e6),
            _mk_sector("XLE", +0.18, 175_000_000, 155_000_000, +20e6),
            _mk_sector("XLRE", +0.07, 80_000_000, 75_000_000, +5e6),
            _mk_sector("XLV", -0.21, 180_000_000, 220_000_000, -40e6),
            _mk_sector("XLP", -0.34, 110_000_000, 145_000_000, -35e6),
            _mk_sector("XLU", -0.45, 70_000_000, 110_000_000, -40e6),
        ],
        "market_tide": _mk_tide_series(close_net_call=+277_000_000.0,
                                       close_net_put=-65_000_000.0,
                                       shape="rally"),
        "sector_tides": {},
        "flow_alerts": _build_flow_alerts_2026_05_11(),
        "darkpool": {
            "MSFT": _mk_dp_prints(2_900_000_000, n_prints=70, mega_count=12),
            "SPY":  _mk_dp_prints(2_800_000_000, n_prints=65, mega_count=14),
            "NVDA": _mk_dp_prints(2_290_000_000, n_prints=80, mega_count=20),
            "QQQ":  _mk_dp_prints(1_780_000_000, n_prints=50, mega_count=10),
            "AAPL": _mk_dp_prints(620_000_000, n_prints=32, mega_count=5),
            "AMZN": _mk_dp_prints(540_000_000, n_prints=28, mega_count=4),
            "GOOGL": _mk_dp_prints(490_000_000, n_prints=26, mega_count=4),
            "META": _mk_dp_prints(370_000_000, n_prints=22, mega_count=3),
            "AVGO": _mk_dp_prints(310_000_000, n_prints=18, mega_count=3),
            "TSLA": _mk_dp_prints(280_000_000, n_prints=16, mega_count=2),
            "AMD":  _mk_dp_prints(220_000_000, n_prints=14, mega_count=2),
            "IWM":  _mk_dp_prints(140_000_000, n_prints=12, mega_count=1),
        },
        "data_quality": {
            "endpoints_ok": 18,
            "endpoints_failed": 0,
            "failures": [],
            "degraded": False,
        },
        "fetched_at": "2026-05-11T21:05:00Z",
    }


def _build_flow_alerts_2026_05_11() -> list[dict]:
    alerts = []
    # Broad bullish tape — NVDA, MSFT, META all bid
    for _ in range(10):
        alerts.append(_mk_alert("NVDA", "call", "ask", 4_500_000, v_oi=4.8, dte=30,
                                strike=950, price=12.0, size=3000))
    for _ in range(6):
        alerts.append(_mk_alert("MSFT", "call", "ask", 2_800_000, v_oi=4.0, dte=30,
                                strike=450, price=9.0, size=2500))
    for _ in range(5):
        alerts.append(_mk_alert("META", "call", "ask", 3_200_000, v_oi=4.5, dte=30,
                                strike=520, price=11.0))
    for _ in range(4):
        alerts.append(_mk_alert("AMZN", "call", "ask", 2_100_000, v_oi=3.5, dte=30,
                                strike=200, price=4.0))
    for _ in range(4):
        alerts.append(_mk_alert("GOOGL", "call", "ask", 1_900_000, v_oi=3.2, dte=30,
                                strike=180, price=3.5))
    for _ in range(5):
        alerts.append(_mk_alert("TSLA", "call", "ask", 2_400_000, v_oi=4.0, dte=21,
                                strike=300, price=8.0))
    for _ in range(4):
        alerts.append(_mk_alert("AAPL", "call", "ask", 1_800_000, v_oi=3.3, dte=30,
                                strike=200, price=4.5))
    # Long-dated MSFT
    for _ in range(3):
        alerts.append(_mk_alert("MSFT", "call", "ask", 1_500_000, v_oi=3.0, dte=120,
                                strike=460, price=10.0))
    # Light puts
    for _ in range(3):
        alerts.append(_mk_alert("SPY", "put", "ask", 1_200_000, v_oi=2.5, dte=14,
                                strike=505, price=3.0))
    # Put sells
    for tkr in ["XLF", "JPM", "BAC", "F", "GE", "PLTR", "T", "VZ",
                "NVDA", "MSFT", "AAPL", "META", "TSLA", "AMD", "INTC",
                "SOFI", "PYPL", "DIS", "WMT", "TGT", "COST", "HD", "LOW"]:
        alerts.append(_mk_alert(tkr, "put", "bid", 350_000, v_oi=2.0, dte=21,
                                strike=100, price=1.5))
    # Cheap short-dated
    for tkr in ["F", "PLTR", "SOFI", "RIVN", "LCID"]:
        alerts.append(_mk_alert(tkr, "call", "ask", 60_000, v_oi=2.5, dte=7,
                                strike=15, price=0.20))
    return alerts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    tpl = ROOT / "daily_pulse_template.html.j2"
    out_dir = HERE
    out_dir.mkdir(parents=True, exist_ok=True)

    summary = {}
    for date, fx_fn, prev_fx_fn in [
        ("2026-05-11", fixture_2026_05_11, None),
        ("2026-05-12", fixture_2026_05_12, fixture_2026_05_11),
    ]:
        raw = fx_fn()
        prev = prev_fx_fn() if prev_fx_fn else None
        agg = aggregate(raw, prev)
        html = render_html(agg, tpl)
        check = brand_check(html)

        # Wrap in standalone HTML for nicer preview, with light CSS
        css = """<style>
        .aztmm-daily-pulse{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:24px auto;color:#1a1a1a;line-height:1.5}
        .dp-hero{border-left:4px solid #2563eb;padding:8px 16px;margin-bottom:24px;background:#f8fafc}
        .dp-meta{font-size:0.85rem;color:#475569}
        .dp-tag{display:inline-block;padding:2px 8px;background:#1e40af;color:#fff;border-radius:4px;font-weight:600}
        .dp-tag-bull{background:#16a34a}.dp-tag-bear{background:#dc2626}.dp-tag-defensive-rotation{background:#d97706}
        .dp-tag-risk-off-narrowing{background:#b91c1c}
        .dp-headline{margin:8px 0 0 0;font-size:1.4rem}
        .dp-section{margin:24px 0;padding-top:8px;border-top:1px solid #e2e8f0}
        .dp-section h3{margin-top:0;color:#0f172a}
        table.dp-heatmap,table.dp-darkpool{width:100%;border-collapse:collapse;font-size:0.9rem}
        table.dp-heatmap th,table.dp-darkpool th,table.dp-heatmap td,table.dp-darkpool td{padding:6px 8px;text-align:left;border-bottom:1px solid #f1f5f9}
        .dp-band-leading td{background:rgba(34,197,94,0.08)}
        .dp-band-lagging td{background:rgba(220,38,38,0.08)}
        .dp-band-pill{padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:600}
        .dp-band-pill-leading{background:#dcfce7;color:#166534}
        .dp-band-pill-lagging{background:#fee2e2;color:#991b1b}
        .dp-band-pill-neutral{background:#f1f5f9;color:#475569}
        .dp-narrowing-flag{padding:8px 12px;background:#fef3c7;border-left:4px solid #d97706;border-radius:4px}
        .dp-concentration{display:flex;gap:24px;flex-wrap:wrap}
        .dp-conc-col{flex:1;min-width:240px}
        .dp-footer{margin-top:32px;padding-top:16px;border-top:1px solid #cbd5e1;font-size:0.8rem;color:#64748b}
        .dp-tkr{color:#94a3b8;font-weight:400}
        details.dp-why{margin-top:16px;padding:8px 12px;background:#f8fafc;border-radius:4px}
        details.dp-why summary{cursor:pointer;font-weight:600;color:#334155}
        </style>"""
        wrapped = (
            f"<!doctype html><html><head><meta charset='utf-8'>"
            f"<title>Daily Pulse — {date}</title>{css}</head><body>{html}</body></html>"
        )

        out_path = out_dir / f"daily-pulse-{date}.html"
        out_path.write_text(wrapped)
        summary[date] = {
            "scenario": agg["scenario"]["label"],
            "headline": agg["scenario"]["headline"],
            "score": agg["scenario"]["score"],
            "brand_ok": check["ok"],
            "brand_hits": check["hits"],
            "html_bytes": len(html),
            "out": str(out_path),
        }

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
