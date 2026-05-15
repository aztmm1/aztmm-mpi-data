"""
AZTMM Congress Watch - House Clerk runner
==========================================
PATH A LOCKED 2026-05-15.

Drives the new house_clerk_fetcher end-to-end. Emits the same artifacts
the old UW pipeline did:
  publish-artifacts/congress-{YYYY-MM-DD}.public.json
  publish-artifacts/congress-{YYYY-MM-DD}.html         (Jinja-rendered body)
  publish-artifacts/congress-{YYYY-MM-DD}-wp-payload.json
  publish-artifacts/payload.json                       (pointer for old workflow)
And copies the latest pair to:
  sample-output/latest.json
  sample-output/latest.html

Idempotent on --date.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import logging
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from house_clerk_fetcher import run as fetcher_run

try:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
except ImportError:
    print("ERROR: jinja2 not installed. pip install -r requirements.txt", file=sys.stderr)
    sys.exit(2)

LOG = logging.getLogger("congress.runner")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _is_market_day(d: datetime) -> bool:
    return d.weekday() < 5


def _alias_for_template(public: dict) -> dict:
    """Convert fetcher's public.json into the shape the existing
    dashboard.html.j2 expects (keys: name, direction, amount_band, ownership,
    transaction_date, filing_lag_days)."""

    def alias_trade(t: dict) -> dict:
        action = t.get("action", "")
        direction = (
            "Purchase" if action == "acquisition"
            else "Sale" if action == "disposition"
            else "Exchange" if action == "exchange"
            else "Other"
        )
        try:
            td = datetime.strptime(t.get("txn_date", ""), "%Y-%m-%d")
            nd = datetime.strptime(t.get("notification_date", ""), "%Y-%m-%d")
            lag = (nd - td).days
        except Exception:
            lag = None
        return {
            "name": t.get("member", ""),
            "chamber": t.get("chamber", "House"),
            "ticker": t.get("ticker", ""),
            "sector": t.get("sector", "Other"),
            "direction": direction,
            "amount_band": t.get("amount_range", ""),
            "ownership": "Self",  # House Clerk PDF parser doesn't reliably extract this yet
            "transaction_date": t.get("txn_date", ""),
            "filing_lag_days": lag,
        }

    def alias_active(m: dict) -> dict:
        return {"name": m.get("member", ""), "filings": m.get("filings", 0),
                "chamber": m.get("chamber", "House")}

    out = dict(public)
    out["trades_today"] = [alias_trade(t) for t in public.get("trades_today", [])]
    out["most_active_today"] = [alias_active(m) for m in public.get("most_active_today", [])]
    notable = dict(public.get("notable", {}))
    notable["large_filings"] = [alias_trade(t) for t in notable.get("large_filings", [])]
    notable["late_filings"] = [alias_trade(t) for t in notable.get("late_filings", [])]
    out["notable"] = notable
    out["headline_metric_label"] = public.get("headline_metric", {}).get("label", "Filings filed today")
    return out


def _sparkline(history_path: Path, today: str) -> dict:
    """Build a tiny 30-day sparkline context from data/history.json.
    Falls back to a placeholder when history is empty/missing."""
    placeholder = {
        "sparkline_available": False,
        "sparkline_placeholder": "Trend will appear once a few daily snapshots accumulate.",
    }
    if not history_path.exists():
        return placeholder
    try:
        hist = json.loads(history_path.read_text())
    except Exception:
        return placeholder
    entries = hist.get("entries") or []
    pts = []
    for e in entries[-30:]:
        try:
            pts.append((e["date"], int(e.get("filings_today", 0))))
        except Exception:
            continue
    if len(pts) < 2:
        return placeholder
    xs = list(range(len(pts)))
    ys = [p[1] for p in pts]
    ymax = max(ys) if ys else 0
    ymin = min(ys) if ys else 0
    span = (ymax - ymin) or 1
    poly = " ".join(
        f"{(x * (600 / max(1, len(pts) - 1))):.2f},{(80 - 1 - 78 * (y - ymin) / span):.2f}"
        for x, y in zip(xs, ys)
    )
    return {
        "sparkline_available": True,
        "sparkline_polyline": poly,
        "sparkline_first_date": pts[0][0],
        "sparkline_last_date": pts[-1][0],
        "sparkline_latest_value": pts[-1][1],
    }


def _update_history(history_path: Path, today: str, filings_today: int) -> None:
    history_path.parent.mkdir(parents=True, exist_ok=True)
    if history_path.exists():
        try:
            hist = json.loads(history_path.read_text())
        except Exception:
            hist = {"entries": []}
    else:
        hist = {"entries": []}
    entries = hist.get("entries") or []
    entries = [e for e in entries if e.get("date") != today]
    entries.append({"date": today, "filings_today": filings_today})
    entries.sort(key=lambda e: e["date"])
    hist["entries"] = entries[-90:]
    hist["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    history_path.write_text(json.dumps(hist, indent=2))


def render(public: dict, template_path: Path) -> str:
    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    tmpl = env.get_template(template_path.name)
    return tmpl.render(**public)


def build_wp_payload(html: str, today: str, force_publish: bool = False) -> dict:
    return {
        "page_id": 2624,
        "slug": "congress-watch",
        "title": "Congress Watch",
        "status": "publish" if force_publish else "draft",
        "content": "<!-- wp:html -->\n" + html.strip() + "\n<!-- /wp:html -->",
        "as_of_date": today,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None)
    ap.add_argument("--max-filings", type=int, default=50)
    ap.add_argument("--out-dir", default=str(ROOT / "publish-artifacts"))
    ap.add_argument("--force-publish", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    today = args.date or _today_utc()
    d = datetime.strptime(today, "%Y-%m-%d")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Run fetch -> aggregate (writes public.json into out_dir)
    public = fetcher_run(today=today, max_filings=args.max_filings, out_dir=str(out_dir))

    # History + sparkline
    history_path = ROOT / "data" / "history.json"
    _update_history(history_path, today, public["summary"]["filings_today"])
    spark = _sparkline(history_path, today)

    # Alias keys for template + add sparkline + headline label
    ctx = _alias_for_template(public)
    ctx.update(spark)

    # Render HTML
    template_path = ROOT / "dashboard.html.j2"
    html = render(ctx, template_path)
    html_path = out_dir / f"congress-{today}.html"
    html_path.write_text(html)

    # WP payload
    wp_payload = build_wp_payload(html, today, force_publish=args.force_publish)
    wp_path = out_dir / f"congress-{today}-wp-payload.json"
    wp_path.write_text(json.dumps(wp_payload, indent=2))

    # Pointer file (compat with old workflow's commit step)
    pointer = {
        "date": today,
        "filings_today": public["summary"]["filings_today"],
        "generated_at": public["generated_at"],
        "source": "house-clerk-ptr",
    }
    (out_dir / "payload.json").write_text(json.dumps(pointer, indent=2))

    # Print machine-readable summary for the workflow
    print(json.dumps({
        "status": "payload_emitted",
        "date": today,
        "filings_today": public["summary"]["filings_today"],
        "generated_at": public["generated_at"],
        "html": str(html_path),
        "public": str(out_dir / f"congress-{today}.public.json"),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
