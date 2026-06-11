(function () {
  "use strict";
  var root = document.getElementById("plv2-root");
  if (!root) return;

  /* ------- tabs ------- */
  var tabs = root.querySelectorAll(".plv2-tab");
  var panels = root.querySelectorAll(".plv2-pnl");
  function showTab(id) {
    var i;
    for (i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute("data-target") === id) tabs[i].className = "plv2-tab plv2-on";
      else tabs[i].className = "plv2-tab";
    }
    for (i = 0; i < panels.length; i++) {
      if (panels[i].id === id) panels[i].className = "plv2-pnl plv2-on";
      else panels[i].className = "plv2-pnl";
    }
  }
  for (var ti = 0; ti < tabs.length; ti++) {
    tabs[ti].addEventListener("click", function () {
      var id = this.getAttribute("data-target");
      showTab(id);
      if (history && history.replaceState) history.replaceState(null, "", "#" + id);
    });
  }
  var hash = (location.hash || "").replace("#", "");
  if (hash && document.getElementById(hash) && hash.indexOf("plv2-") === 0) showTab(hash);

  /* ------- small helpers ------- */
  function $(id) { return document.getElementById(id); }
  function setText(id, v) { var el = $(id); if (el && v != null && v !== "") el.textContent = String(v); }
  function g(o, path) {
    if (!o) return undefined;
    var ps = path.split(".");
    var c = o;
    for (var i = 0; i < ps.length; i++) { if (c == null) return undefined; c = c[ps[i]]; }
    return c;
  }
  function decodeEntities(s) {
    if (s == null) return "";
    var t = document.createElement("textarea");
    t.innerHTML = String(s);
    return t.value;
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDMY(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    return (+m[3]) + " " + MONTHS[+m[2] - 1] + " " + m[1];
  }
  function fmt(v, dp) {
    if (v == null || isNaN(v)) return null;
    return Number(v).toFixed(dp == null ? 2 : dp);
  }

  /* ------- trading-day math (mirrors hydrator v2; local copy for standalone use) ------- */
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
  function backToWeekday(dt) { var t = new Date(dt.getTime()); while (t.getUTCDay() === 0 || t.getUTCDay() === 6) t.setUTCDate(t.getUTCDate() - 1); return t; }
  function expectedTradingDay() {
    var n = etNowParts();
    var cur = utcNoon(n.y, n.mo, n.d);
    if (n.dow === 0 || n.dow === 6) return backToWeekday(cur);
    if (n.hour * 60 + n.minute >= 16 * 60 + 30) return cur;
    cur.setUTCDate(cur.getUTCDate() - 1);
    return backToWeekday(cur);
  }
  function nextTradingDay() {
    var n = etNowParts();
    var cur = utcNoon(n.y, n.mo, n.d);
    /* next update = today's close if it's a weekday before ~16:30 ET, else next weekday */
    if (n.dow >= 1 && n.dow <= 5 && (n.hour * 60 + n.minute) < 16 * 60 + 30) return cur;
    cur.setUTCDate(cur.getUTCDate() + 1);
    while (cur.getUTCDay() === 0 || cur.getUTCDay() === 6) cur.setUTCDate(cur.getUTCDate() + 1);
    return cur;
  }
  function parseIsoDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    return utcNoon(+m[1], +m[2], +m[3]);
  }
  function sessionsBehind(asOfIso) {
    if (window.AZTMM_STALENESS && window.AZTMM_STALENESS.sessionsBehind) return window.AZTMM_STALENESS.sessionsBehind(asOfIso);
    var asOf = parseIsoDate(asOfIso);
    if (!asOf) return null;
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

  /* ------- qualitative mappings (policy: no raw model probabilities) ------- */
  function qualScore(v) {
    if (v == null || isNaN(v)) return null;
    if (v >= 70) return "Strong";
    if (v >= 55) return "Leaning strong";
    if (v >= 45) return "Neutral";
    if (v >= 30) return "Leaning weak";
    return "Weak";
  }
  function toneClass(v) {
    if (v == null || isNaN(v)) return "";
    if (v >= 55) return " bullish";
    if (v < 45) return " bearish";
    return "";
  }
  function qualConfidence(c) {
    if (c == null || isNaN(c)) return null;
    if (c >= 0.8) return "High confidence";
    if (c >= 0.6) return "Moderate confidence";
    return "Low confidence";
  }

  var SUB_META = {
    trend: { label: "Trend", detail: function (s) { var a = fmt(s.spy_close), b = fmt(s.ma50); return (a && b) ? "SPY " + a + " vs 50-day " + b : null; } },
    breadth: { label: "Breadth", detail: function (s) { var r = fmt(s.cyclical_defensive_ratio); return r ? "Cyclical/defensive ratio " + r : null; } },
    volatility: { label: "Volatility", detail: function (s) { var v = fmt(s.vix), t = s.term_shape; return v ? "VIX " + v + (t ? " · " + t : "") : null; } },
    yield_curve: { label: "Yield Curve", detail: function (s) { var a = fmt(s.dgs10), b = fmt(s.dgs2); return (a && b) ? "10y " + a + "% · 2y " + b + "%" : null; } },
    credit: { label: "Credit", detail: function (s) { var h = fmt(s.hy_oas_pct), g2 = fmt(s.ig_oas_pct); return (h && g2) ? "HY OAS " + h + "% · IG " + g2 + "%" : null; } },
    sentiment: { label: "Sentiment", detail: function (s) { var v = fmt(s.cnn_fg, 0); return v ? "Fear & Greed " + v : null; } },
    rotation: { label: "Rotation", detail: function (s) { var r = fmt(s.xlu_xly_ratio, 3); return r ? "XLU/XLY ratio " + r : null; } },
    currency: { label: "Currency", detail: function (s) { var a = fmt(s.uup), b = fmt(s.uup_50d_ma); return (a && b) ? "UUP " + a + " vs 50-day " + b : null; } },
    liquidity: { label: "Liquidity", detail: function () { return "M2 trend proxy"; } }
  };
  var SUB_ORDER = ["trend", "breadth", "volatility", "yield_curve", "credit", "sentiment", "rotation", "currency", "liquidity"];

  function joinNames(arr) {
    if (arr.length === 0) return "";
    if (arr.length === 1) return arr[0];
    return arr.slice(0, arr.length - 1).join(", ") + " and " + arr[arr.length - 1];
  }

  function buildNarrative(subs, score) {
    var strong = [], weak = [], neutralCount = 0, k, s, v;
    for (var i = 0; i < SUB_ORDER.length; i++) {
      k = SUB_ORDER[i];
      s = subs[k];
      v = s && s.score;
      if (v == null || isNaN(v)) continue;
      if (v >= 70) strong.push(SUB_META[k].label + " (" + Math.round(v) + ")");
      if (v <= 30) weak.push(SUB_META[k].label + " (" + Math.round(v) + ")");
      if (v >= 45 && v <= 55) neutralCount++;
    }
    var parts = [];
    if (strong.length) parts.push(joinNames(strong) + (strong.length === 1 ? " reads" : " read") + " 70 or above and " + (strong.length === 1 ? "is" : "are") + " doing the supportive work.");
    else parts.push("No sub-indicator currently reads 70 or above.");
    if (weak.length) parts.push(joinNames(weak) + (weak.length === 1 ? " sits" : " sit") + " at 30 or below and " + (weak.length === 1 ? "drags" : "drag") + " on the composite.");
    else parts.push("Nothing reads 30 or below.");
    parts.push(neutralCount === 1 ? "One input sits in the neutral zone (45–55)." : neutralCount + " inputs sit in the neutral zone (45–55).");
    if (score != null && !isNaN(score)) {
      var d = Math.round(score) - 50;
      parts.push("Net effect: a composite of " + Math.round(score) + ", " + (d === 0 ? "right at" : Math.abs(d) + " point" + (Math.abs(d) === 1 ? "" : "s") + (d > 0 ? " above" : " below")) + " the 50 midline.");
    }
    return parts.join(" ");
  }

  /* ------- hydration ------- */
  var hydrated = false;
  function hydrate(data) {
    if (!data) return;
    var c = data.c, m = data.m;
    if (!c && !m) return;
    hydrated = true;

    var asOf = g(m, "asOf") || g(c, "mpi.as_of");
    var asOfHuman = fmtDMY(asOf);
    if (asOfHuman) {
      setText("plv2-lastdate", asOfHuman);
      var asofEls = root.querySelectorAll(".plv2-asof-main");
      for (var ai = 0; ai < asofEls.length; ai++) asofEls[ai].textContent = asOfHuman;
    }
    var nx = nextTradingDay();
    setText("plv2-nextdate", nx.getUTCDate() + " " + MONTHS[nx.getUTCMonth()]);

    /* strip */
    var score = g(m, "data.mpi_score");
    if (score == null) score = g(c, "mpi.score");
    var regimeLabel = g(m, "data.regime_label") || g(c, "mpi.regime");
    var lo = g(m, "data.confidence.ci_low"), hi = g(m, "data.confidence.ci_high");
    if (lo == null && g(c, "mpi.confidence_band")) { lo = g(c, "mpi.confidence_band")[0]; hi = g(c, "mpi.confidence_band")[1]; }
    setText("plv2-strip-score", score != null ? Math.round(score) : null);
    setText("plv2-strip-regime", regimeLabel);
    if (lo != null && hi != null) setText("plv2-strip-band", Math.round(lo) + "–" + Math.round(hi));

    /* MPI tab */
    setText("plv2-score", score != null ? Math.round(score) : null);
    setText("plv2-score-2", score != null ? Math.round(score) : null);
    setText("plv2-score-label", g(m, "data.mpi_label") || regimeLabel);
    setText("plv2-cb-score", score != null ? Math.round(score) : null);
    setText("plv2-cb-level", g(m, "data.confidence.ci_level") || "confidence");
    if (lo != null && hi != null) setText("plv2-cb-range", Math.round(lo) + "–" + Math.round(hi));

    var subs = g(m, "data.sub_indicators") || {};
    var cards = root.querySelectorAll(".plv2-sc");
    for (var i = 0; i < cards.length; i++) {
      var key = cards[i].getAttribute("data-sub");
      var sub = subs[key];
      var v = sub && sub.score;
      if (v == null || isNaN(v)) continue;
      cards[i].className = "plv2-sc" + toneClass(v);
      cards[i].querySelector(".plv2-sc-score").textContent = String(Math.round(v));
      cards[i].querySelector(".plv2-sc-sig").textContent = qualScore(v);
      cards[i].querySelector(".plv2-sc-bar i").style.width = Math.max(0, Math.min(100, v)) + "%";
      var detail = SUB_META[key] && SUB_META[key].detail(sub);
      if (detail) cards[i].querySelector(".plv2-sc-meta").textContent = detail;
    }
    var narrativeEl = $("plv2-narrative");
    if (narrativeEl && g(m, "data.sub_indicators")) narrativeEl.textContent = buildNarrative(subs, score);

    var vol = g(m, "data.volatility") || {};
    setText("plv2-vix", fmt(vol.vix));
    setText("plv2-vix3m", fmt(vol.vix3m));
    setText("plv2-term", vol.term_shape);
    setText("plv2-rv", fmt(vol.realized_vol_20d_pct) != null ? fmt(vol.realized_vol_20d_pct) + "%" : null);
    setText("plv2-vrp", fmt(vol.vrp));
    var em = g(m, "data.market.expected_move_1sigma");
    var emp = g(m, "data.market.expected_move_pct");
    if (em != null) setText("plv2-em", "±$" + fmt(em));
    if (emp != null) setText("plv2-em-pct", "±" + fmt(emp * 100) + "% on SPY");

    /* REGIME tab — qualitative confidence only, never raw model probabilities */
    setText("plv2-rg-label", regimeLabel);
    setText("plv2-rg-label-2", regimeLabel);
    var conf = qualConfidence(g(m, "data.hmm.confidence"));
    setText("plv2-rg-conf", conf);
    setText("plv2-rg-conf-2", conf);
    setText("plv2-sig-bias", g(m, "data.signal.bias"));
    setText("plv2-sig-strength", g(m, "data.signal.strength"));

    /* DAILY tab */
    var dp = g(c, "latest_daily_pulse");
    if (dp) {
      setText("plv2-dp-date", fmtDMY(dp.date) || dp.date);
      setText("plv2-dp-date-2", fmtDMY(dp.date) || dp.date);
      setText("plv2-dp-title", decodeEntities(dp.title));
      setText("plv2-dp-snip", decodeEntities(dp.snippet));
      if (dp.url) $("plv2-dp-link").setAttribute("href", dp.url);
    }
    var recents = g(c, "recent_pulses") || [];
    fillPulseList("plv2-dp-list", recents, "daily", dp && dp.id);

    /* WEEKLY tab */
    var wp = g(c, "latest_weekly_pulse");
    if (wp) {
      setText("plv2-wk-date", fmtDMY(wp.date) || wp.date);
      setText("plv2-wk-date-2", fmtDMY(wp.date) || wp.date);
      setText("plv2-wk-title", decodeEntities(wp.title));
      setText("plv2-wk-snip", decodeEntities(wp.snippet));
      if (wp.url) $("plv2-wk-link").setAttribute("href", wp.url);
      /* Weekly cadence badge: weekly posts are weekly artifacts, so session
       * staleness would mislabel them. Fresh = published within last 8 days. */
      var wkBadge = $("plv2-wk-badge");
      var wkDate = parseIsoDate(wp.date);
      if (wkBadge && wkDate) {
        var ageDays = Math.floor((expectedTradingDay().getTime() - wkDate.getTime()) / 86400000);
        wkBadge.innerHTML = badgeHtml(ageDays <= 8 ? 0 : (ageDays <= 12 ? 1 : 2));
      }
    }
    fillPulseList("plv2-wk-list", recents, "weekly", wp && wp.id);

    /* staleness badges not yet applied by the sitewide hydrator */
    var badges = root.querySelectorAll("[data-az-staleness]");
    for (var bi = 0; bi < badges.length; bi++) {
      if (badges[bi].getAttribute("data-az-staleness-applied")) continue;
      var p = badges[bi].getAttribute("data-az-staleness");
      var src = p ? (g(c, p) != null ? g(c, p) : g({ c: c, m: m }, p)) : asOf;
      var n = sessionsBehind(src);
      if (n == null) continue;
      badges[bi].innerHTML = badgeHtml(n);
      badges[bi].setAttribute("data-az-staleness-applied", "1");
    }

    if (m) { try { renderRegimeVisuals(m); } catch (e) {} }
  }

  function fillPulseList(containerId, recents, kind, excludeId) {
    var box = $(containerId);
    if (!box) return;
    box.innerHTML = "";
    var added = 0;
    for (var i = 0; i < recents.length; i++) {
      var r = recents[i];
      if (!r || r.kind !== kind) continue;
      if (excludeId != null && r.id === excludeId) continue;
      var a = document.createElement("a");
      a.href = r.url || "#";
      var d = document.createElement("span");
      d.className = "d";
      d.textContent = fmtDMY(r.date) || r.date || "";
      var t = document.createElement("span");
      t.textContent = decodeEntities(r.title);
      a.appendChild(d);
      a.appendChild(t);
      box.appendChild(a);
      added++;
    }
    if (added === 0) box.style.display = "none";
  }


  /* ------- Visuals v2.2 (2026-06-10): refined SVG components ------- */
  var NS = "http://www.w3.org/2000/svg";
  var FMONO = "JetBrains Mono, Menlo, monospace";
  var FDISP = "Space Grotesk, Inter, sans-serif";
  function svgEl(vb) {
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", vb);
    s.setAttribute("width", "100%");
    s.style.display = "block";
    return s;
  }
  function sv(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) { if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]); }
    if (parent) parent.appendChild(e);
    return e;
  }
  function txt(parent, x, y, str, opts) {
    opts = opts || {};
    var t = sv("text", { x: x, y: y, "text-anchor": opts.anchor || "middle", "font-size": opts.size || 11, fill: opts.fill || "#7e84b5", "font-family": opts.mono === false ? FDISP : FMONO, "font-weight": opts.weight || "400", "letter-spacing": opts.ls || "0.08em" }, parent);
    t.textContent = str;
    return t;
  }
  function defsGrad(s, id, stops, x2, y2) {
    var defs = s.querySelector("defs") || sv("defs", {}, s);
    var g = sv("linearGradient", { id: id, x1: "0", y1: "0", x2: x2 == null ? "1" : x2, y2: y2 == null ? "0" : y2 }, defs);
    for (var i = 0; i < stops.length; i++) sv("stop", { offset: stops[i][0], "stop-color": stops[i][1], "stop-opacity": stops[i][2] == null ? 1 : stops[i][2] }, g);
    return "url(#" + id + ")";
  }
  function polar(cx, cy, r, deg) {
    var rad = (deg - 180) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }
  function arcPath(cx, cy, r, a0, a1) {
    var p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
    return "M " + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " A " + r + " " + r + " 0 " + ((a1 - a0) > 180 ? 1 : 0) + " 1 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2);
  }
  function regimeAngle(label, score) {
    var s = String(label || "").toLowerCase();
    var zone = 1;
    if (s.indexOf("crisis") > -1 || s.indexOf("bear") > -1) zone = 0;
    else if (s.indexOf("bull") > -1) zone = 2;
    var t = (score != null && !isNaN(score)) ? Math.max(0, Math.min(100, score)) / 100 : 0.5;
    var start = [10, 70, 130][zone];
    return start + t * 40;
  }
  function drawDial(mount, regimeLabel, score, confText) {
    if (!mount) return;
    mount.innerHTML = "";
    var s = svgEl("0 0 380 230");
    var cx = 190, cy = 168, R = 118;
    /* soft halo */
    sv("path", { d: arcPath(cx, cy, R, 4, 176), stroke: "#1e2244", "stroke-width": 26, fill: "none", "stroke-linecap": "round", opacity: 0.55 }, s);
    /* zones — thin, luminous */
    var zones = [[6, 62, "#fb7185"], [66, 114, "#f59e0b"], [118, 174, "#10b981"]];
    for (var i = 0; i < zones.length; i++) {
      sv("path", { d: arcPath(cx, cy, R, zones[i][0], zones[i][1]), stroke: zones[i][2], "stroke-width": 16, fill: "none", "stroke-linecap": "round", opacity: 0.16 }, s);
      sv("path", { d: arcPath(cx, cy, R, zones[i][0], zones[i][1]), stroke: zones[i][2], "stroke-width": 7, fill: "none", "stroke-linecap": "round", opacity: 0.95 }, s);
    }
    /* zone labels — anchored outside, never clipped */
    var pl = polar(cx, cy, R + 30, 30);
    txt(s, pl[0] + 4, pl[1] + 14, "CRISIS", { size: 10, fill: "#fb7185", ls: "0.18em" });
    var pn = polar(cx, cy, R + 30, 90);
    txt(s, pn[0], pn[1] + 2, "NEUTRAL", { size: 10, fill: "#f59e0b", ls: "0.18em" });
    var pb = polar(cx, cy, R + 30, 150);
    txt(s, pb[0] - 4, pb[1] + 14, "BULL", { size: 10, fill: "#10b981", ls: "0.18em" });
    /* needle */
    var ang = regimeAngle(regimeLabel, score);
    var tip = polar(cx, cy, R - 16, ang);
    var tail = polar(cx, cy, 14, ang + 180);
    sv("line", { x1: tail[0], y1: tail[1], x2: tip[0], y2: tip[1], stroke: "#e6e9ff", "stroke-width": 2.5, "stroke-linecap": "round" }, s);
    sv("circle", { cx: tip[0], cy: tip[1], r: 4.5, fill: "#e6e9ff" }, s);
    sv("circle", { cx: tip[0], cy: tip[1], r: 9, fill: "none", stroke: "#e6e9ff", "stroke-width": 1, opacity: 0.35 }, s);
    sv("circle", { cx: cx, cy: cy, r: 6, fill: "#1a1e3f", stroke: "#e6e9ff", "stroke-width": 2 }, s);
    /* readout below pivot — needle never crosses it */
    txt(s, cx, cy + 34, regimeLabel || "—", { mono: false, size: 21, weight: "700", fill: "#e6e9ff", ls: "0" });
    if (confText) txt(s, cx, cy + 52, String(confText).toUpperCase(), { size: 9, fill: "#7e84b5", ls: "0.16em" });
    mount.appendChild(s);
  }
  function drawZoneMap(mount, score, lo, hi) {
    if (!mount || score == null || isNaN(score)) return;
    mount.innerHTML = "";
    var s = svgEl("0 0 380 120");
    var x0 = 24, x1 = 356, y = 64, h = 10;
    var X = function (v) { return x0 + (x1 - x0) * Math.max(0, Math.min(100, v)) / 100; };
    var zones = [[0, 30, "#fb7185", "BEAR"], [30, 50, "#f59e0b", "DEFENSIVE"], [50, 70, "#94a3b8", "MIXED"], [70, 100, "#10b981", "BULL"]];
    sv("rect", { x: x0 - 4, y: y - 4, width: x1 - x0 + 8, height: h + 8, rx: 9, fill: "#0d0f26", stroke: "#1e2244" }, s);
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      sv("rect", { x: X(z[0]) + 1, y: y, width: X(z[1]) - X(z[0]) - 2, height: h, rx: 5, fill: z[2], opacity: 0.55 }, s);
      txt(s, (X(z[0]) + X(z[1])) / 2, y + 32, z[3], { size: 8.5, fill: z[2], ls: "0.14em" });
    }
    if (lo != null && hi != null && !isNaN(lo) && !isNaN(hi)) {
      sv("rect", { x: X(lo), y: y - 12, width: Math.max(2, X(hi) - X(lo)), height: h + 24, rx: 6, fill: "#a78bfa", opacity: 0.10 }, s);
      sv("line", { x1: X(lo), y1: y - 12, x2: X(lo), y2: y + h + 12, stroke: "#a78bfa", "stroke-width": 1, opacity: 0.55 }, s);
      sv("line", { x1: X(hi), y1: y - 12, x2: X(hi), y2: y + h + 12, stroke: "#a78bfa", "stroke-width": 1, opacity: 0.55 }, s);
      txt(s, (X(lo) + X(hi)) / 2, y + 50, "CONFIDENCE BAND " + Math.round(lo) + "–" + Math.round(hi), { size: 8, fill: "#a78bfa", ls: "0.14em" });
    }
    /* score marker + pill */
    sv("line", { x1: X(score), y1: y - 16, x2: X(score), y2: y + h + 8, stroke: "#e6e9ff", "stroke-width": 2.5, "stroke-linecap": "round" }, s);
    var pw = 44, px = Math.max(x0 + pw / 2, Math.min(x1 - pw / 2, X(score)));
    sv("rect", { x: px - pw / 2, y: y - 44, width: pw, height: 24, rx: 12, fill: "#1a1e3f", stroke: "#3e4682" }, s);
    txt(s, px, y - 27, String(Math.round(score)), { mono: false, size: 15, weight: "700", fill: "#e6e9ff", ls: "0" });
    mount.appendChild(s);
  }
  function regimeColor(rg) {
    var s = String(rg || "").toLowerCase();
    if (s.indexOf("crisis") > -1 || s.indexOf("bear") > -1) return "#fb7185";
    if (s.indexOf("bull") > -1) return "#10b981";
    return "#f59e0b";
  }
  function drawHistory(mount, note, rows, gradId) {
    if (!mount) return;
    mount.innerHTML = "";
    if (!rows || rows.length < 2) {
      if (note) note.textContent = "Recording in progress — the chart draws once at least two sessions are on record.";
      return;
    }
    if (note) note.textContent = "Each point is the MPI actually published that session, colored by that day's regime call. Reconstructed from committed snapshots; appended nightly; never revised.";
    var s = svgEl("0 0 380 180");
    var x0 = 34, x1 = 366, y0 = 16, y1 = 128;
    var n = rows.length;
    var X = function (i) { return x0 + (x1 - x0) * (n === 1 ? 0.5 : i / (n - 1)); };
    var Y = function (v) { return y1 - (y1 - y0) * Math.max(0, Math.min(100, v)) / 100; };
    var grid = [30, 50, 70];
    for (var gI = 0; gI < grid.length; gI++) {
      sv("line", { x1: x0, y1: Y(grid[gI]), x2: x1, y2: Y(grid[gI]), stroke: "#1e2244", "stroke-width": 1, "stroke-dasharray": "2 5" }, s);
      txt(s, x0 - 8, Y(grid[gI]) + 3, String(grid[gI]), { size: 9, fill: "#4f547a", anchor: "end", ls: "0" });
    }
    /* smooth path (monotone-ish bezier) */
    var pts = [];
    for (var i2 = 0; i2 < n; i2++) pts.push([X(i2), Y(rows[i2].score)]);
    var d = "M " + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i3 = 1; i3 < n; i3++) {
      var p0 = pts[i3 - 1], p1 = pts[i3];
      var mx = (p0[0] + p1[0]) / 2;
      d += " C " + mx.toFixed(1) + " " + p0[1].toFixed(1) + " " + mx.toFixed(1) + " " + p1[1].toFixed(1) + " " + p1[0].toFixed(1) + " " + p1[1].toFixed(1);
    }
    var lineGrad = defsGrad(s, gradId + "-l", [["0%", "#22d3ee"], ["100%", "#a78bfa"]]);
    var areaGrad = defsGrad(s, gradId + "-a", [["0%", "#22d3ee", 0.20], ["100%", "#22d3ee", 0]], 0, 1);
    sv("path", { d: d + " L " + pts[n - 1][0].toFixed(1) + " " + y1 + " L " + pts[0][0].toFixed(1) + " " + y1 + " Z", fill: areaGrad }, s);
    sv("path", { d: d, stroke: lineGrad, "stroke-width": 2.2, fill: "none", "stroke-linejoin": "round", "stroke-linecap": "round" }, s);
    /* regime ribbon under axis */
    var seg = (x1 - x0) / n;
    for (var k = 0; k < n; k++) {
      sv("rect", { x: x0 + k * seg + 0.5, y: y1 + 10, width: Math.max(1.5, seg - 1), height: 5, rx: 2.5, fill: regimeColor(rows[k].regime), opacity: 0.8 }, s);
    }
    txt(s, x0, y1 + 32, "REGIME", { size: 7.5, fill: "#4f547a", anchor: "start", ls: "0.2em" });
    /* last point emphasis */
    var lp = pts[n - 1];
    sv("circle", { cx: lp[0], cy: lp[1], r: 4, fill: "#22d3ee" }, s);
    sv("circle", { cx: lp[0], cy: lp[1], r: 8.5, fill: "none", stroke: "#22d3ee", "stroke-width": 1, opacity: 0.4 }, s);
    txt(s, Math.min(lp[0], x1 - 14), lp[1] - 12, String(Math.round(rows[n - 1].score)), { mono: false, size: 13, weight: "700", fill: "#e6e9ff", ls: "0" });
    /* date range */
    var fd = fmtDMY(rows[0].date) || rows[0].date, ld = fmtDMY(rows[n - 1].date) || rows[n - 1].date;
    txt(s, x0, 172, String(fd).toUpperCase(), { size: 8.5, fill: "#7e84b5", anchor: "start", ls: "0.1em" });
    txt(s, x1, 172, String(ld).toUpperCase(), { size: 8.5, fill: "#7e84b5", anchor: "end", ls: "0.1em" });
    mount.appendChild(s);
  }
  function drawExpectedMove(mount, spot, em) {
    if (!mount || spot == null || em == null || isNaN(spot) || isNaN(em)) return;
    mount.innerHTML = "";
    var s = svgEl("0 0 380 96");
    var x0 = 36, x1 = 344, y = 50;
    var lo = spot - em, hi = spot + em, pad = em * 0.5;
    var min = lo - pad, max = hi + pad;
    var X = function (v) { return x0 + (x1 - x0) * (v - min) / (max - min); };
    sv("line", { x1: x0 - 8, y1: y, x2: x1 + 8, y2: y, stroke: "#1e2244", "stroke-width": 1.5 }, s);
    var bandGrad = defsGrad(s, "plv2em-g", [["0%", "#22d3ee", 0.05], ["50%", "#22d3ee", 0.28], ["100%", "#22d3ee", 0.05]]);
    sv("rect", { x: X(lo), y: y - 9, width: X(hi) - X(lo), height: 18, rx: 9, fill: bandGrad }, s);
    sv("line", { x1: X(lo), y1: y - 13, x2: X(lo), y2: y + 13, stroke: "#22d3ee", "stroke-width": 1.5, opacity: 0.8 }, s);
    sv("line", { x1: X(hi), y1: y - 13, x2: X(hi), y2: y + 13, stroke: "#22d3ee", "stroke-width": 1.5, opacity: 0.8 }, s);
    sv("line", { x1: X(spot), y1: y - 17, x2: X(spot), y2: y + 17, stroke: "#e6e9ff", "stroke-width": 2.5, "stroke-linecap": "round" }, s);
    txt(s, X(spot), y - 26, "SPY " + spot.toFixed(2), { mono: false, size: 14, weight: "700", fill: "#e6e9ff", ls: "0" });
    txt(s, X(lo), y + 32, lo.toFixed(0), { size: 10, fill: "#7e84b5", ls: "0.05em" });
    txt(s, X(hi), y + 32, hi.toFixed(0), { size: 10, fill: "#7e84b5", ls: "0.05em" });
    txt(s, X(spot), y + 32, "±" + em.toFixed(2) + " · 1σ", { size: 9.5, fill: "#22d3ee", ls: "0.1em" });
    mount.appendChild(s);
  }
  function drawVolTerm(mount, vix, vix3m, rv, term) {
    if (!mount || vix == null || isNaN(vix)) return;
    mount.innerHTML = "";
    var s = svgEl("0 0 380 132");
    var rowsV = [["VIX", vix, "#fb7185"], ["VIX3M", vix3m, "#f59e0b"], ["RV 20D", rv, "#8b8fd8"]];
    var max = 0;
    for (var i = 0; i < rowsV.length; i++) { if (rowsV[i][1] != null && rowsV[i][1] > max) max = rowsV[i][1]; }
    max = max * 1.18 || 1;
    var x0 = 78, x1 = 318, yy = 22, rh = 30;
    for (var j = 0; j < rowsV.length; j++) {
      var v = rowsV[j][1];
      if (v == null || isNaN(v)) continue;
      var w = (x1 - x0) * v / max;
      txt(s, x0 - 10, yy + 5, rowsV[j][0], { size: 9, fill: "#7e84b5", anchor: "end", ls: "0.12em" });
      sv("rect", { x: x0, y: yy - 6, width: x1 - x0, height: 12, rx: 6, fill: "#0d0f26", stroke: "#1e2244" }, s);
      var g = defsGrad(s, "plv2vt" + j, [["0%", rowsV[j][2], 0.35], ["100%", rowsV[j][2], 0.95]]);
      sv("rect", { x: x0, y: yy - 6, width: Math.max(8, w), height: 12, rx: 6, fill: g }, s);
      txt(s, x0 + Math.max(8, w) + 10, yy + 5, v.toFixed(1), { mono: false, size: 13, weight: "700", fill: "#e6e9ff", anchor: "start", ls: "0" }, s);
      yy += rh;
    }
    if (term) {
      var tw = String(term).length * 7.5 + 28;
      sv("rect", { x: 380 - 24 - tw, y: 110, width: tw, height: 20, rx: 10, fill: "rgba(34,211,238,0.08)", stroke: "rgba(34,211,238,0.35)" }, s);
      txt(s, 380 - 24 - tw / 2, 124, String(term).toUpperCase(), { size: 9, fill: "#22d3ee", ls: "0.16em" });
      txt(s, 24, 124, "IMPLIED VS REALIZED", { size: 7.5, fill: "#4f547a", anchor: "start", ls: "0.18em" });
    }
    mount.appendChild(s);
  }
  var HISTORY_URL = "https://raw.githubusercontent.com/aztmm1/aztmm-mpi-data/main/data/mpi-history.json";
  function renderRegimeVisuals(m) {
    var regimeLabel = g(m, "data.regime_label");
    var score = g(m, "data.mpi_score");
    var lo = g(m, "data.confidence.ci_low"), hi = g(m, "data.confidence.ci_high");
    var conf = qualConfidence(g(m, "data.hmm.confidence"));
    drawDial($("plv2-rg-dial"), regimeLabel, score, conf);
    drawZoneMap($("plv2-rg-zone"), score, lo, hi);
    drawExpectedMove($("plv2-rg-em"), g(m, "data.market.spy_spot"), g(m, "data.market.expected_move_1sigma"));
    drawVolTerm($("plv2-rg-vol"), g(m, "data.volatility.vix"), g(m, "data.volatility.vix3m"), g(m, "data.volatility.realized_vol_20d_pct"), g(m, "data.volatility.term_shape"));
    try {
      var ts = Math.floor(Date.now() / (5 * 60 * 1000));
      fetch(HISTORY_URL + "?ts=" + ts, { cache: "default", credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (hjs) {
          var rows = (hjs && hjs.rows) || null;
          drawHistory($("plv2-rg-hist"), $("plv2-rg-hist-note"), rows, "plv2rgh");
          drawHistory($("plv2-mpi-hist"), $("plv2-mpi-hist-note"), rows, "plv2mph");
        })
        .catch(function () {});
    } catch (e) {}
  }

  /* always show next-update date, even before data lands */
  var nx0 = nextTradingDay();
  setText("plv2-nextdate", nx0.getUTCDate() + " " + MONTHS[nx0.getUTCMonth()]);

  /* ------- wiring: sitewide hydrator event, then a direct-fetch fallback ------- */
  document.addEventListener("aztmm:data", function (e) {
    hydrate((e && e.detail) || window.AZTMM_DATA);
  });
  if (window.AZTMM_DATA) hydrate(window.AZTMM_DATA);

  setTimeout(function () {
    if (hydrated || !window.fetch || !window.Promise) return;
    var ts = Math.floor(Date.now() / (5 * 60 * 1000));
    function get(u) {
      return fetch(u + "?ts=" + ts, { cache: "default", credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    Promise.all([
      get("https://raw.githubusercontent.com/aztmm1/aztmm-mpi-data/main/data/canonical-content.json"),
      get("https://raw.githubusercontent.com/aztmm1/aztmm-mpi-data/main/data/mpi.json")
    ]).then(function (res) {
      hydrate({ c: res[0], m: res[1] });
    });
  }, 4000);
})();
