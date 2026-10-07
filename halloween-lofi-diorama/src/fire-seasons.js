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
      slots: f > 0 ? Math.round(3 + 6 * f) : 0,
      keep: 0.45 + 0.27 * f, // chance a slot fires in a given cycle
      size: 0.84 + 0.3 * f, // burst scale
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
    // 70% of bursts in the open sky between the roof and the tree crown
    const split = Math.min(xMax, 338);
    let bx = rx < 0.7 ? xMin + (rx / 0.7) * (split - xMin) : split + ((rx - 0.7) / 0.3) * (xMax - split);
    // near (big) bursts sit higher, far (small) ones lower over the hills
    const yk = Math.min(1, Math.max(0, (1 - depth) * 0.42 + ry * 0.42));
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
    const per = 9.5 + HD.hash(i, 5, 71) * 4.5;
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
      far: depth < 0.22,
      R: (type === 'willow' ? 27 + 7 * depth : 18 + 19 * depth) * s.size * (type === 'crackle' ? 0.8 : 1),
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

  // lights() and the draw pass ask for the same frame: compute the list once
  const LIVE = [];
  let liveT = NaN;
  let liveS = null;
  function liveShells(t, s) {
    if (t === liveT && s === liveS) return LIVE;
    liveT = t;
    liveS = s;
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
  const DRAG = { peony: 0.3, chrys: 0.36, ring: 0.28, willow: 0.5, crackle: 0.26 };
  const GRAV = { peony: 8, chrys: 7, ring: 5, willow: 15, crackle: 6 };

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

  // a comet streak from (x0,y0) (tail) to (x1,y1) (head): the head is ramp[lv],
  // the tail fades `fade` levels; pixels are stepped so the streak stays 1px thin
  function streak(g, x0, y0, x1, y1, rp, lv, fade) {
    x0 = R(x0);
    y0 = R(y0);
    x1 = R(x1);
    y1 = R(y1);
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 0; s < n; s++) {
      const u = s / n; // 0 = tail
      const l = lv - Math.ceil((1 - u) * fade);
      if (l < 0) continue;
      g.px(R(x0 + (x1 - x0) * u), R(y0 + (y1 - y0) * u), rp[l]);
    }
    if (lv >= 0) g.px(x1, y1, rp[lv]);
  }

  // head brightness over a star's life u (0..1)
  function headLvl(u) {
    return u < 0.09 ? 6 : u < 0.3 ? 5 : u < 0.52 ? 4 : u < 0.7 ? 3 : u < 0.83 ? 2 : u < 0.93 ? 1 : 0;
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

    // break: a small white-hot ball for the first instant
    if (tb < 0.14) {
      const lvC = tb < 0.07 ? 6 : 5;
      const x = R(cx);
      const y = R(cy);
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
        const a = ((j + (h1 - 0.5) * 0.5) / n) * TAU + rot0 + si * 0.5;
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
        const sp = Rr * rs * (0.93 + 0.12 * h3);
        const u = tb / lifeJ;
        let lv = headLvl(u) - dim - back;
        if (lv < 0) continue;
        // dying stars sputter out (tiny dim pixels only, never a flash)
        if (u > 0.72 && type !== 'willow' && type !== 'crackle' && HD.hash(sh.seed, j * 8 + si, tk, 5) < (u - 0.72) * 1.8) continue;
        // glitter: late willow / crackle stars twinkle
        const glit = u > 0.55 && (type === 'willow' || type === 'crackle') && HD.hash(sh.seed, j * 8 + si, tk) < 0.28;
        const e = expand(tb, k);
        const hx = cx + dx * sp * e;
        const hy = cy + dy * sp * e + droop(tb, G);
        if (type === 'willow') {
          // long hanging trail: a polyline through earlier positions, fading to amber
          let px = hx;
          let py = hy;
          for (let q = 1; q <= 7; q++) {
            const tq = tb - q * 0.14;
            if (tq < 0) break;
            const eq = expand(tq, k);
            const qx = cx + dx * sp * eq;
            const qy = cy + dy * sp * eq + droop(tq, G);
            const l = lv - 1 - (q >> 1);
            if (l < 0) break;
            streak(g, qx, qy, px, py, rp, l, 1);
            px = qx;
            py = qy;
          }
          if (!glit) g.px(R(hx), R(hy), rp[Math.min(6, lv + 1)]);
          continue;
        }
        // comet streak: long spokes while fast, then a short falling tail as the
        // star slows and sags under gravity
        const dt = type === 'chrys' ? 0.24 : type === 'ring' ? 0.08 : u < 0.3 ? 0.1 : 0.18;
        const t0 = Math.max(0, tb - dt);
        const e0 = expand(t0, k);
        const tx = cx + dx * sp * e0;
        const ty = cy + dy * sp * e0 + droop(t0, G);
        if (type === 'chrys') {
          // the trail burns gold whatever the head colour
          streak(g, tx, ty, hx, hy, RAMPS.willow, Math.min(5, lv), 4);
          if (!glit) g.px(R(hx), R(hy), rp[lv]);
        } else if (!glit) {
          streak(g, tx, ty, hx, hy, rp, lv, 3);
          // fresh, near stars are fat little crosses: the burst reads as a ball of light
          if (lv >= 5 && !dim && !back && type !== 'crackle') {
            const X = R(hx);
            const Y = R(hy);
            const c = rp[lv - 2];
            g.px(X - 1, Y, c);
            g.px(X + 1, Y, c);
            g.px(X, Y - 1, c);
            if (lv === 6) g.px(X, Y + 1, c);
            g.px(X, Y, rp[lv]);
          }
        }
      }
    }

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
          g.px(ox, oy, W[lvp - dim]);
          if (dtm < 0.08) {
            g.px(ox - 1, oy, W[3]);
            g.px(ox + 1, oy, W[3]);
            g.px(ox, oy - 1, W[3]);
            g.px(ox, oy + 1, W[3]);
          }
        }
      }
    }
  }

  // light/glow profile of a burst (0..1): quick attack, soft decay — never a hard strobe
  function flashOf(sh) {
    const tb = sh.tau - sh.rise;
    if (tb < 0) return 0;
    const a = tb < 0.1 ? tb / 0.1 : Math.exp(-(tb - 0.1) / 0.65);
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
      const rad = Math.max(12, Math.round((sh.R * 1.45) / 4) * 4);
      HD.glow(g, sh.bx, sh.by, rad, col, 0.3 * fl);
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

  HD._fireworks = { show, liveShells, flashOf };

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
