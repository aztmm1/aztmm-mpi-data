# AZTMM Congress Watch - Tracker

End-of-session snapshot of recent congressional trade disclosures.
Publishes once per weekday at 5:00 PM ET to the page `/congress-watch/`.

## Surface

- WP page slug: `/congress-watch/`
- Methodology slug: `/congress-watch/methodology/`
- Disclaimer: "Personal observations of one trader. Not investment advice.
  Data refreshed once daily at 5:00 PM ET."

## Files

| File | Role |
|---|---|
| `config.yml` | Endpoint enable/disable, notability thresholds, sector map |
| `fetcher.py` | Pulls the disclosure feeds with retry + throttle |
| `aggregator.py` | Pure functions; normalization, notability detectors, public/internal partitioning |
| `publisher.py` | Brand-policy scrub, sanitization, Jinja render, WP payload builder |
| `dashboard.html.j2` | Page template, includes "as of" stamp + disclaimer |
| `run.py` | Orchestrator with `--date`, `--dry-run`, `--force-publish`, `--use-stub` |
| `workflow.yml` | GitHub Actions cron - both DST + EST entries |
| `methodology.md` | Public-safe methodology page |
| `sample-output/` | 2-3 dated example runs (public + internal JSON + HTML) |

## Install

```
cd outputs/congress-trades-tracker
python -m pip install -r requirements.txt
export UW_API_KEY="<your-token>"   # never commit
```

## Run

```
# Local dry-run (writes to sample-output/, no WP push)
python run.py --date 2026-05-11 --dry-run

# Live run (still emits payload only - WP push is delegated)
python run.py --date 2026-05-11

# Force-publish (status='publish' instead of 'draft')
python run.py --date 2026-05-11 --force-publish

# Network-free test (uses stub data, useful for CI smoke)
python run.py --date 2026-05-11 --dry-run --use-stub
```

## Output shape

Each run produces three artifacts:

- `congress-{date}.public.json` - jsDelivr-served. Sanitized. No vendor fields,
  no internal scoring, no raw counts.
- `congress-{date}.internal.json` - repo-only. Contains the public payload
  plus normalized full trade list and raw upstream counts. For internal
  inspection.
- `congress-{date}.html` - rendered page fragment for the WP page body.

## Idempotency

Re-running with the same `--date` overwrites the same dated files. The
workflow's idempotency guard also blocks the second cron (EST backup) from
re-running if the day's payload already shipped.

## Brand-policy scrub

The publisher runs the brand-policy check on the rendered HTML before any
write. A block fails the run with exit code 6 and dumps a needs-review HTML
under `data/needs-review/`. The forbidden list mirrors
`outputs/aztmm-agent-skills/aztmm-brand-policy-scrub/replacements.json`
plus the FRAMEWORK-RECAP-v2 section 2 list.

## Endpoints used (internal note)

| Endpoint | Role |
|---|---|
| `/api/congress/recent-trades` | Primary list of disclosures |
| `/api/congress/late-reports` | Late-filing window (timing color) |
| `/api/congress/congress-trader` | Per-member view (drill-down via `?name=`) |

Notes from the build probe:
- `/api/congress/recent-reports` returns 404 in the current API. Disabled in
  config; re-enable when upstream restores.
- `/api/congress/{member}/recent-trades` returns 404. We use
  `/api/congress/congress-trader?name=<member>` as the drill-down instead.

## Cadence + scheduling

GitHub Actions cron, both DST + EST entries, with an idempotency guard so
the second cron is a no-op once the first run logs success.

CF Workers backup cron (separate repo) covers the case where GH Actions does
not fire by 5:10 PM.

## License

AZTMM internal.
