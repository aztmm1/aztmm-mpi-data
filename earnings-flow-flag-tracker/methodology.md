# Earnings Flow Flag &mdash; methodology

Public-safe overview. Specific thresholds and internal scoring are deliberately not disclosed.

## What we measure

The page intersects two lists and shows only the names that appear in both:

1. **Upcoming reporters.** Companies whose earnings release is on the calendar for one of the next five trading days. The current day is excluded because those reports have already happened by the time the page publishes at 5 PM ET. Reporter inclusion requires a meaningful size and liquidity floor &mdash; the page is not built to surface microcap or thinly traded names.

2. **Notable options interest today.** Tickers whose options tape during today's session showed at least one above-floor alert by premium and contract count. The threshold is set internally to strip routine noise; it is not the same as "the loudest" or "the largest." It is "above background."

A ticker is flagged when both conditions hold: it is reporting soon, and its options interest today cleared the bar.

## What we do not claim

- The page is **not a prediction** of the direction or magnitude of any earnings reaction.
- The page is **not a list of names to trade**. Options around earnings carry elevated risk because implied volatility behaves in ways that punish naive directional bets.
- The page does **not distinguish** between "positioning ahead of a print" and other reasons options interest may have stacked up today (hedging, roll-down activity, broader sector flows, news unrelated to the company's print, and so on).
- The page does **not score** the conviction or quality of the underlying flow. It is a binary flag: cleared the bar, or did not.

## How to read it

- A row in the table is a statement of fact: this name is reporting on this date, and today its options interest was notable.
- The tilt column (call-tilted, balanced, put-tilted, etc.) describes where the dollar weight of qualifying alerts landed today. It is descriptive, not directional advice.
- The 30-day sparkline tracks how many names cleared both conditions on each weekday. Low counts indicate a quiet earnings calendar, a quiet tape, or both.

## Cadence

One snapshot per weekday, taken at 5 PM ET. The page never refreshes intraday. Re-running the same date is idempotent &mdash; the dated artifact overwrites itself rather than appending new history.

## Walk-forward integrity

The page only considers earnings dates that are still in the future at the time of the 5 PM ET snapshot. Today's earnings reports, which have already occurred by 5 PM ET, are excluded so the page does not lean on hindsight.

## Disclaimer

Personal observations of one trader. Not investment advice. Earnings outcomes are unpredictable and options around earnings carry elevated risk. Data refreshed once daily at 5 PM ET.
