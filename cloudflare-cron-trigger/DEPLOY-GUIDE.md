# CF Worker cron — Deploy Guide (Option 2: you do CF dashboard, I prepared the code)

You don't need an API token, the wrangler CLI, or any local tools. Just a Cloudflare account and the `aztmm-mpi-data` GitHub repo (which is already set up).

Time: ~10 minutes end to end.

---

## Step 1 — Create a KV namespace (for trigger log)

1. Open: **https://dash.cloudflare.com**
2. Left sidebar → **Workers & Pages** → **KV**
3. Click **Create a namespace**
4. Name it: `aztmm-cron-log`
5. Click **Create**
6. **Copy the namespace ID** that appears (looks like `a1b2c3d4e5f6...`)

---

## Step 2 — Update `wrangler.toml` with the KV namespace ID

In the GitHub repo `aztmm1/aztmm-mpi-data`, go to file:
`cloudflare-cron-trigger/wrangler.toml`

Find this line:
```toml
id = "REPLACE_WITH_KV_NAMESPACE_ID"
```

Replace `REPLACE_WITH_KV_NAMESPACE_ID` with the ID from Step 1, then commit.

(You can edit + commit directly in the GitHub web UI — pencil icon at top right of the file view.)

---

## Step 3 — Create the Worker, connected to GitHub

1. Cloudflare dashboard → **Workers & Pages**
2. Click **Create application**
3. Click **Workers** tab → **Create Worker** (or "Get started" if it's your first)
4. Name: `aztmm-cron`
5. Click **Deploy** (it'll deploy a placeholder — that's fine, we replace it next)

Now connect it to GitHub:

6. Click your new `aztmm-cron` worker
7. **Settings** → **Build** (or "Builds & Deployments" depending on UI version)
8. Click **Connect to Git** (or **Connect repository**)
9. Authorize Cloudflare to access GitHub if prompted
10. Select repository: **`aztmm1/aztmm-mpi-data`**
11. **Branch:** `main`
12. **Build configuration:**
    - Build command: *(leave empty)*
    - Deploy command: `npx wrangler deploy`
    - Root directory: `cloudflare-cron-trigger`
13. Click **Save & Deploy**

Cloudflare will now pick up the worker code from `cloudflare-cron-trigger/worker.js` and `wrangler.toml` and deploy it. Subsequent commits to that directory will auto-deploy.

---

## Step 4 — Set the GitHub PAT as a Worker secret

1. In the `aztmm-cron` Worker → **Settings** → **Variables and Secrets**
2. Click **Add variable**
3. Type: **Secret**
4. Name: `GH_PAT`
5. Value: paste the GitHub PAT you generated earlier in this conversation *(the one starting with `ghp_…` — has `repo` + `workflow` scope)*. Claude will share it in chat when you reach this step (or you can generate a fresh one at https://github.com/settings/tokens with the same scopes).
6. Click **Save and Deploy**

Optional secrets (you can skip these):
- `HEALTHCHECKS_URL` — if you want a third-party heartbeat ping each tick (https://healthchecks.io free tier)
- `MANUAL_TOKEN` — if you want to call `POST /run` manually for testing

---

## Step 5 — Verify

After the worker is live, hit its URL in the browser. Cloudflare shows it on the Worker's overview page — looks like `https://aztmm-cron.<your-cf-subdomain>.workers.dev`.

Visiting that URL should return JSON like:
```json
{
  "ok": true,
  "worker": "aztmm-cron",
  "version": "2.0",
  "utc": "2026-05-13T01:23:45.678Z",
  "etDate": "2026-05-12",
  "etHour": 21,
  "etMinute": 23,
  "weekday": 2,
  "wouldDispatchRightNow": []
}
```

`wouldDispatchRightNow: []` is normal outside the 9 AM / 4:30 PM / 5:10 PM ET windows. During those windows it'll show which workflows are next.

Also visit `https://<your-worker>.workers.dev/log` after the cron has fired at least once. You should see lines like:
```
2026-05-13T21:00:08.123Z 2026-05-13 ET=17:00 [cron] NO_MATCH
2026-05-13T21:15:09.456Z 2026-05-13 ET=17:15 [cron] DISPATCH daily-pulse-v2.yml -> 204
2026-05-13T21:15:10.789Z 2026-05-13 ET=17:15 [cron] DISPATCH congress-watch.yml -> 204
...
```

---

## Step 6 — Verify cron triggers are registered

1. Worker → **Triggers** tab (or **Settings** → **Triggers**)
2. Under **Cron Triggers** you should see: `*/15 13-23 * * 1-5`

If it's not there, click **Add Cron Trigger** and paste that expression manually.

---

## What this gives you

- **Insurance:** if GitHub Actions cron is dormant tomorrow at 5 PM ET (the known issue), CF Worker fires at 5:10 PM ET and dispatches all 4 trackers via the GH API.
- **Idempotent:** each GH workflow has its own date-based guard, so if GH already ran a workflow that day, the CF dispatch is a no-op.
- **Observable:** `/log` endpoint shows the last 200 trigger events.
- **Self-fixing:** if a single tick misses, the next 15-min tick retries.

---

## What this is NOT

- Not a replacement for GH Actions — GH still runs the actual pipelines. CF just kicks them off if GH cron didn't.
- Not free-form scheduling — it only dispatches the 5 workflows in the time windows defined inside `worker.js`. Adding more is a code change.
- Not a monitoring tool — it just fires. Use Healthchecks.io (the optional `HEALTHCHECKS_URL` secret) if you want failure alerts.

---

## If something breaks

- **Worker deploys but doesn't fire:** check Cron Triggers tab. CF sometimes drops the trigger on first deploy; re-add manually.
- **`GH_PAT not set` errors in logs:** secret wasn't saved or wrong name. Must be exactly `GH_PAT`.
- **404 from GitHub API:** PAT scope is wrong. Should be classic PAT with `repo` + `workflow`, or fine-grained PAT with Actions: read+write on the `aztmm-mpi-data` repo.
- **Triggers fire outside expected windows:** check `et*` fields in `/` response — if your worker's clock thinks it's a different time, that's a CF runtime issue (extremely rare).

---

## Cleanup if you decide to remove it later

1. CF dashboard → Workers & Pages → `aztmm-cron` → Settings → "Delete"
2. KV namespace → `aztmm-cron-log` → Delete
3. Remove `cloudflare-cron-trigger/` directory from the repo (or just leave the files — they're inert)
