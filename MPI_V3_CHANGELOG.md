# MPI v3 Changelog

Path C: personal use. This file is committed but contents are owner-internal.

## v3.0.0-scaffold — 2026-06-15

Initial scaffold. NOT live in production.

### What changed
- New module `mpi_v3/` with `mpi_v3_engine.py` implementing PCA on z-scored
  sub-indicators followed by a regime-conditional composite.
- Output target: `data/mpi_v3.json` (separate from production `data/mpi.json`
  which still runs v2).
- Feature gate: only computed when `MPI_V3_ENABLED=1`. Production daily
  workflow does NOT set this flag.

### Architecture summary (public)
1. Standardize each of 9 sub-indicators on a rolling 252-day window.
2. Extract the first 3 principal components.
3. Combine PCs with HMM regime probabilities using regime-conditional
   loadings.
4. Squash through logistic to 0-100 range for comparability with v2.

### Data sufficiency (BLOCKING)
Walk-forward validation requires at least 504 days (~2 years) of clean
sub-indicator history. As of 2026-06-15, the accountability ledger has
been recording all 9 sub-indicators since 2026-06-11 — about 4 calendar
days available.

**v3 cannot be deployed until either:**
- ~2 years of fresh history accumulates (estimated calendar reach: 2027-12), OR
- A historical backfill of sub-indicator scores is computed from raw data
  sources for 2024-2026 and ingested into the ledger.

Until then, `compute_v3` returns `status: INSUFFICIENT_DATA` with a
best-effort fallback score (simple mean of current sub-indicators) tagged
as DEGRADED — NOT the real v3 math.

### Validation not yet run
The required validation steps (out-of-sample hit rate vs. realized SPY
return signs; comparison with v2's predictive accuracy) cannot be performed
until sufficient history exists. The scaffold code is structurally complete
but the numbers it would emit today are not trustworthy.

### Internal-only fields
The following are NEVER emitted in any public surface (`data/mpi_v3.json`
or any consumer-readable JSON):
- PCA loadings (which indicators contribute to each PC)
- Regime-conditional PC weights
- Walk-forward training/test split timestamps
- Per-component standardization parameters

These are stripped by `emit_v3_payload()` before serialization.

### Promotion criteria
v3 will move to production (replace v2 on `data/mpi.json`) only when ALL of
the following are true:
1. >= 504 days of clean sub-indicator history exists.
2. Walk-forward out-of-sample hit rate of regime classification vs. realized
   SPY 5-day return sign is documented at >= 60%.
3. v3 has run side-by-side with v2 for >= 30 trading days emitting to
   `data/mpi_v3.json` with no schema or runtime errors.
4. Quant panel re-grades v3 at >= 7.0/10 (vs. v2's 4.1/10).

Until all four are met, v2 stays canonical.
