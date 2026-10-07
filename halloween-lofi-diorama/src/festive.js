/*
 * Festive helpers shared by every module so small lights look the same
 * everywhere: tiny flames, clay diya lamps, string lights, hanging lanterns.
 * All are pure functions of t (loop-safe) and draw crisp pixels.
 *
 * On the scene layer pass the scene gfx `g`: glowing parts go through g.em
 * (emissive, not relit), wires/caps through g. On fx/bg layers there is no
 * g.em and everything is drawn plainly.
 *
 * Each drawing helper has a matching *Light helper to call from lights(t, L)
 * so the glow lands in the same place.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const T = HD.time;
  const LIGHT = HD.LIGHT;
  const F = (HD.festive = {});
  const em = (g) => g.em || g;
  const R = Math.round;

  // ------------------------------------------------------------------
  // Flames
  // ------------------------------------------------------------------
  /**
   * Tiny flame standing on (x, y) (the wick top). size 1 = candle/diya
   * (1px wide, 2-3 tall), size 2 = lantern/torch (3px wide, 3-5 tall).
   */
  F.flame = function (g, x, y, t, seed, size) {
    const e = em(g);
    const ts = T.step(t, 10);
    const f = T.flicker(ts, seed, 1.4);
    x = R(x);
    y = R(y);
    if ((size || 1) <= 1) {
      e.px(x, y - 1, P.fire[f > 0.25 ? 9 : 8]);
      e.px(x, y - 2, P.fire[f > 0.5 ? 8 : 7]);
      if (f > 0.42) e.px(x, y - 3, P.fire[6]);
      return;
    }
    const lean = T.noise(ts, 0.6, seed * 3 + 1) > 0.62 ? 1 : T.noise(ts, 0.6, seed * 3 + 1) < 0.3 ? -1 : 0;
    e.px(x - 1, y - 1, P.fire[6]);
    e.px(x, y - 1, P.fire[10]);
    e.px(x + 1, y - 1, P.fire[6]);
    e.px(x, y - 2, P.fire[9]);
    if (f > 0.35) {
      e.px(x - 1, y - 2, P.fire[5]);
      e.px(x + 1, y - 2, P.fire[5]);
    }
    e.px(x + (lean > 0 ? 1 : 0), y - 3, P.fire[7]);
    if (f > 0.55) e.px(x + lean, y - 4, P.fire[5]);
  };
  /** light for a flame drawn at (x, y) */
  F.flameLight = function (L, x, y, t, seed, r, i) {
    const f = T.flicker(T.step(t, 10), seed, 1.4);
    L.add({ x: R(x), y: R(y) - 2, r: r || 14, color: LIGHT.candle, i: (i || 0.3) * (0.75 + 0.45 * f) });
  };

  // ------------------------------------------------------------------
  // Diya: little clay oil lamp, (x, y) = bottom centre, ~6 px wide
  // ------------------------------------------------------------------
  F.diya = function (g, x, y, t, seed) {
    x = R(x);
    y = R(y);
    g.hline(x - 1, x + 1, y, P.pumpkin[1]);
    g.hline(x - 2, x + 2, y - 1, P.pumpkin[2]);
    g.hline(x - 2, x + 2, y - 2, P.pumpkin[4]);
    g.px(x + 3, y - 2, P.pumpkin[3]); // spout
    em(g).hline(x - 1, x + 1, y - 2, P.amber[3]); // oil catching the flame
    F.flame(g, x + 3, y - 2, t, seed, 1);
  };
  F.diyaLight = function (L, x, y, t, seed, r, i) {
    F.flameLight(L, R(x) + 3, R(y) - 3, t, seed, r || 16, i || 0.32);
  };

  // ------------------------------------------------------------------
  // String lights along a polyline with catenary sag
  // ------------------------------------------------------------------
  const pathCache = new WeakMap();
  function samplePath(pts, sag) {
    let byS = pathCache.get(pts);
    if (byS && byS.has(sag)) return byS.get(sag);
    if (!byS) pathCache.set(pts, (byS = new Map()));
    const out = []; // dense list of integer pixels along the wire
    let last = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
      const steps = Math.ceil(len * 2);
      const s = sag * Math.min(1, len / 40);
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const x = R(x0 + (x1 - x0) * u);
        const y = R(y0 + (y1 - y0) * u + 4 * s * u * (1 - u));
        if (last && last[0] === x && last[1] === y) continue;
        out.push((last = [x, y]));
      }
    }
    byS.set(sag, out);
    return out;
  }
  /**
   * Draw string lights.
   *  pts      [[x,y],...] anchor points (keep the array constant: it is cached)
   *  opts     { colors:['red','green','blue','gold'], spacing:4, sag:3,
   *             wire:'#…', twinkle:0..1, seed }
   */
  F.bulbs = function (g, pts, t, opts) {
    const o = opts || {};
    const path = samplePath(pts, o.sag === undefined ? 3 : o.sag);
    const wire = o.wire || '#05060c';
    const colors = o.colors || ['gold'];
    const spacing = o.spacing || 4;
    const seed = o.seed || 0;
    const tw = o.twinkle === undefined ? 0.6 : o.twinkle;
    const e = em(g);
    for (let i = 0; i < path.length; i++) {
      const [x, y] = path[i];
      if (i % spacing === 0) {
        const k = (i / spacing) | 0;
        const ramp = P.bulb[colors[k % colors.length]] || P.bulb.gold;
        const n = T.noise(t, 2.2, seed * 977 + k);
        const lvl = n < 0.5 * tw ? 1 : 2;
        g.px(x, y, wire);
        e.px(x, y + 1, ramp[lvl]);
        e.px(x, y + 2, ramp[lvl - 1]);
      } else g.px(x, y, wire);
    }
  };
  /** a few aggregated lights along a string (one per ~`every` px) */
  F.bulbLights = function (L, pts, t, opts) {
    const o = opts || {};
    const path = samplePath(pts, o.sag === undefined ? 3 : o.sag);
    const colors = o.colors || ['gold'];
    const every = o.every || 18;
    for (let i = (every >> 1); i < path.length; i += every) {
      const [x, y] = path[i];
      const c = LIGHT.bulb[colors[((i / every) | 0) % colors.length]] || LIGHT.bulb.gold;
      L.add({ x, y: y + 3, r: o.r || 14, color: c, i: o.i || 0.16, bands: 4 });
    }
  };

  // ------------------------------------------------------------------
  // Hanging lanterns (pendulum sway). (x, y) = hook point.
  // kinds: 'red' (silk lantern, gold caps, tassel), 'paper' (round, warm
  // white), 'harvest' (round, orange). opts: { len, size:'small'|'big', amp }
  // ------------------------------------------------------------------
  F.lanternPos = function (x, y, t, seed, opts) {
    const o = opts || {};
    const len = o.len === undefined ? 3 : o.len;
    const amp = o.amp === undefined ? 0.12 : o.amp;
    const a = amp * T.wave(t, 3.6 + (seed % 5) * 0.37, seed * 0.173);
    return [R(x + Math.sin(a) * len), R(y + Math.cos(a) * len)];
  };
  F.lantern = function (g, x, y, t, seed, kind, opts) {
    const o = opts || {};
    const [bx, by] = F.lanternPos(x, y, t, seed, o);
    const e = em(g);
    const f = T.flicker(T.step(t, 8), seed + 11, 0.9);
    const hi = f > 0.5 ? 1 : 0;
    g.line(R(x), R(y), bx, by, P.night[2]);
    const small = o.size === 'small';
    if (kind === 'red') {
      if (small) {
        g.hline(bx - 1, bx + 1, by + 1, P.gold[3]);
        e.hline(bx - 1, bx + 1, by + 2, P.red[4 + hi]);
        e.hline(bx - 2, bx + 2, by + 3, P.red[4 + hi]);
        e.px(bx, by + 3, P.red[6]);
        e.hline(bx - 1, bx + 1, by + 4, P.red[3 + hi]);
        g.hline(bx - 1, bx + 1, by + 5, P.gold[3]);
        g.px(bx, by + 6, P.red[3]);
        return;
      }
      g.hline(bx - 1, bx + 1, by + 1, P.gold[4]);
      e.hline(bx - 2, bx + 2, by + 2, P.red[3 + hi]);
      for (let r = 3; r <= 6; r++) {
        e.px(bx - 3, by + r, P.red[3 + hi]);
        e.px(bx - 2, by + r, P.red[4 + hi]);
        e.px(bx - 1, by + r, P.red[5 + hi]);
        e.px(bx, by + r, P.red[6]);
        e.px(bx + 1, by + r, P.red[5 + hi]);
        e.px(bx + 2, by + r, P.red[4 + hi]);
        e.px(bx + 3, by + r, P.red[3 + hi]);
      }
      e.hline(bx - 2, bx + 2, by + 7, P.red[3 + hi]);
      g.hline(bx - 1, bx + 1, by + 8, P.gold[4]);
      g.vline(bx, by + 9, by + 11, P.gold[3]);
      g.px(bx, by + 12, P.red[4]);
      return;
    }
    const ramp = kind === 'harvest' ? [P.fire[4], P.fire[6], P.fire[8]] : [P.amber[5], P.amber[6], P.amber[8]];
    if (small) {
      g.px(bx, by + 1, P.night[2]);
      e.hline(bx - 1, bx + 1, by + 2, ramp[hi]);
      e.hline(bx - 1, bx + 1, by + 3, ramp[1 + hi]);
      e.px(bx, by + 3, ramp[2]);
      e.hline(bx - 1, bx + 1, by + 4, ramp[hi]);
      return;
    }
    g.hline(bx - 1, bx + 1, by + 1, P.night[2]);
    e.hline(bx - 1, bx + 1, by + 2, ramp[hi]);
    e.hline(bx - 2, bx + 2, by + 3, ramp[1]);
    e.hline(bx - 2, bx + 2, by + 4, ramp[1 + hi]);
    e.px(bx, by + 4, ramp[2]);
    e.hline(bx - 2, bx + 2, by + 5, ramp[1]);
    e.hline(bx - 1, bx + 1, by + 6, ramp[hi]);
    g.px(bx - 1, by + 4, ramp[0]); // paper rib
    g.px(bx + 1, by + 4, ramp[0]);
    g.hline(bx - 1, bx + 1, by + 7, P.night[2]);
  };
  F.lanternLight = function (L, x, y, t, seed, kind, opts) {
    const o = opts || {};
    const [bx, by] = F.lanternPos(x, y, t, seed, o);
    const f = T.flicker(T.step(t, 8), seed + 11, 0.9);
    const small = o.size === 'small';
    const color = kind === 'red' ? LIGHT.redLantern : kind === 'harvest' ? LIGHT.lantern : LIGHT.paperLantern;
    L.add({
      x: bx,
      y: by + (small ? 3 : 5),
      r: o.r || (small ? 16 : 26),
      color,
      i: (o.i || (small ? 0.22 : 0.38)) * (0.85 + 0.25 * f),
      halo: o.halo === false ? undefined : { r: small ? 6 : 10, a: 0.12 },
    });
  };
})();
