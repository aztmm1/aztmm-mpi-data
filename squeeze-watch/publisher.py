"""
AZTMM Squeeze Watch — publisher

Responsibilities:
  1. Render the page HTML from the aggregator dict via Jinja2.
  2. Run the brand-policy scrubber — block publish if any forbidden phrase
     appears in user-visible output. EXTRA STRICT for this surface — the
     topic is near the advice line.
  3. Write dual-output JSON (public + internal).
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger("squeeze.publisher")


# ---------------------------------------------------------------------------
# Brand policy — forbidden phrases (case-insensitive substring + regex)
# Inherited from FRAMEWORK-RECAP-v2 + augmented for squeeze-watch's extra
# strictness around advice language.
# ---------------------------------------------------------------------------

# Vendor + secret-sauce phrases (always forbidden in public output)
FORBIDDEN_PHRASES_BASE = [
    "cboe", "fred", "yahoo", "aaii",
    "bbs", "blackbox", "black box",
    "hmm", "hidden markov", "transition matrix",
    "unusual whales", "unusualwhales",
    " uw ",
    "★",
]

# Advice-language list — every one of these is a hard fail on this page.
# "Squeeze" itself is allowed (page topic terminology) but advice verbs
# are not. Word-boundary matching avoids false positives.
FORBIDDEN_ADVISORY_WORDS = [
    r"\bbuy\b", r"\bsell\b",
    r"\brecommend(?:s|ed|ing|ation)?\b",
    r"\bsignal\b",
    r"\bsetup\b",
    r"\btarget\b",
    r"\bplay this\b",
    r"\btrade idea\b",
    r"\bentry\b", r"\bexit\b",
    r"\bimminent\b",
    r"\bbreakout\b",
    r"\bshould (?:buy|sell|own|hold|short)\b",
    r"\b(?:strong|high[- ]conviction)\s+(?:buy|signal|setup)\b",
    r"\blive\b", r"\breal[- ]time\b", r"\bstreaming\b",
    r"\bbullish call\b", r"\bbearish call\b",
]

FORBIDDEN_REGEXES = [
    r"\bp\s*=\s*0\.\d+",        # model probability leak
    r"\bweight\s*=\s*0\.\d+",   # weight leak
    r"\bscore\s*=\s*\d+(?:\.\d+)?\b",  # raw score leak
]


# Allow-list phrases — exact substrings that may legitimately contain
# what would otherwise be advisory wording (e.g. "not investment advice",
# "not a recommendation"). These windows are excised from the search text
# before the advisory scan runs. The vendor/secret-sauce scan still runs
# against the full text — only advisory-language false positives are
# guarded here.
ADVISORY_ALLOWLIST = [
    "not investment advice",
    "not a recommendation",
    "inclusion in this list is not a recommendation",
    "past short squeezes do not predict future moves",
    "i'm watching but not chasing",
    "watching but not chasing",
    "list of names to chase",
    "names to chase",
    "names to trade",
    "not a list of names to trade",
    "not direction calls",
    "is not a direction call",
    "are not direction calls",
    "not a direction call",
    # methodology language describing what we do NOT do
    "does not recommend",
    "not recommend",
    "do not recommend",
    "not advise",
    "does not advise",
    # standard policy disclaimer wording that mentions hold/own etc.
    "not investment",
]


def _strip_allowlist(text: str) -> str:
    """Replace allow-listed phrases with spaces so the advisory scan
    cannot see the words inside them. Preserves length and word
    boundaries elsewhere."""
    out = text
    lo = out.lower()
    for phrase in ADVISORY_ALLOWLIST:
        plen = len(phrase)
        start = 0
        while True:
            idx = lo.find(phrase, start)
            if idx < 0:
                break
            out = out[:idx] + (" " * plen) + out[idx + plen:]
            lo = lo[:idx] + (" " * plen) + lo[idx + plen:]
            start = idx + plen
    return out


def brand_check(html: str) -> dict:
    """Return {ok: bool, hits: list[str]}. ok=True means no forbidden hits.

    The advisory-language scan runs against an allow-list-masked copy of
    the HTML so legitimate negations ("not a recommendation") don't trip
    the filter. The vendor/secret-sauce scan still runs against the full
    text — those phrases are unconditional fails.
    """
    text_lower = html.lower()
    hits: list[str] = []

    for phrase in FORBIDDEN_PHRASES_BASE:
        if phrase in text_lower:
            hits.append(f"phrase:{phrase.strip()}")

    masked = _strip_allowlist(html)
    for pattern in FORBIDDEN_ADVISORY_WORDS:
        m = re.search(pattern, masked, flags=re.IGNORECASE)
        if m:
            hits.append(f"advisory:{pattern}={m.group(0)}")

    for pattern in FORBIDDEN_REGEXES:
        m = re.search(pattern, html, flags=re.IGNORECASE)
        if m:
            hits.append(f"regex:{pattern}={m.group(0)}")

    return {"ok": not hits, "hits": hits}


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------

def render_html(public: dict, template_path: str | Path) -> str:
    """Render the page HTML from the public-side aggregator output."""
    template_path = Path(template_path)
    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    tpl = env.get_template(template_path.name)
    return tpl.render(**public)


# ---------------------------------------------------------------------------
# Dual-output writer
# ---------------------------------------------------------------------------

def write_outputs(agg: dict, html: str, out_dir: Path, date: str) -> dict:
    """Write public.json, internal.json, and rendered HTML; return paths."""
    out_dir.mkdir(parents=True, exist_ok=True)

    import json

    public_path = out_dir / f"squeeze-{date}.public.json"
    internal_path = out_dir / f"squeeze-{date}.internal.json"
    html_path = out_dir / f"squeeze-{date}.html"

    public_path.write_text(json.dumps(agg["public"], indent=2, default=str))
    internal_path.write_text(json.dumps(agg["internal"], indent=2, default=str))
    html_path.write_text(html)

    return {
        "public_json": str(public_path),
        "internal_json": str(internal_path),
        "html": str(html_path),
    }
