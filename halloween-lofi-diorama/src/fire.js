/*
 * fire.js — the campfire: coal bed, procedural flames, fire light + halo,
 * rising sparks / embers and the occasional ember pop, a touch of heat shimmer.
 *
 *   scene z42  coal bed (emissive, slow pulsing chunks between the logs)
 *   scene z44  flames (emissive, procedural, 12 fps)
 *   fx    z34  heat shimmer (1px row offsets just above the flame tips)
 *   fx    z35  sparks, embers, pops
 *
 * Flames: a tileable value-noise texture is baked once; two copies scroll
 * upward at different speeds (each a whole number of tile heights per loop),
 * get combined with a flame envelope (wide hot base, tapering, leaning with
 * the wind), and the resulting field is banded into HD.PAL.fire colours.
 * The two crossing front logs (geometry mirrored from props.js) occlude the
 * lower flame so the logs read as dark silhouettes against the fire.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const C = HD.layout.campfire;
  const WIND = HD.layout.wind;

  // ---- geometry -----------------------------------------------------------
  const CX = C.x + 1; // visual centre of the log teepee (apex sits at ~97)
  const BASE = C.base - 2; // flame root (y), just inside the stone ring
  const FH = C.flameH; // nominal flame height
  const HALFW = C.flameW / 2; // half width at the root

  // flame grid (scene coords)
  const GX0 = CX - 22;
  const GY0 = BASE - 50;
  const GW = 46;
  const GH = 53;

  // coal grid
  const KX0 = CX - 16;
  const KY0 = BASE - 6;
  const KW = 33;
  const KH = 10;

  // noise tile
  const NW = 32;
  const NH = 48;

  // fire colours as RGB
  const FIRE = P.fire.map((c) => HD.color.hex(c));
  // flame bands (dark red edge -> near-white core)
  const BAND_COL = [3, 5, 6, 7, 8, 9, 10];
  const BAND_TH = [0.04, 0.14, 0.26, 0.4, 0.56, 0.75, 0.97];

  let NOISE = null; // Float32Array NW*NH, tileable
  let LOGMASK = null; // Uint8Array GW*GH: 1 where a front-crossing log covers the flame
  let flameCv = null;
  let flameCtx = null;
  let flameImg = null;
  let LV = null; // level grid
  let LV2 = null;
  let coalCv = null;
  let coalCtx = null;
  let coalImg = null;
  let COALS = null; // [{x, y, base, cl}] coal pixels
  let shimmerTmp = null;

  // ---- helpers --------------------------------------------------------------
  function bakeNoise(rnd) {
    // two-octave tileable value noise, elongated vertically (flame tongues)
    const out = new Float32Array(NW * NH);
    const oct = [
      { cx: 7, cy: 3, a: 0.7 },
      { cx: 14, cy: 6, a: 0.3 },
    ];
    for (const o of oct) {
      const lat = new Float32Array(o.cx * o.cy);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < NH; y++) {
        const gy = (y / NH) * o.cy;
        const iy = Math.floor(gy);
        let fy = gy - iy;
        fy = fy * fy * (3 - 2 * fy);
        const y0 = iy % o.cy;
        const y1 = (iy + 1) % o.cy;
        for (let x = 0; x < NW; x++) {
          const gx = (x / NW) * o.cx;
          const ix = Math.floor(gx);
          let fx = gx - ix;
          fx = fx * fx * (3 - 2 * fx);
          const x0 = ix % o.cx;
          const x1 = (ix + 1) % o.cx;
          const a = lat[y0 * o.cx + x0];
          const b = lat[y0 * o.cx + x1];
          const c = lat[y1 * o.cx + x0];
          const d = lat[y1 * o.cx + x1];
          const v = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
          out[y * NW + x] += v * o.a;
        }
      }
    }
    // normalise to 0..1
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < out.length; i++) {
      if (out[i] < lo) lo = out[i];
      if (out[i] > hi) hi = out[i];
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
    return out;
  }

  // same capsule test props.js uses for its logs (logShape), absolute coords
  function inLog(x, y, x0, y0, x1, y1, w) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const tx = (x1 - x0) / len;
    const ty = (y1 - y0) / len;
    const px = x - x0;
    const py = y - y0;
    const s = px * tx + py * ty;
    const v = -px * ty + py * tx;
    return s >= 0 && s <= len && Math.abs(v) <= w / 2;
  }
  const LCY = C.base - 1;
  const LOGS = [
    // [x0, y0, x1, y1, w] — the two crossing logs in front of the flame body
    [C.x + 16, LCY - 1, C.x - 5, LCY - 14, 4.6],
    [C.x - 15, LCY - 2, C.x + 6, LCY - 14, 5.0],
  ];
  const LOG_OCC_Y = LCY - 10; // above this the flames lick over the logs
  function logAt(x, y) {
    for (const l of LOGS) if (inLog(x, y, l[0], l[1], l[2], l[3], l[4])) return true;
    return false;
  }

  // flame "breath": height multiplier shared by the flames and the light
  function flameHeight(t) {
    const f = T.flicker(t, 3, 1.2);
    // occasional taller flare (a few seconds every ~half minute)
    const fl = T.noise(t, 9, 77);
    const flare = HD.smoothstep(0.62, 0.9, fl);
    return { f, flare, h: FH * (0.92 + 0.3 * f + 0.34 * flare) };
  }

  // pop timing: one burst every ~6-10 s
  const POP_P = 8;
  function popState(t) {
    const c = T.cycle(t, 0, POP_P, 4242);
    const at = c.rnd(1) * 2.5; // fire time inside the cycle
    const tau = c.age * c.P - at;
    return { tau, c: c.c, x: c.rnd(2), n: 5 + Math.floor(c.rnd(3) * 4) };
  }

  // ---- flames -------------------------------------------------------------------
  function drawFlames(g, t) {
    const ts = T.step(t, 12);
    const st = flameHeight(ts);
    const Hc = st.h;
    // two noise layers scrolling upward a whole number of tiles per loop
    const sA = Math.floor(T.phase(ts, 1.45) * NH);
    const sB = Math.floor(T.phase(ts, 2.4) * NH);
    const sD = Math.floor(T.phase(ts, 1.9) * NH);
    // gusty lean to the right
    const gust = T.noise(ts, 3.3, 51);
    const lean = 0.04 + 0.09 * gust;
    const sway = (T.noise(ts, 1.3, 52) - 0.5) * 3.2;
    const d = flameImg.data;
    d.fill(0);
    const lv = LV;
    for (let gy = 0; gy < GH; gy++) {
      const y = GY0 + gy;
      const h = BASE - y + 0.5;
      const hn = h / Hc;
      const row = gy * GW;
      if (hn > 1.25 || h < -1) {
        for (let gx = 0; gx < GW; gx++) lv[row + gx] = 0;
        continue;
      }
      const hc = hn < 0 ? 0 : hn;
      // row-wise wobble that also scrolls up: wavy tongues
      const wob = (NOISE[((gy + sD) % NH) * NW + 7] - 0.5) * 5 * hc;
      const xc = CX + lean * Math.max(0, h) + sway * hc * hc + wob;
      // envelope half-width: wide hot base, tapering tongue
      const hw = HALFW * Math.pow(Math.max(0, 1 - hc * 0.92), 0.75) + 0.8 + (h < 2 ? h * 0.6 - 1.2 : 0);
      const vert = 1 - Math.pow(hc, 1.7);
      const nRowA = ((gy + sA) % NH) * NW;
      const nRowB = ((gy + sB + 17) % NH) * NW;
      const kN = 0.3 + 0.62 * Math.min(1, hc * 1.1);
      for (let gx = 0; gx < GW; gx++) {
        const x = GX0 + gx;
        const u = (x + 0.5 - xc) / hw;
        const au = u < 0 ? -u : u;
        if (au > 1.6) {
          lv[row + gx] = 0;
          continue;
        }
        let env = (1 - au * au * (0.6 + 0.4 * au)) * vert;
        // bottom: round off the root so the coal bed shows below
        if (h < 4) env -= (4 - h) * (0.1 + 0.25 * au);
        const n = 0.62 * NOISE[nRowA + (gx & 31)] + 0.38 * NOISE[nRowB + ((gx + 11) & 31)];
        const F = env * 1.12 - n * kN + 0.06;
        let L = 0;
        while (L < 7 && F > BAND_TH[L]) L++;
        lv[row + gx] = L;
      }
    }
    // cleanup: no lone pixels, no isolated bright dots, fill pinholes
    const l2 = LV2;
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const p = gy * GW + gx;
        const v = lv[p];
        const a = gx > 0 ? lv[p - 1] : 0;
        const b = gx < GW - 1 ? lv[p + 1] : 0;
        const c = gy > 0 ? lv[p - GW] : 0;
        const e = gy < GH - 1 ? lv[p + GW] : 0;
        let mx = a > b ? a : b;
        if (c > mx) mx = c;
        if (e > mx) mx = e;
        let o = v;
        if (v > 0) {
          if (mx === 0) o = 0;
          else if (v > mx) o = mx;
        } else {
          const cnt = (a > 0) + (b > 0) + (c > 0) + (e > 0);
          if (cnt >= 3) {
            let mn = 9;
            if (a > 0 && a < mn) mn = a;
            if (b > 0 && b < mn) mn = b;
            if (c > 0 && c < mn) mn = c;
            if (e > 0 && e < mn) mn = e;
            o = mn;
          }
        }
        l2[p] = o;
      }
    }
    for (let p = 0, q = 0; p < GW * GH; p++, q += 4) {
      const v = l2[p];
      if (v === 0 || LOGMASK[p]) continue;
      const col = FIRE[BAND_COL[v - 1]];
      d[q] = col[0];
      d[q + 1] = col[1];
      d[q + 2] = col[2];
      d[q + 3] = 255;
    }
    flameCtx.putImageData(flameImg, 0, 0);
    g.em.sprite(flameCv, GX0, GY0);
  }

  // ---- coal bed ---------------------------------------------------------------------
  function drawCoals(g, t) {
    const ts = T.step(t, 12);
    const d = coalImg.data;
    d.fill(0);
    const glow = T.flicker(t, 3, 0.6);
    for (const k of COALS) {
      const pulse = T.noise(ts, k.per, k.cl);
      let v = k.base + (pulse - 0.5) * 0.55 + (glow - 0.5) * 0.2;
      // a tiny sparkle now and then on the hottest chunks
      if (k.base > 0.55 && HD.hash(k.cl, Math.floor(ts * 12), 5) > 0.985) v += 0.3;
      const ci = v < 0.12 ? 1 : v < 0.3 ? 2 : v < 0.45 ? 3 : v < 0.58 ? 4 : v < 0.7 ? 5 : v < 0.82 ? 6 : v < 0.93 ? 7 : 8;
      const col = FIRE[ci];
      const q = ((k.y - KY0) * KW + (k.x - KX0)) * 4;
      d[q] = col[0];
      d[q + 1] = col[1];
      d[q + 2] = col[2];
      d[q + 3] = 255;
    }
    coalCtx.putImageData(coalImg, 0, 0);
    g.em.sprite(coalCv, KX0, KY0);
  }

  // ---- sparks & embers --------------------------------------------------------------
  const N_SPARK = 56;
  // colour by "temperature" 0..1 (1 = white hot)
  function sparkCol(k) {
    return k > 0.86 ? P.fire[10] : k > 0.72 ? P.fire[9] : k > 0.58 ? P.fire[8] : k > 0.44 ? P.fire[7] : k > 0.3 ? P.fire[6] : k > 0.18 ? P.fire[5] : k > 0.08 ? P.fire[4] : P.fire[3];
  }
  function drawSparks(g, t) {
    const drift = WIND.smokeDrift;
    for (let i = 0; i < N_SPARK; i++) {
      const per = 2.6 + HD.hash(i, 3, 17) * 2.6; // 2.6..5.2 s between births
      const c = T.cycle(t, i, per, 909);
      const life = 1.2 + c.rnd(0) * 2.3; // 1.2..3.5 s
      const tau = c.age * c.P;
      if (tau > life) continue;
      if (c.rnd(9) < 0.22) continue; // some slots skip a life: calmer, irregular
      const a = tau / life;
      const x0 = CX + (c.rnd(1) - 0.45) * 12;
      const y0 = BASE - 8 - c.rnd(2) * 12;
      const v0 = 34 + c.rnd(3) * 40; // initial rise speed px/s
      const k = 1.3 + c.rnd(4) * 1.2; // buoyancy decay time
      const rise = v0 * k * (1 - Math.exp(-tau / k));
      const wind = (drift * 1.2 + c.rnd(5) * 8) * Math.pow(tau, 1.35);
      const wa = 1 + c.rnd(6) * 2.2;
      const wob = wa * Math.sin(tau * (3 + c.rnd(7) * 4) + c.rnd(8) * 6.283) * Math.min(1, tau * 1.5);
      const x = Math.round(x0 + wind + wob);
      const y = Math.round(y0 - rise);
      // cooling, with a gentle twinkle
      const tw = HD.hash(i, Math.floor(t * 14), c.c, 2) < 0.12 ? -0.12 : 0;
      const temp = (1 - a) * (0.75 + 0.25 * c.rnd(10)) + tw;
      if (temp < 0.03) continue;
      const col = sparkCol(temp);
      const big = c.rnd(11) < 0.12 && a < 0.35;
      if (big) {
        g.rect(x, y, 2, 2, col);
      } else {
        g.px(x, y, col);
        // short motion streak while still fast
        const sp = v0 * Math.exp(-tau / k);
        if (sp > 34 && temp > 0.4) g.px(x, y + 1, sparkCol(temp - 0.3));
      }
    }
    // ember pop: a quick burst of 5-8 sparks
    const pp = popState(t);
    if (pp.tau >= 0 && pp.tau < 1.6) {
      const px0 = CX - 4 + pp.x * 8;
      const py0 = BASE - 10;
      for (let j = 0; j < pp.n; j++) {
        const r0 = HD.hash(pp.c, j, 31, 1);
        const r1 = HD.hash(pp.c, j, 31, 2);
        const r2 = HD.hash(pp.c, j, 31, 3);
        const life = 0.55 + r2 * 0.9;
        const tau = pp.tau;
        if (tau > life) continue;
        const ang = -Math.PI / 2 + (r0 - 0.5) * 2.2; // mostly upward fan
        const v = 55 + r1 * 55;
        const vx = Math.cos(ang) * v;
        const vy = Math.sin(ang) * v;
        const x = Math.round(px0 + vx * tau + drift * 2 * tau * tau);
        const y = Math.round(py0 + vy * tau + 0.5 * 70 * tau * tau);
        const temp = 1 - tau / life;
        g.px(x, y, sparkCol(temp));
        if (tau < 0.25) g.px(x - Math.sign(vx), y + 1, sparkCol(temp - 0.35));
      }
    }
  }

  // ---- heat shimmer ----------------------------------------------------------------------
  const SH_X0 = CX - 12;
  const SH_W = 26;
  const SH_Y0 = BASE - 50;
  const SH_H = 18;
  function drawShimmer(g, t) {
    const ctx = g.ctx;
    const img = ctx.getImageData(SH_X0, SH_Y0, SH_W, SH_H);
    const d = img.data;
    const src = shimmerTmp;
    src.set(d);
    const ph = T.phase(t, 0.9);
    for (let y = 0; y < SH_H; y++) {
      // fade in from the edges of the band
      const e = Math.sin((Math.PI * (y + 0.5)) / SH_H);
      const off = Math.round(Math.sin(6.2832 * (ph * 2 + y * 0.21)) * e * 0.9);
      if (off === 0) continue;
      const r = y * SH_W * 4;
      for (let x = 0; x < SH_W; x++) {
        const sx = Math.min(SH_W - 1, Math.max(0, x + off));
        const di = r + x * 4;
        const si = r + sx * 4;
        d[di] = src[si];
        d[di + 1] = src[si + 1];
        d[di + 2] = src[si + 2];
      }
    }
    ctx.putImageData(img, SH_X0, SH_Y0);
  }

  // ---- module ---------------------------------------------------------------------------
  HD.module('fire', {
    init() {
      NOISE = bakeNoise(HD.rng(4711));
      LOGMASK = new Uint8Array(GW * GH);
      for (let gy = 0; gy < GH; gy++)
        for (let gx = 0; gx < GW; gx++) if (GY0 + gy >= LOG_OCC_Y && logAt(GX0 + gx, GY0 + gy)) LOGMASK[gy * GW + gx] = 1;
      flameCv = HD.canvas(GW, GH, true);
      flameCtx = flameCv.getContext('2d');
      flameImg = flameCtx.createImageData(GW, GH);
      LV = new Uint8Array(GW * GH);
      LV2 = new Uint8Array(GW * GH);

      // coal bed: an ellipse of chunks in the ring, hottest under the flames
      const r = HD.rng(1313);
      COALS = [];
      const ccx = CX;
      const ccy = BASE + 0.5;
      const rx = 13.5;
      const ry = 3.4;
      for (let y = KY0; y < KY0 + KH; y++)
        for (let x = KX0; x < KX0 + KW; x++) {
          const dx = (x + 0.5 - ccx) / rx;
          const dy = (y + 0.5 - ccy) / ry;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1) continue;
          if (logAt(x, y)) continue;
          // chunks: 3x2 cells with their own heat; dark seams between chunks
          const cxi = Math.floor((x - KX0 + (y & 1)) / 3);
          const cyi = Math.floor((y - KY0) / 2);
          const cl = 100 + cyi * 31 + cxi;
          const seam = (x - KX0 + (y & 1)) % 3 === 0 && HD.hash(cl, 1, 2) < 0.6;
          const hot = 1 - Math.sqrt(d2);
          let base = 0.18 + hot * 0.62 + (HD.hash(cl, 9, 9) - 0.5) * 0.35 + (r() - 0.5) * 0.08;
          if (seam) base -= 0.3;
          COALS.push({ x, y, base, cl, per: 2.2 + HD.hash(cl, 4, 4) * 2.8 });
        }
      coalCv = HD.canvas(KW, KH, true);
      coalCtx = coalCv.getContext('2d');
      coalImg = coalCtx.createImageData(KW, KH);
      shimmerTmp = new Uint8ClampedArray(SH_W * SH_H * 4);
    },

    lights(t, Lt) {
      const st = flameHeight(t);
      const f = st.f;
      const pp = popState(t);
      const pop = pp.tau >= 0 && pp.tau < 0.35 ? 0.3 * (1 - pp.tau / 0.35) : 0;
      // 1px jitter of the light centre at 12 fps follows the dancing tongues
      const ts = T.step(t, 12);
      const jx = Math.round((T.noise(ts, 0.5, 61) - 0.5) * 2.4);
      const jy = Math.round((T.noise(ts, 0.6, 62) - 0.5) * 1.6);
      const cy = BASE - Math.round(st.h * 0.42);
      Lt.add({
        x: CX + jx + 1,
        y: cy + jy,
        r: 122,
        color: HD.LIGHT.fire,
        i: 0.8 + 0.42 * f + 0.15 * st.flare + pop,
        halo: { r: 34, a: 0.15, y: cy + 2 },
      });
      // tighter, hotter pool near the base: logs, stones, the ground at the ring
      Lt.add({
        x: CX + jx,
        y: BASE - 3,
        r: 40,
        ry: 30,
        color: HD.LIGHT.fire,
        i: 0.16 + 0.16 * f + pop * 0.3,
        bands: 4,
        pow: 2.2,
      });
    },

    passes: [
      { layer: 'scene', z: 42, id: 'coals', draw: drawCoals },
      { layer: 'scene', z: 44, id: 'flames', draw: drawFlames },
      { layer: 'fx', z: 34, id: 'shimmer', draw: drawShimmer },
      { layer: 'fx', z: 35, id: 'sparks', draw: drawSparks },
    ],
  });
})();
