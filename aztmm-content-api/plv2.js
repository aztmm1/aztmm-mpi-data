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
