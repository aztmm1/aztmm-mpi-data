/**
 * AZTMM Cloudflare Worker — GH Actions cron backup (v2.2)
 *
 * Solves the GH Actions scheduler-dormancy problem.
 * GH Actions cron triggers go silent on low-activity repos. CF Workers do not.
 *
 * Schedule: cron fires every 15 minutes weekdays. Worker computes current ET
 * time and dispatches workflows that match the time window. Each workflow has
 * its own idempotency guard, so duplicate dispatches are safe.
 *
 * Time windows (all weekday, America/New_York):
 *   09:00–09:29  → MPI morning update (mpi-update.yml)
 *   16:30–16:59  → MPI close update (mpi-update.yml)
 *   17:10–17:59  → 4 EOD trackers:
 *                   - daily-pulse-v2.yml
 *                   - congress-watch.yml
 *                   - options-gravity.yml
 *                   - squeeze-watch.yml
 *
 * v2.1: freshness watchdog now does a data-freshness check (not just date).
 *       Each tracker's "key numbers" are extracted from today's latest.json
 *       and yesterday's dated file. Identical numbers => STALE_DATA flag.
 *
 * v2.2: MPI added to FRESHNESS_TARGETS with value-hash check on the
 *       core market numbers (spy_spot, vix, vix3m). Yesterday's hash is
 *       stored in KV (key `<slug>:yesterdayValueHash`) and compared to
 *       today's. Identical => STALE_DATA. Catches the wall-clock-fresh
 *       but data-stale scenario from the 2026-05-14 incident (mpi.json
 *       asOf=today but SPY/VIX values were yesterday's because the
 *       close-cron fired before CBOE/SA had published the EOD bar).
 *       Also supports an optional `path` override on target so files
 *       outside the standard `<slug>/sample-output/<file>` layout
 *       (e.g. data/mpi.json) can be watched.
 *
 * Bindings + secrets (set in CF dashboard or `wrangler secret put`):
 *   GH_PAT             — fine-grained PAT, scopes: Actions read+write on
 *                        aztmm-mpi-data (or classic PAT with `repo` + `workflow`)
 *   HEALTHCHECKS_URL   — optional, e.g. https://hc-ping.com/<uuid>
 *   MANUAL_TOKEN       — optional, required for HTTP POST /run manual triggers
 *
 * KV namespace binding "KV" stores last 200 trigger events.
 */

const GH_OWNER = "aztmm1";
const GH_REPO  = "aztmm-mpi-data";
const USER_AGENT = "AZTMM-CF-Worker/2.2";

// Workflow file names (active workflows in .github/workflows/)
const WORKFLOWS = {
  mpi:            "mpi-update.yml",
  dailyPulse:     "daily-pulse-v2.yml",
  congress:       "congress-watch.yml",
  optionsGravity: "options-gravity.yml",
  squeeze:        "squeeze-watch.yml",
  insiderActivity: "insider-activity.yml",
  earningsFlow:   "earnings-flow.yml",
};

// Trackers we watch for freshness. cadence = "daily" (date must equal today ET)
// or "weekly" (date must be within last 7 days ET). Watchdog runs at 17:55 ET weekdays.
// yesterdayFile is a function(prevDate) -> filename for the prior-day artifact used
// in the stale-data comparison. If not present, the stale-data check is skipped.
const FRESHNESS_TARGETS = [
  {
    slug: "aztmm-daily-pulse-v2",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `daily-pulse-${d}.html`,
    yesterdayFileIsText: true,
  },
  {
    slug: "congress-trades-tracker",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `congress-${d}.public.json`,
  },
  {
    slug: "nope-max-pain-tracker",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `nope-maxpain-${d}.public.json`,
  },
  {
    slug: "squeeze-watch",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `squeeze-${d}.public.json`,
  },
  {
    slug: "earnings-flow-flag-tracker",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `earnings-flow-${d}.public.json`,
  },
  {
    slug: "insider-activity-tracker",
    file: "latest.json",
    dateKeys: ["weekEnding", "week_ending", "asOf", "as_of", "date"],
    cadence: "weekly",
    // weekly cadence: prior file is the previous week_ending. Skipped on
    // weekday runs since data only changes once per week.
    yesterdayFile: null,
  },
  // MPI lives at data/mpi.json (not under <slug>/sample-output/...), so we
  // provide an explicit `path` override. Value-hash check compares today's
  // SPY/VIX/VIX3M against yesterday's stored hash in KV — catches the
  // data-stale-but-clock-fresh scenario where asOf is today but the
  // underlying market values are still yesterday's bars. (Ref: 2026-05-14
  // incident — close-cron at 16:30 ET fired before EOD publish, so mpi.json
  // reported the prior session's closes with asOf=today.)
  {
    slug: "mpi",
    path: "data/mpi.json",
    file: "mpi.json",
    dateKeys: ["asOf"],
    cadence: "daily",
    yesterdayFile: null,
    valueHashKeys: ["data.market.spy_spot", "data.volatility.vix", "data.volatility.vix3m"],
  },
];

