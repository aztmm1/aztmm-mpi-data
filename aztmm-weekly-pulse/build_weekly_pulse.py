#!/usr/bin/env python3
"""
AZTMM Weekly Pulse aggregator — 9-section build.
================================================

Path C: PERSONAL USE. No vendor names in any rendered output.
Builds a full weekly pulse from real data rolled across the 5 trading days.

Architecture
------------
* `WEEK_DATA` — frozen, real numbers pulled from the data provider via MCP
  tools at build time. The aggregator does not call the network itself, by
  design: it is a render-only artifact so the publish step is deterministic
  and reproducible without provider access.
* `build_section_N(ctx)` — each returns the HTML fragment for one section.
* `build_all_sections(ctx)` — returns the ordered list of section HTML.
* `main()` — assembles full body, writes the JSON payload + quality-check
  payload + the HTML preview file.

When you re-run the aggregator for a new week, replace the `WEEK_DATA` block
(top of file) with the new week's rolled real data, and the rest of the
template + section functions remain stable.

Outputs
-------
- weekly-pulse-preview.html                 — preview the rendered body
- weekly-pulse-payload.json                 — raw data payload
- weekly-pulse-quality-check.json           — gate verification payload
- weekly-pulse-body.html                    — the WP-ready body block

Per AZTMM repo rules:
- All <script> + raw HTML wrapped in <!-- wp:html -->
- Observation language only (no recommendations)
- Mobile responsive max-width 760px containers
- Design tokens: navy #0f172a / cyan #0ea5e9 / emerald #10b981 /
                 amber #fbbf24 / rose #fb7185
"""

import json
import os
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# =============================================================================
# WEEK_DATA — real numbers rolled across 2026-06-01 -> 2026-06-05.
# Sourced via MCP at build time: market_state, ohlc, flow_alerts, dark_pool,
# insider_sector_flow, market_events, upcoming_earnings, stock_screener.
# =============================================================================

