/*
 * fire.js — the campfire: coal bed, procedural flames, fire light + halo,
 * rising sparks / embers and the occasional ember pop.
 *
 *   scene z42  coal bed (emissive, slow pulsing chunks between the logs)
 *   scene z44  flames (emissive, procedural, 12 fps)
 *   fx    z35  sparks, embers, pops
 *
 * Flames: a field of stateless "puffs" (HD.time.cycle blobs, 12 fps) streams
 * up from a hot root over the coals, converging and leaning with the wind; a
 * tileable value-noise texture baked in init() scrolls upward (a whole number
 * of tile heights per loop) and erodes the field so tongues split and detach.
 * The field is banded into 7 HD.PAL.fire colours, then lone pixels / pinholes
 * are cleaned up so the shapes stay clustered.
 * The two crossing front logs (geometry mirrored from props.js) occlude the
 * lower flame so the logs read as dark silhouettes against the fire.
 *
 * Seasons: the fire is a "rig" built from a geometry config. HD.edition.fire
 * picks the rig at draw time: 'campfire' (the original, constants unchanged),
 * 'bonfire' (the same fire ~1.6x: taller/wider flames, a bigger coal bed,
 * more sparks, a bigger light) or 'none'. Sparklers and fireworks live in
 * fire-seasons.js.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const C = HD.layout.campfire;
  const WIND = HD.layout.wind;

  // fire colours as RGB
  const FIRE = P.fire.map((c) => HD.color.hex(c));
  // flame bands (dark red edge -> near-white core)
  const BAND_COL = [3, 5, 6, 7, 8, 9, 10];
  const BAND_TH = [0.1, 0.22, 0.38, 0.56, 0.78, 1.02, 1.28];

  // ---- helpers --------------------------------------------------------------
  // loop-wrapped integer tick at `fps` (for per-tick hashes that must repeat every loop)
  function tick(t, fps) {
    const n = Math.round(HD.LOOP * fps);
    const k = Math.floor(t * fps + 1e-6) % n;
    return k < 0 ? k + n : k;
  }

  function bakeNoise(rnd, NW, NH) {
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

  // colour by "temperature" 0..1 (1 = white hot)
  function sparkCol(k) {
    return k > 0.86 ? P.fire[10] : k > 0.72 ? P.fire[9] : k > 0.58 ? P.fire[8] : k > 0.44 ? P.fire[7] : k > 0.3 ? P.fire[6] : k > 0.18 ? P.fire[5] : k > 0.08 ? P.fire[4] : P.fire[3];
  }

  const LCY = C.base - 1;
  // pop timing: one burst every ~6-10 s
  const POP_P = 8;
  function popState(t) {
    const c = T.cycle(t, 0, POP_P, 4242);
    const at = c.rnd(1) * 2.5; // fire time inside the cycle
    const tau = c.age * c.P - at;
    return { tau, c: c.c, x: c.rnd(2), n: 5 + Math.floor(c.rnd(3) * 4) };
  }

  // ---- a fire rig: everything parametrised by one geometry config ---------------
  function makeRig(o) {
    const S = o.S; // 1 = the original campfire
    const CX = C.x + 1; // visual centre of the log teepee (apex sits at ~97)
    const BASE = C.base - 2; // flame root (y), just inside the stone ring
    const FH = o.FH; // nominal flame height
    const HALFW = o.HALFW; // half width at the root

    // flame grid (scene coords)
    const GX0 = CX - o.gx;
    const GY0 = BASE - o.gy;
    const GW = o.GW;
    const GH = o.GH;
    // coal grid
    const KX0 = CX - o.kx;
    const KY0 = BASE - o.ky;
    const KW = o.KW;
    const KH = o.KH;
    // noise tile
    const NW = o.NW;
    const NH = o.NH;
    const LOGS = o.logs;
    const LOG_OCC_Y = o.logOccY;
    const N_BLOB = o.nBlob;
    const N_SPARK = o.nSpark;
    const LT = o.light;

    let NOISE = null; // Float32Array NW*NH, tileable
    let LOGMASK = null; // Uint8Array GW*GH: 1 where a front-crossing log covers the flame
    let flameCv = null;
    let flameCtx = null;
    let flameImg = null;
    let LV = null; // level grid
    let LV2 = null;
    let FLD = null; // flame field
    let coalCv = null;
    let coalCtx = null;
    let coalImg = null;
    let COALS = null; // [{x, y, base, cl}] coal pixels

    function logAt(x, y) {
      for (const l of LOGS) if (inLog(x, y, l[0], l[1], l[2], l[3], l[4])) return true;
      return false;
    }
    // does a log hide the flame at (x, y)? a log may carry its own occlusion
    // line (l[5]): above it the flames lick in front of that log
    function logOcc(x, y) {
      for (const l of LOGS) if (y >= (l[5] === undefined ? LOG_OCC_Y : l[5]) && inLog(x, y, l[0], l[1], l[2], l[3], l[4])) return true;
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

    // ---- flames -------------------------------------------------------------------
    // rising flame "puffs": stateless blobs streaming up from the coals; where
    // they overlap they make the body, where they separate they become tongues
    // and detached wisps
    function splat(fld, bx, by, rx, ry, s) {
      const x0 = Math.max(0, Math.floor(bx - rx - GX0));
      const x1 = Math.min(GW - 1, Math.ceil(bx + rx - GX0));
      const y0 = Math.max(0, Math.floor(by - ry - GY0));
      const y1 = Math.min(GH - 1, Math.ceil(by + ry - GY0));
      const irx = 1 / (rx * rx);
      const iry = 1 / (ry * ry);
      for (let gy = y0; gy <= y1; gy++) {
        const dy = GY0 + gy + 0.5 - by;
        const ky = 1 - dy * dy * iry;
        if (ky <= 0) continue;
        const row = gy * GW;
        for (let gx = x0; gx <= x1; gx++) {
          const dx = GX0 + gx + 0.5 - bx;
          const k = ky - dx * dx * irx;
          if (k > 0) fld[row + gx] += s * k;
        }
      }
    }

    function drawFlames(g, t) {
      const ts = T.step(t, 12);
      const st = flameHeight(ts);
      const Hc = st.h;
      // two noise layers scrolling upward a whole number of tiles per loop
      const sA = Math.floor(T.phase(ts, 1.45) * NH);
      const sB = Math.floor(T.phase(ts, 2.4) * NH);
      // gusty lean to the right
      const gust = T.noise(ts, 3.3, 51);
      const lean = 0.05 + 0.1 * gust;
      const sway = (T.noise(ts, 1.3, 52) - 0.5) * 2.4 * S;
      const fld = FLD;
      fld.fill(0);
      // hot root over the coals
      splat(fld, CX + 0.5, BASE - 1, HALFW * (0.92 + 0.08 * st.f), (5 + 1.5 * st.f) * S, 0.86);
      splat(fld, CX + 0.5, BASE - 5 * S, HALFW * 0.55, (7 + 2 * st.f) * S, 0.42);
      // streaming blobs
      for (let i = 0; i < N_BLOB; i++) {
        const c = T.cycle(ts, i, (0.95 + HD.hash(i, 1, 23) * 0.5) * o.blobLife, 321);
        const a = c.age;
        const side = c.rnd(0) * 2 - 1; // -1..1 across the root
        const cen = 1 - Math.abs(side); // centre blobs climb higher
        const top = Hc * (0.48 + 0.5 * cen + 0.22 * c.rnd(1));
        const h = 2 * S + top * Math.pow(a, 0.85);
        const xs = CX + 0.5 + side * HALFW * 0.8;
        // converge towards the axis as they rise, lean with the wind, wobble
        const conv = 0.55 * Math.min(1, a * 1.4);
        const hn = h / Hc;
        const wob = Math.sin(6.2832 * (c.rnd(2) + a * (1 + c.rnd(3)))) * 1.3 * S * hn;
        const bx = xs + (CX + 0.5 - xs) * conv + lean * h + sway * hn * hn + wob;
        const by = BASE - h;
        const r = ((2.2 + 2.6 * c.rnd(4)) * Math.pow(1 - a, 0.85) + 0.5) * S;
        splat(fld, bx, by, r, r * (1.6 + 1.5 * a), 0.64 * (1 - a * 0.55));
      }
      const d = flameImg.data;
      d.fill(0);
      const lv = LV;
      for (let gy = 0; gy < GH; gy++) {
        const y = GY0 + gy;
        const h = BASE - y + 0.5;
        const row = gy * GW;
        if (h < -1) {
          for (let gx = 0; gx < GW; gx++) lv[row + gx] = 0;
          continue;
        }
        const hc = Math.min(1.2, Math.max(0, h / Hc));
        const nRowA = ((gy + sA) % NH) * NW;
        const nRowB = ((gy + sB + 17) % NH) * NW;
        const kN = 0.22 + 0.36 * hc;
        for (let gx = 0; gx < GW; gx++) {
          const f0 = fld[row + gx];
          if (f0 <= 0.02) {
            lv[row + gx] = 0;
            continue;
          }
          const n = 0.62 * NOISE[nRowA + (gx % NW)] + 0.38 * NOISE[nRowB + ((gx + 11) % NW)];
          const F = f0 - (n - 0.35) * kN;
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
          let ov = v;
          if (v > 0) {
            if (mx === 0) ov = 0;
            else if (v > mx) ov = mx;
          } else {
            const cnt = (a > 0) + (b > 0) + (c > 0) + (e > 0);
            if (cnt >= 3) {
              let mn = 9;
              if (a > 0 && a < mn) mn = a;
              if (b > 0 && b < mn) mn = b;
              if (c > 0 && c < mn) mn = c;
              if (e > 0 && e < mn) mn = e;
              ov = mn;
            }
          }
          l2[p] = ov;
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
        if (k.base > 0.55 && HD.hash(k.cl, tick(t, 12), 5) > 0.985) v += 0.3;
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
    function drawSparks(g, t) {
      const drift = WIND.smokeDrift;
      for (let i = 0; i < N_SPARK; i++) {
        const per = 2.6 + HD.hash(i, 3, 17) * 2.6; // 2.6..5.2 s between births
        const c = T.cycle(t, i, per, 909);
        const life = (1.2 + c.rnd(0) * 2.3) * o.sparkLife; // 1.2..3.5 s
        const tau = c.age * c.P;
        if (tau > life) continue;
        if (c.rnd(9) < 0.22) continue; // some slots skip a life: calmer, irregular
        const a = tau / life;
        const x0 = CX + (c.rnd(1) - 0.45) * 12 * S;
        const y0 = BASE - 8 * S - c.rnd(2) * 12 * S;
        const v0 = o.v0a + c.rnd(3) * o.v0b; // initial rise speed px/s
        const k = 1.3 + c.rnd(4) * 1.2; // buoyancy decay time
        const rise = v0 * k * (1 - Math.exp(-tau / k));
        const wind = (drift * 1.2 + c.rnd(5) * 8) * Math.pow(tau, 1.35);
        const wa = 1 + c.rnd(6) * 2.2;
        const wob = wa * Math.sin(tau * (3 + c.rnd(7) * 4) + c.rnd(8) * 6.283) * Math.min(1, tau * 1.5);
        const x = Math.round(x0 + wind + wob);
        const y = Math.round(y0 - rise);
        // cooling, with a gentle twinkle
        const tw = HD.hash(i, tick(t, 14), c.c, 2) < 0.12 ? -0.12 : 0;
        const temp = (1 - a) * (0.75 + 0.25 * c.rnd(10)) + tw;
        if (temp < 0.03) continue;
        const col = sparkCol(temp);
        const big = c.rnd(11) < o.bigP && a < 0.35;
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
        const px0 = CX - 4 * S + pp.x * 8 * S;
        const py0 = BASE - 10 * S;
        const n = pp.n + o.popExtra;
        for (let j = 0; j < n; j++) {
          const r0 = HD.hash(pp.c, j, 31, 1);
          const r1 = HD.hash(pp.c, j, 31, 2);
          const r2 = HD.hash(pp.c, j, 31, 3);
          const life = 0.55 + r2 * 0.9;
          const tau = pp.tau;
          if (tau > life) continue;
          const ang = -Math.PI / 2 + (r0 - 0.5) * 2.2; // mostly upward fan
          const v = (55 + r1 * 55) * o.popV;
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

    function init() {
      NOISE = bakeNoise(HD.rng(4711), NW, NH);
      LOGMASK = new Uint8Array(GW * GH);
      for (let gy = 0; gy < GH; gy++)
        for (let gx = 0; gx < GW; gx++) if (logOcc(GX0 + gx, GY0 + gy)) LOGMASK[gy * GW + gx] = 1;
      flameCv = HD.canvas(GW, GH, true);
      flameCtx = flameCv.getContext('2d');
      flameImg = flameCtx.createImageData(GW, GH);
      LV = new Uint8Array(GW * GH);
      LV2 = new Uint8Array(GW * GH);
      FLD = new Float32Array(GW * GH);

      // coal bed: an ellipse of chunks in the ring, hottest under the flames
      const r = HD.rng(1313);
      COALS = [];
      const ccx = CX;
      const ccy = BASE + 0.5;
      const rx = o.coalRx;
      const ry = o.coalRy;
      const cw = o.chunkW;
      const chh = o.chunkH;
      for (let y = KY0; y < KY0 + KH; y++)
        for (let x = KX0; x < KX0 + KW; x++) {
          const dx = (x + 0.5 - ccx) / rx;
          const dy = (y + 0.5 - ccy) / ry;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1) continue;
          if (logAt(x, y)) continue;
          // chunks: 3x2 cells with their own heat; dark seams between chunks
          const cxi = Math.floor((x - KX0 + (y & 1)) / cw);
          const cyi = Math.floor((y - KY0) / chh);
          const cl = 100 + cyi * 31 + cxi;
          const seam = (x - KX0 + (y & 1)) % cw === 0 && HD.hash(cl, 1, 2) < 0.6;
          const hot = 1 - Math.sqrt(d2);
          let base = 0.18 + hot * 0.62 + (HD.hash(cl, 9, 9) - 0.5) * 0.35 + (r() - 0.5) * 0.08;
          if (seam) base -= 0.3;
          COALS.push({ x, y, base, cl, per: 2.2 + HD.hash(cl, 4, 4) * 2.8 });
        }
      coalCv = HD.canvas(KW, KH, true);
      coalCtx = coalCv.getContext('2d');
      coalImg = coalCtx.createImageData(KW, KH);
    }

    function lights(t, Lt) {
      const st = flameHeight(t);
      const f = st.f;
      const pp = popState(t);
      const pop = pp.tau >= 0 && pp.tau < 0.35 ? 0.3 * (1 - pp.tau / 0.35) : 0;
      // 1px jitter of the light centre at 12 fps follows the dancing tongues
      const ts = T.step(t, 12);
      const jx = Math.round((T.noise(ts, 0.5, 61) - 0.5) * 2.4 * S);
      const jy = Math.round((T.noise(ts, 0.6, 62) - 0.5) * 1.6 * S);
      const cy = BASE - Math.round(st.h * 0.42);
      Lt.add({
        x: CX + jx + 1,
        y: cy + jy,
        r: LT.r,
        color: HD.LIGHT.fire,
        i: LT.i0 + LT.i1 * f + 0.15 * st.flare + pop,
        halo: { r: LT.haloR, a: LT.haloA, y: cy + 2 * S },
      });
      // tighter, hotter pool near the base: logs, stones, the ground at the ring
      Lt.add({
        x: CX + jx,
        y: BASE - 3 * S,
        r: LT.poolR,
        ry: LT.poolRy,
        color: HD.LIGHT.fire,
        i: LT.p0 + LT.p1 * f + pop * 0.3,
        bands: 4,
        pow: 2.2,
      });
    }

    return { init, lights, drawFlames, drawCoals, drawSparks, flameHeight, CX, BASE, S };
  }

  // ---- the two rigs ---------------------------------------------------------------
  const CAMP_LOGS = [
    // [x0, y0, x1, y1, w] — the two crossing logs in front of the flame body
    [C.x + 16, LCY - 1, C.x - 5, LCY - 14, 4.6],
    [C.x - 15, LCY - 2, C.x + 6, LCY - 14, 5.0],
  ];
  const camp = makeRig({
    S: 1,
    FH: C.flameH,
    HALFW: C.flameW / 2,
    gx: 22,
    gy: 50,
    GW: 46,
    GH: 53,
    kx: 16,
    ky: 6,
    KW: 33,
    KH: 10,
    NW: 32,
    NH: 48,
    logs: CAMP_LOGS,
    logOccY: LCY - 10, // above this the flames lick over the logs
    nBlob: 18,
    nSpark: 56,
    blobLife: 1,
    sparkLife: 1,
    v0a: 34,
    v0b: 40,
    bigP: 0.12,
    popExtra: 0,
    popV: 1,
    coalRx: 13.5,
    coalRy: 3.4,
    chunkW: 3,
    chunkH: 2,
    light: { r: 122, i0: 0.8, i1: 0.42, haloR: 34, haloA: 0.15, poolR: 40, poolRy: 30, p0: 0.16, p1: 0.16 },
  });

  // bonfire: the same fire ~1.6x. The log teepee is drawn by props-seasons.js
  // (feet in a ring, leaning in to an apex ~34 px up); its four front-facing
  // logs are mirrored here so they hide the lower flames and read as charred
  // silhouettes against the fire. Each carries its own occlusion line: the
  // outer logs hide flame up to y 197, the inner pair only low down, so the
  // fire licks out between and over them. The back-centre log stays behind.
  const BS = 1.6;
  const BX = C.x;
  const BY = C.base - 1;
  const BAPEX = [BX + 1, BY - 34];
  const BON_LOGS = [
    [BX - 17, BY - 1, BAPEX[0] - 2, BAPEX[1], 4.6, BY - 28],
    [BX - 9, BY - 3, BAPEX[0] + 2, BAPEX[1] + 1, 4.2, BY - 18],
    [BX + 5, BY - 3, BAPEX[0] - 2, BAPEX[1] + 2, 4.4, BY - 18],
    [BX + 16, BY - 1, BAPEX[0] + 2, BAPEX[1], 4.8, BY - 28],
  ];
  const bon = makeRig({
    S: BS,
    FH: C.flameH * BS,
    HALFW: (C.flameW / 2) * BS,
    gx: 36,
    gy: 82,
    GW: 74,
    GH: 85,
    kx: 26,
    ky: 7,
    KW: 53,
    KH: 14,
    NW: 48,
    NH: 72,
    logs: BON_LOGS,
    logOccY: LCY - 16,
    nBlob: 30,
    nSpark: 96,
    blobLife: 1.18,
    sparkLife: 1.2,
    v0a: 40,
    v0b: 50,
    bigP: 0.16,
    popExtra: 4,
    popV: 1.2,
    coalRx: 21.6,
    coalRy: 5.4,
    chunkW: 4,
    chunkH: 3,
    light: { r: 168, i0: 0.95, i1: 0.45, haloR: 50, haloA: 0.16, poolR: 62, poolRy: 44, p0: 0.22, p1: 0.2 },
  });

  /** the rig for the current edition (read at draw time), or null for 'none' */
  function rig() {
    const f = HD.edition.fire;
    return f === 'campfire' ? camp : f === 'bonfire' ? bon : null;
  }
  HD._fire = { makeRig, rig, camp, bon, tick, sparkCol, FIRE };

  // ---- module ---------------------------------------------------------------------------
  HD.module('fire', {
    init() {
      camp.init();
      bon.init();
    },

    lights(t, Lt) {
      const r = rig();
      if (r) r.lights(t, Lt);
    },

    passes: [
      {
        layer: 'scene',
        z: 42,
        id: 'coals',
        draw(g, t) {
          const r = rig();
          if (r) r.drawCoals(g, t);
        },
      },
      {
        layer: 'scene',
        z: 44,
        id: 'flames',
        draw(g, t) {
          const r = rig();
          if (r) r.drawFlames(g, t);
        },
      },
      {
        layer: 'fx',
        z: 35,
        id: 'sparks',
        draw(g, t) {
          const r = rig();
          if (r) r.drawSparks(g, t);
        },
      },
    ],
  });
})();