// Per-tracker key-numbers extractors. Return a "|" joined string of stable
// fingerprints from each payload. Empty / null parts are filtered. If today's
// fingerprint equals yesterday's AND is non-empty, the watchdog flags STALE_DATA.
//
// IMPORTANT: do NOT include the date, generated_at, as_of, etc — those change
// every run even on cached data and would defeat the check.
const FRESHNESS_KEY_NUMBERS = {
  "aztmm-daily-pulse-v2": (data) => {
    // data may be the parsed latest.json (payload.content HTML) OR a raw HTML
    // string (dated .html sibling). The two pipelines render different markup,
    // so we use tag-agnostic regexes that look at the FIRST $X.XX[BMK] near
    // each label.
    let c = "";
    if (typeof data === "string") {
      c = data;
    } else {
      const p = (data && data.payload) || data || {};
      c = (p && p.content) || "";
    }
    // Strip HTML tags so the same regex works on both renderings.
    const stripped = c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const m1 = stripped.match(/Call premium[^$]*\$([\d.]+[BMK]?)/i);
    const m2 = stripped.match(/Put premium[^$]*\$([\d.]+[BMK]?)/i);
    const m3 = stripped.match(/P[\\/-]?C(?:\s*volume)?\s*ratio[^\d]*([\d.]+)/i) || stripped.match(/Put\/Call volume ratio[^\d]*([\d.]+)/i);
    return [m1 && m1[1], m2 && m2[1], m3 && m3[1]].filter(Boolean).join("|");
  },
  "congress-trades-tracker": (data) => {
    const s = (data && data.summary) || {};
    const vals = [s.filings_today, s.members_today, s.tickers_today, s.large_filings_today];
    // If all four counts are zero/missing, treat as "nothing to compare" — a quiet
    // Congress day is a valid state, not a stale-data signal. Return empty so the
    // watchdog skips the equality flag.
    const anyNonZero = vals.some((v) => typeof v === "number" && v > 0);
    if (!anyNonZero) return "";
    return vals.filter((v) => v !== undefined && v !== null).join("|");
  },
  "nope-max-pain-tracker": (data) => {
    const tickers = (data && data.tickers) || [];
    const findT = (sym) => tickers.find((t) => t && t.ticker === sym) || {};
    const spy = findT("SPY"); const qqq = findT("QQQ");
    return [spy.nope, spy.max_pain, spy.spot, qqq.nope, qqq.max_pain].filter((v) => v !== undefined && v !== null).join("|");
  },
  "squeeze-watch": (data) => {
    const r0 = (data && data.rows && data.rows[0]) || {};
    const r1 = (data && data.rows && data.rows[1]) || {};
    return [data && data.summary_line, r0.ticker, r0.short_interest_pct_float_fmt, r0.alert_count, r1.ticker].filter((v) => v !== undefined && v !== null && v !== "").join("|");
  },
  "earnings-flow-flag-tracker": (data) => {
    const r0 = (data && data.rows && data.rows[0]) || {};
    const tt = (data && data.tape_totals) || {};
    return [data && data.summary_line, r0.ticker, r0.alert_count, r0.total_premium_fmt, tt.flagged_names].filter((v) => v !== undefined && v !== null && v !== "").join("|");
  },
  "insider-activity-tracker": (data) => {
    const tt = (data && data.tape_totals) || {};
    return [data && data.summary_line, tt.total_filings, tt.total_buy_value_fmt, tt.total_sell_value_fmt].filter((v) => v !== undefined && v !== null && v !== "").join("|");
  },
  // MPI: extract spy_spot / vix / vix3m for KV-based day-over-day comparison.
  // Returns a "|" joined string of fingerprint values.
  "mpi": (data) => {
    const d = (data && data.data) || {};
    const m = d.market || {}; const v = d.volatility || {};
    return [m.spy_spot, v.vix, v.vix3m].filter((x) => x !== undefined && x !== null).join("|");
  },
};