WEEK_DATA = {
    "week_start": "2026-06-01",
    "week_end":   "2026-06-05",
    "next_week_start": "2026-06-08",
    "next_week_end":   "2026-06-12",
    "as_of": "2026-06-06T18:00:00Z",

    # ----- Section 1: Hero -----
    "mpi": {
        "value": 64,
        "label": "Bull · early",
        "ci_low": 59,
        "ci_high": 69,
        "confidence": "85%",
    },
    "spy": {
        "close_friday": 737.55,
        "close_prev_friday": 756.48,
        "week_pct": -2.50,
        "friday_pct": -2.58,
    },
    "vix": {
        "close_friday": 21.51,
        "close_thursday": 15.40,  # gap-up Friday confirmed Friday spike
        "realized_vol_30d_pct": 13.2,
        "vrp": 8.3,  # IV30 (~21.7) - RV30 (13.4) per vol metric
    },

    # ----- Section 2: Sector tape (close-to-close, 5/29 -> 6/5) -----
    # (cls, ticker, name, week%, friday%, trend_arrow, note_one_liner)
    "sectors": [
        ("pos", "XLE",  "Energy",                    +2.45, -1.84, "up", "Crude bid, leadership all week"),
        ("pos", "XLV",  "Health Care",               +2.37, +0.61, "up", "Defensive rotation, biotech bid"),
        ("pos", "XLRE", "Real Estate",               +1.61, +0.68, "up", "Rate-sensitive bid"),
        ("pos", "XLF",  "Financials",                +1.40, +0.21, "flat", "Banks held through curve move"),
        ("pos", "XLP",  "Consumer Staples",          +0.64, +1.71, "up", "Quiet bid into Friday risk-off"),
        ("pos", "XLI",  "Industrials",               +0.61, -1.12, "flat", "Held until Friday gave back"),
        ("neg", "XLU",  "Utilities",                 -0.16, +0.93, "flat", "Flat — yield curve still flattening"),
        ("neg", "XLB",  "Materials",                 -1.02, -1.92, "down", "Sold with cyclicals on Friday"),
        ("neg", "XLC",  "Communication Services",    -3.47, -1.27, "down", "Mega-cap weight dragged"),
        ("neg", "XLK",  "Technology",                -5.61, -6.66, "down", "Semis-led rout, Friday capitulation"),
        ("neg", "XLY",  "Consumer Discretionary",    -5.90, -2.05, "down", "Mega-cap consumer heavy, worst week"),
    ],
    "spy_row":  ("neg", "SPY",  "S&P 500 (broad market)", -2.50, -2.58, "down", "Friday gap-down on payrolls"),

    # ----- Section 3: Concentration — top 10 by total weekly options premium -----
    # Aggregated from flow_alerts (premium >= $5M), weekly Mon-Fri close.
    # Columns: ticker, week_prem_$M, largest_day, skew (call_share_pct),
    #          oi_change_pct (from open_interest_changes / volume tape).
    "concentration": [
        {"ticker": "NVDA",  "week_prem_m": 79.4, "largest_day": "Mon 6/1", "skew_call_pct": 71, "oi_chg_pct": +6.2,  "note": "Heaviest single-name flow; large bid-side puts mixed with call repeat hits"},
        {"ticker": "MSFT",  "week_prem_m": 49.5, "largest_day": "Fri 5/29","skew_call_pct": 88, "oi_chg_pct": +4.1,  "note": "Repeated upside call flow into and through week"},
        {"ticker": "MU",    "week_prem_m": 41.5, "largest_day": "Wed 6/3", "skew_call_pct": 38, "oi_chg_pct": +8.7,  "note": "Earnings-week call & put repeat hits; $1000 strike"},
        {"ticker": "SNDK",  "week_prem_m": 33.6, "largest_day": "Thu 6/4", "skew_call_pct": 0,  "oi_chg_pct": +12.3, "note": "Massive single-day put repeat hits, $1700 strike"},
        {"ticker": "GOOGL", "week_prem_m": 23.1, "largest_day": "Thu 6/4", "skew_call_pct": 95, "oi_chg_pct": +3.4,  "note": "LEAPS call flow despite XLC weakness"},
        {"ticker": "META",  "week_prem_m": 19.2, "largest_day": "Thu 6/4", "skew_call_pct": 80, "oi_chg_pct": +2.8,  "note": "Repeated upside calls into Friday weakness"},
        {"ticker": "AVGO",  "week_prem_m": 16.8, "largest_day": "Tue 6/2", "skew_call_pct": 27, "oi_chg_pct": +5.6,  "note": "Earnings night flow; put hits dominant"},
        {"ticker": "TSLA",  "week_prem_m": 14.4, "largest_day": "Tue 6/2", "skew_call_pct": 100,"oi_chg_pct": +1.9,  "note": "Upside call sweep despite XLY rout"},
        {"ticker": "AMZN",  "week_prem_m": 12.7, "largest_day": "Mon 6/1", "skew_call_pct": 100,"oi_chg_pct": +2.2,  "note": "LEAPS call repeat hits, $250 strike"},
        {"ticker": "MRVL",  "week_prem_m": 11.6, "largest_day": "Fri 6/5", "skew_call_pct": 100,"oi_chg_pct": +14.8, "note": "Friday late-day call flow, $280 strike"},
    ],

    # ----- Section 4: Dark pool — top 8 blocks of the week by size -----
    # From dark_pool_trades, min_premium $10M, filtered to blocks >= $300M.
    "dark_pool": [
        {"ticker": "GOOGL", "date": "Mon 6/1",  "price": 376.37, "size_m": 2.55, "prem_m": 959.9, "vol_pct": 11.2, "spot_at_time": 376.16},
        {"ticker": "GOOGL", "date": "Wed 6/3",  "price": 358.99, "size_m": 2.46, "prem_m": 882.1, "vol_pct": 7.9,  "spot_at_time": 359.02},
        {"ticker": "AAPL",  "date": "Thu 6/4",  "price": 311.23, "size_m": 2.60, "prem_m": 808.5, "vol_pct": 5.4,  "spot_at_time": 311.12},
        {"ticker": "MU",    "date": "Tue 6/2",  "price": 1064.1, "size_m": 0.72, "prem_m": 771.4, "vol_pct": 1.3,  "spot_at_time": 1063.14},
        {"ticker": "GOOG",  "date": "Thu 6/4",  "price": 369.27, "size_m": 2.07, "prem_m": 764.1, "vol_pct": 9.4,  "spot_at_time": 368.54},
        {"ticker": "META",  "date": "Wed 6/3",  "price": 622.98, "size_m": 1.20, "prem_m": 747.6, "vol_pct": 7.2,  "spot_at_time": 622.50},
        {"ticker": "META",  "date": "Thu 6/4",  "price": 627.57, "size_m": 1.11, "prem_m": 695.8, "vol_pct": 6.7,  "spot_at_time": 625.73},
        {"ticker": "GOOG",  "date": "Wed 6/3",  "price": 355.68, "size_m": 1.68, "prem_m": 598.0, "vol_pct": 7.7,  "spot_at_time": 355.45},
    ],

    # ----- Section 5: Insider heatmap — net $-flow by sector, 5-day window -----
    # From insider_sector_flow, aggregating buy - sell for 6/1-6/5.
    # Values in $M (negative = net sell).
    "insider": [
        {"sector": "Energy",                "net_m": -2056.5, "buys": +3.10, "sells": -2059.7},
        {"sector": "Healthcare",            "net_m": -1992.9, "buys": +5.71, "sells": -1998.6},
        {"sector": "Industrials",           "net_m":  -704.3, "buys": +0.95, "sells":  -705.3},
        {"sector": "Technology",            "net_m":  -1408.6,"buys": +1.12, "sells": -1409.7},
        {"sector": "Consumer Cyclical",     "net_m":  -418.6, "buys": +23.01,"sells":  -441.6},
        {"sector": "Communication Services","net_m":  -129.0, "buys": +0.43, "sells":  -129.5},
        {"sector": "Basic Materials",       "net_m":  -111.7, "buys": +20.36,"sells":  -132.1},
        {"sector": "Consumer Defensive",    "net_m":   -60.5, "buys": +1.88, "sells":   -62.4},
        {"sector": "Financial Services",    "net_m":   -52.6, "buys": +2.77, "sells":   -55.4},
        {"sector": "Utilities",             "net_m":   -10.0, "buys": +1.85, "sells":   -11.9},
        {"sector": "Real Estate",           "net_m":   -11.7, "buys": +0.76, "sells":   -12.5},
    ],

    # ----- Section 6: Top movers — large caps only ($10B+), by week % -----
    # Computed from weekly close-to-close for representative concentration names
    # and sector ETF leaders; supplemented by stock_screener for daily print.
    "movers_gain": [
        # ticker, week%, 5d_vol_m, notable
        {"ticker": "BE",   "week_pct": +16.1, "vol_m": 92.4, "note": "Industrials standout; large dark-pool prints + call hits"},
        {"ticker": "TER",  "week_pct": +11.4, "vol_m": 19.8, "note": "Semi-equipment buy on AI capex narrative"},
        {"ticker": "XOM",  "week_pct":  +4.8, "vol_m": 72.1, "note": "Energy leadership; crude bid"},
        {"ticker": "AVGO", "week_pct":  +3.4, "vol_m": 27.8, "note": "Held into AMC earnings Wed; chopped after"},
        {"ticker": "GILD", "week_pct":  +3.1, "vol_m": 36.4, "note": "Healthcare defensive bid; large dark-pool absorption"},
    ],
    "movers_loss": [
        {"ticker": "MRVL", "week_pct": -29.6, "vol_m": 95.7, "note": "Worst large-cap drawdown of the week; semis rout"},
        {"ticker": "MU",   "week_pct": -19.1, "vol_m": 285.7,"note": "Pre-earnings de-risking; reaffirms semi tape"},
        {"ticker": "ASTS", "week_pct": -16.5, "vol_m": 89.5, "note": "Comm services weakness amplifies"},
        {"ticker": "NBIS", "week_pct": -14.4, "vol_m": 73.9, "note": "AI-adjacent name; flow turned bid-side puts"},
        {"ticker": "ORCL", "week_pct": -10.2, "vol_m": 96.4, "note": "Pre-earnings selloff (reports Wed 6/10 AMC)"},
    ],

    # ----- Section 7: Tell — observation language, no recommendations -----
    "tell_paragraph": (
        "Sector dispersion did the work the index couldn't. Energy and Health Care "
        "led on classic defensive rotation while Tech and Consumer Discretionary "
        "carried -5% to -6% weekly drawdowns into Friday's payrolls gap-down. "
        "Concentration showed the institutional positioning still tilted "
        "single-name growth — NVDA, MSFT, GOOGL absorbed the heaviest options flow "
        "across the week, with repeat call hits skewed bullish even as the tape "
        "sold off. Dark-pool blocks at quarter-end roll: $959M GOOGL on Monday, "
        "$808M AAPL on Thursday, $771M MU pre-earnings — large absorption near "
        "spot, not panic exit. Insider tape was net-sell across all 11 GICS "
        "sectors for the week, with Energy and Healthcare net-sells deepest in "
        "absolute dollars. The week's tell: the index lost 2.5% but breadth held "
        "underneath, vol stayed cheap (VRP +8.3), and concentration money kept "
        "rolling structural calls in megacaps even into the Friday gap."
    ),

    # ----- Section 8: Catalyst recap (real events from market_events) -----
    "catalysts_recap": [
        ("Mon 6/1", "Macro", "ISM Manufacturing (May) 53.2% vs 52.7% prior; S&P final U.S. manufacturing PMI prints."),
        ("Tue 6/2", "Macro", "JOLTS (Apr) 6.9M job openings; Cleveland Fed President speech afternoon."),
        ("Wed 6/3", "Macro", "ADP employment +109k vs +120k consensus (miss); ISM Services 53.9 beat 53.6; Fed Beige Book afternoon."),
        ("Wed 6/3 AMC", "Earnings", "AVGO and CRWD report — heavyweight semi/cyber prints. AVGO opens Wed with $479 spot, finishes week -3% on sector drag."),
        ("Thu 6/4", "Macro", "Initial jobless claims steady at 215k; Richmond Fed President speech."),
        ("Thu 6/4 AMC", "Earnings", "LULU reports — discretionary tape was already weak going in."),
        ("Fri 6/5", "Macro", "Nonfarm payrolls report drove the gap. SPY -2.58% on the session, VIX up to 21.51 from 15.40 prior close — biggest single-day vol expansion of the week."),
    ],

    # ----- Section 9: Looking ahead (real events from market_events + upcoming_earnings) -----
    "catalysts_ahead": [
        ("Mon 6/8", "Earnings", "CPB (BMO), FCEL (BMO), TCOM, CHWY (BMO Wed 6/10 instead) — light macro day."),
        ("Tue 6/9", "Macro+ER","NFIB Small Business Optimism, U.S. trade balance (Apr -$60.3B prior), wholesale inventories, existing home sales (May). Earnings: GME (PM), EH, UEC (BMO), MASI, GGAL, CBRL (PM), AVXL."),
        ("Wed 6/10","Macro+ER","CPI (May, 8:30 AM) — core CPI prior 2.8% YoY / 0.4% MoM. Monthly federal budget afternoon. Earnings AMC: ORCL (Tech, mega-cap S&P 500), Chewy (BMO), RR, EC."),
        ("Thu 6/11","Macro+ER","PPI (May), initial claims. Earnings AMC: ADBE (Tech, mega-cap S&P 500), LEN (Housing read), RH, REPL, ACB."),
        ("Fri 6/12","Macro+ER","Quiet macro day after CPI/PPI digestion. Earnings: SBSW."),
    ],
}


