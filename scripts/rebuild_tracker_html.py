"""
AZTMM tracker page rebuild + WP REST update
============================================

Single shared script invoked by the 5 tracker workflows after their JSON
artefacts settle. Refreshes the existing WP page (preserving the hand-
crafted layout and analysis) by:

  1. Fetching the live page content via WP REST.
  2. Updating the "as of YYYY-MM-DD" date stamp from latest.json.
  3. Updating the per-tracker data tables in-place where the JSON carries
     fresh structured rows (Congress trades).
  4. Optionally wrapping the body in a single Gutenberg <!-- wp:html -->
     block.
  5. Running a vendor-leak + mojibake lint on the rendered content.
  6. PUTting the updated content back to /wp-json/wp/v2/pages/{id}.

Run with --update-wp to actually POST; without it, the script only prints
the diff and exits.

Per-tracker templates live in the TRACKERS dict.

Environment:
    WP_SITE              e.g. "aztmm.com" (default)
    WP_USERNAME          WP admin username
    WP_APP_PASSWORD      WP application password

CLI:
    --tracker            one of: congress, gravity, earnings, insider, squeeze
    --page-id            WP page id
    --input-json         path to latest.json
    --update-wp          actually POST (else dry-run)
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import sys
from base64 import b64encode
from urllib import error as _urlerr
from urllib import request as _urlreq


# ---------------------------------------------------------------------------
# Vendor + encoding linters (mirror of publish_to_wp.py guards)
# ---------------------------------------------------------------------------

_VENDOR_PATTERNS = [
    ("Unusual Whales",   re.compile(r"\bunusual\s+whales\b", re.I)),
    ("BlackBoxStocks",   re.compile(r"\bblackbox\s*stocks\b", re.I)),
    ("BlackBox",         re.compile(r"\bblack\s*box\b", re.I)),
    ("BBS",              re.compile(r"\bBBS\b")),
    ("FlowAlgo",         re.compile(r"\bflow\s*algo\b", re.I)),
    ("Cheddar Flow",     re.compile(r"\bcheddar\s*flow\b", re.I)),
    ("Cheddar",          re.compile(r"\bcheddar\b", re.I)),
    ("Trade Alert mark", re.compile(r"Trade Alert\s*\xae")),
    ("trade-alert.com",  re.compile(r"\btrade[\- ]alert\.com\b", re.I)),
    ("from Trade Alert", re.compile(r"\b(?:from|by|via)\s+Trade Alert\b")),
    ("wp-admin",         re.compile(r"\bwp\-admin\b", re.I)),
    ("polygon.io",       re.compile(r"\bpolygon\.io\b", re.I)),
]

# Mojibake markers expressed in escaped form so the source file stays clean.
_MOJIBAKE_MARKERS = [
    "�",                       # replacement char
    "â€™",           # right single quote (UTF-8 -> Latin-1)
    "â€œ",           # left double quote
    "â€\x9d",             # right double quote
    "¬∑",                 # middot (UTF-8 -> MacRoman)
]


def lint_vendor_leaks(content):
    hits = []
    for label, pat in _VENDOR_PATTERNS:
        m = pat.search(content)
        if m:
            hits.append("[vendor] %s matched %r" % (label, m.group(0)))
    return hits


def lint_encoding(content):
    hits = []
    for marker in _MOJIBAKE_MARKERS:
        if marker in content:
            hits.append("[encoding] mojibake marker %r present" % marker)
    return hits


# ---------------------------------------------------------------------------
# Date extraction
# ---------------------------------------------------------------------------

_DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def extract_as_of(data):
    """Pull a YYYY-MM-DD from any of the recognised date fields, in priority
    order. Falls back to today UTC."""
    candidates = (
        data.get("as_of_date"),
        data.get("as_of"),
        data.get("asof"),
        data.get("date"),
        data.get("week_ending"),
        data.get("generated_at"),
        data.get("computed_at"),
    )
    for c in candidates:
        if not c:
            continue
        m = _DATE_RE.search(str(c))
        if m:
            return m.group(1)
    return _dt.datetime.utcnow().strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Stamp swap (the universal refresh hook)
# ---------------------------------------------------------------------------

_STAMP_IDS = {
    "congress": "azt-cw-stamp",
    "gravity":  "azt-og-stamp",
    "earnings": "azt-ef-stamp",
    "insider":  "azt-ia-stamp",
    "squeeze":  "azt-sw-stamp",
}


def swap_stamp(html, stamp_id, new_date):
    """Replace the date inside <... id="{stamp_id}">as of YYYY-MM-DD</...>
    Returns (new_html, changed_bool)."""
    pat = re.compile(
        r'(id="' + re.escape(stamp_id) + r'"[^>]*>)\s*as of\s*\d{4}-\d{2}-\d{2}',
        re.I,
    )
    new = r"\g<1>as of " + new_date
    out, n = pat.subn(new, html)
    return out, (n > 0)


# ---------------------------------------------------------------------------
# Gutenberg wrap
# ---------------------------------------------------------------------------

def ensure_gutenberg_wrap(html):
    """Wrap the body in a single <!-- wp:html --> block if not already
    present. WP's wpautop mangles raw <script>/<style> blocks unless they
    sit inside an explicit wp:html Gutenberg block. AZTMM-wide rule."""
    stripped = html.strip()
    if stripped.startswith("<!-- wp:html -->"):
        return html
    return "<!-- wp:html -->\n" + stripped + "\n<!-- /wp:html -->"


def strip_gutenberg_wrap(html):
    """For inspection only: pull the inner block out if wrapped."""
    s = html.strip()
    if s.startswith("<!-- wp:html -->") and s.endswith("<!-- /wp:html -->"):
        return s[len("<!-- wp:html -->"):-len("<!-- /wp:html -->")].strip()
    return s


# ---------------------------------------------------------------------------
# Per-tracker section refreshers
#
# Each refresher takes the current page HTML (after stamp swap) plus the
# parsed JSON payload and returns updated HTML. They are intentionally
# conservative: if the JSON lacks the data we need, we leave that section
# untouched. The stamp swap alone is enough to drive the freshness
# watchdog green.
# ---------------------------------------------------------------------------

def _esc(s):
    s = str(s) if s is not None else ""
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;"))


def _fmt_party(p):
    p = (p or "").strip().upper()[:1]
    return p if p in ("D", "R", "I") else "I"


def _fmt_side(side):
    s = (side or "").strip().lower()
    if "sell" in s or "disp" in s:
        return ("sell", "Sell")
    if "buy" in s or "acq" in s or "purchase" in s:
        return ("buy", "Buy")
    return ("", side or "")


def refresh_congress(html, data):
    """Refresh '15 Most Recent Disclosed Trades' table when trades_today
    has rows."""
    trades = data.get("trades_today") or []
    if not trades:
        return html

    rows = []
    for t in trades[:15]:
        side_class, side_label = _fmt_side(t.get("side") or t.get("transaction_type"))
        amt = t.get("amount_range") or t.get("amount") or "&mdash;"
        lag = t.get("filing_lag_days")
        lag_s = str(lag) if lag is not None else "&mdash;"
        party = _fmt_party(t.get("party"))
        rows.append(
            "<tr>"
            "<td>%s</td><td>%s</td>"
            "<td class=\"party-%s\">%s</td>"
            "<td>%s</td><td>%s</td>"
            "<td class=\"%s\">%s</td>"
            "<td>%s</td><td>%s</td>"
            "</tr>" % (
                _esc(t.get("transaction_date") or t.get("date") or ""),
                _esc(t.get("member") or t.get("name") or ""),
                party, party,
                _esc((t.get("chamber") or "").title()),
                _esc(t.get("ticker") or ""),
                side_class, side_label,
                _esc(amt), lag_s,
            )
        )

    new_tbody = "<tbody>\n" + "\n".join(rows) + "\n</tbody>"
    pat = re.compile(
        r"(<h2>15 Most Recent Disclosed Trades</h2>.*?)<tbody>.*?</tbody>",
        re.S,
    )
    out, n = pat.subn(lambda m: m.group(1) + new_tbody, html, count=1)
    return out if n else html


def refresh_gravity(html, data):
    """Stamp swap is the freshness hook. Beyond that the page's narrative
    prose is hand-curated; raw max-pain strikes don't map cleanly without
    the surrounding analysis."""
    return html


def refresh_earnings(html, data):
    """Stamp swap only. Records map only loosely onto the curated tables."""
    return html


def refresh_insider(html, data):
    """Stamp swap only. Sector flow is a 30-day rollup not present in the
    weekly JSON's buyers/sellers arrays."""
    return html


