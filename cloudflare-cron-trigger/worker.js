// AZTMM CF Worker v2.12 - drop-in replacement for cloudflare-cron-trigger/worker.js
//
// New vs v2.10 (2026-08-05):
//   * RETIRED 4 trackers: nope-max-pain-tracker, squeeze-watch,
//     earnings-flow-flag-tracker, insider-activity-tracker.
//     earnings-flow + options-gravity were rebuilt on yfinance after the 2026-05-15
//     PATH A lock (UW TOS) but reported SUCCESS daily while emitting EMPTY payloads
//     (count=0; nope + max_pain null). The pages fell back to stale June latest.html
//     artifacts and served them as the previous close for ~11 weeks. The freshness
//     watchdog passed them because it reads the date key, not the payload.
//     squeeze-watch last ran 2026-06-18, insider-activity 2026-06-07 - both were
//     cron-disabled at the PATH A lock and never rebuilt.
//     Removed from WORKFLOWS, TRACKER_WORKFLOW_MAP, FRESHNESS_TARGETS,
//     FRESHNESS_KEY_NUMBERS and selectWorkflows.
// 2026-06-15 MPI SEMANTIC FIX: split "data freshness" vs "pipeline ran".
//
// New vs v2.9:
//   - MPI freshness rule rewritten to honor the pipeline's TRUE asOf semantics.
//     The Python pipeline correctly sets `asOf` = last completed trading day
//     (Friday's bar on Monday morning, before Monday's 4:00 PM close completes).
//     Previously v2.9 marked MPI STALE whenever asOf != etDate, falsely alarming
//     every Monday from 09:30 ET until ~16:30 ET when Monday's bar finalizes.
//   - New MPI logic (mpiFreshnessCheck):
//       * Source-of-truth for "pipeline actually ran" = `computed_at`.
//       * Source-of-truth for "is the bar new" = `asOf`.
//       * STALE only when:
//           (a) computed_at > 24h old (pipeline failed to run today), OR
//           (b) it's past 17:00 ET on a weekday AND asOf != etDate (bar didn't roll
//               forward despite the run window having passed market close).
//       * Before 17:00 ET on a weekday: accept asOf == lastTradingDay (Fri on Mon AM)
//         as FRESH provided computed_at is within 24h. This is the honest read.
//       * Weekends: accept asOf == lastTradingDay always (no run expected).
//   - /mpi-health endpoint added: separate operator view of both freshness axes.
//   - Watchdog (runTrackerStalenessWatchdog) no longer auto-dispatches MPI on
//     monday-morning unless computed_at is also stale. Prevents redundant runs.
//
// Carried forward from v2.9:
//   - runTrackerStalenessWatchdog(): scans daily-cadence trackers, dispatches the
//     matching workflow when latest.json is older than the tolerance.
//     Idempotent: checks for in_progress/queued runs before dispatching.
//   - Fires at weekday 18:30 ET (after the main 17:30 window has settled) and
//     Monday 10:00 ET (catches any weekend drift on Friday EOD data).
//   - Drift alert: STALE_DATA results are surfaced in the freshness log so the
//     "ran but output unchanged" condition is observable (cannot auto-fix data).
//
// Carries forward from v2.5:
//   - /draft-queue endpoint: lists held drafts in daily/weekly categories
//   - watchdog retry: when a draft is held, dispatch workflow with reuse_draft_id
//   - /status page rebuilt as operator dashboard:
//       1. Pipeline health badge
//       2. Last 5 publishes (per WP REST)
//       3. Held drafts queue
//       4. MPI freshness
//       5. Recent CF Worker activity log
//       6. Watchdog last fire time
//       7. GH Actions recent runs
//       8. Resend status
//   - auto-refresh every 60 sec, AZTMM-styled, mobile-friendly

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var GH_OWNER = "aztmm1";
var GH_REPO = "aztmm-mpi-data";
var USER_AGENT = "AZTMM-CF-Worker/2.12";
var RAW_BASE = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main`;

var WP_SITE = "aztmm.com";
var DAILY_PULSE_CAT = 730419628;
var WEEKLY_PULSE_CAT = 730419629;

var WORKFLOWS = {
  mpi: "mpi-update.yml",
  dailyPulse: "daily-pulse-v2.yml",
  weeklyPulse: "weekly-pulse.yml",
  ledger: "ledger-score.yml"
};

// v2.9: tracker slug -> workflow file. Used by runTrackerStalenessWatchdog
// to dispatch the correct workflow when a daily tracker drifts stale.
// Only daily-cadence trackers are listed (insider-activity is weekly).
var TRACKER_WORKFLOW_MAP = {
  "accountability-ledger": "ledger-score.yml",
  "mpi": "mpi-update.yml"
};

var FRESHNESS_TARGETS = [
  // 2026-06-10: aztmm-daily-pulse-v2 target removed — Pipeline B daily retired;
  // Daily Pulse now published by the UW/MCP scheduled task (Pipeline A).
  {
    slug: "accountability-ledger",
    file: "latest.json",
    dateKeys: ["as_of", "date"],
    cadence: "daily",
    yesterdayFile: null
  },
  {
    slug: "mpi",
    path: "data/mpi.json",
    file: "mpi.json",
    dateKeys: ["asOf"],
    cadence: "daily",
    yesterdayFile: null,
    valueHashKeys: ["data.market.spy_spot", "data.volatility.vix", "data.volatility.vix3m"]
  }
];

var FRESHNESS_KEY_NUMBERS = {
  "aztmm-daily-pulse-v2": (data) => {
    let c = "";
    if (typeof data === "string") c = data;
    else { const p = (data && data.payload) || data || {}; c = (p && p.content) || ""; }
    const stripped = c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const m1 = stripped.match(/Call premium[^$]*\$([\d.]+[BMK]?)/i);
    const m2 = stripped.match(/Put premium[^$]*\$([\d.]+[BMK]?)/i);
    const m3 = stripped.match(/P[\\/-]?C(?:\s*volume)?\s*ratio[^\d]*([\d.]+)/i) || stripped.match(/Put\/Call volume ratio[^\d]*([\d.]+)/i);
    return [m1 && m1[1], m2 && m2[1], m3 && m3[1]].filter(Boolean).join("|");
  },
  "mpi": (data) => {
    const d = (data && data.data) || {};
    const m = d.market || {}; const v = d.volatility || {};
    return [m.spy_spot, v.vix, v.vix3m].filter((x) => x !== void 0 && x !== null).join("|");
  }
};

function getETParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get("weekday");
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour, minute, dow: weekdayMap[weekday] ?? -1 };
}

function getETDateStr(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function prevDateStr(etDate) {
  const d = new Date(etDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Returns the most recent NYSE trading day (Mon-Fri) on/before etDate.
// Saturday -> previous Friday; Sunday -> previous Friday; Mon-Fri -> same day.
// (Holiday calendar not modeled — acceptable false-positives on US bank holidays.)
function lastTradingDayStr(etDate) {
  // etDate is "YYYY-MM-DD" in ET. Use noon UTC anchor to avoid TZ drift.
  let d = new Date(etDate + "T12:00:00Z");
  // getUTCDay: 0=Sun, 6=Sat
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function isWeekendET(etDate) {
  const d = new Date(etDate + "T12:00:00Z");
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

async function dispatchWorkflow(env, workflowFile, inputs = null) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflowFile}/dispatches`;
  const body = { ref: "main" };
  if (inputs && typeof inputs === "object") body.inputs = inputs;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const authError = res.status === 401 || res.status === 403;
  return { workflow: workflowFile, status: res.status, ok: res.ok, authError, text: res.ok ? "" : (await res.text()).slice(0, 300) };
}