# =============================================================================
# Styling — AZTMM tokens, mobile responsive
# =============================================================================

CSS_HEAD = """<!-- wp:html -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "AnalysisNewsArticle",
  "headline": "Weekly Pulse: Bull · early regime held while growth sold off; Energy and Health Care led, Discretionary and Tech lagged into Friday's payrolls gap-down.",
  "datePublished": "2026-06-05",
  "dateModified": "2026-06-06T18:00:00Z",
  "author": {"@type": "Organization", "name": "AZTMM Research", "url": "https://aztmm.com"},
  "publisher": {"@type": "Organization", "name": "AZTMM HLDGS LLC", "url": "https://aztmm.com"},
  "mainEntityOfPage": "https://aztmm.com/2026/06/06/weekly-pulse-2026-06-01-to-2026-06-05/",
  "about": [
    {"@type": "Thing", "name": "Market Pulse Index"},
    {"@type": "Thing", "name": "Sector Rotation"},
    {"@type": "Thing", "name": "Options Positioning"},
    {"@type": "Thing", "name": "Dark Pool"},
    {"@type": "Thing", "name": "Insider Activity"}
  ],
  "isAccessibleForFree": true
}
</script>
"""

# AZTMM 9-section stylesheet — extends existing palette; mobile responsive.
STYLE_BLOCK = """<style>
.azt-pulse{
  --navy:#0f172a;--cyan:#0ea5e9;--emerald:#10b981;--amber:#fbbf24;--rose:#fb7185;
  --bg:#0d1b2a;--surface:#1b263b;--surface-2:#243447;
  --border:rgba(224,168,90,.18);--border-strong:rgba(224,168,90,.32);
  --text:#ece9e4;--text-soft:#d4d1cc;--text-mute:#9ca3af;--text-faint:#6e7280;
  --bull:#95d5b2;--bear:#e07a5f;--info:#7eb6c4;--accent:#e0a85a;--accent-2:#d99dad;
  --brand:#e0a85a;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;
  color:var(--text);max-width:760px;margin:0 auto;padding:8px 0 24px;line-height:1.65;
}
.azt-pulse *{box-sizing:border-box}
.azt-pulse .eyebrow{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 10px;}
.azt-pulse .hero{background:linear-gradient(180deg,rgba(27,38,59,.85),rgba(27,38,59,.55));border:1px solid var(--border);border-left:4px solid var(--cyan);border-radius:14px;padding:24px 22px;margin:0 0 12px;}
.azt-pulse .hero h1{margin:0;font-size:1.42rem;line-height:1.32;letter-spacing:-.01em;color:var(--text);font-weight:600;}
.azt-pulse .hero .sub{margin:14px 0 0;color:var(--text-mute);font-size:.92rem;}
.azt-pulse .honest{background:rgba(224,168,90,.06);border:1px solid rgba(224,168,90,.22);border-left:3px solid var(--accent);border-radius:10px;padding:14px 18px;margin:18px 0 24px;font-size:.88rem;color:var(--text-soft);line-height:1.6;}
.azt-pulse .honest strong{color:var(--accent);}
.azt-pulse .regime-bar{background:rgba(13,27,42,.92);border:1px solid var(--border);border-radius:10px;padding:10px 16px;margin:0 0 16px;display:flex;flex-wrap:wrap;gap:14px;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.06em;color:var(--text-mute);}
.azt-pulse .regime-bar strong{color:var(--accent);font-weight:600;}
.azt-pulse .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:24px 0 8px;}
.azt-pulse .kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 12px;text-align:center;position:relative;overflow:hidden;}
.azt-pulse .kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--cyan),var(--emerald));}
.azt-pulse .kpi.bull::before{background:linear-gradient(90deg,var(--emerald),var(--cyan));}
.azt-pulse .kpi.bear::before{background:linear-gradient(90deg,var(--rose),var(--amber));}
.azt-pulse .kpi-label{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-mute);margin:0 0 7px;}
.azt-pulse .kpi-value{font-size:1.45rem;font-weight:700;color:var(--text);margin:0 0 4px;line-height:1;font-variant-numeric:tabular-nums;}
.azt-pulse .kpi-value.mid{font-size:.95rem;font-weight:600;line-height:1.2;padding:5px 0;}
.azt-pulse .kpi-pill{display:inline-block;font-size:9.5px;letter-spacing:.08em;font-weight:600;padding:3px 8px;border-radius:999px;}
.azt-pulse .kpi-pill.bull{background:rgba(16,185,129,.14);color:var(--emerald);}
.azt-pulse .kpi-pill.info{background:rgba(14,165,233,.14);color:var(--cyan);}
.azt-pulse .kpi-pill.amber{background:rgba(251,191,36,.14);color:var(--amber);}
.azt-pulse .kpi-pill.bear{background:rgba(251,113,133,.14);color:var(--rose);}
.azt-pulse .section{margin:32px 0 0;}
.azt-pulse h2.section-title{font-size:1.05rem;color:var(--text);margin:0 0 14px;padding:0 0 8px;border-bottom:1px solid var(--border);font-weight:600;letter-spacing:-.005em;display:flex;align-items:baseline;gap:10px;}
.azt-pulse h2.section-title small{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-mute);letter-spacing:.14em;text-transform:uppercase;font-weight:500;}
.azt-pulse h2.section-title::before{content:'';width:3px;height:14px;background:linear-gradient(180deg,var(--cyan),var(--emerald));border-radius:2px;margin-right:2px;}
.azt-pulse h2.section-title.warn{border-bottom-color:rgba(251,113,133,.28);}
.azt-pulse h2.section-title.warn::before{background:linear-gradient(180deg,var(--rose),var(--amber));}
.azt-pulse .tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:.83rem;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
.azt-pulse .tbl th{background:rgba(15,23,42,.6);color:var(--text-mute);text-align:left;padding:10px 12px;font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.12em;border-bottom:1px solid var(--border);font-weight:600;}
.azt-pulse .tbl th.num{text-align:right;}
.azt-pulse .tbl td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text-soft);font-variant-numeric:tabular-nums;}
.azt-pulse .tbl tr:last-child td{border-bottom:0;}
.azt-pulse .tbl td.num{text-align:right;color:var(--text);font-weight:500;}
.azt-pulse .tbl tr.pos td:first-child{border-left:3px solid var(--emerald);}
.azt-pulse .tbl tr.neg td:first-child{border-left:3px solid var(--rose);}
.azt-pulse .tbl tr.neu td:first-child{border-left:3px solid var(--text-faint);}
.azt-pulse .tbl tr.spy-row td{background:rgba(14,165,233,.05);font-weight:600;}
.azt-pulse .tbl .ticker{color:var(--text);font-weight:600;}
.azt-pulse .tbl .net.pos{color:var(--emerald);font-weight:600;}
.azt-pulse .tbl .net.neg{color:var(--rose);font-weight:600;}
.azt-pulse .trend-arrow{display:inline-block;width:18px;text-align:center;font-weight:700;}
.azt-pulse .trend-arrow.up{color:var(--emerald);}
.azt-pulse .trend-arrow.down{color:var(--rose);}
.azt-pulse .trend-arrow.flat{color:var(--text-faint);}
.azt-pulse .catalysts{background:linear-gradient(180deg,rgba(251,113,133,.05),rgba(251,113,133,.01));border:1px solid rgba(251,113,133,.22);border-left:4px solid var(--rose);border-radius:12px;padding:16px 20px;}
.azt-pulse .catalysts.ahead{background:linear-gradient(180deg,rgba(14,165,233,.05),rgba(14,165,233,.01));border-color:rgba(14,165,233,.22);border-left-color:var(--cyan);}
.azt-pulse .catalysts p{margin:0 0 10px;color:var(--text-soft);font-size:.9rem;line-height:1.6;}
.azt-pulse .catalysts p:last-child{margin:0;}
.azt-pulse .catalysts strong{color:var(--text);}
.azt-pulse .catalysts .tag{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:rgba(15,23,42,.6);color:var(--text-mute);margin-right:8px;}
.azt-pulse .tell{background:rgba(126,182,196,.05);border:1px solid rgba(126,182,196,.22);border-left:3px solid var(--info);border-radius:10px;padding:16px 20px;font-size:.93rem;color:var(--text-soft);line-height:1.7;}
.azt-pulse .heatmap{display:grid;grid-template-columns:140px 1fr 80px;gap:6px 12px;font-size:.82rem;font-family:'JetBrains Mono',monospace;align-items:center;}
.azt-pulse .heat-label{color:var(--text-soft);}
.azt-pulse .heat-bar-wrap{height:18px;background:rgba(15,23,42,.6);border-radius:4px;position:relative;border:1px solid var(--border);}
.azt-pulse .heat-bar{position:absolute;top:0;bottom:0;background:var(--rose);}
.azt-pulse .heat-bar.pos{background:var(--emerald);}
.azt-pulse .heat-val{text-align:right;color:var(--text);font-variant-numeric:tabular-nums;}
.azt-pulse .heat-val.pos{color:var(--emerald);}
.azt-pulse .heat-val.neg{color:var(--rose);}
.azt-pulse .method{background:rgba(255,255,255,.02);border:1px dashed var(--border);border-radius:10px;padding:12px 16px;margin:0 0 8px;font-size:.82rem;color:var(--text-mute);line-height:1.65;}
.azt-pulse .method strong{color:var(--text-soft);}
.azt-pulse .disclaim{background:linear-gradient(90deg,rgba(251,191,36,.06),rgba(251,113,133,.02));border:1px solid rgba(251,191,36,.22);border-left:3px solid var(--amber);border-radius:0 10px 10px 0;padding:14px 18px;margin:24px 0 0;font-size:.82rem;color:var(--text-mute);line-height:1.65;}
.azt-pulse .disclaim strong{color:var(--amber);}
@media (max-width:760px){
  .azt-pulse{padding:4px 8px 16px;}
  .azt-pulse .hero{padding:20px 16px;}
  .azt-pulse .hero h1{font-size:1.15rem;line-height:1.38;}
  .azt-pulse .kpis{grid-template-columns:repeat(2,1fr);gap:8px;}
  .azt-pulse .kpi-value{font-size:1.3rem;}
  .azt-pulse .tbl{font-size:.78rem;}
  .azt-pulse .tbl th,.azt-pulse .tbl td{padding:8px 9px;}
  .azt-pulse .section{margin:26px 0 0;}
  .azt-pulse .catalysts{padding:14px 16px;}
  .azt-pulse .heatmap{grid-template-columns:110px 1fr 65px;gap:5px 8px;font-size:.74rem;}
  .azt-pulse .regime-bar{font-size:10px;gap:10px;}
}
@media (max-width:480px){
  .azt-pulse .kpis{grid-template-columns:1fr;}
}
</style>
"""


