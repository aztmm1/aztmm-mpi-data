/**
 * AZTMM Cloudflare Worker — GH Actions cron backup (v2.0)
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
const USER_AGENT = "AZTMM-CF-Worker/2.0";

// Workflow file names (active workflows in .github/workflows/)
const WORKFLOWS = {
  mpi:            "mpi-update.yml",
  dailyPulse:     "daily-pulse-v2.yml",
  congress:       "congress-watch.yml",
  optionsGravity: "options-gravity.yml",
  squeeze:        "squeeze-watch.yml",
  zeroDte:        "0dte-pulse.yml",
};

// Trackers we watch for daily freshness (every weekday at 17:55 ET).
// If latest.json's `date` field != today (ET), we log STALE and ping healthchecks.
const FRESHNESS_TARGETS = [
  { slug: "aztmm-daily-pulse-v2",      file: "latest.json", dateKeys: ["date", "asOf", "as_of"] },
  { slug: "congress-trades-tracker",   file: "latest.json", dateKeys: ["date", "asOf", "as_of"] },
  { slug: "nope-max-pain-tracker",     file: "latest.json", dateKeys: ["date", "asOf", "as_of"] },
  { slug: "squeeze-watch",             file: "latest.json", dateKeys: ["date", "asOf", "as_of"] },
  { slug: "0dte-pulse-tracker",        file: "latest.json", dateKeys: ["date", "asOf", "as_of"] },
];
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
      WORKFLOWS.zeroDte,
    );
  }
  return selected;
}

// ----- daily freshness watchdog -----
// Fires at 17:55 ET — 45 min after the 17:10 dispatch window.
// Pings each tracker's latest.json on raw.githubusercontent.com and
// verifies its `date` field equals today's ET date.
async function runFreshnessWatch(env, etDate) {
  const results = [];
  for (const target of FRESHNESS_TARGETS) {
    const url = `${RAW_BASE}/${target.slug}/sample-output/${target.file}?t=${Date.now()}`;
    try {
      const res = await fetch(url, { cf: { cacheTtl: 0, cacheEverything: false } });
      if (!res.ok) {
        results.push({ slug: target.slug, status: "fetch_failed", code: res.status });
        continue;
      }
      const data = await res.json();
      let foundDate = null;
      for (const k of target.dateKeys) {
        if (data && typeof data === "object" && data[k]) { foundDate = String(data[k]).slice(0, 10); break; }
      }
      if (!foundDate) {
        results.push({ slug: target.slug, status: "no_date_field" });
      } else if (foundDate === etDate) {
        results.push({ slug: target.slug, status: "fresh", date: foundDate });
      } else {
        results.push({ slug: target.slug, status: "STALE", date: foundDate, expected: etDate });
      }
    } catch (e) {
      results.push({ slug: target.slug, status: "error", error: String(e) });
    }
  }
  const stale = results.filter(r => r.status === "STALE");
  await appendLog(env, `${new Date().toISOString()} ${etDate} ET=17:55 [freshness-watch] checked=${results.length} fresh=${results.filter(r => r.status==="fresh").length} STALE=${stale.length} ${JSON.stringify(stale)}`);
  if (stale.length > 0) {
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
        version: "2.0",
        utc: now.toISOString(),
        etDate,
        etHour: et.hour,
        etMinute: et.minute,
        weekday: et.dow,
        wouldDispatchRightNow: next,
        info: "POST /run?token=... with body { workflow?: 'name.yml' } for manual trigger. GET /log for last 200 events.",
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
      const r = await runFreshnessWatch(env, etDate);
      return Response.json({ etDate, results: r });
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
