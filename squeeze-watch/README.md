# AZTMM Squeeze Watch

End-of-day screen of publicly traded names with combined short-pressure
and options-interest characteristics. One snapshot per weekday at 5 PM
ET. Published as `/squeeze-watch/` on aztmm.com.

This is observation-only, not advisory. Read `methodology.md` and the
disclaimer block on the rendered page before doing anything else.

## Install

```bash
cd outputs/squeeze-watch
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export UW_API_KEY=...   # or UW_API_TOKEN
```

## Run (local)

```bash
# Dry run for today
python run.py --dry-run

# Specific date (idempotent — same date overwrites the same artefacts)
python run.py --date 2026-05-11

# Verbose
python run.py --date 2026-05-11 -v
```

The pipeline writes three artefacts per date into `sample-output/`:

- `squeeze-{date}.public.json`   → ships to jsDelivr; scrubbed, top-10 names
- `squeeze-{date}.internal.json` → repo-only; raw scores, all components, filtered list
- `squeeze-{date}.html`          → rendered page body for inspection

## Pipeline shape

```
fetcher.py       — pulls short-pressure + options-context per ticker
aggregator.py    — composite score, banding, top-10 cut, commentary lines
publisher.py     — Jinja2 render, brand-policy scrub, dual-output write
run.py           — orchestrator with --date and --dry-run
workflow.yml     — GH Actions cron, both DST + EST entries
dashboard.html.j2 — page body template
methodology.md   — public-safe explainer
```

## Brand policy

`publisher.py::brand_check` blocks publish on any of:

- Vendor names (full FRAMEWORK-RECAP list)
- Advisory language: `buy`, `sell`, `recommend`, `signal`, `setup`,
  `target`, `entry`, `exit`, `imminent`, `breakout`, `play this`,
  `trade idea`, `should buy/sell/own/hold/short`
- Live/streaming positioning drift
- Model-internals leaks (`p=0.x`, `weight=0.x`, raw `score=x`)

The brand check is run on the rendered HTML, not the input data. If it
trips, the run halts and the failing HTML is written to
`data/needs-review/` for triage.

## Idempotency

Same `--date` produces the same dated artefacts. The GH workflow's
guard step checks for the public artefact's existence before re-running.

## Schedule

GH Actions cron registers both crons:

- `0 21 * * 1-5` — 5 PM ET during EDT
- `0 22 * * 1-5` — 5 PM ET during EST

Either one firing produces the snapshot; the second one is a no-op
because of the idempotency guard.

## What this package does NOT do

- It does not stream live data.
- It does not publish per-ticker direction calls.
- It does not disclose the exact thresholds used to score names, nor
  the data sources behind the readings.
- It does not include penny-stock or micro-cap names — the liquidity
  floor filters them out before scoring.