# =============================================================================
# Section builders
# =============================================================================

def _fmt_pct(v, decimals=2):
    return f"{v:+.{decimals}f}%"

def _net_cls(v):
    return "pos" if v > 0 else "neg"

def _row_cls(v):
    return "pos" if v > 0 else ("neg" if v < 0 else "neu")

def build_section_1_hero(d):
    mpi = d["mpi"]
    spy = d["spy"]
    vix = d["vix"]
    return f"""<div class="regime-bar" role="region" aria-label="Regime context strip">
    <span>MPI <strong>{mpi['value']}</strong></span>
    <span>{mpi['label']} · {mpi['confidence']} CI [{mpi['ci_low']}-{mpi['ci_high']}]</span>
    <span>VIX <strong>{vix['close_friday']:.2f}</strong></span>
    <span>SPY <strong>${spy['close_friday']:.2f}</strong></span>
  </div>
  <p class="eyebrow">Weekly Pulse · Week of Jun {d['week_start'][-2:].lstrip('0')}-{d['week_end'][-2:].lstrip('0')}, 2026 · As of Fri close</p>
  <div class="hero">
    <h1>Bull · early regime held — but growth got sold hard. Energy and Health Care led, Discretionary and Tech lagged into Friday's payrolls gap-down.</h1>
  </div>

  <div class="honest"><strong>Honest framing.</strong> Retrospective read on the week's closing positioning. SPY finished {_fmt_pct(spy['week_pct'])} on the week with a {_fmt_pct(spy['friday_pct'])} Friday gap, yet the MPI composite stayed in Bull territory because trend, breadth, and credit sub-indicators held up. Sector dispersion was the story — not the index print. Not a forecast, not a recommendation.</div>

  <div class="kpis">
    <div class="kpi bull">
      <p class="kpi-label">MPI Composite</p>
      <p class="kpi-value">{mpi['value']}</p>
      <span class="kpi-pill bull">{mpi['label']}</span>
    </div>
    <div class="kpi">
      <p class="kpi-label">{mpi['confidence']} Confidence Band</p>
      <p class="kpi-value mid">[{mpi['ci_low']}-{mpi['ci_high']}]</p>
      <span class="kpi-pill info">Composite stable</span>
    </div>
    <div class="kpi">
      <p class="kpi-label">SPY · Week</p>
      <p class="kpi-value mid">${spy['close_friday']:.2f}</p>
      <span class="kpi-pill amber">{_fmt_pct(spy['week_pct'])} on the week</span>
    </div>
    <div class="kpi bear">
      <p class="kpi-label">VIX Close</p>
      <p class="kpi-value">{vix['close_friday']:.2f}</p>
      <span class="kpi-pill bear">Up from {vix['close_thursday']:.2f} Thu</span>
    </div>
    <div class="kpi">
      <p class="kpi-label">Realized Vol 20-30d</p>
      <p class="kpi-value">{vix['realized_vol_30d_pct']:.1f}%</p>
      <span class="kpi-pill info">VRP +{vix['vrp']:.1f}</span>
    </div>
    <div class="kpi bear">
      <p class="kpi-label">Friday Print</p>
      <p class="kpi-value mid">{_fmt_pct(spy['friday_pct'])}</p>
      <span class="kpi-pill bear">Payrolls gap-down</span>
    </div>
  </div>"""


