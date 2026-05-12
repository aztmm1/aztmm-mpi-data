"""
AZTMM NOPE & Max-Pain Tracker — Publisher
==========================================

Responsibilities:
  1. Render the page HTML from the public dict via Jinja2.
  2. Run the brand-policy scrubber against the rendered HTML and against
     the public JSON. Block publish if any forbidden phrase appears.
  3. Build the WP page-update payload for the orchestrator.

The page only ever reads `public.json` from jsDelivr at load time —
NEVER bakes the data into HTML at render time. This file produces:
  - the SSR-time HTML frame (static — no values),
  - the public.json snapshot (served separately on jsDelivr).
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger("nope_max_pain.publisher")


# ---------------------------------------------------------------------------
# Brand-policy scrub (mirror of the canonical list — see
# outputs/aztmm-agent-skills/aztmm-brand-policy-scrub/replacements.json)
#
# NOPE itself is allowed in headings (industry term, not vendor-specific).
# ---------------------------------------------------------------------------

FORBIDDEN_SUBSTRINGS = [
    # vendors
    "unusual whales", "unusualwhales", "unusual-whales",
    "blackboxstocks", "blackbox", "black box", "bbs",
    "cboe", "fred", "yahoo finance", "yfinance", "aaii",
    "opra", "stooq", "polygon",
    # methodology leaks
    "hidden markov", "transition matrix",
    "posterior probability", "state space",
    # positioning drift
    "real-time", "real time", "live tape", "streaming",
    # advisory language
    "buy puts", "sell puts", "buy calls", "sell calls",
    "strong buy", "strong sell", "must-see",
    "trade idea", "high conviction",
]

# Word-boundary regexes — avoid hitting "alfred" for "FRED" etc.
FORBIDDEN_REGEXES = [
    r"\bFRED\b",
    r"\bUW\b",
    r"\bHMM\b",
    r"\bp\s*=\s*0\.\d+",
    r"\bweight\s*=\s*0\.\d+",
    # standalone "live" / "now updating" — drift language
    r"\bupdating now\b",
    r"\bnow\s+updating\b",
    # advisory verbs at sentence start
    r"(?i)\b(buy|sell|recommend)\s+(?:the\s+|this\s+)?(?:dip|rip|stock|name|ticker|setup|target)\b",
    # target price patterns
    r"\btarget\s+price\b",
    r"\bprice\s+target\b",
    # star glyphs
    r"★",
]


def brand_check(text: str, context: str = "page") -> dict:
    """
    Return {ok: bool, hits: [str]} for a chunk of user-visible text.

    `context` softens nothing here — public surfaces are strict.
    """
    hits: list[str] = []
    lowered = text.lower()
    for phrase in FORBIDDEN_SUBSTRINGS:
        if phrase in lowered:
            hits.append(phrase)
    for pat in FORBIDDEN_REGEXES:
        m = re.search(pat, text, flags=re.IGNORECASE if "(?i)" not in pat else 0)
        if m:
            hits.append(f"regex:{pat}={m.group(0)}")
    return {"ok": not hits, "hits": hits}


def brand_check_public_json(public: dict) -> dict:
    """Stringify and check the published JSON too."""
    blob = json.dumps(public, default=str)
    return brand_check(blob, context="json")


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def render_html(public_for_static: dict, template_path: str | Path) -> str:
    """
    Render the page HTML.

    The template is SSR-time: it must NOT bake values from public_for_static
    into the user-visible content. Only static framing + script tags that
    load Chart.js + fetch the live snapshot JSON client-side.

    We still pass `public_for_static` so the template can use the date stamp
    in HTML comments, but every dynamic block has a `data-*` placeholder
    that the client-side script fills in.
    """
    template_path = Path(template_path)
    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    tpl = env.get_template(template_path.name)
    return tpl.render(**public_for_static)


# ---------------------------------------------------------------------------
# WP page payload (page update, not post create)
# ---------------------------------------------------------------------------

def build_page_payload(public: dict, html: str, page_id: int | None = None) -> dict:
    """
    Build the JSON payload for a WP page-update call.

    The aztmm page slug is `/options-gravity/`. If `page_id` is known
    (looked up by the orchestrator from a config file), include it so the
    WP-MCP can do an update vs a create.
    """
    out = {
        "title": "Options Gravity — NOPE & Max-Pain Watch",
        "content": html,
        "slug": "options-gravity",
        "status": "publish",
        "excerpt": "End-of-session NOPE readings and max-pain strikes for index proxies and a handful of megacaps. Updated once daily at 5 PM ET.",
    }
    if page_id is not None:
        out["page_id"] = page_id
    return out


def write_needs_review(html: str, hits: list[str], out_dir: Path, date: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"options-gravity-{date}-NEEDS-REVIEW.html"
    notice = (
        f"<!-- BRAND-POLICY BLOCK: hits = {hits!r} -->\n"
        f"<!-- date = {date} -->\n"
    )
    path.write_text(notice + html)
    return path


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--public", required=True)
    p.add_argument("--template", required=True)
    p.add_argument("--out", default=None)
    args = p.parse_args()

    with open(args.public) as f:
        pub = json.load(f)
    html = render_html(pub, args.template)
    check = brand_check(html)
    print(f"brand_check: ok={check['ok']}  hits={check['hits']}")
    if args.out:
        Path(args.out).write_text(html)
        print(f"wrote {args.out}")
