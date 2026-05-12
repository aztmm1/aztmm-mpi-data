# Methodology — Options Gravity (NOPE & Max-Pain Tracker)

*Public-safe overview. Reviewed against AZTMM brand policy.*

---

## What this page shows

Once per trading day, just after the close, this page is refreshed with two end-of-session readings for a fixed list of tickers:

- **NOPE** — Net Options Pressure. A single number per ticker that summarises how much call demand versus put demand was working in the options tape, scaled by the underlying stock's volume.
- **Max-pain strike** — for the nearest options expiry (and, when different, the next monthly expiry), the strike at which the largest number of outstanding option contracts would expire worthless.

The page also shows a 30-day rolling line of end-of-session NOPE for the three index proxies (SPY, QQQ, IWM), so tonight's print can be read against its recent range.

---

## What NOPE means

NOPE is an industry-recognised summary statistic for daily options pressure on a single ticker. The intuition: each option trade has a delta — the rate at which the option's price moves with the underlying. Sum up all the day's call deltas (positive numbers), sum up all the day's put deltas (negative numbers), and divide the total by the day's spot trading volume. The result tells you whether the day's options activity *added to* or *worked against* the underlying tape.

- A reading well above zero says call demand was meaningful relative to the underlying volume.
- A reading well below zero says put demand was meaningful relative to the underlying volume.
- A reading near zero says the options tape was roughly balanced.

NOPE is descriptive, not predictive. It tells you what happened in the options tape today — it does not say what will happen tomorrow.

---

## What max-pain means

For any given expiry date, every outstanding option contract has a strike. As spot price moves, the total dollar payout that would be owed to option holders moves with it. The **max-pain strike** is the spot price level that would minimise the total payout — i.e. the level that would cause the most outstanding option dollars to expire worthless.

Max-pain is a *journaling lens*, not a prediction tool. Two patterns the AZTMM journal has tracked over time:

1. Spot price often drifts toward the near-expiry max-pain into the final session before expiry.
2. When max-pain shifts materially from one day to the next — often because of large open-interest changes at specific strikes — that shift can be an interesting observation in its own right.

Neither pattern is mechanical. Spot can blow through max-pain on news; max-pain can shift for reasons unrelated to expiry mechanics. We surface the level so the reader can decide for themselves whether to incorporate it into their own process.

---

## Ticker universe

| Group | Tickers |
|---|---|
| Index proxies | SPY, QQQ, IWM |
| Megacaps | NVDA, MSFT, AAPL, GOOGL, META, TSLA, AMZN |

The 30-day NOPE line covers the three index proxies only. The tables show all ten.

---

## What "magnet zone" means

A ticker is flagged with a "magnet zone" badge when its spot price closed within ±1% of the near-expiry max-pain strike. That's a label, not a signal. It marks situations where the two values happen to coincide — readers can decide if that means anything to them.

---

## Cadence and freshness

- The page refreshes once per trading day, at 5:00 PM ET.
- The "As of" stamp at the top of the page reflects the snapshot timestamp, not the time you opened the page.
- This is end-of-session journal data. It is not a live tape, it is not a quote feed, and it does not refresh while you read it.

---

## What this page does **not** do

- It does not say "buy" or "sell" anything.
- It does not give a price target.
- It does not stream live data.
- It does not disclose which exact data feed underlies the calculations.
- It does not share the precise mathematical weighting used to derive NOPE when the upstream feed is unavailable — that fallback is internal only.

---

## Disclaimer

Personal observations of one trader. Not investment advice. Data refreshed once daily at 5 PM ET. Past tape patterns do not predict future results.
