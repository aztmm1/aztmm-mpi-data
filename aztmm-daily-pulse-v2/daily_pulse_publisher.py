"""
AZTMM Daily Pulse v2 — Publisher
=================================

Responsibilities:
  1. Render the post HTML from the aggregator dict via Jinja2.
  2. Run the brand-policy scrubber — block publish if any forbidden phrase
     appears in user-visible output.
  3. Publish as DRAFT to WordPress via the wpcom-mcp-content-authoring MCP
     tool (caller invokes; this module surfaces the payload only).

The wpcom MCP is invoked at the orchestrator layer (run_daily_pulse.py).
This module exposes:
  - render_html(agg, template_path) -> str
  - brand_check(html) -> dict { ok: bool, hits: [str] }
  - build_post_payload(agg, html) -> dict (ready to ship to wpcom MCP)
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger("daily_pulse.publisher")

# ---------------------------------------------------------------------------
# Brand policy — forbidden phrases (case-insensitive substring match)
# ---------------------------------------------------------------------------

# Post-UW free-source rewrite: methodology footnote now EXPLICITLY discloses
# sources (yfinance/CBOE/FINRA/EDGAR), so source names are allowed there.
# The brand_check strips the methodology block before scanning.
FORBIDDEN_PHRASES = [
    "fred", "aaii",
    "bbs", "blackbox", "black box",
    "hmm", "hidden markov", "transition matrix",
    "★",
    "unusual whales", "unusualwhales",
]
# Note: "uw " removed because false-positive risk (e.g. "two-week" etc).
# UW vendor name now strictly forbidden via "unusual whales"/"unusualwhales".

# Allowlist regex: methodology footnote block — exempt from brand-check.
METHODOLOGY_RE = (
    r"<p[^>]*>\s*Data sources:[^<]*</p>"
)

# These regex patterns catch model-weight leaks
FORBIDDEN_REGEXES = [
    r"\bp\s*=\s*0\.\d+",        # "p=0.42"
    r"\bweight\s*=\s*0\.\d+",   # "weight=0.3"
    r"\bscore\s*=\s*\d+(?:\.\d+)?\b",  # "score=4.2" — leaks methodology
]


def brand_check(html: str) -> dict:
    """Return {ok: bool, hits: list[str]}. ok=True means no forbidden hits.

    The methodology-footnote block is excluded from the scan because it
    explicitly discloses data sources per the v3 free-source policy.
    """
    # Strip methodology footnote — it intentionally names sources
    text = re.sub(METHODOLOGY_RE, "", html, flags=re.IGNORECASE | re.DOTALL).lower()
    hits: list[str] = []
    for phrase in FORBIDDEN_PHRASES:
        if phrase in text:
            hits.append(phrase.strip())
    for pattern in FORBIDDEN_REGEXES:
        m = re.search(pattern, text, flags=re.IGNORECASE)
        if m:
            hits.append(f"regex:{pattern}={m.group(0)}")
    return {"ok": not hits, "hits": hits}


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def render_html(agg: dict, template_path: str | Path) -> str:
    """Render the post body HTML from the aggregator output."""
    template_path = Path(template_path)
    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    tpl = env.get_template(template_path.name)
    return tpl.render(**agg)


# ---------------------------------------------------------------------------
# WordPress post payload
# ---------------------------------------------------------------------------

def build_post_payload(agg: dict, html: str, status: str = "draft") -> dict:
    """
    Build the JSON payload for the wpcom-mcp-content-authoring publish tool.
    """
    date = agg.get("date") or ""
    # v3 subject line: "AZTMM Closing Pulse · Thursday May 14, 2026"
    # Jetpack pulls newsletter subject from the WP post title.
    display_date = agg.get("post_date_display") or date
    title = f"AZTMM Closing Pulse · {display_date}"

    excerpt = agg.get("headline") or agg.get("scenario", {}).get(
        "headline", "End-of-session market read.")

    return {
        "title": title,
        "content": html,
        "excerpt": excerpt,
        "status": status,
        "categories": ["Daily Pulse"],
        "tags": ["daily-pulse"],
        "slug": f"daily-pulse-options-flow-dark-pool-{date}",
    }



# ---------------------------------------------------------------------------
# Needs-review writer (when brand check fails)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Sparkline - 30-day trend
# ---------------------------------------------------------------------------

def update_history(history_path, tracker_slug: str, label: str,
                   date: str, value, max_entries: int = 90) -> dict:
    """Load data/history.json, append today's metric, save back. Idempotent
    on date - re-running the same date overwrites that day's point."""
    import json as _json
    history_path = Path(history_path)
    data = None
    if history_path.exists():
        try:
            data = _json.loads(history_path.read_text())
        except (_json.JSONDecodeError, ValueError):
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
    history_path.write_text(_json.dumps(data, indent=2))
    return data


def build_sparkline_context(history_data: dict, lookback: int = 30) -> dict:
    """Return Jinja context for the sparkline. Placeholder if <3 points."""
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


def write_needs_review(html: str, hits: list[str], out_dir: Path, date: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"daily-pulse-{date}-NEEDS-REVIEW.html"
    notice = (
        f"<!-- BRAND-POLICY BLOCK: hits = {hits!r} -->\n"
        f"<!-- date = {date} -->\n"
    )
    path.write_text(notice + html)
    return path


if __name__ == "__main__":
    # Quick smoke test on a sample blob
    import argparse, json
    p = argparse.ArgumentParser()
    p.add_argument("--agg", required=True)
    p.add_argument("--template", required=True)
    p.add_argument("--out", default=None)
    args = p.parse_args()

    with open(args.agg) as f:
        agg = json.load(f)
    html = render_html(agg, args.template)
    check = brand_check(html)
    print(f"brand_check: ok={check['ok']}  hits={check['hits']}")
    if args.out:
        Path(args.out).write_text(html)
        print(f"wrote {args.out}")
