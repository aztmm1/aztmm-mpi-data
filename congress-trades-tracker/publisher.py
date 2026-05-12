"""
AZTMM Congress Trades Tracker - Publisher
===========================================

Responsibilities:
  1. Render dashboard HTML via Jinja2.
  2. Run the brand-policy scrub - block on any forbidden phrase.
  3. Write dual outputs:
       - public.json  (jsDelivr-served, scrubbed)
       - internal.json (repo-only, raw)
  4. Emit a WP-page payload (page slug /congress-watch/) for the orchestrator.

The brand-policy scrub mirrors the rules from
outputs/aztmm-agent-skills/aztmm-brand-policy-scrub/replacements.json
plus the forbidden list in FRAMEWORK-RECAP-v2.md section 2.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger("congress.publisher")

# ---------------------------------------------------------------------------
# Brand policy - forbidden phrases (case-insensitive, word-boundary where useful)
# ---------------------------------------------------------------------------

# Plain substrings (lowercased)
FORBIDDEN_SUBSTRINGS = [
    # Vendors
    "unusual whales", "unusualwhales", "unusual-whales",
    "blackboxstocks", "blackbox", "black box", "bbs",
    "cboe", "fred", "yahoo finance", "aaii", "opra", "yfinance",
    "stooq", "polygon",
    # Methodology leaks
    "hidden markov", "transition matrix", "transition probabilit",
    "posterior probability", "state space",
    "mpi_sleeve", "weights:", "weight vector",
    # Positioning drift
    "real-time", "real time", "streaming", "updating now", "live tape",
    # Star glyph
    "★",
]

# Word-boundary terms (case-insensitive) - matched as standalone tokens
FORBIDDEN_WORDS = [
    "uw",          # vendor abbrev
    "hmm",         # model name
    "buy", "sell", "recommend", "recommended",
    "signal", "setup", "entry", "exit",
    "live",        # positioning drift (when standalone)
]

# Model-weight leak patterns
FORBIDDEN_REGEXES = [
    r"\bp\s*=\s*0\.\d+",
    r"\bweight\s*=\s*0\.\d+",
    r"\bscore\s*=\s*\d+(?:\.\d+)?\b",
]


def brand_check(text: str) -> dict:
    """Return {ok: bool, hits: list[str]} - ok=True means clean."""
    if not text:
        return {"ok": True, "hits": []}
    low = text.lower()
    hits: list[str] = []
    for phrase in FORBIDDEN_SUBSTRINGS:
        if phrase in low:
            hits.append(phrase.strip() or "<star-glyph>")
    for word in FORBIDDEN_WORDS:
        if re.search(rf"\b{re.escape(word)}\b", low):
            hits.append(f"word:{word}")
    for pat in FORBIDDEN_REGEXES:
        m = re.search(pat, low, flags=re.IGNORECASE)
        if m:
            hits.append(f"regex:{pat}={m.group(0)}")
    # dedupe, preserve order
    seen: set[str] = set()
    deduped: list[str] = []
    for h in hits:
        if h not in seen:
            seen.add(h)
            deduped.append(h)
    return {"ok": not deduped, "hits": deduped}


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def render_html(context: dict, template_path: str | Path) -> str:
    template_path = Path(template_path)
    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    tpl = env.get_template(template_path.name)
    return tpl.render(**context)


# ---------------------------------------------------------------------------
# Public JSON sanitization
# ---------------------------------------------------------------------------

def sanitize_public_json(obj: Any) -> Any:
    """Walk the public payload and ensure no string contains a forbidden phrase.
    Strings flagged are replaced with a neutral placeholder - the upstream
    aggregator is responsible for not putting source labels in here in the
    first place; this is a belt-and-suspenders pass."""
    if isinstance(obj, dict):
        return {k: sanitize_public_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_public_json(x) for x in obj]
    if isinstance(obj, str):
        chk = brand_check(obj)
        if chk["ok"]:
            return obj
        # Scrub by replacing known substrings with neutral text
        out = obj
        low = out.lower()
        for phrase in FORBIDDEN_SUBSTRINGS:
            if phrase in low:
                out = re.sub(re.escape(phrase), "[scrubbed]", out, flags=re.IGNORECASE)
                low = out.lower()
        return out
    return obj


# ---------------------------------------------------------------------------
# WordPress page payload
# ---------------------------------------------------------------------------

def build_page_payload(public: dict, html: str, slug: str = "congress-watch") -> dict:
    """Page payload for wpcom-mcp-content-authoring (create/update page)."""
    return {
        "title": "Congress Watch",
        "content": html,
        "status": "draft",
        "slug": slug,
        "excerpt": f"End-of-session snapshot of recent congressional trade disclosures. As of {public.get('as_of')}.",
    }


# ---------------------------------------------------------------------------
# Needs-review writer
# ---------------------------------------------------------------------------

def write_needs_review(html: str, hits: list[str], out_dir: Path, date: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"congress-{date}-NEEDS-REVIEW.html"
    notice = (
        f"<!-- BRAND-POLICY BLOCK: hits = {hits!r} -->\n"
        f"<!-- date = {date} -->\n"
    )
    path.write_text(notice + html)
    return path


# ---------------------------------------------------------------------------
# Sparkline — 30-day trend
# ---------------------------------------------------------------------------

def update_history(history_path: Path, tracker_slug: str, label: str,
                   date: str, value, max_entries: int = 90) -> dict:
    """Load data/history.json, append today's metric, save back. Idempotent
    on date — re-running the same date overwrites that day's point."""
    history_path = Path(history_path)
    data: Any = None
    if history_path.exists():
        try:
            data = json.loads(history_path.read_text())
        except (json.JSONDecodeError, ValueError):
            data = None
    if not isinstance(data, dict) or "points" not in data:
        data = {"tracker": tracker_slug, "headline_metric_label": label, "points": []}
    data["tracker"] = tracker_slug
    data["headline_metric_label"] = label
    points = [p for p in data.get("points", [])
              if isinstance(p, dict) and p.get("date") != date]
    if value is not None:
        try:
            points.append({"date": date, "value": float(value)})
        except (TypeError, ValueError):
            pass
    points.sort(key=lambda p: p.get("date") or "")
    data["points"] = points[-max_entries:]
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_path.write_text(json.dumps(data, indent=2))
    return data


