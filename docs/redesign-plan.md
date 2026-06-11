> # ⚠️ SUPERSEDED — 2026-06-11
> This 5-sprint redesign plan (notably the Sprint-3 midnight-blue/cream/terracotta palette migration) is **retired**.
> The shipped design system supersedes it: canonical `--az-*` tokens live in `aztmm-pulse-lab/modules/design.php` (`:root`),
> documented in `aztmm-content-api/TOKENS.md`. Sprint-1 audit items (JSON-LD, mobile bugs) were resolved June 2026.
> Do not implement anything below without re-validating against the live system.

# AZTMM UI/UX Redesign — Project Plan

**Project owner:** Nikhil Kothari (aztmm1)
**Plan date:** 2026-05-17
**Target site:** https://aztmm.com (WordPress.com Big Sky theme)
**Estimated total effort:** ~5–7 working days, sequenced across 5 sprints

---

## Scope (16 items)

Grouped by sprint. Each item has a P0/P1/P2 priority and a verification approach.

### Sprint 1 — Discovery & Audits (1 day)

Goal: gather full data before changing anything; produce a single bug list.

| # | Item | Method | Output |
|---|---|---|---|
| 1.1 | Lighthouse audit (perf / a11y / SEO / best-practices) | PageSpeed Insights API, mobile + desktop strategy | Scores + audit failure list |
| 1.2 | Console errors on live post | Chrome MCP `read_console_messages` | JS warning/error inventory |
| 1.3 | OG image / Twitter Card check | Inspect `<meta>` tags + Twitter Card validator | Pass/fail per platform |
| 1.4 | Sitemap + robots.txt verification | `WebFetch` `/sitemap.xml`, `/robots.txt` | Confirm posts crawlable |
| 1.5 | Email HTML cross-client analysis | Inspect rendered MailPoet HTML for `<style>` blocks, `!important`, table layout, dark-mode meta, prefers-color-scheme handling | Compatibility report (Gmail, Outlook, Apple Mail) |

**Already done:** WCAG color contrast verified passing (text 15.62, muted 7.51, accent 10.08).

---

### Sprint 2 — Critical Mobile Bug Fixes (1 day, P0)

| # | Item | Root cause | Fix |
|---|---|---|---|
| 2.1 | **Sparkbar broken on mobile** (the bug user saw) | `.azt-pulse .sparkbar` stays at `repeat(5, 1fr)` at all widths | Add `@media (max-width: 640px) { grid-template-columns: repeat(2, 1fr); }` and `@media (max-width: 400px) { grid-template-columns: 1fr; }` |
| 2.2 | **6-KPI tile collapse**: currently goes 3 → 1 column; user wants 3 → 2 → 1 | Single breakpoint, no intermediate | Add `@media (max-width: 900px) { grid-template-columns: repeat(2, 1fr); }` |
| 2.3 | Dark pool table mobile UX | `.tbl` overflow-x: auto with no visual hint | Sticky first column (`SESSION`) + scroll-indicator OR card stack `@media (max-width: 480px)` |
| 2.4 | Missing CSS vars `--accent-2`, `--pos`, `--neg` | Hardcoded inline colors fragment future palette swaps | Add to `:root` (and to `.azt-pulse` scope), find/replace hardcoded values |

**Acceptance:** verify each fix at 320 / 375 / 414 / 768 / 1024px (use browser dev tools device emulation; screenshot before/after).

---

### Sprint 3 — Distinctive AZTMM Palette Migration (1–2 days)

Goal: lock in the new visual identity across web + email.

