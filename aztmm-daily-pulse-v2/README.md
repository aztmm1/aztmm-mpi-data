# AZTMM Daily Pulse v3 (Free-Source Rewrite)

End-of-day options + dark pool pulse. Auto-generated 5 PM ET, Mon-Fri.

**v3 changes (May 2026):** rewrote fetcher to use ONLY free data sources.
Zero UW dependency. Sources are explicitly disclosed in the methodology
footnote on every post.

## Files

| File | Purpose |
|---|---|
| `daily_pulse_fetcher.py` | Pulls raw EOD feeds (yfinance + FINRA + EDGAR + repo MPI) |
| `daily_pulse_aggregator.py` | Pure aggregation + conviction gate + tell rendering |
| `daily_pulse_template.html.j2` | Jinja2 post-body template (email-safe, WP-block-wrapped) |
| `daily_pulse_publisher.py` | Render + brand-policy scrubber + payload builder |
| `run_daily_pulse.py` | Orchestrator (CLI + run logs) |
| `publish_to_wp.py` | WordPress REST API publisher (called by workflow) |
| `daily-pulse-v2-update.yml` | GH Actions workflow — HALTED, main agent re-enables after verify |
| `methodology.md` | Public methodology page |
| `sample-output/` | Rendered post bodies for verification |

## Data sources (post-UW, all free)

| Source | What it provides | Lag / caveat |
|---|---|---|
| **yfinance EOD option chain** | Per-strike volume, OI, IV, bid/ask for top 50 names + 12 sector ETFs (nearest 2 expiries) | EOD only, IV-rank is heuristic |
| **yfinance ^VIX / ^VIX3M** | Volatility regime baseline | EOD |
| **CBOE Daily Volume Summary CSV** | Equity P/C ratio history | **403 from CDN endpoint as of May 2026** — falls back to yfinance-aggregated P/C |
| **FINRA OTC Transparency API** | ATS by-symbol weekly notional (dark-pool proxy) | **T-14 to T-28 lag** (latest is the prior 1-4 weeks) |
| **SEC EDGAR Form 4** | Recent insider filings per ticker (last 14 days) | Filing-date only; does NOT distinguish buys from sells without primary-doc parsing |
| **`data/mpi.json`** | Live MPI score + regime from the regime tool | Refreshed by MPI workflow, read at runtime |
| **`ECON_CAL_2026` (hardcoded)** | Tomorrow's macro catalyst (CPI/FOMC/NFP/OPEX/PCE etc.) | Static — refresh monthly |

## Install

```bash
cd aztmm-daily-pulse-v2
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Environment variables

| Var | Used in | Notes |
|---|---|---|
| `EDGAR_USER_AGENT` | fetcher | Optional. Defaults to "AZTMM Research nikhil.kothari17@gmail.com". SEC requires a real UA with email. |

**No paid-API tokens required.** The previous `UW_API_TOKEN` is no longer used and is safe to delete from GH Actions secrets.

## CLI

### Free-source dry run (spec-compliant)
```bash
python3 daily_pulse_aggregator.py --asof 2026-05-15 --dry-run --fast
# --fast limits to 5 names + 3 sectors for ~30 second smoke test
# without --fast, full top-50 + 12 sectors (~90-120 seconds)
```

### Legacy file-driven (back-compat)
```bash
python3 daily_pulse_fetcher.py --asof 2026-05-15 --fast --out raw.json
python3 daily_pulse_aggregator.py --input raw.json --out agg.json
```

### Full orchestrator (publish path)
```bash
python3 run_daily_pulse.py --date 2026-05-15 --dry-run --out-dir sample-output/
```

## Conviction scoring (INTERNAL — NEVER surfaced in HTML)

Per-ticker composite (0-100). Surface names with score >= 80 (capped at 3 tells).

| Component | Max pts | Source |
|---|---|---|
| Flow imbalance (call/put ask ratio) | 30 | yfinance option chain |
| Volume spike + premium scale | 25 | yfinance option chain |
| IV-rank elevation | 15 | yfinance heuristic |
| Dark-pool concentration (T-14) | 15 | FINRA ATS weekly |
| Insider crossover (Form 4 in 14d) | 15 | SEC EDGAR |

## Brand-check policy

`daily_pulse_publisher.brand_check()` flags forbidden phrases in the post body.
The **methodology footnote is exempt** (it intentionally names sources per the v3 disclosure policy). Forbidden phrases include:

> fred, aaii, bbs, blackbox, hmm, hidden markov, transition matrix, ★, Unusual Whales, unusualwhales

Model weights / agent scores / methodology numbers caught via regex (e.g. `p=0.42`, `weight=0.3`, `score=4.2`).

## Methodology footnote (every post)

> "Data sources: yfinance EOD options chain - CBOE Daily Volume Summary - FINRA OTC Transparency (T-14) - SEC EDGAR Form 4 - Not investment advice."

Rendered inline at the bottom of every post, outside the email card.

## v3 known caveats / next-session queue

1. **CBOE equity-P/C CSV endpoint returns 403** consistently. The methodology footnote retains the source label (it's the canonical reference) but the actual P/C is computed from yfinance-aggregated volumes. Investigate authenticated CBOE DataShop endpoint or alternate path.
2. **EDGAR Form 4 classification is row-count-only.** Cannot distinguish buy (P) from sell (S) without parsing each filing's primary XML doc. Track A (insider tracker) may have a richer parser to reuse.
3. **FINRA ATS lag is T-14 to T-28**, not T-7. The conviction gate weights this signal accordingly (max 15 pts).
4. **IV-rank is heuristic** mapped from raw IV (yfinance doesn't expose true IV rank). Replace with a 252-day rolling rank when historical chains are cached.
5. **`ECON_CAL_2026` is hardcoded** through June 2026. Refresh monthly or wire to `https://www.federalreserve.gov/newsevents/calendar.htm` scrape.

## Workflow status

Per Track-B instructions: `daily-pulse-v2-update.yml` is **halted**. Main agent re-enables after verify.
