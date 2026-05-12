# AZTMM 0DTE Pulse

End-of-day journal page summarising today's 0-day-to-expiration
options tape — which tickers attracted the heaviest notable prints,
how the dollar weight split call-side vs. put-side, and how today's
0DTE activity sat relative to the broader options tape. One snapshot
per weekday at 5 PM ET. Published as `/0dte-pulse/` on aztmm.com.

This is observation-only, not advisory. Read `methodology.md` and the
disclaimer block on the rendered page before doing anything else.

## Install

```bash
cd outputs/0dte-pulse-tracker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export UW_API_KEY=...   # or UW_API_TOKEN
```

## Run (local)

```bash
# Dry run for today
python run.py --dry-run

# Specific date (idempotent — same date overwrites the same artefacts)
python run.py --date 2026-05-12

# Force re-run even if the dated artefact exists
python run.py --date 2026-05-12 --force-refresh

# Verbose
python run.py --date 2026-05-12 -v
```

The pipeline writes three artefacts per date into `sample-output/`:

- `0dte-{date}.public.json`   → public-safe payload, scrubbed top-10 tickers
- `0dte-{date}.internal.json` → repo-only; per-ticker raw premium splits
- `0dte-{date}.html`          → rendered page body for inspection

Plus stable `latest.json` and `latest.html` files updated by the
workflow's filename-date sort step (used by the page's client-side
fetch).

## Pipeline shape

```
fetcher.py        — pages through flow alerts; filters to expiry == target_date
aggregator.py     — per-ticker rollup, tilt labels, market-share context
publisher.py      — Jinja2 render, brand-policy scrub, dual-output write
run.py            — orchestrator with --date and --dry-run
workflow.yml      — GH Actions cron, both DST + EST entries
dashboard.html.j2 — page body template
methodology.md    — public-safe explainer
```

## 0DTE definition (important)

The `dte=0` query parameter on the upstream flow-alerts endpoint is
not reliable — it returns mixed expiries. The fetcher therefore pages
through recent flow alerts and keeps only those whose listed `expiry`
matches the target date. This is the authoritative definition of 0DTE
used everywhere in this package.

Most Tuesdays and Thursdays will show only a handful of 0DTE notable
prints because SPX (and SPXW) are the main daily expiries on those
days. Mondays, Wednesdays, and Fridays — when SPY/QQQ also expire —
will tend to show more activity.

## Brand policy

`publisher.py::brand_check` blocks publish on any of:

- Vendor names (full FRAMEWORK-RECAP list)
- Advisory language: `buy`, `sell`, `recommend`, `signal`, `setup`,
  `target`, `entry`, `exit`, `imminent`, `breakout`, `play this`,
  `trade idea`, `should buy/sell/own/hold/short`
- Live / streaming positioning drift
- Model-internals leaks (`p=0.x`, `weight=0.x`, raw `score=x`)

The brand check is run on the rendered HTML. If it trips, the run
halts and the failing HTML is written to `data/needs-review/` for
triage.

## Idempotency

Same `--date` produces the same dated artefacts. The GH workflow's
guard step checks for the public artefact's existence before
re-running.

## Schedule

GH Actions cron registers both expressions for DST coverage:

- `0 21 * * 1-5` — 5 PM ET during EDT
- `0 22 * * 1-5` — 5 PM ET during EST

Either one firing produces the snapshot; the second one is a no-op
because of the idempotency guard.

## What this package does NOT do

- It does not stream tape data.
- It does not publish per-ticker direction calls.
- It does not disclose the exact thresholds used to qualify notable
  prints, nor the data sources behind the readings.
- It does not show every 0DTE trade — only qualifying notable prints
  rolled up per ticker.
