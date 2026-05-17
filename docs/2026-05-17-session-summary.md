# AZTMM — Session Final Deliverable

**Session date:** 2026-05-17 night session
**Branch:** `main` (all commits direct)
**Scope shipped:** Sprint 1 audits → Sprint 2 mobile fixes → UW MCP integration → 3 indigenous scoring models → Sprint 3 Distinctive AZTMM palette migration → live post + repo updated

---

## What landed (8 commits on `main`)

| Commit | Description | Files |
|---|---|---|
| `0647697` | docs: redesign plan + Sprint 1 audit findings | `docs/redesign-plan.md` |
| `32f6353` | (earlier) V4 template — Sprint 1 baseline | `daily_pulse_template.html.j2` |
| `6c705a7` | css: Sprint 2 mobile responsive fixes (KPI 3-2-1, sticky col) | `daily_pulse_template.html.j2` |
| `bfa8764` | feat: add UW v2.1 endpoints (insider sector, analyst, yield curve) | `daily_pulse_fetcher.py` |
| `730dee5` | Create scoring.py | `scoring.py` |
| `1a3a46c` | Update daily_pulse_template.html.j2 — Distinctive AZTMM palette | `daily_pulse_template.html.j2` |

Plus live updates outside the repo:
- Post 2719 updated 3× (UW rebuild → mobile responsive CSS → Distinctive palette). Final state: midnight blue + warm amber + dusty rose
- MailPoet template "AZTMM Weekly Pulse — v2" saved
- Email sent to 4/4 subscribers (50% open rate)

---

## UW MCP integration — what auto-runs on Monday 5/18 17:00 ET cron

`daily_pulse_fetcher.py` now pulls (in addition to existing flow/dark-pool/tide/sector):

| New endpoint | What it returns | Frequency |
|---|---|---|
| `/api/insider/{sector}/sector-flow` × 11 sectors | Net buy/sell $ per sector, last 14 days | Daily |
| `/api/screener/analysts` | Latest analyst ratings (50) | Daily |
| `/api/economy/treasury-yield` (10Y + 2Y) | Current yields + 10Y-2Y spread | Daily |

Plus 3 indigenous scoring composites in `scoring.py`:

| Score | What it measures | Range | Trigger |
|---|---|---|---|
| **SMDS** (Smart Money Divergence) | Net insider $ across 11 sectors vs regime direction | 0-100, 50 = no divergence | <30 = bullish-insider; >70 = bearish-insider divergence |
| **RTDI** (Regime-Tape Divergence) | MPI score vs premium-weighted P/C | 0-100, 50 = aligned | >70 = regime + tape disagree |
| **MPCI** (Mega-Print Concentration) | Today's $100K+ dark-pool prints vs 30d avg | Count + alert flag | Alert when >20 prints or >$3B premium |

**Auto-calibration baseline (from May 11-15 data):**
- SMDS: Tech insider net -$961M → score ~80 (bearish-insider divergence)
- Consumer Cyclical insider net +$93M → only positive sector
- MPCI SPY Tuesday 5/12: 23 mega-prints, $4.91B → 3σ+ alert

---

## Distinctive AZTMM Palette (live)

Visible on https://aztmm.com/2026/05/16/weekly-pulse-2026-05-11-to-15/

| Token | Hex / RGBA |
|---|---|
| `--bg` | `#0d1b2a` (midnight blue) |
| `--surface` | `#1b263b` (steel blue) |
| `--surface-2` | `#243447` |
| `--text` | `#ece9e4` (warm cream) |
| `--accent` | `#e0a85a` (warm amber) |
| `--accent-2` | `#d99dad` (dusty rose) |
| `--bull` | `#95d5b2` (sage mint) |
| `--bear` | `#e07a5f` (terracotta) |
| `--info` | `#7eb6c4` (muted cyan) |
| `--border` | `rgba(224,168,90,.18)` |

Migrated 24 inline rgba colors in the live post + 39 in the Jinja template.

---

## Open items / next session

