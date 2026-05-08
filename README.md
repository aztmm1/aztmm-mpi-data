# AZTMM MPI + HMM Auto-Update Pipeline — Setup Guide

This pipeline computes the daily MPI score, 3-state HMM regime label, and
Pulse Compass probabilities from **free public data sources only** (FRED,
Yahoo Finance, CBOE put/call, AAII, CNN Fear & Greed). It runs on
**GitHub Actions** at 09:15 ET and 16:30 ET, market days only (Mon-Fri excluding NYSE holidays), and publishes the
result to `data/mpi.json` in your repo. The site reads it via the **jsDelivr
CDN** through a small WP REST proxy.

**Cost:** $0/month. Everything in this stack is free tier or BSD/MIT/Apache
open source.

**Estimated setup time:** 20-30 minutes for someone who has never used
GitHub Actions before.

---

## Files in this folder

| File | What it does |
|------|--------------|
| `mpi_hmm_pipeline.py`         | The Python script that computes everything. |
| `requirements.txt`            | Python library versions to install. |
| `.github/workflows/mpi-update.yml` | The schedule — tells GitHub when to run the script. |
| `wpcode-mpi-endpoint-patch.php` | Replaces the WP REST endpoint to read from GitHub. |
| `sample-output.json`          | Example of what the output JSON looks like. |
| `README.md`                   | This file. |

---

## Step 1 — Create a new public GitHub repo

1. Go to **https://github.com/new** while logged in.
2. **Repository name:** `aztmm-mpi-data`
3. **Description:** *AZTMM MPI + HMM auto-update pipeline (free data sources)*
4. **Visibility:** **Public**. (Required so jsDelivr can serve the file
   without auth. The repo holds only computed JSON — nothing sensitive.)
5. Leave "Add a README" UNCHECKED. We're going to push our own.
6. Click **Create repository**.

You should now see a near-empty repo with a "Quick setup" page. Keep that
tab open — you'll copy the repo URL in Step 2.

---

## Step 2 — Push the migration files to the repo

You have two options. **Option A is easier if you don't use the command line.**

### Option A: Web upload (no command line)

1. In the repo's "Quick setup" page, click **"uploading an existing file"**
   (under the "or push an existing repository" block — the link reads
   "*Upload existing files from your computer*").
2. Drag-and-drop the entire contents of `outputs/migration/` into the
   browser. Specifically, drop:
   - `mpi_hmm_pipeline.py`
   - `requirements.txt`
   - `wpcode-mpi-endpoint-patch.php`
   - `README.md`
   - `sample-output.json`
   - The `.github` folder (it must keep its name and the `workflows/`
     subfolder inside it)
3. Below the upload area, set the commit message to *"initial pipeline"*.
4. Choose **"Commit directly to the main branch"**.
5. Click **Commit changes**.

> **GitHub Actions troubleshooting:** if after uploading you don't see the
> workflow in the repo's "Actions" tab, the most common cause is that the
> `.github/workflows/mpi-update.yml` file got uploaded to the wrong path.
> Confirm in the repo file browser that you can navigate to
> `.github/workflows/mpi-update.yml` — the leading dot matters. If it's at
> the wrong path, delete and re-upload it via "Add file -> Create new file"
> and paste the contents into a path of `/.github/workflows/mpi-update.yml`.

### Option B: Command line (faster if you have git installed)

```bash
cd "/path/to/migration"
git init
git add .
git commit -m "initial pipeline"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/aztmm-mpi-data.git
git push -u origin main
```

---

## Step 3 — Add the FRED API key as a repo secret

The pipeline needs a free FRED API key to pull macro data (yields, credit
spreads, dollar). Approval is instant.

