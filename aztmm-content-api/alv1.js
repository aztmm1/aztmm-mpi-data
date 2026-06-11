(function () {
  "use strict";
  var root = document.getElementById("alv1-root");
  if (!root) return;

  var LEDGER_URL = "https://raw.githubusercontent.com/aztmm1/aztmm-mpi-data/main/accountability-ledger/sample-output/latest.json";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function $(id) { return document.getElementById(id); }
  function setText(id, v) { var el = $(id); if (el && v != null && v !== "") el.textContent = String(v); }
  function fmtDMY(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    return (+m[3]) + " " + MONTHS[+m[2] - 1] + " " + m[1];
  }
  function pct(v) {
    if (v == null || isNaN(v)) return null;
    var n = Number(v);
    if (n <= 1) n = n * 100; /* accept 0.62 or 62 */
    return Math.round(n * 10) / 10 + "%";
  }

  /* trading-day staleness (same rules as hydrator v2; local copy so this page is standalone) */
  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function etNowParts() {
    try {
      var f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });
      var parts = f.formatToParts(new Date());
      var p = {};
      for (var i = 0; i < parts.length; i++) { if (parts[i].type !== "literal") p[parts[i].type] = parts[i].value; }
      return { y: +p.year, mo: +p.month, d: +p.day, hour: (+p.hour) % 24, minute: +p.minute, dow: DOW[p.weekday] };
    } catch (e) {
      var dt = new Date(Date.now() - 5 * 3600 * 1000);
      return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hour: dt.getUTCHours(), minute: dt.getUTCMinutes(), dow: dt.getUTCDay() };
    }
  }
  function utcNoon(y, mo, d) { return new Date(Date.UTC(y, mo - 1, d, 12)); }
  function expectedTradingDay() {
    var n = etNowParts();
    var cur = utcNoon(n.y, n.mo, n.d);
    if (n.dow >= 1 && n.dow <= 5 && (n.hour * 60 + n.minute) >= 16 * 60 + 30) return cur;
    if (n.dow >= 1 && n.dow <= 5) cur.setUTCDate(cur.getUTCDate() - 1);
    while (cur.getUTCDay() === 0 || cur.getUTCDay() === 6) cur.setUTCDate(cur.getUTCDate() - 1);
    return cur;
  }
  function sessionsBehind(asOfIso) {
    if (window.AZTMM_STALENESS && window.AZTMM_STALENESS.sessionsBehind) return window.AZTMM_STALENESS.sessionsBehind(asOfIso);
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(asOfIso || ""));
    if (!m) return null;
    var asOf = utcNoon(+m[1], +m[2], +m[3]);
    var expected = expectedTradingDay();
    if (asOf.getTime() >= expected.getTime()) return 0;
    var n = 0, t = new Date(asOf.getTime()), guard = 0;
    while (t.getTime() < expected.getTime() && guard < 366) {
      t.setUTCDate(t.getUTCDate() + 1);
      if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) n++;
      guard++;
    }
    return n;
  }
  function badgeHtml(n) {
    if (window.AZTMM_STALENESS && window.AZTMM_STALENESS.badgeHtml) return window.AZTMM_STALENESS.badgeHtml(n);
    var base = "display:inline-block;vertical-align:middle;font-family:Menlo,Consolas,'JetBrains Mono',monospace;font-size:0.7rem;line-height:1.5;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;padding:1px 8px;border-radius:100px;";
    if (n == null) return "";
    if (n <= 0) return '<span style="' + base + 'color:#10b981;border:1px solid rgba(16,185,129,0.35);background:rgba(16,185,129,0.08);">Current</span>';
    if (n === 1) return '<span style="' + base + 'color:#f59e0b;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.08);">1 session behind</span>';
    return '<span style="' + base + 'color:#ef4444;border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.08);">STALE &mdash; ' + n + ' sessions behind</span>';
  }

  function chipClass(status) {
    var s = String(status || "").toLowerCase();
    if (s === "hit") return "hit";
    if (s === "invalidated") return "invalidated";
    if (s === "unresolved") return "unresolved";
    return "open";
  }

  function showEmptyState() {
    var e = $("alv1-empty");
    if (e) e.style.display = "block";
    var w = $("alv1-tablewrap");
    if (w) w.style.display = "none";
  }

  function td(text, cls) {
    var cell = document.createElement("td");
    if (cls) cell.className = cls;
    cell.textContent = (text == null || text === "") ? "—" : String(text);
    return cell;
  }

  function render(payload) {
    if (!payload || typeof payload !== "object") { showEmptyState(); return; }

    if (payload.as_of) {
      setText("alv1-asof", fmtDMY(payload.as_of) || payload.as_of);
      var n = sessionsBehind(payload.as_of);
      var b = $("alv1-asof-badge");
      if (b && n != null) b.innerHTML = badgeHtml(n);
    }

    var t = payload.totals || {};
    setText("alv1-open", t.open != null ? t.open : null);
    setText("alv1-resolved", t.resolved != null ? t.resolved : null);
    setText("alv1-hit", t.hit != null ? t.hit : null);
    setText("alv1-invalidated", t.invalidated != null ? t.invalidated : null);
    setText("alv1-unresolved", t.unresolved != null ? t.unresolved : null);
    setText("alv1-hr5", pct(payload.hit_rate_5d));
    setText("alv1-hr21", pct(payload.hit_rate_21d));
    setText("alv1-ra21", pct(payload.regime_alignment_21d));

    /* v1.1: outcome stacked bar from totals (injected above the table) */
    try {
      var tt2 = payload.totals || {};
      var H = tt2.hit || 0, I = tt2.invalidated || 0, U = tt2.unresolved || 0, O = tt2.open || 0;
      var tot = H + I + U + O;
      if (tot > 0 && !document.getElementById("alv1-outbar")) {
        var wrap = document.createElement("div");
        wrap.id = "alv1-outbar";
        wrap.setAttribute("style", "margin:0 0 22px");
        var NS2 = "http://www.w3.org/2000/svg";
        var s2 = document.createElementNS(NS2, "svg");
        s2.setAttribute("viewBox", "0 0 380 46"); s2.setAttribute("width", "100%");
        s2.style.maxWidth = "660px"; s2.style.display = "block"; s2.style.margin = "0 auto";
        var segs = [[H, "#10b981", "HIT"], [I, "#ef4444", "INVALIDATED"], [U, "#f59e0b", "UNRESOLVED"], [O, "#64748b", "OPEN"]];
        var x = 16, w0 = 348, yb = 14;
        for (var si = 0; si < segs.length; si++) {
          var sw = w0 * segs[si][0] / tot;
          if (sw <= 0) continue;
          var rect = document.createElementNS(NS2, "rect");
          rect.setAttribute("x", x); rect.setAttribute("y", yb); rect.setAttribute("width", Math.max(2, sw - 1.5)); rect.setAttribute("height", 12); rect.setAttribute("rx", 4);
          rect.setAttribute("fill", segs[si][1]); rect.setAttribute("opacity", "0.85");
          s2.appendChild(rect);
          x += sw;
        }
        var legend = document.createElementNS(NS2, "text");
        legend.setAttribute("x", "16"); legend.setAttribute("y", yb + 26); legend.setAttribute("text-anchor", "start");
        legend.setAttribute("font-size", "7"); legend.setAttribute("fill", "#7e84b5");
        legend.setAttribute("font-family", "JetBrains Mono, Menlo, monospace"); legend.setAttribute("letter-spacing", "0.1em");
        var lp = [];
        for (var li2 = 0; li2 < segs.length; li2++) { if (segs[li2][0] > 0) lp.push(segs[li2][2] + " " + segs[li2][0]); }
        legend.textContent = lp.join("  ·  ");
        s2.appendChild(legend);
        var stamp = document.createElementNS(NS2, "text");
        stamp.setAttribute("x", "364"); stamp.setAttribute("y", yb + 26); stamp.setAttribute("text-anchor", "end");
        stamp.setAttribute("font-size", "7"); stamp.setAttribute("fill", "#4f547a");
        stamp.setAttribute("font-family", "JetBrains Mono, Menlo, monospace"); stamp.setAttribute("letter-spacing", "0.18em");
        stamp.textContent = "AZTMM · EOD · NEVER REVISED";
        s2.appendChild(stamp);
        var ti2 = document.createElementNS(NS2, "title");
        ti2.textContent = "Ledger outcomes: " + H + " hit, " + I + " invalidated, " + U + " unresolved, " + O + " open";
        s2.insertBefore(ti2, s2.firstChild);
        s2.setAttribute("role", "img"); s2.setAttribute("aria-label", ti2.textContent);
        wrap.appendChild(s2);
        var statsEl = document.querySelector(".alv1-stats");
        if (statsEl && statsEl.parentNode) statsEl.parentNode.insertBefore(wrap, statsEl.nextSibling);
      }
    } catch (e) {}

    var rows = payload.rows;
    if (!rows || !rows.length) { showEmptyState(); return; }

    rows = rows.slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    }).slice(0, 20);

    var body = $("alv1-rows");
    if (!body) return;
    body.innerHTML = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var tr = document.createElement("tr");
      var dcell = td(fmtDMY(r.date) || r.date, "mono");
      try {
        var slug = String(r.id || "").split(":")[0];
        if (slug && slug.indexOf("pulse") > -1 && r.date) {
          var dparts = String(r.date).slice(0, 10).split("-");
          var a2 = document.createElement("a");
          a2.href = "/" + dparts[0] + "/" + dparts[1] + "/" + dparts[2] + "/" + slug + "/";
          a2.textContent = dcell.textContent;
          a2.title = "View the original post (unedited)";
          a2.setAttribute("style", "color:inherit;text-decoration:underline;text-decoration-color:rgba(34,211,238,0.4);text-underline-offset:3px");
          dcell.textContent = ""; dcell.appendChild(a2);
        }
      } catch (e) {}
      tr.appendChild(dcell);
      tr.appendChild(td(r.type));
      tr.appendChild(td(r.ticker, "tk"));
      tr.appendChild(td(r.statement));
      tr.appendChild(td(r.horizon_days != null ? r.horizon_days + "d" : null, "mono"));
      var st = document.createElement("td");
      var chip = document.createElement("span");
      chip.className = "alv1-chip " + chipClass(r.status);
      chip.textContent = r.status ? String(r.status) : "—";
      st.appendChild(chip);
      tr.appendChild(st);
      tr.appendChild(td(fmtDMY(r.resolved_date) || r.resolved_date, "mono"));
      tr.appendChild(td(r.note));
      body.appendChild(tr);
    }
  }

  function load() {
    if (!window.fetch) { showEmptyState(); return; }
    var ts = Math.floor(Date.now() / (5 * 60 * 1000));
    fetch(LEDGER_URL + "?ts=" + ts, { cache: "default", credentials: "omit" })
      .then(function (r) { if (!r.ok) return null; return r.json(); })
      .then(function (p) { if (p) render(p); else showEmptyState(); })
      .catch(function () { showEmptyState(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
