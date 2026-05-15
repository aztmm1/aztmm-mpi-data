# Earnings Flow Flag tracker

PATH A LOCKED 2026-05-15. Free-source rebuild.

Daily observation log for names reporting earnings in the next 14 days,
sourced from `yfinance` only. Pure observation, EOD only. No recommendations.

## Source

- `yfinance.Ticker(symbol).calendar` → next earnings date + EPS estimate
- `yfinance.Ticker(symbol).option_chain(expiry)` → ATM strike / IV / OI for
  the nearest expiry on or after the earnings date
- Implied move = ATM straddle / spot × 100

## Files

- `yf_fetcher.py` — the active fetcher (universe = top 50 SP500 mkt cap)
- `sample-output/latest.{html,json}` — newest snapshot
- `sample-output/earnings-flow-YYYY-MM-DD.{public.json,html}` — dated archive
- `*.uw.disabled` — legacy UW pipeline, retained for reference only
- `requirements.txt` — yfinance, pandas, etc.

## Run

```bash
cd earnings-flow-flag-tracker
pip install -r requirements.txt
python yf_fetcher.py --universe-size 50 --sleep 0.3
```

## CI

`.github/workflows/earnings-flow.yml` — weekday 5 PM ET cron (DST + EST).
Idempotent: dated artefact re-runs skip; `latest.{html,json}` refreshed via
filename-date sort.

## Policy

- Observation only, never recommendations
- Source not disclosed on the public page
- 14-day forward window
- EOD-only updates