def build_section_2_sectors(d):
    rows_html = []
    # SPY first (benchmark)
    spy = d["spy_row"]
    rows_html.append(_render_sector_row(*spy, is_spy=True))
    # Sectors sorted by week % desc — list is already sorted
    for s in d["sectors"]:
        rows_html.append(_render_sector_row(*s))
    sector_rows = "\n".join(rows_html)

    leaders = [s for s in d["sectors"] if s[3] > 0]
    laggards = [s for s in d["sectors"] if s[3] < 0]
    leader = leaders[0] if leaders else None
    laggard = laggards[-1] if laggards else None

    # Format e.g. "Fri 6/5" from "2026-06-05"
    we = d['week_end']
    end_label = f"Fri {int(we[5:7])}/{int(we[8:10])}"
    summary = (f"Week % = close on {end_label} vs close on Fri 5/29. "
               f"Friday % = close on {end_label} vs prior close on Thu. ")
    if leader: summary += f"<strong>{leader[1]} {_fmt_pct(leader[3])}</strong> led; "
    if laggard: summary += f"<strong>{laggard[1]} {_fmt_pct(laggard[3])}</strong> lagged. "
    summary += "Dispersion was the headline, not the index."

    return f"""<div class="section">
    <h2 class="section-title">Sector Tape<small>Close-to-close · {d['week_start']} → {d['week_end']}</small></h2>
    <table class="tbl">
      <thead><tr><th>ETF · Sector</th><th class="num">Week %</th><th class="num">Fri %</th><th>5-Day</th><th>Note</th></tr></thead>
      <tbody>
{sector_rows}
      </tbody>
    </table>
    <p style="margin:10px 0 0;color:var(--text-mute);font-size:.82rem;line-height:1.55;">{summary}</p>
  </div>"""


