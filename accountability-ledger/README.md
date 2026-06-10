# Accountability Ledger

Every trading night, a GitHub Action reads the latest **Daily Pulse** post from the
public WordPress REST API, extracts each dated observation into a structured row,
and scores all open rows against end-of-day closes. The full history is append-only:
rows are never deleted, never rewritten after resolution, and misses stay on the page.

This is calibration, not performance marketing. The ledger exists so that anyone —
including us — can check how the desk's written observations actually aged. Resolved
rows that went the wrong way are kept verbatim, with the move that invalidated them.
Personal observations of one trader. Not investment advice.

## How it works

```
WP REST API (Daily Pulse category)
        │  extract_and_score.py --repo-root .
        ▼
data/calls.json                       ← append-only history (sorted by date, id)
accountability-ledger/sample-output/
  latest.json                         ← daily snapshot (fresh `date` key every run)
  latest.html                         ← self-contained dark-styled table snapshot
```

Schedule: `15 3 * * 2-6` UTC (≈ 23:15 ET the prior evening, Mon–Fri, after the
5 PM ET Daily Pulse publish). See `.github/workflows/ledger-score.yml`.

## What gets extracted

| Row type | Source in the post | id | Horizon |
|---|---|---|---|
| `radar` | "Names on our radar" table (Ticker / Signal / Read) | `<post_slug>:<TICKER>` | 21 trading sessions |
| `watch` | "What to watch into …" bullets | `<post_slug>:watch<i>` | 1 trading session |
| `regime` | Header strip `Regime <label>` | `<post_slug>:regime` | 21 trading sessions (vs SPY) |

Direction is inferred from the post's own wording:

- **up** — call buying, accumulation, floor, support, upside, call sweep
- **down** — put buying, distribution, hedging, downside, breakdown
- **watch** — no directional wording, or both sides present (two-sided positioning
  is logged but never force-fitted into a direction)

Regime labels map Bull → up, Bear/Crisis → down, Neutral → flat.

## Row schema (`data/calls.json`)

```json
{
  "id": "daily-pulse-…-9-june-2026:MU",
  "date": "2026-06-09",
  "type": "radar",
  "ticker": "MU",
  "statement": "<Signal> — <Read>  (plain text, ≤200 chars; watch rows ≤250)",
  "direction": "up | down | flat | watch",
  "horizon_days": 21,
  "status": "open | hit | invalidated | unresolved",
  "ret_5d": null, "ret_21d": null,
  "resolved_date": null,
  "note": null
}
```

`watch` rows additionally carry `ret_1d`. Returns use auto-adjusted closes and
**trading-day offsets taken from the price index itself** — never calendar-day math.

## Scoring rules

| Type | Resolves after | hit | invalidated | unresolved |
|---|---|---|---|---|
| `radar` (up/down) | 21 sessions | move ≥ +1% in stated direction | move ≥ 1% against | in between (±1% band) |
| `radar` (watch) | 21 sessions | — | — | always; "logged for calibration only" |
| `watch` (up/down) | 1 session | next close ≥ +0.25% with direction | ≥ 0.25% against | inside ±0.25% band |
| `watch` (no direction) | 1 session | — | — | always; note "manual review" (v1 does not parse explicit levels) |
| `regime` | 21 sessions | sign of SPY 21-session return matches direction; `flat` hits when \|return\| < 2% | otherwise | — |

Additional honesty rules:

- A 5-session checkpoint return (`ret_5d`) is recorded on radar/regime rows as soon
  as data exists, before resolution.
- Tickers the price source cannot resolve are marked `unresolved` with note
  `"no price data"` once the horizon passes — never silently dropped.
- Resolved rows are immutable. Re-running the job never duplicates an id.
- `hit_rate_5d` / `hit_rate_21d` = hit / (hit + invalidated) on radar rows
  (5d uses the checkpoint with the same ±1% band; 21d uses resolved rows).
  `regime_alignment_21d` is the same ratio for regime rows. All three report
  `null` until at least 5 rows qualify — small samples are noise, and we say so.

## `latest.json` snapshot schema

```json
{
  "as_of": "YYYY-MM-DD",  "date": "YYYY-MM-DD",
  "totals": {"open": 0, "resolved": 0, "hit": 0, "invalidated": 0, "unresolved": 0},
  "hit_rate_5d": null, "hit_rate_21d": null, "regime_alignment_21d": null,
  "rows": [ "… last 30 rows, newest first …" ]
}
```

`date` always equals the run date (ET) so the freshness watchdog can verify the
file updated.

## Running locally

```bash
pip install yfinance beautifulsoup4
python3 accountability-ledger/extract_and_score.py --repo-root . --dry-run   # no writes
python3 accountability-ledger/extract_and_score.py --repo-root .             # full run

# Useful flags
#   --skip-extract        score only (no WP fetch)
#   --skip-score          extract only (no price download)
#   --post-file FILE      parse one local post JSON instead of the live API
python3 accountability-ledger/tests/validate_latest.py accountability-ledger/sample-output/latest.json
```

Exit codes: `0` success, `3` nothing to do (no new rows, no score changes, snapshot
already fresh today — the workflow treats this as success), anything else is a real
failure.

## Language policy

Statuses are always `hit` / `invalidated` / `unresolved` — never win/loss. Rows quote
the post's own wording as an observation, not a recommendation. When the read was
wrong, the ledger says so in the `note` field and keeps the row forever.
