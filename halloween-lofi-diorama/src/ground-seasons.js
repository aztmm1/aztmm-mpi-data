/*
 * ground — seasonal slabs for the Rainy Hollow series (every edition except
 * Halloween, whose 'wet-autumn' slab is built by the original pipeline in
 * ground.js and stays pixel-identical).
 *
 * Each edition is rasterised once (lazily, via HD.perEdition in ground.js)
 * with the toolkit ground.js exposes: same strata, pebbles and roots, but a
 * different top face, puddles, front lip and a per-edition secret in the cut
 * face. Things floating on the puddles (lily pads, ice cracks, leaves) are
 * flagged as overlay pixels so ground.js re-draws them above the engine's
 * reflections.
 *
 *   leafy       harvest   thick leaf carpet, squirrel's acorn stash
 *   dry-autumn  lights    dry grass, swept path, rangoli, clay pot of coins
 *   snow        winter    deep drifts, footprint trail, overhanging lip, ice,
 *                         frozen topsoil, hedgehog asleep in a leaf nest
 *   thin-snow   lunar     patchy snow, hibernating frog, red paper scraps
 *               newyear   patchy snow, ice, melted fire ring, time capsule
 *   spring      spring    fresh grass, tulips & daffodils, rabbit burrow
 *   summer      summer    lush meadow, clover, wildflowers, lily pond, ants
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const L = HD.layout;
  const T = HD.time;
  const mix = HD.color.mix;
  const clamp = HD.clamp;
  const bayer = HD.bayer;
  const W = 480;
  const S = P.snow;

  // ------------------------------------------------------------------
  // ramps (7 entries, indexed like PAL.moss so tuft() can use them)
  // ------------------------------------------------------------------
  const seven = (f) => [0, 1, 2, 3, 4, 5, 6].map(f);
  const RAMP = {
    spring: seven((i) => mix(P.leaf[Math.min(7, i + 1)], P.gold[1 + (i >> 1)], 0.2)),
    summer: seven((i) => mix(P.leaf[Math.min(7, i + 1)], P.moss[i], 0.2)),
    leafy: seven((i) => mix(P.moss[i], P.vine[Math.min(4, i)], 0.55)),
    dry: seven((i) => mix(mix(P.vine[Math.min(4, i)], P.autumn[Math.min(7, i + 1)], 0.36), P.stone[Math.min(7, i + 1)], 0.18)),
    frost: seven((i) => mix(P.moss[i], P.stone[Math.min(7, i + 1)], 0.38)),
  };

  // ------------------------------------------------------------------
  // shared painters
  // ------------------------------------------------------------------
  function fillTop(K, ramp, o) {
    const { BACK, FRONT } = K;
    for (let y = BACK; y < FRONT; y++) {
      const d = K.depth(y);
      for (let x = 0; x < W; x++) {
        const n = K.fbm(x / 15, y / 4.2, o.seed || 11);
        let v = (o.base === undefined ? 1.35 : o.base) + d * (o.slope === undefined ? 2.05 : o.slope) + (n - 0.5) * (o.amp || 2.1);
        if (y < BACK + 3) v -= (BACK + 3 - y) * 0.45;
        if (K.vn(x / 21, y / 4.5, 23) > 0.7) v -= o.damp === undefined ? 1 : o.damp;
        K.set(x, y, ramp[K.qd(v, x, y, o.lo || 1, o.hi || 4, 0.22)]);
      }
    }
    despeckle(K, BACK + 1, FRONT - 1);
  }
  function despeckle(K, y0, y1) {
    for (let y = y0; y < y1; y++)
      for (let x = 1; x < W - 1; x++) {
        const c = K.get(x, y);
        const l = K.get(x - 1, y);
        if (c !== l && l === K.get(x + 1, y) && c !== K.get(x, y - 1) && c !== K.get(x, y + 1)) K.set(x, y, l);
      }
  }

  function mudSpotsFor(ed, o) {
    const s = [];
    const cf = L.campfire;
    if (ed.fire !== 'none' && !o.noFire) {
      const [rx, ry] = o.fireR || (ed.fire === 'bonfire' ? [34, 9.5] : [30, 8.5]);
      s.push({ x: cf.x, y: cf.base, rx, ry, k: 1.15, fire: true });
    }
    const st = L.house.steps;
    if (!o.noSteps) s.push({ x: (st.x0 + st.x1) / 2, y: st.y1 + 1, rx: 17, ry: 3.2, k: o.k || 0.9 });
    if (!o.noPuddles) for (const p of L.puddles) s.push({ x: p.x, y: p.y + 0.5, rx: p.rx + 5, ry: p.ry + 2.2, k: o.k || 0.85 });
    if (o.tree) s.push({ x: 405, y: 220, rx: 26, ry: 4, k: o.tree });
    return s;
  }

  /** puddle beds: kind 'water' | 'ice' | 'lily'; bank colours {far, near, end} */
  function puddles(K, kind, bank) {
    const { PUD, RIM } = K;
    L.puddles.forEach((p, pi) => {
      const cx = Math.round(p.x);
      const rows = K.pudRows(p);
      for (const r of rows) for (let x = cx - r.hw; x <= cx + r.hw; x++) K.addMask(x, r.y, PUD);
      for (const r of rows)
        for (let x = cx - r.hw - 2; x <= cx + r.hw + 2; x++)
          for (let oy = -1; oy <= 1; oy++) {
            const y = r.y + oy;
            if (K.mask(x, y) & PUD) continue;
            const near = K.mask(x - 1, y) & PUD || K.mask(x + 1, y) & PUD || K.mask(x, y - 1) & PUD || K.mask(x, y + 1) & PUD;
            if (!near) continue;
            K.addMask(x, y, RIM);
            K.set(x, y, y > p.y ? bank.near : bank.far);
          }
      for (const r of rows)
        for (const sx of [-1, 1]) {
          const xb = cx + sx * (r.hw + 2);
          if (!(K.mask(xb, r.y) & (PUD | RIM))) K.set(xb, r.y, bank.end);
        }
      const inside = (x, y) => (K.mask(x, y) & PUD) !== 0;
      for (const r of rows)
        for (let x = cx - r.hw; x <= cx + r.hw; x++) {
          const edge = !inside(x - 1, r.y) || !inside(x + 1, r.y) || !inside(x, r.y - 1) || !inside(x, r.y + 1);
          let c;
          if (kind === 'ice') {
            c = r.dy < 0 ? P.ice[2] : P.ice[1];
            if (r.dy > 0 && Math.abs(x - cx) > r.hw - 3) c = P.ice[0];
            // frost creeping in from the banks, in soft blotches (matte: drawn
            // above the reflection); the clear middle stays a dark mirror
            const fr = K.vn(x / 4, r.y / 1.4, 9200 + pi) + (Math.abs(x - cx) / (r.hw + 1)) * 0.55;
            if (fr > 1.02) {
              c = fr > 1.2 ? P.ice[4] : P.ice[3];
              K.over(x, r.y);
            }
            if (edge) {
              c = r.dy <= 0 ? S[6] : P.ice[3]; // frosted rim
              K.over(x, r.y);
            }
          } else if (kind === 'lily') {
            c = mix(P.night[2], P.leaf[2], 0.45);
            if (r.dy < 0) c = mix(P.night[3], P.leaf[3], 0.4);
            if (r.dy > 0 && Math.abs(x - cx) > r.hw - 2) c = mix(P.night[1], P.leaf[1], 0.4);
          } else {
            c = P.night[2];
            if (r.dy < 0) c = P.night[3];
            if (r.dy > 0 && Math.abs(x - cx) > r.hw - 2) c = P.night[1];
          }
          K.set(x, r.y, c);
        }
      const top = rows[0];
      const sh = Math.round(top.hw * 0.45);
      const sx0 = cx - Math.round(top.hw * 0.35);
      if (kind !== 'ice') for (let x = sx0; x < sx0 + sh; x++) K.set(x, top.y + 1, kind === 'lily' ? mix(P.night[4], P.leaf[3], 0.3) : P.night[4]);
      if (kind === 'ice') iceCracks(K, p, pi);
      if (kind === 'lily') lilies(K, p, pi);
    });
  }

  function iceCracks(K, p, pi) {
    const r = HD.rng(9100 + pi);
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    const ins = (x, y) => (K.mask(x, y) & K.PUD) !== 0;
    const ix = cx + Math.round((r() - 0.5) * p.rx * 0.6);
    const iy = cy;
    const n = p.rx > 16 ? 5 : 3;
    const line = (x0, y0, x1, y1, c) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(x0 + ((x1 - x0) * s) / steps);
        const y = Math.round(y0 + ((y1 - y0) * s) / steps);
        if (!ins(x, y)) return;
        K.set(x, y, c);
        K.over(x, y);
      }
    };
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.6;
      const len = p.rx * (0.45 + r() * 0.5);
      const ex = ix + Math.cos(a) * len;
      const ey = iy + Math.sin(a) * len * (p.ry / p.rx) * 1.6;
      // a kinked crack: two segments
      const mx = ix + (ex - ix) * 0.5 + (r() - 0.5) * 2;
      const my = iy + (ey - iy) * 0.5;
      line(ix, iy, mx, my, P.ice[4]);
      line(mx, my, ex, ey, k % 2 ? P.ice[3] : P.ice[4]);
    }
    K.set(ix, iy, P.ice[5]);
    K.over(ix, iy);
    // a cold glint on the far side
    const gx = cx - Math.round(p.rx * 0.45);
    for (let x = gx; x < gx + 3; x++) if (ins(x, cy - Math.round(p.ry) + 1)) (K.set(x, cy - Math.round(p.ry) + 1, P.ice[5]), K.over(x, cy - Math.round(p.ry) + 1));
  }

  function lilies(K, p, pi) {
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);
    const pads = [
      [
        [-17, 0, 6],
        [-9, 2, 5],
        [-3, -1, 4],
        [4, 1, 6],
        [13, -1, 5],
        [15, 2, 4],
      ],
      [
        [-7, 0, 5],
        [3, 1, 4],
      ],
      [
        [-9, 0, 5],
        [1, -1, 4],
        [6, 1, 5],
      ],
    ][pi] || [];
    const ins = (x, y) => (K.mask(x, y) & K.PUD) !== 0;
    const put = (x, y, c) => {
      if (!ins(x, y)) return;
      K.set(x, y, c);
      K.over(x, y);
    };
    const padHi = mix(P.leaf[7], P.gold[4], 0.18);
    for (const [dx, dy, w] of pads) {
      const x0 = cx + dx;
      const y0 = cy + dy;
      // a pad seen low: a flat oval with a notch, lit far rim, dark water line
      for (let i = 0; i < w; i++) put(x0 + i, y0, i === w - 1 ? P.leaf[4] : i === 0 ? P.leaf[5] : P.leaf[6]);
      for (let i = 1; i < w - 1; i++) if (!(w >= 5 && i === 2)) put(x0 + i, y0 - 1, i === 1 ? padHi : P.leaf[7]);
      for (let i = 1; i < w - 1; i++) put(x0 + i, y0 + 1, P.leaf[2]); // waterline shadow
    }
    if (pi === 0) {
      // the one water lily, on the far right pad
      const fx = cx + 6;
      const fy = cy - 2;
      put(fx + 1, fy - 1, P.blossom[7]);
      put(fx, fy, P.blossom[6]);
      put(fx + 1, fy, P.gold[5]);
      put(fx + 2, fy, P.blossom[6]);
      put(fx - 1, fy + 1, P.blossom[5]);
      put(fx + 3, fy + 1, P.blossom[5]);
      put(fx, fy + 1, P.blossom[7]);
      put(fx + 2, fy + 1, P.blossom[7]);
      put(fx + 1, fy + 1, P.blossom[6]);
    }
  }

  function grass(K, ramp, o) {
    const r = HD.rng(o.seed || 4242);
    const { BACK, FRONT, PUD, RIM, STONE, MUD, FIRE } = K;
    for (let y = BACK - 1; y < FRONT; y++) {
      const d = K.depth(y);
      const count = Math.round(W * (0.06 + 0.13 * d) * (o.dens || 1));
      for (let k = 0; k < count; k++) {
        const x = Math.floor(r() * W);
        const cl = K.vn(x / 8, y / 3, 77);
        if (r() > cl * 1.7 - 0.55) continue;
        const m = K.mask(x, y);
        if (m & (PUD | RIM | STONE | FIRE)) continue;
        if (m & MUD && r() < 0.85) continue;
        if (o.skip && o.skip(x, y)) continue;
        K.tuft(x, y, d, r, y < BACK + 3, ramp, o.hk);
      }
    }
  }

  function pathStones(K, ramp, o) {
    const len = K.pathLen();
    const n = 4;
    const stones = [];
    for (let i = 0; i < n; i++) {
      const s = 2 + (i / (n - 1)) * (len - 4.5);
      const p = K.pathPoint(s);
      const d = K.depth(p[1]);
      const side = i % 2 ? 2.2 : -2.0;
      stones.push({ x: p[0] + side, y: p[1] + 0.3, rx: 5.4 + d * 2.2 + (i === 1 ? 0.8 : 0), ry: 1.5 + d * 0.8, seed: 900 + i * 13, i });
    }
    const use = stones.filter((s) => !o.only || o.only(s));
    if (o.mud !== false)
      for (const s of use)
        for (let y = Math.floor(s.y - s.ry - 1); y <= s.y + s.ry + 2; y++)
          for (let x = Math.floor(s.x - s.rx - 3); x <= s.x + s.rx + 3; x++) {
            const e = ((x - s.x) / (s.rx + 2.5)) ** 2 + ((y - s.y - 0.5) / (s.ry + 1.6)) ** 2;
            if (e < 1 && K.vn(x / 3, y / 1.5, 71) > 0.35 + e * 0.3) K.set(x, y, e > 0.7 ? o.mud3 || P.soil[3] : o.mud4 || P.soil[4]);
          }
    const pix = [];
    for (const s of use) pix.push(K.stone(s.x, s.y, s.rx, s.ry, s.seed));
    if (o.cap) {
      // snow resting on the far half of each stone
      for (const sp of pix) {
        const set = new Set(sp.map((q) => q[0] + ',' + q[1]));
        for (const [x, y] of sp) if (!set.has(x + ',' + (y - 1)) && HD.hash(x, y, 5) < o.cap) K.set(x, y, S[6]);
      }
    }
    const r = HD.rng(1717);
    for (const s of use) {
      const yb = Math.round(s.y + s.ry + 1);
      for (let k = 0; k < 3; k++) {
        const x = Math.round(s.x - s.rx + r() * s.rx * 2);
        K.tuft(x, yb + 1, K.depth(yb), r, false, ramp);
      }
    }
  }

  function backEdge(K, c, o) {
    const r = HD.rng(808);
    const { BACK } = K;
    for (let x = 0; x < W; x++) {
      const n = K.vn(x / 7, 0, 66);
      const h = n > 0.66 ? 2 : n > 0.36 ? 1 : 0;
      for (let j = 1; j <= h; j++) K.set(x, BACK - j, j === h && o && o.top ? o.top(x) || c : c);
      if (r() < (o && o.stalks !== undefined ? o.stalks : 0.07)) {
        const hh = 1 + Math.floor(r() * 2);
        const lean = r() < 0.5 ? 1 : 0;
        for (let j = 1; j <= h + hh; j++) K.set(x + (j === h + hh ? lean : 0), BACK - j, o && o.stalk ? o.stalk : c);
      }
    }
  }

  function turfLip(K, ramp, o) {
    const r = HD.rng(2380);
    const { FRONT } = K;
    for (let x = 0; x < W; x++) {
      const n = K.vn(x / 4, 1, 39);
      K.set(x, FRONT, n > 0.55 ? ramp[3] : ramp[2]);
      K.set(x, FRONT + 1, n > 0.7 ? ramp[2] : ramp[1]);
    }
    for (let x = 0; x < W; x++) {
      const cl = K.vn(x / 6, 7, 41);
      if (r() > cl * 1.1 - 0.15) continue;
      const len = Math.round((1 + Math.floor(r() * (2 + cl * 4))) * (o.len || 1));
      const dir = r() < 0.5 ? -1 : 1;
      let xx = x;
      for (let j = 0; j < len; j++) {
        const y = FRONT + 1 + j;
        if (j === len - 1 && len >= 3) xx += dir;
        K.setLit(xx, y, j === 0 ? ramp[4] : j < len - 1 ? ramp[3] : ramp[2], 1);
      }
    }
  }

  /**
   * Frost the topsoil band of the cut face (snow editions): a cold blue-grey
   * frozen layer with glassy ice lenses and a fringe of needle ice where it
   * meets the unfrozen soil below.
   */
  function frozenLayer(K, thickness) {
    const { FRONT } = K;
    const { C } = K.raw();
    const memo = [new Map(), new Map()];
    const frost = (c, k) => {
      const m = memo[k > 0.5 ? 0 : 1];
      let v = m.get(c);
      if (!v) m.set(c, (v = mix(c, P.ice[2], k)));
      return v;
    };
    // thickness may vary along x (it thaws to nothing under a fire)
    const th = typeof thickness === 'function' ? thickness : () => thickness;
    const thin = (x) => th(x) < 1.5;
    const fl = (x) => FRONT + 2 + Math.round(th(x) + (K.vn(x / 11, 5, 61) - 0.5) * 2.6 * Math.min(1, th(x) / 4));
    for (let x = 0; x < W; x++) {
      if (th(x) < 0.5) continue;
      const yb = fl(x);
      for (let y = FRONT + 2; y <= yb; y++) {
        const k = K.at(x, y);
        if (k < 0 || !C[k]) continue;
        const deep = (y - FRONT - 2) / Math.max(1, yb - FRONT - 2);
        C[k] = frost(C[k], deep < 0.75 ? 0.55 : 0.38);
      }
      // the frost front: a broken pale line with needle ice hanging from it
      if (thin(x)) continue;
      if (HD.hash(x, 9, 61) > 0.22) K.set(x, yb + 1, mix(P.soil[3], P.ice[3], 0.45));
      const nd = K.vn(x / 5, 6, 62);
      if (nd > 0.55 && HD.hash(x, 10, 61) < 0.55 && th(x) >= 3) {
        const len = 1 + Math.floor(HD.hash(x, 13, 61) * 2.4);
        for (let j = 0; j < len; j++) K.set(x, yb + 2 + j, j === len - 1 ? P.ice[2] : mix(P.ice[3], P.soil[3], 0.3));
      }
    }
    // ice lenses: short glassy streaks in the frozen band
    const r = HD.rng(6161);
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(r() * W);
      const yb = fl(x);
      const y = FRONT + 4 + Math.floor(r() * Math.max(1, yb - FRONT - 4));
      const len = 3 + Math.floor(r() * 4);
      if (th(x) < 3 || th(x + len) < 3) continue;
      for (let j = 0; j < len; j++) K.set(x + j, y, j === 0 ? P.ice[5] : j < len - 1 ? P.ice[4] : P.ice[3]);
      K.set(x + 1, y + 1, P.ice[1]);
    }
  }

  // ------------------------------------------------------------------
  // snow surfaces
  // ------------------------------------------------------------------
  function distToPath(x, y, pts, ky) {
    let best = 1e9;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const k = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      const d = Math.hypot(x - ax - dx * k, (y - ay - dy * k) * (ky || 1.8));
      if (d < best) best = d;
    }
    return best;
  }
  const TRAIL = [
    [221, 213],
    [214, 220],
    [206, 227],
    [198, 235],
    [195, 238],
  ];
  // the winter trail wanders a little: a gentle S through the deep snow
  const WTRAIL = [
    [221, 213],
    [219, 218],
    [213, 223],
    [205, 228],
    [199, 233],
    [197, 238],
  ];
  const SNOWMAN_TRAIL = [
    [224, 215],
    [262, 219],
    [300, 221],
    [337, 223],
  ];

  /** nearest point on a polyline: distance, side (+1 right of travel, -1 left) and arc position */
  const PINFO = { d: 0, side: 1, s: 0 };
  function pathInfo(x, y, pts) {
    let best = 1e9;
    let side = 1;
    let at = 0;
    let acc = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const len = Math.sqrt(len2);
      const k = clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1);
      const ex = x - ax - dx * k;
      const ey = y - ay - dy * k;
      const d = Math.hypot(ex, ey);
      if (d < best) {
        best = d;
        side = ex * dy - ey * dx >= 0 ? 1 : -1;
        at = acc + k * len;
      }
      acc += len;
    }
    PINFO.d = best;
    PINFO.side = side;
    PINFO.s = at;
    return PINFO;
  }

  /**
   * Footprints along a polyline: small pressed ovals (2x1 `toe` plus a `heel`
   * pixel behind them), alternating left/right of the line every `step` px.
   */
  function footprints(K, pts, o) {
    let acc = 0;
    let n = 0;
    const step = o.step || 4;
    const off = o.off === undefined ? 1.5 : o.off;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      for (; acc <= len; acc += step, n++) {
        const side = n % 2 ? 1 : -1;
        const fx = ax + ux * acc + uy * side * off;
        const fy = ay + uy * acc - ux * side * off * 0.7;
        const x = Math.round(fx);
        const y = Math.round(fy);
        if (o.onlyOn && !(o.onlyOn(x, y) && o.onlyOn(x + 1, y))) continue;
        if ((K.mask(x, y) | K.mask(x + 1, y)) & (K.PUD | K.RIM)) continue;
        if (o.skip && o.skip(x, y)) continue;
        K.set(x, y, o.toe);
        K.set(x + 1, y, o.toe);
        if (o.heel) {
          // the heel sits behind the print, back toward where the walker came from
          const hx = Math.round(fx + 0.5 - ux * 1.6);
          const hy = Math.round(fy - uy * 1.6);
          if (hy !== y || hx < x || hx > x + 1) K.set(hx, hy, o.heel);
        }
      }
      acc -= len;
    }
  }

  /**
   * Wind-blown drifts as a little heightfield. The wind blows from the left
   * (the rain slants that way in Halloween), so each drift has a long tapering
   * tail on its windward (left) side and a short steep lee face on the right.
   * Kernels are merged with max(), so neighbours join into continuous ridges.
   *   [crest x, crest y, windward length, lee length, half depth, height, bend]
   */
  const DRIFTS = [
    // a few big ones
    [101, 225, 78, 5, 4.4, 3.4, 1.6],
    [46, 212, 40, 4, 3.0, 2.2, -1.2],
    [176, 230, 50, 4, 3.4, 2.4, 1.4],
    [151, 214, 34, 3, 2.4, 1.6, -0.8],
    [478, 227, 66, 4, 4.0, 3.0, 1.4],
    [392, 231, 40, 4, 2.8, 2.0, 1.0],
    [298, 234, 46, 4, 2.6, 1.8, -0.8],
    [448, 212, 30, 3, 2.4, 1.6, -0.8],
    [372, 216, 22, 3, 2.0, 1.4, -0.6],
  ];
  function driftList(K) {
    // plus many small ones scattered off-grid (seeded, deterministic)
    const r = HD.rng(3301);
    const out = DRIFTS.slice();
    for (let tries = 0; tries < 400 && out.length < 34; tries++) {
      const x = Math.round(r() * W);
      const y = Math.round(K.BACK + 6 + r() * (K.FRONT - K.BACK - 10));
      if (out.some((d) => Math.abs(d[1] - y) < 3 && x > d[0] - d[2] - 4 && x < d[0] + d[3] + 6)) continue;
      const big = r();
      out.push([x, y, 8 + big * 14, 2 + Math.round(r()), 1.4 + big * 1.1, 0.9 + big * 0.9, (r() - 0.5) * 1.6]);
    }
    return out;
  }
  function driftField(K, list, atten) {
    const { BACK, FRONT } = K;
    const HF = new Float32Array(W * (FRONT - BACK));
    for (const [cx, cy, lw, ll, ry, h, bend] of list) {
      for (let x = Math.floor(cx - lw); x <= Math.ceil(cx + ll); x++) {
        if (x < 0 || x >= W) continue;
        const dx = x - cx;
        const fw = 1 + dx / lw;
        if (fw <= 0) continue;
        const yc = cy + (dx < 0 ? bend * (dx / lw) ** 2 : 0); // a crescent: the tail curls
        const ryx = ry * (dx < 0 ? 0.5 + 0.5 * fw : 1);
        for (let y = Math.floor(yc - ryx - 1); y <= Math.ceil(yc + ryx + 1); y++) {
          if (y < BACK || y >= FRONT) continue;
          const v = (y - yc) / ryx;
          if (v * v >= 1) continue;
          // long smooth windward tail; on the lee side a blunt rounded end
          // whose face drops away steeply
          let px;
          if (dx < 0) px = fw * fw * (3 - 2 * fw);
          else {
            const lr = ll * Math.sqrt(1 - v * v) + 0.4;
            const fl = 1 - dx / lr;
            if (fl <= 0) continue;
            px = Math.pow(fl, 0.35);
          }
          const hh = h * px * Math.pow(1 - v * v, 1.3) * (0.82 + 0.36 * K.vn(x / 9, y / 2.5, 335)) * atten(x, y);
          const k = (y - BACK) * W + x;
          if (hh > HF[k]) HF[k] = hh;
        }
      }
    }
    return HF;
  }
  /**
   * Rasterise the drift heightfield over the snow, front to back like a
   * voxel terrain, so a nearer drift hides the snow behind it. Drift bodies
   * sit a step brighter than the flat snow, the short lee face on the right
   * is one solid shadow step, and the silhouette top carries a broken crest
   * of short bright segments.
   */
  function paintDrifts(K, HF, base) {
    const { BACK, FRONT, PUD, RIM } = K;
    const hAt = (x, y) => (x < 0 || x >= W || y < BACK || y >= FRONT ? 0 : HF[(y - BACK) * W + x]);
    const OFF = 6;
    const N = FRONT - BACK + OFF + 2;
    const ownH = new Float32Array(N); // per screen row of this column: height of the snow that drew it
    const ownLee = new Uint8Array(N);
    for (let x = 0; x < W; x++) {
      let ybuf = FRONT - 1; // screen rows >= ybuf are already drawn by nearer snow
      ownH.fill(0);
      ownLee.fill(0);
      for (let y = FRONT - 2; y > BACK; y--) {
        const h = hAt(x, y);
        if (K.mask(x, y) & (PUD | RIM)) {
          ybuf = Math.min(ybuf, y);
          continue;
        }
        const ys = y - Math.round(h);
        if (ys >= ybuf) continue; // hidden behind a nearer drift
        if (h < 0.3) {
          ybuf = y;
          continue; // flat snow: keep the base pixel
        }
        const lee = h > 1.4 && (hAt(x + 1, y) - hAt(x - 1, y)) / 2 < -0.4; // steep drop to the right, near the crest
        const b = base[(y - BACK) * W + x];
        // lit from above: the rounded top a step brighter, the face toward
        // us easing back into the flat snow; the lee face one solid shadow step
        const c = lee ? (b <= 4 ? 3 : 4) : clamp(b + (h > 0.8 ? 1 : 0) + (h > 2.2 ? 1 : 0), 4, 6);
        for (let s = ys; s < ybuf; s++) {
          K.set(x, s, S[lee || s === ys ? c : clamp(c - (s - ys >= 2 ? 1 : 0), Math.min(c, b), 6)]);
          const q = s - BACK + OFF;
          if (q >= 0) {
            ownH[q] = h;
            ownLee[q] = lee ? 1 : 0;
          }
        }
        ybuf = ys;
      }
      // broken crest: short bright segments along the silhouette top of the bigger drifts
      for (let q = 1; q < N; q++) {
        const h = ownH[q];
        if (h < 1.3 || ownH[q - 1] > h - 0.6 || ownLee[q]) continue;
        const s = q + BACK - OFF;
        if (K.vn(x / 3.2, s / 3, 337) > 0.5) K.set(x, s, S[7]);
      }
    }
  }

  function deepSnow(K) {
    const { BACK, FRONT } = K;
    const base = new Uint8Array(W * (FRONT - BACK));
    for (let y = BACK; y < FRONT; y++) {
      const d = K.depth(y);
      for (let x = 0; x < W; x++) {
        let v = 4.75 + d * 0.95 + (K.fbm(x / 26, y / 5, 317) - 0.5) * 1.0;
        if (y < BACK + 3) v -= (BACK + 3 - y) * 0.45;
        const i = K.qd(v, x, y, 4, 6, 0);
        base[(y - BACK) * W + x] = i;
        K.set(x, y, S[i]);
      }
    }
    despeckle(K, BACK + 1, FRONT - 1);
    const trailI = (x, y) => pathInfo(x, y, WTRAIL);
    // trail half-width wanders between 2.5 and 4 px
    const hw = (s) => 2.5 + 1.5 * K.vn(s / 6, 3, 319);
    const sm = (a, b, v) => HD.smoothstep(a, b, v);
    const atten = (x, y) => {
      let a = sm(4.5, 10, trailI(x, y).d);
      for (const p of L.puddles) {
        const e = ((x - p.x) / (p.rx + 4)) ** 2 + ((y - p.y) / (p.ry + 2.5)) ** 2;
        a *= sm(1, 1.7, e);
      }
      if (x > 220 && x < 348 && y > 210 && y < 227) a *= 1 - sm(0, 6, Math.min(x - 220, 348 - x, y - 210, 227 - y)); // snowman & sled tracks
      if (y < 218) a *= Math.max(sm(212, 218, y), 1 - sm(150, 160, x), sm(298, 308, x)); // the house front
      a *= sm(FRONT - 1, FRONT - 5, y) * sm(BACK + 1, BACK + 6, y);
      return a;
    };
    paintDrifts(K, driftField(K, driftList(K), atten), base);
    // snow banked against the house and turret walls, with a contact shadow
    for (let x = 164; x <= 302; x++) {
      if (x >= 204 && x <= 236) continue;
      const hb = 1 + Math.round(K.vn(x / 6, 2, 341) * 1.6);
      K.set(x, 206, S[3]);
      K.set(x, 207, HD.hash(x, 1, 206) < 0.5 ? S[4] : S[5]);
      for (let j = 0; j < hb; j++) K.set(x, 208 + j, j === 0 ? S[7] : S[6]);
      K.set(x, 208 + hb, S[5]);
    }
    // the trodden trail from the steps to the front lip: packed, greyer snow.
    // The far (left) bank shows a broken bright crest; the near side has a
    // cold inner shadow and a soft dithered bank.
    for (let y = 210; y < FRONT; y++)
      for (let x = 180; x < 240; x++) {
        const pi = trailI(x, y);
        const w = hw(pi.s);
        const tp = pi.d + (K.vn(x / 2, y / 1.3, 321) - 0.5) * 1.1; // ragged, trampled edges
        if (tp < w) {
          const inner = tp > w - 1 && pi.side > 0 && K.vn(x / 3, y / 2, 322) > 0.35;
          K.set(x, y, inner ? S[3] : K.vn(x / 4, y / 2, 318) < 0.26 ? S[3] : S[4]);
        } else if (tp < w + 1.1 && pi.side < 0) {
          const v = K.vn(x / 2.5, y / 2, 320);
          if (v > 0.25) K.set(x, y, v > 0.55 ? S[7] : S[6]); // far bank crest, broken
        } else if (tp < w + 2.2 && pi.side > 0 && bayer(x, y) < 0.5) K.set(x, y, S[5]); // soft near bank
      }
    footprints(K, WTRAIL, { toe: S[2], heel: S[3], step: 4, off: 1.5 });
    footprints(K, SNOWMAN_TRAIL, { toe: S[3], heel: S[4], step: 4.6, off: 1.4 });
    // sled runner tracks curving away from the sled
    {
      const runner = [
        [322, 216],
        [300, 218],
        [276, 221],
        [262, 223],
      ];
      for (const off of [0, 2]) {
        for (let i = 0; i + 1 < runner.length; i++) {
          const [ax, ay] = runner[i];
          const [bx, by] = runner[i + 1];
          const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
          for (let s = 0; s <= n; s++) {
            const x = Math.round(ax + ((bx - ax) * s) / n);
            const y = Math.round(ay + ((by - ay) * s) / n) + off;
            if (K.mask(x, y) & (K.PUD | K.RIM)) continue;
            K.set(x, y, off ? S[4] : S[3]);
          }
        }
      }
    }
    // where the trail reaches the lip it dents the cornice
    const dent = new Uint8Array(W);
    for (let x = 180; x < 240; x++) {
      const pi = trailI(x, FRONT - 1);
      if (pi.d < hw(pi.s) - 0.5) dent[x] = 1;
    }
    return { dent: (x) => dent[x] === 1 };
  }

  function snowBackEdge(K) {
    const { BACK } = K;
    const r = HD.rng(818);
    for (let x = 0; x < W; x++) {
      const n = K.vn(x / 9, 0, 67);
      const hh = n > 0.62 ? 2 : n > 0.3 ? 1 : 0;
      for (let j = 1; j <= hh; j++) K.set(x, BACK - j, j === hh ? S[4] : S[3]);
      K.set(x, BACK, S[3]);
      // dry stalks poking out of the snow
      if (r() < 0.035) {
        const sh = 2 + Math.floor(r() * 3);
        for (let j = 1; j <= hh + sh; j++) K.set(x + (j === hh + sh && r() < 0.5 ? 1 : 0), BACK - j + 1, P.stone[2]);
      }
    }
  }

  /**
   * Snow cornice hanging over the cut: a moonlit crest along the lip, a
   * rounded lumpy overhang (lit, it catches warm light), a cold underside,
   * a dark shadow line on the soil below and the odd icicle.
   */
  function snowLip(K, o) {
    const { FRONT } = K;
    const deep = o.depth > 2;
    const prof = new Int8Array(W);
    for (let x = 0; x < W; x++) {
      if (o.cover && !o.cover(x)) {
        prof[x] = -1;
        continue;
      }
      // big soft lumps plus a few heavier droops
      let od = o.depth + K.vn(x / 9, 3, 51) * o.var;
      const lump = Math.floor(x / 14);
      if (HD.hash(lump, 3, 52) < (o.droop || 0.18)) {
        const u = (x - lump * 14 - 7) / 7;
        od += Math.max(0, 1 - u * u) * 2.2;
      }
      prof[x] = Math.max(1, Math.round(od));
    }
    // short runs of snow read as pegs on the edge: drop them
    const minRun = o.minRun || 0;
    for (let x = 0; x < W; ) {
      if (prof[x] < 0) {
        x++;
        continue;
      }
      let e = x;
      while (e + 1 < W && prof[e + 1] >= 0) e++;
      if (e - x + 1 < minRun) for (let k = x; k <= e; k++) prof[k] = -1;
      x = e + 1;
    }
    // round off single-pixel steps so the hanging edge reads as soft
    for (let x = 1; x < W - 1; x++) if (prof[x] > 0 && prof[x - 1] > 0 && prof[x + 1] > 0 && prof[x] > prof[x - 1] && prof[x] > prof[x + 1]) prof[x]--;
    // distance to the nearest end of the run (frame edges don't count)
    const endD = new Int16Array(W).fill(99);
    for (let x = 0, d = 99; x < W; x++) endD[x] = d = prof[x] < 0 ? -1 : d + 1;
    for (let x = W - 1, d = 99; x >= 0; x--) {
      d = prof[x] < 0 ? -1 : d + 1;
      endD[x] = Math.min(endD[x], d);
    }
    for (let x = 0; x < W; x++) {
      if (prof[x] < 0) continue;
      // the ends of a run taper over three pixels: thinner overhang, dimmer crest
      const tap = Math.max(0, 2 - endD[x]);
      const dent = o.dent && o.dent(x);
      const od = prof[x] - tap - (dent ? 1 : 0);
      if (deep) {
        // the crest bulges up where the cornice droops (same lumps as the underside)
        const up = dent ? 0 : clamp(Math.round((prof[x] - o.depth) * 0.45 + (K.vn(x / 13, 4, 54) - 0.5) * 1.3), 0, 2);
        const lit = K.vn(x / 3.5, 6, 55) > (up > 0 ? 0.3 : 0.8); // highlights sit on the lumps, not one ruler line
        if (!dent) for (let j = 0; j <= up; j++) K.setLit(x, FRONT - 1 - j, j === up && lit ? S[7] : S[6], 1);
        K.setLit(x, FRONT, dent ? S[5] : S[6], 1);
      } else {
        const c = S[6 - tap];
        if (tap < 2) K.setLit(x, FRONT - 1, c, 1);
        K.setLit(x, FRONT, c, 1);
      }
      for (let j = 1; j <= od; j++) {
        let c = S[5];
        if (j === od) c = S[3]; // cold underside
        else if (j === od - 1 && od > 2) c = S[4];
        else if (j === 1) c = S[deep ? 6 : 5];
        K.setLit(x, FRONT + j, c, 1);
      }
      if (od > 0 || deep) K.setLit(x, FRONT + Math.max(0, od) + 1, P.soil[0], 0);
      if (deep && HD.hash(x, 2, 53) < 0.6) K.setLit(x, FRONT + Math.max(0, od) + 2, P.soil[1], 0);
      // icicles under the overhang (tapering, glassy)
      if (o.icicles && HD.hash(x, 11, 53) < 0.06 && !tap && !dent) {
        const len = 1 + Math.floor(HD.hash(x, 12, 53) * 3.2);
        for (let j = 0; j < len; j++) K.setLit(x, FRONT + od + 1 + j, j === len - 1 ? P.ice[5] : j === 0 ? P.ice[3] : P.ice[4], 0);
      }
    }
  }

  /** patchy snow over grass: returns the snow test */
  function snowPatches(K, ed, seed) {
    const { BACK, FRONT, PUD, RIM, STONE } = K;
    const Hh = FRONT - BACK;
    const on = new Uint8Array(W * Hh);
    const cf = L.campfire;
    for (let y = BACK; y < FRONT; y++) {
      const d = K.depth(y);
      for (let x = 0; x < W; x++) {
        let s = K.vn(x / 30, y / 6.5, seed) * 0.8 + K.vn(x / 9, y / 2.6, seed + 1) * 0.2 + 0.08 * (1 - d);
        if (x > 360 && x < 450) s += 0.12; // shade under the tree
        if (x < 40 || x > 312) s += 0.06;
        if (ed.fire !== 'none') {
          const e = ((x - cf.x) / 44) ** 2 + ((y - cf.base) / 11) ** 2;
          if (e < 1) s -= 0.7 * (1 - e) + 0.15;
        }
        if (distToPath(x, y, TRAIL) < 4) s -= 0.3;
        if (K.mask(x, y) & (PUD | RIM | STONE)) s = 0;
        on[(y - BACK) * W + x] = s > 0.5 ? 1 : 0;
      }
    }
    // clean shapes: drop lone pixels, fill pinholes
    const g = (x, y) => (x < 0 || x >= W || y < BACK || y >= FRONT ? 0 : on[(y - BACK) * W + x]);
    for (let pass = 0; pass < 2; pass++)
      for (let y = BACK; y < FRONT; y++)
        for (let x = 0; x < W; x++) {
          const n = g(x - 1, y) + g(x + 1, y) + g(x, y - 1) + g(x, y + 1);
          if (g(x, y) && n <= 1) on[(y - BACK) * W + x] = 0;
          else if (!g(x, y) && n >= 3 && !(K.mask(x, y) & (PUD | RIM | STONE))) on[(y - BACK) * W + x] = 1;
        }
    for (let y = BACK; y < FRONT; y++)
      for (let x = 0; x < W; x++) {
        if (!g(x, y)) continue;
        // index into the snow ramp: lit top edge, body, cold near edge
        let i = 5;
        if (!g(x, y - 1)) i = 6;
        else if (!g(x, y + 1)) i = 3;
        else if (!g(x - 1, y) || !g(x + 1, y)) i = 4;
        else {
          // soft brighter lumps and solid shallower hollows (no checker dither)
          if (K.vn(x / 7, y / 3, seed + 4) > 0.7) i = 6;
          else if (K.vn(x / 6, y / 2.2, seed + 5) < 0.2) i = 4;
        }
        // snow near the campfire: keep it a step darker so the warm relight
        // reads as glow on snow instead of blowing out to paper-white
        if (ed.fire !== 'none') {
          const e = ((x - cf.x) / 120) ** 2 + ((y - cf.base) / 30) ** 2;
          if (e < 1) i -= e < 0.5 ? 2 : 1;
        }
        K.set(x, y, S[clamp(i, 2, 7)]);
      }
    return g;
  }

  // ------------------------------------------------------------------
  // scatter: leaves, flowers, clover, petals
  // ------------------------------------------------------------------
  const LEAF_SHAPES = [
    [[0, 0, 0], [1, 0, 0], [2, 0, 1]],
    [[0, -1, 0], [1, -1, 0], [1, 0, 0], [2, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [2, 0, 0], [1, -1, 0]],
    [[0, 0, 0], [1, 0, 0], [1, -1, 0], [2, -1, 1]],
    [[0, 0, 0], [1, 0, 2], [2, 0, 0], [1, -1, 0], [1, 1, 1]],
  ];
  const LEAF_COLS = () => [
    [P.autumn[3], P.autumn[2], P.autumn[5]], // orange
    [P.autumn[2], P.autumn[1], P.autumn[4]], // rust
    [mix(P.gold[2], P.autumn[3], 0.45), P.autumn[2], mix(P.gold[3], P.autumn[5], 0.5)], // gold
    [P.red[2], P.red[1], P.red[3]], // red
    [P.wood[5], P.wood[3], P.wood[6]], // brown
  ];
  function leafAt(K, x, y, r, cc, over) {
    const sh = LEAF_SHAPES[Math.floor(r() * LEAF_SHAPES.length)];
    const flip = r() < 0.5;
    for (const [dx, dy] of sh) if (K.mask(x + (flip ? -dx : dx), y + dy) & (K.PUD | K.RIM)) if (!over) return;
    for (const [dx, dy, k] of sh) {
      const xx = x + (flip ? -dx : dx);
      const yy = y + dy;
      if (over && !(K.mask(xx, yy) & K.PUD)) continue;
      K.set(xx, yy, cc[k]);
      if (over) K.over(xx, yy);
    }
  }

  function leafCarpet(K, ed) {
    const { BACK, FRONT, FIRE, PUD, RIM } = K;
    const cols = LEAF_COLS();
    const cf = L.campfire;
    const ring = (x, y) => ((x - cf.x) / 27) ** 2 + ((y - cf.base) / 8) ** 2; // just outside the scorched patch
    const dens = (x, y) => {
      let s = K.fbm(x / 16, y / 3.8, 501) - 0.5;
      if (x > 350) s += 0.22 + (x > 380 && x < 440 ? 0.12 : 0); // under the tree
      if (y < BACK + 7) s += 0.12; // blown against the back and the house
      if (x < 44) s += 0.1;
      if (x > 140 && x < 350) s += 0.1; // the open middle of the yard
      if (distToPath(x, y, TRAIL) < 3.2) s -= 0.6; // the trodden strip along the path
      if (ed.fire !== 'none') {
        if (ring(x, y) < 1) s -= 0.6; // a narrow ring of grass around the fire
        else if (glow(x, y) < 1) s -= 0.18 * (1 - glow(x, y)); // sparser where the fire lights it
      }
      return s;
    };
    // close to the fire the litter is darker, so the relight reads as a warm
    // glow on leaves instead of flattening the pumpkins into one orange sheet
    const glow = (x, y) => ((x - cf.x) / 66) ** 2 + ((y - cf.base) / 15) ** 2;
    const darkLit = mix(P.autumn[1], P.wood[3], 0.4);
    const brownLit = mix(P.autumn[2], P.wood[4], 0.45);
    // leaf litter base: a thick carpet in rusty mid-tones that pick up the
    // fire and window light
    for (let y = BACK + 2; y < FRONT - 1; y++)
      for (let x = 0; x < W; x++) {
        if (K.mask(x, y) & (FIRE | PUD | RIM | K.STONE)) continue;
        const s = dens(x, y);
        if (s <= -0.08) continue;
        const v = K.vn(x / 3, y / 1.4, 503);
        const near = ed.fire !== 'none' && glow(x, y) < 1;
        K.set(x, y, near ? (v > 0.6 ? P.autumn[2] : v > 0.3 ? P.autumn[1] : darkLit) : v > 0.66 ? P.autumn[3] : v > 0.32 ? P.autumn[2] : brownLit);
      }
    const r = HD.rng(5050);
    for (let i = 0; i < 2600; i++) {
      const x = Math.floor(r() * W);
      const y = BACK + 3 + Math.floor(r() * (FRONT - BACK - 4));
      const s = dens(x, y);
      if (r() > (s > 0 ? 0.25 + s * 1.5 : s > -0.08 ? 0.12 : 0.02)) continue;
      if (K.mask(x, y) & FIRE && r() < 0.9) continue;
      const hue = K.vn(x / 26, y / 6, 507);
      const ci = hue < 0.28 ? 3 : hue < 0.45 ? 1 : hue < 0.62 ? 0 : hue < 0.8 ? 2 : r() < 0.5 ? 4 : 0;
      leafAt(K, x, y, r, cols[r() < 0.75 ? ci : Math.floor(r() * cols.length)]);
    }
    // a few leaves afloat
    const fl = [
      [228, 227, 0],
      [244, 229, 2],
      [322, 229, 1],
      [150, 235, 3],
    ];
    for (const [x, y, c] of fl) leafAt(K, x, y, HD.rng(x * 7 + y), cols[c], true);
  }

  /** a light scatter of dry fallen leaves, gathered under the tree and at the edges (dry autumn) */
  function fallenLeaves(K) {
    const { BACK, FRONT, FIRE, MUD } = K;
    const cols = LEAF_COLS();
    const r = HD.rng(5252);
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(r() * W);
      const y = BACK + 3 + Math.floor(r() * (FRONT - BACK - 4));
      let s = K.fbm(x / 14, y / 3.5, 521) - 0.62;
      if (x > 352) s += 0.26 + (x > 380 && x < 440 ? 0.1 : 0);
      if (x < 30) s += 0.12;
      if (r() > (s > 0 ? 0.06 + s * 1.2 : 0.012)) continue;
      if (K.mask(x, y) & (FIRE | MUD | K.STONE)) continue;
      const hue = K.vn(x / 30, y / 6, 527);
      leafAt(K, x, y, r, cols[hue < 0.35 ? 2 : hue < 0.6 ? 4 : hue < 0.8 ? 1 : 0]);
    }
  }

  function lipLeaves(K) {
    const r = HD.rng(5151);
    const cols = LEAF_COLS();
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(r() * W);
      const cc = cols[Math.floor(r() * cols.length)];
      K.setLit(x, K.FRONT, cc[0], 1);
      K.setLit(x + 1, K.FRONT, cc[1], 1);
      if (r() < 0.6) K.setLit(x + (r() < 0.5 ? 0 : 1), K.FRONT + 1, cc[1], 1);
      if (r() < 0.25) K.setLit(x + 1, K.FRONT + 2, cc[1], 1);
    }
  }

  function flowerClumps(K, list, draw) {
    for (const [cx, cy, n, seed] of list) {
      const r = HD.rng(seed);
      for (let i = 0; i < n; i++) {
        const x = Math.round(cx + (r() - 0.5) * (6 + n * 1.6));
        const y = Math.round(cy + (r() - 0.5) * 3);
        if (K.mask(x, y) & (K.PUD | K.RIM | K.STONE)) continue;
        draw(x, y, r, i);
      }
    }
  }

  function springFlowers(K) {
    const G = RAMP.spring;
    const tulipCols = [
      [P.red[3], P.red[4], P.red[2]],
      [P.blossom[4], P.blossom[5], P.blossom[3]],
      [mix(P.gold[3], P.red[4], 0.35), P.gold[4], P.gold[2]],
      [P.blossom[5], P.blossom[6], P.blossom[4]],
    ];
    const tulip = (x, y, r) => {
      const h = 2 + Math.floor(r() * 2);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[3]);
      if (r() < 0.6) K.set(x - 1, y, G[4]); // leaf
      const c = tulipCols[Math.floor(r() * tulipCols.length)];
      K.set(x, y - h, c[0]);
      K.set(x + 1, y - h, c[2]);
      K.set(x - 1, y - h, c[2]);
      K.set(x, y - h - 1, c[1]);
      K.set(x - 1, y - h - 1, c[0]);
      K.set(x + 1, y - h - 1, c[1]);
    };
    const daff = (x, y, r) => {
      const h = 2 + Math.floor(r() * 2);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[4]);
      K.set(x + 1, y, G[3]);
      K.set(x - 1, y - h, P.gold[4]);
      K.set(x + 1, y - h, P.gold[4]);
      K.set(x, y - h - 1, P.gold[5]);
      K.set(x, y - h, P.marigold[4]); // trumpet
    };
    const clumps = [
      [58, 216, 5, 11],
      [150, 213, 4, 12],
      [128, 222, 3, 13],
      [36, 230, 4, 14],
      [266, 212, 4, 15],
      [286, 232, 5, 16],
      [176, 228, 3, 17],
      [92, 233, 4, 18],
      [345, 236, 3, 19],
    ];
    flowerClumps(K, clumps, (x, y, r, i) => ((i + (x & 1)) % 3 === 0 ? daff(x, y, r) : tulip(x, y, r)));
    // fallen blossom petals under the cherry tree
    const r = HD.rng(7070);
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r());
      const x = Math.round(405 + Math.cos(a) * rr * 44);
      const y = Math.round(222 + Math.sin(a) * rr * 9);
      if (K.mask(x, y) & (K.PUD | K.RIM) || y >= K.FRONT - 1) continue;
      K.set(x, y, r() < 0.3 ? P.blossom[6] : P.blossom[5]);
      if (r() < 0.4) K.set(x + 1, y, P.blossom[4]);
    }
  }

  function summerMeadow(K) {
    const G = RAMP.summer;
    const bad = (x, y) => K.mask(x, y) & (K.PUD | K.RIM | K.STONE | K.FIRE);
    // clover: drifts of little trefoils in a lighter, bluer green than the
    // grass, a white clover head in about one cluster in five
    const CL = mix(mix(P.leaf[7], P.moss[6], 0.4), P.night[11], 0.3);
    const CLd = mix(P.leaf[7], P.moss[6], 0.4);
    const CLk = mix(P.leaf[5], P.moss[5], 0.4);
    const r = HD.rng(8080);
    let made = 0;
    for (let tries = 0; tries < 1200 && made < 60; tries++) {
      const cx = Math.floor(r() * W);
      const cy = K.BACK + 6 + Math.floor(r() * (K.FRONT - K.BACK - 8));
      if (K.vn(cx / 18, cy / 4, 809) < 0.5 || bad(cx, cy)) continue;
      made++;
      const n = 4 + Math.floor(r() * 6);
      const head = r() < 0.2;
      for (let k = 0; k < n; k++) {
        const x = Math.round(cx + (r() - 0.5) * 11);
        const y = Math.round(cy + (r() - 0.5) * 3);
        if (bad(x, y) || bad(x - 1, y) || bad(x + 1, y)) continue;
        K.set(x - 1, y, CLd);
        K.set(x + 1, y, CLd);
        K.set(x, y - 1, CL);
        K.set(x, y, CLk);
        if (head && k < 2) {
          K.set(x, y - 2, P.bone[3]);
          K.set(x + 1, y - 2, P.bone[2]);
        }
      }
    }
    // wildflowers with 2x2-ish heads, bright enough to survive the cold ambient
    const corn = [mix(P.night[10], P.violet[6], 0.5), mix(P.night[9], P.violet[5], 0.5)];
    const daisy = (x, y, r) => {
      const h = 2 + Math.floor(r() * 3);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[3]);
      K.set(x - 1, y - h, P.bone[3]);
      K.set(x + 1, y - h, P.bone[3]);
      K.set(x, y - h, P.gold[4]);
      K.set(x, y - h - 1, P.bone[4]);
    };
    const cornflower = (x, y, r) => {
      const h = 3 + Math.floor(r() * 2);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[3]);
      K.set(x, y - h, corn[1]);
      K.set(x + 1, y - h, corn[0]);
      K.set(x, y - h - 1, corn[0]);
      K.set(x + 1, y - h - 1, corn[1]);
    };
    const butter = (x, y, r) => {
      const h = 2 + Math.floor(r() * 2);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[4]);
      K.set(x, y - h, P.gold[4]);
      K.set(x + 1, y - h, P.gold[3]);
      K.set(x, y - h - 1, P.gold[5]);
    };
    const pink = (x, y, r) => {
      const h = 3 + Math.floor(r() * 2);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[3]);
      K.set(x, y - h, P.blossom[5]);
      K.set(x + 1, y - h, P.blossom[4]);
      K.set(x, y - h - 1, P.blossom[6]);
      K.set(x + 1, y - h - 1, P.blossom[5]);
    };
    const kinds = [daisy, cornflower, butter, pink];
    const clumps = [
      [40, 216, 6, 21],
      [150, 214, 5, 22],
      [138, 233, 4, 23],
      [268, 214, 5, 24],
      [286, 233, 6, 25],
      [20, 233, 4, 26],
      [176, 230, 4, 27],
      [345, 236, 4, 28],
      [460, 233, 4, 29],
      [60, 236, 3, 30],
      // the right half and the garden corner
      [300, 224, 5, 31],
      [330, 214, 4, 32],
      [358, 226, 5, 33],
      [384, 233, 5, 34],
      [396, 212, 4, 35],
      [420, 228, 5, 36],
      [446, 218, 4, 37],
      [470, 210, 4, 38],
      [252, 230, 4, 39],
      [318, 234, 4, 40],
    ];
    flowerClumps(K, clumps, (x, y, r, i) => {
      if (bad(x, y)) return;
      kinds[(Math.floor(r() * 4) + i) % 4](x, y, r);
    });
  }

  // ------------------------------------------------------------------
  // dry autumn: swept earth & rangoli
  // ------------------------------------------------------------------
  function sweptPath(K) {
    const { BACK, FRONT, MUD } = K;
    const R = L.seasonal.rangoli;
    const dust = mix(P.soil[6], P.stone[5], 0.45); // packed, swept dust: lighter and cooler than the dry grass
    const dustLo = mix(P.soil[5], P.stone[4], 0.45);
    const arcC = mix(P.soil[6], P.stone[6], 0.5); // broom strokes
    const E = new Float32Array(W * (FRONT - BACK));
    const ev = (x, y) => (x < 0 || x >= W || y < BACK || y >= FRONT ? 9 : E[(y - BACK) * W + x]);
    for (let y = BACK; y < FRONT; y++)
      for (let x = 0; x < W; x++) {
        let e = 9;
        if (x >= 150 && x < 280 && y >= BACK + 4) {
          const dp = distToPath(x, y, TRAIL) / 6.2;
          const da = Math.sqrt(((x - R.x) / (R.rx + 6)) ** 2 + ((y - R.y + 0.5) / (R.ry + 3)) ** 2);
          e = Math.min(dp, da) + (K.vn(x / 3, y / 1.5, 611) - 0.5) * 0.3;
        }
        E[(y - BACK) * W + x] = e;
      }
    for (let y = BACK + 4; y < FRONT; y++)
      for (let x = 150; x < 280; x++) {
        const e = ev(x, y);
        if (e > 1) {
          // a windrow of swept grass and leaf bits along the edge
          if (e < 1.25 && (ev(x - 1, y) <= 1 || ev(x + 1, y) <= 1 || ev(x, y - 1) <= 1 || ev(x, y + 1) <= 1)) {
            const h = HD.hash(x, y, 615);
            K.set(x, y, h < 0.1 ? P.autumn[3] : h < 0.18 ? P.autumn[2] : RAMP.dry[1]);
          }
          continue;
        }
        K.addMask(x, y, MUD);
        let c = dust;
        if (e > 0.86) c = dustLo;
        else if (K.vn(x / 4, y / 1.6, 613) > 0.7) c = dustLo;
        // broom strokes: short arcs
        const arc = Math.sin((x - R.x) * 0.55 + (y - R.y) * 1.9);
        if (arc > 0.9 && e < 0.8 && HD.hash(x, y, 614) < 0.6) c = arcC;
        K.set(x, y, c);
      }
  }

  function rangoli(K) {
    const R = L.seasonal.rangoli;
    const night = (c, k) => mix(c, P.night[2], k === undefined ? 0.58 : k);
    const C = P.rangoli.map((c) => night(c));
    const [mag, ora, yel, grn, blu, pur, wht] = C;
    const rx = R.rx + 0.5;
    const ry = R.ry + 0.5;
    // the near half is a pixel flatter so the pattern stays on dry ground,
    // clear of the big puddle in front of the steps
    const wet = (x, y) => K.mask(x, y) & (K.PUD | K.RIM);
    for (let y = Math.floor(R.y - ry); y <= Math.ceil(R.y + ry); y++)
      for (let x = Math.floor(R.x - rx); x <= Math.ceil(R.x + rx); x++) {
        if (wet(x, y)) continue;
        const u = (x - R.x) / rx;
        const v = (y - R.y) / (y > R.y ? ry - 1 : ry);
        const rr = Math.hypot(u, v);
        if (rr > 1) continue;
        const th = Math.atan2(v, u);
        let c = null;
        if (rr > 0.84) {
          // scalloped border: twelve petals, alternating colours
          const sc = Math.abs(Math.cos(th * 6));
          const k = Math.floor(((th / (Math.PI * 2) + 1) * 12 + 0.5)) % 2;
          if (rr < 0.84 + 0.19 * Math.pow(sc, 0.6)) c = k ? ora : mag;
        } else if (rr > 0.7) c = wht;
        else if (rr > 0.38) {
          const pet = 0.38 + 0.32 * (0.3 + 0.7 * Math.abs(Math.cos(th * 4)));
          const k = Math.floor(((th / (Math.PI * 2) + 1) * 8 + 0.5)) % 2;
          c = rr < pet ? (k ? blu : grn) : yel;
        } else if (rr > 0.2) c = pur;
        else c = rr < 0.1 ? wht : yel;
        if (c) K.set(x, y, c);
      }
    // a ring of chalk-white dots just outside the scallops
    const N = 28;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const sn = Math.sin(a);
      const x = Math.round(R.x + Math.cos(a) * (R.rx + 2.6));
      const y = Math.round(R.y + sn * (R.ry + 1.6 - (sn > 0 ? 1 : 0)));
      if (wet(x, y) || wet(x + 1, y) || wet(x - 1, y)) continue;
      if (K.get(x, y) !== wht) K.set(x, y, wht);
    }
  }

  // ------------------------------------------------------------------
  // the secrets in the cut face
  // ------------------------------------------------------------------
  function stamp(K, rows, x0, y0, map) {
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === '.' || ch === ' ') continue;
        K.set(x0 + x, y0 + y, map[ch]);
        K.addMask(x0 + x, y0 + y, K.COF);
      }
  }
  function pocket(K, cx, cy, rx, ry, fill, rim, seed) {
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + (K.vn(x / 2, y / 1.5, seed) - 0.5) * 0.25;
        if (e > 1.18) continue;
        K.addMask(x, y, K.COF);
        K.set(x, y, e > 0.82 ? rim : typeof fill === 'function' ? fill(x, y, e) : fill);
      }
  }
  const TUN_FLOOR = [P.soil[6], P.stone[3]];
  /**
   * A dug tunnel along a polyline, w px tall: dark interior, a darker ceiling
   * line and a pale packed floor, so the network has readable edges.
   */
  function tunnel(K, pts, c, w) {
    const inside = new Set();
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let s = 0; s <= n; s++) {
        const x = Math.round(ax + ((bx - ax) * s) / n);
        const y = Math.round(ay + ((by - ay) * s) / n);
        for (let j = 0; j < (w || 2); j++) inside.add(x + ',' + (y + j));
      }
    }
    const isIn = (x, y) => inside.has(x + ',' + y);
    for (const k of inside) {
      const [x, y] = k.split(',').map(Number);
      K.set(x, y, c);
      K.addMask(x, y, K.COF);
    }
    for (const k of inside) {
      const [x, y] = k.split(',').map(Number);
      if (!isIn(x, y - 1) && !(K.mask(x, y - 1) & K.COF) && y - 1 > K.FRONT + 1) K.set(x, y - 1, P.soil[1]);
      if (!isIn(x, y + 1) && !(K.mask(x, y + 1) & K.COF)) {
        K.set(x, y + 1, TUN_FLOOR[HD.hash(x, y, 977) < 0.35 ? 1 : 0]);
        K.addMask(x, y + 1, K.COF);
      }
    }
  }

  const SECRET = {};
  // hibernating frog curled in a mud pocket
  SECRET['hibernating-frog'] = (K) => {
    pocket(K, 367, 253, 10, 4.2, (x, y) => (K.vn(x / 3, y / 2, 701) > 0.6 ? P.soil[2] : mix(P.soil[1], P.violet[1], 0.5)), P.soil[0], 702);
    // dormant colours: muted moss/vine greens, not the saturated leaf ramp
    const fr = { h: mix(P.moss[6], P.vine[4], 0.35), G: mix(P.moss[5], P.vine[4], 0.5), d: P.leaf[3], k: P.soil[0], b: mix(P.bone[1], P.moss[5], 0.5), T: mix(P.bone[1], P.moss[6], 0.4) };
    // curled up, head to the left: a hind leg folded along the lower right
    // (its crease a darker line), two little toes tucked under the chin
    stamp(K, [
      '..hhh.......',
      '.hGkGh..hh..',
      'hGGGGGhhGGh.',
      'GGGGGGdGGGGh',
      'bGGGGdGhGGGd',
      'bbGGdGGGGGd.',
      '.TbT.dddd...',
    ], 361, 250, fr);
    // breathing: the back rises by a pixel across two columns
    return { breathe: [[368, 250, fr.h], [369, 250, fr.h]] };
  };
  // a rabbit asleep at the end of its burrow
  SECRET['rabbit-burrow'] = (K) => {
    tunnel(K, [[326, 241], [334, 245], [344, 249], [352, 252]], P.soil[0], 3);
    // the burrow mouth: a dark notch just under the turf lip
    for (let x = 323; x <= 329; x++) K.set(x, K.FRONT + 2, x === 323 || x === 329 ? P.soil[1] : P.soil[0]);
    pocket(K, 366, 253, 12, 4.6, P.soil[1], P.soil[0], 711);
    for (let x = 355; x <= 377; x++) if (!(K.mask(x, 258) & K.COF)) K.set(x, 258, TUN_FLOOR[HD.hash(x, 258, 977) < 0.35 ? 1 : 0]);
    // dry grass bedding
    for (let x = 356; x <= 377; x++) if (HD.hash(x, 7, 712) < 0.7) K.set(x, 256 + (HD.hash(x, 8, 712) < 0.3 ? 1 : 0), P.vine[3]);
    const rbB = mix(P.stone[6], P.wood[6], 0.45);
    const rb = { E: mix(P.stone[5], P.wood[5], 0.4), p: P.blossom[4], B: rbB, h: mix(P.stone[7], P.bone[2], 0.5), k: P.soil[0], n: P.blossom[5], T: P.bone[3], b: mix(rbB, P.bone[2], 0.4), d: P.stone[2] };
    stamp(K, ['....EEEEE.....', '..EEppppEE....', '.hhBBBBBBhhh..', 'hBBkBBBBBBBBh.', 'nBBBBBBBBBBBBT', '.BBBbbbBBBBBTT', '..ddd..ddddd..'], 359, 249, rb);
    return { breathe: [369, 251, rb.h] };
  };
  // ant colony: tunnels, chambers with eggs, ants on the move (4 fps)
  const ANT_PATHS = [
    [[318, 241], [322, 245], [320, 249], [327, 252], [335, 252]],
    [[335, 252], [343, 249], [352, 249], [360, 251], [367, 251]],
    [[320, 249], [314, 252], [308, 256]],
    [[352, 249], [354, 255], [366, 257], [378, 256]],
  ];
  SECRET['ant-colony'] = (K) => {
    for (const p of ANT_PATHS) tunnel(K, p, P.soil[0], 3);
    const ch = [
      [337, 252, 4, 1.6],
      [369, 251, 4.5, 1.8],
      [306, 256, 3.5, 1.5],
      [380, 256, 4, 1.6],
    ];
    for (const [x, y, rx, ry] of ch) pocket(K, x, y + 0.5, rx, ry, P.soil[0], P.soil[1], x);
    // eggs and a crumb store
    for (const [x, y] of [[366, 251], [368, 252], [370, 251], [372, 252], [303, 256], [305, 257]]) {
      K.set(x, y, P.bone[2]);
      K.set(x + 1, y, P.bone[1]);
    }
    for (const [x, y] of [[378, 256], [380, 257], [382, 256]]) K.set(x, y, P.gold[3]);
    // a pale packed floor under the chambers too, so the whole network reads
    for (let y = 240; y < 262; y++)
      for (let x = 298; x < 392; x++)
        if (K.mask(x, y) & K.COF && !(K.mask(x, y + 1) & K.COF) && K.get(x, y) === P.soil[0]) K.set(x, y + 1, TUN_FLOOR[HD.hash(x, y, 977) < 0.35 ? 1 : 0]);
    return { ants: true };
  };
  // a squirrel's acorn cache
  SECRET['squirrel-stash'] = (K) => {
    tunnel(K, [[336, 241], [342, 245], [350, 249]], P.soil[0], 3);
    pocket(K, 364, 252.5, 13, 5.4, P.soil[1], P.soil[0], 721);
    for (let x = 354; x <= 375; x++) if (HD.hash(x, 7, 722) < 0.8) K.set(x, 256 + (HD.hash(x, 9, 722) < 0.3 ? 1 : 0), HD.hash(x, 5, 722) < 0.5 ? P.autumn[2] : P.autumn[1]);
    // muted, unlit nut browns (found in the soil, not glowing): caps dark
    // with a darker rim underneath and one small highlight
    const ac = { s: P.wood[3], c: P.wood[2], H: P.wood[5], u: P.wood[1], N: mix(P.wood[6], P.autumn[3], 0.35), n: P.wood[4], d: P.wood[2] };
    const A = ['.s..', 'cHcc', 'uuuc', 'nNNn', '.nd.'];
    const B = ['..s.', 'ccHc', 'cuuu', 'nNnn', '.dn.'];
    // piled loosely, not in rows
    const heap = [[359, 246], [364, 247], [354, 249], [360, 250], [366, 249], [351, 252], [356, 253], [362, 252], [367, 253], [372, 252]];
    heap.forEach(([x, y], i) => stamp(K, i % 2 ? A : B, x, y, ac));
    // one acorn rolled aside, and a lost cap
    stamp(K, B, 377, 253, ac);
    stamp(K, ['cHc', 'uuu'], 372, 248, ac);
    return {};
  };
  // a clay pot of gold coins, tipped over
  SECRET['clay-pot'] = (K) => {
    pocket(K, 366, 253, 14, 5, P.soil[1], P.soil[0], 731);
    // terracotta pot lying on its side: round belly, a narrower neck, then
    // the rim seen as an upright ellipse around the dark mouth, facing right
    const pc = { P: P.pumpkin[2], h: P.pumpkin[3], H: P.pumpkin[4], d: P.pumpkin[1], D: P.pumpkin[0], n: P.pumpkin[2], R: P.pumpkin[4], r: P.pumpkin[3], m: P.soil[0], k: P.gold[1], c: P.gold[2], g: P.gold[3], G: P.gold[4] };
    stamp(K, [
      '..DdPPdD........',
      '.dPhhPPPPd...RR.',
      'dPhHhPPPPPndrmmR',
      'dPhhPPPPPPddrmmR',
      'dPPPPPPPPPddrmmR',
      '.DdPPPPPPd...RR.',
      '..DDDDDDD.......',
    ], 352, 249, pc);
    // coins spilling from the mouth onto the floor of the hollow: dull gold,
    // one small highlight (the occasional glint is animated)
    stamp(K, [
      '..g........',
      '.cgc.......',
      '.kcGgc.....',
      'kcgcgckgc..',
      '.kckcgkckck',
    ], 365, 253, pc);
    return { glint: [[368, 255], [367, 254], [372, 256]] };
  };
  // hedgehog asleep in a leaf nest
  SECRET['hedgehog'] = (K) => {
    // a dark hollow; a cup of dry leaves (dull browns, a few rusty ones)
    // lines its floor and sides
    pocket(K, 366, 253, 12, 4.8, (x, y, e) => {
      const h = HD.hash(x >> 1, y, 742);
      const cup = y >= 254 || e > 0.55 + (y - 249) * 0.02;
      if (!cup) return K.vn(x / 3, y / 2, 744) > 0.75 ? P.soil[1] : P.soil[0];
      return h < 0.07 ? P.autumn[2] : K.vn(x / 2, y / 1.5, 741) > 0.55 ? P.wood[3] : h < 0.8 ? P.wood[2] : P.soil[1];
    }, P.soil[0], 743);
    // curled up asleep, facing left: a domed dark spine mass with a few
    // irregular pale tips, tapering to a pale pointed face with a dark nose
    // and a closed eye
    const hh = { T: P.wood[4], t: P.wood[2], u: P.wood[5], s: mix(P.stone[6], P.bone[1], 0.5), F: mix(P.bone[2], P.bone[1], 0.4), f: P.bone[1], g: mix(P.bone[1], P.wood[4], 0.5), k: P.soil[0], e: P.wood[1], d: P.soil[0] };
    stamp(K, [
      '.......sTtsu...',
      '.....stTuTtTs..',
      '...FfuTtTTsTu..',
      '..FFeeTsTuTtTs.',
      '.FFFfgTtTTuTTTd',
      'kFfffgTTtTTtTTd',
      '..dddddddddddd.',
    ], 356, 249, hh);
    // breathing: the dome swells by a pixel row
    return { breathe: [[364, 248, hh.T], [365, 248, hh.s], [366, 248, hh.T]] };
  };
  // a small tin time capsule tied with a red ribbon
  SECRET['time-capsule'] = (K) => {
    pocket(K, 367, 253, 11, 4.6, P.soil[1], P.soil[0], 751);
    const tc = { L: P.stone[6], l: P.stone[5], d: P.stone[2], B: P.stone[4], b: P.stone[3], r: P.red[3], R: P.red[4], g: P.gold[3], x: P.autumn[2] };
    stamp(K, ['.LLLLLRLLLLL.', 'lllllRRllllll', 'ddddddgdddddd', 'BBBBBRgBBBBBb', 'BxBBBrBBBBBBb', 'bBBBBrBBBBxbb', '.dddddddddddd'], 361, 250, tc);
    return {};
  };

  // ------------------------------------------------------------------
  // variants
  // ------------------------------------------------------------------
  function under(K, ed, o) {
    // strata, frost, pebbles, secret, roots, (worm), fade
    K.paintStrata();
    if (o.frozen) frozenLayer(K, o.frozen);
    K.paintPebbles();
    let sec = {};
    for (const t of ed.tags) if (t.startsWith('secret-') && SECRET[t.slice(7)]) sec = SECRET[t.slice(7)](K) || {};
    K.paintRoots();
    if (o.worm) K.paintWormTunnel();
    return sec;
  }

  const VARIANT = {
    spring(K, ed) {
      const G = RAMP.spring;
      fillTop(K, G, { lo: 2, hi: 4 });
      K.paintMud(mudSpotsFor(ed, { k: 0.8, tree: 0.45 }), false);
      puddles(K, 'water', { far: P.soil[2], near: P.soil[1], end: P.soil[4] });
      grass(K, G, { dens: 1.1 });
      pathStones(K, G, {});
      springFlowers(K);
      backEdge(K, G[1]);
      const sec = under(K, ed, { worm: true });
      turfLip(K, G, { len: 1.1 });
      return Object.assign(sec, { worm: true });
    },
    summer(K, ed) {
      const G = RAMP.summer;
      fillTop(K, G, { lo: 1, hi: 4, base: 1.5 });
      K.paintMud(mudSpotsFor(ed, { k: 0.75, noSteps: false }), true);
      puddles(K, 'lily', { far: mix(P.soil[2], P.leaf[2], 0.4), near: P.soil[1], end: P.leaf[3] });
      grass(K, G, { dens: 1.35, hk: 1.4 });
      pathStones(K, G, {});
      summerMeadow(K);
      backEdge(K, G[1], { stalks: 0.14 });
      const sec = under(K, ed, { worm: true });
      turfLip(K, G, { len: 1.5 });
      return Object.assign(sec, { worm: true });
    },
    leafy(K, ed) {
      const G = RAMP.leafy;
      fillTop(K, G, { lo: 1, hi: 4 });
      K.paintMud(mudSpotsFor(ed, { k: 0.75, tree: 0.3, fireR: [22, 6.5] }), true);
      puddles(K, 'water', { far: P.soil[2], near: P.soil[1], end: P.soil[4] });
      grass(K, G, { dens: 0.75 });
      pathStones(K, G, {});
      leafCarpet(K, ed);
      backEdge(K, G[1]);
      const sec = under(K, ed, { worm: true });
      turfLip(K, G, { len: 0.9 });
      lipLeaves(K);
      return Object.assign(sec, { worm: true });
    },
    'dry-autumn'(K, ed) {
      const G = RAMP.dry;
      fillTop(K, G, { lo: 1, hi: 4, damp: 0.5 });
      K.paintMud(mudSpotsFor(ed, { k: 0.55, noSteps: true }), true);
      puddles(K, 'water', { far: P.soil[2], near: P.soil[1], end: P.soil[4] });
      sweptPath(K);
      grass(K, G, { dens: 0.72, hk: 1.1 });
      fallenLeaves(K);
      rangoli(K);
      backEdge(K, G[1], { stalks: 0.1 });
      const sec = under(K, ed, { worm: true });
      turfLip(K, G, { len: 1 });
      return Object.assign(sec, { worm: true });
    },
    snow(K, ed) {
      const ds = deepSnow(K);
      puddles(K, ed.tagSet.has('frozen-puddles') ? 'ice' : 'water', { far: S[3], near: S[6], end: S[5] });
      snowBackEdge(K);
      const sec = under(K, ed, { frozen: 9 });
      snowLip(K, { depth: 3, var: 2.2, icicles: true, dent: ds.dent });
      return sec;
    },
    'thin-snow'(K, ed) {
      const G = RAMP.frost;
      fillTop(K, G, { lo: 1, hi: 4 });
      const fire = ed.fire !== 'none';
      K.paintMud(mudSpotsFor(ed, { k: 0.7, noPuddles: false }), !fire);
      const ice = ed.tagSet.has('frozen-puddles');
      puddles(K, ice ? 'ice' : 'water', { far: ice ? S[3] : P.soil[2], near: ice ? S[5] : P.soil[1], end: ice ? S[4] : P.soil[4] });
      grass(K, G, { dens: 0.8 });
      pathStones(K, G, { cap: 0.55 });
      const snowy = snowPatches(K, ed, ed.id === 'lunar' ? 421 : 431);
      // a few grass blades still poke through the snow
      const r = HD.rng(4321);
      for (let i = 0; i < 160; i++) {
        const x = Math.floor(r() * W);
        if (K.vn(x / 12, i, 4322) < 0.6) continue; // in small clumps only
        const y = K.BACK + 4 + Math.floor(r() * (K.FRONT - K.BACK - 5));
        if (!snowy(x, y) || !snowy(x, y + 1)) continue;
        K.set(x, y, G[3]);
        if (r() < 0.5) K.set(x + (r() < 0.5 ? 1 : 0), y - 1, G[4]);
      }
      // footprints across the snow
      if (ed.id === 'lunar') footprints(K, SNOWMAN_TRAIL, { toe: S[3], heel: S[4], step: 4.6, off: 1.4, onlyOn: snowy });
      else
        footprints(
          K,
          [
            [212, 216],
            [180, 222],
            [150, 228],
            [132, 231],
          ],
          { toe: S[3], heel: S[4], step: 4.4, off: 1.4, onlyOn: snowy },
        );
      if (ed.id === 'lunar') redPaper(K);
      if (ed.id === 'newyear') confetti(K);
      backEdge(K, G[1], { top: (x) => (K.vn(x / 9, 0, 67) > 0.45 ? S[4] : null) });
      // the fire has thawed the ground under it: no snow on the lip there and
      // the frozen topsoil thins out to nothing
      const cfx = L.campfire.x;
      const thaw = (x) => (fire ? clamp((Math.abs(x - cfx) - 34) / 26, 0, 1) : 1);
      const sec = under(K, ed, { frozen: (x) => 6 * thaw(x) });
      if (fire)
        for (let x = cfx - 40; x <= cfx + 40; x++)
          if (thaw(x) < 0.15 && HD.hash(x, 3, 771) < 0.7) K.set(x, K.FRONT + 2, mix(P.soil[1], P.night[2], 0.3)); // damp
      turfLip(K, G, { len: 0.7 });
      const cover = (x) => (snowy(x, K.FRONT - 1) || snowy(x, K.FRONT - 2)) && !(fire && Math.abs(x - cfx) < 40);
      snowLip(K, { depth: 1, var: 1.2, cover, minRun: 14 });
      return sec;
    },
  };

  // firecracker paper scraps on the snow by the porch (lunar)
  function redPaper(K) {
    const r = HD.rng(9393);
    for (const [cx, cy, n] of [
      [244, 210, 9],
      [200, 211, 6],
      [252, 214, 4],
    ])
      for (let i = 0; i < n; i++) {
        const x = Math.round(cx + (r() - 0.5) * 12);
        const y = Math.round(cy + (r() - 0.5) * 3);
        K.set(x, y, r() < 0.5 ? P.red[3] : P.red[4]);
        if (r() < 0.6) K.set(x + 1, y, P.red[2]);
      }
  }
  // a curl of streamer and a little confetti by the porch (newyear)
  function confetti(K) {
    const cols = [P.gold[4], P.red[4], P.night[9], P.violet[5], P.leaf[6]];
    const r = HD.rng(9494);
    for (const [cx, cy, n] of [
      [246, 211, 8],
      [196, 212, 6],
    ])
      for (let i = 0; i < n; i++) K.set(Math.round(cx + (r() - 0.5) * 12), Math.round(cy + (r() - 0.5) * 3), cols[Math.floor(r() * cols.length)]);
  }

  // ------------------------------------------------------------------
  // per-frame bits: breathing sleepers, ants, a coin glint
  // ------------------------------------------------------------------
  function makeAnim(sec) {
    const fns = [];
    if (sec.breathe) {
      // [x, y, colour] of a single pixel swelling above it, or a list of
      // [x, y, colour] pixels drawn as they are
      const px = Array.isArray(sec.breathe[0]) ? sec.breathe : [[sec.breathe[0], sec.breathe[1] - 1, sec.breathe[2]]];
      fns.push((g, t) => {
        if (T.phase(t, 4.2) < 0.42) for (const [x, y, c] of px) g.em.px(x, y, c);
      });
    }
    if (sec.ants) {
      const paths = ANT_PATHS.map((pts) => {
        const out = [];
        for (let i = 0; i + 1 < pts.length; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[i + 1];
          const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
          for (let s = i ? 1 : 0; s <= n; s++) out.push([Math.round(ax + ((bx - ax) * s) / n), Math.round(ay + ((by - ay) * s) / n)]);
        }
        return out;
      });
      const ants = [];
      for (let i = 0; i < 9; i++) ants.push({ p: paths[i % paths.length], per: 14 + (i % 4) * 3.5, off: HD.hash(i, 3, 77) });
      const body = P.red[2];
      const head = P.red[3];
      fns.push((g, t) => {
        const ts = T.step(t, 4);
        const f4 = Math.floor(ts * 4);
        for (let i = 0; i < ants.length; i++) {
          const a = ants[i];
          const wig = (f4 + i) & 1; // each ant bobs on its own beat
          const ph = T.phase(ts, a.per, a.off);
          const u = ph < 0.5 ? ph * 2 : 2 - ph * 2; // there and back
          const n = a.p.length;
          const k = Math.min(n - 1, Math.floor(u * (n - 1)));
          const dir = ph < 0.5 ? 1 : -1;
          const [x, y] = a.p[k];
          const [hx, hy] = a.p[clamp(k + dir, 0, n - 1)];
          g.em.px(x, y + 2, body);
          g.em.px(hx, hy + 2 - wig, head);
        }
      });
    }
    if (sec.glint) {
      fns.push((g, t) => {
        const ph = T.phase(t, 6);
        const i = Math.floor(T.phase(t, 18) * sec.glint.length);
        if (ph < 0.12) g.em.px(sec.glint[i][0], sec.glint[i][1], P.gold[6]);
      });
    }
    if (!fns.length) return null;
    return (g, t) => {
      for (const f of fns) f(g, t);
    };
  }

  HD.groundSeasons = {
    build(ed, K) {
      const fn = VARIANT[ed.ground] || VARIANT.leafy;
      K.begin();
      const sec = fn(K, ed) || {};
      K.paintFade();
      const out = K.finish();
      out.worm = !!sec.worm;
      out.anim = makeAnim(sec);
      return out;
    },
  };
})();
