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

FORBIDDEN_PHRASES = [
    "cboe", "fred", "yahoo", "aaii",
    "bbs", "blackbox", "black box",
    "hmm", "hidden markov", "transition matrix",
    "★",
    "unusual whales", "unusualwhales", " uw ",
]

# These regex patterns catch model-weight leaks
FORBIDDEN_REGEXES = [
    r"\bp\s*=\s*0\.\d+",        # "p=0.42"
    r"\bweight\s*=\s*0\.\d+",   # "weight=0.3"
    r"\bscore\s*=\s*\d+(?:\.\d+)?\b",  # "score=4.2" — leaks methodology
]


def brand_check(html: str) -> dict:
    """Return {ok: bool, hits: list[str]}. ok=True means no forbidden hits."""
    text = html.lower()
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

    The orchestrator passes this dict straight to the WP-MCP create-post call.
    Status defaults to 'draft' on first runs so a human can review before
    auto-publish is enabled.
    """
    date = agg["date"]
    scenario = agg.get("scenario", {})
    label = scenario.get("label", "BASE")
    title = f"Daily Pulse — {date} — {label}"

    excerpt = scenario.get("headline", "Daily end-of-session market read.")

    return {
        "title": title,
        "content": html,
        "excerpt": excerpt,
        "status": status,  # draft | publish
        "categories": ["Daily Pulse"],
        "tags": ["daily-pulse", f"scenario-{label.lower().replace(' ', '-')}"],
        "slug": f"daily-pulse-{date}",
    }


# ---------------------------------------------------------------------------
# Needs-review writer (when brand check fails)
# ---------------------------------------------------------------------------

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
