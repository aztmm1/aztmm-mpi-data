# AZTMM Canonical Content API

Single source of truth for every value the public AZTMM site renders.

## URL
- https://cdn.jsdelivr.net/gh/aztmm1/aztmm-mpi-data@main/data/canonical-content.json

## Schema
- `schema_version`: API version.
- `generated_at`: ISO-8601 UTC timestamp.
- `mpi.{score, regime, as_of, computed_at, confidence, confidence_band}`: composite read.
- `market.{spy_close, vix, rv_30d, vrp}`: top-of-tape numbers.
- `latest_daily_pulse`, `latest_weekly_pulse`: most recent post per category.
- `recent_pulses`: last 5 daily/weekly posts merged, newest-first.
- `trackers.<name>.{as_of, snippet}`: per-tracker freshness + one-liner.

## Adding a new field
1. Add the field to `compose()` in `build_canonical.py`.
2. Wire the HTML surface with `data-canonical-key="<dotted.path>"` and a sane
   `data-canonical-default="..."` for graceful degradation.
3. Hydrator (WPCode "AZTMM - Canonical Content Hydrator v1") will pick it
   up on the next page load.

## Cache behavior
- jsDelivr CDN edge cache: ~5 min.
- Hydrator browser cache: 5 min (cache-busted by `?ts=...` quantized to 5 min).
- After a workflow commits a new value, surfaces update within ~5 min worst-case.

## Failure modes
- Missing source data: that field is omitted from the JSON entirely. Surfaces
  with `data-canonical-default="..."` fall back to the default. No page errors.
- JSON 404 / network failure: hydrator catches and silently keeps defaults.
- Schema bump: increment `schema_version`; old hydrator code keeps working
  because it only reads known dotted paths.

## Workflows that regenerate it
- `.github/workflows/mpi-update.yml`
- `.github/workflows/daily-pulse-v2.yml`
- `.github/workflows/weekly-pulse.yml`
- `.github/workflows/congress-watch.yml`
- `.github/workflows/options-gravity.yml`
- `.github/workflows/earnings-flow.yml`
- `.github/workflows/insider-activity.yml`
- `.github/workflows/squeeze-watch.yml`

Each appends a `Regenerate canonical-content.json` step that calls
`python3 aztmm-content-api/build_canonical.py` and commits the result if
changed.