const RAW_BASE = "https://raw.githubusercontent.com/aztmm1/aztmm-mpi-data/main";

// ----- ET time helpers -----
function getETParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = get("weekday");
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour, minute, dow: weekdayMap[weekday] ?? -1 };
}

function getETDateStr(date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

// "2026-05-13" -> "2026-05-12". Always subtracts 1 calendar day in UTC; not ET-aware,
// but the date string is ET-derived so we just shift by -1 day in JS time math.
function prevDateStr(etDate) {
  const d = new Date(etDate + "T12:00:00Z"); // noon UTC anchor to avoid TZ edges
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ----- GitHub helpers -----
async function dispatchWorkflow(env, workflowFile) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflowFile}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  return {
    workflow: workflowFile,
    status: res.status,
    ok: res.ok,
    text: res.ok ? "" : (await res.text()).slice(0, 300),
  };
}

// Fetch + decode a JSON file from the repo via Contents API (no CDN cache).
// Returns { ok, data, status } where data is the parsed JSON object or null.
async function fetchRepoJson(env, path) {
  const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=main`;
  try {
    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${env.GH_PAT}`,
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) return { ok: false, data: null, status: res.status };
    const meta = await res.json();
    const decoded = meta.content ? atob(meta.content.replace(/\n/g, "")) : "";
    const data = decoded ? JSON.parse(decoded) : null;
    return { ok: true, data, status: 200 };
  } catch (e) {
    return { ok: false, data: null, status: 0, error: String(e) };
  }
}

// Like fetchRepoJson but returns the decoded text (used for HTML files).
async function fetchRepoText(env, path) {
  const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}?ref=main`;
  try {
    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${env.GH_PAT}`,
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) return { ok: false, data: null, status: res.status };
    const meta = await res.json();
    const decoded = meta.content ? atob(meta.content.replace(/\n/g, "")) : "";
    return { ok: true, data: decoded, status: 200 };
  } catch (e) {
    return { ok: false, data: null, status: 0, error: String(e) };
  }
}

// ----- KV log -----
async function appendLog(env, line) {
  if (!env.KV) return;
  try {
    const prev = (await env.KV.get("triggers")) || "";
    const lines = (prev + line + "\n").split("\n");
    const trimmed = lines.slice(-200).join("\n");
    await env.KV.put("triggers", trimmed);
  } catch (_) { /* fail open */ }
}

async function pingHealthchecks(env, suffix = "") {
  if (!env.HEALTHCHECKS_URL) return;
  try {
    const u = suffix ? `${env.HEALTHCHECKS_URL}${suffix}` : env.HEALTHCHECKS_URL;
    await fetch(u, { method: "GET", headers: { "User-Agent": USER_AGENT } });
  } catch (_) { /* fail open */ }
}

// ----- which workflows to dispatch right now -----
function selectWorkflows(et) {
  const { hour, minute, dow } = et;
  const isWeekday = dow >= 1 && dow <= 5;
  if (!isWeekday) return [];

  const selected = [];
  if (hour === 9 && minute < 30) selected.push(WORKFLOWS.mpi);
  if (hour === 16 && minute >= 30) selected.push(WORKFLOWS.mpi);
  if (hour === 17 && minute >= 10 && minute < 50) {
    selected.push(
      WORKFLOWS.dailyPulse,
      WORKFLOWS.congress,
      WORKFLOWS.optionsGravity,
      WORKFLOWS.squeeze,
      WORKFLOWS.earningsFlow,
    );
  }
  // Friday-only: insider activity (weekly cadence)
  if (et.dow === 5 && hour === 17 && minute >= 10 && minute < 50) {
    selected.push(WORKFLOWS.insiderActivity);
  }
  return selected;
}

