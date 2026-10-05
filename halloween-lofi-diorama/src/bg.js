/*
 * bg — the unlit backdrop of Rainy Hollow.
 *   z0   sky: flat overcast bands with ordered-dither seams, banded moon halo and
 *        the moon disc with subtle crater clusters (all baked once)
 *   z3   far clouds: violet stratus banks along the horizon      (1 tile / loop)
 *   z5   mid clouds: scattered dark clumps that veil the moon     (1 tile / loop)
 *   z7   near clouds: heavy overcast with lumpy hanging bottoms   (2 tiles / loop)
 *        every cloud layer is a tileable canvas blitted with wrap-around, plus
 *        three pre-baked "moonlit" variants revealed through dithered radial
 *        masks around the moon (silver-lined edges, glowing veils)
 *   z8   lightning: once per loop, 3 soft pulses inside a horizon bank (~0.5 s)
 *   z10  distant landscape: hazy far hills with a chapel, darker hills, pine line
 *   z11  the chapel's tiny warm window + two far cottage lights (slow flicker)
 *   z18  bats: a pair flaps past the moon every ~80 s
 * Per frame: a handful of drawImage calls and a few pixels.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const LAY = HD.layout;
  const MOON = LAY.moon;
  const W = HD.W;
  const mix = HD.color.mix;
  const hex = HD.color.hex;

  // ------------------------------------------------------------------
  // init-time raster helpers
  // ------------------------------------------------------------------
  /** RGBA raster -> canvas */
  function Img(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  Img.prototype.set = function (x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const v = hex(c);
    const i = (y * this.w + x) * 4;
    this.d[i] = v[0];
    this.d[i + 1] = v[1];
    this.d[i + 2] = v[2];
    this.d[i + 3] = 255;
  };
  Img.prototype.on = function (x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.d[(y * this.w + x) * 4 + 3] > 0;
  };
  Img.prototype.canvas = function () {
    const self = this;
    return HD.bake(this.w, this.h, (g, cv) => {
      const ctx = cv.getContext('2d');
      const id = ctx.createImageData(self.w, self.h);
      id.data.set(self.d);
      ctx.putImageData(id, 0, 0);
    });
  };

  /** tone map (0 = empty, 1 shadow, 2 base, 3 light, 4 rim) with x wrap */
  function Tones(w, h) {
    this.w = w;
    this.h = h;
    this.a = new Uint8Array(w * h);
  }
  Tones.prototype.get = function (x, y) {
    if (y < 0 || y >= this.h) return 0;
    return this.a[y * this.w + (((x % this.w) + this.w) % this.w)];
  };
  Tones.prototype.put = function (x, y, v) {
    if (y < 0 || y >= this.h) return;
    this.a[y * this.w + (((x % this.w) + this.w) % this.w)] = v;
  };
  /**
   * Paint one cloud object: the union of several puffs (ellipses), shaded as
   * ONE silhouette so it reads as a clean cluster: a 1px rim + lit band on the
   * upper right (moon side), a dark band along the underside, and the
   * upper-right contour of a few "front" puffs as inner lumps.
   * puffs: [cx, cy, rx, ry, base?, front?]  (base clips to a flat bottom row)
   */
  function cloud(tn, puffs, rim, darkUnder) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of puffs) {
      x0 = Math.min(x0, Math.floor(p[0] - p[2] - 2));
      x1 = Math.max(x1, Math.ceil(p[0] + p[2] + 2));
      y0 = Math.min(y0, Math.floor(p[1] - p[3] - 2));
      y1 = Math.max(y1, Math.ceil(p[1] + p[3] + 2));
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const inP = (p, x, y) => {
      if (p[4] !== undefined && y > p[4]) return false;
      const dx = (x - p[0]) / p[2];
      const dy = (y - p[1]) / p[3];
      return dx * dx + dy * dy <= 1;
    };
    const m = new Uint8Array(bw * bh);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) for (const p of puffs) if (inP(p, x, y)) m[(y - y0) * bw + (x - x0)] = 1;
    const M = (x, y) => (x < x0 || x > x1 || y < y0 || y > y1 ? 0 : m[(y - y0) * bw + (x - x0)]);
    const under = darkUnder || 3;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!M(x, y)) continue;
        let v = 2;
        if (!M(x, y + under) || !M(x - 1, y + under - 1)) v = 1;
        if (!M(x + 1, y - 2) || !M(x + 2, y - 1)) v = 3;
        if (rim && (!M(x, y - 1) || !M(x + 1, y - 1))) v = 4;
        tn.put(x, y, v);
      }
    // inner lumps: upper-right contour of "front" puffs inside the silhouette
    for (const p of puffs) {
      if (!p[5]) continue;
      for (let y = Math.floor(p[1] - p[3]); y <= p[1]; y++)
        for (let x = Math.floor(p[0] - p[2] * 0.2); x <= Math.ceil(p[0] + p[2]); x++) {
          if (!inP(p, x, y) || inP(p, x + 1, y - 1)) continue;
          if (!M(x + 1, y - 1)) continue; // already the outer edge
          tn.put(x, y, 3);
        }
    }
  }
  /** remove lone pixels so every tone reads as a cluster */
  function tidy(tn, passes) {
    const w = tn.w;
    const h = tn.h;
    for (let p = 0; p < passes; p++) {
      const out = tn.a.slice();
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = tn.get(x, y);
          const n = [tn.get(x - 1, y), tn.get(x + 1, y), tn.get(x, y - 1), tn.get(x, y + 1)];
          let same = 0;
          let filled = 0;
          for (const q of n) {
            if (q === v) same++;
            if (q) filled++;
          }
          if (same > 0) continue;
          if (v && filled === 0) {
            out[y * w + x] = 0;
            continue;
          }
          // adopt the most common neighbour tone
          const cnt = [0, 0, 0, 0, 0];
          for (const q of n) cnt[q]++;
          let best = 0;
          for (let k = 1; k < 5; k++) if (cnt[k] > cnt[best] || (best === 0 && cnt[k] > 0 && cnt[k] >= cnt[0])) best = k;
          if (!v && filled < 3) continue; // small notches in the silhouette are fine
          out[y * w + x] = best;
        }
      tn.a = out;
    }
  }
  function tonesToCanvas(tn, pal) {
    const im = new Img(tn.w, tn.h);
    for (let y = 0; y < tn.h; y++)
      for (let x = 0; x < tn.w; x++) {
        const v = tn.a[y * tn.w + x];
        if (v) im.set(x, y, pal[v - 1]);
      }
    return im.canvas();
  }
  const shade = (pal, target, ks) => pal.map((c, i) => mix(c, target, ks[i]));

  // ------------------------------------------------------------------
  // Sky (bands, dithered seams), moon halo, moon
  // ------------------------------------------------------------------
  const SKY_BANDS = [
    P.night[1], //               y < 24
    mix(P.night[1], P.night[2], 0.5), // < 48
    P.night[2], //               < 72
    mix(P.night[3], P.violet[1], 0.5), // < 96
    mix(P.night[4], P.violet[2], 0.5), // < 118
    mix(P.night[4], P.violet[3], 0.6), // < 140
    mix(P.night[5], P.violet[4], 0.5), // < 162
    mix(P.night[6], P.violet[4], 0.55),
  ];
  const SKY_EDGES = [24, 48, 72, 96, 118, 140, 162];
  const SEAM = 5;
  function skyBand(x, y) {
    const b = HD.bayer(x, y);
    let n = 0;
    for (let j = 0; j < SKY_EDGES.length; j++) if ((y - SKY_EDGES[j] + SEAM + 0.5) / (2 * SEAM + 1) > b) n++;
    return n;
  }

  function bakeSky() {
    const im = new Img(W, 210);
    for (let y = 0; y < 210; y++)
      for (let x = 0; x < W; x++) {
        let c = SKY_BANDS[skyBand(x, y)];
        // banded halo around the moon (dithered band edges)
        const dx = x - MOON.x;
        const dy = y - MOON.y;
        const d = Math.sqrt(dx * dx + dy * dy) + (HD.bayer(x + 3, y + 5) - 0.5) * 5;
        if (d < 64) {
          const k = d < 23 ? 0.24 : d < 31 ? 0.15 : d < 44 ? 0.085 : 0.04;
          c = mix(c, P.moon[0], k);
        }
        im.set(x, y, c);
      }
    // the moon disc
    const r = MOON.r;
    const rr = r * r + r * 0.6;
    const inD = (dx, dy) => dx * dx + dy * dy <= rr;
    const craters = [
      // [dx, dy, rx, ry] crater clusters / maria (moon-local)
      [-5, -4, 3.6, 2.6],
      [-8, -1, 1.6, 2.2],
      [3, 3, 4.6, 3.1],
      [6, 0, 1.6, 1.2],
      [-2, 8, 3, 1.8],
      [7, -7, 1.6, 1.3],
      [-9, 6, 1.4, 1.4],
    ];
    const dark = [
      [-6, -4],
      [-5, -4],
      [2, 3],
      [3, 3],
      [3, 4],
      [-2, 8],
    ];
    for (let dy = -r - 1; dy <= r + 1; dy++)
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        if (!inD(dx, dy)) continue;
        let c = P.moon[3];
        // a little brighter toward the upper right
        if (inD(dx - 3, dy + 3) && (dx - 4) * (dx - 4) + (dy + 4) * (dy + 4) < 46) c = P.moon[4];
        for (const k of craters) {
          const ex = (dx - k[0]) / k[2];
          const ey = (dy - k[1]) / k[3];
          if (ex * ex + ey * ey <= 1) c = P.moon[2];
        }
        // lower-left limb darkening (2 px)
        if (!inD(dx - 1.5, dy + 1.5)) c = P.moon[2];
        if (!inD(dx - 0.7, dy + 0.7) && dx < 0 && dy > 0) c = P.moon[1];
        im.set(MOON.x + dx, MOON.y + dy, c);
      }
    for (const p of dark) im.set(MOON.x + p[0], MOON.y + p[1], P.moon[1]);
    // light crater rims (lower-right edge of the bigger maria)
    im.set(MOON.x - 3, MOON.y - 2, P.moon[4]);
    im.set(MOON.x + 6, MOON.y + 5, P.moon[4]);
    im.set(MOON.x + 7, MOON.y + 4, P.moon[4]);
    return im.canvas();
  }

  // ------------------------------------------------------------------
  // Cloud layers
  // ------------------------------------------------------------------
  const LAYERS = [
    {
      id: 'far',
      z: 3,
      y: 86,
      w: 480,
      h: 46,
      k: 1,
      pal: [mix(P.night[3], P.violet[2], 0.55), mix(P.night[4], P.violet[2], 0.55), mix(P.night[4], P.violet[3], 0.6), mix(P.night[5], P.violet[4], 0.55)],
      gen: genFar,
    },
    {
      id: 'mid',
      z: 5,
      y: 26,
      w: 600,
      h: 84,
      k: 1,
      pal: [mix(P.night[2], P.night[3], 0.4), mix(P.night[3], P.violet[2], 0.3), mix(P.night[4], P.violet[2], 0.35), mix(P.night[5], P.violet[3], 0.35)],
      gen: genMid,
    },
    {
      id: 'near',
      z: 7,
      y: 0,
      w: 480,
      h: 46,
      k: 2,
      pal: [mix(P.night[1], P.night[2], 0.35), mix(P.night[2], P.violet[1], 0.3), mix(P.night[3], P.violet[1], 0.35), mix(P.night[3], P.violet[2], 0.45)],
      gen: genNear,
    },
  ];

  function genNear(rng, w, h) {
    const tn = new Tones(w, h);
    // the overcast ceiling: one long mass with a lumpy underside (wraps)
    const mass = [];
    for (let x = -20; x < w + 20; x += 20 + rng() * 12) mass.push([x, 1 + rng() * 4, 18 + rng() * 10, 9 + rng() * 4, undefined, rng() < 0.35]);
    cloud(tn, mass, false, 3);
    // hanging lumps, in small groups, painted front-to-back by depth
    const groups = [];
    for (let i = 0; i < 9; i++) {
      const gx = (i + rng() * 0.6) * (w / 9);
      const deep = rng() < 0.4;
      const g = [];
      const n = 2 + Math.floor(rng() * 3);
      for (let j = 0; j < n; j++) {
        const ry = 3 + rng() * (deep ? 5 : 3);
        g.push([gx + j * (7 + rng() * 6), 12 + rng() * 5 + (deep ? 6 : 0) - ry * 0.3, ry * (1.5 + rng() * 0.8), ry, undefined, j > 0]);
      }
      groups.push(g);
    }
    groups.sort((a, b) => a[0][1] - b[0][1]);
    for (const g of groups) cloud(tn, g, true, 2);
    tidy(tn, 2);
    return tn;
  }

  function genMid(rng, w, h) {
    const tn = new Tones(w, h);
    const clumps = [
      // [x, width, baseY (tile-local)] — two ride high enough to cross the moon
      [20, 96, 42],
      [175, 64, 68],
      [300, 112, 47],
      [458, 80, 74],
    ];
    for (const c of clumps) {
      const x0 = c[0] + rng() * 20;
      const cw = c[1];
      const yb = c[2];
      // back layer: a lower-contrast bank peeking out above / behind
      const back = [];
      const nb = Math.max(3, Math.round(cw / 16));
      for (let i = 0; i < nb; i++) {
        const u = (i + 0.5) / nb;
        const hump = Math.sin(Math.PI * u);
        const ry = 3 + hump * 5 + rng() * 2;
        back.push([x0 + cw * (0.1 + 0.75 * u), yb - 7 - hump * 7 - rng() * 3, ry * 1.7, ry, yb - 4, false]);
      }
      cloud(tn, back, true, 2);
      // front body: big top bumps, flat-ish lumpy bottom
      const body = [];
      const n = Math.max(4, Math.round(cw / 12));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const hump = Math.sin(Math.PI * Math.pow(u, 0.8));
        const ry = 3 + hump * 7 + rng() * 2.5;
        body.push([x0 + u * cw + (rng() - 0.5) * 5, yb - ry * 0.55 - rng() * 2, ry * (1.3 + rng() * 0.5), ry, yb + (rng() < 0.3 ? 2 : 0), rng() < 0.4]);
      }
      cloud(tn, body, true, 3);
      // a trailing streak beside the clump
      const sx = x0 + (rng() < 0.5 ? cw * 0.8 : -cw * 0.15) + rng() * 8;
      cloud(tn, [[sx, yb + 1, 14 + rng() * 12, 2, yb + 1, false]], true, 1);
    }
    tidy(tn, 2);
    return tn;
  }

  function genFar(rng, w, h) {
    const tn = new Tones(w, h);
    // three rows of long, flat stratus banks, back to front
    const rows = [
      // [y (tile-local), ry range, rx range, count]
      [10, [1.5, 2.5], [14, 30], 6],
      [24, [2.5, 4], [22, 40], 7],
      [34, [3, 5], [26, 46], 6],
    ];
    for (const r of rows) {
      for (let i = 0; i < r[3]; i++) {
        const cx = (i + rng() * 0.7) * (w / r[3]);
        const ry = r[1][0] + rng() * (r[1][1] - r[1][0]);
        const rx = r[2][0] + rng() * (r[2][1] - r[2][0]);
        const base = Math.round(r[0] + rng() * 4);
        const bank = [[cx, base - ry * 0.4, rx, ry, base, false]];
        // a few lumps on top of the bigger banks
        if (ry > 2.6) {
          const nl = 1 + Math.floor(rng() * 3);
          for (let j = 0; j < nl; j++) {
            const lr = ry * (0.7 + rng() * 0.6);
            bank.push([cx + (rng() - 0.5) * rx, base - ry * 0.6 - lr * 0.5, lr * (1.6 + rng()), lr, base, true]);
          }
        }
        cloud(tn, bank, true, 2);
      }
    }
    tidy(tn, 2);
    return tn;
  }

  // moonlit variants: [shadow, base, light, rim] mixed toward moon colours
  const LIT_K = [
    [0.05, 0.09, 0.16, 0.32],
    [0.1, 0.17, 0.3, 0.55],
    [0.2, 0.3, 0.48, 0.8],
  ];
  // moonlight region (screen space) + dithered radial masks for 3 levels
  const MR = { x: MOON.x - 72, y: 0, w: 144, h: MOON.y + 72 };
  const LIT_R = [
    [64, 10],
    [40, 7],
    [22, 4],
  ];
  // lightning region (center chosen at init where a horizon bank sits)
  const FLASH = { x: 0, y: 64, w: 120, h: 96, cx: 90, cy: 112, t0: 0.62 };
  const FLASH_K = [
    [0.16, 0.24, 0.34, 0.5],
    [0.28, 0.4, 0.52, 0.68],
    [0.42, 0.55, 0.68, 0.82],
  ];
  const FLASH_COL = mix(P.night[9], P.violet[6], 0.35);

  function radialMask(w, h, cx, cy, R, soft) {
    const im = new Img(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = (y - cy) * 1.15;
        const d = Math.sqrt(dx * dx + dy * dy) + (HD.bayer(x, y) - 0.5) * soft;
        if (d < R) im.set(x, y, '#ffffff');
      }
    return im.canvas();
  }

  let tmp = null;
  let tctx = null;
  /** draw `tile` (scrolled by off) through `mask` into region R of the main buffer */
  function masked(ctx, tile, Ly, off, R, mask) {
    if (Ly.y + Ly.h <= R.y || Ly.y >= R.y + R.h) return;
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, R.w, R.h);
    let sx = (((off - R.x) % Ly.w) + Ly.w) % Ly.w;
    if (sx > 0) sx -= Ly.w;
    for (; sx < R.w; sx += Ly.w) tctx.drawImage(tile, sx, Ly.y - R.y);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(mask, 0, 0);
    tctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tmp, 0, 0, R.w, R.h, R.x, R.y, R.w, R.h);
  }
  const layerOff = (t, Ly) => Math.floor(T.phase(t, HD.LOOP / Ly.k) * Ly.w);

  function drawLayer(g, t, Ly) {
    const ctx = g.ctx;
    const off = layerOff(t, Ly);
    for (let x = off - Ly.w; x < W; x += Ly.w) ctx.drawImage(Ly.cv, x, Ly.y);
    for (let i = 0; i < 3; i++) masked(ctx, Ly.lit[i], Ly, off, MR, Ly.litMask[i]);
  }

  /** lightning envelope 0..3 at time t (0 when idle) */
  function flashLevel(t) {
    if (!HD.flag('lightning', true)) return 0;
    const s = (T.phase(t, HD.LOOP) - FLASH.t0) * HD.LOOP;
    if (s < 0 || s > 0.62) return 0;
    const pulse = (at, amp, dur) => {
      const u = s - at;
      if (u < 0) return 0;
      return amp * Math.exp(-u / dur);
    };
    const v = Math.max(pulse(0, 1, 0.05), pulse(0.15, 0.55, 0.04), pulse(0.31, 0.85, 0.09));
    return v > 0.62 ? 3 : v > 0.3 ? 2 : v > 0.1 ? 1 : 0;
  }

  // ------------------------------------------------------------------
  // Distant landscape (baked)
  // ------------------------------------------------------------------
  const HILL_A = mix(P.night[4], P.violet[3], 0.4);
  const HILL_B = mix(P.night[3], P.violet[2], 0.4);
  const PINE = mix(P.night[2], P.violet[1], 0.3);
  const CHAPEL = mix(HILL_B, PINE, 0.35);
  const CHAPEL_WIN = { x: 67, y: 133 };
  const COTTAGES = [];
  const LAND_Y = 108;

  function bakeLand(rng) {
    const im = new Img(W, 210 - LAND_Y);
    const ph = [];
    for (let i = 0; i < 9; i++) ph.push(rng() * 6.283);
    const gauss = (x, c, s) => Math.exp(-((x - c) / s) * ((x - c) / s));
    const yA = (x) => {
      let y = 156 + 5 * Math.sin(x / 41 + ph[0]) + 2.6 * Math.sin(x / 15 + ph[1]) + 1.2 * Math.sin(x / 6.7 + ph[2]);
      y -= 24 * gauss(x, 64, 42) + 9 * gauss(x, 318, 46) + 6 * gauss(x, 470, 30);
      if (x > 40 && x < 96) y = Math.min(y, 139 + Math.abs(x - 64) * 0.06);
      return y;
    };
    const yB = (x) => 171 + 4 * Math.sin(x / 31 + ph[3]) + 2.2 * Math.sin(x / 12 + ph[4]) - 7 * gauss(x, 150, 42) - 6 * gauss(x, 438, 46) + 4 * gauss(x, 60, 30);
    const yC = (x) => 191 + 2.5 * Math.sin(x / 23 + ph[5]) + 1.2 * Math.sin(x / 8.5 + ph[6]);
    const S = (x, y, c) => im.set(x, y - LAND_Y, c);
    const rimA = mix(HILL_A, P.moon[0], 0.14);
    const hazeA = mix(HILL_A, P.violet[4], 0.4);
    const rimB = mix(HILL_B, P.moon[0], 0.12);
    const hazeB = mix(HILL_B, HILL_A, 0.6);
    // far hazy hills
    for (let x = 0; x < W; x++) {
      const top = Math.round(yA(x));
      const bTop = Math.round(yB(x));
      for (let y = top; y < 210; y++) {
        let c = HILL_A;
        // mist settles at the foot of the far hills
        const f = (y - (bTop - 7)) / 8;
        if (f > 0 && HD.bayer(x, y) < f * 0.6) c = hazeA;
        S(x, y, c);
      }
      if (x > 250 || HD.bayer(x, 0) < 0.5) S(x, top, rimA);
    }
    // the chapel on the left hill: a dark silhouette, moon-rimmed on the right
    const ch = (x, y) => S(x, y, CHAPEL);
    const base = 140;
    for (let y = 130; y <= base; y++) for (let x = 57; x <= 75; x++) ch(x, y); // nave
    for (let i = 0; i <= 6; i++) for (let x = 56 + i; x <= 76 - i; x++) ch(x, 129 - i); // gable roof
    for (let y = 120; y <= base; y++) for (let x = 49; x <= 56; x++) ch(x, y); // tower
    for (let x = 48; x <= 57; x++) ch(x, 120); // tower cornice
    for (let i = 0; i < 11; i++) {
      const hw = Math.floor((11 - i) / 2.8);
      for (let x = 52 - hw; x <= 53 + hw - (i > 6 ? 1 : 0); x++) ch(x, 119 - i);
    }
    for (let y = 105; y <= 108; y++) ch(52, y); // cross
    ch(51, 106);
    ch(53, 106);
    // a small apse on the far end
    for (let y = 133; y <= base; y++) for (let x = 76; x <= 78; x++) ch(x, y);
    // dark belfry slit
    S(52, 123, PINE);
    S(53, 123, PINE);
    S(52, 124, PINE);
    S(53, 124, PINE);
    // moon rim on the right-facing edges
    const rimCh = mix(CHAPEL, P.moon[0], 0.2);
    for (let i = 1; i <= 6; i++) S(76 - i, 129 - i, rimCh);
    for (let y = 134; y <= 138; y++) S(78, y, rimCh);
    for (let y = 121; y <= 128; y++) S(56, y, rimCh);
    for (let i = 3; i < 9; i++) S(53 + Math.floor((11 - i) / 2.8) - (i > 6 ? 1 : 0), 119 - i, rimCh);
    // graves and a bare far tree beside the chapel
    for (const gx of [82, 86, 44]) {
      S(gx, base - 1, CHAPEL);
      S(gx, base - 2, CHAPEL);
      S(gx + 1, base - 1, CHAPEL);
    }
    for (let y = 128; y <= base; y++) S(91, y, CHAPEL);
    S(90, 131, CHAPEL);
    S(89, 130, CHAPEL);
    S(89, 129, CHAPEL);
    S(92, 132, CHAPEL);
    S(93, 131, CHAPEL);
    S(93, 130, CHAPEL);
    S(94, 129, CHAPEL);
    S(91, 127, CHAPEL);
    S(90, 135, CHAPEL);
    // faint warm spill beside the window (static); the window itself is drawn per frame
    S(CHAPEL_WIN.x - 1, CHAPEL_WIN.y + 1, mix(CHAPEL, P.amber[2], 0.25));
    S(CHAPEL_WIN.x + 1, CHAPEL_WIN.y + 1, mix(CHAPEL, P.amber[2], 0.25));
    // nearer, darker hills
    for (let x = 0; x < W; x++) {
      const top = Math.round(yB(x));
      const cTop = Math.round(yC(x));
      for (let y = top; y < 210; y++) {
        let c = HILL_B;
        const f = (y - (cTop - 12)) / 10;
        if (f > 0 && HD.bayer(x + 2, y) < f * 0.45) c = hazeB;
        S(x, y, c);
      }
      if (x > 300 && HD.bayer(x, 1) < 0.75) S(x, top, rimB);
    }
    // far cottage lights sit in the dark hills
    COTTAGES.length = 0;
    for (const cx of [134, 452]) COTTAGES.push({ x: cx, y: Math.round(yB(cx)) + 4 });
    for (const c of COTTAGES) {
      S(c.x - 1, c.y - 1, mix(HILL_B, P.stone[2], 0.6));
      S(c.x, c.y - 1, mix(HILL_B, P.stone[2], 0.6));
      S(c.x + 1, c.y, mix(HILL_B, P.stone[2], 0.4));
    }
    // pine line: clumps of tiered pines with varied heights and a few gaps
    const rimC = mix(PINE, P.moon[0], 0.12);
    for (let x = 0; x < W; x++) for (let y = Math.round(yC(x)); y < 210; y++) S(x, y, PINE);
    let x = -6;
    while (x < W + 6) {
      const dens = Math.sin(x / 37 + ph[7]) + 0.6 * Math.sin(x / 13 + ph[8]);
      if (dens < -0.9) {
        x += 6 + Math.round(rng() * 6);
        continue;
      }
      const h = Math.round(5 + rng() * 7 + Math.max(0, dens) * 5);
      const hw = Math.max(2, Math.round(h * 0.3));
      const b = Math.round(yC(x)) + 1;
      for (let r = 0; r <= h; r++) {
        const tier = Math.floor(r / 3);
        const half = r < 2 ? 0 : Math.min(hw, Math.floor(tier * 0.75 + (r % 3) * 0.55));
        const y = b - h + r;
        for (let xx = x - half; xx <= x + half; xx++) S(xx, y, PINE);
        if (x > 300 && r > 1 && r % 3 !== 0 && half > 0) S(x + half, y, rimC);
      }
      x += 3 + Math.round(rng() * 4);
    }
    return im.canvas();
  }

  // ------------------------------------------------------------------
  // Bats
  // ------------------------------------------------------------------
  const BAT_FRAMES = [
    ['x.....x', '.x...x.', '..xxx..', '...x...', '.......'],
    ['.......', '..x.x..', 'xxxxxxx', '...x...', '.......'],
    ['.......', '...x...', '..xxx..', '.x...x.', 'x.....x'],
  ];
  const BAT_SEQ = [0, 1, 2, 1];
  let batSprites = null;
  const BAT_PERIOD = 80;
  const BAT_FLIGHT = 11; // seconds the pair is on screen
  const BAT_PATHS = [
    // right edge, up past the moon, out through the top
    [500, 104, 250, -14],
    // down from the top, across the moon, out the right edge
    [300, -12, 496, 92],
  ];

  function drawBats(g, t) {
    const c = T.cycle(t, 0, BAT_PERIOD, 9103);
    const s = c.age * c.P;
    if (s > BAT_FLIGHT + 1) return;
    const path = BAT_PATHS[c.rnd(1) < 0.6 ? 0 : 1];
    const lift = (c.rnd(2) - 0.5) * 14;
    const fr = Math.round(T.step(t, 10) * 10);
    for (let b = 0; b < 2; b++) {
      const sb = s - b * 0.7;
      if (sb < 0) continue;
      const u = sb / BAT_FLIGHT;
      if (u > 1) continue;
      let x = path[0] + (path[2] - path[0]) * u + b * 7;
      let y = path[1] + (path[3] - path[1]) * u + lift + b * 5;
      y += 4 * Math.sin(u * 6.283 * 2.5 + b * 1.7) + 1.5 * Math.sin(u * 6.283 * 9 + b);
      const f = BAT_SEQ[(fr + b * 2) & 3];
      g.sprite(batSprites[f], Math.round(x) - 3, Math.round(y) - 2);
    }
  }

  // ------------------------------------------------------------------
  // module
  // ------------------------------------------------------------------
  let skyCv = null;
  let landCv = null;
  let flashTiles = null;
  let flashMasks = null;

  HD.module('bg', {
    init() {
      const rng = HD.rng(7331);
      skyCv = bakeSky();
      const litMasks = LIT_R.map((r) => radialMask(MR.w, MR.h, MOON.x - MR.x, MOON.y - MR.y, r[0], r[1]));
      for (const Ly of LAYERS) {
        Ly.tn = Ly.gen(HD.rng(Math.floor(rng() * 1e9)), Ly.w, Ly.h);
        Ly.cv = tonesToCanvas(Ly.tn, Ly.pal);
        Ly.lit = LIT_K.map((ks, i) => {
          const tgt = i < 2 ? P.moon[0] : P.moon[1];
          const pal = shade(Ly.pal, tgt, ks);
          pal[3] = mix(Ly.pal[3], i === 0 ? P.moon[0] : i === 1 ? P.moon[1] : P.moon[2], ks[3]);
          return tonesToCanvas(Ly.tn, pal);
        });
        Ly.litMask = litMasks;
      }
      tmp = HD.canvas(Math.max(MR.w, FLASH.w), Math.max(MR.h, FLASH.h), true);
      tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = false;

      // lightning: light the horizon bank that sits on the left at flash time
      const far = LAYERS[0];
      const off = layerOff(FLASH.t0 * HD.LOOP, far);
      let best = -1;
      for (let cx = 50; cx <= 140; cx += 2) {
        let n = 0;
        for (let x = cx - 26; x <= cx + 26; x++) for (let y = 14; y < 42; y++) if (far.tn.get(x - off, y)) n++;
        if (n > best) {
          best = n;
          FLASH.cx = cx;
        }
      }
      FLASH.x = FLASH.cx - (FLASH.w >> 1);
      flashTiles = FLASH_K.map((ks) => tonesToCanvas(far.tn, shade(far.pal, FLASH_COL, ks)));
      flashMasks = [radialMask(FLASH.w, FLASH.h, FLASH.cx - FLASH.x, FLASH.cy - FLASH.y, 50, 18), radialMask(FLASH.w, FLASH.h, FLASH.cx - FLASH.x, FLASH.cy - FLASH.y, 26, 10)];

      landCv = bakeLand(HD.rng(4242));
      const batCol = P.night[0];
      batSprites = BAT_FRAMES.map((rows) => HD.sprite(rows, { x: batCol }));
    },
    passes: [
      {
        layer: 'bg',
        z: 0,
        id: 'sky',
        draw(g) {
          g.ctx.drawImage(skyCv, 0, 0);
        },
      },
      { layer: 'bg', z: 3, id: 'clouds-far', draw: (g, t) => drawLayer(g, t, LAYERS[0]) },
      { layer: 'bg', z: 5, id: 'clouds-mid', draw: (g, t) => drawLayer(g, t, LAYERS[1]) },
      { layer: 'bg', z: 7, id: 'clouds-near', draw: (g, t) => drawLayer(g, t, LAYERS[2]) },
      {
        layer: 'bg',
        z: 8,
        id: 'lightning',
        draw(g, t) {
          const lv = flashLevel(t);
          if (!lv) return;
          const far = LAYERS[0];
          const off = layerOff(t, far);
          masked(g.ctx, flashTiles[Math.max(0, lv - 2)], far, off, FLASH, flashMasks[0]);
          masked(g.ctx, flashTiles[lv - 1], far, off, FLASH, flashMasks[1]);
        },
      },
      {
        layer: 'bg',
        z: 10,
        id: 'land',
        draw(g, t) {
          g.ctx.drawImage(landCv, 0, LAND_Y);
          // chapel window: one tiny warm pane, breathing very slowly
          const v = T.noise(t, 9, 77);
          const wc = v > 0.62 ? P.amber[5] : v > 0.3 ? P.amber[4] : P.amber[3];
          g.px(CHAPEL_WIN.x, CHAPEL_WIN.y, wc);
          g.px(CHAPEL_WIN.x, CHAPEL_WIN.y + 1, P.amber[3]);
          for (let i = 0; i < COTTAGES.length; i++) {
            const c = COTTAGES[i];
            const k = T.noise(t, 13, 91 + i);
            g.px(c.x, c.y, k > 0.5 ? P.amber[4] : P.amber[3]);
          }
        },
      },
      { layer: 'bg', z: 18, id: 'bats', draw: drawBats },
    ],
  });
})();