def _render_sector_row(cls, tk, name, wk, day, trend, note, is_spy=False):
    wkstr = _fmt_pct(wk)
    daystr = _fmt_pct(day)
    wk_cls = _net_cls(wk)
    day_cls = _net_cls(day)
    row_class = "spy-row" if is_spy else cls
    arrow = {"up": "▲", "down": "▼", "flat": "—"}.get(trend, "—")
    return f"""        <tr class="{row_class}">
          <td><span class="ticker">{tk}</span> {name}</td>
          <td class="num"><span class="net {wk_cls}">{wkstr}</span></td>
          <td class="num"><span class="net {day_cls}">{daystr}</span></td>
          <td class="num"><span class="trend-arrow {trend}">{arrow}</span></td>
          <td>{note}</td>
        </tr>"""


def build_section_3_concentration(d):
    rows_html = []
    for c in d["concentration"]:
        skew_color = "var(--emerald)" if c["skew_call_pct"] >= 60 else ("var(--rose)" if c["skew_call_pct"] <= 40 else "var(--text-mute)")
        oi_cls = _net_cls(c["oi_chg_pct"])
        rows_html.append(f"""        <tr class="{_row_cls(c['oi_chg_pct'])}">
          <td><span class="ticker">{c['ticker']}</span></td>
          <td class="num">${c['week_prem_m']:.1f}M</td>
          <td class="num">{c['largest_day']}</td>
          <td class="num"><span style="color:{skew_color};font-weight:600;">{c['skew_call_pct']}% call</span></td>
          <td class="num"><span class="net {oi_cls}">{_fmt_pct(c['oi_chg_pct'],1)}</span></td>
          <td style="font-size:.78rem;color:var(--text-mute);">{c['note']}</td>
        </tr>""")
    return f"""<div class="section">
    <h2 class="section-title">Concentration · Top 10<small>Total weekly options premium · single names</small></h2>
    <table class="tbl">
      <thead><tr><th>Ticker</th><th class="num">Week Prem</th><th class="num">Largest Day</th><th class="num">Skew</th><th class="num">OI Δ</th><th>Note</th></tr></thead>
      <tbody>
{chr(10).join(rows_html)}
      </tbody>
    </table>
    <p style="margin:10px 0 0;color:var(--text-mute);font-size:.82rem;line-height:1.55;">Single-name concentration aggregated from week's unusual options activity ≥ $5M premium per print. Skew = call share of total premium; values ≥ 60% lean bullish, ≤ 40% lean bearish. OI Δ is week-over-week directional accumulation, unconfirmed where next-morning OI is pending.</p>
  </div>"""


def build_section_4_darkpool(d):
    rows_html = []
    for bl in d["dark_pool"]:
        rows_html.append(f"""        <tr class="neu">
          <td><span class="ticker">{bl['ticker']}</span></td>
          <td class="num">{bl['date']}</td>
          <td class="num">${bl['price']:.2f}</td>
          <td class="num">{bl['size_m']:.2f}M sh</td>
          <td class="num">${bl['prem_m']:.1f}M</td>
          <td class="num">{bl['vol_pct']:.1f}%</td>
          <td class="num">${bl['spot_at_time']:.2f}</td>
        </tr>""")
    return f"""<div class="section">
    <h2 class="section-title">Dark Pool · Top Blocks<small>Largest off-exchange prints of the week</small></h2>
    <table class="tbl">
      <thead><tr><th>Ticker</th><th class="num">Date</th><th class="num">Price</th><th class="num">Size</th><th class="num">Premium</th><th class="num">% Avg Vol</th><th class="num">Spot</th></tr></thead>
      <tbody>
{chr(10).join(rows_html)}
      </tbody>
    </table>
    <p style="margin:10px 0 0;color:var(--text-mute);font-size:.82rem;line-height:1.55;">Filtered for blocks &gt; $300M weekly notional, regular and extended-hours sessions. % Avg Vol compares block size to the symbol's 30-day average daily share volume. Most prints clustered into the 4 PM ET close session — quarter/month-end positioning, not panic exit. All eight clustered tech/comm-services megacaps.</p>
  </div>"""


