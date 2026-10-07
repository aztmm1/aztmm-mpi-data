/*
 * weather-seasons — snow, leaves, petals and fireflies for the Rainy Hollow
 * series (rain itself lives in weather.js). Plugs into the 'weather' module
 * through the HD.weatherSeasons hooks, which weather.js calls at draw time:
 *
 *   far   bg z23   far snow behind the house; distant fireflies over the fields
 *   mid   fx z43   mid snow, falling leaves, petals, meadow and tree fireflies
 *   near  fx z67   big soft near snowflakes, a few close leaves and petals
 *   lights          a handful of aggregated firefly lights (never one per bug)
 *
 * Everything reads HD.edition.weather at draw time (live switching works) and
 * is a stateless HD.time.cycle life or a loop-safe noise path, so the frame is
 * a pure function of t and loops at HD.LOOP. fx particles are not relit by the
 * engine, so each one samples the lightmap (HD.lights.lum) and picks a
 * precomputed warmer tone near the windows, lanterns and fire.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const LY = HD.layout;
  const T = HD.time;
  const W = HD.W;
  const H = HD.H;
  const TAU = Math.PI * 2;
  const mix = HD.color.mix;
  const hash = HD.hash;
  const lum = HD.lights.lum;
  const sin = Math.sin;
  const cos = Math.cos;
  const R = Math.round;
  const SEA = (HD.weatherSeasons = HD.weatherSeasons || {});

  const G0 = LY.ground.houseBase; // 206
  const G1 = LY.ground.front; // 238
  const TS = LY.titleSafe;
  const inTitle = (x, y) => x >= TS.x0 - 4 && x <= TS.x1 + 4 && y >= TS.y0 - 4 && y <= TS.y1 + 4;
  const TREE = LY.tree;

  // ------------------------------------------------------------------
  // light levels (same thresholds as the rain) and warm tone tables
  // ------------------------------------------------------------------
  const LVT = [0.035, 0.08, 0.15, 0.25, 0.38, 0.56];
  function lvOf(l) {
    let k = 0;
    while (k < 6 && l >= LVT[k]) k++;
    return k;
  }
  /** cold colour -> 7 light levels, warming towards `warm` (max mix kmax) */
  function warmSteps(cold, warm, kmax) {
    const out = [cold];
    for (let k = 1; k <= 6; k++) out.push(mix(cold, warm, Math.min(kmax, 0.08 + 0.12 * k)));
    return out;
  }
  const perArr = (n, a, b, seed) => Array.from({ length: n }, (_, i) => a + (b - a) * hash(i, seed, 3));

  // ------------------------------------------------------------------
  // SNOW: three depth layers. Snow at night is blue-lilac; near a lamp it
  // turns to warm cream. Flakes drift with the wind (slightly right, like the
  // smoke), wobble, and simply vanish where they land.
  // ------------------------------------------------------------------
  // Lamp-lit snow does not turn orange: it brightens into glowing cream and
  // pale gold, so the flakes sparkle against the warm walls instead of
  // melting into them.
  const CREAM = P.amber[7];
  const GOLD = P.amber[6];
  const WHITE_W = P.amber[8];
  /** cold flake -> 7 light levels that brighten towards a warm highlight */
  function glowSteps(cold, warm, kmax) {
    const out = [cold];
    for (let k = 1; k <= 6; k++) out.push(mix(cold, warm, Math.min(kmax, 0.1 + 0.14 * k)));
    return out;
  }
  const SF = [
    glowSteps(mix(P.snow[3], P.snow[4], 0.6), P.warmrain[3], 0.45),
    glowSteps(P.snow[4], P.warmrain[4], 0.5),
    glowSteps(mix(P.snow[5], P.snow[6], 0.4), GOLD, 0.55),
  ];
  const SM = [glowSteps(mix(P.snow[5], P.snow[6], 0.4), GOLD, 0.7), glowSteps(P.snow[7], CREAM, 0.8), glowSteps(P.snow[8], WHITE_W, 0.85)];
  const SN = [glowSteps(mix(P.snow[4], P.snow[5], 0.5), GOLD, 0.65), glowSteps(P.snow[6], CREAM, 0.78), glowSteps(P.snow[8], WHITE_W, 0.85)];

  const SNOW_FAR_N = 440;
  const SNOW_MID_N = 360;
  const SNOW_NEAR_N = 42;
  const SFP = perArr(SNOW_FAR_N, 15, 21, 9101);
  const SMP = perArr(SNOW_MID_N, 8.5, 11.5, 9202);
  const SNP = perArr(SNOW_NEAR_N, 5.2, 7, 9303);
  const DRIFT_FAR = 0.1; // px right per px fallen
  const DRIFT_MID = 0.14;
  const DRIFT_NEAR = 0.2;

  function snowFar(g, t, s) {
    const n = R(SNOW_FAR_N * s);
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, SFP[i], 9101);
      const age = c.age;
      const yEnd = 196 + c.rnd(1) * 10;
      const y = R(-3 + (yEnd + 3) * age);
      const amp = 0.8 + c.rnd(4) * 1.4;
      const x = R(c.rnd(0) * (W + 50) - 30 + y * DRIFT_FAR + amp * sin(TAU * (age * (2 + c.rnd(5) * 2) + c.rnd(6))));
      const r3 = c.rnd(3);
      let b = r3 < 0.5 ? 0 : r3 < 0.9 ? 1 : 2;
      if (b > 0 && inTitle(x, y)) b--;
      g.rect(x, y, 1, 1, SF[b][lvOf(lum(x, y) * 0.6)]);
    }
  }

  function snowMid(g, t, s) {
    const n = R(SNOW_MID_N * s);
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, SMP[i], 9202);
      const age = c.age;
      const d = c.rnd(1);
      const yl = G0 + d * (G1 - 1 - G0);
      const y = R(-4 + (yl + 4) * age);
      const amp = 1.4 + c.rnd(4) * 2.2;
      const x = R(c.rnd(0) * (W + 60) - 40 + y * DRIFT_MID + amp * sin(TAU * (age * (2.2 + c.rnd(5) * 2) + c.rnd(6))));
      const r3 = c.rnd(3);
      let b = d > 0.55 ? (r3 < 0.55 ? 2 : 1) : r3 < 0.3 ? 0 : r3 < 0.85 ? 1 : 2;
      if (b > 0 && inTitle(x, y)) b--;
      const lv = lvOf(lum(x, y));
      if (d > 0.62) {
        // the nearest mid flakes: a soft round 2x2, lit from the top-left
        g.rect(x, y, 1, 1, SM[b][lv]);
        g.rect(x + 1, y, 1, 1, SM[b > 0 ? b - 1 : 0][lv]);
        g.rect(x, y + 1, 1, 1, SM[b > 0 ? b - 1 : 0][lv]);
        g.rect(x + 1, y + 1, 1, 1, SM[0][lv]);
      } else g.rect(x, y, 1, 1, SM[b][lv]);
    }
  }

  function snowNear(g, t, s) {
    const n = Math.max(3, R(SNOW_NEAR_N * s));
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, SNP[i], 9303);
      const age = c.age;
      const y = R(-6 + (H + 12) * age);
      const amp = 3 + c.rnd(4) * 3;
      const x = R(c.rnd(0) * (W + 90) - 60 + y * DRIFT_NEAR + amp * sin(TAU * (age * (1.2 + c.rnd(5) * 1.2) + c.rnd(6))));
      const lv = lvOf(lum(x, y));
      const dim = inTitle(x, y) ? 1 : 0;
      const hi = SN[2 - dim][lv];
      const lo = SN[0][lv];
      if (i % 3 === 0) {
        // big soft flake: 2x2 core with a 1px halo of dim arms
        g.rect(x, y, 2, 2, SN[1 - dim][lv]);
        g.rect(x, y, 1, 1, hi);
        g.rect(x, y - 1, 2, 1, lo);
        g.rect(x, y + 2, 2, 1, lo);
        g.rect(x - 1, y, 1, 2, lo);
        g.rect(x + 2, y, 1, 2, lo);
      } else {
        // small near flake: a soft 2x2, lit from the top-left
        const mid = SN[1 - dim][lv];
        g.rect(x, y, 1, 1, hi);
        g.rect(x + 1, y, 1, 1, mid);
        g.rect(x, y + 1, 1, 1, mid);
        g.rect(x + 1, y + 1, 1, 1, lo);
      }
    }
  }

  // ------------------------------------------------------------------
  // falling things with two-frame flips (leaves, petals)
  // frames: lists of [dx, dy, tone]; tone 0 dark .. 2 light
  // ------------------------------------------------------------------
  function frames(rows) {
    const a = [];
    const h = rows.length;
    let w = 0;
    for (const r of rows) w = Math.max(w, r.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch >= '0' && ch <= '2') a.push([x, y, +ch]);
      }
    // the back of the leaf: mirrored and one tone darker
    const b = a.map((p) => [w - 1 - p[0], p[1], Math.max(0, p[2] - 1)]);
    const ox = (w - 1) >> 1;
    const oy = (h - 1) >> 1;
    for (const p of a) {
      p[0] -= ox;
      p[1] -= oy;
    }
    for (const p of b) {
      p[0] -= ox;
      p[1] -= oy;
    }
    return [a, b];
  }
  const LEAF_SHAPES = [
    frames(['..22', '.211', '011.']), // long leaf, stem bottom-left
    frames(['21.', '.12', '..0']), // curled leaf, stem bottom-right
    frames(['.221', '011.']), // flat leaf side-on
    frames(['.22', '221', '10.']), // round birch leaf, stem bottom-left
    frames(['.22.', '2211', '.11.', '..0.']), // broad leaf hanging from its stem
  ];
  const LEAF_BIG = frames(['...21', '.2221', '2211.', '0....']);
  const PETAL = frames(['21', '.1']);
  const PETAL_SMALL = frames(['21']);
  function drawFrame(g, fr, x, y, tab, lv) {
    for (let k = 0; k < fr.length; k++) {
      const p = fr[k];
      g.rect(x + p[0], y + p[1], 1, 1, tab[p[2]][lv]);
    }
  }
  /** [tone][lv] tables from three cold tones */
  function toneTab(c0, c1, c2, warm, kmax) {
    return [warmSteps(c0, warm, kmax * 0.8), warmSteps(c1, warm, kmax), warmSteps(c2, warm, kmax)];
  }
  /** a tone table one step dimmer (resting on the ground, far, fading in) */
  function dimTab(tab) {
    return [tab[0], tab[0], tab[1]];
  }

  // leaf hues at night (they warm to fiery orange near the fire and lanterns)
  const LEAF_HUES = [
    toneTab(P.autumn[3], P.autumn[5], P.autumn[6], P.fire[7], 0.6), // rust-orange
    toneTab(P.autumn[4], P.autumn[6], P.autumn[7], P.fire[8], 0.6), // gold
    toneTab(P.red[3], P.red[4], P.autumn[5], P.fire[6], 0.55), // red
    toneTab(P.autumn[2], P.autumn[4], P.autumn[5], P.fire[6], 0.55), // russet
    toneTab(P.gold[2], P.gold[3], P.gold[4], P.fire[8], 0.55), // yellow
  ];
  const LEAF_DIM = LEAF_HUES.map(dimTab);
  const LEAF_NEAR = [
    toneTab(P.autumn[0], P.autumn[1], P.autumn[2], P.fire[5], 0.5),
    toneTab(P.red[1], P.autumn[1], P.autumn[3], P.fire[5], 0.5),
  ];

  const PETAL_PINK = toneTab(P.blossom[4], P.blossom[6], P.blossom[7], P.amber[7], 0.5);
  const PETAL_PINK2 = toneTab(P.blossom[4], P.blossom[5], P.blossom[6], P.amber[7], 0.5);
  const PETAL_PLUM = toneTab(P.plum[3], P.plum[4], P.plum[5], P.amber[6], 0.5);
  const PETAL_PLUM2 = toneTab(P.plum[2], P.plum[3], P.plum[4], P.amber[6], 0.5);

  /**
   * One leaf/petal falling from the canopy: drift with the wind, swing like a
   * pendulum (rising a touch at each end of the swing), flip at each swing,
   * then lie on the ground for a moment and vanish.
   * Returns nothing; draws straight away. `o` holds the per-system params.
   */
  function faller(g, t, i, o, seed) {
    const c = T.cycle(t, i, o.per[i], seed);
    const age = c.age;
    const fall = o.fall;
    const x0 = o.x0 + c.rnd(0) * o.xw;
    const y0 = o.y0 + c.rnd(1) * o.yh;
    const d = c.rnd(2);
    const yl = G0 + 1 + d * (G1 - 3 - G0);
    const drift = o.drift0 + c.rnd(3) * o.drift1;
    const amp = o.amp0 + c.rnd(4) * o.amp1;
    const nsw = o.sw0 + c.rnd(5) * o.sw1;
    const ph = c.rnd(6);
    const hue = (c.rnd(8) * o.hues.length) | 0;
    const shape = o.shapes[(c.rnd(9) * o.shapes.length) | 0];
    const spin = c.rnd(10) < o.spinP ? o.spin0 + c.rnd(11) * o.spin1 : 0;
    let x;
    let y;
    let f;
    let tab;
    if (age < fall) {
      const s = age / fall;
      const phi = TAU * (nsw * s + ph);
      const sw = sin(phi);
      x = x0 + drift * s + amp * sw;
      y = y0 + (yl - y0) * s - o.lift * sw * sw;
      f = cos(phi) > 0 ? 0 : 1;
      if (spin) f ^= Math.floor(age * c.P * spin) & 1;
      tab = s < 0.05 || d < 0.25 ? o.dim[hue] : o.hues[hue];
    } else {
      // resting where it landed (the last pose of the fall), then gone
      const phi = TAU * (nsw + ph);
      x = x0 + drift + amp * sin(phi);
      y = yl;
      f = 0;
      tab = o.dim[hue];
      if ((age - fall) / (1 - fall) > 0.55) tab = o.rest[hue];
    }
    x = R(x);
    y = R(y);
    if (x < -4 || x > W + 3) return;
    drawFrame(g, shape[f], x, y, tab, lvOf(lum(x, y)));
  }

  /** a leaf blown in from the woods on the left, gusting across the yard */
  function traveller(g, t, i, o, seed) {
    const c = T.cycle(t, i, o.per[i], seed);
    const age = c.age;
    const fall = o.fall;
    const y0 = o.y0 + c.rnd(1) * o.yh;
    const d = c.rnd(2);
    const yl = G0 + 1 + d * (G1 - 3 - G0);
    const xl = o.xl0 + c.rnd(0) * o.xl1;
    const hue = (c.rnd(8) * o.hues.length) | 0;
    const shape = o.shapes[(c.rnd(9) * o.shapes.length) | 0];
    const spin = o.spin0 + c.rnd(11) * o.spin1;
    const ph = c.rnd(6);
    let x;
    let y;
    let f;
    let tab;
    if (age < fall) {
      const s = age / fall;
      // a gust: quick across the top, settling as the wind drops
      const u = 1 - (1 - s) * (1 - s);
      const bob = sin(TAU * (2.2 * s + ph));
      x = -6 + (xl + 6) * u + 2 * bob;
      y = y0 + (yl - y0) * Math.pow(s, 1.7) - 3 * bob * (1 - s);
      f = Math.floor(age * c.P * spin * (1.2 - s)) & 1;
      tab = o.hues[hue];
    } else {
      x = xl + 2 * sin(TAU * (2.2 + ph));
      y = yl;
      f = 0;
      tab = (age - fall) / (1 - fall) > 0.55 ? o.rest[hue] : o.dim[hue];
    }
    x = R(x);
    y = R(y);
    drawFrame(g, shape[f], x, y, tab, lvOf(lum(x, y)));
  }

  const restTab = (tab) => [tab[0], tab[0], tab[0]];

  // ---- leaves (harvest) ----
  const LEAF_TREE_N = 34;
  const LEAF_TRAV_N = 9;
  const LEAF_NEAR_N = 3;
  const LEAF_TREE = {
    per: perArr(LEAF_TREE_N, 14, 20, 9401),
    fall: 0.86,
    x0: TREE.x - 68,
    xw: 136,
    y0: 36,
    yh: 112,
    drift0: 6,
    drift1: 26,
    amp0: 4,
    amp1: 7,
    sw0: 1.4,
    sw1: 1.8,
    lift: 2.2,
    spinP: 0.35,
    spin0: 3,
    spin1: 3,
    shapes: LEAF_SHAPES,
    hues: LEAF_HUES,
    dim: LEAF_DIM,
    rest: LEAF_HUES.map(restTab),
  };
  const LEAF_TRAV = {
    per: perArr(LEAF_TRAV_N, 13, 18, 9402),
    fall: 0.88,
    y0: 112,
    yh: 70,
    xl0: 30,
    xl1: 300,
    spin0: 3,
    spin1: 4,
    shapes: LEAF_SHAPES,
    hues: LEAF_HUES,
    dim: LEAF_DIM,
    rest: LEAF_HUES.map(restTab),
  };
  const LEAF_NEAR_P = perArr(LEAF_NEAR_N, 11, 15, 9403);

  function leavesMid(g, t, k) {
    const nt = R(LEAF_TREE_N * k);
    for (let i = 0; i < nt; i++) faller(g, t, i, LEAF_TREE, 9401);
    const nv = R(LEAF_TRAV_N * k);
    for (let i = 0; i < nv; i++) traveller(g, t, i, LEAF_TRAV, 9402);
  }
  function leavesNear(g, t, k) {
    const n = Math.max(1, R(LEAF_NEAR_N * k));
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, LEAF_NEAR_P[i], 9403);
      const age = c.age;
      // only crosses during the first ~60% of its life, then rests off-screen
      if (age > 0.62) continue;
      const s = age / 0.62;
      const y0 = 92 + c.rnd(1) * 90;
      const ph = c.rnd(6);
      const x = R(-10 + (W + 20) * s + 4 * sin(TAU * (1.5 * s + ph)));
      const y = R(y0 + 50 * s * s + 8 * sin(TAU * (1.5 * s + ph + 0.25)));
      const f = Math.floor(age * c.P * (3 + c.rnd(11) * 2)) & 1;
      const tab = LEAF_NEAR[(c.rnd(8) * LEAF_NEAR.length) | 0];
      drawFrame(g, LEAF_BIG[f], x, y, tab, lvOf(lum(x, y)));
    }
  }

  // ---- petals (spring blossom, lunar plum) ----
  const PETAL_N = 70;
  const PETALS = {
    per: perArr(PETAL_N, 15, 22, 9501),
    fall: 0.88,
    x0: TREE.x - 66,
    xw: 132,
    y0: 40,
    yh: 104,
    drift0: 4,
    drift1: 22,
    amp0: 3,
    amp1: 5,
    sw0: 1.6,
    sw1: 2.2,
    lift: 1.5,
    spinP: 0.5,
    spin0: 1.5,
    spin1: 2.5,
    shapes: [PETAL, PETAL, PETAL_SMALL],
    hues: [PETAL_PINK, PETAL_PINK2],
    dim: [dimTab(PETAL_PINK), dimTab(PETAL_PINK2)],
    rest: [restTab(PETAL_PINK), restTab(PETAL_PINK2)],
  };
  const PLUMS = Object.assign({}, PETALS, {
    hues: [PETAL_PLUM, PETAL_PLUM2],
    dim: [dimTab(PETAL_PLUM), dimTab(PETAL_PLUM2)],
    rest: [restTab(PETAL_PLUM), restTab(PETAL_PLUM2)],
  });
  function petalsMid(g, t, k, plum) {
    const n = Math.max(1, R(PETAL_N * (plum ? Math.max(k, 0.18) : k)));
    const o = plum ? PLUMS : PETALS;
    for (let i = 0; i < n; i++) faller(g, t, i, o, 9501);
  }
  // a couple of petals drifting right past the camera (2x2, soft)
  const PETAL_NEAR_P = perArr(3, 12, 16, 9502);
  function petalsNear(g, t, k, plum) {
    const n = k > 0.5 ? 3 : 1;
    const tab = plum ? PETAL_PLUM : PETAL_PINK;
    for (let i = 0; i < n; i++) {
      const c = T.cycle(t, i, PETAL_NEAR_P[i], 9502);
      const age = c.age;
      if (age > 0.55) continue;
      const s = age / 0.55;
      const y0 = 100 + c.rnd(1) * 70;
      const ph = c.rnd(6);
      const x = R(-8 + (W + 16) * s + 5 * sin(TAU * (1.2 * s + ph)));
      const y = R(y0 + 60 * s + 7 * sin(TAU * (1.2 * s + ph + 0.3)));
      const lv = lvOf(lum(x, y));
      const f = Math.floor(age * c.P * 2.2) & 1;
      if (f) {
        g.rect(x, y, 2, 1, tab[1][lv]);
        g.rect(x + 1, y + 1, 1, 1, tab[0][lv]);
      } else {
        g.rect(x, y, 2, 2, tab[1][lv]);
        g.rect(x, y, 1, 1, tab[2][lv]);
        g.rect(x + 1, y + 1, 1, 1, tab[0][lv]);
      }
    }
  }

  // ------------------------------------------------------------------
  // FIREFLIES: wander on smooth loop-safe noise, blink slowly (quick rise,
  // long fade, mostly dark). A few aggregated lights glow over the meadow.
  // ------------------------------------------------------------------
  const FF_N = 56;
  const FF = [];
  const FF_ZONES = [
    { x: 26, y: 200 },
    { x: 180, y: 224 },
    { x: 280, y: 222 },
    { x: 340, y: 206 },
    { x: 412, y: 150 },
    { x: 446, y: 222 },
  ];
  for (let i = 0; i < FF_N; i++) {
    const h = (k) => hash(i, k, 9601);
    let kind;
    let hx;
    let hy;
    let ax;
    let ay;
    const fireX = LY.campfire.x;
    if (i < 26) {
      kind = 0; // low over the meadow; the bonfire would drown them, so keep clear of it
      hx = 8 + h(1) * 464;
      if (Math.abs(hx - fireX) < 44) hx = fireX + 44 + h(8) * 70;
      hy = 200 + h(2) * 32;
      ax = 10 + h(3) * 10;
      ay = 3 + h(4) * 4;
    } else if (i < 34) {
      kind = 0; // higher, against the dark hedges either side of the house
      hx = h(1) < 0.4 ? 6 + h(9) * 40 : 306 + h(9) * 40;
      hy = 166 + h(2) * 30;
      ax = 8 + h(3) * 8;
      ay = 5 + h(4) * 5;
    } else if (i < 48) {
      kind = 1; // around the tree
      hx = TREE.x - 55 + h(1) * 110;
      hy = 96 + h(2) * 100;
      ax = 8 + h(3) * 8;
      ay = 6 + h(4) * 8;
    } else {
      kind = 2; // far: over the distant fields, behind the house
      hx = h(1) * 480;
      hy = 188 + h(2) * 12;
      ax = 6 + h(3) * 6;
      ay = 1.5;
    }
    let zone = 0;
    let best = 1e9;
    FF_ZONES.forEach((z, k) => {
      const dd = (z.x - hx) ** 2 + (z.y - hy) ** 2 * 2;
      if (dd < best) {
        best = dd;
        zone = k;
      }
    });
    FF.push({
      kind,
      hx,
      hy,
      ax,
      ay,
      pw: 7 + h(5) * 6,
      pb: 3.2 + h(6) * 3.6,
      ob: h(7),
      s: i * 7 + 3,
      zone,
    });
  }
  const FF_X = new Float64Array(FF_N);
  const FF_Y = new Float64Array(FF_N);
  const FF_E = new Float64Array(FF_N);
  /** position and blink envelope of every firefly at t */
  function ffState(t, n) {
    for (let i = 0; i < n; i++) {
      const f = FF[i];
      FF_X[i] = f.hx + f.ax * (2 * T.noise(t, f.pw, f.s) - 1) + 2 * T.wave(t, f.pw * 0.37, f.ob);
      FF_Y[i] = f.hy + f.ay * (2 * T.noise(t, f.pw * 1.3, f.s + 1) - 1) + 1.2 * T.wave(t, f.pw * 0.29, f.ob + 0.3);
      const ph = T.phase(t, f.pb, f.ob);
      FF_E[i] = ph < 0.14 ? ph / 0.14 : ph < 0.56 ? 1 - (ph - 0.14) / 0.42 : 0;
    }
  }
  const FFC = P.firefly;
  function fireflies(g, t, k, far) {
    const n = R(FF_N * k);
    ffState(t, n);
    for (let i = 0; i < n; i++) {
      const f = FF[i];
      if ((f.kind === 2) !== far) continue;
      const e = FF_E[i];
      if (e < 0.12) continue;
      const x = R(FF_X[i]);
      const y = R(FF_Y[i]);
      if (far) {
        g.rect(x, y, 1, 1, e > 0.6 ? FFC[2] : FFC[1]);
        continue;
      }
      if (e > 0.62) {
        // full glow: a soft yellow-green bloom, a white-hot core and a plus of light
        HD.glow(g, x, y, 7, HD.LIGHT.firefly, 0.5 * e);
        g.rect(x - 1, y, 3, 1, FFC[2]);
        g.rect(x, y - 1, 1, 3, FFC[2]);
        g.rect(x, y, 1, 1, FFC[4]);
      } else if (e > 0.34) {
        HD.glow(g, x, y, 4, HD.LIGHT.firefly, 0.4 * e);
        g.rect(x, y, 1, 1, FFC[3]);
      } else {
        g.rect(x, y, 1, 1, FFC[e > 0.22 ? 2 : 1]);
      }
    }
  }
  const ZSUM = new Float64Array(FF_ZONES.length);
  function fireflyLights(t, L, k) {
    const n = R(FF_N * k);
    ffState(t, n);
    ZSUM.fill(0);
    for (let i = 0; i < n; i++) if (FF[i].kind !== 2) ZSUM[FF[i].zone] += FF_E[i];
    for (let z = 0; z < FF_ZONES.length; z++) {
      const i = Math.min(0.2, 0.045 * ZSUM[z]);
      if (i > 0.01) L.add({ x: FF_ZONES[z].x, y: FF_ZONES[z].y, r: 42, ry: 30, color: HD.LIGHT.firefly, i, bands: 4 });
    }
  }

  // ------------------------------------------------------------------
  // hooks
  // ------------------------------------------------------------------
  SEA.far = function (g, t) {
    const w = HD.edition.weather;
    if (w.snow > 0) snowFar(g, t, w.snow);
    if (w.fireflies > 0) fireflies(g, t, w.fireflies, true);
  };
  SEA.mid = function (g, t) {
    const w = HD.edition.weather;
    if (w.snow > 0) snowMid(g, t, w.snow);
    if (w.leaves > 0) leavesMid(g, t, w.leaves);
    if (w.petals > 0) petalsMid(g, t, w.petals, HD.edition.tree === 'plum');
    if (w.fireflies > 0) fireflies(g, t, w.fireflies, false);
  };
  SEA.near = function (g, t) {
    const w = HD.edition.weather;
    if (w.snow > 0) snowNear(g, t, w.snow);
    if (w.leaves > 0) leavesNear(g, t, w.leaves);
    if (w.petals > 0.3) petalsNear(g, t, w.petals, HD.edition.tree === 'plum');
  };
  SEA.lights = function (t, L) {
    const w = HD.edition.weather;
    if (w.fireflies > 0) fireflyLights(t, L, w.fireflies);
  };
})();
