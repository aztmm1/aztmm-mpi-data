/*
 * Atmosphere — chimney & campfire smoke, drifting ground mist, vignette.
 *
 *   bg  z 26  distant mist bands along the hill bases (two parallax tiles)
 *   fx  z 15  thin low ground mist (warmed by nearby light, chunk-sampled)
 *   fx  z 31  campfire smoke wisps (warm at the bottom, cooling as they rise)
 *   fx  z 32  chimney smoke column (cold, moonlit upper-right, warm if lit)
 *   fx  z 61  faint foreground wisps near the diorama lip
 *   fx  z 95  static dithered vignette (baked once, single blit)
 *
 * Everything is a pure function of t: smoke puffs are stateless loop-snapped
 * particle lives, mist tiles scroll a whole number of tile widths per loop.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const LY = HD.layout;
  const W = HD.W;
  const H = HD.H;
  const TAU = Math.PI * 2;
  const mix = HD.color.mix;
  const hex = HD.color.hex;
  const css = HD.color.css;

  const CH = LY.house.chimney;
  const CF = LY.campfire;
  const WIND = LY.wind.smokeDrift;

  // ---------------------------------------------------------------------
  // light helpers: a handful of precomputed warm-lit variants per colour
  // ---------------------------------------------------------------------
  const AMB = HD.AMBIENT || [0.34, 0.38, 0.52];
  const FIRE = HD.LIGHT.fire;
  const LEVEL_L = [0, 0.22, 0.45, 0.8];
  function relit(c, L) {
    const a = hex(c);
    return css(a[0] * (1 + (FIRE[0] * L) / AMB[0]), a[1] * (1 + (FIRE[1] * L) / AMB[1]), a[2] * (1 + (FIRE[2] * L) / AMB[2]));
  }
  const litSet = (c) => LEVEL_L.map((L) => relit(c, L));
  function level(x, y) {
    const l = HD.lights.lum(x, y);
    return l < 0.07 ? 0 : l < 0.2 ? 1 : l < 0.42 ? 2 : 3;
  }

  // ---------------------------------------------------------------------
  // smoke
  // ---------------------------------------------------------------------
  const CHIM = {
    n: 30,
    life: 14,
    seed: 401,
    sx: (CH.x0 + CH.x1) / 2 + 1,
    sy: CH.top - 2,
  };
  const CAMP = {
    n: 24,
    life: 8,
    seed: 433,
    sx: CF.x,
    sy: CF.base - 30,
  };
  // tones (cold, light -> dark) each with warm-lit variants per light level
  let chimTone, campTone;

  // order puffs oldest -> youngest so younger (lower) smoke sits in front
  function puffs(sys, t, fn) {
    const n = T.cyclesFor(sys.life);
    const Pd = HD.LOOP / n;
    const N = sys.n;
    const u0 = (t * n) / HD.LOOP;
    const f0 = u0 - Math.floor(u0);
    const oldest = (Math.ceil(N * (1 - f0)) - 1 + N) % N;
    for (let k = 0; k < N; k++) {
      const i = (oldest - k + N) % N;
      const u = u0 + i / N;
      const fl = Math.floor(u);
      const a = u - fl;
      const c = ((fl % n) + n) % n;
      fn(i, a, c, Pd);
    }
  }

  function drawChimney(g, t) {
    const S = CHIM;
    puffs(S, t, (i, a, c, Pd) => {
      const r1 = HD.hash(S.seed, i, c, 1);
      const r2 = HD.hash(S.seed, i, c, 2);
      const r3 = HD.hash(S.seed, i, c, 3);
      const kx = (HD.hash(S.seed, i, c, 4) * 8) | 0;
      const ky = (HD.hash(S.seed, i, c, 5) * 8) | 0;
      const te = t - a * Pd; // emission time: puffs born in a gust drift further
      const gust = (T.noise(te, 21, 77) - 0.5) * 18;
      const rise = (58 + 10 * r1) * (1 - Math.pow(1 - a, 1.6));
      const drift = (WIND * Pd * 0.75 + gust) * Math.pow(a, 1.55);
      const curl = 1.6 * a * Math.sin(TAU * (a * 1.2 + r2));
      const x = S.sx + drift + curl;
      const y = S.sy - rise;
      const rad = 2.2 + 6.8 * Math.pow(a, 0.7) * (0.85 + 0.3 * r3);
      const lv = Math.min(1, a / 0.04) * Math.pow(1 - a, 1.05);
      if (lv <= 0.02) return;
      const xi = Math.round(x);
      const yi = Math.round(y);
      const ox = kx - xi;
      const oy = ky - yi;
      const L = level(xi, yi);
      // tone by age (banded, jittered per puff): light grey -> sky-ish blue
      const aj = a + (r3 - 0.5) * 0.12;
      const tone = aj < 0.22 ? 1 : aj < 0.5 ? 2 : 3;
      g.ditherCircle(xi, yi, rad, chimTone[tone][L], lv * 1.5, 0.9, ox, oy);
      // moon-facing highlight on the upper right
      const hr = rad * 0.55;
      if (tone < 3 && hr >= 1.2) {
        const hx = xi + Math.round(rad * 0.3);
        const hy = yi - Math.round(rad * 0.3);
        g.ditherCircle(hx, hy, hr, chimTone[tone - 1][L], lv * 1.25, 0.95, ox, oy);
      }
    });
  }

  function drawCamp(g, t) {
    const S = CAMP;
    puffs(S, t, (i, a, c, Pd) => {
      const r1 = HD.hash(S.seed, i, c, 1);
      const r2 = HD.hash(S.seed, i, c, 2);
      const r3 = HD.hash(S.seed, i, c, 3);
      const kx = (HD.hash(S.seed, i, c, 4) * 8) | 0;
      const ky = (HD.hash(S.seed, i, c, 5) * 8) | 0;
      const te = t - a * Pd;
      const gust = (T.noise(te, 13, 91) - 0.5) * 12;
      const rise = (82 + 8 * r1) * Math.pow(a, 0.88);
      const drift = (WIND * Pd * 0.8 + gust) * Math.pow(a, 1.5);
      const curl = 2.6 * Math.sqrt(a) * Math.sin(TAU * (a * 1.5 + T.noise(te, 6, 92) * 0.6));
      const x = S.sx + (r2 - 0.5) * 4 * (1 - a) + drift + curl;
      const y = S.sy - rise;
      const rad = 1.4 + 3.4 * a;
      const lv = Math.min(1, a / 0.1) * Math.pow(1 - a, 1.25);
      if (lv <= 0.02) return;
      const xi = Math.round(x);
      const yi = Math.round(y);
      const ox = kx - xi;
      const oy = ky - yi;
      const L = level(xi, yi);
      const aj = a + (r3 - 0.5) * 0.1;
      const tone = aj < 0.35 ? 1 : 2;
      g.ditherCircle(xi, yi, rad, campTone[tone][L], lv * 1.15, 0.9, ox, oy);
      if (rad > 2.2 && tone === 1) g.ditherCircle(xi + 1, yi - 1, rad * 0.5, campTone[0][L], lv, 0.9, ox, oy);
    });
  }

  // ---------------------------------------------------------------------
  // mist: baked tileable textures, scrolled whole tiles per loop
  // ---------------------------------------------------------------------
  // periodic 1D noise over a tile: sum of integer-frequency sines
  function pnoise(tw, seed, terms) {
    const rng = HD.rng(seed);
    const comps = [];
    let norm = 0;
    for (let k = 0; k < terms.length; k++) {
      const amp = terms[k][1];
      comps.push([terms[k][0], amp, rng()]);
      norm += amp;
    }
    const out = new Float32Array(tw);
    for (let x = 0; x < tw; x++) {
      let s = 0;
      for (const [f, amp, ph] of comps) s += amp * Math.sin(TAU * ((f * x) / tw + ph));
      out[x] = 0.5 + (0.5 * s) / norm; // 0..1
    }
    return out;
  }

  /**
   * Bake one texture per light level: a pixel gets colour cols[1] where the
   * dither passes `d - core`, cols[0] where it passes `d`.
   */
  function bakeTile(tw, h, dens, cols, levels) {
    const out = [];
    const sets = cols.map((c) => (levels ? litSet(c) : [c]));
    const nv = levels ? LEVEL_L.length : 1;
    for (let v = 0; v < nv; v++) {
      out.push(
        HD.bake(tw, h, (g) => {
          for (let y = 0; y < h; y++)
            for (let x = 0; x < tw; x++) {
              const d = dens(x, y);
              if (d <= 0) continue;
              const b = HD.bayer(x, y);
              if (b < d - 0.3) g.px(x, y, sets[1][v]);
              else if (b < d) g.px(x, y, sets[0][v]);
            }
        }),
      );
    }
    return out;
  }

  const BANDS = [];
  function makeBand(o) {
    BANDS.push(o);
    return o;
  }

  function drawBand(g, B, t) {
    const tw = B.tw;
    const off = Math.floor(T.phase(t, HD.LOOP / B.k) * tw);
    const CW = 8;
    let x = 0;
    let lv = B.tex.length > 1 ? level(x + 4, B.ly) : 0;
    while (x < W) {
      let x1 = x + CW;
      let nl = lv;
      while (x1 < W) {
        nl = B.tex.length > 1 ? level(x1 + 4, B.ly) : 0;
        if (nl !== lv) break;
        x1 += CW;
      }
      if (x1 > W) x1 = W;
      const img = B.tex[lv];
      let s = (((x - off) % tw) + tw) % tw;
      let w = x1 - x;
      let dx = x;
      while (w > 0) {
        const part = Math.min(w, tw - s);
        g.blit(img, s, 0, part, B.h, dx, B.y0);
        dx += part;
        w -= part;
        s = 0;
      }
      x = x1;
      lv = nl;
    }
  }

  // ---------------------------------------------------------------------
  // vignette (baked once)
  // ---------------------------------------------------------------------
  let vignette = null;
  function bakeVignette() {
    const c = HD.canvas(W, H, true);
    const cx = c.getContext('2d');
    const im = cx.createImageData(W, H);
    const d = im.data;
    const k0 = hex(P.night[0]);
    const k1 = hex(P.night[1]);
    const sm = HD.smoothstep;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const nx = (x + 0.5 - W / 2) / (W / 2);
        const ny = (y + 0.5 - H / 2) / (H / 2);
        const ax = Math.abs(nx);
        const ay = Math.abs(ny);
        // rounded-rectangle-ish distance so the frame hugs the edges
        const v = Math.pow(Math.pow(ax, 4) + Math.pow(ay, 4), 0.25) * 0.6 + Math.sqrt(nx * nx + ny * ny) * 0.4;
        let dens = sm(0.78, 1.32, v) * 0.62;
        if (ny > 0) dens += 0.16 * sm(0.3, 1, ny) * sm(0.45, 1, ax);
        if (dens <= 0) continue;
        const b = HD.bayer(x, y);
        let col = null;
        if (b < dens) col = k0;
        else if (b < dens * 1.6) col = k1;
        if (!col) continue;
        const q = (y * W + x) * 4;
        d[q] = col[0];
        d[q + 1] = col[1];
        d[q + 2] = col[2];
        d[q + 3] = 255;
      }
    cx.putImageData(im, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------------
  HD.module('atmosphere', {
    init() {
      // smoke colours: cold slate/blue, warm-lit variants per light level
      chimTone = [
        litSet(mix(P.stone[6], P.moon[0], 0.3)),
        litSet(mix(P.stone[5], P.night[7], 0.3)),
        litSet(mix(P.stone[4], P.night[6], 0.4)),
        litSet(mix(P.stone[3], P.night[5], 0.5)),
      ];
      campTone = [
        litSet(mix(P.stone[5], P.night[7], 0.3)),
        litSet(mix(P.stone[4], P.wood[6], 0.35)),
        litSet(mix(P.stone[3], P.night[6], 0.45)),
      ];

      // --- distant mist along the hill bases (bg z 26), two parallax layers
      {
        const tw = 240;
        const y0 = 178;
        const h = 34;
        const yc = pnoise(tw, 11, [[1, 1], [3, 0.6], [5, 0.3]]);
        const th = pnoise(tw, 12, [[2, 1], [4, 0.6], [7, 0.3]]);
        const am = pnoise(tw, 13, [[1, 0.7], [2, 1], [5, 0.5], [9, 0.25]]);
        makeBand({
          id: 'far',
          tw,
          y0,
          h,
          k: 1,
          layer: 'bg',
          tex: bakeTile(
            tw,
            h,
            (x, y) => {
              const c = 18 + (yc[x] - 0.5) * 8;
              const s = 5 + th[x] * 5;
              const q = (y - c) / s;
              return 0.62 * Math.exp(-q * q) * (0.35 + 0.65 * am[x]);
            },
            [mix(P.night[5], P.stone[4], 0.35), mix(P.night[6], P.stone[5], 0.35)],
            false,
          ),
        });
      }
      {
        const tw = 160;
        const y0 = 186;
        const h = 22;
        const yc = pnoise(tw, 21, [[1, 1], [2, 0.5], [5, 0.3]]);
        const am = pnoise(tw, 23, [[1, 1], [3, 0.7], [6, 0.4]]);
        makeBand({
          id: 'far2',
          tw,
          y0,
          h,
          k: 1,
          layer: 'bg',
          tex: bakeTile(
            tw,
            h,
            (x, y) => {
              const c = 12 + (yc[x] - 0.5) * 6;
              const q = (y - c) / 4.5;
              return 0.4 * Math.exp(-q * q) * Math.max(0, am[x] * 1.4 - 0.3);
            },
            [mix(P.night[6], P.stone[5], 0.3), mix(P.night[7], P.stone[6], 0.3)],
            false,
          ),
        });
      }

      // --- thin low ground mist (fx z 15): sparse, never hides props
      {
        const tw = 480;
        const y0 = 196;
        const h = 22;
        const yc = pnoise(tw, 31, [[2, 1], [5, 0.6], [11, 0.3]]);
        const am = pnoise(tw, 33, [[1, 0.6], [3, 1], [7, 0.6], [13, 0.3]]);
        makeBand({
          id: 'ground',
          tw,
          y0,
          h,
          k: 1,
          ly: 206,
          layer: 'fx',
          tex: bakeTile(
            tw,
            h,
            (x, y) => {
              const c = 9 + (yc[x] - 0.5) * 6;
              const q = (y - c) / 4;
              return 0.3 * Math.exp(-q * q) * Math.max(0, am[x] * 1.5 - 0.45);
            },
            [mix(P.night[6], P.stone[5], 0.3), mix(P.night[7], P.stone[6], 0.3)],
            true,
          ),
        });
      }

      // --- foreground wisps near the lip (fx z 61)
      {
        const tw = 720;
        const y0 = 220;
        const h = 28;
        const rng = HD.rng(41);
        const blobs = [];
        for (let k = 0; k < 5; k++)
          blobs.push({ x: (k + 0.2 + rng() * 0.6) * (tw / 5), y: 9 + rng() * 10, rx: 26 + rng() * 34, ry: 2.2 + rng() * 2, a: 0.22 + rng() * 0.14 });
        const tilt = pnoise(tw, 43, [[3, 1], [7, 0.5]]);
        makeBand({
          id: 'front',
          tw,
          y0,
          h,
          k: 1,
          ly: 230,
          layer: 'fx',
          tex: bakeTile(
            tw,
            h,
            (x, y) => {
              let d = 0;
              for (const b of blobs) {
                let dx = x - b.x;
                dx -= tw * Math.round(dx / tw);
                const qx = dx / b.rx;
                const qy = (y - b.y - (tilt[x] - 0.5) * 3) / b.ry;
                const e = qx * qx + qy * qy;
                if (e < 1.6) d += b.a * Math.exp(-1.8 * e);
              }
              return d;
            },
            [mix(P.night[7], P.stone[6], 0.3), mix(P.night[8], P.stone[7], 0.3)],
            true,
          ),
        });
      }

      vignette = bakeVignette();
    },

    passes: [
      {
        layer: 'bg',
        z: 26,
        id: 'far-mist',
        draw(g, t) {
          drawBand(g, BANDS[0], t);
          drawBand(g, BANDS[1], t);
        },
      },
      {
        layer: 'fx',
        z: 15,
        id: 'ground-mist',
        draw(g, t) {
          drawBand(g, BANDS[2], t);
        },
      },
      {
        layer: 'fx',
        z: 31,
        id: 'campfire-smoke',
        draw: drawCamp,
      },
      {
        layer: 'fx',
        z: 32,
        id: 'chimney-smoke',
        draw: drawChimney,
      },
      {
        layer: 'fx',
        z: 61,
        id: 'front-mist',
        draw(g, t) {
          drawBand(g, BANDS[3], t);
        },
      },
      {
        layer: 'fx',
        z: 95,
        id: 'vignette',
        draw(g) {
          g.sprite(vignette, 0, 0);
        },
      },
    ],
  });
})();
