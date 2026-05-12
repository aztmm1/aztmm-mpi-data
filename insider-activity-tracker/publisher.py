"""
AZTMM Insider Activity — publisher

Responsibilities:
  1. Render the page HTML from the aggregator dict via Jinja2.
  2. Run the brand-policy scrubber — block publish on any forbidden phrase
     in user-visible output.
  3. Write dual-output JSON (public + internal) + the rendered HTML.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger("insider.publisher")


# ---------------------------------------------------------------------------
# Brand policy — forbidden phrases (case-insensitive substring + regex)
# Inherited from FRAMEWORK-RECAP-v2.
# ---------------------------------------------------------------------------

FORBIDDEN_PHRASES_BASE = [
    "cboe", "fred", "yahoo", "aaii",
    "bbs", "blackbox", "black box",
    "hmm", "hidden markov", "transition matrix",
    "unusual whales", "unusualwhales", "unusual-whales",
    " uw ",
    "★",  # star char
]

# Advice / live-data language — hard fails when not in the allow-list.
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
    r"\bfollow this insider\b",
    r"\bbuy what they(?:'re| are)\s+buying\b",
]

FORBIDDEN_REGEXES = [
    r"\bp\s*=\s*0\.\d+",        # model probability leak
    r"\bweight\s*=\s*0\.\d+",   # weight leak
    r"\bscore\s*=\s*\d+(?:\.\d+)?\b",  # raw score leak
]


# Allow-list phrases — substrings whose advisory words are legitimately
# present (compound terminology like "insider buying", standard
# disclaimer wording, etc.). The advisory scan is run against a masked
# copy of the HTML with these windows excised.
#
# Special: "insider buying" / "insider selling" / "buying" / "selling"
# in noun-form context is allowed. We list every legitimate compound
# explicitly so the bare verb forms still fail.
ADVISORY_ALLOWLIST = [
    "not investment advice",
    "not a recommendation",
    "not investment",
    "does not recommend",
    "does not advise",
    "do not recommend",
    "not recommend",
    "not advise",
    "i'm watching but not chasing",
    "watching but not chasing",
    "not a list of names to trade",
    "names to chase",
    "names to trade",
    "is not a direction call",
    "are not direction calls",
    "not direction calls",
    "not a direction call",
    # Insider tracker terminology (noun-phrase compounds where "buy"
    # and "sell" describe past Form 4 events, not present-tense
    # recommendations).
    "open-market buys",
    "open-market sells",
    "open-market buying",
    "open-market selling",
    "open-market insider buying",
    "open-market insider selling",
    "insider buying",
    "insider selling",
    "insider buys",
    "insider sells",
    "insider buy",
    "insider sell",
    "buy side",
    "sell side",
    "buy-side",
    "sell-side",
    "the week's qualifying buys",
    "the week's qualifying sells",
    "qualifying buys",
    "qualifying sells",
    "qualifying open-market buys",
    "qualifying open-market sells",
    "top buyers",
    "top sellers",
    "buyer tickers",
    "seller tickers",
    "tickers with buys",
    "tickers with sells",
    "no company cleared the bar",
    "follow what insiders are doing",
    "follow this insider",
    "follow these insiders",
    "buy what they're buying",
    "buy what they are buying",
]


def _strip_allowlist(text: str) -> str:
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
    """Return {ok: bool, hits: list[str]}. ok=True means no forbidden hits."""
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

def write_outputs(agg: dict, html: str, out_dir: Path, week_ending: str) -> dict:
    """Write public.json, internal.json, and rendered HTML; return paths."""
    out_dir.mkdir(parents=True, exist_ok=True)

    import json

    public_path = out_dir / f"insider-{week_ending}.public.json"
    internal_path = out_dir / f"insider-{week_ending}.internal.json"
    html_path = out_dir / f"insider-{week_ending}.html"

    public_path.write_text(json.dumps(agg["public"], indent=2, default=str))
    internal_path.write_text(json.dumps(agg["internal"], indent=2, default=str))
    html_path.write_text(html)

    return {
        "public_json": str(public_path),
        "internal_json": str(internal_path),
        "html": str(html_path),
    }