async function fetchRepoJson(_env, path) {
  try {
    const res = await fetch(`${RAW_BASE}/${path}?cb=${Date.now()}`, { headers: { "User-Agent": USER_AGENT }, cf: { cacheTtl: 0, cacheEverything: false } });
    if (!res.ok) return { ok: false, data: null, status: res.status };
    const data = await res.json();
    return { ok: true, data, status: 200 };
  } catch (e) { return { ok: false, data: null, status: 0, error: String(e) }; }
}

async function fetchRepoText(_env, path) {
  try {
    const res = await fetch(`${RAW_BASE}/${path}?cb=${Date.now()}`, { headers: { "User-Agent": USER_AGENT }, cf: { cacheTtl: 0, cacheEverything: false } });
    if (!res.ok) return { ok: false, data: null, status: res.status };
    const data = await res.text();
    return { ok: true, data, status: 200 };
  } catch (e) { return { ok: false, data: null, status: 0, error: String(e) }; }
}

async function appendLog(env, line) {
  if (!env.KV) return;
  try {
    const prev = (await env.KV.get("triggers")) || "";
    const lines = (prev + line + "\n").split("\n");
    const trimmed = lines.slice(-200).join("\n");
    await env.KV.put("triggers", trimmed);
  } catch (_) {}
}

async function pingHealthchecks(env, suffix = "") {
  if (!env.HEALTHCHECKS_URL) return;
  try {
    const u = suffix ? `${env.HEALTHCHECKS_URL}${suffix}` : env.HEALTHCHECKS_URL;
    await fetch(u, { method: "GET", headers: { "User-Agent": USER_AGENT } });
  } catch (_) {}
}

function selectWorkflows(et) {
  const { hour, minute, dow } = et;
  const selected = [];
  if (dow === 6 && hour === 9 && minute < 30) { selected.push(WORKFLOWS.weeklyPulse); return selected; }
  const isWeekday = dow >= 1 && dow <= 5;
  if (!isWeekday) return [];
  if (hour === 9 && minute < 30) selected.push(WORKFLOWS.mpi);
  if (hour === 16 && minute >= 30) selected.push(WORKFLOWS.mpi);
  if (hour === 23 && minute >= 25 && minute < 55) {
    /* 2026-06-11: backup dispatch for the Accountability Ledger — its own GH cron (23:15 ET)
       drifts like all GH crons on this repo. The scorer is idempotent, so a double-fire is safe. */
    selected.push(WORKFLOWS.ledger);
  }
  // 2026-08-11 v2.12: congress-watch retired (page trashed 2026-08-08); 17:10 ET dispatch removed.
  // 2026-08-05 v2.11: Friday insiderActivity dispatch removed — tracker retired.
  return selected;
}

