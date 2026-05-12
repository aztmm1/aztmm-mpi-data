# Congress Watch - Methodology

*Page slug:* `/congress-watch/methodology/`

## What this page is

Congress Watch is an end-of-session snapshot of recent congressional trade
disclosures. It is published once per weekday at 5:00 PM ET and stays static
until the following session's run.

It exists because public filings are noisy when read raw, and a once-daily
journal pass is a more useful way to skim them than a continuous stream.

## What it shows

- **Tonight's filings** - a short count of how many disclosures landed today,
  by chamber and ownership type.
- **Multi-member ticker clusters** - tickers that several distinct members
  reported activity in inside a short recent window.
- **Sector clusters** - sectors that drew filings from multiple members in
  the same window.
- **Larger disclosure tiers** - filings sized in the higher disclosure
  ranges. Members file in dollar bands, not exact amounts; we surface the
  band exactly as filed.
- **Filings outside the usual window** - cases where the gap between the
  transaction date and the filing date is wider than typical. This is a
  timing color cue, not a directional read.

## What it does not show

- **Exact trade amounts.** Filings are made in dollar ranges, so the page
  shows the range, not a precise figure.
- **Predictions or directives.** No "follow this," no "trade idea," no
  position calls. If a ticker keeps appearing in the cluster table for
  several sessions, that is a noticing tool, not a directive.
- **Methodology weights, scoring, or model internals.** The notability rules
  are simple thresholds documented here; there is no proprietary scoring layer.
- **Source attribution beyond "public disclosure filings."**

## Notability rules (the only rules)

A filing turns up in the "Notable" sections when at least one of these is
true:

1. **Cluster.** Two or more distinct members disclosed activity in the same
   ticker inside a recent multi-day window.
2. **Sector cluster.** Three or more distinct members disclosed activity in
   the same sector inside the same window.
3. **Larger tier.** The disclosure falls in one of the higher reporting
   ranges.
4. **Wider filing gap.** The number of days between transaction and filing
   is larger than the typical reporting window.

These are descriptive, not predictive. A ticker showing up does not mean it
will outperform; a sector cluster does not mean rotation; a late filing
does not mean anything beyond timing color.

## Cadence

- Refreshed once per weekday at 5:00 PM ET.
- Skipped on weekends and US market holidays.
- If the upstream feed is degraded on a given session, the page shows that
  with a small data-quality banner. It does not retry intraday.

## Voice

This page is observational. The intent is what one trader noticed in
tonight's window. It is not investment advice, and it is not a fund or
advisor surface.

## Disclaimer

Personal observations of one trader. Not investment advice. Data refreshed
once daily at 5:00 PM ET.
