"""
MPI v3 Engine — Regime-Conditional PCA Composite (SCAFFOLD)
============================================================

PRIVATE / INTERNAL: This module is feature-gated and does NOT affect production
`data/mpi.json`. It emits to `data/mpi_v3.json` only.

Path C: personal use, no live consumers.

Architecture
------------
v2 (current production):
    mpi = sum(w_i * s_i for i in 9 sub-indicators), weights hardcoded.
    Problems (per internal quant panel, 4.1/10):
      - Weighted-sum is not stationary across regimes
      - Weights are opaque (no validation)
      - Correlation with realized SPY outcomes unknown

v3 (this module):
    1. Z-score normalize each of the 9 sub-indicators on a rolling 252-day window.
    2. Run PCA on the standardized matrix; keep the first 2-3 PCs.
       Typical interpretation:
         PC1 ≈ "risk on/off" (trend + breadth dominant)
         PC2 ≈ "growth-vs-value rotation" (rotation + yield_curve dominant)
         PC3 ≈ "defensive cluster" (volatility + credit + currency)
    3. Use HMM regime probs to compute a CONDITIONAL composite:
         score = p_bull * f_bull(PCs) + p_side * f_side(PCs) + p_bear * f_bear(PCs)
       Each f_regime is calibrated walk-forward to maximize predictive validity
       (next-N-day SPY return sign correlation) within that regime's samples.
    4. Walk-forward validation: train on first 60% of clean history, test on
       rolling out-of-sample windows.

Data sufficiency
----------------
Walk-forward validation requires AT LEAST 504 days (~2 years) of clean
sub-indicator history. As of 2026-06-15, the ledger only started recording
all 9 sub-indicators on 2026-06-11 — about 4 calendar days of data. v3
math can be implemented now (this file), but actual DEPLOYMENT must wait
until ~2027-12 at the earliest, or until a backfill of historical
sub-indicators is performed.

Until enough data exists, this module emits:
    {
      "status": "INSUFFICIENT_DATA",
      "days_available": <N>,
      "days_required":  504,
      "note": "v3 needs more history — scaffold only"
    }

Feature gate
------------
Run only when env var MPI_V3_ENABLED=1 is set. The production daily workflow
does NOT set this. To produce a side-by-side v3 estimate, run manually:
    MPI_V3_ENABLED=1 python -m mpi_v3.mpi_v3_engine

Versioned changelog: see methodology/MPI_V3_CHANGELOG.md.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import numpy as np
except ImportError:
    np = None

try:
    from numpy.linalg import eigh
    _HAS_LINALG = True
except ImportError:
    _HAS_LINALG = False


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

V3_SCHEMA_VERSION = "3.0.0-scaffold"
SUB_INDICATORS: Tuple[str, ...] = (
    "trend",
    "breadth",
    "volatility",
    "yield_curve",
    "credit",
    "sentiment",
    "rotation",
    "currency",
    "liquidity",
)

ROLLING_WINDOW = 252  # days for z-score normalization (1 trading year)
WALK_FORWARD_TRAIN_FRAC = 0.60
MIN_HISTORY_FOR_DEPLOYMENT = 504  # ~2 years
N_PCS_TARGET = 3

LEDGER_DEFAULT_PATH = "accountability-ledger/sample-output/ledger.jsonl"


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class SubIndicatorHistory:
    """Loaded history of all 9 sub-indicator scores over time."""
    dates: List[str] = field(default_factory=list)
    # Shape: dates × sub_indicators. Stored as list-of-lists; convert to ndarray on use.
    matrix: List[List[float]] = field(default_factory=list)

    @property
    def n_days(self) -> int:
        return len(self.dates)

    def as_array(self):
        if np is None:
            raise RuntimeError("numpy required for matrix ops")
        return np.array(self.matrix, dtype=float)


@dataclass
class PCAResult:
    """Output of PCA on z-scored sub-indicator matrix."""
    loadings: List[List[float]]  # (n_pcs × n_indicators) — INTERNAL ONLY
    explained_variance_ratio: List[float]
    scores: List[List[float]]    # (n_days × n_pcs) — projected data
    n_pcs: int


@dataclass
class V3Score:
    """Final v3 composite estimate."""
    score: float                 # 0..100 scale, same as v2 for comparability
    status: str                  # "OK" | "INSUFFICIENT_DATA" | "DEGRADED"
    pc_projections: Dict[str, float]
    regime_weighting: Dict[str, float]  # used probs at scoring time
    diagnostics: Dict[str, Any]


# ---------------------------------------------------------------------------
# History loader
# ---------------------------------------------------------------------------

def load_sub_indicator_history(path: Optional[Path] = None) -> SubIndicatorHistory:
    """Load the accountability ledger (JSONL) and extract sub-indicator scores
    per day. Returns an empty history if the file is missing or malformed —
    v3 logic handles INSUFFICIENT_DATA gracefully downstream.
    """
    h = SubIndicatorHistory()
    if path is None:
        path = Path(LEDGER_DEFAULT_PATH)
    if not path.exists():
        return h
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        d = row.get("date") or row.get("asOf") or row.get("as_of")
        subs = row.get("sub_indicators") or row.get("data", {}).get("sub_indicators")
        if not (d and isinstance(subs, dict)):
            continue
        try:
            vec = [float(subs[k]["score"]) for k in SUB_INDICATORS]
        except (KeyError, TypeError, ValueError):
            # missing or malformed — skip this day
            continue
        h.dates.append(d)
        h.matrix.append(vec)
    return h


# ---------------------------------------------------------------------------
# PCA (no sklearn dependency — uses numpy eigh)
# ---------------------------------------------------------------------------

def _rolling_zscore(arr, window: int = ROLLING_WINDOW):
    """Z-score each column over a rolling window. Drops the warmup rows."""
    if np is None:
        raise RuntimeError("numpy required")
    n, k = arr.shape
    if n < window + 1:
        # Not enough rows — return centered/scaled by full-sample stats instead.
        mu = arr.mean(axis=0)
        sd = arr.std(axis=0, ddof=1)
        sd = np.where(sd < 1e-9, 1.0, sd)
        return (arr - mu) / sd, 0
    out = np.full_like(arr, np.nan)
    for i in range(window, n):
        w = arr[i - window:i, :]
        mu = w.mean(axis=0)
        sd = w.std(axis=0, ddof=1)
        sd = np.where(sd < 1e-9, 1.0, sd)
        out[i] = (arr[i] - mu) / sd
    # Drop warmup rows
    mask = ~np.isnan(out).any(axis=1)
    return out[mask], window


def compute_pca(zmat, n_pcs: int = N_PCS_TARGET) -> PCAResult:
    """PCA via eigendecomposition of the covariance matrix."""
    if np is None or not _HAS_LINALG:
        raise RuntimeError("numpy.linalg required for PCA")
    if zmat.shape[0] < 2:
        raise ValueError("need >= 2 rows for PCA")
    cov = np.cov(zmat, rowvar=False, ddof=1)
    eigvals, eigvecs = eigh(cov)  # ascending
    # Sort descending
    order = np.argsort(eigvals)[::-1]
    eigvals = eigvals[order]
    eigvecs = eigvecs[:, order]
    k = min(n_pcs, len(eigvals))
    loadings = eigvecs[:, :k].T  # (n_pcs, n_indicators)
    evr_total = float(eigvals.sum())
    evr = (eigvals[:k] / evr_total).tolist() if evr_total > 0 else [0.0] * k
    scores = zmat @ eigvecs[:, :k]  # project all rows
    return PCAResult(
        loadings=loadings.tolist(),
        explained_variance_ratio=evr,
        scores=scores.tolist(),
        n_pcs=k,
    )


# ---------------------------------------------------------------------------
# Regime-conditional composite
# ---------------------------------------------------------------------------

# Initial REGIME WEIGHTS over PCs — placeholder until walk-forward calibration.
# Sign convention: positive PC scores mean "risk-on", so bull regime weights
# PC1 positively. Bear regime inverts. Sideways relies more on PC2.
INITIAL_REGIME_PC_WEIGHTS = {
    "Bull":     [+0.70, +0.20, +0.10],
    "Sideways": [+0.30, +0.50, +0.20],
    "Bear":     [-0.60, +0.10, +0.30],
}


def regime_weighted_composite(
    pc_today: List[float],
    regime_probs: Dict[str, float],
    pc_weights: Optional[Dict[str, List[float]]] = None,
) -> float:
    """Combine today's PC projection with HMM regime probs into a 0..100 score.
    Returns a value compatible with v2's mpi_score range.
    """
    if pc_weights is None:
        pc_weights = INITIAL_REGIME_PC_WEIGHTS
    raw = 0.0
    for regime, p in regime_probs.items():
        w = pc_weights.get(regime, [0.0, 0.0, 0.0])
        for i, pc in enumerate(pc_today[: len(w)]):
            raw += p * w[i] * pc
    # Squash via logistic to (0..1), then scale to 0..100.
    # Tuning constant 0.5 chosen so |raw|~3 -> score~80 (i.e., 3-sigma move
    # in PC1 = strongly bullish). Will be recalibrated post walk-forward.
    import math
    sig = 1.0 / (1.0 + math.exp(-0.5 * raw))
    return round(100.0 * sig)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def compute_v3(
    history: Optional[SubIndicatorHistory] = None,
    current_subs: Optional[Dict[str, float]] = None,
    regime_probs: Optional[Dict[str, float]] = None,
    ledger_path: Optional[Path] = None,
) -> V3Score:
    """End-to-end v3 score for the current observation.

    Returns INSUFFICIENT_DATA if history is too short for walk-forward validation.
    Always emits a "best-effort score" alongside so v3 can be compared to v2
    even during the data accumulation phase.
    """
    if history is None:
        history = load_sub_indicator_history(ledger_path)

    n = history.n_days
    if n < MIN_HISTORY_FOR_DEPLOYMENT:
        diag = {
            "days_available":  n,
            "days_required":   MIN_HISTORY_FOR_DEPLOYMENT,
            "earliest_date":   history.dates[0] if history.dates else None,
            "latest_date":     history.dates[-1] if history.dates else None,
            "deployment_estimate_calendar_days": max(0, MIN_HISTORY_FOR_DEPLOYMENT - n) * 1.4,
        }
        # Best-effort scoring fallback: simple average of current sub-indicators
        # (gives a sanity-check value but is NOT v3 math; flagged as DEGRADED).
        best_effort = None
        if current_subs:
            try:
                vals = [float(current_subs[k]["score"]) if isinstance(current_subs[k], dict) else float(current_subs[k]) for k in SUB_INDICATORS]
                best_effort = round(sum(vals) / len(vals))
            except Exception:
                best_effort = None
        return V3Score(
            score=best_effort if best_effort is not None else 0,
            status="INSUFFICIENT_DATA",
            pc_projections={},
            regime_weighting=regime_probs or {},
            diagnostics=diag,
        )

    # ---- Sufficient data path ----
    arr = history.as_array()
    zmat, warmup = _rolling_zscore(arr, window=ROLLING_WINDOW)
    pca = compute_pca(zmat, n_pcs=N_PCS_TARGET)
    # Today's projection
    pc_today = pca.scores[-1] if pca.scores else [0.0] * N_PCS_TARGET
    rp = regime_probs or {"Bull": 0.33, "Sideways": 0.34, "Bear": 0.33}
    score = regime_weighted_composite(pc_today, rp)
    return V3Score(
        score=score,
        status="OK",
        pc_projections={f"PC{i+1}": round(pc, 4) for i, pc in enumerate(pc_today)},
        regime_weighting=rp,
        diagnostics={
            "n_history_days":           n,
            "warmup_rows_dropped":      warmup,
            "explained_variance_ratio": pca.explained_variance_ratio,
            "n_pcs_retained":           pca.n_pcs,
            # Loadings are INTERNAL — strip before any public emission.
            "_loadings_internal":       pca.loadings,
        },
    )


def emit_v3_payload(
    v3: V3Score,
    asOf: str,
    computed_at: Optional[str] = None,
    v2_score: Optional[int] = None,
) -> Dict[str, Any]:
    """Build the JSON payload to write to data/mpi_v3.json.
    Strips internal-only fields (loadings, etc.) from the public surface.
    """
    if computed_at is None:
        computed_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    diagnostics_public = {k: v for k, v in v3.diagnostics.items() if not k.startswith("_")}
    return {
        "schema_version": V3_SCHEMA_VERSION,
        "computed_at":    computed_at,
        "asOf":           asOf,
        "engine":         "mpi_v3",
        "status":         v3.status,
        "mpi_v3_score":   v3.score,
        "v2_score":       v2_score,
        "pc_projections": v3.pc_projections,
        "regime_weighting": v3.regime_weighting,
        "diagnostics":    diagnostics_public,
        "note":           "v3 SCAFFOLD — not promoted to production until walk-forward validation passes and history >= 504 days.",
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    enabled = os.environ.get("MPI_V3_ENABLED", "") == "1"
    if not enabled:
        print("MPI v3 disabled. Set MPI_V3_ENABLED=1 to compute.", file=sys.stderr)
        return 0
    if np is None:
        print("numpy not installed — cannot run v3.", file=sys.stderr)
        return 2
    ledger_path = Path(os.environ.get("MPI_V3_LEDGER_PATH", LEDGER_DEFAULT_PATH))
    history = load_sub_indicator_history(ledger_path)
    # In the workflow, current_subs + regime_probs would come from the v2 run.
    # Here we just emit the INSUFFICIENT_DATA branch for now.
    v3 = compute_v3(history=history)
    asOf = os.environ.get("MPI_V3_ASOF") or (history.dates[-1] if history.dates else datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    payload = emit_v3_payload(v3, asOf=asOf)
    out_path = Path(os.environ.get("MPI_V3_OUTPUT", "data/mpi_v3.json"))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2))
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