// v2.10: MPI-specific freshness check honoring computed_at vs asOf split.
// Returns the same shape as checkTarget: {slug, status, date, expected, ...}.
// Status values: "fresh" | "STALE" | "STALE_DATA" | "fetch_failed".
//
// Rules:
//   - Fetch data/mpi.json.
//   - If fetch fails -> fetch_failed.
//   - Parse asOf (YYYY-MM-DD) and computed_at (ISO timestamp).
//   - Compute pipelineAgeHours = (now - computed_at) / 3600s.
//     If pipelineAgeHours > 24 -> STALE (reason: "pipeline_did_not_run").
//   - Compute lastTd (most recent trading day on/before etDate).
//   - If weekend: accept asOf == lastTd as fresh (no run expected today).
//   - If weekday and current ET time < 17:00:
//       accept asOf == lastTd OR asOf == etDate (pre-close grace) as fresh.
//   - If weekday and current ET time >= 17:00:
//       require asOf == etDate. Otherwise STALE (reason: "bar_did_not_advance").
//   - Numbers-match (today vs yesterday key hash): same STALE_DATA logic as before,
//     suppressed on weekends and on weekday-pre-close (legitimate carry-over).
async function checkMpiTarget(env, target, etDate) {
  const todayPath = target.path || `${target.slug}/sample-output/${target.file}`;
  const yesterdayDate = prevDateStr(etDate);
  const yesterdayPath = target.yesterdayFile ? `${target.slug}/sample-output/${target.yesterdayFile(yesterdayDate)}` : null;
  const [todayRes, yResRaw] = await Promise.all([
    fetchRepoJson(env, todayPath),
    yesterdayPath ? fetchRepoJson(env, yesterdayPath) : Promise.resolve(null)
  ]);
  if (!todayRes.ok) return { slug: target.slug, status: "fetch_failed", code: todayRes.status };
  const data = todayRes.data || {};

  // Parse asOf
  let foundDate = null;
  for (const k of (target.dateKeys || ["asOf"])) {
    if (data && typeof data === "object" && data[k]) { foundDate = String(data[k]).slice(0, 10); break; }
  }

  // Parse computed_at -> hours-of-age
  const computedAt = data.computed_at || null;
  let pipelineAgeHours = null;
  if (computedAt) {
    try {
      const t = new Date(computedAt).getTime();
      if (!isNaN(t)) pipelineAgeHours = (Date.now() - t) / 3_600_000;
    } catch (_) {}
  }

  // Key-numbers hash for STALE_DATA detection (carry forward from v2.9).
  let todayHash = null, yesterdayHash = null, numbersMatched = false, staleDataReason = null;
  const extractor = FRESHNESS_KEY_NUMBERS[target.slug];
  if (extractor) {
    try { todayHash = extractor(data) || null; } catch (_) {}
    if (yResRaw && yResRaw.ok && yResRaw.data) {
      try { yesterdayHash = extractor(yResRaw.data) || null; } catch (_) {}
      if (todayHash && yesterdayHash && todayHash === yesterdayHash) {
        numbersMatched = true; staleDataReason = "key_numbers_identical_to_yesterday";
      }
    }
  }
  // KV-backed value-hash compare (preserves v2.9 logic).
  if (target.valueHashKeys && Array.isArray(target.valueHashKeys) && env.KV) {
    try {
      const dig = (obj, dotPath) => { const parts2 = dotPath.split("."); let cur = obj; for (const p of parts2) { if (cur == null || typeof cur !== "object") return void 0; cur = cur[p]; } return cur; };
      const parts = target.valueHashKeys.map((k) => { const v = dig(data, k); return v === void 0 || v === null ? "" : String(v); });
      const todayValueHash = parts.join("|");
      const kvKey = `${target.slug}:yesterdayValueHash`;
      const prior = await env.KV.get(kvKey);
      if (prior && todayValueHash && prior === todayValueHash) {
        numbersMatched = true; staleDataReason = staleDataReason || "value_hash_identical_to_yesterday_kv";
        todayHash = todayHash || todayValueHash; yesterdayHash = yesterdayHash || prior;
      }
      if (todayValueHash) await env.KV.put(kvKey, todayValueHash, { expirationTtl: 7 * 24 * 3600 });
    } catch (_) {}
  }

  // Time-of-day classification
  const now = new Date();
  const etParts = getETParts(now);
  const lastTd = lastTradingDayStr(etDate);
  const weekendSkip = isWeekendET(etDate);
  // 17:00 ET = pipeline's expected EOD window has passed (mpi-update.yml fires
  // at 16:30 ET, plus ~20-30min of run+commit).
  const postCloseEOD = !weekendSkip && (etParts.hour >= 17);
  const weekdayPreClose = !weekendSkip && !postCloseEOD;
  // PRIOR completed trading bar (the one a pre-close run on a weekday legitimately
  // reflects). On Mon AM, this is Fri. On Tue-Fri AM, this is the previous weekday.
  // lastTradingDayStr returns etDate itself if etDate is M-F, so we walk back one
  // weekday to get the previous bar.
  const priorTradingDay = (function(){
    let d = new Date(etDate + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  })();

  const base = {
    slug: target.slug, date: foundDate, todayHash, yesterdayHash, numbersMatched,
    computed_at: computedAt, pipelineAgeHours: pipelineAgeHours == null ? null : Number(pipelineAgeHours.toFixed(2)),
    weekendSkip, postCloseEOD, priorTradingDay
  };

  if (!foundDate) return { ...base, status: "no_date_field" };

  // (1) HARD-FAIL: pipeline did not run in the last 24h.
  if (pipelineAgeHours != null && pipelineAgeHours > 24) {
    return { ...base, status: "STALE", expected: etDate, reason: "pipeline_did_not_run", ageHours: base.pipelineAgeHours };
  }

  // (2) WEEKEND: accept lastTd (Fri) or any forward date.
  if (weekendSkip) {
    const isLastTd = foundDate === lastTd;
    const isForward = foundDate >= etDate;
    if (isLastTd || isForward) {
      // Numbers-matching on weekend is normal (markets closed). Don't flag STALE_DATA.
      return { ...base, status: "fresh", expected: lastTd, reason: "weekend_lastTd_ok" };
    }
    return { ...base, status: "STALE", expected: lastTd, reason: "weekend_data_older_than_friday" };
  }

  // (3) WEEKDAY PRE-CLOSE: accept priorTradingDay (Fri on Mon AM) OR today.
  //     Suppress STALE_DATA — pre-close key numbers may legitimately match prior bar.
  if (weekdayPreClose) {
    const accept = foundDate === etDate || foundDate === priorTradingDay;
    if (accept) {
      return { ...base, status: "fresh", expected: priorTradingDay, reason: "weekday_preclose_priorTd_ok" };
    }
    return { ...base, status: "STALE", expected: priorTradingDay, reason: "weekday_preclose_data_older_than_priorTd" };
  }

  // (4) WEEKDAY POST-CLOSE (>= 17:00 ET): require today.
  if (foundDate === etDate) {
    // Bar advanced — but check STALE_DATA (numbers identical to yesterday).
    if (numbersMatched) return { ...base, status: "STALE_DATA", expected: etDate, reason: staleDataReason };
    return { ...base, status: "fresh", expected: etDate, reason: "weekday_postclose_today_ok" };
  }
  return { ...base, status: "STALE", expected: etDate, reason: "weekday_postclose_bar_did_not_advance" };
}
__name(checkMpiTarget, "checkMpiTarget");

async function checkTarget(env, target, etDate) {
  // v2.10: route MPI to the dedicated checker that honors computed_at + asOf split.
  if (target.slug === "mpi") {
    return checkMpiTarget(env, target, etDate);
  }

  const todayPath = target.path || `${target.slug}/sample-output/${target.file}`;
  const yesterdayDate = prevDateStr(etDate);
  const yesterdayPath = target.cadence === "daily" && target.yesterdayFile ? `${target.slug}/sample-output/${target.yesterdayFile(yesterdayDate)}` : null;
  const yesterdayFetcher = target.yesterdayFileIsText ? fetchRepoText : fetchRepoJson;
  const [todayRes, yResRaw] = await Promise.all([fetchRepoJson(env, todayPath), yesterdayPath ? yesterdayFetcher(env, yesterdayPath) : Promise.resolve(null)]);
  if (!todayRes.ok) return { slug: target.slug, status: "fetch_failed", code: todayRes.status };
  const data = todayRes.data;
  let foundDate = null;
  for (const k of target.dateKeys) { if (data && typeof data === "object" && data[k]) { foundDate = String(data[k]).slice(0, 10); break; } }
  if (!foundDate && data && data.payload) {
    const text = (data.payload.title || "") + " " + (data.payload.content || "");
    const m = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) foundDate = m[1];
  }
  if (!foundDate) {
    const m = JSON.stringify(data).match(/"(?:date|asOf|as_of|as_of_date|target_date|run_date)":\s*"(\d{4}-\d{2}-\d{2})/);
    if (m) foundDate = m[1];
  }
  let todayHash = null, yesterdayHash = null, numbersMatched = false, staleDataReason = null;
  const extractor = FRESHNESS_KEY_NUMBERS[target.slug];
  if (extractor) {
    try { todayHash = extractor(data) || null; } catch (_) { todayHash = null; }
    if (yResRaw && yResRaw.ok && yResRaw.data) {
      try { yesterdayHash = extractor(yResRaw.data) || null; } catch (_) { yesterdayHash = null; }
      if (todayHash && yesterdayHash && todayHash === yesterdayHash) { numbersMatched = true; staleDataReason = "key_numbers_identical_to_yesterday"; }
    }
  }
  if (target.valueHashKeys && Array.isArray(target.valueHashKeys) && env.KV) {
    try {
      const dig = (obj, dotPath) => { const parts2 = dotPath.split("."); let cur = obj; for (const p of parts2) { if (cur == null || typeof cur !== "object") return void 0; cur = cur[p]; } return cur; };
      const parts = target.valueHashKeys.map((k) => { const v = dig(data, k); return v === void 0 || v === null ? "" : String(v); });
      const todayValueHash = parts.join("|");
      const kvKey = `${target.slug}:yesterdayValueHash`;
      const prior = await env.KV.get(kvKey);
      if (prior && todayValueHash && prior === todayValueHash) { numbersMatched = true; staleDataReason = "value_hash_identical_to_yesterday_kv"; todayHash = todayHash || todayValueHash; yesterdayHash = yesterdayHash || prior; }
      if (todayValueHash) await env.KV.put(kvKey, todayValueHash, { expirationTtl: 7 * 24 * 3600 });
    } catch (_) {}
  }
  if (!foundDate) return { slug: target.slug, status: "no_date_field", todayHash, yesterdayHash, numbersMatched };
  // Sentinel: pipelines can write {"_action":"noop","reason":"non_market_day",...}
  // on weekends/holidays to indicate "intentionally no new run". Treat as fresh.
  if (data && typeof data === "object" && data._action === "noop") {
    return { slug: target.slug, status: "fresh", date: foundDate, expected: foundDate, noop: true, reason: data.reason || "noop", todayHash, yesterdayHash, numbersMatched };
  }
  // Weekend-aware expected date for daily-cadence trackers.
  // On Sat/Sun, market is closed; daily trackers carry Friday data. That is NOT stale —
  // the dashboard /status was historically marking all daily trackers DEGRADED on weekends.
  // Fix: treat foundDate === lastTradingDay (Friday on Sat/Sun) as fresh.
  const lastTd = lastTradingDayStr(etDate);
  const weekendSkip = isWeekendET(etDate) && (target.cadence || "daily") === "daily";
  // On weekends, accept foundDate that is either the last trading day OR a forward date
  // (some scripts e.g. yfinance label snapshots by next trading day on weekends).
  const isForwardDate = weekendSkip && foundDate >= etDate;
  const dailyAccepted = foundDate === etDate || (weekendSkip && (foundDate === lastTd || isForwardDate));
  // On weekends, key-numbers identical to yesterday's is NORMAL (markets closed,
  // SPY/VIX/etc. unchanged from Friday close). Suppress STALE_DATA on weekend-skip.
  if (dailyAccepted && numbersMatched && !weekendSkip) return { slug: target.slug, status: "STALE_DATA", date: foundDate, expected: etDate, todayHash, yesterdayHash, numbersMatched, reason: staleDataReason };
  if (dailyAccepted) return { slug: target.slug, status: "fresh", date: foundDate, expected: weekendSkip ? lastTd : etDate, weekendSkip, todayHash, yesterdayHash, numbersMatched };
  if ((target.cadence || "daily") === "weekly") {
    const today = new Date(etDate + "T00:00:00Z");
    const got = new Date(foundDate + "T00:00:00Z");
    const ageDays = (today - got) / (1000 * 60 * 60 * 24);
    if (ageDays >= 0 && ageDays <= 7) return { slug: target.slug, status: "fresh", date: foundDate, cadence: "weekly", ageDays, todayHash, yesterdayHash, numbersMatched };
    return { slug: target.slug, status: "STALE", date: foundDate, expected: etDate, cadence: "weekly", ageDays, todayHash, yesterdayHash, numbersMatched };
  }
  return { slug: target.slug, status: "STALE", date: foundDate, expected: weekendSkip ? lastTd : etDate, weekendSkip, todayHash, yesterdayHash, numbersMatched };
}

async function checkSiteWiring(env) {
  // 2026-06-10: reader-facing check — the homepage must carry the v2 hydrator and canonical keys,
  // and the canonical feed it reads must be reachable. Catches wiring regressions the repo checks can't see.
  try {
    const [pageRes, canonRes] = await Promise.all([
      fetch(`https://${WP_SITE}/?nocache=${Date.now()}`, { headers: { "User-Agent": USER_AGENT } }),
      fetchRepoJson(env, "data/canonical-content.json")
    ]);
    if (!pageRes.ok) return { slug: "site-wiring", status: "STALE", error: "home HTTP " + pageRes.status };
    const html = await pageRes.text();
    const hasV2 = html.indexOf("__aztmmCanonicalHydrator") !== -1 && html.indexOf('"2.') !== -1; /* any 2.x */
    const hasKeys = html.indexOf("data-canonical-key") !== -1;
    const canonOk = canonRes.ok && canonRes.data && canonRes.data.mpi && canonRes.data.mpi.as_of;
    if (hasV2 && hasKeys && canonOk) return { slug: "site-wiring", status: "fresh", date: canonRes.data.mpi.as_of };
    return { slug: "site-wiring", status: "STALE", error: `v2:${hasV2} keys:${hasKeys} canonical:${!!canonOk}` };
  } catch (e) {
    return { slug: "site-wiring", status: "error", error: String(e) };
  }
}
__name(checkSiteWiring, "checkSiteWiring");
async function runFreshnessWatch(env, etDate) {
  const results = await Promise.all([...FRESHNESS_TARGETS.map((t) => checkTarget(env, t, etDate).catch((e) => ({ slug: t.slug, status: "error", error: String(e) }))), checkSiteWiring(env)]);
  const stale = results.filter((r) => r.status === "STALE");
  const staleData = results.filter((r) => r.status === "STALE_DATA");
  const fresh = results.filter((r) => r.status === "fresh");
  await appendLog(env, `${new Date().toISOString()} ${etDate} ET=17:55 [freshness-watch] checked=${results.length} fresh=${fresh.length} STALE=${stale.length} STALE_DATA=${staleData.length} ` + JSON.stringify([...stale, ...staleData]));
  if (stale.length > 0 || staleData.length > 0) await pingHealthchecks(env, "/fail");
  return results;
}

// ============================================================================
// v2.9: TRACKER STALENESS WATCHDOG
// ============================================================================
// Catches the case where the main 17:30 ET dispatch missed a tracker (workflow
// errored before commit, GH cron drift across day boundary, etc.) by checking
// freshness late in the day and dispatching the matching workflow.
//
// Fires at:
//   - Weekday 18:30 ET — after the 17:30 dispatch + processing window settled.
//   - Monday 10:00 ET  — catches weekend drift on Friday EOD data.
//
// Tolerances:
//   - Weekday evening: foundDate must equal etDate (Mon-Fri). If older, dispatch.
//   - Monday morning:  foundDate must equal lastTradingDayStr(etDate) (= Friday).
//                      If older than that (e.g. Thursday or earlier), dispatch.
//
// Idempotency:
//   - Before dispatching, check GH runs API for in_progress/queued runs of the
//     same workflow file. If one exists, skip — don't pile on duplicate runs.
//   - Drift alert: if status === STALE_DATA (todayHash matches yesterday's),
//     we cannot auto-fix it from here (data source is unchanged), so log only.
async function isWorkflowAlreadyRunning(env, workflowFile) {
  if (!env.GH_PAT) return false;
  try {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflowFile}/runs?per_page=5`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.GH_PAT}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": USER_AGENT
      }
    });
    if (!res.ok) return false;
    const data = await res.json();
    const runs = (data.workflow_runs || []);
    return runs.some((r) => r.status === "in_progress" || r.status === "queued");
  } catch (_) {
    return false;
  }
}

async function runTrackerStalenessWatchdog(env, etDate, mode = "weekday-evening") {
  const stamp = new Date().toISOString();
  const lastTd = lastTradingDayStr(etDate);
  // Expected date depends on mode + cadence:
  //   - weekday-evening: must be today (etDate)
  //   - monday-morning:  must be Friday (lastTradingDayStr from Monday)
  const expectedDate = mode === "monday-morning" ? lastTd : etDate;

  const results = await Promise.all(
    FRESHNESS_TARGETS.map((t) =>
      checkTarget(env, t, etDate).catch((e) => ({ slug: t.slug, status: "error", error: String(e) }))
    )
  );

  const dispatched = [];
  const skipped = [];
  const driftAlerts = [];

  for (const r of results) {
    // Only auto-dispatch daily-cadence trackers with a mapped workflow.
    const wf = TRACKER_WORKFLOW_MAP[r.slug];
    if (!wf) continue;

    // Surface drift but don't try to fix it (data source is the problem).
    if (r.status === "STALE_DATA" || (r.numbersMatched && r.todayHash && r.yesterdayHash && r.todayHash === r.yesterdayHash)) {
      driftAlerts.push({ slug: r.slug, todayHash: r.todayHash, foundDate: r.date });
      continue;
    }

    if (r.status !== "STALE") {
      continue;
    }

    // STALE confirmed. Check if we should dispatch given the mode/expected.
    const foundDate = r.date || "";
    let shouldDispatch = false;
    if (mode === "monday-morning") {
      // Need foundDate >= lastTradingDay (Friday). If older, dispatch.
      if (!foundDate || foundDate < lastTd) shouldDispatch = true;
      // v2.10: for MPI specifically, also skip dispatch when the pipeline actually
      // ran recently (computed_at fresh). Mon-AM asOf == Fri is normal; only
      // dispatch if computed_at > 24h or asOf < priorTradingDay (= Friday on Mon).
      if (r.slug === "mpi" && r.pipelineAgeHours != null && r.pipelineAgeHours <= 24 && r.priorTradingDay && foundDate >= r.priorTradingDay) {
        shouldDispatch = false;
      }
    } else {
      // weekday-evening: need foundDate === etDate. If older, dispatch.
      if (!foundDate || foundDate < etDate) shouldDispatch = true;
    }
    if (!shouldDispatch) continue;

    // Idempotency check.
    const busy = await isWorkflowAlreadyRunning(env, wf);
    if (busy) {
      skipped.push({ slug: r.slug, wf, reason: "already_running" });
      continue;
    }

    try {
      const d = await dispatchWorkflow(env, wf);
      if (d.ok) {
        dispatched.push({ slug: r.slug, wf, status: d.status, foundDate, expectedDate });
      } else {
        skipped.push({ slug: r.slug, wf, reason: `dispatch_failed_${d.status}`, error: d.text });
      }
    } catch (e) {
      skipped.push({ slug: r.slug, wf, reason: "dispatch_threw", error: String(e) });
    }
  }

  await appendLog(
    env,
    `${stamp} ${etDate} [watchdog-tracker-${mode}] dispatched=${dispatched.length} skipped=${skipped.length} driftAlerts=${driftAlerts.length} ` +
      JSON.stringify({ dispatched, skipped, driftAlerts })
  );

  return { mode, etDate, expectedDate, dispatched, skipped, driftAlerts };
}

// ============================================================================
// TWO-PHASE PUBLISH SUPPORT (v2.5, 2026-06-06)
// ============================================================================

async function fetchDraftQueue() {
  // Held-drafts queue. Two paths:
  //
  // (A) Authenticated path: if env.WP_BASIC_AUTH is set ("user:apppassword"),
  //     query WP REST directly for status=draft posts in daily/weekly
  //     categories. Canonical source. Lets the watchdog pass reuse_draft_id.
  //
  // (B) GH-API fallback: if WP_BASIC_AUTH is NOT set, derive "potential
  //     held drafts" by scanning recent GH Actions runs of the two pulse
  //     workflows for the "QUALITY GATE FAILED (exit 7|8)" annotation.
  //     Informational only - the watchdog will dispatch fresh (no reuse_id).
  //
  // Goal: zero setup. User doesn't need to add WP_BASIC_AUTH to CF Worker.
  // GH_PAT (already required for other panels) carries the load.
  const env = globalThis.__WORKER_ENV__ || {};
  const auth = env.WP_BASIC_AUTH || "";
  if (auth) {
    // Path A: authenticated WP query
    const drafts = [];
    for (const catId of [DAILY_PULSE_CAT, WEEKLY_PULSE_CAT]) {
      const u = `https://${WP_SITE}/wp-json/wp/v2/posts?status=draft&categories=${catId}&per_page=20&_fields=id,date,modified,link,title,status,categories`;
      try {
        const r = await fetch(u, { headers: { "user-agent": USER_AGENT, Authorization: `Basic ${btoa(auth)}` } });
        if (!r.ok) continue;
        const arr = await r.json();
        for (const p of Array.isArray(arr) ? arr : []) {
          drafts.push({
            id: p.id,
            link: p.link,
            title: (p.title && (p.title.rendered || p.title)) || "(no title)",
            modified: p.modified,
            date: p.date,
            category_id: catId,
            category_label: catId === DAILY_PULSE_CAT ? "daily" : "weekly",
            source: "wp"
          });
        }
      } catch (_) {}
    }
    return { ok: true, drafts, source: "wp" };
  }
  // Path B: GH-API fallback (no WP auth needed)
  return await fetchHeldDraftsFromGH(env);
}

