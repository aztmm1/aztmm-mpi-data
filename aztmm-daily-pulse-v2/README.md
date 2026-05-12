# AZTMM Daily Pulse v2

End-of-day options + dark pool pulse. Auto-generated 5 PM ET, Mon–Fri.
Replaces the earlier BBS-based daily pulse with the richer end-of-day options
and dark pool data feeds.

## Files

| File | Purpose |
|---|---|
| `daily_pulse_fetcher.py` | Pulls raw end-of-day feeds for a date |
| `daily_pulse_aggregator.py` | Pure aggregation / scenario classification |
| `daily_pulse_template.html.j2` | Jinja2 post-body template |
| `daily_pulse_publisher.py` | Render + brand-policy scrubber + payload builder |
| `run_daily_pulse.py` | Orchestrator (CLI + run logs) |
| `publish_to_wp.py` | WordPress REST API publisher (called by workflow) |
| `daily-pulse-v2-update.yml` | GH Actions workflow (cron 21:00 UTC EDT / 22:00 UTC EST) |
| `methodology.md` | Public methodology page (no vendor names) |
| `sample-output/` | Rendered post bodies for verification |

## Install

```bash
cd outputs/aztmm-daily-pulse-v2
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Environment variables

| Var | Used by | Notes |
|---|---|---|
| `UW_API_TOKEN` | fetcher | NEVER commit. Loaded at runtime only. |
| `WP_SITE` | publisher | e.g. `aztmm.com` |
| `WP_USERNAME` | publisher | WP user with author/editor role |
| `WP_APP_PASSWORD` | publisher | WordPress application password (Users → Profile → Application Passwords). NOT your login password. |

## WordPress application password

1. Log in to WP admin, go to Users → Profile.
2. Scroll to **Application Passwords**.
3. Enter `aztmm-daily-pulse` and click **Add New**.
4. Copy the 24-character password (shown once).
5. Add it to GH Actions Secrets as `WP_APP_PASSWORD`.

## Local test

```bash
# Dry run for a specific date
UW_API_TOKEN=$YOUR_TOKEN python run_daily_pulse.py --date 2026-05-12 --dry-run --out-dir sample-output/

# Re-render only (from cached fetch JSON)
python daily_pulse_aggregator.py --input data/raw/2026-05-12.json --out data/agg/2026-05-12.json
python daily_pulse_publisher.py --agg data/agg/2026-05-12.json --template daily_pulse_template.html.j2 --out preview.html
```

## Schedule

The cron has two lines because GH Actions schedules in UTC but ET shifts by 1
hour twice a year.

| Period | ET offset | UTC cron |
|---|---|---|
| EDT (Mar–Nov) | UTC−4 | `0 21 * * 1-5` |
| EST (Nov–Mar) | UTC−5 | `0 22 * * 1-5` |

The orchestrator has an idempotency guard: if a run log for the target date
already shows `payload_emitted` or `dry_run_ok`, the second cron skips.

## Brand policy

The publisher runs a substring + regex scrubber on the rendered HTML.
Forbidden phrases (case-insensitive):

> CBOE, FRED, Yahoo, AAII, BBS, BlackBox, Black Box, HMM, Hidden Markov,
> transition matrix, ★, Unusual Whales, unusualwhales, " uw "

Plus regexes:

> `\bp\s*=\s*0\.\d+`, `\bweight\s*=\s*0\.\d+`, `\bscore\s*=\s*\d+`

Any hit → publish is **blocked**, an incident is written to `data/incidents/`,
the rendered HTML lands in `data/needs-review/`, and a macOS notification
fires. The post never goes live until a human reviews and fixes the source.

## First weeks of runs

`run_daily_pulse.py` defaults to `status=draft`. Open the WP admin Drafts
list, review, and Publish manually for the first ~10 runs. Once you trust
the output, set `force_publish: 'true'` in the workflow dispatch or change
the orchestrator default.

## Rollback plan

1. **Stop the cron**: comment out the two `cron:` lines in
   `daily-pulse-v2-update.yml` and push, OR disable the workflow from the
   GH Actions UI.
2. **Hide live posts**: in WP admin, set the offending day's post status to
   `private` or `pending`.
3. **Resume the BBS-based pipeline**: the v1 workflow is preserved in the
   `legacy/` folder if a fallback is needed.

## Audit-grade properties

- Walk-forward only — fetcher uses the target date as a hard upper bound.
- Idempotent on date — re-running the same date overwrites the run log only.
- Token never persisted — loaded from `UW_API_TOKEN` env var at call time.
- Defensive — each endpoint wraps try/except, failure marked in `data_quality`.
- Rate-limit aware — 0.6s throttle keeps under 120/min.
- Brand grep enforced — non-zero hit blocks publish.
- All academic citations live in `methodology.md`.
