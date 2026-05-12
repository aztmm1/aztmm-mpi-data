"""
AZTMM Squeeze Watch — aggregator

Composite score per ticker = weighted average of five normalised components.
Internal-only; the weights and component scores never appear in the public
JSON. Public output gets composite buckets (Elevated / Notable / Watching)
plus observation-language commentary for the top 3.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("squeeze.aggregator")

ROOT = Path(__file__).parent
CONFIG_PATH = ROOT / "config.yml"


def _load_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _clamp01(x: float) -> float:
    if x < 0:
        return 0.0
    if x > 1:
        return 1.0
    return x


def _norm(value: float, cap: float) -> float:
    """Normalise a non-negative value against an upper cap."""
    if cap <= 0:
        return 0.0
    return _clamp01(value / cap)


def _norm_neg_gex(gex: float, neg_cap: float) -> float:
    """Negative GEX = dealers short gamma = amplification context.
    Returns 0 if GEX is positive (dampening), scales 0->1 as GEX goes
    from 0 to the configured negative cap (more negative = closer to 1)."""
    if gex >= 0:
        return 0.0
    if neg_cap >= 0:
        return 0.0
    return _clamp01(gex / neg_cap)


def _fmt_pct(x: float, digits: int = 1) -> str:
    return f"{x:.{digits}f}%"


def _fmt_ratio(x: float, digits: int = 2) -> str:
    return f"{x:.{digits}f}x"


def _fmt_int(x: int | float) -> str:
    return f"{int(x):,}"


def _fmt_premium(x: float) -> str:
    """Format dollar amounts compactly."""
    sign = "-" if x < 0 else ""
    a = abs(x)
    if a >= 1e9:
        return f"{sign}${a/1e9:.2f}B"
    if a >= 1e6:
        return f"{sign}${a/1e6:.1f}M"
    if a >= 1e3:
        return f"{sign}${a/1e3:.1f}K"
    return f"{sign}${a:.0f}"


# ---------------------------------------------------------------------------
# Per-ticker scoring
# ---------------------------------------------------------------------------

def score_ticker(slices: dict, cfg: dict) -> dict:
    """Returns an internal-only score record for one ticker."""
    norm_cfg = cfg["normalisation"]
    weights = cfg["score_weights"]

    short = slices.get("short_interest", {}) or {}
    flow = slices.get("flow_alerts", {}) or {}
    vol = slices.get("short_volume_ratio", {}) or {}
    gex = slices.get("greek_exposure", {}) or {}
    info = slices.get("info", {}) or {}

    si_pct = float(short.get("short_interest_pct_float") or 0.0)
    dtc = float(short.get("days_to_cover") or 0.0)
    # Recent options activity ratio: use alert_count as a proxy for
    # "today's options activity vs typical"; we don't have a precise
    # 30-day moving baseline cheaply, so use call/put alert mix
    # plus alert count as separate components.
    alert_count = int(flow.get("alert_count") or 0)
    cp_ratio = float(flow.get("call_put_alert_ratio") or 0.0)
    net_gex = float(gex.get("net_gex") or 0.0)

    # Crude proxy for "options_volume_ratio": rescale alert count.
    # 0 alerts -> 0; 50 alerts -> 1.0. Conservative.
    options_vol_proxy = _clamp01(alert_count / 50.0)

    # Cap obvious data glitches (some historical rows have absurd values)
    si_pct = min(si_pct, 100.0)
    dtc = min(dtc, 30.0)

    n_si = _norm(si_pct, norm_cfg["short_interest_pct_cap"])
    n_dtc = _norm(dtc, norm_cfg["days_to_cover_cap"])
    n_opt = _clamp01(options_vol_proxy)
    n_cp = _norm(cp_ratio, norm_cfg["call_put_ratio_cap"])
    n_gex = _norm_neg_gex(net_gex, norm_cfg["gex_negative_cap"])

    composite = (
        weights["short_interest_pct_float"] * n_si
        + weights["days_to_cover"]            * n_dtc
        + weights["options_volume_ratio"]     * n_opt
        + weights["call_put_volume_ratio"]    * n_cp
        + weights["gamma_context"]            * n_gex
    )

    return {
        "ticker": info.get("ticker"),
        "sector": info.get("sector"),
        "marketcap": info.get("marketcap"),
        "avg30_volume": info.get("avg30_volume"),
        # raw values
        "short_interest_pct_float": si_pct,
        "days_to_cover": dtc,
        "alert_count": alert_count,
        "call_alert_count": flow.get("call_alert_count", 0),
        "put_alert_count": flow.get("put_alert_count", 0),
        "call_put_alert_ratio": cp_ratio,
        "net_gex": net_gex,
        "short_volume_ratio": vol.get("short_volume_ratio"),
        # internal normalised components
        "_n_si": n_si,
        "_n_dtc": n_dtc,
        "_n_opt": n_opt,
        "_n_cp": n_cp,
        "_n_gex": n_gex,
        "_composite": composite,
    }


def bucket(composite: float) -> str:
    """User-visible band label. Strictly non-advisory wording."""
    if composite >= 0.55:
        return "Elevated"
    if composite >= 0.35:
        return "Notable"
    return "Watching"


def commentary_for(record: dict) -> str:
    """One-line observation per top-3 ticker. Pure observation language."""
    ticker = record["ticker"]
    si = record["short_interest_pct_float"]
    dtc = record["days_to_cover"]
    cp = record["call_put_alert_ratio"]
    n_gex = record["_n_gex"]

    flow_phrase: str
    if cp >= 2.0 and record.get("alert_count", 0) >= 5:
        flow_phrase = "lopsided call-side options interest in tonight's flow"
    elif cp >= 1.5:
        flow_phrase = "call-leaning options interest"
    elif record.get("alert_count", 0) >= 10:
        flow_phrase = "active options interest on both sides"
    else:
        flow_phrase = "modest options interest"

    gex_phrase = ""
    if n_gex >= 0.3:
        gex_phrase = " Dealer positioning context is one that can amplify moves either direction."

    return (
        f"{ticker} shows roughly {si:.1f}% of float reported short with about "
        f"{dtc:.1f} days to cover, and {flow_phrase}. The combination is "
        f"notable.{gex_phrase}"
    )


# ---------------------------------------------------------------------------
# Public/internal output builders
# ---------------------------------------------------------------------------

def aggregate(bundle: dict, cfg: dict | None = None) -> dict:
    """Build the dual-output structure: {public, internal}."""
    cfg = cfg or _load_config()

    records: list[dict] = []
    for ticker, slices in bundle["tickers"].items():
        try:
            rec = score_ticker(slices, cfg)
            if rec["ticker"]:
                records.append(rec)
        except Exception as e:  # noqa: BLE001
            logger.warning("score %s failed: %s", ticker, e)

    records.sort(key=lambda r: r["_composite"], reverse=True)

    top_public_n = cfg["output"]["public_top_n"]
    top_internal_n = cfg["output"]["internal_top_n"]
    top_commentary_n = cfg["output"]["commentary_top_n"]

    # ---- Public (scrubbed) ----
    public_rows: list[dict] = []
    for r in records[:top_public_n]:
        public_rows.append({
            "ticker": r["ticker"],
            "sector": r["sector"],
            "short_interest_pct_float_fmt": _fmt_pct(r["short_interest_pct_float"]),
            "days_to_cover_fmt": f"{r['days_to_cover']:.1f}",
            "call_put_ratio_fmt": _fmt_ratio(r["call_put_alert_ratio"]),
            "alert_count": r["alert_count"],
            "band": bucket(r["_composite"]),
        })

    commentary: list[str] = []
    for r in records[:top_commentary_n]:
        commentary.append(commentary_for(r))

    elevated_today = sum(1 for r in public_rows if r["band"] == "Elevated")

    public = {
        "date": bundle["date"],
        "as_of": f"{bundle['date']} 5:00 PM ET",
        "summary_line": _public_summary_line(records, top_public_n),
        "rows": public_rows,
        "commentary": commentary,
        "names_evaluated": len(records),
        "names_filtered_out": len(bundle["data_quality"]["tickers_filtered"]),
        "data_quality_degraded": bundle["data_quality"]["endpoints_failed"] > bundle["data_quality"]["endpoints_ok"],
        "headline_metric": {
            "label": "Elevated band names",
            "value": elevated_today,
        },
    }

    # ---- Internal (raw + composite + components) ----
    internal_rows: list[dict] = []
    for r in records[:top_internal_n]:
        internal_rows.append({
            "ticker": r["ticker"],
            "sector": r["sector"],
            "marketcap": r["marketcap"],
            "avg30_volume": r["avg30_volume"],
            "short_interest_pct_float": r["short_interest_pct_float"],
            "days_to_cover": r["days_to_cover"],
            "alert_count": r["alert_count"],
            "call_alert_count": r["call_alert_count"],
            "put_alert_count": r["put_alert_count"],
            "call_put_alert_ratio": r["call_put_alert_ratio"],
            "short_volume_ratio": r["short_volume_ratio"],
            "net_gex": r["net_gex"],
            "components": {
                "n_short_interest": r["_n_si"],
                "n_days_to_cover": r["_n_dtc"],
                "n_options_activity": r["_n_opt"],
                "n_call_put_ratio": r["_n_cp"],
                "n_gamma_context": r["_n_gex"],
            },
            "composite": r["_composite"],
            "band": bucket(r["_composite"]),
        })

    internal = {
        "date": bundle["date"],
        "as_of": f"{bundle['date']} 5:00 PM ET",
        "scoring_weights": cfg["score_weights"],
        "normalisation_caps": cfg["normalisation"],
        "rows": internal_rows,
        "filtered_tickers": bundle["data_quality"]["tickers_filtered"],
        "data_quality": bundle["data_quality"],
        "names_evaluated": len(records),
    }

    return {"public": public, "internal": internal}


def _public_summary_line(records: list[dict], top_n: int) -> str:
    elev = sum(1 for r in records[:top_n] if bucket(r["_composite"]) == "Elevated")
    notable = sum(1 for r in records[:top_n] if bucket(r["_composite"]) == "Notable")
    watch = sum(1 for r in records[:top_n] if bucket(r["_composite"]) == "Watching")
    parts = []
    if elev:
        parts.append(f"{elev} elevated")
    if notable:
        parts.append(f"{notable} notable")
    if watch:
        parts.append(f"{watch} watching")
    if not parts:
        return "Tonight's screen turned up no names with the combination of elevated short pressure and options interest."
    return (
        "Names that turned up in tonight's screen for elevated short pressure "
        "alongside options interest: " + ", ".join(parts) + "."
    )


if __name__ == "__main__":
    import json, sys, argparse
    p = argparse.ArgumentParser()
    p.add_argument("--bundle", required=True)
    args = p.parse_args()
    with open(args.bundle) as f:
        bundle = json.load(f)
    out = aggregate(bundle)
    json.dump(out, sys.stdout, indent=2, default=str)