| Token | Current | Target |
|---|---|---|
| `--bg` | `#0a0e1a` | `#0d1b2a` midnight blue |
| `--surface` | `rgba(15,23,42,.7)` | `#1b263b` steel blue (opaque) |
| `--surface-2` | (undefined) | `#243447` |
| `--text` | `#e2e8f0` | `#ece9e4` warm cream |
| `--text-mute` | `#94a3b8` | `#9ca3af` |
| `--accent` | `#00d4aa` mint | `#e0a85a` warm amber |
| `--accent-2` | (undefined) | `#d99dad` dusty rose |
| `--pos` | inline | `#95d5b2` sage |
| `--neg` | inline | `#e07a5f` terracotta |
| `--border` | `rgba(148,163,184,.18)` | `rgba(224,168,90,0.18)` amber tint |

**Tasks:**
- 3.1 Update WordPress theme CSS variables
- 3.2 Visually verify all 6-KPI tiles, sparkbar, tables, callout boxes render correctly with new colors
- 3.3 Update email template v2 → v3 with palette parity
- 3.4 Update OG image (will likely break with palette change — see Sprint 1.3 finding)

**Acceptance:** side-by-side before/after on hero, KPIs, sparkbar, tables. New email template renders in MailPoet preview.

---

### Sprint 4 — UI/UX Enhancements (2 days)

| # | Item | Effort | Notes |
|---|---|---|---|
| 4.1 | Logo / wordmark | Medium | Custom letterspacing on "AZTMM" with serif/condensed font OR commission vector logo asset |
| 4.2 | 6-KPI label color-coding by category | Small | Flow = amber accent, Regime = sage, Tape = dusty rose |
| 4.3 | Sparkbar axis labels | Small | Add subtle "9:30 — 16:00" tick labels under each day |
| 4.4 | Right-rail TOC / section anchors | Medium | Sticky on desktop ≥1024px; jump links to 5-Day Tide / Dark Pool / Three Questions / Methodology |
| 4.5 | Sticky MPI/Regime top bar | Small-Medium | `position: sticky; top: 0` on the strip; ensure z-index above content |

**Acceptance:** each enhancement screenshot-compared to current state; user reviews & approves.

---

### Sprint 5 — Verification & Sign-off (½ day)

- 5.1 Re-run Lighthouse (mobile + desktop); compare deltas vs Sprint 1 baseline
- 5.2 Visual regression: screenshot at 320 / 375 / 414 / 768 / 1024 / 1440 widths
- 5.3 Send test email to 2–3 accounts (Gmail, iCloud, Outlook) — eyeball rendering
- 5.4 Twitter Card validator + LinkedIn Post Inspector → verify new OG image
- 5.5 Manual click-through of all internal/external links on the post
- 5.6 Sign-off doc + commit log

---

## Dependencies / Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| WordPress.com Big Sky theme may not allow direct CSS variable editing — needs child theme or Custom CSS injection | High | Verify via WP admin → Appearance → Customize → Custom CSS first |
| Logo design (4.1) is asset work, not code — needs vector file | Medium | Either commission separately OR accept text-wordmark with custom letterspacing as MVP |
| Palette change ripples to OG image, future PDF reports, social posts | High | Document brand tokens in one place (palette.json or CSS var file) so non-CSS assets can reference |
| Email template v3 requires re-test send to subscribers; today already had 3 emails | Medium | Defer test send to next Monday after market close; don't send during quiet weekend |
| Lighthouse rate-limited via WebFetch (already hit 429 twice today) | Medium | Switch to manual Lighthouse run from a dev machine, or use `https://pagespeed.web.dev/` HTML scrape, or wait for rate limit |

---

## Explicitly Out of Scope (Defer)

- Daily Pulse template upgrade (separate workstream; deserves its own plan)
- Subscriber acquisition strategy (marketing, not UI/UX)
- Page speed optimization beyond what Lighthouse surfaces in Sprint 1
- Logo design as a vector file — text wordmark MVP only in 4.1
- A/B testing framework
- Analytics setup (GA4, Plausible, etc.)
- Membership / paywall

---

## How to use this plan

