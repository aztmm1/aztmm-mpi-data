// AZTMM CF Worker v2.3 ‚Äî drop-in replacement for cloudflare-cron-trigger/worker.js
// Patches vs v2.2:
//   - freshness READS now use raw.githubusercontent.com (no PAT, no rate limit)
//   - /freshness response has CORS headers (Access-Control-Allow-Origin: *)
//   - dispatchWorkflow (writes) still uses GH_PAT ‚Äî unchanged
//
// Deploy:
//   cd cloudflare-cron-trigger && wrangler deploy
//   (or paste into Cloudflare dashboard ‚Üí Workers ‚Üí aztmm-cron-v2 ‚Üí Edit code)

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var GH_OWNER = "aztmm1";
var GH_REPO = "aztmm-mpi-data";
var USER_AGENT = "AZTMM-CF-Worker/2.3";
var RAW_BASE = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main`;

var WORKFLOWS = {
  mpi: "mpi-update.yml",
  dailyPulse: "daily-pulse-v2.yml",
  congress: "congress-watch.yml",
  optionsGravity: "options-gravity.yml",
  squeeze: "squeeze-watch.yml",
  insiderActivity: "insider-activity.yml",
  earningsFlow: "earnings-flow.yml"
};

var FRESHNESS_TARGETS = [
  {
    slug: "aztmm-daily-pulse-v2",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `daily-pulse-${d}.html`,
    yesterdayFileIsText: true
  },
  {
    slug: "congress-trades-tracker",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `congress-${d}.public.json`
  },
  {
    slug: "nope-max-pain-tracker",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `nope-maxpain-${d}.public.json`
  },
  {
    slug: "squeeze-watch",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `squeeze-${d}.public.json`
  },
  {
    slug: "earnings-flow-flag-tracker",
    file: "latest.json",
    dateKeys: ["date", "asOf", "as_of"],
    cadence: "daily",
    yesterdayFile: (d) => `earnings-flow-${d}.public.json`
  },
  {
    slug: "insider-activity-tracker",
    file: "latest.json",
    dateKeys: ["weekEnding", "week_ending", "asOf", "as_of", "date"],
    cadence: "weekly",
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
    else {
      const p = (data && data.payload) || data || {};
      c = (p && p.content) || "";
    }
    const stripped = c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const m1 = stripped.match(/Call premium[^$]*\$([\d.]+[BMK]?)/i);
    const m2 = stripped.match(/Put premium[^$]*\$([\d.]+[BMK]?)/i);
    const m3 = stripped.match(/P[\\/-]?C(?:\s*volume)?\s*ratio[^\d]*([\d.]+)/i) || stripped.match(/Put\/Call volume ratio[^\d]*([\d.]+)/i);
    return [m1 && m1[1], m2 && m2[1], m3 && m3[1]].filter(Boolean).join("|");
  },
  "congress-trades-tracker": (data) => {
    const s = (data && data.summary) || {};
    const vals = [s.filings_today, s.members_today, s.tickers_today, s.large_filings_today];
    const anyNonZero = vals.some((v) => typeof v === "number" && v > 0);
    if (!anyNonZero) return "";
    return vals.filter((v) => v !== void 0 && v !== null).join("|");
  },
  "nope-max-pain-tracker": (data) => {
    const tickers = (data && data.tickers) || [];
    const findT = (sym) => tickers.find((t) => t && t.ticker === sym) || {};
    const spy = findT("SPY");
    const qqq = findT("QQQ");
    return [spy.nope, spy.max_pain, spy.spot, qqq.nope, qqq.max_pain].filter((v) => v !== void 0 && v !== null).join("|");
  },
  "squeeze-watch": (data) => {
    const r0 = (data && data.rows && data.rows[0]) || {};
    const r1 = (data && data.rows && data.rows[1]) || {};
    return [data && data.summary_line, r0.ticker, r0.short_interest_pct_float_fmt, r0.alert_count, r1.ticker].filter((v) => v !== void 0 && v !== null && v !== "").join("|");
  },
  "earnings-flow-flag-tracker": (data) => {
    const r0 = (data && data.rows && data.rows[0]) || {};
    const tt = (data && data.tape_totals) || {};
    return [data && data.summary_line, r0.ticker, r0.alert_count, r0.total_premium_fmt, tt.flagged_names].filter((v) => v !== void 0 && v !== null && v !== "").join("|");
  },
  "insider-activity-tracker": (data) => {
    const tt = (data && data.tape_totals) || {};
    return [data && data.summary_line, tt.total_filings, tt.total_buy_value_fmt, tt.total_sell_value_fmt].filter((v) => v !== void 0 && v !== null).join("|");
  },
  "mpi": (data) => {
    const d = (data && data.data) || {};
    const m = d.market || {};
    const v = d.volatility || {};
    return [m.spy_spot, v.vix, v.vix3m].filter((x) => x !== void 0 && x !== null).join("|");
  }
};

function getETParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function prevDateStr(etDate) {
  const d = new Date(etDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function dispatchWorkflow(env, workflowFile) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${workflowFile}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_PAT}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ref: "main" })
  });
  return { workflow: workflowFile, status: res.status, ok: res.ok, text: res.ok ? "" : (await res.text()).slice(0, 300) };
}

// === v2.3: raw.githubusercontent.com ‚Äî no PAT, no contents-API rate limit ===
async function fetchRepoJson(_env, path) {
  try {
    const res = await fetch(`${RAW_BASE}/${path}?cb=${Date.now()}`, {
      headers: { "User-Agent": USER_AGENT },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!res.ok) return { ok: false, data: null, status: res.status };
    const data = await res.json();
    return { ok: true, data, status: 200 };
  } catch (e) {
    return { ok: false, data: null, status: 0, error: String(e) };
  }
}

async function fetchRepoText(_env, path) {
  try {
    const res = await fetch(`${RAW_BASE}/${path}?cb=${Date.now()}`, {
      headers: { "User-Agent": USER_AGENT },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!res.ok) return { ok: false, data: null, status: res.status };
    const data = await res.text();
    return { ok: true, data, status: 200 };
  } catch (e) {
    return { ok: false, data: null, status: 0, error: String(e) };
  }
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
  const isWeekday = dow >= 1 && dow <= 5;
  if (!isWeekday) return [];
  const selected = [];
  if (hour === 9 && minute < 30) selected.push(WORKFLOWS.mpi);
  if (hour === 16 && minute >= 30) selected.push(WORKFLOWS.mpi);
  if (hour === 17 && minute >= 10 && minute < 50) {
    selected.push(WORKFLOWS.dailyPulse, WORKFLOWS.congress, WORKFLOWS.optionsGravity, WORKFLOWS.squeeze, WORKFLOWS.earningsFlow);
  }
  if (et.dow === 5 && hour === 17 && minute >= 10 && minute < 50) {
    selected.push(WORKFLOWS.insiderActivity);
  }
  return selected;
}

async function checkTarget(env, target, etDate) {
  const todayPath = target.path || `${target.slug}/sample-output/${target.file}`;
  const yesterdayDate = prevDateStr(etDate);
  const yesterdayPath = target.cadence === "daily" && target.yesterdayFile
    ? `${target.slug}/sample-output/${target.yesterdayFile(yesterdayDate)}`
    : null;
  const yesterdayFetcher = target.yesterdayFileIsText ? fetchRepoText : fetchRepoJson;
  const [todayRes, yResRaw] = await Promise.all([
    fetchRepoJson(env, todayPath),
    yesterdayPath ? yesterdayFetcher(env, yesterdayPath) : Promise.resolve(null)
  ]);
  if (!todayRes.ok) return { slug: target.slug, status: "fetch_failed", code: todayRes.status };
  const data = todayRes.data;
  let foundDate = null;
  for (const k of target.dateKeys) {
    if (data && typeof data === "object" && data[k]) {
      foundDate = String(data[k]).slice(0, 10);
      break;
    }
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
  if (target.valueHashKeys && Array.isArray(target.valueHashKeys) && env.KV) {
    try {
      const dig = (obj, dotPath) => {
        const parts2 = dotPath.split(".");
        let cur = obj;
        for (const p of parts2) {
          if (cur == null || typeof cur !== "object") return void 0;
          cur = cur[p];
        }
        return cur;
      };
      const parts = target.valueHashKeys.map((k) => {
        const v = dig(data, k);
        return v === void 0 || v === null ? "" : String(v);
      });
      const todayValueHash = parts.join("|");
      const kvKey = `${target.slug}:yesterdayValueHash`;
      const prior = await env.KV.get(kvKey);
      if (prior && todayValueHash && prior === todayValueHash) {
        numbersMatched = true;
        staleDataReason = "value_hash_identical_to_yesterday_kv";
        todayHash = todayHash || todayValueHash;
        yesterdayHash = yesterdayHash || prior;
      }
      if (todayValueHash) await env.KV.put(kvKey, todayValueHash, { expirationTtl: 7 * 24 * 3600 });
    } catch (_) {}
  }
  if (!foundDate) return { slug: target.slug, status: "no_date_field", todayHash, yesterdayHash, numbersMatched };
  if (foundDate === etDate && numbersMatched) {
    return { slug: target.slug, status: "STALE_DATA", date: foundDate, todayHash, yesterdayHash, numbersMatched, reason: staleDataReason };
  }
  if (foundDate === etDate) return { slug: target.slug, status: "fresh", date: foundDate, todayHash, yesterdayHash, numbersMatched };
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

async function runFreshnessWatch(env, etDate) {
  const results = await Promise.all(
    FRESHNESS_TARGETS.map((t) => checkTarget(env, t, etDate).catch((e) => ({ slug: t.slug, status: "error", error: String(e) })))
  );
  const stale = results.filter((r) => r.status === "STALE");
  const staleData = results.filter((r) => r.status === "STALE_DATA");
  const fresh = results.filter((r) => r.status === "fresh");
  await appendLog(env, `${new Date().toISOString()} ${etDate} ET=17:55 [freshness-watch] checked=${results.length} fresh=${fresh.length} STALE=${stale.length} STALE_DATA=${staleData.length} ` + JSON.stringify([...stale, ...staleData]));
  if (stale.length > 0 || staleData.length > 0) await pingHealthchecks(env, "/fail");
  return results;
}

async function runTick(env, source = "cron") {
  const now = new Date();
  const et = getETParts(now);
  const etDate = getETDateStr(now);
  const stamp = now.toISOString();
  if (et.dow >= 1 && et.dow <= 5 && et.hour === 17 && et.minute >= 50 && et.minute < 60) {
    await runFreshnessWatch(env, etDate);
  }
  const workflows = selectWorkflows(et);
  const result = { timestamp: stamp, etDate, etHour: et.hour, etMinute: et.minute, dow: et.dow, source, workflowsTriggered: [], workflowsSkipped: [] };
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
        await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,"0")} [${source}] FAIL ${wf} -> ${r.status} ${r.text}`);
      }
    } catch (e) {
      result.workflowsSkipped.push({ wf, error: String(e) });
      await appendLog(env, `${stamp} ${etDate} ET=${et.hour}:${String(et.minute).padStart(2,"0")} [${source}] ERROR ${wf} -> ${e}`);
    }
  }
  await pingHealthchecks(env);
  return result;
}

// === v2.3: CORS helper ===
function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "cache-control": "no-store"
  };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runTick(env, "cron"));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/") {
      const now = new Date();
      const et = getETParts(now);
      const etDate = getETDateStr(now);
      const next = selectWorkflows(et);
      return Response.json({
        ok: true,
        worker: "aztmm-cron",
        version: "2.3",
        utc: now.toISOString(),
        etDate, etHour: et.hour, etMinute: et.minute, weekday: et.dow,
        wouldDispatchRightNow: next,
        info: "POST /run?token=... with body { workflow?: 'name.yml' } for manual trigger. GET /log for last 200 events. GET /freshness for date+data freshness audit."
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
        status: 200,
        headers: { "content-type": "application/json", ...corsHeaders() }
      });
    }

    if (url.pathname === "/run" && request.method === "POST") {
      if (env.MANUAL_TOKEN && url.searchParams.get("token") !== env.MANUAL_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      const body = await request.json().catch(() => ({}));
      if (body.workflow) {
        const r2 = await dispatchWorkflow(env, body.workflow);
        return Response.json(r2);
      }
      const r = await runTick(env, "manual");
      return Response.json(r);
    }

    return new Response("not found", { status: 404 });
  }
};