// Per-target check: today's latest.json + (optionally) yesterday's dated file.
// Returns a result object suitable for inclusion in the /freshness response.
async function checkTarget(env, target, etDate) {
  // Allow `path` override for targets that live outside the standard
  // `<slug>/sample-output/<file>` layout (e.g. MPI at data/mpi.json).
  const todayPath = target.path || `${target.slug}/sample-output/${target.file}`;
  const yesterdayDate = prevDateStr(etDate);
  const yesterdayPath = (target.cadence === "daily" && target.yesterdayFile)
    ? `${target.slug}/sample-output/${target.yesterdayFile(yesterdayDate)}`
    : null;

  // Parallel fetch: today + (optional) yesterday.
  const yesterdayFetcher = (target.yesterdayFileIsText ? fetchRepoText : fetchRepoJson);
  const [todayRes, yResRaw] = await Promise.all([
    fetchRepoJson(env, todayPath),
    yesterdayPath ? yesterdayFetcher(env, yesterdayPath) : Promise.resolve(null),
  ]);

  if (!todayRes.ok) {
    return { slug: target.slug, status: "fetch_failed", code: todayRes.status };
  }
  const data = todayRes.data;

  // Date extraction (unchanged from v2.0).
  let foundDate = null;
  for (const k of target.dateKeys) {
    if (data && typeof data === "object" && data[k]) { foundDate = String(data[k]).slice(0, 10); break; }
  }
  if (!foundDate && data && data.payload) {
    const text = (data.payload.title || "") + " " + (data.payload.content || "");
    const m = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) foundDate = m[1];
  }
  if (!foundDate) {
    const m = JSON.stringify(data).match(/"(?:date|asOf|as_of|as_of_date|target_date|run_date)":\s*"(\d{4}-\d{2}-\d{2})/);
    if (m) foundDate = m[1];
  }

  // Stale-data fingerprint comparison (v2.1).
  let todayHash = null;
  let yesterdayHash = null;
  let numbersMatched = false;
  let staleDataReason = null;
  const extractor = FRESHNESS_KEY_NUMBERS[target.slug];
  if (extractor) {
    try { todayHash = extractor(data) || null; } catch (_) { todayHash = null; }
    if (yResRaw && yResRaw.ok && yResRaw.data) {
      try { yesterdayHash = extractor(yResRaw.data) || null; } catch (_) { yesterdayHash = null; }
      if (todayHash && yesterdayHash && todayHash === yesterdayHash) {
        numbersMatched = true;
        staleDataReason = "key_numbers_identical_to_yesterday";
      }
    }
  }

  // v2.2: KV-based value-hash check.
  // For targets with valueHashKeys (e.g. MPI), compute today's fingerprint
  // from the listed dot-paths and compare to yesterday's value stored in
  // KV at `<slug>:yesterdayValueHash`. This catches the data-stale-but-
  // clock-fresh scenario where wall-clock asOf is fresh but underlying
  // market values are stale (cf. 2026-05-14 incident).
  if (target.valueHashKeys && Array.isArray(target.valueHashKeys) && env.KV) {
    try {
      const dig = (obj, dotPath) => {
        const parts = dotPath.split(".");
        let cur = obj;
        for (const p of parts) {
          if (cur == null || typeof cur !== "object") return undefined;
          cur = cur[p];
        }
        return cur;
      };
      const parts = target.valueHashKeys.map((k) => {
        const v = dig(data, k);
        return (v === undefined || v === null) ? "" : String(v);
      });
      const todayValueHash = parts.join("|");
      const kvKey = `${target.slug}:yesterdayValueHash`;
      const prior = await env.KV.get(kvKey);
      if (prior && todayValueHash && prior === todayValueHash) {
        numbersMatched = true;
        staleDataReason = "value_hash_identical_to_yesterday_kv";
        // Surface in the result fingerprints too.
        todayHash = todayHash || todayValueHash;
        yesterdayHash = yesterdayHash || prior;
      }
      // Store today's hash for tomorrow's comparison (7-day TTL).
      if (todayValueHash) {
        await env.KV.put(kvKey, todayValueHash, { expirationTtl: 7 * 24 * 3600 });
      }
    } catch (_) { /* fail open */ }
  }

  // Status logic.
  if (!foundDate) {
    return { slug: target.slug, status: "no_date_field", todayHash, yesterdayHash, numbersMatched };
  }

  // Date OK + numbers identical to yesterday => STALE_DATA.
  if (foundDate === etDate && numbersMatched) {
    return {
      slug: target.slug, status: "STALE_DATA", date: foundDate,
      todayHash, yesterdayHash, numbersMatched, reason: staleDataReason,
    };
  }

  if (foundDate === etDate) {
    return { slug: target.slug, status: "fresh", date: foundDate, todayHash, yesterdayHash, numbersMatched };
  }

  // Date mismatch — weekly cadence allows up to 7 days old.
  if ((target.cadence || "daily") === "weekly") {
    const today = new Date(etDate + "T00:00:00Z");
    const got = new Date(foundDate + "T00:00:00Z");
    const ageDays = (today - got) / (1000 * 60 * 60 * 24);
    if (ageDays >= 0 && ageDays <= 7) {
      return { slug: target.slug, status: "fresh", date: foundDate, cadence: "weekly", ageDays, todayHash, yesterdayHash, numbersMatched };
    }
    return { slug: target.slug, status: "STALE", date: foundDate, expected: etDate, cadence: "weekly", ageDays, todayHash, yesterdayHash, numbersMatched };
  }

  return { slug: target.slug, status: "STALE", date: foundDate, expected: etDate, todayHash, yesterdayHash, numbersMatched };
}

