/*
 * fire-seasons.js — the fire module's seasonal additions (Rainy Hollow series).
 *
 *   bg    z 9   fireworks: rockets rising from behind the hills, bursts inside
 *               layout.seasonal.fireworks (peony, chrysanthemum, ring, willow,
 *               crackle), a soft banded sky glow per burst
 *   scene z 41  sparkler sticks stuck in the snow (relit by their own light)
 *   scene z 45  sparkler burning cores (emissive)
 *   fx    z 36  sparkler fizz: short radiating, forking sparks + halo
 *   lights      one aggregated, coloured flash light for all live bursts and
 *               one small white-gold light per sparkler
 *
 * Everything is a pure function of t. Each firework "slot" is an HD.time.cycle
 * whose whole life (rise + burst) fits inside its period, so the show loops
 * seamlessly. Busy-ness scales with HD.edition.fireworks; colours come from
 * HD.edition.fireworkColors. Per-edition show settings are cached with
 * HD.perEdition and read at draw time, so live edition switching works.
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
  // show settings per edition
  // ------------------------------------------------------------------
  const TYPE_LIFE = { peony: 2.7, chrys: 3.1, ring: 2.5, willow: 4.6, crackle: 3.0 };
  const MIXES = {
    lunar: { peony: 4, chrys: 3, ring: 0.8, willow: 1, crackle: 2.2 },
    lights: { peony: 3.2, chrys: 2, ring: 2, willow: 1.4, crackle: 1.4 },
    newyear: { peony: 3, chrys: 2.2, ring: 1.6, willow: 2.4, crackle: 1.4 },
    other: { peony: 3, chrys: 2, ring: 1.5, willow: 1.5, crackle: 1.5 },
  };
  const show = HD.perEdition((ed) => {
    const f = Math.max(0, Math.min(1, ed.fireworks || 0));
    const mixw = MIXES[ed.id] || MIXES.other;
    const types = [];
    let sum = 0;
    for (const k of ['peony', 'chrys', 'ring', 'willow', 'crackle']) {
      sum += mixw[k];
      types.push([k, sum]);
    }
    for (const t of types) t[1] /= sum;
    return {
      f,
      slots: f > 0 ? Math.round(3 + 5 * f) : 0,
      keep: 0.45 + 0.27 * f, // chance a slot fires in a given cycle
      size: 0.86 + 0.26 * f, // burst scale
      colors: ed.fireworkColors && ed.fireworkColors.length ? ed.fireworkColors : ['gold', 'white'],
      types,
      moon: ed.moon && ed.moon !== 'none',
      salvo: f >= 0.9, // the big show gets a small fan salvo once per half loop
    };
  });

  // ------------------------------------------------------------------
  // shells: stateless slots
  // ------------------------------------------------------------------
  const RISE_Y = 168; // rockets appear from behind the hills
  function placeBurst(sh, rx, ry, depth, s) {
    const Rr = sh.R;
    const xMin = Math.max(ZONE.x0, SAFE.x1 + 8) + Rr;
    const xMax = ZONE.x1 - Rr - 2;
    const yMin = ZONE.y0 + Rr * 0.9;
    const yMax = ZONE.y1 - Rr * 0.35;
    let bx = xMin + rx * (xMax - xMin);
    // near (big) bursts sit higher, far (small) ones lower over the hills
    const yk = Math.min(1, Math.max(0, (1 - depth) * 0.62 + ry * 0.5));
    const by = yMin + yk * (yMax - yMin);
    if (s.moon) {
      const need = Rr + MOON.r + 12;
      if (Math.hypot(bx - MOON.x, by - MOON.y) < need) bx = bx < MOON.x || MOON.x + need > xMax ? MOON.x - need : MOON.x + need;
    }
    sh.bx = bx;
    sh.by = by;
  }

  function pickType(s, u) {
    for (const t of s.types) if (u < t[1]) return t[0];
    return 'peony';
  }

  /** state of slot i at time t, or null when idle. Plain object (cycle() is shared). */
  function shellState(t, i, s) {
    const per = 10.5 + HD.hash(i, 5, 71) * 4.5;
    const c = T.cycle(t, i, per, 6060);
    if (c.rnd(0) > s.keep) return null;
    const type = pickType(s, c.rnd(2));
    const rise = 1.15 + c.rnd(1) * 0.6;
    const life = TYPE_LIFE[type] * (0.92 + 0.16 * c.rnd(11));
    const total = rise + life;
    const at = c.rnd(3) * Math.max(0, c.P - total - 0.3);
    const tau = c.age * c.P - at;
    if (tau < 0 || tau > total) return null;
    const depth = c.rnd(4);
    const nc = s.colors.length;
    const col = type === 'willow' ? 'willow' : s.colors[Math.floor(c.rnd(5) * nc) % nc];
    let col2 = s.colors[Math.floor(c.rnd(6) * nc) % nc];
    if (col2 === col || c.rnd(7) < 0.45 || type === 'ring' || type === 'willow') col2 = null;
    const sh = {
      type,
      tau,
      rise,
      life,
      seed: (i * 977 + c.c * 131 + 17) | 0,
      depth,
      far: depth < 0.3,
      R: (type === 'willow' ? 23 : 15 + 14 * depth) * s.size * (type === 'crackle' ? 0.8 : 1),
      col,
      col2,
      tilt: 0.35 + 0.45 * c.rnd(12),
      rot: (c.rnd(13) - 0.5) * 1.2,
      sway: (c.rnd(10) - 0.5) * 18,
    };
    placeBurst(sh, c.rnd(8), c.rnd(9), depth, s);
    return sh;
  }

  // salvo: once per ~half loop the big show fans 4 matching shells across the sky
  function salvoStates(t, s, out) {
    if (!s.salvo) return;
    const c = T.cycle(t, 0, 120, 8181);
    const tl = c.age * c.P - 60;
    if (tl < -2 || tl > 9) return;
    const ring = c.rnd(1) < 0.5;
    const nc = s.colors.length;
    const cols = [s.colors[Math.floor(c.rnd(2) * nc) % nc], s.colors[Math.floor(c.rnd(3) * nc) % nc]];
    const cx = 0.3 + 0.4 * c.rnd(4);
    for (let k = 0; k < 4; k++) {
      const tau = tl - k * 0.55;
      const type = ring ? 'ring' : 'peony';
      const rise = 1.3;
      const life = TYPE_LIFE[type];
      if (tau < 0 || tau > rise + life) continue;
      const sh = {
        type,
        tau,
        rise,
        life,
        seed: 50000 + c.c * 31 + k,
        depth: 0.55,
        far: false,
        R: 19 * s.size,
        col: cols[k & 1],
        col2: null,
        tilt: 0.45 + 0.1 * k,
        rot: (k - 1.5) * 0.25,
        sway: (k - 1.5) * 10,
      };
      placeBurst(sh, Math.min(1, Math.max(0, cx + (k - 1.5) * 0.2)), 0.3 + 0.15 * (k & 1), 0.55, s);
      out.push(sh);
    }
  }

  const LIVE = [];
  function liveShells(t, s) {
    LIVE.length = 0;
    for (let i = 0; i < s.slots; i++) {
      const sh = shellState(t, i, s);
      if (sh) LIVE.push(sh);
    }
    salvoStates(t, s, LIVE);
    return LIVE;
  }

  // ------------------------------------------------------------------
  // burst drawing
  // ------------------------------------------------------------------
  // brightness level along a star's life u (0..1)
  function lvlAt(u) {
    return u < 0.05 ? 6 : u < 0.13 ? 5 : u < 0.28 ? 4 : u < 0.52 ? 3 : u < 0.72 ? 2 : u < 0.88 ? 1 : 0;
  }
  const DRAG = { peony: 0.3, chrys: 0.36, ring: 0.28, willow: 0.5, crackle: 0.26 };
  const GRAV = { peony: 5, chrys: 6, ring: 4, willow: 15, crackle: 5 };

  function expand(tau, k) {
    return 1 - Math.exp(-tau / k);
  }
  function droop(tau, G) {
    return (G * tau * tau) / (1 + 0.7 * tau);
  }

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

    // break flash: a tiny white-hot core for the first instant
    if (tb < 0.16) {
      const lvC = tb < 0.08 ? 6 : 5;
      g.px(R(cx), R(cy), ramp[lvC]);
      g.px(R(cx) - 1, R(cy), ramp[lvC - 1]);
      g.px(R(cx) + 1, R(cy), ramp[lvC - 1]);
      g.px(R(cx), R(cy) - 1, ramp[lvC - 1]);
      g.px(R(cx), R(cy) + 1, ramp[lvC - 1]);
    }

    const n = type === 'ring' ? Math.round(18 + Rr * 0.5) : type === 'willow' ? 26 : Math.round(16 + Rr * 0.95);
    const trailN = type === 'chrys' ? 4 : type === 'willow' ? 8 : type === 'crackle' ? 1 : 2;
    const trailDt = type === 'willow' ? 0.12 : type === 'chrys' ? 0.075 : 0.05;
    const cr = Math.cos(sh.rot);
    const sr = Math.sin(sh.rot);
    const rot0 = HD.hash(sh.seed, 3, 9) * TAU;
    for (let j = 0; j < n; j++) {
      // direction: Fibonacci sphere (filled disc, denser rim) or a tilted ring
      let dx;
      let dy;
      let front = 1;
      if (type === 'ring') {
        const a = (j / n) * TAU + rot0;
        const ex = Math.cos(a);
        const ey = Math.sin(a) * sh.tilt;
        dx = ex * cr - ey * sr;
        dy = ex * sr + ey * cr;
        front = Math.sin(a) > 0 ? 1 : 0.7;
      } else {
        const z = 1 - (2 * (j + 0.5)) / n;
        const rr = Math.sqrt(1 - z * z);
        const ph = j * GOLDEN + rot0;
        dx = rr * Math.cos(ph);
        dy = rr * Math.sin(ph);
        front = z > -0.25 ? 1 : 0.7;
        if (type === 'willow') {
          // willow stars are thrown mostly sideways/up, then hang down
          dy = dy * 0.8 - 0.25;
        }
      }
      const hj = HD.hash(sh.seed, j, 21);
      const sp = Rr * (0.9 + 0.18 * hj);
      const lifeJ = sh.life * (0.78 + 0.22 * HD.hash(sh.seed, j, 22));
      if (tb > lifeJ) continue;
      const useCol2 = ramp2 && (j & 1) === 0 && type !== 'chrys';
      const rp = useCol2 ? ramp2 : ramp;
      const back = front < 1 ? 1 : 0;
      // trail samples (oldest first), then the star head
      for (let q = trailN; q >= 0; q--) {
        const tq = tb - q * trailDt;
        if (tq < 0) continue;
        const uq = tb / lifeJ;
        let lv = lvlAt(uq) - dim - back - (q === 0 ? 0 : type === 'willow' ? 1 + (q >> 2) : q);
        if (q > 0 && type === 'chrys') lv = Math.min(lv, 3);
        if (lv < 0) continue;
        // late glitter: willow / crackle stars twinkle off now and then
        if (uq > 0.6 && (type === 'willow' || type === 'crackle') && HD.hash(sh.seed, j * 16 + q, tk) < 0.3) continue;
        const e = expand(tq, k);
        const x = cx + dx * sp * e;
        const y = cy + dy * sp * e + droop(tq, G);
        g.px(R(x), R(y), rp[lv]);
      }
      // two-tone pistil: an inner, smaller sphere in the second colour
      if (ramp2 && type === 'chrys' && j % 3 === 0) {
        const e = expand(tb, k);
        const lv = lvlAt(tb / lifeJ) - dim;
        if (lv >= 0 && tb < lifeJ * 0.7) g.px(R(cx + dx * sp * 0.45 * e), R(cy + dy * sp * 0.45 * e + droop(tb, G)), ramp2[lv]);
      }
      // crackle: after the stars die down, each one pops into a few tiny flashes
      if (type === 'crackle') {
        const t0 = lifeJ * 0.42;
        if (tb > t0) {
          const e = expand(t0, k);
          const sx = cx + dx * sp * e;
          const sy = cy + dy * sp * e + droop(t0, G);
          for (let m = 0; m < 3; m++) {
            const at = t0 + HD.hash(sh.seed, j, 40 + m) * (lifeJ - t0);
            const dtm = tb - at;
            if (dtm < 0 || dtm > 0.17) continue;
            const ox = R((HD.hash(sh.seed, j, 50 + m) - 0.5) * 7);
            const oy = R((HD.hash(sh.seed, j, 60 + m) - 0.5) * 7 + droop(tb, G) - droop(t0, G));
            const W = RAMPS.white;
            g.px(R(sx) + ox, R(sy) + oy, dtm < 0.08 ? W[6] : W[4]);
            if (dtm < 0.06) {
              g.px(R(sx) + ox - 1, R(sy) + oy, W[3]);
              g.px(R(sx) + ox + 1, R(sy) + oy, W[3]);
            }
          }
        }
      }
    }
  }

  // light/glow profile of a burst (0..1): quick attack, soft decay — never a hard strobe
  function flashOf(sh) {
    const tb = sh.tau - sh.rise;
    if (tb < 0) return 0;
    const a = tb < 0.08 ? tb / 0.08 : Math.exp(-(tb - 0.08) / 0.5);
    return a * (sh.far ? 0.55 : 1) * (sh.type === 'willow' ? 0.8 : 1);
  }

  function drawFireworks(g, t) {
    const s = show();
    if (!s.slots) return;
    const list = liveShells(t, s);
    // glows first (additive, behind every burst)
    for (const sh of list) {
      const fl = flashOf(sh);
      if (fl <= 0.02) continue;
      const col = HD.LIGHT.firework[sh.col] || HD.LIGHT.firework.gold;
      const rad = Math.max(12, Math.round((sh.R * 1.5) / 4) * 4);
      HD.glow(g, sh.bx, sh.by, rad, col, 0.2 * fl);
    }
    for (const sh of list) {
      if (sh.tau < sh.rise) drawRocket(g, sh, t);
      else drawBurst(g, sh, t);
    }
  }

  function fireworkLights(t, L) {
    const s = show();
    if (!s.slots) return;
    const list = liveShells(t, s);
    let w = 0;
    let x = 0;
    let y = 0;
    let r = 0;
    let gc = 0;
    let b = 0;
    for (const sh of list) {
      const fl = flashOf(sh) * (sh.R / 24);
      if (fl <= 0.01) continue;
      const col = HD.LIGHT.firework[sh.col] || HD.LIGHT.firework.gold;
      w += fl;
      x += sh.bx * fl;
      y += sh.by * fl;
      r += col[0] * fl;
      gc += col[1] * fl;
      b += col[2] * fl;
    }
    if (w <= 0.02) return;
    L.add({
      x: R(x / w),
      y: R(y / w) + 70,
      r: 230,
      ry: 160,
      color: [r / w, gc / w, b / w],
      i: Math.min(0.26, 0.17 * w),
      bands: 4,
      pow: 1.25,
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

  function sparklerState(t, k) {
    const s = SPK[k];
    const c = T.cycle(t, k, SPK_P, 5150 + k);
    const tau = c.age * c.P;
    const lean = k % 2 === 0 ? -0.18 : 0.14;
    let fizz;
    let prog; // 0 = fresh, 1 = burnt to the handle
    if (tau < 1.2) fizz = tau / 1.2;
    else if (tau < c.P - 5) fizz = 1;
    else if (tau < c.P - 3) fizz = (c.P - 3 - tau) / 2;
    else fizz = 0;
    prog = Math.min(1, tau / (c.P - 4));
    const bLen = SPK_LEN - prog * (SPK_LEN - 5); // burn point height along the stick
    const len = SPK_LEN;
    return {
      x: s.x,
      base: s.base,
      lean,
      len,
      bLen,
      fizz,
      ember: tau >= c.P - 5 ? Math.max(0, 1 - (tau - (c.P - 5)) / 4) : 0,
      bx: s.x + lean * bLen,
      by: s.base - bLen,
    };
  }

  function drawSparklerSticks(g, t) {
    if (!HD.tag('sparklers')) return;
    for (let k = 0; k < SPK.length; k++) {
      const st = sparklerState(t, k);
      for (let h = 0; h <= st.len; h++) {
        const x = R(st.x + st.lean * h);
        const y = st.base - h;
        let c;
        if (h < 4) c = P.stone[5]; // bare wire handle
        else if (h < st.bLen) c = P.stone[6]; // grey coating, unburnt
        else c = P.stone[3]; // burnt: dark, brittle
        g.px(x, y, c);
        if (h >= 4 && h < st.bLen - 1 && h % 3 === 0) g.px(x, y, P.stone[7]); // coating texture
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
      const i = 0.34 * st.fizz * (0.8 + 0.35 * fl) + 0.05 * st.ember;
      if (i <= 0.01) continue;
      L.add({ x: R(st.bx), y: R(st.by), r: 30, color: SPK_LIGHT, i, bands: 4, pow: 1.8 });
    }
  }

  // ------------------------------------------------------------------
  // module (registered under the same name so --only/--skip fire covers it)
  // ------------------------------------------------------------------
  HD.module('fire', {
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
