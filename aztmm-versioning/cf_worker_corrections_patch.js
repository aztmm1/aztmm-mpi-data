// =====================================================================
// AZTMM Tier 1B — CF Worker /corrections patch
// =====================================================================
// Insert these two routes into cloudflare-cron-trigger/worker.js inside
// `async fetch(request, env, ctx)` right before the final
// `return new Response("not found", { status: 404 });`.
//
//   - GET /corrections          JSON dump of last-7-days corrections
//   - GET /corrections/panel    HTML panel for operator review
//
// Data source: data/versions/{YYYY-MM-DD}.json in the aztmm1/aztmm-mpi-data
// repo, served via jsDelivr (no API key needed; jsDelivr respects the GH
// CDN refresh window — typically ~10 min).
//
// The "notify subscribers?" button POSTs back to /corrections/notify which
// is a stub (returns 501) until Tier 2B builds the actual mailer.
// =====================================================================

const VERSIONS_BASE =
  "https://cdn.jsdelivr.net/gh/aztmm1/aztmm-mpi-data@main/aztmm-daily-pulse-v2/data/versions";

async function listRecentVersionFiles(daysBack = 7) {
  // jsDelivr does not expose directory listings, so we probe each date.
  const out = [];
  const today = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today.getTime() - i * 86400_000);
    const ds = d.toISOString().slice(0, 10);
    const url = `${VERSIONS_BASE}/${ds}.json`;
    try {
      const r = await fetch(url, { cf: { cacheTtl: 300 } });
      if (r.ok) {
        const body = await r.json();
        out.push({ date: ds, ...body });
      }
    } catch (_e) {
      /* skip */
    }
  }
  return out;
}

function renderCorrectionsHtml(manifests) {
  const rows = [];
  for (const m of manifests) {
    for (const ev of m.correction_events || []) {
      rows.push({
        date:           m.date,
        post_id:        m.post_id,
        corrected_at:   ev.corrected_at,
        materiality:    ev.materiality,
        summary:        ev.diff_summary,
        recommend:      ev.subscriber_notification_recommended ? "YES" : "no",
        version_before: ev.version_id_before,
        version_after:  ev.version_id_after,
      });
    }
  }
  rows.sort((a, b) => (b.corrected_at || "").localeCompare(a.corrected_at || ""));

  const matColor = (m) =>
    m === "material" ? "#c1121f" : m === "minor" ? "#d97706" : "#6b7280";
  const trHtml = rows.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${r.post_id}</td>
      <td>${r.corrected_at || ""}</td>
      <td style="color:${matColor(r.materiality)};font-weight:600;">${r.materiality || ""}</td>
      <td>${r.summary || ""}</td>
      <td>${r.recommend}</td>
      <td>
        <button onclick="notifySubs(${r.post_id}, '${r.version_after}')"
                ${r.materiality === "material" ? "" : "disabled"}>
          Notify subscribers
        </button>
      </td>
    </tr>`).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>AZTMM Corrections</title>
<style>
  body{font:14px ui-sans-serif,system-ui;color:#111;padding:20px;max-width:1200px;margin:0 auto}
  h1{margin:0 0 4px 0}
  table{width:100%;border-collapse:collapse;margin-top:14px}
  th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:13px}
  th{background:#f3f4f6;text-transform:uppercase;font-size:11px;letter-spacing:.04em;color:#374151}
  button{padding:5px 9px;border:1px solid #c1121f;background:#fff;color:#c1121f;border-radius:4px;cursor:pointer}
  button:disabled{opacity:.4;cursor:not-allowed;border-color:#9ca3af;color:#9ca3af}
  .empty{padding:40px;text-align:center;color:#6b7280}
</style></head><body>
  <h1>Recent corrections (last 7 days)</h1>
  <div style="color:#6b7280">Generated ${new Date().toISOString()} -- sourced from data/versions/*.json via jsDelivr.</div>
  ${rows.length === 0 ? '<div class="empty">No corrections detected.</div>' :
    `<table>
      <tr><th>Trading date</th><th>Post</th><th>Corrected at</th>
          <th>Materiality</th><th>Summary</th><th>Notify?</th><th>Action</th></tr>
      ${trHtml}
    </table>`}
  <script>
    async function notifySubs(postId, versionId) {
      if (!confirm('Send correction notice to subscribers for post ' + postId + '?')) return;
      const r = await fetch('/corrections/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post_id: postId, version_id: versionId }),
      });
      alert('Server: HTTP ' + r.status + ' ' + (await r.text()));
    }
  </script>
</body></html>`;
}

// ---------------- ROUTES (paste into fetch handler) ---------------------

// GET /corrections — JSON dump
if (url.pathname === "/corrections") {
  const lookback = parseInt(url.searchParams.get("days") || "7", 10);
  const manifests = await listRecentVersionFiles(lookback);
  return Response.json({
    generated_at: new Date().toISOString(),
    lookback_days: lookback,
    manifests,
  });
}

// GET /corrections/panel — HTML dashboard panel
if (url.pathname === "/corrections/panel") {
  const manifests = await listRecentVersionFiles(7);
  return new Response(renderCorrectionsHtml(manifests), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// POST /corrections/notify — stub for Tier 2B (subscriber emails)
if (url.pathname === "/corrections/notify" && request.method === "POST") {
  if (env.MANUAL_TOKEN && url.searchParams.get("token") !== env.MANUAL_TOKEN) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response(
    "Tier 2B not implemented yet — correction notification mailer is the next step.",
    { status: 501 }
  );
}
