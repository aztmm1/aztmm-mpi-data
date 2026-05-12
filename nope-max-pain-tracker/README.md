# AZTMM NOPE & Max-Pain Tracker

End-of-day options-gravity tracker for SPY / QQQ / IWM plus 7 megacaps. Powers the `/options-gravity/` page on aztmm.com.

## Layout

```
nope-max-pain-tracker/
  ├── config.yml          # ticker universe, lookback windows, bands
  ├── fetcher.py          # /nope, /max-pain, /greek-exposure, /oi-change
  ├── aggregator.py       # NOPE rollups, max-pain selection, commentary, dual-output split
  ├── publisher.py        # Jinja render + brand-policy scrub
  ├── run.py              # orchestrator (fetch -> aggregate -> dual-write -> render -> scrub)
  ├── workflow.yml        # GH Actions: 5 PM ET weekday cron (EDT + EST)
  ├── dashboard.html.j2   # SSR-time frame; values load client-side from public.json
  ├── methodology.md      # public-safe (no vendor, no precise weights)
  ├── README.md           # this file
  ├── requirements.txt
  ├── data/               # ephemeral run logs, incidents, raw cache (gitignored in production)
  └── sample-output/      # dated public/internal JSONs + rendered HTML
```

## Quickstart

```bash
cd outputs/nope-max-pain-tracker
python -m pip install -r requirements.txt
export UW_API_KEY=...              # required
python run.py --date 2026-05-11 --dry-run
```

Outputs land in `sample-output/`:
- `nope-maxpain-2026-05-11.public.json`   — scrubbed, served via jsDelivr
- `nope-maxpain-2026-05-11.internal.json` — raw, repo-only
- `nope-maxpain-2026-05-11.html`           — rendered page snapshot
- `latest.json`                              — copy of newest public.json

## Architecture

```
5 PM ET cron  →  fetcher.py  →  aggregator.py  →  publisher.brand_check  →
  dual-output writer  →  jsDelivr  →  WP page client-fetch  →
    "as of YYYY-MM-DD 5:00 PM ET" stamp from snapshot
```

The WP page is **static at SSR time** — no values baked in. Visitor's browser fetches `public.json` from jsDelivr at load and renders the tables + chart client-side. This is the same SSR-drift fix used by the MPI panel and the Pulse Compass.

## Brand policy

The publisher runs `brand_check()` on both the rendered HTML and the public JSON. Forbidden phrases (case-insensitive substring + word-boundary regex) include vendor names, model-weight leaks, positioning drift, and advisory verbs. Any hit blocks the publish step and writes a `data/needs-review/` artifact for manual fix-up.

`NOPE` itself is allowed in headings — it's an industry term, not a vendor-specific phrase.

## Dual-output sanitization

- `public.json` — only the fields needed by the page: ticker, NOPE rounded, band, max-pain, spot, distance%, magnet flag, monthly max-pain, the 30-day chart series, and the commentary lines.
- `internal.json` — full rollup including delta numbers, OI-change symbol detail, NOPE proxy provenance flag, raw timestamps. **Never** served to the browser.

## Cadence

- Schedule: `0 21 * * 1-5` (EDT 5 PM ET) and `0 22 * * 1-5` (EST 5 PM ET).
- DST gate inside the workflow checks the actual ET hour so the wrong cron line skips itself.
- Idempotency guard: if `data/logs/{date}.json` already shows a successful status, the run skips.

## Failure modes

| Failure | What happens |
|---|---|
| `/nope` endpoint unavailable for a ticker | Falls back to a proxy computed from `/greek-exposure` delta totals; `nope_proxy_used: true` recorded in `internal.json`. |
| One endpoint times out per ticker | `data_quality.failures` records it; `degraded: true` on the public JSON; the page shows a degraded banner. |
| Brand-policy check finds a forbidden phrase | Publish blocked. `data/needs-review/options-gravity-{date}-NEEDS-REVIEW.html` written. Notification sent on macOS. |
| Run on weekend | Skipped with `skipped_non_market_day` status. |

## Local probe

The repo includes a single-shot probe to validate UW endpoints respond before building parsers:

```bash
curl -H "Authorization: Bearer $UW_API_KEY" \
     "https://api.unusualwhales.com/api/stock/SPY/max-pain" | jq '.data[0]'
```

## Disclaimer

Personal observations of one trader. Not investment advice. Data refreshed once daily at 5 PM ET.
