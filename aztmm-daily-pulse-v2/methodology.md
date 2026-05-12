# Daily Pulse — Methodology

*For publication at `/methodology/daily-pulse-v2/`.*

The Daily Pulse is a structured end-of-session read of the U.S. equity options
tape and the dark pool tape. It runs once per trading day, at the close, and
distills four kinds of evidence into a single one-page note: scenario tag,
sector heatmap, premium concentration, and a "what to watch" list for the next
session.

This page explains the six-section structure and the academic basis for each
component. No vendor names appear here — we describe the *kind* of data each
input represents, never its specific source.

---

## Why end-of-day, why options + dark pool

Equity prices alone are noisy. Two complementary tapes carry more information:

- **The options tape.** Options volume and premium leak information about
  informed traders' directional bets, especially when concentrated at unusual
  ratios versus open interest.
- **The dark pool tape.** Large institutional prints, executed off-exchange,
  reveal where size is being moved without disturbing displayed quotes.

End-of-session is the right cadence because intraday noise has resolved, the
day's flow is fully accounted for, and the prints settle into a coherent
picture before the next-day open.

---

## The six sections

### 1. What happened today
- Total call premium, total put premium, and the put/call volume ratio.
- End-of-day cumulative net call premium from intraday 5-minute bars.
- A one-line description of the cumulative-premium curve's shape: closed at
  session highs (accumulation), at session lows (distribution), or mid-range
  (chop).

### 2. Sector heatmap
The 11 GICS sector ETFs plus SPY, each shown with:
- Daily percentage change
- Daily call and put premium
- Net premium (call − put)
- A "band" — leading (≥ +0.5%), neutral, or lagging (≤ −0.5%)

Below the table: a one-line leaders summary and a one-line laggards summary.

### 3. Where premium concentrated
Top 5 tickers by absolute net signed premium, split into a tech bucket and a
non-tech bucket. Sign convention: ask-side calls and bid-side puts add to the
bullish side; ask-side puts and bid-side calls subtract. A **narrowing flag**
fires when one tech name accounts for ≥ 55% of the top-5 tech absolute
premium — that is, when "tech leadership" is really one or two stocks.

### 4. Dark pool tell
Top 10 tickers by total off-exchange notional today. Mega-prints (≥100,000
shares) are counted separately because they isolate institutional-scale
activity from retail flow.

### 5. What's unusual today
Counts of activity in seven classification buckets:
- Unusually bullish (high volume-vs-open-interest calls, ask-side)
- Unusually bearish (same, puts)
- Deep-conviction call flow (large premium, single-leg, ask-side calls)
- Deep-conviction put flow (same, puts)
- Long-dated call buyers (DTE > 60)
- Put-sells (bid-side puts — implicit bullish positioning)
- Cheap short-dated calls (low premium, DTE ≤ 14)

Plus the three largest single-leg ask-side prints of the day.

### 6. What to watch tomorrow
Two or three concrete, observable conditions that the next session will
either confirm or reject — anchored to today's specific levels (e.g., "if
ticker X's dark pool stays above $Y").

---

## Scenario classification

An eight-signal scorecard assigns +1 / 0 / −1 to each signal:

1. Sector breadth (leaders vs laggards count)
2. Defensives vs cyclicals leadership balance
3. End-of-day net call premium sign
4. Put/Call ratio band (≤ 0.85 bullish, ≥ 1.05 bearish)
5. Unusually-bullish vs unusually-bearish alert counts
6. Deep-conviction call vs put alert counts
7. Heavy put-selling (vol-selling, implicit bullish)
8. Tech leadership narrowing (penalty)

Score ≥ 4 → **BULL**. Score ≤ −4 → **BEAR**. Score between is "BASE" with a
tilt, except for two special tags that override:
- **DEFENSIVE ROTATION** — defensives lead and intraday tape closes negative.
- **RISK-OFF NARROWING** — leadership thins onto one name with a negative
  scorecard.

The scorecard is intentionally simple. Each signal weighs the same. We do
not publish the underlying scores, weights, or methodology numbers on the
post — only the resulting tag, headline, and a short list of reasons.

---

## Academic basis

**Market tide (cumulative intraday net premium).**
The shape of the intraday cumulative-premium curve is a sequential-trade
microstructure signal. Foundational work: Easley, López de Prado, and
O'Hara (2012), *"The Volume Clock: Insights into the High Frequency Paradigm,"*
*Journal of Portfolio Management*; and the broader VPIN/PIN literature
(Easley, Kiefer, O'Hara, Paperman, 1996, *"Liquidity, Information, and
Infrequently Traded Stocks,"* *Journal of Finance*). The intuition: when
informed flow concentrates at one side of the book over a session, the
cumulative net premium drifts consistently in one direction; when uninformed,
it oscillates.

**Sector rotation.**
The defensive-versus-cyclical leadership balance is the central observable
of Stovall's sector-rotation model: Stovall (1996), *Standard & Poor's Guide
to Sector Investing*. Subsequent academic validation includes Conover,
Jensen, Johnson, and Mercer (2008), *"Sector Rotation and Monetary
Conditions,"* *Journal of Investing*; and Jacobsen, Stangl, and Visaltanachoti
(2009), *"Sector Rotation Across the Business Cycle,"* working paper, Massey
University.

**Dark pool concentration.**
The role of off-exchange prints as an informed-trade signal: Hu, Pan, and
Wang (2013), *"Noise as Information for Illiquidity,"* *Journal of Finance*;
and Comerton-Forde, Malinova, and Park (2018), *"Regulating Dark Trading:
Order Flow Segmentation and Market Quality,"* *Journal of Financial
Economics*. Mega-print thresholds (≥100K shares) align with the empirical
"large block" cutoffs in the institutional-trading literature: Keim and
Madhavan (1996), *"The Upstairs Market for Large-Block Transactions: Analysis
and Measurement of Price Effects,"* *Review of Financial Studies*.

**Unusual options activity.**
The notion that ask-side, single-leg, high volume-vs-open-interest options
trades carry directional information: Pan and Poteshman (2006), *"The
Information in Option Volume for Future Stock Prices,"* *Review of Financial
Studies*; and Cremers, Fodor, Muravyev, and Weinbaum (2021), *"Option Trading
and Returns versus the 52-Week High and Low,"* *Journal of Financial and
Quantitative Analysis*.

**Tech leadership narrowing.**
The empirical fact that narrowing market leadership precedes drawdowns:
Asness, Frazzini, and Pedersen (2019), *"Quality Minus Junk,"* *Review of
Accounting Studies*; and the broader breadth-divergence literature dating
back to Brown and Cliff (2005), *"Investor Sentiment and Asset Valuation,"*
*Journal of Business*.

---

## Limitations

- The Daily Pulse is an **observational** read of one session of public
  end-of-day data feeds. It is not a forecast and not investment advice.
- The scenario tag is a snapshot — yesterday's BULL can be today's BEAR.
  Tags do not chain.
- Dark pool prints lack a transparent execution timestamp; "today's" prints
  reflect the public reporting window, which may include settlement-lag from
  late afternoon.
- The classification thresholds (e.g., V/OI ≥ 3, narrowing ratio ≥ 0.55) are
  conventions, not estimates. They are stable across runs; we will only
  change them with a posted version note.

---

## Versioning

This is **v2** of the Daily Pulse methodology, in effect from 2026-05-12.
The prior methodology used a different data input and a different scenario
scorecard; that page is archived at `/methodology/daily-pulse-v1/`.

We will post a version note here whenever (a) any threshold changes, (b) any
section is added or removed, or (c) the scorecard signal set changes.
