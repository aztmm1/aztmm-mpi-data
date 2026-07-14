#!/usr/bin/env python3
"""Fallback Daily Pulse publisher (server-side safety net).

Runs on GitHub Actions after the desktop publisher's window (cron 22:45 UTC
Mon-Fri). If today's Daily Pulse is missing from aztmm.com, publishes a
condensed, data-only edition built from the public MPI feed - clearly
labeled as the auto edition, compliance-safe phrasing only.

Requires repo secrets WPCOM_FALLBACK_USER / WPCOM_FALLBACK_APP_PASSWORD
(a WordPress Application Password for aztmm.com). If the post is missing
AND secrets are absent, exits 1 so the run shows red as an alert.
Stdlib only.
"""
import base64
import json
import os
import sys
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
HOLIDAYS_2026 = {"2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
                 "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
                 "2026-11-26", "2026-12-25"}
CATEGORY_DAILY_PULSE = 730419628


def fetch(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    req.add_header("User-Agent", "aztmm-fallback-publisher/1.0")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def build_content(mpi, d):
    data = mpi["data"]
    score = int(data["mpi_score"])
    label = data.get("mpi_label", "")
    regime = data.get("regime_label", "")
    as_of = mpi.get("asOf", "")
    spy = data.get("market", {}).get("spy_spot")
    vix = data.get("volatility", {}).get("vix")
    today = d.strftime("%-d %B %Y")
    as_of_dt = datetime.strptime(as_of, "%Y-%m-%d")
    as_of_label = as_of_dt.strftime("%-d %B %Y")
    strip = (
        '<!-- wp:html --><div class="dp-strip" style="display:flex;justify-content:center;'
        'align-items:center;gap:1.4rem;flex-wrap:wrap;padding:0.85rem 1.1rem;'
        'background:rgba(34,211,238,0.05);border:1px solid rgba(34,211,238,0.22);'
        "border-radius:8px;margin:0 0 1.5rem 0;font-family:'JetBrains Mono',ui-monospace,"
        "'SF Mono',Menlo,monospace;font-size:0.72rem;color:#94a3b8;text-transform:uppercase;"
        'letter-spacing:1.4px;line-height:1.5;">'
        f'<span><span style="color:#64748b;">MPI</span> <strong style="color:#22d3ee;font-weight:700;">{score}</strong></span>'
        f'<span><span style="color:#64748b;">Regime</span> <strong style="color:#c9a961;font-weight:700;">{regime}</strong></span>'
        + (f'<span><span style="color:#64748b;">SPY</span> <strong style="color:#e6e9ff;font-weight:700;">${spy}</strong></span>' if spy else '')
        + (f'<span><span style="color:#64748b;">VIX</span> <strong style="color:#e6e9ff;font-weight:700;">{vix}</strong></span>' if vix else '')
        + f'<span><span style="color:#64748b;">MPI as of</span> <strong style="color:#e6e9ff;">{as_of_label} close</strong></span>'
        '</div><!-- /wp:html -->'
    )
    paras = [
        f'<!-- wp:paragraph --><p><em>{today} - condensed auto edition.</em> '
        'The full desk edition was not available by 6:45 PM ET, so this post was '
        'published automatically from the public data feed. No flow or dark-pool '
        'tables tonight; the composite readings below are the same ones the '
        'pipeline computes after every close. Published automatically, disclosed '
        'automatically - that is the deal.</p><!-- /wp:paragraph -->',
        f'<!-- wp:paragraph --><p>The Market Pulse Index printed <strong>{score}</strong> ({label}) '
        f'with the regime classifier reading <strong>{regime}</strong> as of the {as_of_label} close. '
        'Sub-indicator detail and the confidence band are on the '
        '<a href="/pulse-lab/">Pulse Lab</a>; every published read remains subject to '
        'mechanical scoring in the <a href="/performance-archive/">Accountability Ledger</a> '
        'at +5 and +21 sessions - misses stay on the page.</p><!-- /wp:paragraph -->',
        '<!-- wp:heading {"level":3} --><h3>Method note</h3><!-- /wp:heading -->',
        '<!-- wp:paragraph --><p><em>MPI score and regime classifier are our internal composite, '
        'computed from public market data. This condensed edition was assembled and published '
        'automatically from that feed; no vendor flow data was used.</em></p><!-- /wp:paragraph -->',
        '<!-- wp:paragraph --><p><em>This is research, not advice. Nothing here is a recommendation '
        'to buy, sell, or hold any security.</em></p><!-- /wp:paragraph -->',
        '<!-- wp:paragraph --><p style="font-size:0.8rem;color:#64748b;"><em>AZTMM HLDGS LLC is not '
        'a registered broker-dealer, investment adviser, or FINRA member. All content is retrospective '
        'research published for general circulation - not personalized advice, not trade signals. '
        'Options involve substantial risk, including losses that may exceed the initial investment. '
        'Full <a href="/disclaimer/">disclaimer</a>.</em></p><!-- /wp:paragraph -->',
        '<!-- wp:paragraph --><p style="font-size:0.85rem;color:#94a3b8;"><em>New here? '
        '<a href="/start-here/">Start Here</a> &middot; <a href="/pulse-lab/">Pulse Lab</a> &middot; '
        '<a href="/performance-archive/">Accountability Ledger</a> &middot; '
        '<a href="/trading-academy/">Trading Academy</a></em></p><!-- /wp:paragraph -->',
    ]
    return strip + "".join(paras)


def main():
    now = datetime.now(ET)
    d = now.date()
    if d.weekday() >= 5 or d.strftime("%Y-%m-%d") in HOLIDAYS_2026:
        print("Not a trading day - nothing to do.")
        return 0
    if now.hour < 17:
        print("Too early - refusing to run before 5 PM ET.")
        return 0
    slug = f"daily-pulse-options-flow-dark-pool-{d.day}-{d.strftime('%B').lower()}-{d.year}"
    posts = json.loads(fetch(
        "https://public-api.wordpress.com/wp/v2/sites/aztmm.com/posts"
        "?per_page=20&_fields=slug,link,status"))
    for p in posts:
        if p["slug"] == slug:
            print(f"Daily Pulse already live for {d}: {p.get('link')} - no fallback needed.")
            return 0
    user = os.environ.get("WPCOM_FALLBACK_USER", "")
    pw = os.environ.get("WPCOM_FALLBACK_APP_PASSWORD", "")
    if not user or not pw:
        print("ALERT: today's Daily Pulse is MISSING and publishing secrets are not "
              "configured. Add repo secrets WPCOM_FALLBACK_USER and "
              "WPCOM_FALLBACK_APP_PASSWORD (WordPress Application Password) to enable healing.")
        return 1
    mpi = json.loads(fetch(
        "https://raw.githubusercontent.com/aztmm1/aztmm-mpi-data/main/data/mpi.json?cb="
        + str(int(now.timestamp()))))
    content = build_content(mpi, d)
    title = f"Daily Pulse - Market Snapshot, {d.strftime('%-d %B %Y')} (Condensed Auto Edition)"
    body = json.dumps({
        "title": title,
        "slug": slug,
        "status": "publish",
        "categories": [CATEGORY_DAILY_PULSE],
        "excerpt": "Condensed automatic edition: MPI and regime readings from the public "
                   "data feed. The full desk edition was unavailable tonight - published "
                   "and disclosed automatically.",
        "content": content,
    }).encode()
    auth = base64.b64encode(f"{user}:{pw}".encode()).decode()
    res = json.loads(fetch("https://aztmm.com/wp-json/wp/v2/posts", data=body,
                           headers={"Authorization": "Basic " + auth,
                                    "Content-Type": "application/json"}, method="POST"))
    post_id = res.get("id")
    check = json.loads(fetch(
        f"https://public-api.wordpress.com/wp/v2/sites/aztmm.com/posts/{post_id}"
        "?_fields=status,link,title,content"))
    ok = (check.get("status") == "publish"
          and check.get("title", {}).get("rendered")
          and len(check.get("content", {}).get("rendered", "")) > 1500)
    if not ok:
        print(f"PUBLISHED BUT FAILED VERIFICATION: {json.dumps(check)[:400]}")
        return 1
    print(f"Fallback Daily Pulse published: {check.get('link')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
