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
  window.__aztmmCanonicalHydrator = "2.0";

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
      el.setAttribute("data-canonical-applied", "1");
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
