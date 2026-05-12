# AZTMM Cloudflare Cron Trigger

Permanent fix for the GitHub Actions scheduler-dormancy problem.

GH Actions cron triggers silently stop firing on low-activity repos. The "Heartbeat" workflow that was supposed to prevent this has gone dark. Cloudflare Workers Cron Triggers do not have this failure mode — they fire reliably for years.

## What it does

- Runs every 30 minutes (`*/30 * * * *` UTC) on Cloudflare's edge.
- Computes current Eastern Time using `Intl` with `America/New_York` (correct across DST).
- On weekdays, dispatches the MPI workflow in `aztmm1/aztmm-mpi-data` via `workflow_dispatch`:
  - Morning window: ET hour 9, minute < 30 (the `:00` tick covers 9:15 AM ET schedule)
  - Close window: ET hour 16, minute >= 30 (the `:30` tick covers 4:30 PM ET schedule)
- Pings Healthchecks.io every tick (optional, separate liveness signal).
- Appends a bounded log to KV (`triggers` key, last 200 lines).

## Files

- `worker.js` — Worker source
- `wrangler.toml` — Worker config (replace KV id before deploy)
- `sample_run_output.txt` — what a successful tick looks like

## One-time setup

### 1. Cloudflare account

Sign up free at https://dash.cloudflare.com/sign-up. Workers free tier = 100,000 invocations/month. We use 1,440/month (one per 30 min, 24/7).

### 2. Install wrangler

```bash
npm install -g wrangler
```

### 3. Authenticate

```bash
wrangler login
```

Opens a browser; approve the OAuth grant.

### 4. Create the KV namespace

```bash
cd /path/to/cloudflare-cron-trigger
wrangler kv:namespace create "TRIGGERS_LOG"
```

This prints something like:

```
[[kv_namespaces]]
binding = "TRIGGERS_LOG"
id = "abcdef0123456789abcdef0123456789"
```

Copy the `id` value into `wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`. Keep `binding = "KV"` — that name is what the Worker code expects.

### 5. Mint a GitHub fine-grained PAT

1. Go to https://github.com/settings/personal-access-tokens/new
2. Resource owner: `aztmm1`
3. Repository access: Only select repositories -> `aztmm-mpi-data`
4. Permissions -> Repository permissions:
   - **Actions**: Read and write
   - **Metadata**: Read-only (auto-included)
5. Expiration: 1 year is fine; set a calendar reminder to rotate.
6. Generate, copy the `github_pat_...` token.

### 6. Add secrets

```bash
wrangler secret put GH_PAT
# paste the PAT, press enter

# Optional but recommended:
wrangler secret put HEALTHCHECKS_URL
# paste e.g. https://hc-ping.com/<your-uuid>

# Optional, only if you want to manually fire via /run:
wrangler secret put MANUAL_TOKEN
# paste any random string
```

### 7. Deploy

```bash
wrangler deploy
```

You'll get a URL like `https://aztmm-cron.<your-subdomain>.workers.dev`.

## Verify

```bash
# Status (no secrets leaked, just booleans)
curl https://aztmm-cron.<sub>.workers.dev/status

# Tail live logs while waiting for the next :00 or :30 tick
wrangler tail

# After a tick fires, read the log
curl https://aztmm-cron.<sub>.workers.dev/log

# Force a tick now (if MANUAL_TOKEN is set)
curl "https://aztmm-cron.<sub>.workers.dev/run?token=<MANUAL_TOKEN>"
```

In GitHub, check **Actions -> MPI workflow** for a run with the `workflow_dispatch` trigger badge and `force=true` input.

## Cost

| Item | Limit | Our usage |
|---|---|---|
| Worker invocations | 100,000 / mo free | ~1,440 / mo |
| CPU time | 10 ms / req free | < 50 ms / tick |
| KV reads | 100,000 / day free | ~96 / day |
| KV writes | 1,000 / day free | ~2 / day |

Well inside free tier. No card on file required.

## Operational notes

- **DST is handled.** The Worker uses `Intl.DateTimeFormat` with `America/New_York`, not a hardcoded UTC offset.
- **Idempotency.** `workflow_dispatch` is safe to retry; GH Actions itself dedupes nothing, but the MPI workflow's own logic should be idempotent (cache key, transient bump). If two ticks fire (which they won't unless you change cron), worst case is a duplicate run.
- **Failure modes.** If the GH API is down, the dispatch logs the error to KV and the Worker still pings Healthchecks. We get visibility without crash.
- **Rotating the PAT.** `wrangler secret put GH_PAT` again with the new value; no redeploy needed.
- **Disabling.** `wrangler delete` removes the Worker entirely. Or comment out the `[triggers]` block and redeploy.

## Architecture diagram

```
+---------------------------+        every :00 and :30 UTC
| Cloudflare Worker         | <----- cron trigger
| (aztmm-cron)              |
+-------------+-------------+
              |
              | 1. compute ET via Intl
              | 2. if weekday AND (AM or PM window):
              v
     +-----------------+        POST /repos/aztmm1/aztmm-mpi-data
     | GitHub API      | <----- /actions/workflows/273532703/dispatches
     +-----------------+        body: {"ref":"main","inputs":{"force":"true"}}
              |
              v
       MPI workflow run
              
              | (always, every tick)
              v
     +-----------------+
     | Healthchecks.io | <----- GET HEALTHCHECKS_URL
     +-----------------+

     +-----------------+
     | Workers KV      | <----- append last 200 trigger log lines
     +-----------------+
```

## Why this replaces the Heartbeat workflow

The Heartbeat workflow was itself a GH Actions cron, so it was subject to the same dormancy bug it was meant to prevent. Moving the trigger upstream to Cloudflare breaks that circular dependency: the dispatcher lives on infrastructure that doesn't go dormant.
