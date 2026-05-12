# AZTMM Insider Activity

End-of-week journal page summarising the prior seven days of Form 4
insider transactions — which companies attracted the heaviest
open-market buying, which companies saw the heaviest open-market
selling, and how the dollar weight distributed across sectors. One
snapshot per Friday at 5 PM ET. Published as `/insider-activity/` on
aztmm.com.

This is observation-only, not advisory. Read `methodology.md` and the
disclaimer block on the rendered page before doing anything else.

## Install

```bash
cd outputs/insider-activity-tracker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export UW_API_KEY=...   # or UW_API_TOKEN
```

## Run (local)

```bash
# Dry run for the most recent Friday
python run.py --dry-run

# Specific week-ending Friday (idempotent — same date overwrites)
python run.py --week-ending 2026-05-08

# Force re-run even if the dated artefact exists
python run.py --week-ending 2026-05-08 --force-refresh

# Verbose
python run.py --week-ending 2026-05-08 -v
```

The pipeline writes three artefacts per week into `sample-output/`:

- `insider-{week-ending}.public.json`   → public-safe payload, top buyers + sellers + sectors
- `insider-{week-ending}.internal.json` → repo-only; per-ticker raw values, transaction-code counts, filer names
- `insider-{week-ending}.html`          → rendered page body for inspection

Plus stable `latest.json` and `latest.html` files updated by the
workflow's filename-date sort step (used by the page's client-side
fetch).

## Pipeline shape

```
fetcher.py        — pages through Form 4 transactions, filters to trailing-7-day window
aggregator.py     — per-ticker rollup of P (buys) and S (sells), sector rollup, observation commentary
publisher.py      — Jinja2 render, brand-policy scrub, dual-output write
run.py            — orchestrator with --week-ending and --dry-run
workflow.yml      — GH Actions Friday cron, both DST + EST entries
dashboard.html.j2 — page body template
methodology.md    — public-safe explainer
```

## Window definition (important)

The page covers a trailing seven-day window ending on Friday. Filings
are matched by their `transaction_date`, not their `filing_date`, so
a trade that happened on Monday and was filed on Wednesday counts as
a Monday filing for the purposes of this page.

Form 4 has a two-business-day filing deadline, so the trailing
seven-day window captures the full reporting cycle for the week's
transactions in essentially all cases. If a filing slips past the
deadline, it lands in the following week's snapshot.

## Brand policy

`publisher.py::brand_check` blocks publish on any of:

- Vendor names (full FRAMEWORK-RECAP list)
- Advisory language: bare `buy`, `sell`, `recommend`, `signal`,
  `setup`, `target`, `entry`, `exit`, `imminent`, `breakout`,
  `play this`, `trade idea`, `should buy/sell/own/hold/short`,
  `follow this insider`, `buy what they're buying`
- Live / streaming positioning drift
- Model-internals leaks (`p=0.x`, `weight=0.x`, raw `score=x`)

Compound noun phrases like "insider buying", "open-market buying",
and "top buyers" are explicitly allow-listed because they describe
past Form 4 events, not present-tense recommendations.

The brand check is run on the rendered HTML. If it trips, the run
halts and the failing HTML is written to `data/needs-review/` for
triage.

## Idempotency

Same `--week-ending` produces the same dated artefacts. The GH
workflow's guard step checks for the public artefact's existence
before re-running.

## Schedule

GH Actions cron registers both expressions for DST coverage:

- `0 21 * * 5` — 5 PM ET Friday during EDT
- `0 22 * * 5` — 5 PM ET Friday during EST

The CF Worker backup dispatcher fires the workflow if the GH cron is
dormant (registered in `cloudflare-cron-trigger/worker.js` under
`WORKFLOWS.insiderActivity`). Watchdog `FRESHNESS_TARGETS` includes
this tracker by slug.

## What this package does NOT do

- It does not stream insider transactions intraday.
- It does not publish per-ticker direction calls.
- It does not disclose the exact thresholds used to qualify filings,
  nor the data sources behind the readings.
- It does not interpret why an insider transacted.