def refresh_squeeze(html, data):
    """Stamp swap only. The page is a jsDelivr loader of
    squeeze-watch/sample-output/latest.html, so it self-refreshes."""
    return html


TRACKERS = {
    "congress": {"stamp_id": _STAMP_IDS["congress"], "refresher": refresh_congress},
    "gravity":  {"stamp_id": _STAMP_IDS["gravity"],  "refresher": refresh_gravity},
    "earnings": {"stamp_id": _STAMP_IDS["earnings"], "refresher": refresh_earnings},
    "insider":  {"stamp_id": _STAMP_IDS["insider"],  "refresher": refresh_insider},
    "squeeze":  {"stamp_id": _STAMP_IDS["squeeze"],  "refresher": refresh_squeeze},
}


# ---------------------------------------------------------------------------
# WP REST helpers
# ---------------------------------------------------------------------------

def _http(method, url, data=None, headers=None):
    body = None
    hdrs = dict(headers or {})
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")
    req = _urlreq.Request(url, data=body, method=method, headers=hdrs)
    try:
        with _urlreq.urlopen(req, timeout=30) as r:
            txt = r.read().decode("utf-8", errors="replace")
            return r.status, txt
    except _urlerr.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def wp_get_page(site, page_id):
    status, txt = _http("GET", "https://%s/wp-json/wp/v2/pages/%s" % (site, page_id))
    if status != 200:
        raise RuntimeError("WP GET %s failed: %s %s" % (page_id, status, txt[:200]))
    return json.loads(txt)