def build_sparkline_context(history_data: dict, lookback: int = 30) -> dict:
    """Return a dict ready to feed into the Jinja sparkline section.
    If fewer than 3 points, returns a placeholder context."""
    points = (history_data or {}).get("points") or []
    points = [p for p in points if isinstance(p, dict) and p.get("date") is not None
              and p.get("value") is not None][-lookback:]
    label = (history_data or {}).get("headline_metric_label") or "Headline metric"
    if len(points) < 3:
        return {
            "sparkline_available": False,
            "headline_metric_label": label,
            "sparkline_placeholder": "Building history - sparkline appears after a few days.",
        }
    values = [float(p["value"]) for p in points]
    dates = [p["date"] for p in points]
    n = len(values)
    vmin = min(values)
    vmax = max(values)
    vrange = (vmax - vmin) if vmax != vmin else 1.0
    width, height = 600, 80
    pad_x, pad_y = 4, 6
    plot_w = width - 2 * pad_x
    plot_h = height - 2 * pad_y
    coords = []
    for i, v in enumerate(values):
        x = pad_x + (i / max(n - 1, 1)) * plot_w
        y = pad_y + plot_h - ((v - vmin) / vrange) * plot_h
        coords.append(f"{round(x, 2)},{round(y, 2)}")
    polyline = " ".join(coords)
    latest = values[-1]
    if abs(latest - round(latest)) < 1e-9:
        latest_fmt = f"{int(round(latest))}"
    else:
        latest_fmt = f"{latest:.2f}"
    return {
        "sparkline_available": True,
        "headline_metric_label": label,
        "sparkline_polyline": polyline,
        "sparkline_first_date": dates[0],
        "sparkline_last_date": dates[-1],
        "sparkline_latest_value": latest_fmt,
        "sparkline_point_count": n,
    }


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--context", required=True, help="JSON of render context")
    p.add_argument("--template", required=True)
    p.add_argument("--out", default=None)
    args = p.parse_args()
    with open(args.context) as f:
        ctx = json.load(f)
    html = render_html(ctx, args.template)
    chk = brand_check(html)
    print(f"brand_check ok={chk['ok']} hits={chk['hits']}")
    if args.out:
        Path(args.out).write_text(html)
        print(f"wrote {args.out}")
