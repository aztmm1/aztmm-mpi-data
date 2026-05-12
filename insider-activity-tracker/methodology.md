# Insider Activity — Methodology

## What this page is

The Insider Activity page is a weekly journal-style summary of Form 4
filings during the trailing seven days ending Friday. It is published
once per week, on Friday after the close at 5 PM ET. It is not a feed,
it is not a watchlist of names to trade, and it does not predict
future returns.

The page records what corporate insiders reported transacting in the
prior week — which companies showed the heaviest open-market buying,
which companies showed the heaviest open-market selling, and how that
activity distributed across sectors.

## What "Form 4" is

Form 4 is the filing that corporate insiders — officers, directors,
and beneficial owners of more than 10% of a company's stock — must
submit to the Securities and Exchange Commission within two business
days of transacting in their company's stock. Each filing reports:

- The insider's name and role
- The company (ticker)
- The transaction date
- The transaction type (a single-letter code defined on the form)
- The number of shares, the price, and the holding after the trade

Because the reporting deadline is two business days, the trailing
seven-day window captures the full reporting cycle for the week's
transactions in essentially all cases.

## What "open-market buying" and "open-market selling" mean here

Form 4 transaction types fall into many categories. This page treats
only two of them as "open-market activity":

- **Open-market buying** — the insider purchased shares on the open
  market with their own money. (Form 4 transaction code P.)
- **Open-market selling** — the insider sold shares on the open
  market. (Form 4 transaction code S.)

The page deliberately excludes:

- Stock-compensation grants and awards (code A), which are
  compensation events, not market transactions
- Option exercises (codes M and X), which reflect compensation
  vesting schedules
- Tax-withholding dispositions (code F), which are administrative
- Gifts (code G), which are not market transactions
- Disposals back to the issuer (code D)

The point of the filter is not to define what a "good" insider trade
looks like. It is to keep the page focused on the subset of insider
activity that involved real open-market dollars. Other transaction
codes are preserved in the underlying record but do not enter the
public roll-up.

## What the page reports

For each company that cleared the bar in either direction, the page
reports:

- **Ticker** and **sector**
- **Total dollar value** — shares times reported price, summed across
  the qualifying filings in the week
- **Shares** — total shares transacted in the qualifying direction
- **Filings** — number of qualifying filings on that side
- **Distinct filers** — number of unique insiders on that side

The page also reports a sector-level roll-up showing total buy
dollars, sell dollars, and net by sector.

## Filtering

Two filters are applied before a filing enters the roll-up:

1. **Market-cap floor** — companies with a market capitalization
   below a small-cap threshold are filtered out, so the roll-up is
   not dominated by sub-$300M-marketcap names where a single small
   filing can distort the dollar totals.
2. **Transaction-value floor** — individual filings worth less than a
   de-minimis dollar threshold are filtered out as noise.

The exact thresholds are internal and not published. The intent of
each filter is to keep the page focused on filings large enough to
note in a journal entry.

## What the page deliberately does not do

- It does not recommend or advise action on any name listed.
- It does not project the size, direction, or timing of any future
  price move.
- It does not stream insider transactions intraday. The page is a
  single end-of-week snapshot, refreshed once per Friday at 5 PM ET.
- It does not disclose the exact thresholds used to qualify filings,
  nor the data sources behind the readings.
- It does not interpret why an insider transacted. Insiders buy and
  sell for many reasons unrelated to their view of the stock — tax
  planning, diversification, contractual schedules, estate planning,
  charitable giving — and Form 4 itself rarely records the reason.

If you find yourself reading this page as a list of names to chase
next week, please re-read this section. Form 4 filings describe past
transactions, often with a multi-day lag, and they are not a forecast.

## Cadence

Published once each week, Friday at 5 PM ET. The "as of" stamp on the
page is the snapshot time, not the time you opened the browser. If a
feed upstream of the page degrades, the page shows a data-quality
note and the previous week's snapshot remains in place until the
next Friday run.

## References

- Form 4 filings are public records submitted to the SEC under
  Section 16(a) of the Securities Exchange Act of 1934. The
  filings themselves are searchable on the SEC's EDGAR system.
- Aggregated and normalised Form 4 feeds for this page are sourced
  through institutional-grade vendors and are published once per
  evening only.

---

*Personal observations of one trader. Not investment advice. Form 4
filings reflect past transactions and do not predict future returns.
Data refreshed weekly Friday at 5 PM ET. Inclusion in this list is
not a recommendation.*
