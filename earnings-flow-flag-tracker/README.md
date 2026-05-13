# Earnings Flow Flag tracker

Seventh daily tracker in the AZTMM platform. Intersection of "names reporting in the next 5 trading days" and "names whose options tape ran hot today." Pure observation, EOD only.

## Files

- `config.yml` &mdash; universe filters (mkt cap, ADV, options gate), flow floors, forward window, tilt bands. Internal-only thresholds.
- `fetcher.py` &mdash; pulls UW earnings (premarket + afterhours per forward-day) + per-ticker recent flow alerts; client-side filter to today.
- `aggregator.py` &mdash; intersects upcoming-earnings ∩ notable-flow-today; rolls up per-ticker; emits dual public/internal payloads.
- `publisher.py` &mdash; Jinja render + brand-policy scrub + sparkline history append + dual-output write. Earnings-specific bans on "earnings play", "trade the earnings", "earnings setup".
- `run.py` &mdash; orchestrator with `--date`, `--dry-run`, `--force-publish`, `--force-refresh`.
- `workflow.yml` &mdash; GH Actions cron `0 21 * * 1-5` + `0 22 * * 1-5` (covers EDT + EST); race-safe push; filename-date sort for `latest.{html,json}`; idempotency on date.
- `dashboard.html.j2` &mdash; renders header, sparkline, "what this is", tape totals, table, commentary, watching, how-to-read, data-quality (conditional), disclaimer block.
- `methodology.md` &mdash; public-safe explainer (no thresholds, no source attribution).
- `requirements.txt` &mdash; pinned.
- `sample-output/` &mdash; dated `earnings-flow-YYYY-MM-DD.{public.json,internal.json,html}` + `latest.{html,json}`.

## UW endpoint probe results (May 2026)

- `/api/market/economic-calendar` returns macro events only (`type` = `report`, `fed-speaker`, `FOMC`) &mdash; **no earnings rows** in current response. We do not use it.
- `/api/earnings/afterhours?date=YYYY-MM-DD` returns 50+ rows per date with `symbol`, `report_date`, `report_time` = `postmarket`, `sector`, `marketcap`, `has_options`, `is_s_p_500`, `street_mean_est`. Authoritative for postmarket reporters.
- `/api/earnings/premarket?date=YYYY-MM-DD` returns the same shape with `report_time` = `premarket`. Authoritative for premarket reporters.
- `/api/earnings/today` returns an empty `data` array on the snapshot we probed (`today` reports already done).
- `/api/option-trades/flow-alerts?ticker_symbol=T&limit=50` returns recent alert rows with `created_at`, `total_premium`, `total_size`, `type`, `sector`, `marketcap`, `next_earnings_date`. Filtered client-side to `created_at[0:10] == today`.

## Run

```bash
cd earnings-flow-flag-tracker
pip install -r requirements.txt
export UW_API_KEY=...
python run.py --date 2026-05-12 -v
```

Outputs land in `sample-output/`.

## Hard constraints honored

1. Dual-output sanitization &mdash; `public.json` published, `internal.json` repo-only.
2. Brand policy &mdash; "earnings play", "earnings setup", "trade the earnings", "trading the earnings", "play the earnings", "earnings trade" all in `FORBIDDEN_PHRASES_BASE`. Standard FRAMEWORK-RECAP-v2 forbidden phrases too.
3. Voice &mdash; observation only ("upcoming reporter", "name reporting soon"). No advisory phrasing.
4. Disclaimer &mdash; standard plus the earnings-specific "Earnings outcomes are unpredictable and options around earnings carry elevated risk" extension.
5. methodology.md is public-safe.
6. Sparkline = count of flagged names. Rolling 30 days.
7. Idempotent on date.
8. Walk-forward clean &mdash; `include_today=false`, so the snapshot excludes the very day it was taken.
9. Universe filter &mdash; market cap >= $500M, `has_options` required, ADV requirement enforced (penny stocks and illiquid names are filtered out by the upstream qualification).

## CF Worker registration

This tracker is registered in `cloudflare-cron-trigger/worker.js`:

- `WORKFLOWS.earningsFlow = "earnings-flow.yml"`
- Added to the 17:10&ndash;17:50 ET dispatch window
- Added to `FRESHNESS_TARGETS` for the 17:55 ET watchdog

Watchdog URL: `https://aztmm-cron-v2.aztmmhldgs.workers.dev/freshness`.
