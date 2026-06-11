# AZTMM Design Tokens — Canonical Reference (v1, 2026-06-11)

**Single source of truth:** the `--az-*` custom properties defined in `aztmm-pulse-lab/modules/design.php` → `aztmm_pl_design_tokens()` → `:root` (injected sitewide at `wp_head` priority 1). Page CSS consumes them as `var(--az-x, <fallback>)` where the fallback is the pre-migration literal — so a missing token can never change pixels.

## Surfaces & lines
| Token | Value | Role |
|---|---|---|
| `--az-bg` | `#07081a` | Page background (tool pages) |
| `--az-bg-2` | `#0d0f26` | Recessed wells, table headers, gauge interiors |
| `--az-card` | `#13162f` | Card background |
| `--az-card-2` | `#1a1e3f` | Elevated card / pill background |
| `--az-line` | `#2a3057` | Primary border |
| `--az-line-soft` | `#1e2244` | Hairlines, dashed dividers, gridlines |
| `--az-line-bright` | `#3e4682` | Hover borders, scrollbar thumbs, ticks |

## Ink
| Token | Value | Role |
|---|---|---|
| `--az-ink` | `#e6e9ff` | Primary text, key numerics |
| `--az-ink-2` | `#b2b8e5` | Body text on cards |
| `--az-ink-3` | `#7e84b5` | Muted: labels, captions, footnotes |
| `--az-ink-4` | `#4f547a` | Dim: axis numbers, disclaimers |

## Semantic (the meaning-carrying colors — never decorate with these)
| Token | Value | Meaning |
|---|---|---|
| `--az-bull` | `#10b981` | Bull regime · fresh/Current badge · hit · positive |
| `--az-teal` | `#2dd4bf` | Bull gradient partner |
| `--az-caution` | `#f59e0b` | Neutral regime · 1-session-behind · unresolved |
| `--az-crisis` | `#fb7185` | Crisis regime · bearish drag · VIX bar |
| `--az-stale` | `#ef4444` | Hard staleness (≥2 sessions) · invalidated |
| `--az-data` | `#22d3ee` | Data accent: links, interactive, history line, score markers |
| `--az-model` | `#a78bfa` | Model artifacts: confidence bands, gradient partner |
| `--az-gold` | `#c9a961` | Ledger/accountability & editorial accents |
| `--az-slate` | `#94a3b8` | Mixed/zero-signal informational |

## Brand & type
| Token | Value |
|---|---|
| `--az-grad` | `linear-gradient(135deg, #22d3ee, #a78bfa)` — titles, active tab, history line |
| `--az-mono` | `'JetBrains Mono', Menlo, monospace` — **all machine-generated content**: data, labels, badges, captions (uppercase + 0.08–0.2em tracking) |
| `--az-disp` | `'Space Grotesk', 'Inter', sans-serif` — display: titles, hero numerics (`tnum` on) |
| `--az-sans` | `'Inter', system-ui, sans-serif` — human prose |

Type scale in practice: 0.58–0.7rem mono micro-labels → 0.9–0.96rem body → 1.05–1.35rem card titles → 2.8rem page titles (standardized) → 2.6–4.6rem hero numerics.

## Consumption map
- **Chrome** (nav/footer): legacy `--surface-*`/`--brand-*` tokens still used internally by design.php CSS; `--az-*` defined alongside. Future chrome edits should prefer `--az-*`.
- **Pulse Lab (1452)** & **Ledger (2768)** page CSS: fully migrated to `var(--az-x, fallback)`.
- **Home (815)**: **deliberate carve-out** — the hm6 hero palette uses intentionally divergent values (`#06081a`, `#38bdf8`, `#8b8fd8`, `#34b88c`, `#d4a574`…) for its aurora look. Unifying it would visibly shift the homepage; that's a design decision, not a refactor. Decide separately.
- **Charts (plv2.js)**: SVG attributes can't read CSS vars portably in this setup → chart colors are **mirrored constants** in plv2.js. If a semantic color ever changes, update BOTH this sheet/design.php AND plv2.js (search the hex).
- **Snippets** #2772 (share), #2951 (cosmetic polish), #2952 (academy chip): consume `var(--az-*)` with fallbacks.

## Rules
1. New work consumes tokens, never raw hex (charts excepted, mirrored).
2. Semantic colors carry meaning — green is never decoration.
3. Custom interactive elements on Bantry always ship `!important` (theme button CSS is aggressive).
4. No inline `&&` in any content-embedded script (WP entity-corruption); page logic lives in repo files pinned @commit via jsDelivr.
