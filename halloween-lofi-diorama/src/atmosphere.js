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
  const litSet = (c, levels) => (levels || LEVEL_L).map((L) => relit(c, L));
  // smoke catches light more softly than mist (it would turn ember-orange)
  const SMOKE_L = [0, 0.1, 0.2, 0.34];
  function level(x, y, boost) {
    const l = boost ? HD.lights.lum(x, y) * boost : HD.lights.lum(x, y);
    return l < 0.07 ? 0 : l < 0.2 ? 1 : l < 0.42 ? 2 : 3;
  }

  // ---------------------------------------------------------------------
  // smoke
  // ---------------------------------------------------------------------
  // Smoke styles. These are the Halloween values; seasonal editions derive
  // their own styles from them (atmosphere-seasons.js) via HD.atmo.
  const CHIM = {
    n: 30,
    life: 14,
    seed: 401,
    sx: (CH.x0 + CH.x1) / 2 + 1,
    sy: CH.top - 1,
    rise: 58,
    riseR: 10,
    driftK: 0.75,
    gust: 18,
    curl: 2.2,
    rad0: 2.4,
    radK: 7.2,
    lvK: 1.5,
    hlK: 1.25,
    tone: null, // 5 tones (light -> dark) x warm-lit variants, set in init
  };
  const CAMP = {
    n: 40,
    life: 8,
    seed: 433,
    sx: CF.x,
    sy: CF.base - 33,
    rise: 82,
    riseR: 8,
    driftK: 0.8,
    gust: 12,
    spread: 2,
    curl: 2.6,
    rad0: 0.7,
    radK: 5.2,
    lvK: 1.7,
    hlK: 1.2,
    tone: null, // 4 tones
  };

  // ---------------------------------------------------------------------
  // smoke raster: puffs are written straight into a pixel buffer (exactly
  // the pixels g.ditherCircle would fill, in the same order) and composited
  // with a single drawImage of the touched rectangle. Thousands of 1px
  // fillRect calls per frame become plain array writes.
  // ---------------------------------------------------------------------
  const SR = { cv: null, ctx: null, img: null, u32: null, x0: W, y0: H, x1: -1, y1: -1 };
  const c32Cache = new Map();
  function c32(c) {
    let v = c32Cache.get(c);
    if (v === undefined) {
      const a = hex(c);
      v = ((255 << 24) | (a[2] << 16) | (a[1] << 8) | a[0]) >>> 0;
      c32Cache.set(c, v);
    }
    return v;
  }
  function srInit() {
    if (SR.cv) return;
    SR.cv = HD.canvas(W, H, true);
    SR.ctx = SR.cv.getContext('2d');
    SR.img = SR.ctx.createImageData(W, H);
    SR.u32 = new Uint32Array(SR.img.data.buffer);
  }
  /** same pixel set as g.ditherCircle(cx, cy, rad, c, level, soft, ox, oy) */
  function srDisc(cx, cy, rad, c, level, soft, ox, oy) {
    if (level <= 0 || rad <= 0) return;
    cx = Math.round(cx);
    cy = Math.round(cy);
    const sx = ox | 0;
    const sy = oy | 0;
    const sf = soft || 0;
    const col = c32(c);
    const u32 = SR.u32;
    const bayer = HD.bayer;
    const ir = Math.ceil(rad);
    const rr = rad * rad + rad * 0.6;
    const ya = Math.max(0, cy - ir);
    const yb = Math.min(H - 1, cy + ir);
    const xa = Math.max(0, cx - ir);
    const xb = Math.min(W - 1, cx + ir);
    if (ya > yb || xa > xb) return;
    let hit = false;
    for (let py = ya; py <= yb; py++) {
      const dy = py - cy;
      const row = py * W;
      for (let px = xa; px <= xb; px++) {
        const dx = px - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > rr) continue;
        let lv = level;
        if (sf > 0) lv *= 1 - sf * Math.sqrt(d2 / rr);
        if (bayer(px + sx, py + sy) < lv) {
          u32[row + px] = col;
          hit = true;
        }
      }
    }
    if (!hit) return;
    if (xa < SR.x0) SR.x0 = xa;
    if (ya < SR.y0) SR.y0 = ya;
    if (xb > SR.x1) SR.x1 = xb;
    if (yb > SR.y1) SR.y1 = yb;
  }
  // Drawing a canvas that was just written takes a snapshot of its whole
  // backing store, so the touched rectangle goes through a small canvas
  // (pooled by 32px size buckets) instead of the full-frame one.
  const flushPool = new Map();
  function flushCanvas(w, h) {
    const bw = (w + 31) & ~31;
    const bh = (h + 31) & ~31;
    const key = bw * 1024 + bh;
    let c = flushPool.get(key);
    if (!c) {
      const cv = HD.canvas(bw, bh, true);
      c = { cv, ctx: cv.getContext('2d') };
      flushPool.set(key, c);
    }
    return c;
  }
  function srFlush(g) {
    if (SR.x1 < SR.x0) return;
    const w = SR.x1 - SR.x0 + 1;
    const h = SR.y1 - SR.y0 + 1;
    const fc = flushCanvas(w, h);
    fc.ctx.putImageData(SR.img, -SR.x0, -SR.y0, SR.x0, SR.y0, w, h);
    g.ctx.drawImage(fc.cv, 0, 0, w, h, SR.x0, SR.y0, w, h);
    for (let y = SR.y0; y <= SR.y1; y++) SR.u32.fill(0, y * W + SR.x0, y * W + SR.x1 + 1);
    SR.x0 = W;
    SR.y0 = H;
    SR.x1 = -1;
    SR.y1 = -1;
  }

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

  function drawChimney(g, t, St) {
    const S = St || CHIM;
    const chimTone = S.tone;
    puffs(S, t, (i, a, c, Pd) => {
      const r1 = HD.hash(S.seed, i, c, 1);
      const r2 = HD.hash(S.seed, i, c, 2);
      const r3 = HD.hash(S.seed, i, c, 3);
      const kx = (HD.hash(S.seed, i, c, 4) * 8) | 0;
      const ky = (HD.hash(S.seed, i, c, 5) * 8) | 0;
      const te = t - a * Pd; // emission time: puffs born in a gust drift further
      const gust = (T.noise(te, 21, 77) - 0.5) * S.gust;
      const rise = (S.rise + S.riseR * r1) * (1 - Math.pow(1 - a, 1.6));
      const drift = (WIND * Pd * S.driftK + gust) * Math.pow(a, 1.55);
      const curl = S.curl * a * Math.sin(TAU * (a * 1.2 + r2));
      const x = S.sx + drift + curl;
      const y = S.sy - rise;
      const rad = S.rad0 + S.radK * Math.pow(a, 0.7) * (0.85 + 0.3 * r3);
      let lv = Math.min(1, a / 0.04) * Math.pow(1 - a, 0.8);
      if (lv <= 0.02) return;
      if (S.keep) {
        lv *= S.keep(x, y, rad);
        if (lv <= 0.02) return;
      }
      const xi = Math.round(x);
      const yi = Math.round(y);
      const ox = kx - xi;
      const oy = ky - yi;
      const L = level(xi, yi);
      // tone by age (banded, jittered per puff): light grey -> sky-ish blue
      const aj = a + (r3 - 0.5) * 0.12;
      const tone = aj < 0.2 ? 1 : aj < 0.42 ? 2 : aj < 0.68 ? 3 : 4;
      srDisc(xi, yi, rad, chimTone[tone][L], lv * S.lvK, 0.9, ox, oy);
      // moon-facing highlight on the upper right
      const hr = rad * 0.55;
      if (tone < 4 && hr >= 1.2) {
        const hx = xi + Math.round(rad * 0.3);
        const hy = yi - Math.round(rad * 0.3);
        srDisc(hx, hy, hr, chimTone[tone - 1][L], lv * S.hlK, 0.95, ox, oy);
      }
    });
    srFlush(g);
  }

  function drawCamp(g, t, St) {
    const S = St || CAMP;
    const campTone = S.tone;
    puffs(S, t, (i, a, c, Pd) => {
      const r1 = HD.hash(S.seed, i, c, 1);
      const r2 = HD.hash(S.seed, i, c, 2);
      const r3 = HD.hash(S.seed, i, c, 3);
      const kx = (HD.hash(S.seed, i, c, 4) * 8) | 0;
      const ky = (HD.hash(S.seed, i, c, 5) * 8) | 0;
      const te = t - a * Pd;
      const gust = (T.noise(te, 13, 91) - 0.5) * S.gust;
      const rise = (S.rise + S.riseR * r1) * Math.pow(a, 0.88);
      const drift = (WIND * Pd * S.driftK + gust) * Math.pow(a, 1.5);
      const curl = S.curl * Math.sqrt(a) * Math.sin(TAU * (a * 1.5 + T.noise(te, 6, 92) * 0.6));
      const x = S.sx + (r2 - 0.5) * S.spread * (1 - a) + drift + curl;
      const y = S.sy - rise;
      // emerges as a thin solid thread from the flame tips, widens and thins out
      const rad = S.rad0 + S.radK * Math.pow(a, 0.85);
      let lv = Math.min(1, a / 0.02) * Math.min(1, 0.45 + a / 0.1) * Math.pow(1 - a, S.tailK || 0.9);
      if (lv <= 0.02) return;
      if (S.keep) {
        lv *= S.keep(x, y, rad);
        if (lv <= 0.02) return;
      }
      const xi = Math.round(x);
      const yi = Math.round(y);
      const ox = kx - xi;
      const oy = ky - yi;
      const L = level(xi, yi);
      const aj = a + (r3 - 0.5) * 0.1;
      const tone = aj < 0.12 ? 2 : aj < 0.36 ? 1 : aj < 0.64 ? 2 : 3;
      srDisc(xi, yi, rad, campTone[tone][L], lv * S.lvK, 0.88, ox, oy);
      if (rad > 2.2 && tone < 3) srDisc(xi + 1, yi - 1, rad * 0.5, campTone[tone - 1][L], lv * S.hlK, 0.95, ox, oy);
    });
    srFlush(g);
  }

  // ---------------------------------------------------------------------
  // mist: baked tileable textures, scrolled whole tiles per loop
  // ---------------------------------------------------------------------
  // periodic 1D noise over a tile: sum of integer-frequency sines (0..1)
  function pnoise(tw, seed, terms) {
    const rng = HD.rng(seed);
    const comps = [];
    let norm = 0;
    for (const [f, amp] of terms) {
      comps.push([f, amp, rng()]);
      norm += amp;
    }
    const out = new Float32Array(tw);
    for (let x = 0; x < tw; x++) {
      let s = 0;
      for (const [f, amp, ph] of comps) s += amp * Math.sin(TAU * ((f * x) / tw + ph));
      out[x] = 0.5 + (0.5 * s) / norm;
    }
    return out;
  }

  /** opaque RGBA word for a hex colour (little-endian ImageData layout) */
  function rgba32(c) {
    const a = hex(c);
    return ((255 << 24) | (a[2] << 16) | (a[1] << 8) | a[0]) >>> 0;
  }
  /** bake a w x h canvas straight from a Uint32 pixel callback (fast at switch time) */
  function bakePixels(w, h, fill) {
    const c = HD.canvas(w, h, true);
    const cx = c.getContext('2d');
    const im = cx.createImageData(w, h);
    fill(new Uint32Array(im.data.buffer), im);
    cx.putImageData(im, 0, 0);
    return c;
  }

  /**
   * Bake one dithered texture per light level (or a single cold one).
   * Colour cols[1] (core) where bayer < (d - core) * 1.6, cols[0] where bayer < d.
   */
  function bakeTile(tw, h, dens, cols, lit, core, levels) {
    const sets = cols.map((c) => (lit ? litSet(c, levels) : [c]).map(rgba32));
    const nv = lit ? LEVEL_L.length : 1;
    const D = new Float32Array(tw * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < tw; x++) D[y * tw + x] = dens(x, y);
    const out = [];
    for (let v = 0; v < nv; v++) {
      const c0 = sets[0][v];
      const c1 = sets[1][v];
      out.push(
        bakePixels(tw, h, (u32) => {
          for (let y = 0; y < h; y++)
            for (let x = 0; x < tw; x++) {
              const p = y * tw + x;
              const d = D[p];
              if (d <= 0) continue;
              const b = HD.bayer(x, y);
              if (b < (d - core) * 1.6) u32[p] = c1;
              else if (b < d) u32[p] = c0;
            }
        }),
      );
    }
    return out;
  }

  /**
   * screen-space keep-out mask (opaque = erase mist), soft dithered rims.
   * Optional `keeps`: the mist survives only inside these ellipses.
   */
  function bakeMask(y0, h, holes, keeps) {
    const WHITE = 0xffffffff;
    return bakePixels(W, h, (u32) => {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < W; x++) {
          let k = 0;
          for (const o of holes) {
            const qx = (x - o.x) / o.rx;
            const qy = (y + y0 - o.y) / o.ry;
            const e = Math.sqrt(qx * qx + qy * qy);
            k = Math.max(k, 1 - HD.smoothstep(0.75, 1.35, e));
          }
          if (keeps) {
            let kk = 0;
            for (const o of keeps) {
              const qx = (x - o.x) / o.rx;
              const qy = (y + y0 - o.y) / o.ry;
              kk = Math.max(kk, (o.k || 1) * (1 - HD.smoothstep(0.35, 1, Math.sqrt(qx * qx + qy * qy))));
            }
            k = 1 - (1 - k) * kk;
          }
          if (k > 0 && HD.bayer(x, y) < k) u32[y * W + x] = WHITE;
        }
    });
  }

  /** scroll offset of a band at t (whole tile widths per loop) */
  function bandOff(B, t) {
    const tw = B.tw;
    // == floor(phase(t, LOOP / k) * tw + sub), computed so t and t + LOOP round
    // alike; `sub` staggers the 1px steps so the bands never all jump together
    return ((Math.floor((t * B.k * tw) / HD.LOOP + B.sub) % tw) + tw) % tw;
  }

  /** the band's own (w x h) scratch canvas (small canvases snapshot cheaply) */
  function bandScratch(B) {
    if (!B.scr) {
      const cv = HD.canvas(B.w || W, B.h, true);
      const ctx = cv.getContext('2d');
      B.scr = { cv, ctx, g: HD.makeGfx(ctx), off: -1 };
    }
    return B.scr;
  }

  /**
   * Tile the band texture across screen columns [B.x0, B.x0 + B.w) (the whole
   * frame by default) at y = dy on `dst`, shifted left by `sx` (0 when drawing
   * straight to the frame, B.x0 when drawing into the band's scratch canvas).
   */
  function tileBand(dst, B, off, dy, sx) {
    const tw = B.tw;
    const lit = B.tex.length > 1;
    const CW = 8;
    const xa = B.x0 || 0;
    const xe = xa + (B.w || W);
    let x = xa;
    let lv = lit ? level(x + 4, B.ly, B.lb) : 0;
    while (x < xe) {
      let x1 = x + CW;
      let nl = lv;
      while (x1 < xe) {
        nl = lit ? level(x1 + 4, B.ly, B.lb) : 0;
        if (nl !== lv) break;
        x1 += CW;
      }
      if (x1 > xe) x1 = xe;
      const img = B.tex[lv];
      let s = (((x - off) % tw) + tw) % tw;
      let w = x1 - x;
      let dx = x - sx;
      while (w > 0) {
        const part = Math.min(w, tw - s);
        dst.blit(img, s, 0, part, B.h, dx, dy);
        dx += part;
        w -= part;
        s = 0;
      }
      x = x1;
      lv = nl;
    }
  }

  /**
   * Render a masked band (texture minus its keep-out mask, which covers the
   * band's own rectangle) into the band's scratch canvas and return it.
   * Unlit bands only change when the scroll offset steps a pixel, so their
   * result is reused until then (a pure cache keyed by the offset).
   */
  function maskedBand(B, t) {
    const off = bandOff(B, t);
    const S = bandScratch(B);
    const unlit = B.tex.length === 1;
    if (unlit && S.off === off) return S.cv;
    S.ctx.clearRect(0, 0, B.w || W, B.h);
    tileBand(S.g, B, off, 0, B.x0 || 0);
    S.ctx.globalCompositeOperation = 'destination-out';
    S.ctx.drawImage(B.mask, 0, 0);
    S.ctx.globalCompositeOperation = 'source-over';
    S.off = unlit ? off : -1;
    return S.cv;
  }

  function drawBand(g, B, t) {
    const ga = g.ctx.globalAlpha;
    if (B.mask) {
      const cv = maskedBand(B, t);
      g.ctx.globalAlpha = B.alpha || 1;
      g.blit(cv, 0, 0, B.w || W, B.h, B.x0 || 0, B.y0);
    } else {
      g.ctx.globalAlpha = B.alpha || 1;
      tileBand(g, B, bandOff(B, t), B.y0, 0);
    }
    g.ctx.globalAlpha = ga;
  }

  // ---------------------------------------------------------------------
  // vignette (baked once)
  // ---------------------------------------------------------------------
  /**
   * tonal = false: the Halloween vignette, hard near-black ordered dots.
   * tonal = true: same darkening footprint, but each pixel is darkened by a
   * dithered step of 1/16, so bright grounds (snow, meadow) darken as a tone
   * instead of showing a coarse dot screen.
   */
  function bakeVignette(tonal) {
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
        const v = Math.pow(Math.pow(ax, 4) + Math.pow(ay, 4), 0.25) * 0.55 + Math.sqrt(nx * nx + ny * ny) * 0.45;
        let dens = sm(0.86, 1.4, v) * 0.6;
        if (ny > 0) dens += 0.14 * sm(0.4, 1, ny) * sm(0.6, 1, ax);
        if (dens <= 0) continue;
        const b = HD.bayer(x, y);
        const q = (y * W + x) * 4;
        if (tonal) {
          // mean darkening of the dot version at this density
          const dk = (190 / 255) * Math.min(1, dens) + (150 / 255) * Math.max(0, Math.min(1, dens * 1.5) - dens);
          const f = dk * 16;
          const lo = Math.floor(f);
          const lvl = lo + (b < f - lo ? 1 : 0);
          if (lvl <= 0) continue;
          d[q] = k0[0];
          d[q + 1] = k0[1];
          d[q + 2] = k0[2];
          d[q + 3] = Math.round((255 * lvl) / 16);
          continue;
        }
        let col = null;
        if (b < dens) col = k0;
        else if (b < dens * 1.5) col = k1;
        if (!col) continue;
        d[q] = col[0];
        d[q + 1] = col[1];
        d[q + 2] = col[2];
        d[q + 3] = col === k0 ? 190 : 150;
      }
    cx.putImageData(im, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------------
  let FAR = null;
  let FAR2 = null;
  let GROUND = null;
  let FRONT = null;
  let vignette = null;

  // bright grounds get the tonal vignette (same footprint, no dot screen)
  const TONAL_GROUNDS = new Set(['snow', 'thin-snow', 'spring', 'summer']);
  let vignetteTone = null;
  const vignetteFor = HD.perEdition((ed) => {
    if (ed.id === 'halloween' || !TONAL_GROUNDS.has(ed.ground)) return vignette;
    return vignetteTone || (vignetteTone = bakeVignette(true));
  });

  // per-edition recipe (null = Halloween, the original layers above)
  const season = HD.perEdition((ed) => (ed.id === 'halloween' || !HD.atmoSeasons ? null : HD.atmoSeasons.build(ed) || null));

  // helpers shared with atmosphere-seasons.js
  HD.atmo = {
    CHIM,
    CAMP,
    SMOKE_L,
    LEVEL_L,
    relit,
    litSet,
    level,
    puffs,
    pnoise,
    bakeTile,
    bakeMask,
    drawBand,
    drawChimney,
    drawCamp,
    srDisc,
    srFlush,
    bandOff,
    maskedBand,
    bakePixels,
    rgba32,
  };

  HD.module('atmosphere', {
    init() {
      // smoke tones: light (moonlit) -> dark (almost sky), warm-lit variants
      CHIM.tone = [
        litSet(mix(P.stone[6], P.moon[0], 0.3), SMOKE_L),
        litSet(mix(P.stone[5], P.night[7], 0.3), SMOKE_L),
        litSet(mix(P.stone[4], P.night[6], 0.4), SMOKE_L),
        litSet(mix(P.stone[3], P.night[5], 0.5), SMOKE_L),
        litSet(mix(P.night[3], P.stone[2], 0.45), SMOKE_L),
      ];
      CAMP.tone = [
        litSet(mix(P.stone[5], P.night[7], 0.25), SMOKE_L),
        litSet(mix(P.stone[4], P.wood[5], 0.35), SMOKE_L),
        litSet(mix(P.stone[3], P.night[5], 0.45), SMOKE_L),
        litSet(mix(P.night[3], P.stone[2], 0.45), SMOKE_L),
      ];

      srInit();

      // --- distant mist banks along the hill bases (bg z 26)
      {
        const tw = 240;
        const h = 34;
        const yc = pnoise(tw, 11, [[1, 1], [3, 0.6], [5, 0.3]]);
        const th = pnoise(tw, 12, [[2, 1], [4, 0.6], [7, 0.3]]);
        const am = pnoise(tw, 13, [[1, 0.7], [2, 1], [5, 0.5], [9, 0.25]]);
        FAR = {
          tw,
          sub: 0.5,
          y0: 176,
          h,
          k: 1,
          tex: bakeTile(
            tw,
            h,
            (x, y) => {
              const c = 21 + (yc[x] - 0.5) * 8;
              const s = (y < c ? 5 : 3.5) + th[x] * 4;
              const q = (y - c) / s;
              const m = HD.smoothstep(0.15, 0.85, am[x]);
              return 0.95 * Math.exp(-q * q) * (0.25 + 0.75 * m);
            },
            [mix(P.night[5], P.stone[4], 0.35), mix(P.night[6], P.stone[5], 0.4)],
            false,
            0.5,
          ),
          alpha: 0.55,
        };
      }
      {
        const tw = 160;
        const h = 20;
        const yc = pnoise(tw, 21, [[1, 1], [2, 0.5], [5, 0.3]]);
        const am = pnoise(tw, 23, [[1, 1], [3, 0.7], [6, 0.4]]);
        FAR2 = {
          tw,
          sub: 0.23,
          y0: 188,
          h,
          k: 1,
          tex: bakeTile(
            tw,
            h,
            (x, y) => {
              const c = 11 + (yc[x] - 0.5) * 5;
              const q = (y - c) / 3.5;
              return 0.8 * Math.exp(-q * q) * HD.smoothstep(0.35, 0.9, am[x]);
            },
            [mix(P.night[6], P.stone[5], 0.4), mix(P.night[7], P.stone[6], 0.4)],
            false,
            0.45,
          ),
          alpha: 0.45,
        };
      }

      // --- thin low ground mist (fx z 15): sparse, kept off fire and porch
      {
        const tw = 480;
        const y0 = 196;
        const h = 22;
        const yc = pnoise(tw, 31, [[2, 1], [5, 0.6], [11, 0.3]]);
        const am = pnoise(tw, 33, [[1, 0.6], [3, 1], [7, 0.6], [13, 0.3]]);
        GROUND = {
          tw,
          sub: 0.71,
          y0,
          h,
          k: 1,
          ly: 205,
          tex: bakeTile(
            tw,
            h,
            (x, y) => {
              const c = 8 + (yc[x] - 0.5) * 5;
              const q = (y - c) / (y < c ? 3 : 5.5);
              return 0.8 * Math.exp(-q * q) * HD.smoothstep(0.25, 0.85, am[x]);
            },
            [mix(P.night[7], P.stone[6], 0.3), mix(P.night[8], P.stone[7], 0.3)],
            true,
            0.45,
          ),
          alpha: 0.38,
          mask: bakeMask(y0, h, [
            { x: CF.x, y: CF.base - 16, rx: 20, ry: 20 },
            { x: 220, y: 204, rx: 22, ry: 7 },
            { x: 128, y: 220, rx: 12, ry: 8 },
          ]),
        };
      }

      // --- faint foreground wisps creeping over the lip (fx z 61)
      {
        const tw = 720;
        const y0 = 226;
        const h = 24;
        const rng = HD.rng(41);
        const blobs = [];
        for (let k = 0; k < 6; k++)
          blobs.push({ x: (k + 0.15 + rng() * 0.7) * (tw / 6), y: 10 + rng() * 5, rx: 24 + rng() * 30, ry: 3 + rng() * 2.2, a: 0.5 + rng() * 0.25 });
        const tilt = pnoise(tw, 43, [[3, 1], [7, 0.5]]);
        FRONT = {
          tw,
          sub: 0.37,
          y0,
          h,
          k: 1,
          ly: 234,
          tex: bakeTile(
            tw,
            h,
            (x, y) => {
              let d = 0;
              for (const b of blobs) {
                let dx = x - b.x;
                dx -= tw * Math.round(dx / tw);
                const qx = dx / b.rx;
                const qy = (y - b.y - (tilt[x] - 0.5) * 4) / b.ry;
                const e = qx * qx + qy * qy;
                if (e < 3) d += b.a * Math.exp(-1.6 * e);
              }
              return d;
            },
            [mix(P.night[7], P.stone[6], 0.3), mix(P.night[8], P.stone[7], 0.3)],
            true,
            0.45,
          ),
          alpha: 0.42,
          mask: bakeMask(y0, h, [
            { x: 62, y: 228, rx: 11, ry: 7 },
            { x: 147, y: 228, rx: 9, ry: 6 },
            { x: CF.x, y: CF.base - 4, rx: 20, ry: 9 },
          ]),
        };
      }

      vignette = bakeVignette(false);
    },

    // Halloween draws the original layers (season() is null); every other
    // edition draws the per-edition recipe from atmosphere-seasons.js.
    passes: [
      {
        layer: 'bg',
        z: 8.5,
        id: 'sky-haze',
        draw(g, t) {
          const S = season();
          if (S && S.sky) S.sky(g, t);
        },
      },
      {
        layer: 'bg',
        z: 26,
        id: 'far-mist',
        draw(g, t) {
          const S = season();
          if (!S) {
            drawBand(g, FAR, t);
            drawBand(g, FAR2, t);
            return;
          }
          for (const B of S.far) drawBand(g, B, t);
        },
      },
      {
        layer: 'fx',
        z: 15,
        id: 'ground-mist',
        draw(g, t) {
          const S = season();
          if (!S) {
            drawBand(g, GROUND, t);
            return;
          }
          for (const B of S.ground) drawBand(g, B, t);
          if (S.low) S.low(g, t);
        },
      },
      {
        layer: 'fx',
        z: 31,
        id: 'campfire-smoke',
        draw(g, t) {
          const S = season();
          if (!S) drawCamp(g, t, CAMP);
          else if (S.camp) drawCamp(g, t, S.camp);
        },
      },
      {
        layer: 'fx',
        z: 32,
        id: 'chimney-smoke',
        draw(g, t) {
          const S = season();
          drawChimney(g, t, S ? S.chim : CHIM);
          if (S && S.high) S.high(g, t);
        },
      },
      {
        layer: 'fx',
        z: 61,
        id: 'front-mist',
        draw(g, t) {
          const S = season();
          if (!S) {
            drawBand(g, FRONT, t);
            return;
          }
          for (const B of S.front) drawBand(g, B, t);
          if (S.near) S.near(g, t);
        },
      },
      {
        layer: 'fx',
        z: 95,
        id: 'vignette',
        draw(g) {
          g.sprite(vignetteFor(), 0, 0);
        },
      },
    ],
  });
})();
