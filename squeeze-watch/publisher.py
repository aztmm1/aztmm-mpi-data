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
