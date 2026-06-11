#!/usr/bin/env python3
"""Branded Open Graph card generator for aztmm.com.

Renders a 1200x630 PNG (via SVG + cairosvg) for a post:

    python3 render_og.py --slug my-post --title "My Post" --date 2026-06-10 \
        --mpi 57 --regime "Bull . early" --outdir aztmm-content-api/og

Idempotent: skips existing output unless --force is given.
"""
import argparse
import datetime
import subprocess
import sys
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape

import cairosvg

# ---- brand constants -------------------------------------------------------
BG, INK, MUTED = "#06081a", "#e6e9ff", "#7e84b5"
CYAN, VIOLET, GOLD = "#22d3ee", "#a78bfa", "#c9a961"
W, H, MARGIN, MAXW = 1200, 630, 60, 1080

FONTS_DIR = Path.home() / ".fonts"
FONT_URLS = {  # variable fonts; default instance works with fontconfig/cairo
    "SpaceGrotesk[wght].ttf":
        "https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf",
    "JetBrainsMono[wght].ttf":
        "https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
}


def ensure_fonts():
    """Download brand TTFs into ~/.fonts, refresh fontconfig, return (display, mono) families."""
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in FONT_URLS.items():
        dest = FONTS_DIR / name
        if dest.exists() and dest.stat().st_size > 10_000:
            continue
        try:
            urllib.request.urlretrieve(url, dest)
        except Exception as exc:  # network failure -> DejaVu fallback below
            print(f"[fonts] download failed for {name}: {exc}", file=sys.stderr)
    subprocess.run(["fc-cache", "-f"], capture_output=True)
    installed = subprocess.run(["fc-list"], capture_output=True, text=True).stdout
    display = "Space Grotesk" if "Space Grotesk" in installed else "DejaVu Sans"
    mono = "JetBrains Mono" if "JetBrains Mono" in installed else "DejaVu Sans Mono"
    if "DejaVu" in display or "DejaVu" in mono:
        print(f"[fonts] NOTE: fallback in use (display={display}, mono={mono})", file=sys.stderr)
    return display, mono


def make_measurer(display_family):
    """Return fn(text, size) -> pixel width. Uses PIL on the real TTF; estimates if PIL fails."""
    try:
        from PIL import ImageFont
        path = FONTS_DIR / "SpaceGrotesk[wght].ttf"
        if display_family != "Space Grotesk" or not path.exists():
            path = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
        cache = {}

        def measure(text, size):
            if size not in cache:
                font = ImageFont.truetype(str(path), size)
                try:
                    font.set_variation_by_axes([700])  # bold instance of variable font
                except Exception:
                    pass
                cache[size] = font
            return cache[size].getlength(text)

        measure("x", 64)  # smoke-test the font file now, not mid-wrap
        return measure
    except Exception:
        return lambda text, size: len(text) * size * 0.62  # conservative estimate


def wrap_title(title, measure):
    """Auto-size 64 -> 48 and greedy-wrap to <= 3 lines within MAXW. Returns (size, lines)."""
    def wrap_at(size):
        lines, cur = [], ""
        for word in title.split():
            trial = f"{cur} {word}".strip()
            if measure(trial, size) <= MAXW or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = word
        if cur:
            lines.append(cur)
        return lines

    for size in (64, 60, 56, 52, 48):
        lines = wrap_at(size)
        if len(lines) <= 3 and all(measure(l, size) <= MAXW for l in lines):
            return size, lines
    lines = wrap_at(48)[:3]  # last resort: clamp to 3 lines, ellipsize
    while measure(lines[-1] + "…", 48) > MAXW and " " in lines[-1]:
        lines[-1] = lines[-1].rsplit(" ", 1)[0]
    lines[-1] += "…"
    return 48, lines


def build_svg(title, date_iso, mpi, regime, display, mono):
    d = datetime.date.fromisoformat(date_iso)
    strip = f"MPI {mpi} · {regime} · {d.day} {d.strftime('%B')} {d.year} CLOSE".upper()
    size, lines = wrap_title(title, make_measurer(display))

    line_h = round(size * 1.18)
    block_h = len(lines) * line_h + 56 + 26          # title lines + gap + strip
    top = (130 + 548) // 2 - block_h // 2            # center between header and rule
    title_texts = "".join(
        f'<text x="{MARGIN}" y="{top + round(size * 0.8) + i * line_h}" font-family="{escape(display)}" '
        f'font-size="{size}" font-weight="700" fill="{INK}">{escape(line)}</text>'
        for i, line in enumerate(lines)
    )
    strip_y = top + round(size * 0.8) + (len(lines) - 1) * line_h + 56 + 20

    return f'''<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="brand" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="{CYAN}"/><stop offset="100%" stop-color="{VIOLET}"/>
  </linearGradient>
  <linearGradient id="goldrule" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="{GOLD}"/><stop offset="55%" stop-color="{GOLD}" stop-opacity="0.45"/>
    <stop offset="100%" stop-color="{GOLD}" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="glow" cx="0%" cy="0%" r="78%">
    <stop offset="0%" stop-color="rgb(34,211,238)" stop-opacity="0.10"/>
    <stop offset="100%" stop-color="rgb(34,211,238)" stop-opacity="0"/>
  </radialGradient>
  <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
    <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgb(58,65,111)" stroke-opacity="0.06" stroke-width="1"/>
  </pattern>
</defs>
<rect width="{W}" height="{H}" fill="{BG}"/>
<rect width="{W}" height="{H}" fill="url(#grid)"/>
<rect width="{W}" height="{H}" fill="url(#glow)"/>
<text x="{MARGIN}" y="98" font-family="{escape(display)}" font-size="44" font-weight="700" letter-spacing="1" fill="url(#brand)">AZTMM</text>
<text x="{W - MARGIN}" y="92" text-anchor="end" font-family="{escape(mono)}" font-size="18" letter-spacing="3" fill="{MUTED}">DAILY MARKET-STRUCTURE RESEARCH</text>
{title_texts}
<text x="{MARGIN}" y="{strip_y}" font-family="{escape(mono)}" font-size="26" letter-spacing="1.5" fill="{CYAN}">{escape(strip)}</text>
<rect x="{MARGIN}" y="548" width="{W - 2 * MARGIN}" height="3" fill="url(#goldrule)"/>
<text x="{MARGIN}" y="596" font-family="{escape(mono)}" font-size="22" letter-spacing="2" fill="{MUTED}">aztmm.com</text>
<text x="{W - MARGIN}" y="596" text-anchor="end" font-family="{escape(mono)}" font-size="20" letter-spacing="2" fill="{MUTED}">EOD RESEARCH · NEVER REVISED</text>
</svg>'''


def main():
    p = argparse.ArgumentParser(description="Render an AZTMM Open Graph card (1200x630 PNG).")
    p.add_argument("--slug", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--date", required=True, help="YYYY-MM-DD")
    p.add_argument("--mpi", required=True)
    p.add_argument("--regime", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--force", action="store_true", help="re-render even if output exists")
    args = p.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    out = outdir / f"{args.slug}.png"
    if out.exists() and not args.force:
        print(f"[skip] {out} exists (use --force to re-render)")
        return

    display, mono = ensure_fonts()
    svg = build_svg(args.title, args.date, args.mpi, args.regime, display, mono)
    cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=str(out),
                     output_width=W, output_height=H)
    print(f"[ok] {out} ({out.stat().st_size} bytes, fonts: {display} / {mono})")


if __name__ == "__main__":
    main()