// ----- daily freshness watchdog -----
// Fires at 17:55 ET — 45 min after the 17:10 dispatch window.
// v2.1: data-freshness in addition to date-freshness.
async function runFreshnessWatch(env, etDate) {
  // Per-target checks run in parallel so total wall time stays well under 5s.
  const results = await Promise.all(
    FRESHNESS_TARGETS.map((t) => checkTarget(env, t, etDate).catch((e) => ({
      slug: t.slug, status: "error", error: String(e),
    })))
  );
  const stale = results.filter((r) => r.status === "STALE");
  const staleData = results.filter((r) => r.status === "STALE_DATA");
  const fresh = results.filter((r) => r.status === "fresh");
  await appendLog(
    env,
    `${new Date().toISOString()} ${etDate} ET=17:55 [freshness-watch] checked=${results.length} fresh=${fresh.length} STALE=${stale.length} STALE_DATA=${staleData.length} ` +
    JSON.stringify([...stale, ...staleData])
  );
  if (stale.length > 0 || staleData.length > 0) {
    await pingHealthchecks(env, "/fail");
  }
  return results;
}

// ----- core tick -----
async function runTick(env, source = "cron") {
  const now = new Date();
  const et = getETParts(now);
  const etDate = getETDateStr(now);
  const stamp = now.toISOString();

  // Freshness watchdog window: weekday 17:50–17:59 ET (one tick per day)
  if (et.dow >= 1 && et.dow <= 5 && et.hour === 17 && et.minute >= 50 && et.minute < 60) {
    const fresh = await runFreshnessWatch(env, etDate);
    // Continue to dispatch logic below in case we're at the boundary
  }

  const workflows = selectWorkflows(et);
  const result = {
    timestamp: stamp,
    etDate,
    etHour: et.hour,
    etMinute: et.minute,
    dow: et.dow,
    source,
    workflowsTriggered: [],
    workflowsSkipped: [],
  };

  if (workflows.length === 0) {
    await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,'0')} dow=${et.dow} [${source}] NO_MATCH`);
    return result;
  }

  for (const wf of workflows) {
    try {
      const r = await dispatchWorkflow(env, wf);
      if (r.ok) {
        result.workflowsTriggered.push({ wf, status: r.status });
        await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,'0')} [${source}] DISPATCH ${wf} -> ${r.status}`);
      } else {
        result.workflowsSkipped.push({ wf, status: r.status, error: r.text });
        await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,'0')} [${source}] FAIL ${wf} -> ${r.status} ${r.text}`);
      }
    } catch (e) {
      result.workflowsSkipped.push({ wf, error: String(e) });
      await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,'0')} [${source}] ERROR ${wf} -> ${e}`);
    }
  }

  await pingHealthchecks(env);
  return result;
}

// ----- worker entry points -----
export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runTick(env, "cron"));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      const now = new Date();
      const et = getETParts(now);
      const etDate = getETDateStr(now);
      const next = selectWorkflows(et);
      return Response.json({
        ok: true,
        worker: "aztmm-cron",
        version: "2.2",
        utc: now.toISOString(),
        etDate,
        etHour: et.hour,
        etMinute: et.minute,
        weekday: et.dow,
        wouldDispatchRightNow: next,
        info: "POST /run?token=... with body { workflow?: 'name.yml' } for manual trigger. GET /log for last 200 events. GET /freshness for date+data freshness audit.",
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
      return Response.json({ etDate, elapsedMs, results: r });
    }

    if (url.pathname === "/run" && request.method === "POST") {
      if (env.MANUAL_TOKEN && url.searchParams.get("token") !== env.MANUAL_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      const body = await request.json().catch(() => ({}));
      if (body.workflow) {
        const r = await dispatchWorkflow(env, body.workflow);
        return Response.json(r);
      }
      const r = await runTick(env, "manual");
      return Response.json(r);
    }

    return new Response("not found", { status: 404 });
  },
};