1. **Get a free FRED key** at https://fredaccount.stlouisfed.org/apikeys
   (you'll need to register an account — this also takes about a minute).
   Click **"Request API Key"**, fill out the short form, and copy the
   32-character hex string FRED returns.
2. Back on your `aztmm-mpi-data` repo on GitHub, click:
   **Settings** (top nav, gear icon) -> **Secrets and variables** (left
   sidebar) -> **Actions** -> **New repository secret**.
3. **Name:** `FRED_API_KEY`
4. **Secret:** paste the 32-char string from FRED.
5. Click **Add secret**.

> **Why a secret and not a config file?** Secrets are encrypted by GitHub
> and never appear in repo source or build logs. They're also free.

---

## Step 4 — Activate the workflow & run it once manually

1. On the repo, click the **Actions** tab.
2. If GitHub asks "Workflows aren't being run on this repository", click
   **"I understand my workflows, go ahead and enable them"**.
3. In the left sidebar, click the workflow named **"MPI + HMM Auto-Update"**.
4. On the right, click **Run workflow** (a dropdown). Leave both inputs
   blank/false and click the green **Run workflow** button.
5. Wait ~2-4 minutes. Refresh the Actions tab. The run should turn green
   (succeeded). If it fails, click into the run, expand the failed step,
   and copy the error — most failures are "FRED_API_KEY not set" (Step 3
   was missed) or transient Yahoo throttle (re-run; it's idempotent).
6. Confirm the new file `data/mpi.json` exists in the repo's root view.

---

## Step 5 — Get the jsDelivr CDN URL

jsDelivr serves any file in any public GitHub repo at a predictable URL,
free, with global edge caching. Construct it like this:

```
https://cdn.jsdelivr.net/gh/YOUR_USERNAME/aztmm-mpi-data@main/data/mpi.json
```

Replace `YOUR_USERNAME` with your GitHub username (visible in the URL of
your repo, e.g., `github.com/YOUR_USERNAME/aztmm-mpi-data`).

**Test it:** paste that URL into a new browser tab. You should see the
JSON payload (formatted differently per browser, but the data should match
`data/mpi.json` in the repo). If you see "Couldn't find the requested
file", wait 60 seconds (jsDelivr is provisioning) and try again.

---

## Step 6 — Update WP to read from jsDelivr

1. Open `wpcode-mpi-endpoint-patch.php` in this folder.
2. Find the line:
   ```php
   define( 'AZTMM_MPI_JSDELIVR_URL',
       'https://cdn.jsdelivr.net/gh/YOUR_GITHUB_USERNAME/aztmm-mpi-data@main/data/mpi.json'
   );
   ```
   Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.
3. **WP Admin** -> **Code Snippets** -> find or create the snippet that
   registers `/wp-json/aztmm/v2/mpi.json` (search the snippets list for
   "aztmm/v2" or "register_rest_route ... mpi" — most likely it's snippet
   #1909). Open it.
4. Replace its body with the code between the **BEGIN** and **END**
   markers in `wpcode-mpi-endpoint-patch.php`.
5. **Save** and **Activate**.
6. Test the endpoint by visiting:
   `https://aztmm.com/wp-json/aztmm/v2/mpi.json`
   It should return JSON with the same `mpi_score`, `regime`, etc. as
   the jsDelivr URL from Step 5.

---

## Step 7 — Verify the site hydrates

1. Hard-refresh `https://aztmm.com/` (Cmd+Shift+R / Ctrl+Shift+R).
2. The MPI score, regime label, SPY/VIX, and Pulse Compass probabilities
   should now reflect the latest values from `data/mpi.json`.
3. Append `?aztmmDebug=1` to any tool page URL to see seed/source info in
   the browser console (the existing fallback snippet logs which source it
   used).
4. If values look stale, force-refresh:
   - WP transient: WP Admin -> Code Snippets -> deactivate then reactivate
     the endpoint snippet (clears the 5-min transient).
   - jsDelivr: append `?v=YYYYMMDDHHMM` (current timestamp) to the URL once.

---

## Schedule cheat sheet

| ET time   | UTC (winter / EST) | UTC (summer / EDT) | What runs |
|-----------|--------------------|--------------------|-----------|
| 09:15 ET  | 14:15              | 13:15              | Pre-market refresh |
| 16:30 ET  | 21:30              | 20:30              | Post-close refresh |

The workflow lists all four UTC times. The Python script self-gates on the
actual NY clock so the duplicate fires (during DST transitions and outside
the target window) just exit cleanly without committing anything.
GitHub Actions cron has ~5-15 min jitter, so first run after 09:00 ET may
appear at 09:20-09:30 in the Actions log; that's normal.

NYSE holidays (full-day closures) are detected via
`pandas_market_calendars` and the run exits cleanly with no commit.

---

## How to manually trigger a refresh

1. **Actions** tab on `aztmm-mpi-data`.
2. Click **MPI + HMM Auto-Update** workflow.
3. Click **Run workflow** dropdown. Optional inputs:
   - `force = true` — bypasses the 09:15/16:30 ET window check.
   - `mock = true` — uses canned data (no network calls). Good for testing
     that the workflow itself is healthy without burning live data quota.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|--------|---|---|
| Run fails with "FRED_API_KEY not set; macro sleeve will use last-good" | Step 3 not done, or typo in secret name. | Re-do Step 3. The secret name must be exactly `FRED_API_KEY`. |
| Run completes but `mpi.json` unchanged | Idempotency — payload hash matches prior. Working as designed. | Nothing to fix. |
| `wp-json/aztmm/v2/mpi.json` returns the old seed values 24h after a fresh push | WP transient cache + jsDelivr stale. | Wait 5 min OR deactivate/reactivate the WP snippet to clear the transient. |
| `403 Forbidden` from CNN F&G inside the run logs | CNN occasionally blocks data-center IPs. | Pipeline marks F&G unavailable and uses AAII + put/call only. Sentiment score still computed. Ignore unless persistent. |
| AAII row missing during a Friday run | AAII publishes Wed-Thu; mid-week run is most reliable. | Pipeline already handles this; no action needed. |
| Yahoo `429 Too Many Requests` | Daily Yahoo throttle. | Pipeline retries once with backoff; if still failing, last-good is served and `data_quality` flips to `degraded`. Re-run later. |

---

## Cost confirmation

| Component | Cost |
|---|---|
| GitHub Actions (public repo) | **Free** — public repos get unlimited minutes. |
| jsDelivr CDN | **Free** — unlimited public-repo file delivery. |
| FRED API | **Free** — no rate limits with key. |
| Yahoo Finance via `yfinance` | **Free** — soft rate limit, fine for 2 runs/day. |
| CBOE daily put/call CSV | **Free** — public download. |
| CNN Fear & Greed | **Free** — public JSON endpoint. |
| AAII via community CSV mirror | **Free** — GitHub-hosted. |
| **Total** | **$0/month** |

---

## What this replaces

This pipeline ships independent of any paid data vendor. The Pulse Lab
options-flow data continues to come from the existing intraday vendor
that you've decided to keep — only **MPI + HMM** has been migrated to
free sources here.

---

## Local development / testing

If you want to test locally before pushing:

```bash
# Install Python 3.11+
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Mock mode (no network, no API key needed)
python mpi_hmm_pipeline.py --mock --dry-run

# Real mode (set the API key first)
export FRED_API_KEY="your_32_char_key"
python mpi_hmm_pipeline.py --dry-run --force
```

`--dry-run` prints the JSON to stdout without writing the file.
`--force` bypasses the time-of-day gate.
`--mock` uses canned data so you can verify the schema without network calls.