async function fetchHeldDraftsFromGH(env) {
  // Scan recent runs of daily-pulse-v2.yml + weekly-pulse.yml for
  // "QUALITY GATE FAILED (exit 7|8)" annotations (the held-draft markers
  // from the publish-step warning emitted by publish_to_wp.py).
  if (!env.GH_PAT) {
    return { ok: false, error: "no WP_BASIC_AUTH and no GH_PAT - set GH_PAT to enable GH-API fallback", drafts: [], source: "none" };
  }
  const headers = {
    Authorization: `Bearer ${env.GH_PAT}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT
  };
  const drafts = [];
  const workflows = [
    { file: "daily-pulse-v2.yml", category_label: "daily" },
    { file: "weekly-pulse.yml", category_label: "weekly" }
  ];
  for (const wf of workflows) {
    try {
      const runsUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${wf.file}/runs?per_page=8`;
      const rr = await fetch(runsUrl, { headers });
      if (!rr.ok) continue;
      const runsData = await rr.json();
      const runs = (runsData.workflow_runs || []).slice(0, 5);
      for (const run of runs) {
        try {
          const jobsUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${run.id}/jobs?per_page=5`;
          const jr = await fetch(jobsUrl, { headers });
          if (!jr.ok) continue;
          const jData = await jr.json();
          let held = false;
          let heldMsg = "";
          for (const job of (jData.jobs || [])) {
            const annoUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/check-runs/${job.id}/annotations`;
            const ar = await fetch(annoUrl, { headers });
            if (!ar.ok) continue;
            const annos = await ar.json();
            for (const a of (Array.isArray(annos) ? annos : [])) {
              const msg = (a.message || "") + " " + (a.title || "");
              if (/QUALITY GATE FAILED.*exit\s*[78]/i.test(msg)) {
                held = true;
                heldMsg = msg.slice(0, 200);
                break;
              }
            }
            if (held) break;
          }
          if (held) {
            drafts.push({
              id: `run-${run.id}`,
              link: run.html_url,
              title: `${wf.category_label} pulse held (run #${run.run_number})`,
              modified: run.updated_at || run.created_at,
              date: run.created_at,
              category_id: wf.category_label === "daily" ? DAILY_PULSE_CAT : WEEKLY_PULSE_CAT,
              category_label: wf.category_label,
              source: "gh-annotation",
              warning: heldMsg
            });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  return { ok: true, drafts, source: "gh-annotations" };
}

async function fetchRecentPublishes() {
  const out = [];
  for (const catId of [DAILY_PULSE_CAT, WEEKLY_PULSE_CAT]) {
    const u = `https://${WP_SITE}/wp-json/wp/v2/posts?categories=${catId}&per_page=5&_fields=id,date,link,title,status,modified`;
    try {
      const r = await fetch(u, { headers: { "user-agent": USER_AGENT } });
      if (!r.ok) continue;
      const arr = await r.json();
      for (const p of Array.isArray(arr) ? arr : []) {
        out.push({
          id: p.id,
          link: p.link,
          title: (p.title && (p.title.rendered || p.title)) || "(no title)",
          date: p.date,
          modified: p.modified,
          category_label: catId === DAILY_PULSE_CAT ? "daily" : "weekly",
          status: p.status || "publish"
        });
      }
    } catch (_) {}
  }
  out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return out.slice(0, 5);
}

async function fetchGHRecentRuns(env) {
  if (!env.GH_PAT) return [];
  const u = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs?per_page=10`;
  try {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${env.GH_PAT}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": USER_AGENT } });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.workflow_runs || []).slice(0, 10).map((wr) => ({
      name: wr.name,
      status: wr.status,
      conclusion: wr.conclusion,
      created_at: wr.created_at,
      html_url: wr.html_url,
      run_number: wr.run_number
    }));
  } catch (_) { return []; }
}

async function fetchMpiFreshness(env) {
  const r = await fetchRepoJson(env, "data/mpi.json");
  if (!r.ok) return { ok: false };
  const d = r.data || {};
  const asOf = d.asOf || d.as_of || d.computed_at || null;
  const score = (d.data && (d.data.market || {}).spy_spot) || null;
  return { ok: true, asOf, score, score_label: "SPY spot", computed_at: d.computed_at || asOf, raw: d };
}

async function runLateNightDailyPulseWatchdogTwoPhase(env, etDate) {
  // v2.5: instead of blindly dispatching, check for held drafts first.
  // If a draft exists for today, dispatch workflow with reuse_draft_id +
  // watchdog_retry=true so the workflow REPLACES the held draft and (on second
  // gate fail) exits 8 (human approval needed).
  const stamp = new Date().toISOString();
  const publishedExists = await checkWordPressPostExists(DAILY_PULSE_CAT, etDate);
  if (publishedExists === true) {
    await appendLog(env, `${stamp} ${etDate} [watchdog-daily-23h-v2.5] OK - published post exists`);
    return;
  }
  // Look for a held draft from today's earlier attempt
  const dq = await fetchDraftQueue();
  let reuseDraftId = null;
  if (dq.ok) {
    for (const d of dq.drafts) {
      if (d.category_id === DAILY_PULSE_CAT && (d.date || "").startsWith(etDate)) {
        reuseDraftId = d.id;
        break;
      }
    }
  }
  const inputs = { date: etDate, watchdog_retry: "true" };
  if (reuseDraftId) inputs.reuse_draft_id = String(reuseDraftId);
  const r = await dispatchWorkflow(env, WORKFLOWS.dailyPulse, inputs);
  await appendLog(env, `${stamp} ${etDate} [watchdog-daily-23h-v2.5] DISPATCH daily-pulse reuse_draft_id=${reuseDraftId || "none"} -> ${r.status}`);
  await pingHealthchecks(env, publishedExists === false ? "/fail" : "");
}

async function runWeeklyPulseWatchdogTwoPhase(env, etDate) {
  const stamp = new Date().toISOString();
  const exists = await checkWordPressPostExists(WEEKLY_PULSE_CAT, etDate);
  if (exists === true) { await appendLog(env, `${stamp} ${etDate} [watchdog-weekly-9h45-v2.5] OK - post exists`); return; }
  const dq = await fetchDraftQueue();
  let reuseDraftId = null;
  if (dq.ok) {
    for (const d of dq.drafts) {
      if (d.category_id === WEEKLY_PULSE_CAT) {
        // weekly drafts are valid for the whole week — use most-recent
        reuseDraftId = d.id;
        break;
      }
    }
  }
  const inputs = { watchdog_retry: "true" };
  if (reuseDraftId) inputs.reuse_draft_id = String(reuseDraftId);
  const r = await dispatchWorkflow(env, WORKFLOWS.weeklyPulse, inputs);
  await appendLog(env, `${stamp} ${etDate} [watchdog-weekly-9h45-v2.5] DISPATCH weekly-pulse reuse_draft_id=${reuseDraftId || "none"} -> ${r.status}`);
  await pingHealthchecks(env, "/fail");
}

async function checkWordPressPostExists(categoryId, dateStr) {
  const url = `https://${WP_SITE}/wp-json/wp/v2/posts?categories=${categoryId}&after=${dateStr}T00:00:00&before=${dateStr}T23:59:59&per_page=1&_fields=id`;
  try {
    const r = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!r.ok) return null;
    const arr = await r.json();
    return Array.isArray(arr) && arr.length > 0;
  } catch (e) { return null; }
}

async function runTick(env, source = "cron") {
  globalThis.__WORKER_ENV__ = env;
  const now = new Date();
  const et = getETParts(now);
  const etDate = getETDateStr(now);
  const stamp = now.toISOString();
  if (et.dow >= 1 && et.dow <= 5 && et.hour === 17 && et.minute >= 50 && et.minute < 60) await runFreshnessWatch(env, etDate);
  // 2026-06-10: 23:00 ET daily watchdog disabled — it dispatched Pipeline B (retired).
  if (et.dow === 6 && et.hour === 9 && et.minute >= 30 && et.minute < 60) await runWeeklyPulseWatchdogTwoPhase(env, etDate);
  // v2.9: tracker-staleness watchdog.
  //   - Weekday 18:30-18:59 ET: catch trackers whose 17:30 dispatch left them STALE.
  //   - Monday  10:00-10:29 ET: catch any weekend drift on Friday EOD data.
  if (et.dow >= 1 && et.dow <= 5 && et.hour === 18 && et.minute >= 30 && et.minute < 60) {
    await runTrackerStalenessWatchdog(env, etDate, "weekday-evening").catch((e) => appendLog(env, `${stamp} ${etDate} [watchdog-tracker-weekday-evening] ERROR ${String(e)}`));
  }
  if (et.dow === 1 && et.hour === 10 && et.minute < 30) {
    await runTrackerStalenessWatchdog(env, etDate, "monday-morning").catch((e) => appendLog(env, `${stamp} ${etDate} [watchdog-tracker-monday-morning] ERROR ${String(e)}`));
  }
  const workflows = selectWorkflows(et);
  const result = { timestamp: stamp, etDate, etHour: et.hour, etMinute: et.minute, dow: et.dow, source, workflowsTriggered: [], workflowsSkipped: [] };
  let authFailed = false;
  if (workflows.length === 0) {
    await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,"0")} dow=${et.dow} [${source}] NO_MATCH`);
    return result;
  }
  for (const wf of workflows) {
    try {
      const r = await dispatchWorkflow(env, wf);
      if (r.ok) {
        result.workflowsTriggered.push({ wf, status: r.status });
        await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,"0")} [${source}] DISPATCH ${wf} -> ${r.status}`);
      } else {
        result.workflowsSkipped.push({ wf, status: r.status, error: r.text });
        if (r.authError) authFailed = true;
        await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,"0")} [${source}] FAIL ${wf} -> ${r.status} ${r.text}`);
      }
    } catch (e) {
      result.workflowsSkipped.push({ wf, error: String(e) });
      await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,"0")} [${source}] ERROR ${wf} -> ${e}`);
    }
  }
  if (authFailed) await appendLog(env, `${stamp} ${etDate} [AUTH-ERROR] GH_PAT 401/403 on dispatch — paging healthcheck`);
  await pingHealthchecks(env, authFailed ? "/fail" : "");
  return result;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "cache-control": "no-store"
  };
}