1. Each sprint is its own session / day of work
2. Update this doc as items complete; mark `[x]` and link to commits
3. Sprint 1 must complete before Sprint 2 (audits inform fixes)
4. Sprint 2 must complete before Sprint 3 (don't migrate palette on top of broken layout)
5. Sprint 4 can run partly in parallel with Sprint 3 (UI adds are layout-additive)

---

## Quick reference — current state snapshot (2026-05-17)

- Site: https://aztmm.com
- Test post: https://aztmm.com/2026/05/16/weekly-pulse-2026-05-11-to-15/
- Email template (v2): newsletter id=6, saved as "AZTMM Weekly Pulse — v2"
- Post Notification (id=4): inactive (parked)
- Subscriber list: 4 active, 50% open rate on most recent send
- Cron: `0 21 * * 1-5` EDT + `0 22 * * 1-5` EST (Monday 5/18 17:00 ET first production run)

---

## Sprint 1 — Audit Results (run 2026-05-17 night)

### 1.1 Lighthouse
- Status: **DEFERRED** — Google PageSpeed Insights API rate-limited (HTTP 429) on 3 retries via WebFetch
- Action: run manually from a fresh IP, or use `https://pagespeed.web.dev/` directly, or get a free API key for higher quota

### 1.2 Console errors on live post
- **CLEAN.** Only `JQMIGRATE: Migrate is installed, version 3.4.1` info logs (jQuery Migrate plugin announcing itself). Zero errors, zero warnings, zero CORS issues
- 0 failed resource loads (67 total resources)

### 1.3 OG image / Twitter Card meta tags
- **ALL PRESENT:** `og:title` (53 chars), `og:description` (107 chars), `og:image` (aztmm.com hosted), `og:url`, `og:type`, `twitter:card`, `twitter:title`, `twitter:image`, `description`, `robots`, `viewport`, `canonical`, `h1`
- **Gap:** zero JSON-LD structured data (`<script type="application/ld+json">`). Adding Article schema would unlock rich snippets in Google search

### 1.4 Sitemap + robots.txt
- `robots.txt`: OK — `Disallow: /wp-admin/` + `Allow: /wp-admin/admin-ajax.php`, references both `sitemap.xml` and `news-sitemap.xml`
- `sitemap.xml`: index file referencing `sitemap-1.xml` (lastmod **2026-05-15**) and `image-sitemap-1.xml` (lastmod 2026-03-27)
- **Issue:** sitemap lastmod is 5/15; the new pulse post (5/16) may not yet appear in `sitemap-1.xml`. Need to verify or trigger regeneration

### 1.5 Email HTML cross-client (inspected MailPoet view-in-browser render)
- **PASS** Table-based layout (Outlook-safe)
- **PASS** 56 inline styles (Gmail respects)
- **PASS** Viewport meta present
- **PASS** Outlook conditional comments present
- **PASS** No flexbox/grid (no Outlook breakage)
- **PASS** No background images (Gmail-friendly)
- **FAIL** No `color-scheme` or `supported-color-schemes` meta — emails won't render correctly in dark-mode inboxes (palette will invert/flip)
- **FAIL** 0 ARIA labels (a11y gap)
- **WARN** Uses CSS custom properties (`--vars`) — may not render in older Gmail / Outlook (MailPoet should have fallbacks but worth verifying)

### 1.6 WCAG color contrast (already done in pre-audit)
- Text on bg: 15.62:1 **PASS** AAA
- Muted text on bg: 7.51:1 **PASS** AAA
- Accent on bg: 10.08:1 **PASS** AAA Normal / AA Large

### Audit-derived additions to Sprint 2 / Sprint 3 backlog
- **NEW 2.5:** Add JSON-LD Article schema to pulse posts → Sprint 2
- **NEW 2.6:** Investigate sitemap regeneration trigger on post publish → Sprint 2
- **NEW 3.5:** Add `color-scheme: light only` (or `light dark`) meta to email template → Sprint 3
- **NEW 4.6:** Add ARIA labels to email template + post template → Sprint 4
