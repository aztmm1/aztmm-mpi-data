# AZTMM Versioning (Tier 1B)

Every promote-to-publish writes an immutable version snapshot. Every post-publish
edit appends a correction event with a materiality classification.

## Components

| File | Purpose |
|------|---------|
| `../aztmm-daily-pulse-v2/publish_to_wp.py` | `write_version_metadata()` runs after `promote_to_publish()` succeeds. Writes WP custom post meta + repo manifest. |
| `detect_corrections.py` | Daily 02:00 UTC sweep. Compares current WP content hash to stored hash, classifies, appends to manifest, updates WP meta. |
| `detect-corrections.yml` | GH Actions workflow. Copy to `.github/workflows/`. |
| `cf_worker_corrections_patch.js` | Routes to add to `cloudflare-cron-trigger/worker.js`: `/corrections`, `/corrections/panel`, `/corrections/notify` (stub). |
| `wpcode_aztmm_version_meta.php` | WPCode snippet — registers the `aztmm_*` meta keys with REST. Without this, WP silently drops `meta` writes. |
| `sample_version_manifest.json` | Example manifest after a material correction. |

## Custom Post Meta keys (`aztmm_*` namespace)

| Key | Type | Set by |
|-----|------|--------|
| `aztmm_version_id` | string | publish + every correction |
| `aztmm_content_hash` | string (16-char SHA-256) | publish + every correction |
| `aztmm_payload_hash` | string (16-char SHA-256) | publish |
| `aztmm_published_at` | ISO-8601 UTC | publish |
| `aztmm_quality_gate_passed` | "true" | publish |
| `aztmm_publish_run_id` | string (GH run id or "manual") | publish |
| `aztmm_last_correction_at` | ISO-8601 UTC | correction (if any) |
| `aztmm_last_correction_materiality` | "material"\|"minor"\|"cosmetic" | correction (if any) |

All keys are registered with `context: edit` only — anonymous public REST requests cannot read them.

## Manifest schema (`aztmm-daily-pulse-v2/data/versions/{YYYY-MM-DD}.json`)

```json
{
  "post_id": 2879,
  "trading_date": "2026-06-09",
  "publish_event": {
    "version_id":          "20260609-220500-2c259f1c",
    "published_at":        "2026-06-09T22:05:00Z",
    "content_hash":        "2c259f1c1ae6521f",
    "payload_hash":        "7e7e7fcccf16b4f5",
    "quality_gate_passed": true,
    "run_id":              "27123456789",
    "meta_written":        "6/6"
  },
  "correction_events": [
    {
      "corrected_at":          "2026-06-10T02:01:13Z",
      "version_id_before":     "20260609-220500-2c259f1c",
      "version_id_after":      "20260610-020113-8f26aa1c",
      "content_hash_before":   "2c259f1c1ae6521f",
      "content_hash_after":    "8f26aa1cfcbad6dd",
      "materiality":           "material",
      "materiality_reasons":   ["material:MPI value"],
      "diff_summary":          "1 line(s) added, 1 line(s) removed; examples: ...",
      "subscriber_notification_recommended": true
    }
  ]
}
```

## Materiality classifier

| Label | Triggers |
|-------|----------|
| `material` | MPI value change, sector % change, SPY/VIX value, heading content, dollar figures, regime label, comma-grouped numbers |
| `cosmetic` | Whitespace and/or punctuation only after normalizing |
| `minor` | Paragraph/list content rewrites, narrative verb changes, anything else not material |

Classification is deliberately conservative — when in doubt, it leans toward
`minor` rather than `cosmetic`, so the operator dashboard surfaces them.

## Deploy steps

1. **Install the WPCode snippet.** Without it, the `meta` field writes are silently dropped by WP REST.
2. **Commit `detect_corrections.py` and `detect-corrections.yml`.** GH Actions picks up the workflow automatically.
3. **Patch the CF Worker.** Splice `cf_worker_corrections_patch.js` routes into `worker.js`, deploy with `wrangler publish`.
4. **Verify:** trigger a manual `daily-pulse-v2-update.yml` run; confirm `data/versions/{today}.json` lands in the repo, and the post has `aztmm_version_id` meta.

## What this enables / what's still missing

This unlocks Tier 1B (the data model), not Tier 2B (the mailer). See the bottom of `tier-1b-versioned-publishing.md` for the honest gap analysis.