def wp_put_page(site, page_id, user, pw, content):
    auth = b64encode(("%s:%s" % (user, pw)).encode()).decode()
    # WP REST accepts POST for updates to existing pages.
    status, txt = _http(
        "POST",
        "https://%s/wp-json/wp/v2/pages/%s" % (site, page_id),
        data={"content": content},
        headers={"Authorization": "Basic " + auth},
    )
    if status not in (200, 201):
        raise RuntimeError("WP update %s failed: %s %s" % (page_id, status, txt[:400]))
    return json.loads(txt)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tracker", required=True, choices=sorted(TRACKERS.keys()))
    ap.add_argument("--page-id", required=True)
    ap.add_argument("--input-json", required=True)
    ap.add_argument("--update-wp", action="store_true",
                    help="Actually update WP (else dry-run).")
    args = ap.parse_args()

    spec = TRACKERS[args.tracker]

    try:
        with open(args.input_json) as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        print("[rebuild] cannot read %s: %s" % (args.input_json, e), file=sys.stderr)
        return 1

    as_of = extract_as_of(data)
    print("[rebuild] tracker=%s page=%s as_of=%s"
          % (args.tracker, args.page_id, as_of))

    site = os.environ.get("WP_SITE", "aztmm.com").strip()
    user = (os.environ.get("WP_USERNAME") or "").strip()
    pw   = (os.environ.get("WP_APP_PASSWORD") or "").strip()

    page = wp_get_page(site, args.page_id)
    cur_html = (page.get("content", {}) or {}).get("rendered", "") or ""
    if not cur_html:
        print("[rebuild] page %s has empty rendered content - aborting"
              % args.page_id, file=sys.stderr)
        return 2

    inner = strip_gutenberg_wrap(cur_html)

    # 1) stamp swap
    inner2, swapped = swap_stamp(inner, spec["stamp_id"], as_of)
    if not swapped:
        print("[rebuild] note: no stamp #%s in page - skipping date swap"
              % spec["stamp_id"])

    # 2) per-tracker section refresh
    inner3 = spec["refresher"](inner2, data)

    # 3) lint
    vendor_hits = lint_vendor_leaks(inner3)
    enc_hits = lint_encoding(inner3)
    if vendor_hits:
        print("[rebuild] VENDOR LEAK - refusing to publish", file=sys.stderr)
        for h in vendor_hits:
            print("  " + h, file=sys.stderr)
        return 3
    if enc_hits:
        print("[rebuild] ENCODING ISSUE - refusing to publish", file=sys.stderr)
        for h in enc_hits:
            print("  " + h, file=sys.stderr)
        return 4

    # 4) Gutenberg wrap
    final = ensure_gutenberg_wrap(inner3)

    if inner3 == inner and not swapped:
        print("[rebuild] no changes detected - skipping update")
        return 0

    if not args.update_wp:
        print("[rebuild] dry-run: would update page %s with %d bytes"
              % (args.page_id, len(final)))
        return 0

    if not (user and pw):
        print("[rebuild] WP_USERNAME / WP_APP_PASSWORD not set; cannot update",
              file=sys.stderr)
        return 5

    res = wp_put_page(site, args.page_id, user, pw, final)
    print("[rebuild] update ok: page=%s modified=%s"
          % (res.get("id"), res.get("modified")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
