/* AZTMM Canonical Hydrator v2.0 — sitewide WPCode snippet
 * Fetches BOTH the canonical content feed and the MPI feed from
 * raw.githubusercontent.com (NOT jsDelivr — branch-ref caching there
 * caused the staleness bug), hydrates [data-canonical-key] /
 * [data-canonical-href] elements (backward compatible with v1),
 * renders [data-az-staleness] badges, exposes window.AZTMM_DATA = {c, m}
 * and dispatches a "aztmm:data" CustomEvent on document when loaded.
 * Plain ES5. No dependencies.
 */
(function () {
  "use strict";
  if (window.__aztmmHydratorV2) return;
  window.__aztmmHydratorV2 = true;
  /* Setting the v1 flag too, so a stray v1 snippet loaded later bails out. */
  window.__aztmmCanonicalHydrator = "2.1";

  var CANONICAL_URL = "https://raw.githubusercontent.com/aztmm1/aztmm-mpi-data/main/data/canonical-content.json";
  var MPI_URL = "https://raw.githubusercontent.com/aztmm1/aztmm-mpi-data/main/data/mpi.json";
  var CACHE_MIN = 5; /* cache-buster bucketed to 5 minutes */
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  function bust() { return Math.floor(Date.now() / (CACHE_MIN * 60 * 1000)); }

  /* ---- path resolution (v1-compatible) ---- */
  function dig(o, p) {
    if (!o || !p) return undefined;
    var ps = String(p).split(".");
    var c = o;
    for (var i = 0; i < ps.length; i++) {
      if (c == null) return undefined;
      var k = ps[i];
      if (Array.isArray(c) && /^\d+$/.test(k)) c = c[+k]; else c = c[k];
    }
    return c;
  }

  /* Resolve against canonical first (v1 behaviour), then against
   * {c: canonical, m: mpi} so new keys like "m.data.sub_indicators.trend.score"
   * and explicit "c.market.vix" both work. */
  function resolvePath(path, c, m) {
    var v = dig(c, path);
    if (v == null) v = dig({ c: c, m: m }, path);
    return v;
  }

  function fmtDate(iso, f) {
    var mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!mt) return iso;
    var y = mt[1], mo = +mt[2], d = +mt[3];
    if (f === "DMonthYYYY") return d + " " + MONTHS[mo - 1] + " " + y;
    if (f === "MonthD") return MONTHS[mo - 1] + " " + d;
    return iso;
  }

  /* ---- trading-day / staleness math ---- */
  function etNowParts() {
    try {
      var fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short"
      });
      var parts = fmt.formatToParts(new Date());
      var p = {};
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type !== "literal") p[parts[i].type] = parts[i].value;
      }
      return {
        y: +p.year, mo: +p.month, d: +p.day,
        hour: (+p.hour) % 24, minute: +p.minute,
        dow: DOW[p.weekday]
      };
    } catch (e) {
      /* crude ET fallback (UTC-5); only used if Intl/timeZone unsupported */
      var dt = new Date(Date.now() - 5 * 3600 * 1000);
      return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hour: dt.getUTCHours(), minute: dt.getUTCMinutes(), dow: dt.getUTCDay() };
    }
  }

  function utcNoon(y, mo, d) { return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)); }

  function backToWeekday(dt) {
    var t = new Date(dt.getTime());
    while (t.getUTCDay() === 0 || t.getUTCDay() === 6) t.setUTCDate(t.getUTCDate() - 1);
    return t;
  }

  /* Last expected trading day (weekdays only; US holidays ignored, v1):
   * Mon-Fri -> today if past 16:30 ET, else previous weekday.
   * Weekend -> Friday. */
  function expectedTradingDay() {
    var n = etNowParts();
    var cur = utcNoon(n.y, n.mo, n.d);
    if (n.dow === 0 || n.dow === 6) return backToWeekday(cur);
    if (n.hour * 60 + n.minute >= 16 * 60 + 30) return cur;
    cur.setUTCDate(cur.getUTCDate() - 1);
    return backToWeekday(cur);
  }

  function parseIsoDate(iso) {
    var mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!mt) return null;
    return utcNoon(+mt[1], +mt[2], +mt[3]);
  }

  /* Number of weekdays in (asOf, expected]; 0 = current. */
  function sessionsBehind(asOfIso) {
    var asOf = parseIsoDate(asOfIso);
    if (!asOf) return null;
    var expected = expectedTradingDay();
    if (asOf.getTime() >= expected.getTime()) return 0;
    var n = 0;
    var t = new Date(asOf.getTime());
    var guard = 0;
    while (t.getTime() < expected.getTime() && guard < 366) {
      t.setUTCDate(t.getUTCDate() + 1);
      if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) n++;
      guard++;
    }
    return n;
  }

  function badgeHtml(n) {
    var base = "display:inline-block;vertical-align:middle;font-family:Menlo,Consolas,'JetBrains Mono',monospace;font-size:0.7rem;line-height:1.5;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;padding:1px 8px;border-radius:100px;";
    if (n == null) return "";
    if (n <= 0) return '<span style="' + base + 'color:#10b981;border:1px solid rgba(16,185,129,0.35);background:rgba(16,185,129,0.08);">Current</span>';
    if (n === 1) return '<span style="' + base + 'color:#f59e0b;border:1px solid rgba(245,158,11,0.4);background:rgba(245,158,11,0.08);">1 session behind</span>';
    return '<span style="' + base + 'color:#ef4444;border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.08);">STALE &mdash; ' + n + ' sessions behind</span>';
  }

  /* ---- DOM hydration ---- */
  function walk(c, m) {
    var i, el, path, f, v;
    var keys = document.querySelectorAll("[data-canonical-key]");
    for (i = 0; i < keys.length; i++) {
      el = keys[i];
      path = el.getAttribute("data-canonical-key");
      f = el.getAttribute("data-canonical-format");
      v = resolvePath(path, c, m);
      if (v == null) continue;
      if (f) v = fmtDate(v, f);
      el.textContent = String(v);
      el.setAttribute("data-canonical-applied", "1"); el.setAttribute("aria-live", "polite");
    }
    var hrefs = document.querySelectorAll("[data-canonical-href]");
    for (i = 0; i < hrefs.length; i++) {
      el = hrefs[i];
      v = resolvePath(el.getAttribute("data-canonical-href"), c, m);
      if (typeof v === "string") {
        el.setAttribute("href", v);
        el.setAttribute("data-canonical-applied", "1");
      }
    }
    var badges = document.querySelectorAll("[data-az-staleness]");
    for (i = 0; i < badges.length; i++) {
      el = badges[i];
      if (el.getAttribute("data-az-staleness-applied")) continue;
      path = el.getAttribute("data-az-staleness");
      var asOf;
      if (path) {
        asOf = resolvePath(path, c, m);
      } else {
        asOf = (c && c.mpi && c.mpi.as_of) || (m && m.asOf);
      }
      var n = sessionsBehind(asOf);
      if (n == null) continue;
      el.innerHTML = badgeHtml(n);
      el.setAttribute("data-az-staleness-applied", "1");
      el.setAttribute("data-az-sessions-behind", String(n));
    }
  }

  function fetchJson(url) {
    return fetch(url + "?ts=" + bust(), { cache: "default", credentials: "omit" })
      .then(function (r) { if (!r.ok) return null; return r.json(); })
      .catch(function () { return null; });
  }

  function drawSparks() {
    var els = document.querySelectorAll("[data-az-spark]");
    if (!els.length) return;
    var ts = Math.floor(Date.now() / (5 * 60 * 1000));
    fetch("https://raw.githubusercontent.com/aztmm1/aztmm-mpi-data/main/data/mpi-history.json?ts=" + ts, { cache: "default", credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (hj) {
        if (!hj || !hj.rows || hj.rows.length < 2) return;
        var rows = hj.rows;
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (el.getAttribute("data-az-spark-applied")) continue;
          var W = 110, H = 30, p = 3;
          var NSx = "http://www.w3.org/2000/svg";
          var s = document.createElementNS(NSx, "svg");
          s.setAttribute("viewBox", "0 0 " + W + " " + H);
          s.setAttribute("width", W); s.setAttribute("height", H);
          s.style.display = "block";
          var n = rows.length, min = 100, max = 0, k, v;
          for (k = 0; k < n; k++) { v = rows[k].score; if (v < min) min = v; if (v > max) max = v; }
          if (max - min < 8) { var mid = (max + min) / 2; min = mid - 4; max = mid + 4; }
          function X(idx) { return p + (W - 2 * p) * idx / (n - 1); }
          function Y(val) { return H - p - (H - 2 * p) * (val - min) / (max - min); }
          var d = "";
          for (var j = 0; j < n; j++) { d += (j ? " L " : "M ") + X(j).toFixed(1) + " " + Y(rows[j].score).toFixed(1); }
          var defs = document.createElementNS(NSx, "defs");
          var gid = "azspark" + i;
          var lg = document.createElementNS(NSx, "linearGradient");
          lg.setAttribute("id", gid); lg.setAttribute("x1", "0"); lg.setAttribute("y1", "0"); lg.setAttribute("x2", "1"); lg.setAttribute("y2", "0");
          var st1 = document.createElementNS(NSx, "stop"); st1.setAttribute("offset", "0%"); st1.setAttribute("stop-color", "#22d3ee");
          var st2 = document.createElementNS(NSx, "stop"); st2.setAttribute("offset", "100%"); st2.setAttribute("stop-color", "#a78bfa");
          lg.appendChild(st1); lg.appendChild(st2); defs.appendChild(lg); s.appendChild(defs);
          var path = document.createElementNS(NSx, "path");
          path.setAttribute("d", d); path.setAttribute("stroke", "url(#" + gid + ")");
          path.setAttribute("stroke-width", "1.6"); path.setAttribute("fill", "none");
          path.setAttribute("stroke-linejoin", "round"); path.setAttribute("stroke-linecap", "round");
          s.appendChild(path);
          var dot = document.createElementNS(NSx, "circle");
          dot.setAttribute("cx", X(n - 1)); dot.setAttribute("cy", Y(rows[n - 1].score)); dot.setAttribute("r", "2.2"); dot.setAttribute("fill", "#22d3ee");
          s.appendChild(dot);
          var ti = document.createElementNS(NSx, "title");
          ti.textContent = "MPI last " + n + " sessions (" + rows[0].date + " to " + rows[n - 1].date + ")";
          s.insertBefore(ti, s.firstChild);
          s.setAttribute("role", "img"); s.setAttribute("aria-label", ti.textContent);
          el.innerHTML = ""; el.appendChild(s);
          el.setAttribute("data-az-spark-applied", "1");
        }
      }).catch(function () {});
  }

  function dispatchReady(c, m) {
    var ev;
    var detail = { c: c, m: m };
    try {
      ev = new CustomEvent("aztmm:data", { bubbles: true, cancelable: false, detail: detail });
    } catch (e) {
      ev = document.createEvent("CustomEvent");
      ev.initCustomEvent("aztmm:data", true, false, detail);
    }
    document.dispatchEvent(ev);
  }

  function load() {
    try {
      Promise.all([fetchJson(CANONICAL_URL), fetchJson(MPI_URL)]).then(function (res) {
        var c = res[0], m = res[1];
        window.__aztmmCanonical = c; /* v1 back-compat global */
        window.AZTMM_DATA = { c: c, m: m };
        try { walk(c, m); } catch (e) { /* never break the page */ }
        dispatchReady(c, m);
        try { drawSparks(); } catch (e) { /* non-fatal */ }
      });
    } catch (e) { /* fetch/Promise unavailable: leave server-rendered defaults */ }
  }

  /* Expose helpers so page scripts can share the exact same staleness rules */
  window.AZTMM_STALENESS = {
    sessionsBehind: sessionsBehind,
    expectedTradingDay: expectedTradingDay,
    badgeHtml: badgeHtml
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
