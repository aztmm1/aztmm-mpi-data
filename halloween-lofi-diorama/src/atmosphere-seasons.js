/*
 * Atmosphere — seasonal recipes (Rainy Hollow series, see SEASONS.md).
 *
 * atmosphere.js keeps the Halloween layers untouched and, for every other
 * edition, asks HD.atmoSeasons.build(edition) for a recipe (cached per
 * edition with HD.perEdition, so live switching just swaps recipes):
 *
 *   chim   chimney smoke style (every edition; dense in winter, thin in summer)
 *   camp   campfire / bonfire smoke style (only when edition.fire !== 'none')
 *   far    bands drawn at bg z 26 (distant haze along the hill bases)
 *   ground bands drawn at fx z 15 (low mist / haze over the yard)
 *   front  bands drawn at fx z 61 (wisps over the diorama lip)
 *   sky    optional bg z 8.5 draw (faint firework-smoke haze, relit by bursts)
 *   low / high / near   optional extra draws in the fx 15 / 32 / 61 passes
 *
 * Everything stays a pure function of t: bands scroll whole tiles per loop,
 * particles are HD.time.cycle lives.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const LY = HD.layout;
  const W = HD.W;
  const mix = HD.color.mix;
  const css = HD.color.css;
  const sm = HD.smoothstep;
  const CF = LY.campfire;
  const PORCH_HOLE = { x: 220, y: 204, rx: 22, ry: 7 };

  const A = () => HD.atmo; // helpers exported by atmosphere.js

  // ---------------------------------------------------------------------
  // smoke styles
  // ---------------------------------------------------------------------
  const tones = (cols) => cols.map((c) => A().litSet(c, A().SMOKE_L));
  const TS = LY.titleSafe;
  /** lv factor: 0 while a puff's disc would reach into the title area, 1 once 8px clear of it */
  const keepTitle = (x, y, rad) => Math.max(sm(0, 8, y - rad - 1 - TS.y1), sm(0, 8, x - rad - 1 - TS.x1));
  /** lv factor: fade a plume head before it reaches the top edge of the frame */
  const keepTop = (x, y, rad) => sm(2, 12, y - rad);
  const chim = (o) => Object.assign({ keep: keepTop }, A().CHIM, o, { tone: tones(o.tone) });
  const camp = (o) => Object.assign({ keep: keepTitle }, A().CAMP, o, { tone: tones(o.tone) });

  // ---------------------------------------------------------------------
  // band builders (baked tileable textures, see atmosphere.js drawBand)
  // ---------------------------------------------------------------------
  function band(o) {
    return {
      x0: o.x0 || 0,
      w: o.w || W,
      tw: o.tw,
      sub: o.sub === undefined ? 0.5 : o.sub,
      y0: o.y0,
      h: o.h,
      k: o.k || 1,
      ly: o.ly === undefined ? o.y0 + (o.h >> 1) : o.ly,
      tex: A().bakeTile(o.tw, o.h, o.dens, o.cols, !!o.lit, o.core === undefined ? 0.45 : o.core, o.levels),
      alpha: o.alpha,
      lb: o.lb, // light-level boost when picking the lit variant
      mask: o.mask || ((o.holes && o.holes.length) || o.keeps ? A().bakeMask(o.y0, o.h, o.holes || [], o.keeps) : null),
    };
  }

  /** banks of mist around a wavy horizon line (shape of the Halloween far mist) */
  function bankDens(tw, seed, o) {
    const pn = A().pnoise;
    const yc = pn(tw, seed, [[1, 1], [3, 0.6], [5, 0.3]]);
    const th = pn(tw, seed + 1, [[2, 1], [4, 0.6], [7, 0.3]]);
    const am = pn(tw, seed + 2, [[1, 0.7], [2, 1], [5, 0.5], [9, 0.25]]);
    const lo = o.lo === undefined ? 0.15 : o.lo;
    const hi = o.hi === undefined ? 0.85 : o.hi;
    return (x, y) => {
      const c = o.c + (yc[x] - 0.5) * (o.wob === undefined ? 8 : o.wob);
      const s = (y < c ? o.up : o.down) + th[x] * (o.thick === undefined ? 4 : o.thick);
      const q = (y - c) / s;
      return o.gain * Math.exp(-q * q) * (o.floor + (1 - o.floor) * sm(lo, hi, am[x]));
    };
  }

  /** separate soft wisps: a sum of flat elliptical blobs, wrapped on the tile */
  function blobDens(tw, h, seed, o) {
    const rng = HD.rng(seed);
    const blobs = [];
    for (let k = 0; k < o.n; k++)
      blobs.push({
        x: (k + 0.15 + rng() * 0.7) * (tw / o.n),
        y: o.y + (rng() - 0.5) * 2 * o.yj,
        rx: o.rx + rng() * o.rxR,
        ry: o.ry + rng() * o.ryR,
        a: o.a + rng() * o.aR,
      });
    const tilt = A().pnoise(tw, seed + 7, [[3, 1], [7, 0.5]]);
    return (x, y) => {
      let d = 0;
      for (const b of blobs) {
        let dx = x - b.x;
        dx -= tw * Math.round(dx / tw);
        const qx = dx / b.rx;
        const qy = (y - b.y - (tilt[x] - 0.5) * (o.tilt || 4)) / b.ry;
        const e = qx * qx + qy * qy;
        if (e < 3) d += b.a * Math.exp(-1.6 * e);
      }
      return d;
    };
  }

  /** far haze: two parallax bank tiles along the hill bases (bg z 26) */
  function farBands(o) {
    return [
      band({
        tw: 240,
        sub: 0.5,
        y0: o.y0 || 176,
        h: 34,
        cols: o.cols,
        alpha: o.alpha,
        core: o.core === undefined ? 0.5 : o.core,
        dens: bankDens(240, o.seed || 111, { c: o.c || 21, up: o.up || 5, down: o.down || 3.5, thick: o.thick, gain: o.gain || 0.95, floor: o.floor === undefined ? 0.25 : o.floor, lo: o.lo, hi: o.hi }),
      }),
      band({
        tw: 160,
        sub: 0.23,
        y0: (o.y0 || 176) + 12,
        h: 20,
        cols: o.cols2 || o.cols,
        alpha: o.alpha2 === undefined ? o.alpha * 0.8 : o.alpha2,
        core: 0.45,
        dens: bankDens(160, (o.seed || 111) + 10, { c: 11, up: 3.5, down: 3.5, thick: 0, wob: 5, gain: o.gain2 || 0.8, floor: 0, lo: 0.35, hi: 0.9 }),
      }),
    ];
  }

  /** low mist over the yard (fx z 15), warm-lit near lights */
  function groundBand(o) {
    const tw = 480;
    const y0 = o.y0 || 196;
    const h = o.h || 22;
    const pn = A().pnoise;
    const yc = pn(tw, o.seed || 131, [[2, 1], [5, 0.6], [11, 0.3]]);
    const am = pn(tw, (o.seed || 131) + 2, [[1, 0.6], [3, 1], [7, 0.6], [13, 0.3]]);
    const lo = o.lo === undefined ? 0.25 : o.lo;
    const hi = o.hi === undefined ? 0.85 : o.hi;
    return band({
      tw,
      sub: o.sub === undefined ? 0.71 : o.sub,
      y0,
      h,
      k: o.k || 1,
      ly: o.ly || y0 + 9,
      lit: true,
      cols: o.cols,
      alpha: o.alpha,
      core: o.core === undefined ? 0.45 : o.core,
      holes: o.holes,
      keeps: o.keeps,
      levels: o.levels,
      lb: o.lb,
      dens: (x, y) => {
        const c = (o.c || 8) + (yc[x] - 0.5) * (o.wob === undefined ? 5 : o.wob);
        const q = (y - c) / (y < c ? o.up || 3 : o.down || 5.5);
        return (o.gain || 0.8) * Math.exp(-q * q) * ((o.floor || 0) + (1 - (o.floor || 0)) * sm(lo, hi, am[x]));
      },
    });
  }

  /** wisps creeping over the diorama lip (fx z 61) */
  function frontBand(o) {
    const tw = 720;
    const y0 = o.y0 || 226;
    const h = o.h || 24;
    return band({
      tw,
      sub: 0.37,
      y0,
      h,
      k: o.k || 1,
      ly: o.ly || 234,
      lit: true,
      cols: o.cols,
      alpha: o.alpha,
      holes: o.holes,
      dens: blobDens(tw, h, o.seed || 141, { n: o.n || 6, y: o.y || 12, yj: 2.5, rx: 24, rxR: 30, ry: o.ry || 3, ryR: 2.2, a: o.a || 0.5, aR: 0.25 }),
    });
  }

  const fireHoles = (ed) => {
    if (ed.fire === 'none') return [];
    const big = ed.fire === 'bonfire';
    return [{ x: CF.x, y: CF.base - (big ? 22 : 16), rx: big ? 28 : 20, ry: big ? 28 : 20 }];
  };
  const fireFront = (ed) => {
    if (ed.fire === 'none') return [];
    const big = ed.fire === 'bonfire';
    return [{ x: CF.x, y: CF.base - 4, rx: big ? 28 : 20, ry: big ? 11 : 9 }];
  };

  // ---------------------------------------------------------------------
  // firework smoke: a faint drifting haze high in the sky (bg z 8.5),
  // relit in the colour of each burst that flashes inside it
  // ---------------------------------------------------------------------
  const SKY_Y0 = 10;
  const SKY_H = 96;
  const maskCache = new Map();
  /** banded radial falloff (alpha) used to relight the haze around a burst */
  function radialMask(r) {
    let m = maskCache.get(r);
    if (m) return m;
    const n = r * 2 + 1;
    m = HD.canvas(n, n, true);
    const cx = m.getContext('2d');
    const im = cx.createImageData(n, n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - r, y - r) / (r + 0.5);
        if (d >= 1) continue;
        // four flat bands with a short ordered-dither seam between them
        const f = Math.pow(1 - d, 1.4) * 4;
        const b = Math.floor(f);
        const lvl = (b + (f - b > 0.5 + (HD.bayer(x, y) - 0.5) * 0.5 ? 1 : 0)) / 4;
        if (lvl <= 0) continue;
        const q = (y * n + x) * 4;
        im.data[q] = im.data[q + 1] = im.data[q + 2] = 255;
        im.data[q + 3] = Math.round(255 * Math.min(1, lvl));
      }
    cx.putImageData(im, 0, 0);
    maskCache.set(r, m);
    return m;
  }
  // one small work canvas per relight radius (small canvases composite cheaply)
  const glowPool = new Map();
  function glowCanvas(r) {
    let c = glowPool.get(r);
    if (!c) {
      const cv = HD.canvas(r * 2 + 1, r * 2 + 1, true);
      c = { cv, ctx: cv.getContext('2d') };
      glowPool.set(r, c);
    }
    return c;
  }

  /** lumpy smoke clouds: clusters of round puffs, wrapped on the tile */
  function puffDens(tw, h, seed, o) {
    const rng = HD.rng(seed);
    const puffs = [];
    for (let k = 0; k < o.n; k++) {
      const cx = (k + 0.2 + rng() * 0.6) * (tw / o.n);
      const cy = o.y0 + rng() * (o.y1 - o.y0);
      const m = 3 + Math.floor(rng() * 4);
      const a = o.a * (0.75 + 0.5 * rng());
      for (let j = 0; j < m; j++) {
        const r = o.r + rng() * o.rR;
        puffs.push({ x: cx + (j - (m - 1) / 2) * r * 1.1 + (rng() - 0.5) * 6, y: cy + (rng() - 0.5) * r * 0.9, rx: r, ry: r * (0.55 + 0.2 * rng()), a: a * (0.7 + 0.5 * rng()) });
      }
    }
    return (x, y) => {
      let d = 0;
      for (const b of puffs) {
        let dx = x - b.x;
        dx -= tw * Math.round(dx / tw);
        if (dx > b.rx * 2 || dx < -b.rx * 2) continue;
        const qx = dx / b.rx;
        const qy = (y - b.y) / b.ry;
        const e = qx * qx + qy * qy;
        if (e < 3.5) d += b.a * Math.exp(-1.4 * e);
      }
      return Math.min(1, d);
    };
  }

  function skyHaze(o) {
    const tw = 480;
    // erase mask: keep the haze inside the fireworks zone, well clear of
    // titleSafe (it only starts 4px right of it) and of the moon
    const Z = LY.seasonal.fireworks;
    const TS = LY.titleSafe;
    const WHITE = 0xffffffff;
    // the haze only exists right of X0, so only that part is ever composited
    const X0 = TS.x1 + 4;
    const BW = W - X0;
    const mask = A().bakePixels(BW, SKY_H, (u32) => {
      for (let y = 0; y < SKY_H; y++)
        for (let i = 0; i < BW; i++) {
          const x = X0 + i;
          const yy = y + SKY_Y0;
          let keep = sm(X0, TS.x1 + 70, x) * (1 - sm(Z.x1 - 10, W + 10, x)) * sm(SKY_Y0, SKY_Y0 + 18, yy) * (1 - sm(Z.y1 - 18, Z.y1 + 6, yy));
          if (o.moon) keep *= sm(o.moon.r + 2, o.moon.r + 12, Math.hypot(x - o.moon.x, yy - o.moon.y)); // never veil the moon
          if (HD.bayer(x, y) >= keep) u32[y * BW + i] = WHITE;
        }
    });
    const B = band({
      x0: X0,
      w: BW,
      tw,
      sub: 0.13,
      y0: SKY_Y0,
      h: SKY_H,
      k: 1,
      cols: o.cols,
      alpha: o.alpha,
      core: 0.5,
      mask,
      dens: puffDens(tw, SKY_H, o.seed || 151, { n: o.n || 7, y0: 22, y1: 72, r: 6, rR: 6, a: o.a || 0.6 }),
    });
    const lit = o.lit === undefined ? 0.5 : o.lit;
    const top = [];
    return function (g, t) {
      // the masked haze only changes when the tile steps a pixel: cached
      const hz = A().maskedBand(B, t);
      const ctx = g.ctx;
      ctx.globalAlpha = B.alpha;
      ctx.drawImage(hz, 0, 0, BW, SKY_H, X0, SKY_Y0, BW, SKY_H);
      ctx.globalAlpha = 1;
      // relight the smoke around the (up to) three brightest live bursts
      const fw = HD._fireworks;
      const s = fw && fw.show();
      if (!s) return;
      top.length = 0;
      for (const sh of fw.liveShells(t, s)) {
        const f = fw.flashOf(sh);
        if (f > 0.05) top.push([f, sh]);
      }
      if (!top.length) return;
      if (top.length > 3) top.sort((p, q) => q[0] - p[0]).length = 3;
      for (const [f, sh] of top) {
        const r = Math.max(20, Math.min(88, Math.round((sh.R * 2.2) / 4) * 4));
        const cx = Math.round(sh.bx);
        const cy = Math.round(sh.by) - SKY_Y0;
        const sx0 = Math.max(X0, cx - r);
        const sy0 = Math.max(0, cy - r);
        const sx1 = Math.min(W, cx + r + 1);
        const sy1 = Math.min(SKY_H, cy + r + 1);
        const w = sx1 - sx0;
        const h = sy1 - sy0;
        if (w <= 0 || h <= 0) continue;
        const ox = sx0 - (cx - r);
        const oy = sy0 - (cy - r);
        const c = HD.LIGHT.firework[sh.col] || HD.LIGHT.firework.gold;
        const gl = glowCanvas(r);
        const gx = gl.ctx;
        gx.globalCompositeOperation = 'source-over';
        gx.clearRect(0, 0, r * 2 + 1, r * 2 + 1);
        gx.drawImage(hz, sx0 - X0, sy0, w, h, ox, oy, w, h);
        gx.globalCompositeOperation = 'destination-in';
        gx.drawImage(radialMask(r), 0, 0);
        gx.globalCompositeOperation = 'source-in';
        gx.fillStyle = css(120 * c[0], 120 * c[1], 120 * c[2]);
        gx.fillRect(0, 0, r * 2 + 1, r * 2 + 1);
        gx.globalCompositeOperation = 'source-over';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, f * lit);
        ctx.drawImage(gl.cv, ox, oy, w, h, sx0, sy0 + SKY_Y0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      g.reset();
    };
  }

  // ---------------------------------------------------------------------
  // drifting powder (winter): gusts lift fine snow off the yard and the
  // roof and carry it downwind as short dithered streaks
  // ---------------------------------------------------------------------
  /**
   * One wisp of blown powder: a bright 2px head low and downwind, a solid
   * body trailing upwind that lifts by a pixel, then a broken tail.
   * Shape (not dither) carries the fade, so it never reads as speckle.
   */
  function streak(g, x, y, len, env, cols, par) {
    const xi = Math.round(x);
    const yi = Math.round(y);
    const L = A().level(xi, yi);
    const core = cols[0][L];
    const rim = cols[1][L];
    const n = Math.round(len * env);
    if (n < 2) {
      g.px(xi, yi, rim);
      return;
    }
    g.px(xi, yi, core);
    if (env > 0.45) g.px(xi - 1, yi, core);
    if (env > 0.7 && n > 5) g.px(xi - 1, yi - 1, rim);
    const solid = Math.max(2, Math.round(n * 0.55));
    const thick = n > 9 ? Math.round(n * 0.35) : 0; // big gusts get a 2px body
    for (let k = 2; k <= n; k++) {
      const yy = yi - (k > solid ? 1 : 0) - (k > n * 0.85 && n > 7 ? 1 : 0);
      if (k <= solid || ((k + par) & 1) === 0) g.px(xi - k, yy, rim);
      if (k <= thick) g.px(xi - k, yy - 1, k < 3 ? core : rim);
    }
  }

  function powder(o) {
    const cols = [o.cols[0], o.cols[1]].map((c) => A().litSet(c));
    const drift = [o.roofCols[0], o.roofCols[1]].map((c) => A().litSet(c, A().SMOKE_L));
    const roof = o.roof || [];
    return function (g, t) {
      // yard gusts
      for (let i = 0; i < o.n; i++) {
        const c = T.cycle(t, i, o.life, o.seed);
        const a = c.age;
        const r1 = c.rnd(1);
        const depth = c.rnd(2);
        const r3 = c.rnd(3);
        const r4 = c.rnd(4);
        const par = (c.rnd(5) * 2) | 0;
        const env = Math.sin(Math.PI * a);
        if (env < 0.12) continue;
        const sc = 0.55 + 0.6 * depth;
        // most gusts run along the back edge (against the dark pines) or
        // spill over the front lip (against the soil), where powder reads
        const dz = depth < 0.4 ? depth * 0.5 : depth < 0.7 ? 0.2 + (depth - 0.4) * 2 : 0.8 + (depth - 0.7) * 0.66;
        const y0 = o.y0 + dz * (o.y1 - o.y0);
        const x0 = -20 + r1 * (W + 10);
        const x = x0 + (o.travel + o.travelR * r3) * sc * a;
        const y = y0 - env * (2 + 6 * r4) * sc;
        streak(g, x, y, (o.len + o.lenR * r3) * sc, Math.min(1, env * o.dens), cols, par);
      }
      // spindrift: now and then a gust lifts a little powder off the roof
      // snow and rolls it a short way down the slope as soft dithered puffs
      // (snow[7] core, snow[6] rim) that hug the roof line and thin out
      const at = A();
      for (let i = 0; i < roof.length * 2; i++) {
        const s = roof[i % roof.length];
        const c = T.cycle(t, i, s.life, o.seed + 31);
        const a = c.age;
        if (a > s.on) continue; // quiet most of the time
        const u = a / s.on;
        const env = Math.sin(Math.PI * u);
        const r1 = c.rnd(1);
        const sz = 0.8 + 0.4 * c.rnd(3);
        const bx = s.x0 + (s.x1 - s.x0) * r1;
        const by = s.y0 + (s.y1 - s.y0) * r1;
        const kx = (c.rnd(4) * 8) | 0;
        const ky = (c.rnd(5) * 8) | 0;
        // a short train of puffs: the lead one has travelled furthest
        for (let k = 2; k >= 0; k--) {
          const uk = u - k * 0.12;
          if (uk <= 0) continue;
          const d = s.run * sz * uk;
          const x = bx + d;
          const y = by + d * s.slope - s.lift - s.hop * Math.sin(Math.PI * Math.min(1, uk * 1.2));
          const rad = (1.5 + 1.5 * uk) * (1 - 0.2 * k) * sz;
          const lv = env * (1 - 0.25 * k) * (1 - 0.45 * uk);
          if (lv <= 0.05) continue;
          const xi = Math.round(x);
          const yi = Math.round(y);
          const L = at.level(xi, yi);
          at.srDisc(xi, yi, rad, drift[1][L], lv, 0.7, kx - xi, ky - yi);
          if (rad > 1.8) at.srDisc(xi, yi, rad * 0.55, drift[0][L], lv * 0.9, 0.5, kx - xi, ky - yi);
        }
      }
      at.srFlush(g);
    };
  }

  // ---------------------------------------------------------------------
  // lamp smoke (lights): pockets around the yard diyas at fence-top height
  // ---------------------------------------------------------------------
  /**
   * The diya lights have fixed positions (only their flicker changes), so the
   * pockets are read from this frame's light list when the recipe is built
   * (always during a frame, after every module has added its lights). Lamps
   * on the cottage are skipped: the veil stays off the house.
   */
  function lampKeeps(y0, y1) {
    const H0 = LY.house.roof.x0;
    const H1 = LY.house.turret.x1 + 6;
    const out = [];
    for (const l of HD.lights.list) {
      if (l.color !== HD.LIGHT.candle && l.color !== HD.LIGHT.diya) continue;
      if (l.y < y0 || l.y > y1 || (l.x > H0 && l.x < H1)) continue;
      out.push({ x: l.x, y: l.y - 2, rx: Math.max(14, (l.r || 16) * 0.8), ry: 8 });
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // recipes
  // ---------------------------------------------------------------------
  const SMOKE = {
    // Halloween-like cold grey-blue, lifted by moonlight on the upper right
    moon: () => [mix(P.stone[6], P.moon[1], 0.35), mix(P.stone[5], P.night[7], 0.3), mix(P.stone[4], P.night[6], 0.4), mix(P.stone[3], P.night[5], 0.5), mix(P.night[3], P.stone[2], 0.45)],
    snow: () => [mix(P.snow[6], P.violet[6], 0.12), mix(P.snow[5], P.violet[5], 0.18), mix(P.snow[4], P.violet[5], 0.22), mix(P.snow[3], P.violet[4], 0.3), mix(P.snow[2], P.violet[3], 0.35)],
    // frosty air: pale ice-grey, kept close to the stone ramp so it stays smoke, not cloud
    frost: () => [mix(P.ice[4], P.stone[7], 0.45), mix(P.ice[3], P.stone[6], 0.5), mix(P.ice[2], P.stone[5], 0.55), mix(P.night[5], P.stone[3], 0.5), mix(P.night[3], P.stone[2], 0.45)],
    spring: () => [mix(P.stone[6], P.blossom[5], 0.2), mix(P.stone[5], P.blossom[4], 0.16), mix(P.stone[4], P.night[6], 0.4), mix(P.stone[3], P.night[5], 0.5), mix(P.night[3], P.stone[2], 0.45)],
    // harvest moon rim: a warm highlight close in value to the body so it clusters, never speckles
    gold: () => [mix(P.stone[6], P.gold[4], 0.17), mix(P.stone[5], P.autumn[4], 0.14), mix(P.stone[4], P.violet[5], 0.3), mix(P.stone[3], P.violet[4], 0.4), mix(P.night[3], P.violet[2], 0.45)],
    lamp: () => [mix(P.stone[5], P.wood[7], 0.4), mix(P.stone[4], P.wood[6], 0.4), mix(P.stone[3], P.wood[5], 0.4), mix(P.stone[3], P.night[4], 0.45), mix(P.night[3], P.stone[2], 0.45)],
  };
  // campfire smoke: 4 tones, the light one slightly wood-tinted near the flames
  const campTones = (s) => [s[1], mix(s[2], P.wood[5], 0.35), s[3], s[4]];
  // one step lighter: reads as pale smoke over snowy hills instead of a dark streak
  const campTonesPale = (s) => [s[0], mix(s[1], P.wood[6], 0.3), s[2], s[3]];
  // harvest dusk: the plume rises over warm mauve hills and the dusk band
  // (about #3a2645), so it ends at that value and dissolves instead of
  // finishing as a dark sooty smudge
  const campTonesDusk = () => [mix(P.stone[6], P.blossom[3], 0.25), mix(P.stone[5], P.wood[6], 0.4), mix(P.stone[4], P.violet[5], 0.35), mix(P.violet[4], P.wood[5], 0.4)];

  const RECIPES = {
    lunar(ed) {
      const s = SMOKE.frost();
      return {
        // cold still air: the column climbs tall and straight
        chim: chim({ tone: s, rise: 58, driftK: 0.5, gust: 12, lvK: 1.55 }),
        far: farBands({ cols: [mix(P.night[7], P.ice[3], 0.4), mix(P.night[8], P.ice[4], 0.4)], alpha: 0.5, seed: 211, gain: 0.85 }),
        ground: [groundBand({ cols: [mix(P.ice[3], P.night[8], 0.3), mix(P.ice[4], P.snow[7], 0.45)], alpha: 0.36, c: 10, up: 2.5, down: 4, lo: 0.2, hi: 0.8, seed: 231, holes: [PORCH_HOLE] })],
        front: [frontBand({ cols: [mix(P.ice[2], P.night[7], 0.35), mix(P.ice[3], P.snow[6], 0.45)], alpha: 0.3, n: 5, seed: 241, holes: [] })],
        sky: skyHaze({ cols: [mix(P.night[5], P.stone[4], 0.5), mix(P.night[6], P.stone[5], 0.45)], alpha: 0.3, seed: 251, n: 5, lit: 0.5 }),
      };
    },
    spring(ed) {
      const s = SMOKE.spring();
      const mist = [mix(P.night[7], P.stone[6], 0.35), mix(P.night[8], P.blossom[5], 0.22)];
      return {
        chim: chim({ tone: s }),
        // soft spring mist: fuller banks in the valleys and over the wet meadow
        far: farBands({ cols: [mix(P.night[6], P.stone[5], 0.4), mix(P.night[7], P.blossom[4], 0.25)], alpha: 0.62, seed: 311, gain: 1, floor: 0.4 }),
        ground: [groundBand({ cols: mist, alpha: 0.44, c: 9, up: 3.5, down: 6.5, lo: 0.1, hi: 0.7, gain: 0.85, seed: 331, holes: [PORCH_HOLE] })],
        front: [frontBand({ cols: mist, alpha: 0.44, n: 7, seed: 341, holes: [] })],
      };
    },
    summer(ed) {
      const s = SMOKE.moon();
      // warm meadow haze: green-gold, close in hue to the grass it lies on
      const warm = [mix(P.leaf[5], P.amber[4], 0.35), mix(P.leaf[6], P.amber[5], 0.35)];
      return {
        // thin wisp from the hearth on the warm night
        // (calm curl and more, smaller puffs so the thread stays continuous)
        chim: chim({ tone: s, n: 26, rad0: 1.8, radK: 4.6, lvK: 1.2, hlK: 1.1, life: 12, rise: 52, curl: 1.6 }),
        // the midsummer bonfire: wider column, more puffs; it leans downwind
        // early so the head stays right of and below the title area
        camp: camp({ tone: campTones(s), n: 72, life: 9, sy: CF.base - 54, rise: 84, riseR: 8, driftK: 1.15, spread: 6, curl: 2.6, rad0: 1.8, radK: 10.2, lvK: 1.85, hlK: 1.4, gust: 12 }),
        far: farBands({ cols: [mix(P.night[5], P.amber[2], 0.32), mix(P.night[6], P.amber[3], 0.3)], alpha: 0.5, seed: 411, gain: 0.9 }),
        // warm low haze lying over the meadow
        ground: [groundBand({ cols: warm, alpha: 0.3, c: 10, up: 3.5, down: 7, lo: 0.25, hi: 0.8, gain: 0.8, floor: 0, seed: 431, holes: [PORCH_HOLE, ...fireHoles(ed)] })],
        front: [frontBand({ cols: warm, alpha: 0.3, n: 5, seed: 441, holes: fireFront(ed) })],
      };
    },
    harvest(ed) {
      const s = SMOKE.gold();
      const gold = [mix(P.night[6], P.gold[2], 0.42), mix(P.night[7], P.gold[3], 0.42)];
      return {
        chim: chim({ tone: s }),
        // the tail thins out a little faster too (tailK)
        camp: camp({ tone: campTonesDusk(), tailK: 1.25 }),
        // golden dusk haze lying on the visible hill faces above the shrubs
        far: farBands({ cols: [mix(P.night[6], P.gold[3], 0.5), mix(P.autumn[5], P.gold[4], 0.5)], cols2: [mix(P.night[6], P.gold[3], 0.4), mix(P.autumn[4], P.gold[3], 0.45)], alpha: 0.34, alpha2: 0.18, seed: 511, gain: 0.85, floor: 0.4, y0: 158, c: 15, up: 6, down: 3 }),
        ground: [groundBand({ cols: gold, alpha: 0.36, seed: 531, lo: 0.2, hi: 0.8, holes: [PORCH_HOLE, ...fireHoles(ed)] })],
        front: [frontBand({ cols: gold, alpha: 0.34, n: 5, seed: 541, holes: fireFront(ed) })],
      };
    },
    lights(ed) {
      const s = SMOKE.lamp();
      const lamp = [mix(P.stone[4], P.wood[6], 0.4), mix(P.stone[5], P.wood[7], 0.4)];
      const lampVeil = () => {
        const keeps = lampKeeps(176, 206);
        if (!keeps.length) return [];
        const TR = LY.tree;
        return [
          groundBand({
            // warm smoke lit by the lamps it hangs around (never a cold grey veil)
            cols: [mix(P.wood[5], P.autumn[3], 0.35), mix(P.wood[6], P.amber[3], 0.35)],
            alpha: 0.18,
            y0: 176,
            h: 30,
            c: 10, // hangs just above the flames, lit from below
            up: 4.5,
            down: 2.5,
            wob: 3,
            lo: 0.3,
            hi: 0.85,
            gain: 1.6, // dense core: a soft tint near the lamps, dither only at the rims
            floor: 0.3,
            seed: 671,
            sub: 0.19,
            ly: 189,
            lb: 2.5, // the little flames are weak lights: let them warm it early
            levels: [0, 0.45, 0.8, 1.1],
            keeps,
            // keep the tree trunk and the birdhouse crisp
            holes: [
              { x: TR.x - 2, y: 192, rx: TR.trunkW * 0.8 + 3, ry: 40 },
              { x: 466, y: 188, rx: 11, ry: 13 },
            ],
          }),
        ];
      };
      return {
        chim: chim({ tone: s }),
        // smoky haze over the village and the lamp-lit yard
        far: farBands({ cols: [mix(P.night[4], P.wood[5], 0.4), mix(P.night[5], P.wood[6], 0.4)], alpha: 0.5, seed: 611, gain: 0.9 }),
        ground: [
          groundBand({ cols: lamp, alpha: 0.3, c: 9, up: 4, down: 6, lo: 0.05, hi: 0.65, gain: 0.7, floor: 0.2, seed: 631, holes: [PORCH_HOLE, { x: 220, y: 221, rx: 22, ry: 7 }] }),
          // lamp smoke hanging at fence-top height: it only exists in pockets
          // around the lamps that light it, never as a veil over the garden
          ...lampVeil(),
        ],
        front: [frontBand({ cols: lamp, alpha: 0.26, n: 4, seed: 641, holes: [] })],
        sky: skyHaze({ cols: [mix(P.night[5], P.wood[5], 0.4), mix(P.night[6], P.wood[6], 0.4)], alpha: 0.24, seed: 651, n: 5, lit: 0.45 }),
      };
    },
    winter(ed) {
      const s = SMOKE.snow();
      const haze = [mix(P.snow[4], P.violet[5], 0.15), mix(P.snow[5], P.snow[6], 0.5)];
      return {
        // dense, slow, billowing hearth smoke on the coldest night
        chim: chim({ tone: s, n: 46, life: 16, rise: 56, rad0: 2.8, radK: 8.6, lvK: 2.1, hlK: 1.6, gust: 14 }),
        far: farBands({ cols: [mix(P.snow[3], P.violet[4], 0.25), mix(P.snow[4], P.violet[5], 0.2)], alpha: 0.62, seed: 711, gain: 1, floor: 0.45, up: 6, down: 4 }),
        // low snow haze hugging the drifts
        ground: [
          groundBand({ cols: haze, alpha: 0.4, c: 10, up: 3, down: 6, lo: 0.1, hi: 0.7, gain: 0.85, floor: 0.15, seed: 731, k: 2, holes: [PORCH_HOLE] }),
        ],
        front: [frontBand({ cols: haze, alpha: 0.4, n: 7, seed: 741, holes: [] })],
        near: powder({
          cols: [P.snow[8], P.snow[7]],
          n: 24,
          life: 6,
          seed: 761,
          y0: 202,
          y1: 242,
          travel: 46,
          travelR: 40,
          len: 10,
          lenR: 12,
          dens: 1.3,
          // roof snow surfaces (on the slope lines), how far a gust rolls the
          // powder down them (run, along `slope`) and how high it rides
          roofCols: [P.snow[7], P.snow[6]],
          roof: [
            { x0: 224, y0: 78, x1: 248, y1: 100, slope: 0.92, run: 15, lift: 3, hop: 2.5, life: 11, on: 0.4 },
            { x0: 286, y0: 64, x1: 291, y1: 80, slope: 1.3, run: 8, lift: 2, hop: 2, life: 13, on: 0.32 },
          ],
        }),
      };
    },
    newyear(ed) {
      const s = SMOKE.frost();
      return {
        chim: chim({ tone: s, rise: 58, driftK: 0.55, gust: 14 }),
        camp: camp({ tone: campTonesPale(s) }),
        far: farBands({ cols: [mix(P.night[7], P.ice[3], 0.4), mix(P.night[8], P.ice[4], 0.4)], alpha: 0.46, seed: 811, gain: 0.85 }),
        ground: [
          groundBand({
            cols: [mix(P.ice[3], P.night[8], 0.3), mix(P.ice[4], P.snow[7], 0.45)],
            alpha: 0.34,
            c: 10,
            up: 2.5,
            down: 4,
            seed: 831,
            holes: [PORCH_HOLE, ...fireHoles(ed)],
          }),
        ],
        front: [
          frontBand({
            cols: [mix(P.ice[2], P.night[7], 0.35), mix(P.ice[3], P.snow[6], 0.45)],
            alpha: 0.28,
            n: 5,
            seed: 841,
            holes: [...fireFront(ed), ...LY.seasonal.sparklers.map((s) => ({ x: s.x, y: s.base - 3, rx: 9, ry: 7 }))],
          }),
        ],
        // a big show leaves more smoke hanging over the hills
        sky: skyHaze({ cols: [mix(P.night[5], P.stone[4], 0.5), mix(P.night[6], P.stone[5], 0.45)], alpha: 0.36, seed: 851, n: 8, a: 0.7, lit: 0.55, moon: LY.moon }),
      };
    },
  };

  HD.atmoSeasons = {
    build(ed) {
      const r = (RECIPES[ed.id] || RECIPES.harvest)(ed);
      // smoke follows the edition's fire, whatever the recipe says
      if (ed.fire === 'none') r.camp = null;
      else if (!r.camp) r.camp = camp({ tone: campTones(SMOKE.moon()) });
      return r;
    },
  };
})();