// ============================================================================
// Operator Dashboard HTML (AZTMM-styled)
// ============================================================================
function renderStatusPage(ctx) {
  const { etDate, freshness, recentPublishes, draftQueue, mpi, recentLog, ghRuns, resendStatus, watchdogLastFire, elapsedMs } = ctx;
  const allFresh = freshness.every((x) => x.status === "fresh");
  const heldDraftCount = (draftQueue && draftQueue.drafts) ? draftQueue.drafts.length : 0;
  const weekendNow = isWeekendET(etDate);
  let healthBadge = "OK", healthColor = "#10b981", healthDesc = weekendNow ? "All systems nominal (weekend-skip)" : "All systems nominal";
  if (heldDraftCount > 0 && allFresh) { healthBadge = "WARN"; healthColor = "#f59e0b"; healthDesc = `${heldDraftCount} held draft(s) awaiting promotion`; }
  if (!allFresh) { healthBadge = "DEGRADED"; healthColor = "#ef4444"; healthDesc = "Stale or failed data fetches"; }

  const freshRows = freshness.map((x) => {
    const ok = x.status === "fresh";
    const dot = ok ? "<span style='color:#10b981'>OK</span>" : `<span style='color:#ef4444'>${x.status}</span>`;
    return `<tr><td>${dot}</td><td><code>${x.slug}</code></td><td>${x.date || "-"}</td><td>${x.code || ""}</td></tr>`;
  }).join("");

  const pubRows = (recentPublishes || []).map((p) => {
    return `<tr><td><a href="${p.link}" target="_blank">${escapeHtml(p.title)}</a></td><td>${p.category_label}</td><td>${p.date ? p.date.replace("T"," ").slice(0,16) : ""}</td><td><span style="color:#10b981">${p.status}</span></td></tr>`;
  }).join("") || `<tr><td colspan="4" style="color:#7f8aa8">No recent publishes</td></tr>`;

  let draftRows = "";
  let draftSourceNote = "";
  if (!draftQueue.ok) {
    draftRows = `<tr><td colspan="5" style="color:#f59e0b">Cannot list held drafts: ${escapeHtml(draftQueue.error || "no signal source")}.</td></tr>`;
  } else if (heldDraftCount === 0) {
    if (draftQueue.source === "gh-annotations") {
      draftRows = `<tr><td colspan="5" style="color:#7f8aa8">No held drafts detected in recent GH runs (GH-API fallback mode)</td></tr>`;
      draftSourceNote = " <small style='color:#7f8aa8'>(source: GH annotations - WP_BASIC_AUTH not set)</small>";
    } else {
      draftRows = `<tr><td colspan="5" style="color:#7f8aa8">No held drafts (queue empty)</td></tr>`;
    }
  } else {
    if (draftQueue.source === "gh-annotations") {
      draftSourceNote = " <small style='color:#f59e0b'>(source: GH annotations - WP_BASIC_AUTH not set; IDs are GH run IDs not WP post IDs)</small>";
    }
    draftRows = draftQueue.drafts.map((d) => {
      const age = d.modified ? ageString(d.modified) : "-";
      const isWp = d.source !== "gh-annotation";
      const editUrl = isWp ? `https://${WP_SITE}/wp-admin/post.php?post=${d.id}&action=edit` : d.link;
      const retryUrl = isWp ? `https://${WP_SITE}/?p=${d.id}&preview=true` : d.link;
      const editLabel = isWp ? "edit" : "view run";
      const retryLabel = isWp ? "preview" : "rerun";
      return `<tr><td><code style="font-size:11px">${escapeHtml(String(d.id))}</code></td><td>${escapeHtml(d.title)}</td><td>${d.category_label}</td><td>${age}</td><td><a href="${editUrl}" target="_blank">${editLabel}</a> &middot; <a href="${retryUrl}" target="_blank">${retryLabel}</a></td></tr>`;
    }).join("");
  }

  const mpiBlock = mpi.ok
    ? `<div><b>asOf:</b> ${mpi.asOf || "-"} &nbsp; <b>computed_at:</b> ${mpi.computed_at || "-"}<br>
       <b>age:</b> ${mpi.computed_at ? ageString(mpi.computed_at) : "-"} &nbsp; <b>${mpi.score_label}:</b> ${mpi.score ?? "-"}</div>`
    : `<div style="color:#ef4444">Could not fetch data/mpi.json</div>`;

  const logRows = (recentLog || []).slice(-10).reverse().map((l) => `<tr><td><code style="font-size:11px">${escapeHtml(l)}</code></td></tr>`).join("") || `<tr><td style="color:#7f8aa8">No KV log entries</td></tr>`;

  const ghRunRows = (ghRuns || []).map((r) => {
    let concColor = "#7f8aa8";
    if (r.conclusion === "success") concColor = "#10b981";
    if (r.conclusion === "failure" || r.conclusion === "cancelled") concColor = "#ef4444";
    if (r.status === "in_progress" || r.status === "queued") concColor = "#3b82f6";
    return `<tr><td><a href="${r.html_url}" target="_blank">#${r.run_number}</a></td><td>${escapeHtml(r.name)}</td><td>${r.status}</td><td style="color:${concColor}">${r.conclusion || "-"}</td><td>${r.created_at ? r.created_at.replace("T"," ").slice(0,16) : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="5" style="color:#7f8aa8">GH_PAT not set or no runs</td></tr>`;

  const watchdogRow = watchdogLastFire
    ? `<div><b>Last watchdog fire:</b> ${escapeHtml(watchdogLastFire)}</div>`
    : `<div style="color:#7f8aa8">No watchdog events yet (it only fires Mon-Fri 23:00 ET + Sat 09:45 ET)</div>`;

  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AZTMM Pipeline Status</title>
<meta http-equiv="refresh" content="60">
<style>
  *{box-sizing:border-box}
  body{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0b1020;color:#e6e9ff;padding:16px;max-width:1100px;margin:auto;line-height:1.5;}
  h1{margin:0 0 4px;font-size:32px;}
  h2{margin:24px 0 10px;font-size:18px;color:#d8ddff;border-bottom:1px solid #243049;padding-bottom:6px;}
  .badge{display:inline-block;padding:6px 14px;border-radius:6px;font-weight:700;letter-spacing:0.5px;color:#fff;font-size:14px;}
  .badge-desc{color:#7f8aa8;font-size:13px;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th,td{padding:8px 10px;border-bottom:1px solid #243049;text-align:left;vertical-align:top;}
  th{color:#7f8aa8;font-weight:600;text-transform:uppercase;letter-spacing:1px;font-size:10px;background:#0f1530;}
  a{color:#6da9ff;text-decoration:none;}
  a:hover{text-decoration:underline}
  code{background:#0f1530;padding:1px 5px;border-radius:3px;color:#a1c4ff;font-size:12px;}
  .panel{background:#0f1530;border:1px solid #1d2745;border-radius:8px;padding:12px 16px;margin-bottom:6px;}
  .grid{display:grid;grid-template-columns:1fr;gap:12px}
  @media (min-width:900px){.grid{grid-template-columns:1fr 1fr}}
  small{color:#7f8aa8;}
  .meta{color:#7f8aa8;font-size:12px;margin-bottom:8px}
  footer{margin-top:32px;color:#7f8aa8;font-size:11px;text-align:center;padding-top:16px;border-top:1px solid #243049;}
</style>
<header>
  <h1>AZTMM Pipeline <span class="badge" style="background:${healthColor}">${healthBadge}</span></h1>
  <div class="badge-desc">${escapeHtml(healthDesc)}</div>
  <div class="meta">As of ${etDate} ET &middot; probe ${elapsedMs}ms &middot; auto-refresh 60s</div>
</header>

<div class="grid">
  <section class="panel">
    <h2 style="margin-top:0">Data freshness</h2>
    <table><thead><tr><th>Status</th><th>Tracker</th><th>asOf</th><th>Code</th></tr></thead><tbody>${freshRows}</tbody></table>
  </section>
  <section class="panel">
    <h2 style="margin-top:0">MPI freshness</h2>
    ${mpiBlock}
  </section>
</div>

<section class="panel">
  <h2>Held drafts queue ${heldDraftCount > 0 ? `<span style="color:#f59e0b">(${heldDraftCount})</span>` : ""}${draftSourceNote}</h2>
  <small>Drafts that failed the quality gate. Watchdog retries automatically at 23:00 ET (daily) / Sat 09:45 ET (weekly).</small>
  <table><thead><tr><th>ID</th><th>Title</th><th>Cat</th><th>Age</th><th>Actions</th></tr></thead><tbody>${draftRows}</tbody></table>
</section>

<section class="panel">
  <h2>Last 5 publishes</h2>
  <table><thead><tr><th>Title</th><th>Cat</th><th>Date</th><th>Status</th></tr></thead><tbody>${pubRows}</tbody></table>
</section>

<div class="grid">
  <section class="panel">
    <h2 style="margin-top:0">Recent GH Actions runs</h2>
    <table><thead><tr><th>#</th><th>Workflow</th><th>Status</th><th>Conclusion</th><th>Created</th></tr></thead><tbody>${ghRunRows}</tbody></table>
  </section>
  <section class="panel">
    <h2 style="margin-top:0">Watchdog + Resend</h2>
    ${watchdogRow}
    <div style="margin-top:8px"><b>Resend:</b> ${resendStatus}</div>
  </section>
</div>

<section class="panel">
  <h2>Recent CF Worker activity (last 10)</h2>
  <table><tbody>${logRows}</tbody></table>
</section>

<footer>
  Endpoints: <a href="/">/</a> &middot; <a href="/freshness">/freshness</a> &middot; <a href="/draft-queue">/draft-queue</a> &middot; <a href="/log">/log</a>
  <br>aztmm-cron-v2 worker.js v2.12 &middot; two-phase publish + tracker-staleness watchdog (weekday 18:30 + Mon 10:00)
</footer>`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ageString(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const sec = (Date.now() - d.getTime()) / 1000;
    if (sec < 60) return `${sec.toFixed(0)}s ago`;
    if (sec < 3600) return `${(sec/60).toFixed(0)}m ago`;
    if (sec < 86400) return `${(sec/3600).toFixed(1)}h ago`;
    return `${(sec/86400).toFixed(1)}d ago`;
  } catch (_) { return iso; }
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runTick(env, "cron"));
  },

  async fetch(request, env, ctx) {
    globalThis.__WORKER_ENV__ = env;
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    if (url.pathname === "/") {
      const now = new Date();
      const et = getETParts(now);
      const etDate = getETDateStr(now);
      const next = selectWorkflows(et);
      return Response.json({
        ok: true, worker: "aztmm-cron", version: "2.12", utc: now.toISOString(),
        etDate, etHour: et.hour, etMinute: et.minute, weekday: et.dow,
        wouldDispatchRightNow: next,
        info: "GET /status | GET /draft-queue | GET /freshness | GET /mpi-health | GET /log | POST /run?token=..."
      });
    }

    if (url.pathname === "/log") {
      if (!env.KV) return new Response("KV not bound", { status: 503 });
      const log = (await env.KV.get("triggers")) || "(empty)";
      return new Response(log, { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === "/freshness") {
      const now = new Date();
      const etDate = getETDateStr(now);
      const t0 = Date.now();
      const r = await runFreshnessWatch(env, etDate);
      const elapsedMs = Date.now() - t0;
      return new Response(JSON.stringify({ etDate, elapsedMs, results: r }), {
        status: 200, headers: { "content-type": "application/json", ...corsHeaders() }
      });
    }

    if (url.pathname === "/mpi-health") {
      // v2.10: dedicated MPI freshness endpoint exposing both axes (asOf, computed_at).
      const now = new Date();
      const etDate = getETDateStr(now);
      const mpiTarget = FRESHNESS_TARGETS.find((t) => t.slug === "mpi");
      const result = mpiTarget
        ? await checkMpiTarget(env, mpiTarget, etDate)
        : { status: "error", error: "mpi target not configured" };
      const etParts = getETParts(now);
      return new Response(JSON.stringify({
        etDate,
        etHour: etParts.hour,
        etMinute: etParts.minute,
        utc: now.toISOString(),
        worker_version: "2.12",
        explanation: "asOf = last completed trading bar; computed_at = pipeline last successful run. STALE only if BOTH are stale, or weekday post-close bar didn't advance.",
        result
      }, null, 2), {
        status: 200, headers: { "content-type": "application/json", ...corsHeaders() }
      });
    }

    if (url.pathname === "/draft-queue") {
      const dq = await fetchDraftQueue();
      return new Response(JSON.stringify(dq, null, 2), { status: 200, headers: { "content-type": "application/json", ...corsHeaders() } });
    }

    if (url.pathname === "/status" || url.pathname === "/health") {
      const now = new Date();
      const etDate = getETDateStr(now);
      const t0 = Date.now();
      const [freshness, recentPublishes, draftQueue, mpi, ghRuns, kvLog] = await Promise.all([
        runFreshnessWatch(env, etDate),
        fetchRecentPublishes(),
        fetchDraftQueue(),
        fetchMpiFreshness(env),
        fetchGHRecentRuns(env),
        env.KV ? env.KV.get("triggers") : Promise.resolve("")
      ]);
      const elapsedMs = Date.now() - t0;
      const recentLog = (kvLog || "").split("\n").filter(Boolean);
      const watchdogLastFire = recentLog.slice().reverse().find((l) => l.includes("[watchdog-")) || null;
      const resendStatus = env.RESEND_API_KEY ? "<span style='color:#10b981'>configured</span>" : "<span style='color:#f59e0b'>not configured on worker</span> (only GH Actions has it)";
      const html = renderStatusPage({
        etDate, freshness, recentPublishes, draftQueue, mpi, recentLog, ghRuns, resendStatus, watchdogLastFire, elapsedMs
      });
      return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...corsHeaders() } });
    }

    if (url.pathname === "/run" && request.method === "POST") {
      if (env.MANUAL_TOKEN && url.searchParams.get("token") !== env.MANUAL_TOKEN) return new Response("forbidden", { status: 403 });
      const body = await request.json().catch(() => ({}));
      if (body.workflow) {
        const r2 = await dispatchWorkflow(env, body.workflow, body.inputs || null);
        return Response.json(r2);
      }
      const r = await runTick(env, "manual");
      return Response.json(r);
    }

    return new Response("not found", { status: 404 });
  }
};