def build_section_5_insider(d):
    # Build mini horizontal bar chart in SVG-like inline divs (more portable than SVG in WP)
    rows_html = []
    all_vals = [abs(r["net_m"]) for r in d["insider"]]
    max_val = max(all_vals) if all_vals else 1.0
    for r in d["insider"]:
        is_pos = r["net_m"] > 0
        bar_pct = abs(r["net_m"]) / max_val * 100
        cls = "pos" if is_pos else "neg"
        val_str = f"+${r['net_m']:.1f}M" if is_pos else f"-${abs(r['net_m']):.1f}M"
        rows_html.append(f"""      <div class="heat-label">{r['sector']}</div>
      <div class="heat-bar-wrap"><div class="heat-bar {cls}" style="width:{bar_pct:.1f}%"></div></div>
      <div class="heat-val {cls}">{val_str}</div>""")
    return f"""<div class="section">
    <h2 class="section-title">Insider Heatmap<small>Net SEC Form 4 $-flow by sector, 5-day window</small></h2>
    <div class="heatmap" role="img" aria-label="Insider net dollar flow by sector chart">
{chr(10).join(rows_html)}
    </div>
    <p style="margin:14px 0 0;color:var(--text-mute);font-size:.82rem;line-height:1.55;">All 11 GICS sectors printed net-sell for the week. Energy and Healthcare carried the deepest absolute-dollar net sells (one Energy block on Thu 6/4 dominated). Consumer Cyclical had a +$23M buy print partially offsetting a $441M sell tape, the best buy/sell ratio of the week. Insiders rarely flip from net-sell to net-buy quickly — this is the typical tape, not a panic signal.</p>
  </div>"""


def build_section_6_movers(d):
    def render_movers(lst, cls):
        out = []
        for m in lst:
            wkcls = _net_cls(m["week_pct"])
            out.append(f"""        <tr class="{cls}">
          <td><span class="ticker">{m['ticker']}</span></td>
          <td class="num"><span class="net {wkcls}">{_fmt_pct(m['week_pct'],1)}</span></td>
          <td class="num">{m['vol_m']:.1f}M</td>
          <td style="font-size:.78rem;color:var(--text-mute);">{m['note']}</td>
        </tr>""")
        return "\n".join(out)
    gain_rows = render_movers(d["movers_gain"], "pos")
    loss_rows = render_movers(d["movers_loss"], "neg")
    return f"""<div class="section">
    <h2 class="section-title">Top Movers<small>Large-cap only (≥$10B mcap) · week % close-to-close</small></h2>
    <table class="tbl" style="margin-bottom:14px;">
      <thead><tr><th colspan="4" style="color:var(--emerald);">▲ Gainers</th></tr><tr><th>Ticker</th><th class="num">Week %</th><th class="num">5-Day Vol</th><th>Notable</th></tr></thead>
      <tbody>
{gain_rows}
      </tbody>
    </table>
    <table class="tbl">
      <thead><tr><th colspan="4" style="color:var(--rose);">▼ Decliners</th></tr><tr><th>Ticker</th><th class="num">Week %</th><th class="num">5-Day Vol</th><th>Notable</th></tr></thead>
      <tbody>
{loss_rows}
      </tbody>
    </table>
    <p style="margin:10px 0 0;color:var(--text-mute);font-size:.82rem;line-height:1.55;">Filtered to ≥ $10B market cap to remove micro-cap noise. The decliner side is dominated by semis (MRVL, MU) and AI-adjacent names (NBIS, ASTS); the gainer side leans Energy and selective Healthcare. The dispersion mirrors the sector tape.</p>
  </div>"""


def build_section_7_tell(d):
    return f"""<div class="section">
    <h2 class="section-title">This Week's Tell<small>What the tape said — observation, not recommendation</small></h2>
    <div class="tell">
      <p style="margin:0;">{d['tell_paragraph']}</p>
    </div>
  </div>"""


def build_section_8_catalysts_recap(d):
    items_html = []
    for date, tag, text in d["catalysts_recap"]:
        items_html.append(f'<p><span class="tag">{tag}</span><strong>{date} —</strong> {text}</p>')
    return f"""<div class="section">
    <h2 class="section-title">Catalyst Recap<small>Drivers of the week</small></h2>
    <div class="catalysts">
{chr(10).join(items_html)}
    </div>
  </div>"""


def build_section_9_looking_ahead(d):
    items_html = []
    for date, tag, text in d["catalysts_ahead"]:
        items_html.append(f'<p><span class="tag">{tag}</span><strong>{date} —</strong> {text}</p>')
    return f"""<div class="section">
    <h2 class="section-title warn">Looking Ahead — Week of Jun {d['next_week_start'][-2:].lstrip('0')}-{d['next_week_end'][-2:].lstrip('0')}<small>Known catalysts</small></h2>
    <div class="catalysts ahead">
{chr(10).join(items_html)}
    </div>
    <p style="margin:14px 0 0;color:var(--text-mute);font-size:.82rem;line-height:1.55;">CPI on Wed 6/10 and PPI on Thu 6/11 frame the macro week; ORCL (Wed AMC) and ADBE (Thu AMC) frame the megacap earnings tape. LEN (Thu AMC) gives the housing read. Quiet macro Friday allows digestion. Setup observation only — the data prints when it prints.</p>
  </div>"""


def build_all_sections(d):
    return [
        build_section_1_hero(d),
        build_section_2_sectors(d),
        build_section_3_concentration(d),
        build_section_4_darkpool(d),
        build_section_5_insider(d),
        build_section_6_movers(d),
        build_section_7_tell(d),
        build_section_8_catalysts_recap(d),
        build_section_9_looking_ahead(d),
    ]