### Quick wins
- [ ] Email template v2 in MailPoet — apply Distinctive palette (text-only, manual edit in MailPoet block editor)
- [ ] OG image regeneration to match new palette (current OG image is from old cyan-mint era)
- [ ] Sitemap regeneration after each post publish (currently lags 1+ day)
- [ ] JSON-LD Article schema injection in pulse posts (Sprint 1 audit finding — unblocks Google rich snippets)

### Deferred to future sprints (Sprint 4-5)
- [ ] Lighthouse audit retry (PageSpeed rate-limited 3× today; needs API key or pagespeed.web.dev manual)
- [ ] Logo / wordmark with custom letterspacing (text-only "AZTMM" is brand-weak)
- [ ] 6-KPI label color-coding by category (flow=amber, regime=sage, tape=rose)
- [ ] Sparkbar axis labels ("9:30 — 16:00" ticks)
- [ ] Right-rail TOC for long posts
- [ ] Sticky MPI/Regime top bar
- [ ] ARIA labels for screen reader a11y

### Weekly Pulse additions (cron will auto-pull data)
- [ ] **Cross-Sector Insider Heatmap** section (data already pulled; needs template render)
- [ ] **Congress Tells** section (top 5 single-name congressional trades by $)
- [ ] **Seasonality Overlay** (top 5 names tracking May historical pattern)
- [ ] **Sector Rotation Compass** visualization (heaviest indigenous model lift; v2)
- [ ] **CPPS** (Catalyst Pre-Positioning Score) for upcoming earnings/Fed events

### Maintenance
- [ ] UW token `07df9629-...` still in transcript — rotate when convenient (you confirmed paid account; rotation = generate new + update GH secret `UW_API_TOKEN`)
- [ ] Plugins → Inactive: confirmed 0 remaining (AZTMM Trade Journal kept per your call)
- [ ] MailPoet Post Notification id=4 stays OFF (manual weekly send only — frequency math at 4 subs)

---

## Monday 5/18 17:00 ET cron — what to verify

After first production run with the new fetcher:

1. **Workflow run succeeds** at https://github.com/aztmm1/aztmm-mpi-data/actions/workflows/daily-pulse-v2.yml (8 steps green)
2. **Data quality** in payload: check `data_quality.endpoints_ok` should be ~21 (11 insider + 1 analyst + 2 yield + 7 existing); `endpoints_failed` should be 0
3. **Yield curve** populated: `payload.yield_10y` and `payload.yield_2y` should be non-null (paid tier required for `/api/economy/treasury-yield`)
4. **Insider sector flow**: `payload.insider_sector_flow` should have 11 keys, each with ≥10 rows
5. **Live post auto-publishes** at https://aztmm.com/ with Distinctive AZTMM palette applied (from the Jinja template change)
6. **MPI computed** — currently 5 live subindexes + 4 neutrals; yield curve subindex should now be live (5+4 → 6+3) if your MPI pipeline picks up the new `yield_curve` field

If anything fails: `data_quality.failures[]` array captures the endpoint + error. Fix path TBD per failure mode.

---

## Maintenance burden (honest read)

Per your "no daily hassle" directive:

- **Daily cron**: ~30 UW calls (existing 18 + 12 new). All auto-pulled. Runtime ~30-45s including throttle. Zero manual intervention.
- **Weekly cron** (when added): + ~33 calls for Sector Rotation Compass. Saturday only.
- **Manual weekly send**: Friday/Saturday — duplicate newsletter id=6 in MailPoet → update body numbers → send to 4 subs. ~10 min/week.
- **Post Notification automation**: stays OFF until subscriber list grows past ~20 or you commit to template-only-send.

Total: ~10 min/week active management. Everything else compounds automatically.

---

## Quick reference

- Repo: https://github.com/aztmm1/aztmm-mpi-data
- Latest weekly pulse: https://aztmm.com/2026/05/16/weekly-pulse-2026-05-11-to-15/
- Plan doc: `docs/redesign-plan.md` (in repo)
- Indigenous scoring module: `aztmm-daily-pulse-v2/scoring.py`
- UW MCP: configured via `npx mcp-remote` to `api.unusualwhales.com/api/mcp` with Bearer token
- GitHub secret: `UW_API_TOKEN` (used by daily cron)
- MailPoet template v2: id 6, "AZTMM Weekly Pulse — v2"
