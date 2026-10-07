/*
 * fire-seasons.js — the fire module's seasonal additions (Rainy Hollow series).
 *
 *   bg    z 9   fireworks: rockets rising from behind the hills, bursts inside
 *               layout.seasonal.fireworks (peony, chrysanthemum, ring, willow,
 *               crackle), a soft banded sky glow per burst
 *   scene z 41  sparkler sticks stuck in the snow (dark, outlined: they read on lit snow)
 *   scene z 45  sparkler burning cores (emissive)
 *   fx    z 36  sparkler fizz: short radiating, forking sparks + halo
 *   lights      one aggregated, coloured flash light for all live bursts and
 *               one small white-gold light per sparkler
 *
 * Everything is a pure function of t. Each firework edition gets a fixed
 * choreography for the whole loop, generated once from its own seed: launch
 * times follow flurries and ~8-15 s lulls, at most 3-4 shells are up at once,
 * every burst is placed clear of the house silhouette, the title-safe sky and
 * the moon, and the big show ends a flurry with a fan salvo twice a loop. A
 * shell launched near the end of the loop wraps to its start, so the show
 * loops seamlessly. Busy-ness scales with HD.edition.fireworks; colours come
 * from HD.edition.fireworkColors. The show is looked up from HD.edition at
 * draw time (prebuilt for every edition in init), so live switching works.
 * (The bonfire lives in fire.js as a scaled fire rig.)
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const LY = HD.layout;
  const ZONE = LY.seasonal.fireworks;
  const SAFE = LY.titleSafe;
  const MOON = LY.moon;
  const R = Math.round;
  const TAU = Math.PI * 2;
  const GOLDEN = 2.399963; // golden angle: even star spread on a sphere

  // ------------------------------------------------------------------
  // colour ramps: 0 = dim ember sinking into the sky ... 6 = white-hot
  // ------------------------------------------------------------------
  const mix = HD.color.mix;
  const SKY = P.night[2];
  const RAMPS = {};
  for (const k in P.firework) {
    const f = P.firework[k];
    RAMPS[k] = [mix(f[0], SKY, 0.5), f[0], mix(f[0], f[1], 0.5), f[1], mix(f[1], f[2], 0.45), f[2], mix(f[2], '#ffffff', 0.6)];
  }
  // willow / glitter gold leans warmer and darker as it cools (hue-shifted to amber/red)
  RAMPS.willow = [mix(P.fire[2], SKY, 0.5), P.fire[3], P.fire[5], P.amber[5], P.gold[5], P.gold[6], '#fff8e0'];
  // rocket comet tail
  const TAIL = [mix(P.fire[2], SKY, 0.4), P.fire[4], P.fire[6], P.amber[6], P.amber[8]];

  // ------------------------------------------------------------------
  // the house silhouette, from the layout anchors: bursts must stay clear of
  // it so they never read as the roof or the turret exploding. TOP[x] is the
  // highest solid y in column x (with a small margin), OPEN where sky is free.
  // ------------------------------------------------------------------
  const OPEN = 1e4;
  const TOP = new Float32Array(HD.W).fill(OPEN);
  function raiseTop(x0, x1, yAt) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(HD.W - 1, Math.ceil(x1)); x++) {
      const y = yAt(x);
      if (y < TOP[x]) TOP[x] = y;
    }
  }
  function cone(x0, x1, base, px, py) {
    raiseTop(x0, x1, (x) => base - (x <= px ? (x - x0) / (px - x0) : (x1 - x) / (x1 - px)) * (base - py));
  }
  {
    const hs = LY.house;
    const rf = hs.roof;
    const tu = hs.turret;
    const ch = hs.chimney;
    cone(rf.x0 - 2, rf.x1 + 2, rf.eave + 2, rf.peakX, rf.peakY - 1);
    raiseTop(rf.peakX - 2, rf.peakX + 2, () => rf.peakY - 7); // roof finial
    cone(tu.x0 - 2, tu.x1 + 2, tu.top + 2, tu.peakX, tu.peakY - 1);
    raiseTop(tu.peakX - 4, tu.peakX + 9, () => tu.peakY - 18); // crooked spire and its finial
    raiseTop(ch.x0 - 1, ch.x1 + 1, () => ch.top - 3);
  }

  // ------------------------------------------------------------------
  // show settings per edition: a fixed choreography for the whole loop,
  // generated once from the edition's own seed (so lunar, lights and newyear
  // each get their own show). Launches follow a slow density envelope, so the
  // sky has flurries and real lulls; at most `cap` shells are up at once.
  // ------------------------------------------------------------------
  const TYPE_LIFE = { peony: 2.7, chrys: 3.1, ring: 2.5, willow: 4.6, crackle: 3.0 };
  const MIXES = {
    lunar: { peony: 4, chrys: 3, ring: 0.8, willow: 1, crackle: 2.2 },
    lights: { peony: 3.2, chrys: 2, ring: 2, willow: 1.4, crackle: 1.4 },
    newyear: { peony: 3, chrys: 2.2, ring: 1.6, willow: 2.4, crackle: 1.4 },
    other: { peony: 3, chrys: 2, ring: 1.5, willow: 1.5, crackle: 1.5 },
  };
  const DRAG = { peony: 0.3, chrys: 0.36, ring: 0.28, willow: 0.5, crackle: 0.26 };
  const GRAV = { peony: 8, chrys: 7, ring: 5, willow: 15, crackle: 6 };

  function expand(tau, k) {
    return 1 - Math.exp(-tau / k);
  }
  function droop(tau, G) {
    return (G * tau * tau) / (1 + 0.7 * tau);
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  function pickType(types, u) {
    for (const t of types) if (u < t[1]) return t[0];
    return 'peony';
  }

  // the part of a burst that must clear the house: half width, lower half
  // height and the centre's sag under gravity around mid-life
  function footprint(sh) {
    const Rr = sh.R;
    let hw = Rr;
    let vb = 0.9 * Rr;
    let drop = droop(0.5 * sh.life, GRAV[sh.type] * 1.15);
    if (sh.type === 'ring') {
      const c = Math.cos(sh.rot);
      const s = Math.sin(sh.rot);
      hw = Rr * Math.hypot(c, sh.tilt * s);
      vb = Rr * Math.hypot(s, sh.tilt * c);
    } else if (sh.type === 'willow') {
      vb = 0.75 * Rr;
      drop = droop(0.45 * sh.life, GRAV.willow) - 0.2 * Rr;
    } else if (sh.type === 'crackle') {
      hw += 4;
      vb += 4;
    }
    return [hw + 2, vb, drop];
  }
  // the lowest burst centre (largest y) at bx that keeps the footprint 3px above the house
  function byLimit(bx, fp) {
    const hw = fp[0];
    let lim = OPEN;
    for (let x = Math.max(0, Math.floor(bx - hw)); x <= Math.min(HD.W - 1, Math.ceil(bx + hw)); x++) {
      const top = TOP[x];
      if (top >= OPEN) continue;
      const u = (x - bx) / hw;
      const k = 1 - u * u;
      if (k <= 0) continue;
      const y = top - 3 - fp[2] - fp[1] * Math.sqrt(k);
      if (y < lim) lim = y;
    }
    return lim;
  }

  /**
   * Place a burst: candidate spots across the zone, lifted clear of the house,
   * outside the title-safe sky and off the moon, scored to keep away from the
   * bursts that share the sky with it (so the show moves around). Shrinks the
   * shell if nothing fits. opt {tx, ty} steers a salvo shell (x in px, height 0..1).
   */
  function placeShell(sh, s, rnd, others, opt) {
    for (let tries = 0; tries < 4; tries++) {
      const Rr = sh.R;
      const fp = footprint(sh);
      const xMin = ZONE.x0 + Rr * 0.3;
      const xMax = ZONE.x1 - Rr - 2;
      const yMin = ZONE.y0 + Rr * 0.9;
      const yMax = ZONE.y1 - Rr * 0.35;
      let best = null;
      let bestScore = Infinity;
      for (let c = 0; c < 24; c++) {
        const bx = xMin + rnd() * (xMax - xMin);
        // near (big) bursts sit higher, far (small) ones lower over the hills
        const yk = opt ? clamp01(opt.ty + (rnd() - 0.5) * 0.1) : clamp01((1 - sh.depth) * 0.42 + rnd() * 0.42);
        let by = yMin + yk * (yMax - yMin);
        const lim = byLimit(bx, fp);
        if (lim < yMin) continue; // no room above the house here
        let score = rnd() * 0.4;
        if (by > lim) {
          score += (by - lim) * 0.03; // lifted clear of the roof
          by = lim;
        }
        if (bx - fp[0] < SAFE.x1 + 6 && by - Rr < SAFE.y1 + 6) continue; // title-safe sky stays calm
        if (s.moon && Math.hypot(bx - MOON.x, by - MOON.y) < Rr * 0.5 + MOON.r + 4) continue;
        for (const o of others) {
          const need = (Rr + o.R) * 0.95;
          const d = Math.hypot(bx - o.bx, by - o.by);
          if (d < need) score += ((need - d) / need) * 4;
          score += 0.8 * Math.max(0, 1 - d / 110); // spread the show around the sky
        }
        if (opt) score += Math.abs(bx - opt.tx) / 40;
        if (s.denseTree && bx > 348) score += (bx - 348) / 30; // a leafy crown hides most of the burst
        if (score < bestScore) {
          bestScore = score;
          best = [bx, by];
        }
      }
      if (best) {
        sh.bx = best[0];
        sh.by = best[1];
        return true;
      }
      sh.R *= 0.86; // nothing fits: try a smaller shell
    }
    return false;
  }

  function edSeed(id) {
    let h = 7;
    for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
    return h;
  }

  function buildShow(ed) {
    const f = clamp01(ed.fireworks || 0);
    const mixw = MIXES[ed.id] || MIXES.other;
    const types = [];
    let sum = 0;
    for (const k of ['peony', 'chrys', 'ring', 'willow', 'crackle']) {
      sum += mixw[k];
      types.push([k, sum]);
    }
    for (const t of types) t[1] /= sum;
    const s = {
      f,
      list: [],
      size: 0.84 + 0.3 * f, // burst scale
      colors: ed.fireworkColors && ed.fireworkColors.length ? ed.fireworkColors : ['gold', 'white'],
      types,
      moon: ed.moon && ed.moon !== 'none',
      denseTree: ed.tree === 'autumn' || ed.tree === 'blossom' || ed.tree === 'summer',
      salvo: f >= 0.9, // the big show gets a fan salvo as its climax, twice a loop
    };
    if (!f) return s;
    const L = HD.LOOP;
    const seed = edSeed(ed.id);
    const rnd = HD.rng(6060 ^ seed);
    const list = s.list;
    const nc = s.colors.length;
    const cap = f >= 0.9 ? 4 : 3;
    const brk = (sh) => sh.t0 + sh.rise;
    const total = (sh) => sh.rise + sh.life;
    const wrap = (d) => d - Math.floor(d / L) * L;
    const liveAt = (sh, p) => wrap(p - sh.t0) < total(sh);
    const countAt = (p) => {
      let n = 0;
      for (const o of list) if (liveAt(o, p)) n++;
      return n;
    };
    // bursts sharing the sky with sh (overlapping bright phases, or close in time)
    const near = (sh) => {
      const out = [];
      const b = brk(sh);
      for (const o of list) {
        const d = wrap(brk(o) - b);
        if (Math.min(d, L - d) < 7) out.push(o);
      }
      return out;
    };
    let idx = 0;
    const shell = (t0, type) => {
      const depth = rnd();
      const rise = 1.15 + rnd() * 0.6;
      const life = TYPE_LIFE[type] * (0.92 + 0.16 * rnd());
      const col = type === 'willow' ? 'willow' : s.colors[Math.floor(rnd() * nc) % nc];
      let col2 = s.colors[Math.floor(rnd() * nc) % nc];
      if (col2 === col || rnd() < 0.45 || type === 'ring' || type === 'willow') col2 = null;
      return {
        type,
        t0,
        rise,
        life,
        seed: (Math.imul(seed, 131) + idx++ * 977 + 17) | 0,
        depth,
        far: depth < 0.22,
        R: (type === 'willow' ? 26 + 6 * depth : 17 + 16 * depth) * s.size * (type === 'crackle' ? 0.8 : 1),
        col,
        col2,
        tilt: 0.35 + 0.45 * rnd(),
        rot: (rnd() - 0.5) * 1.2,
        sway: (rnd() - 0.5) * 18,
        bx: 0,
        by: 0,
        tau: 0,
      };
    };

    // salvo: four shells fanned across the sky, alternating ring and peony,
    // staggered in height, each with its own tilt; a lull follows
    const salvoAt = s.salvo ? [L * 0.25, L * 0.75] : [];
    for (const ts of salvoAt) {
      const ringFirst = rnd() < 0.5;
      const c0 = s.colors[Math.floor(rnd() * nc) % nc];
      let c1 = s.colors[Math.floor(rnd() * nc) % nc];
      if (c1 === c0) c1 = s.colors[(s.colors.indexOf(c0) + 1) % nc];
      const mine = [];
      for (let k = 0; k < 4; k++) {
        const type = (k + (ringFirst ? 0 : 1)) % 2 === 0 ? 'ring' : 'peony';
        const sh = shell(ts + k * 0.55, type);
        sh.rise = 1.3;
        sh.life = TYPE_LIFE[type];
        sh.depth = 0.55;
        sh.far = false;
        sh.R = 21 * s.size * (0.92 + 0.16 * rnd());
        sh.col = k & 1 ? c1 : c0;
        sh.col2 = type === 'peony' ? (k & 1 ? c0 : c1) : null; // peonies carry the other colour inside
        sh.tilt = 0.3 + 0.45 * rnd();
        sh.rot = (rnd() - 0.5) * 1.1;
        sh.sway = (k - 1.5) * 10;
        const ty = k & 1 ? 0.4 + 0.12 * rnd() : 0.06 + 0.12 * rnd();
        const tx = ZONE.x0 + 40 + ((k + 0.5) / 4) * (ZONE.x1 - ZONE.x0 - 70);
        if (placeShell(sh, s, rnd, mine, { tx, ty })) {
          mine.push(sh);
          list.push(sh);
        }
      }
    }
    const quiet = (t) => {
      for (const ts of salvoAt) {
        const d = wrap(t - ts);
        if (d < 12 || L - d < 3) return true; // the salvo stands alone, then a lull
      }
      return false;
    };
    const buildUp = (t) => {
      for (const ts of salvoAt) if (L - wrap(t - ts) < 16) return true;
      return false;
    };
    // density envelope: flurries that swell and fade, separated by lulls of
    // ~8-14 s, tiling the loop exactly (so the show loops seamlessly)
    const segs = [];
    let acc = 0;
    while (acc < L) {
      const fl = 16 + 20 * rnd();
      const lu = 8 + 6 * rnd();
      segs.push(fl, lu);
      acc += fl + lu;
    }
    const ends = [];
    let cum = 0;
    for (const d of segs) ends.push((cum += (d * L) / acc));
    const segOff = rnd() * L;
    const env = (t) => {
      if (buildUp(t)) return 0.9;
      const u = wrap(t - segOff);
      let a0 = 0;
      for (let i = 0; i < ends.length; i++) {
        if (u < ends[i]) {
          if (i & 1) return 0.02; // lull
          const x = (u - a0) / (ends[i] - a0);
          return 0.4 + 0.6 * Math.sin(Math.PI * x);
        }
        a0 = ends[i];
      }
      return 0.02;
    };
    const rateMax = (12 + 38 * f) / 60; // launches per second at the envelope's peak
    let t = rnd() * 2;
    for (let guard = 0; guard < 5000; guard++) {
      t += -Math.log(1 - rnd() * 0.999) / rateMax;
      if (t >= L) break;
      if (rnd() > env(t) || quiet(t)) continue;
      const sh = shell(t, pickType(types, rnd()));
      // keep breaks apart and the sky uncrowded
      let ok = countAt(t) < cap;
      for (let i = 0; ok && i < list.length; i++) {
        const o = list[i];
        const db = wrap(brk(o) - brk(sh));
        if (Math.min(db, L - db) < 0.35) ok = false;
        else if (wrap(o.t0 - t) < total(sh) && countAt(o.t0) >= cap) ok = false;
      }
      if (!ok) continue;
      if (placeShell(sh, s, rnd, near(sh), null)) list.push(sh);
    }
    // no lull longer than maxIdle: a lone shell goes up in the middle of any
    const maxIdle = f >= 0.9 ? 14 : 16;
    for (let guard = 0; guard < 24; guard++) {
      const iv = [];
      for (const o of list) {
        const e = o.t0 + total(o);
        if (e <= L) iv.push([o.t0, e]);
        else iv.push([o.t0, L], [0, e - L]);
      }
      iv.sort((p, q) => p[0] - q[0]);
      let gs = 0;
      let gl = 0;
      let end = iv.length ? iv[iv.length - 1][1] - L : 0; // wrap: idle from the last end
      for (const [a0, a1] of iv) {
        if (a0 - end > gl) {
          gl = a0 - end;
          gs = end;
        }
        if (a1 > end) end = a1;
      }
      if (iv.length && iv[0][0] + L - end > gl) {
        gl = iv[0][0] + L - end;
        gs = end;
      }
      if (gl <= maxIdle) break;
      const sh = shell(wrap(gs + gl * 0.5 - 1.5), pickType(types, rnd()));
      if (placeShell(sh, s, rnd, near(sh), null)) list.push(sh);
    }
    list.sort((a, b) => a.t0 - b.t0);
    return s;
  }
  // built once per edition (~10 ms), prewarmed in init() so a live edition
  // switch never hitches; always looked up from HD.edition at draw time
  const SHOWS = new Map();
  function showFor(ed) {
    let s = SHOWS.get(ed.id);
    if (!s) SHOWS.set(ed.id, (s = buildShow(ed)));
    return s;
  }
  const show = () => showFor(HD.edition);

  // live shells at t (tau = time since launch), shared by lights() and the draw pass
  const LIVE = [];
  let liveT = NaN;
  let liveS = null;
  function liveShells(t, s) {
    if (t === liveT && s === liveS) return LIVE;
    liveT = t;
    liveS = s;
    LIVE.length = 0;
    const L = HD.LOOP;
    const tt = ((t % L) + L) % L;
    for (const sh of s.list) {
      let d = tt - sh.t0;
      if (d < 0) d += L;
      if (d < sh.rise + sh.life) {
        sh.tau = d;
        LIVE.push(sh);
      }
    }
    return LIVE;
  }

  // ------------------------------------------------------------------
  // burst drawing
  // ------------------------------------------------------------------
  const RISE_Y = 168; // rockets appear from behind the hills

  function drawRocket(g, sh, t) {
    const u = Math.min(1, sh.tau / sh.rise);
    const x0 = sh.bx + sh.sway;
    const ease = (v) => 1 - (1 - v) * (1 - v);
    const pos = (v) => {
      const e = ease(Math.max(0, v));
      return [x0 + (sh.bx - x0) * e, RISE_Y + (sh.by - RISE_Y) * e];
    };
    const tk = HD._fire.tick(t, 15);
    // sparkly tail: older samples dimmer, a few blink out
    for (let k = 6; k >= 1; k--) {
      const v = u - k * 0.028;
      if (v < 0) continue;
      if (k > 2 && HD.hash(sh.seed, k, tk) < 0.35) continue;
      const [x, y] = pos(v);
      const lv = Math.max(0, 4 - Math.ceil(k * 0.7));
      g.px(R(x), R(y), TAIL[lv]);
    }
    const [hx, hy] = pos(u);
    g.px(R(hx), R(hy), TAIL[4]);
    if (u < 0.85) g.px(R(hx), R(hy) + 1, TAIL[2]);
  }

  // a comet streak from (x0,y0) (tail) to (x1,y1) (head, not drawn: heads go
  // in a second pass so no tail ever paints over a brighter head). The tail
  // fades `fade` levels; levels below minL are skipped (no muddy sky-mixed
  // pixels in a fresh burst's bright core)
  function streak(g, x0, y0, x1, y1, rp, lv, fade, minL) {
    x0 = R(x0);
    y0 = R(y0);
    x1 = R(x1);
    y1 = R(y1);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s < n; s++) {
      const u = s / n; // 0 = tail
      const l = lv - Math.ceil((1 - u) * fade);
      if (l < minL) continue;
      g.px(R(x0 + (x1 - x0) * u), R(y0 + (y1 - y0) * u), rp[l]);
    }
  }

  // head brightness over a star's life u (0..1)
  function headLvl(u) {
    return u < 0.09 ? 6 : u < 0.3 ? 5 : u < 0.52 ? 4 : u < 0.7 ? 3 : u < 0.83 ? 2 : u < 0.93 ? 1 : 0;
  }

  // second-pass head list: x, y, colour, and an optional trailing direction
  // for the fat 2x2 heads of fresh near stars
  const HX = new Int16Array(512);
  const HY = new Int16Array(512);
  const HC = new Array(512);
  const HC2 = new Array(512);
  const HTX = new Int8Array(512);
  const HTY = new Int8Array(512);
  let HN = 0;
  function head(x, y, c, c2, tx, ty) {
    if (HN >= 512) return;
    HX[HN] = R(x);
    HY[HN] = R(y);
    HC[HN] = c;
    HC2[HN] = c2;
    HTX[HN] = tx;
    HTY[HN] = ty;
    HN++;
  }
  function flushHeads(g) {
    // fat heads first (their dimmer trailing pixels sit under any later head)
    for (let i = 0; i < HN; i++) {
      if (!HC2[i]) continue;
      const x = HX[i];
      const y = HY[i];
      g.px(x + HTX[i], y, HC2[i]);
      g.px(x, y + HTY[i], HC2[i]);
      g.px(x + HTX[i], y + HTY[i], HC2[i]);
    }
    for (let i = 0; i < HN; i++) g.px(HX[i], HY[i], HC[i]);
    HN = 0;
  }

  function drawBurst(g, sh, t) {
    const tb = sh.tau - sh.rise;
    const type = sh.type;
    const ramp = RAMPS[sh.col] || RAMPS.gold;
    const ramp2 = sh.col2 ? RAMPS[sh.col2] : null;
    const k = DRAG[type];
    const G = GRAV[type];
    const Rr = sh.R;
    const dim = sh.far ? 1 : 0;
    const tk = HD._fire.tick(t, 12);
    const cx = sh.bx;
    const cy = sh.by;
    const cr = Math.cos(sh.rot);
    const sr = Math.sin(sh.rot);
    const rot0 = HD.hash(sh.seed, 3, 9) * TAU;
    // no dark sky-mixed tail pixels while the burst is still a bright ball
    const minL = tb < 0.4 ? 2 : 0;
    HN = 0;

    // break: a bright flash ball that swells with the stars and thins out
    // (no empty ring between the core and the fresh stars)
    if (tb < 0.2) {
      const rb = expand(tb, k) * Rr * 0.8;
      if (rb >= 2) g.ditherCircle(cx, cy, rb, ramp[4 - dim], 1 - tb / 0.2, 0.45);
    }
    if (tb < 0.14) {
      const lvC = tb < 0.07 ? 6 : 5;
      const x = R(cx);
      const y = R(cy);
      const cc = ramp[lvC - 3];
      g.px(x - 1, y - 1, cc);
      g.px(x + 1, y - 1, cc);
      g.px(x - 1, y + 1, cc);
      g.px(x + 1, y + 1, cc);
      g.px(x - 1, y, ramp[lvC - 1]);
      g.px(x + 1, y, ramp[lvC - 1]);
      g.px(x, y - 1, ramp[lvC - 1]);
      g.px(x, y + 1, ramp[lvC - 1]);
      g.px(x, y, ramp[lvC]);
    }

    // shells: [count, radius scale, ramp, life scale]
    const shells = [];
    const nk = sh.far ? 0.7 : 1;
    if (type === 'ring') shells.push([Math.round((24 + Rr * 0.6) * nk), 1, ramp, 1]);
    else if (type === 'willow') shells.push([Math.round((20 + Rr * 0.5) * nk), 1, ramp, 1]);
    else if (type === 'crackle') shells.push([Math.round((18 + Rr * 0.6) * nk), 1, ramp, 0.5]);
    else {
      shells.push([Math.round((22 + Rr * 0.8) * nk), 1, ramp, 1]);
      if (ramp2) shells.push([Math.round((10 + Rr * 0.3) * nk), 0.5, ramp2, 0.8]);
    }
    // the chrysanthemum's trail only starts once the stars have left the core
    const tC = -k * Math.log(0.8);

    for (let si = 0; si < shells.length; si++) {
      const [n, rs, rp, ls] = shells[si];
      for (let j = 0; j < n; j++) {
        const h1 = HD.hash(sh.seed, j, 21 + si);
        const h2 = HD.hash(sh.seed, j, 31 + si);
        const h3 = HD.hash(sh.seed, j, 41 + si);
        // staggered burn-out: the shell disintegrates instead of fading as one dotted ring
        const lifeJ = sh.life * ls * (type === 'ring' ? 0.8 + 0.2 * h3 : 0.6 + 0.4 * h3);
        if (tb > lifeJ) continue;
        // direction: rim-weighted sphere (|z| < 0.55) so the burst reads as a clean ball
        let a = ((j + (h1 - 0.5) * 0.5) / n) * TAU + rot0 + si * 0.5;
        if (type === 'willow') a += (HD.hash(sh.seed, j, 61) - 0.5) * 0.45; // no straight spokes
        let dx;
        let dy;
        let back = 0;
        if (type === 'ring') {
          const ex = Math.cos(a);
          const ey = Math.sin(a) * sh.tilt;
          dx = ex * cr - ey * sr;
          dy = ex * sr + ey * cr;
          back = Math.sin(a) < -0.2 ? 1 : 0;
        } else {
          const z = (h2 - 0.5) * 1.1;
          const rr = Math.sqrt(1 - z * z);
          dx = rr * Math.cos(a);
          dy = rr * Math.sin(a);
          back = z < -0.35 ? 1 : 0;
          if (type === 'willow') dy = dy * 0.75 - 0.2;
        }
        let sp = Rr * rs * (0.93 + 0.12 * h3);
        // late rings and peonies loosen: per-star speed and sag spread grows with time
        let Gj = G;
        if (type === 'ring' || type === 'peony') {
          const h4 = HD.hash(sh.seed, j, 71 + si);
          const loose = Math.min(1, tb / 1.2);
          sp *= 1 + (h4 - 0.5) * 0.16 * loose;
          Gj = G * (0.8 + 0.4 * HD.hash(sh.seed, j, 81 + si));
        }
        const u = tb / lifeJ;
        let lv = headLvl(u) - dim - back;
        if (lv < 0) continue;
        // dying stars sputter out (tiny dim pixels only, never a flash)
        if (u > 0.72 && type !== 'willow' && type !== 'crackle' && HD.hash(sh.seed, j * 8 + si, tk, 5) < (u - 0.72) * 1.8) continue;
        // glitter: late willow / crackle stars twinkle
        const glit = u > 0.55 && (type === 'willow' || type === 'crackle') && HD.hash(sh.seed, j * 8 + si, tk) < 0.28;
        const e = expand(tb, k);
        const hx = cx + dx * sp * e;
        const hy = cy + dy * sp * e + droop(tb, Gj);
        if (type === 'willow') {
          // long hanging trail: a polyline through earlier positions, fading to
          // amber; it never reaches back into the core
          let px = hx;
          let py = hy;
          for (let q = 1; q <= 7; q++) {
            const tq = tb - q * 0.14;
            if (tq < 0.12) break;
            const eq = expand(tq, k);
            const qx = cx + dx * sp * eq;
            const qy = cy + dy * sp * eq + droop(tq, G);
            const l = lv - 1 - (q >> 1);
            if (l < minL) break;
            streak(g, qx, qy, px, py, rp, l, 1, minL);
            g.px(R(px), R(py), rp[l]);
            px = qx;
            py = qy;
          }
          if (!glit) head(hx, hy, rp[Math.min(6, lv + 1)], null, 0, 0);
          continue;
        }
        // comet streak: long spokes while fast, then a short falling tail as the
        // star slows and sags under gravity
        const dt = type === 'chrys' ? 0.24 : type === 'ring' ? 0.08 : u < 0.3 ? 0.1 : 0.18;
        let t0 = Math.max(0, tb - dt);
        if (type === 'chrys') t0 = Math.max(t0, tC);
        if (t0 < tb) {
          const e0 = expand(t0, k);
          const tx = cx + dx * sp * e0;
          const ty = cy + dy * sp * e0 + droop(t0, Gj);
          // the chrysanthemum's trail burns gold whatever the head colour
          if (type === 'chrys') streak(g, tx, ty, hx, hy, RAMPS.willow, Math.min(5, lv), 3, minL);
          else if (!glit) streak(g, tx, ty, hx, hy, rp, lv, 3, minL);
        }
        if (glit) continue;
        if (lv >= 5 && !dim && !back && type !== 'crackle' && type !== 'chrys') {
          // fresh, near stars: a fat 2x2 head, its dimmer pixels on the trailing
          // side (no perpendicular arms: the head never reads as a glyph)
          const vy = dy * sp * Math.exp(-tb / k) / k + (2 * Gj * tb) / (1 + 0.7 * tb);
          head(hx, hy, rp[lv], lv === 6 ? rp[4] : rp[3], dx >= 0 ? -1 : 1, vy >= 0 ? -1 : 1);
        } else head(hx, hy, rp[lv], null, 0, 0);
      }
    }
    flushHeads(g);

    // crackle: once the gold stars burn out, each pops into a few tiny white flashes
    if (type === 'crackle') {
      const n = Math.round(16 + Rr * 0.5);
      const W = RAMPS.white;
      for (let j = 0; j < n; j++) {
        const h1 = HD.hash(sh.seed, j, 21);
        const h2 = HD.hash(sh.seed, j, 31);
        const h3 = HD.hash(sh.seed, j, 41);
        const t0 = sh.life * 0.5 * (0.8 + 0.2 * h3) * 0.85;
        if (tb < t0) continue;
        const a = ((j + (h1 - 0.5) * 0.5) / n) * TAU + rot0;
        const z = (h2 - 0.5) * 1.1;
        const rr = Math.sqrt(1 - z * z);
        const e = expand(t0, k);
        const sp = Rr * (0.93 + 0.12 * h3);
        const sx = cx + rr * Math.cos(a) * sp * e;
        const sy = cy + rr * Math.sin(a) * sp * e + droop(tb, G);
        for (let m = 0; m < 3; m++) {
          const at = t0 + HD.hash(sh.seed, j, 40 + m) * (sh.life - t0 - 0.2);
          const dtm = tb - at;
          if (dtm < 0 || dtm > 0.2) continue;
          const ox = R(sx + (HD.hash(sh.seed, j, 50 + m) - 0.5) * 8);
          const oy = R(sy + (HD.hash(sh.seed, j, 60 + m) - 0.5) * 8);
          const lvp = dtm < 0.08 ? 6 : dtm < 0.14 ? 4 : 2;
          if (dtm < 0.08) {
            // a tiny round pop: 2x2, brightest corner first
            g.px(ox + 1, oy, W[3]);
            g.px(ox, oy + 1, W[3]);
            g.px(ox + 1, oy + 1, W[2]);
          }
          g.px(ox, oy, W[lvp - dim]);
        }
      }
    }
  }

  // sky glow behind a burst (additive): a saturated tint of its colour, never grey
  const GLOW = {
    gold: [1, 0.62, 0.22],
    red: [1, 0.26, 0.16],
    green: [0.26, 1, 0.42],
    blue: [0.26, 0.46, 1],
    violet: [0.62, 0.3, 1],
    magenta: [1, 0.26, 0.66],
    white: [1, 0.74, 0.42], // white shells glow warm
    willow: [1, 0.56, 0.2],
  };
  // glow profile of a burst (0..1): quick attack, soft decay
  function flashOf(sh) {
    const tb = sh.tau - sh.rise;
    if (tb < 0) return 0;
    const a = tb < 0.1 ? tb / 0.1 : Math.exp(-(tb - 0.1) / 0.65);
    return a * (sh.far ? 0.55 : 1) * (sh.type === 'willow' ? 0.8 : 1);
  }
  // scene light profile: a slower swell and fade, so the yard never pops
  function lightOf(sh) {
    const tb = sh.tau - sh.rise;
    if (tb < 0) return 0;
    let a;
    if (tb < 0.3) {
      const u = tb / 0.3;
      a = u * u * (3 - 2 * u);
    } else a = Math.exp(-(tb - 0.3) / 0.75);
    return a * (sh.far ? 0.55 : 1) * (sh.type === 'willow' ? 0.8 : 1);
  }

  function drawFireworks(g, t) {
    const s = show();
    if (!s.list.length) return;
    const list = liveShells(t, s);
    // glows first (additive, behind every burst)
    for (const sh of list) {
      const fl = flashOf(sh);
      if (fl <= 0.02) continue;
      const col = GLOW[sh.col] || GLOW.gold;
      const rad = Math.max(10, Math.round((sh.R * 1.1) / 4) * 4);
      HD.glow(g, sh.bx, sh.by, rad, col, 0.2 * fl);
    }
    for (const sh of list) {
      if (sh.tau < sh.rise) drawRocket(g, sh, t);
      else drawBurst(g, sh, t);
    }
  }

  // one aggregated coloured light for all bursts, clipped to the relit scene
  const FW_CLIP = { x0: 140, y0: 40, x1: HD.W - 1, y1: HD.H - 1 };
  function fireworkLights(t, L) {
    const s = show();
    if (!s.list.length) return;
    const list = liveShells(t, s);
    let w = 0;
    let x = 0;
    let y = 0;
    let r = 0;
    let gc = 0;
    let b = 0;
    for (const sh of list) {
      const fl = lightOf(sh) * (sh.R / 24);
      if (fl <= 0.01) continue;
      const col = HD.LIGHT.firework[sh.col] || HD.LIGHT.firework.gold;
      w += fl;
      x += sh.bx * fl;
      y += sh.by * fl;
      r += col[0] * fl;
      gc += col[1] * fl;
      b += col[2] * fl;
    }
    if (w < 0.05) return;
    L.add({
      x: R(x / w),
      y: R(y / w) + 70,
      r: 170,
      ry: 110,
      color: [r / w, gc / w, b / w],
      i: Math.min(0.18, 0.12 * w),
      bands: 4,
      pow: 1.25,
      clip: FW_CLIP,
    });
  }

  // ------------------------------------------------------------------
  // sparklers
  // ------------------------------------------------------------------
  const SPK = LY.seasonal.sparklers || [];
  const SPK_P = 80; // one sparkler lasts ~80 s, then a fresh one is lit
  const SPK_LEN = 13;
  const SPK_LIGHT = [1, 0.82, 0.5];
  const SPK_CORE = ['#fffdf2', '#fff2b0', '#f7d969', '#f0a830', '#e4571a', '#9a2610'];

  // one sparkler's life: a fresh stick is pushed into the snow (1 s), lit and
  // fizzes down to the handle, dies to an ember, and the spent stub is pulled
  // out a moment before the next one is placed
  const SPK_PLACE = 1;
  const SPK_GONE = 1.4;
  function sparklerState(t, k) {
    const s = SPK[k];
    const c = T.cycle(t, k, SPK_P, 5150 + k);
    const tau = c.age * c.P;
    const lean = k % 2 === 0 ? -0.18 : 0.14;
    let fizz;
    const lit = tau - SPK_PLACE;
    if (lit < 0) fizz = 0;
    else if (lit < 1.2) fizz = lit / 1.2;
    else if (tau < c.P - 5) fizz = 1;
    else if (tau < c.P - 3) fizz = (c.P - 3 - tau) / 2;
    else fizz = 0;
    const prog = Math.min(1, Math.max(0, lit / (c.P - 4 - SPK_PLACE))); // 0 = fresh, 1 = burnt to the handle
    const bLen = SPK_LEN - prog * (SPK_LEN - 5); // burn point height along the stick
    const len = SPK_LEN;
    return {
      x: s.x,
      base: s.base,
      lean,
      len,
      bLen,
      fizz,
      gone: tau >= c.P - SPK_GONE,
      ember: tau >= c.P - 5 && tau < c.P - SPK_GONE ? Math.max(0, 1 - (tau - (c.P - 5)) / (5 - SPK_GONE)) : 0,
      bx: s.x + lean * bLen,
      by: s.base - bLen,
    };
  }

  function drawSparklerSticks(g, t) {
    if (!HD.tag('sparklers')) return;
    for (let k = 0; k < SPK.length; k++) {
      const st = sparklerState(t, k);
      if (st.gone) continue;
      // dark enough to silhouette against the relit snow, with a darker edge
      // on the side facing the fire
      for (let h = 0; h <= st.len; h++) {
        const x = R(st.x + st.lean * h);
        const y = st.base - h;
        let c;
        if (h < 4) c = P.stone[4]; // bare wire handle
        else if (h < st.bLen) c = h % 3 === 0 ? P.stone[4] : P.stone[3]; // coating, unburnt
        else c = P.stone[1]; // burnt: dark, brittle
        g.px(x, y, c);
        if (h >= 1 && h < st.bLen) g.px(x - 1, y, P.stone[0]);
      }
      // a little snow pushed up around the foot
      g.px(st.x - 1, st.base, P.snow[6]);
      g.px(st.x + 1, st.base, P.snow[5]);
    }
  }

  function drawSparklerCores(g, t) {
    if (!HD.tag('sparklers')) return;
    for (let k = 0; k < SPK.length; k++) {
      const st = sparklerState(t, k);
      if (st.gone) continue;
      const x = R(st.bx);
      const y = R(st.by);
      if (st.fizz > 0) {
        g.em.px(x, y, SPK_CORE[0]);
        g.em.px(x, y + 1, SPK_CORE[2]);
      } else if (st.ember > 0) {
        g.em.px(x, y, st.ember > 0.5 ? SPK_CORE[4] : SPK_CORE[5]);
      }
    }
  }

  function drawSparklerFizz(g, t) {
    if (!HD.tag('sparklers')) return;
    const ts = T.step(t, 15);
    const tk = HD._fire.tick(t, 15);
    for (let k = 0; k < SPK.length; k++) {
      const st = sparklerState(t, k);
      if (st.fizz <= 0) continue;
      const x0 = R(st.bx);
      const y0 = R(st.by);
      const fl = T.flicker(ts, 300 + k, 2);
      HD.glow(g, x0, y0, 9, SPK_LIGHT, (0.16 + 0.12 * fl) * st.fizz);
      const nRay = Math.round((6 + 5 * fl) * st.fizz);
      for (let j = 0; j < nRay; j++) {
        const h0 = HD.hash(k, tk, j, 1);
        const h1 = HD.hash(k, tk, j, 2);
        const h2 = HD.hash(k, tk, j, 3);
        const a = h0 * TAU;
        const len = (2 + h1 * 5.5) * (0.6 + 0.4 * st.fizz);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        let lx = x0;
        let ly = y0;
        const steps = Math.max(2, Math.round(len));
        for (let s = 1; s <= steps; s++) {
          const px = R(x0 + ca * s);
          const py = R(y0 + sa * s);
          const u = s / steps;
          g.px(px, py, SPK_CORE[u < 0.34 ? 1 : u < 0.67 ? 2 : 3]);
          lx = px;
          ly = py;
        }
        // forked tips: the classic sparkler "star"
        if (h2 < 0.4 && len > 4) {
          const b1 = a + 0.75;
          const b2 = a - 0.75;
          g.px(R(lx + Math.cos(b1)), R(ly + Math.sin(b1)), SPK_CORE[3]);
          g.px(R(lx + Math.cos(b2)), R(ly + Math.sin(b2)), SPK_CORE[3]);
          if (h2 < 0.15) g.px(R(lx + Math.cos(b1) * 2), R(ly + Math.sin(b1) * 2), SPK_CORE[4]);
        }
      }
      // a few heavier sparks drop and cool
      for (let j = 0; j < 4; j++) {
        const c = T.cycle(t, k * 8 + j, 0.7 + HD.hash(k, j, 77) * 0.4, 7373);
        const tau = c.age * c.P;
        const ang = -Math.PI / 2 + (c.rnd(0) - 0.5) * 2.6;
        const v = 14 + c.rnd(1) * 14;
        const x = R(x0 + Math.cos(ang) * v * tau);
        const y = R(y0 + Math.sin(ang) * v * tau + 0.5 * 60 * tau * tau);
        if (y > st.base + 1) continue;
        g.px(x, y, SPK_CORE[Math.min(5, 2 + Math.floor(c.age * 4))]);
      }
    }
  }

  function sparklerLights(t, L) {
    if (!HD.tag('sparklers')) return;
    const ts = T.step(t, 15);
    for (let k = 0; k < SPK.length; k++) {
      const st = sparklerState(t, k);
      const fl = T.flicker(ts, 300 + k, 2);
      const i = 0.18 * st.fizz * (0.8 + 0.35 * fl) + 0.04 * st.ember;
      if (i <= 0.01) continue;
      L.add({ x: R(st.bx), y: R(st.by), r: 18, color: SPK_LIGHT, i, bands: 4, pow: 1.8 });
    }
  }

  HD._fireworks = { show, liveShells, flashOf };

  // ------------------------------------------------------------------
  // module (registered under the same name so --only/--skip fire covers it)
  // ------------------------------------------------------------------
  HD.module('fire', {
    init() {
      for (const ed of HD.EDITIONS) if (ed.fireworks > 0) showFor(ed);
    },
    lights(t, L) {
      fireworkLights(t, L);
      sparklerLights(t, L);
    },
    passes: [
      { layer: 'bg', z: 9, id: 'fireworks', draw: drawFireworks },
      { layer: 'scene', z: 41, id: 'sparkler-sticks', draw: drawSparklerSticks },
      { layer: 'scene', z: 45, id: 'sparkler-cores', draw: drawSparklerCores },
      { layer: 'fx', z: 36, id: 'sparklers', draw: drawSparklerFizz },
    ],
  });
})();