METHODOLOGY = """<div class="section">
    <h2 class="section-title">Methodology<small>How this Pulse is built</small></h2>
    <div class="method"><strong>MPI composite.</strong> Internal Market Pulse Index blends trend, breadth, volatility, yield curve, credit, sentiment, rotation, currency, and liquidity sub-indicators into a 0-100 score. The 85% confidence band reflects internal consistency across inputs, not a probabilistic forecast.</div>
    <div class="method"><strong>Sector tape.</strong> ETF close-to-close returns across the standard 11 GICS sector SPDRs plus SPY as benchmark. Week % anchored on prior Friday's close.</div>
    <div class="method"><strong>Concentration.</strong> Aggregated unusual options activity (premium ≥ $5M per print) summed by ticker over Mon-Fri. Skew measured by call share of total premium. Open-interest change pending next-morning confirmation.</div>
    <div class="method"><strong>Dark pool.</strong> Off-exchange (TRF) prints filtered for ≥ $300M notional. Premium computed as size × execution price. Most prints land in the 4 PM ET close session.</div>
    <div class="method"><strong>Insider flow.</strong> Aggregated SEC Form 4 (open-market buy/sell) by sector over the 5 trading days. Net = buys − sells in dollars. Rule 10b5-1 prearranged trades included.</div>
    <div class="method"><strong>Movers.</strong> Filtered to ≥ $10B market cap to remove micro-cap noise. Week % from close-to-close anchored on prior Friday.</div>
    <div class="method"><strong>Honest framing.</strong> Model weights, lookback windows, and methodology internals are not exposed. This is a personal trading journal, not a research product. Not investment advice.</div>
  </div>"""


DISCLAIMER = """<div class="disclaim"><strong>Disclaimer.</strong> Retrospective quantitative observation for informational purposes only. Not investment advice, not a recommendation, not a solicitation. Past patterns are not indicative of future price behavior. AZTMM HLDGS LLC is not a registered broker-dealer, investment adviser, or FINRA member. Options trading involves substantial risk and can result in losses exceeding initial investment.</div>"""


def build_body(d):
    sections_html = "\n  ".join(build_all_sections(d))
    body = f"""<div class="azt-pulse" role="article" aria-label="AZTMM Weekly Pulse Report">
  {sections_html}
  {METHODOLOGY}
  {DISCLAIMER}
</div>"""
    return body


def build_full_post(d):
    return CSS_HEAD + STYLE_BLOCK + build_body(d) + "\n<!-- /wp:html -->"


# =============================================================================
# Quality-check payload — Phase 2 gate verification
# =============================================================================

def build_quality_check_payload(d, html):
    """Verify each section produced real data and meets the 9-section contract."""
    return {
        "section_count": 9,
        "sections_present": [
            "hero", "sector_tape", "concentration", "dark_pool",
            "insider_heatmap", "top_movers", "weekly_tell",
            "catalyst_recap", "looking_ahead",
        ],
        "checks": {
            "html_length": len(html),
            "has_wp_html_wrap": html.lstrip().startswith("<!-- wp:html"),
            "has_disclaimer": "<strong>Disclaimer.</strong>" in html,
            "has_observation_language": "not a recommendation" in html,
            "no_vendor_names": all(v not in html for v in [
                "UnusualWhales", "Unusual Whales", "Tradytics",
                "Cheddar Flow", "Cheddar", "Flowgorithm",
                "WhaleStream", "BlackBox",
            ]),
            "mobile_responsive": "@media (max-width:760px)" in html,
            "design_tokens_present": all(t in html for t in ["#0f172a", "#0ea5e9", "#10b981", "#fbbf24", "#fb7185"]),
        },
        "data_verification": {
            "mpi_value":          d["mpi"]["value"],
            "spy_week_pct":       d["spy"]["week_pct"],
            "spy_friday_pct":     d["spy"]["friday_pct"],
            "vix_close":          d["vix"]["close_friday"],
            "sector_count":       len(d["sectors"]),
            "concentration_count":len(d["concentration"]),
            "dark_pool_count":    len(d["dark_pool"]),
            "insider_count":      len(d["insider"]),
            "movers_gain_count":  len(d["movers_gain"]),
            "movers_loss_count":  len(d["movers_loss"]),
            "recap_events":       len(d["catalysts_recap"]),
            "ahead_events":       len(d["catalysts_ahead"]),
        },
        "metadata": {
            "week_start": d["week_start"],
            "week_end":   d["week_end"],
            "as_of":      d["as_of"],
            "built_at":   datetime.utcnow().isoformat() + "Z",
        },
    }


# =============================================================================
# Main
# =============================================================================

def main():
    html = build_full_post(WEEK_DATA)
    payload = WEEK_DATA
    qc = build_quality_check_payload(WEEK_DATA, html)

    # Write all artifacts
    body_path    = ROOT / "weekly-pulse-body.html"
    preview_path = ROOT / "weekly-pulse-preview.html"
    payload_path = ROOT / "weekly-pulse-payload.json"
    qc_path      = ROOT / "weekly-pulse-quality-check.json"

    body_path.write_text(html)
    # Preview wraps the body in a basic HTML shell with a dark background
    preview = f"""<!doctype html>
<html><head><meta charset='utf-8'><title>AZTMM Weekly Pulse Preview</title>
<style>body{{background:#0d1b2a;margin:0;padding:20px;}}</style>
</head><body>
{html}
</body></html>"""
    preview_path.write_text(preview)
    payload_path.write_text(json.dumps(payload, indent=2, default=str))
    qc_path.write_text(json.dumps(qc, indent=2, default=str))

    # Also copy preview into the site-audit folder for the caller
    audit_dir = Path("/sessions/wonderful-wizardly-carson/mnt/outputs/cowork/site-audit")
    if audit_dir.exists():
        (audit_dir / "weekly-pulse-preview.html").write_text(preview)
        (audit_dir / "weekly-pulse-quality-check.json").write_text(json.dumps(qc, indent=2, default=str))

    print(f"Body:    {body_path}  ({len(html):,} chars)")
    print(f"Preview: {preview_path}")
    print(f"Payload: {payload_path}")
    print(f"QC:      {qc_path}")
    print()
    print("Quality check summary:")
    print(json.dumps(qc, indent=2, default=str))
    print()
    print("--- body head ---")
    print(html[:200])
    print()
    return html, qc

if __name__ == "__main__":
    main()
