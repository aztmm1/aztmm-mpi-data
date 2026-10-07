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
    if (ed.fire !== 'none' && !o.noFire) s.push({ x: cf.x, y: cf.base, rx: ed.fire === 'bonfire' ? 34 : 30, ry: ed.fire === 'bonfire' ? 9.5 : 8.5, k: 1.15, fire: true });
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
        [-14, 0, 5],
        [-7, 2, 4],
        [5, -1, 5],
        [13, 1, 4],
        [-1, 2, 3],
      ],
      [
        [-5, 0, 4],
        [5, 1, 3],
      ],
      [
        [-6, 0, 4],
        [6, 0, 3],
      ],
    ][pi] || [];
    const ins = (x, y) => (K.mask(x, y) & K.PUD) !== 0;
    const put = (x, y, c) => {
      if (!ins(x, y)) return;
      K.set(x, y, c);
      K.over(x, y);
    };
    for (const [dx, dy, w] of pads) {
      const x0 = cx + dx;
      const y0 = cy + dy;
      // a pad seen low: two rows, a notch in the top row
      for (let i = 0; i < w; i++) put(x0 + i, y0, i === w - 1 ? P.leaf[3] : P.leaf[4]);
      for (let i = 1; i < w - 1; i++) if (i !== 1 || w < 5) put(x0 + i, y0 - 1, i === 1 ? P.leaf[6] : P.leaf[5]);
      if (w >= 5) put(x0 + 3, y0 - 1, P.leaf[5]);
      put(x0 + 1, y0 + 1, P.leaf[2]);
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

  /** frost the topsoil band of the cut face (snow editions) */
  function frozenLayer(K, thick) {
    const { FRONT } = K;
    const { C } = K.raw();
    const memo = new Map();
    const frost = (c, k) => {
      const key = c + k;
      let v = memo.get(key);
      if (!v) memo.set(key, (v = mix(c, P.ice[1], k)));
      return v;
    };
    const fl = (x) => FRONT + 2 + thick + Math.round((K.vn(x / 11, 5, 61) - 0.5) * 2.6);
    for (let x = 0; x < W; x++) {
      const yb = fl(x);
      for (let y = FRONT + 2; y <= yb; y++) {
        const k = K.at(x, y);
        if (k < 0 || !C[k]) continue;
        const deep = (y - FRONT - 2) / Math.max(1, yb - FRONT - 2);
        C[k] = frost(C[k], 0.6 - deep * 0.2);
      }
      // the frost front: a broken pale line
      if (HD.hash(x, 9, 61) > 0.25) K.set(x, yb + 1, mix(P.soil[3], P.ice[2], 0.4));
    }
    // ice lenses: short glassy streaks in the frozen band
    const r = HD.rng(6161);
    for (let i = 0; i < 64; i++) {
      const x = Math.floor(r() * W);
      const yb = fl(x);
      const y = FRONT + 3 + Math.floor(r() * Math.max(1, yb - FRONT - 3));
      const len = 2 + Math.floor(r() * 4);
      for (let j = 0; j < len; j++) K.set(x + j, y, j === 0 ? P.ice[4] : P.ice[3]);
      if (len > 3) K.set(x + 1, y - 1, P.ice[1]);
    }
  }

  // ------------------------------------------------------------------
  // snow surfaces
  // ------------------------------------------------------------------
  /** height field of soft drifts (deep snow) */
  function driftField(K) {
    const { BACK, FRONT } = K;
    const Hh = FRONT - BACK + 6;
    const hf = new Float32Array(W * Hh);
    const r = HD.rng(3203);
    const mounds = [];
    for (let i = 0; i < 18; i++) mounds.push([r() * W, BACK + 4 + r() * (FRONT - BACK - 6), 26 + r() * 50, 3.5 + r() * 3.5, 0.7 + r() * 0.6]);
    // banked snow along the back edge, the house front, the left and right ends
    mounds.push([30, 214, 46, 9, 1.4], [455, 214, 50, 9, 1.3], [233, 207, 80, 2.6, 1.0], [120, 205, 60, 4, 0.8], [360, 206, 60, 4, 0.8]);
    for (let yy = 0; yy < Hh; yy++) {
      const y = BACK - 2 + yy;
      for (let x = 0; x < W; x++) {
        let h = (K.vn(x / 40, y / 9, 311) - 0.5) * 0.6;
        for (const [mx, my, rx, ry, a] of mounds) {
          const e = ((x - mx) / rx) ** 2 + ((y - my) / ry) ** 2;
          if (e < 1) h += a * (1 - e) * (1 - e);
        }
        hf[yy * W + x] = h;
      }
    }
    return (x, y) => {
      const yy = clamp(Math.round(y) - BACK + 2, 0, Hh - 1);
      return hf[yy * W + clamp(Math.round(x), 0, W - 1)];
    };
  }

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
  const SNOWMAN_TRAIL = [
    [224, 215],
    [262, 219],
    [300, 221],
    [337, 223],
  ];

  /** footprints along a polyline: alternating left/right prints */
  function footprints(K, pts, o) {
    let acc = 0;
    let n = 0;
    const step = o.step || 3.6;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      for (; acc <= len; acc += step, n++) {
        const k = acc / len;
        const side = n % 2 ? 1 : -1;
        const x = Math.round(ax + (bx - ax) * k + nx * side * 1.6);
        const y = Math.round(ay + (by - ay) * k + ny * side * 0.7);
        if (o.onlyOn && !o.onlyOn(x, y)) continue;
        if (K.mask(x, y) & (K.PUD | K.RIM)) continue;
        K.set(x, y, o.dark);
        K.set(x + 1, y, o.mid);
        if (o.lip) K.set(x, y - 1, o.lip);
      }
      acc -= len;
    }
  }

  function deepSnow(K) {
    const { BACK, FRONT } = K;
    const h = driftField(K);
    for (let y = BACK; y < FRONT; y++) {
      const d = K.depth(y);
      for (let x = 0; x < W; x++) {
        const slope = h(x, y) - h(x, y + 1.5);
        let v = 4.35 + d * 0.9 + slope * 2.3 + (K.vn(x / 11, y / 3, 317) - 0.5) * 0.35;
        if (y < BACK + 3) v -= (BACK + 3 - y) * 0.3;
        const tp = distToPath(x, y, TRAIL, 1);
        if (tp < 3.4) v = 4.1 + (K.vn(x / 3, y / 1.5, 318) - 0.5) * 0.7; // trodden
        else if (tp < 4.6) v = Math.max(v, 5.6); // shoved-up banks either side
        K.set(x, y, S[K.qd(v, x, y, 3, 7, 0.3)]);
      }
    }
    despeckle(K, BACK + 1, FRONT - 1);
    // contact shadow where the house and turret meet the snow
    for (let x = 166; x <= 300; x++) {
      if (x >= 204 && x <= 236) continue;
      K.set(x, 206, S[3]);
      if (HD.hash(x, 1, 206) < 0.5) K.set(x, 207, S[4]);
    }
    footprints(K, TRAIL, { dark: S[2], mid: S[3], lip: S[5] });
    footprints(K, SNOWMAN_TRAIL, { dark: S[3], mid: S[4], step: 4.2 });
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

  /** snow cornice hanging over the cut */
  function snowLip(K, o) {
    const { FRONT } = K;
    for (let x = 0; x < W; x++) {
      const on = o.cover ? o.cover(x) : true;
      if (!on) continue;
      let od = o.depth + Math.round(K.vn(x / 8, 3, 51) * o.var);
      if (HD.hash(x >> 2, 3, 52) < 0.12) od++; // little lumps
      K.setLit(x, FRONT - 1, S[o.depth > 2 ? 7 : 6], 1);
      K.setLit(x, FRONT, S[6], 1);
      for (let j = 1; j < od; j++) K.setLit(x, FRONT + j, j === od - 1 ? S[3] : j === 1 ? S[5] : S[4], 1);
      K.setLit(x, FRONT + od, P.soil[0], 0);
      if (o.depth > 2) K.setLit(x, FRONT + od + 1, P.soil[1], 0);
      // the odd icicle under the overhang
      if (o.icicles && HD.hash(x, 11, 53) < 0.05) {
        K.setLit(x, FRONT + od, P.ice[3], 0);
        if (HD.hash(x, 12, 53) < 0.6) K.setLit(x, FRONT + od + 1, P.ice[2], 0);
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
        let c = S[5];
        if (!g(x, y - 1)) c = S[6];
        else if (!g(x, y + 1)) c = S[3];
        else if (!g(x, y + 2) || !g(x - 2, y) || !g(x + 2, y)) c = S[4];
        else if (K.vn(x / 7, y / 2, seed + 4) < 0.25) c = S[4];
        K.set(x, y, c);
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
    const dens = (x, y) => {
      let s = K.fbm(x / 16, y / 3.8, 501) - 0.5;
      if (x > 350) s += 0.22 + (x > 380 && x < 440 ? 0.12 : 0); // under the tree
      if (y < BACK + 7) s += 0.12; // blown against the back and the house
      if (x < 44) s += 0.1;
      if (distToPath(x, y, TRAIL) < 3) s -= 0.25;
      return s;
    };
    // leaf litter base in dense drifts
    for (let y = BACK + 2; y < FRONT - 1; y++)
      for (let x = 0; x < W; x++) {
        if (K.mask(x, y) & (FIRE | PUD | RIM | K.STONE)) continue;
        const s = dens(x, y);
        if (s > 0.12) K.set(x, y, K.vn(x / 3, y / 1.4, 503) > 0.5 ? P.autumn[1] : mix(P.autumn[1], P.wood[2], 0.5));
      }
    const r = HD.rng(5050);
    for (let i = 0; i < 2000; i++) {
      const x = Math.floor(r() * W);
      const y = BACK + 3 + Math.floor(r() * (FRONT - BACK - 4));
      const s = dens(x, y);
      if (r() > (s > 0 ? 0.1 + s * 1.5 : 0.05 + s * 0.1)) continue;
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
    // clover patches: tiny three-leaf clusters
    const r = HD.rng(8080);
    for (let i = 0; i < 260; i++) {
      const x = Math.floor(r() * W);
      const y = K.BACK + 5 + Math.floor(r() * (K.FRONT - K.BACK - 6));
      if (K.vn(x / 18, y / 4, 809) < 0.55) continue;
      if (K.mask(x, y) & (K.PUD | K.RIM | K.STONE | K.FIRE)) continue;
      K.set(x, y, P.leaf[5]);
      K.set(x + 1, y, P.leaf[4]);
      K.set(x, y - 1, P.leaf[6]);
      if (r() < 0.12) K.set(x, y - 2, P.bone[2]); // white clover head
    }
    const daisy = (x, y, r) => {
      const h = 2 + Math.floor(r() * 3);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[3]);
      K.set(x - 1, y - h, P.bone[3]);
      K.set(x + 1, y - h, P.bone[3]);
      K.set(x, y - h - 1, P.bone[4]);
      K.set(x, y - h, P.gold[4]);
    };
    const corn = (x, y, r) => {
      const h = 3 + Math.floor(r() * 2);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[3]);
      K.set(x, y - h, P.night[8]);
      K.set(x - 1, y - h, P.night[7]);
      K.set(x + 1, y - h - 1, P.night[9]);
    };
    const butter = (x, y, r) => {
      const h = 2 + Math.floor(r() * 2);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[4]);
      K.set(x, y - h, P.gold[4]);
      K.set(x + 1, y - h, P.gold[3]);
    };
    const pink = (x, y, r) => {
      const h = 3 + Math.floor(r() * 2);
      for (let j = 0; j < h; j++) K.set(x, y - j, G[3]);
      K.set(x, y - h, P.violet[5]);
      K.set(x, y - h - 1, P.violet[6]);
      K.set(x + 1, y - h, P.violet[4]);
    };
    const kinds = [daisy, corn, butter, pink];
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
    ];
    flowerClumps(K, clumps, (x, y, r, i) => kinds[(Math.floor(r() * 4) + i) % 4](x, y, r));
  }

  // ------------------------------------------------------------------
  // dry autumn: swept earth & rangoli
  // ------------------------------------------------------------------
  function sweptPath(K) {
    const { BACK, FRONT, MUD } = K;
    const R = L.seasonal.rangoli;
    for (let y = BACK + 4; y < FRONT; y++)
      for (let x = 160; x < 270; x++) {
        const dp = distToPath(x, y, TRAIL) / 6.2;
        const da = Math.sqrt(((x - R.x) / (R.rx + 6)) ** 2 + ((y - R.y + 0.5) / (R.ry + 3)) ** 2);
        const e = Math.min(dp, da) + (K.vn(x / 3, y / 1.5, 611) - 0.5) * 0.3;
        if (e > 1) continue;
        K.addMask(x, y, MUD);
        let c = P.soil[5];
        if (e > 0.82) c = P.soil[4];
        else if (K.vn(x / 4, y / 1.6, 613) > 0.66) c = P.soil[6];
        // broom strokes: short arcs
        const arc = Math.sin((x - R.x) * 0.55 + (y - R.y) * 1.9);
        if (arc > 0.9 && e < 0.8 && HD.hash(x, y, 614) < 0.6) c = mix(P.soil[6], P.stone[5], 0.4);
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
    for (let y = Math.floor(R.y - ry); y <= Math.ceil(R.y + ry); y++)
      for (let x = Math.floor(R.x - rx); x <= Math.ceil(R.x + rx); x++) {
        const u = (x - R.x) / rx;
        const v = (y - R.y) / ry;
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
    // a tiny dotted white outline outside the scallops, left & right only
    for (const s of [-1, 1]) K.set(R.x + s * (R.rx + 2), R.y, wht);
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
  function tunnel(K, pts, c, w) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let s = 0; s <= n; s++) {
        const x = Math.round(ax + ((bx - ax) * s) / n);
        const y = Math.round(ay + ((by - ay) * s) / n);
        for (let j = 0; j < (w || 2); j++) {
          K.set(x, y + j, c);
          K.addMask(x, y + j, K.COF);
        }
      }
    }
  }

  const SECRET = {};
  // hibernating frog curled in a mud pocket
  SECRET['hibernating-frog'] = (K) => {
    pocket(K, 367, 253, 10, 4.2, (x, y) => (K.vn(x / 3, y / 2, 701) > 0.6 ? P.soil[2] : mix(P.soil[1], P.violet[1], 0.5)), P.soil[0], 702);
    const fr = { h: mix(P.leaf[6], P.vine[4], 0.4), G: mix(P.leaf[4], P.vine[3], 0.4), d: P.leaf[2], e: P.leaf[0], b: mix(P.bone[1], P.leaf[4], 0.5) };
    stamp(K, ['..hhh......', '.hGGGhhh...', 'hGeeGGGGGh.', 'GbGGGGGGGGh', 'bbGGdGGGGGd', '.bbddd.dddd'], 362, 250, fr);
    return { breathe: [368, 250, fr.h] };
  };
  // a rabbit asleep at the end of its burrow
  SECRET['rabbit-burrow'] = (K) => {
    tunnel(K, [[326, 241], [334, 245], [344, 249], [352, 252]], P.soil[1], 3);
    pocket(K, 366, 253, 12, 4.6, P.soil[1], P.soil[0], 711);
    // dry grass bedding
    for (let x = 356; x <= 377; x++) if (HD.hash(x, 7, 712) < 0.7) K.set(x, 256 + (HD.hash(x, 8, 712) < 0.3 ? 1 : 0), P.vine[3]);
    const rb = { E: P.stone[5], p: P.blossom[3], B: mix(P.stone[4], P.wood[5], 0.4), h: P.stone[6], k: P.soil[0], n: P.blossom[4], t: P.bone[3], d: P.stone[2] };
    stamp(K, ['...EEEEEE....', '..hEppppEh...', '.hBBBBBBBBBh.', 'hBkBBBBBBBBBt', 'BnBBBBBBBBBtt', '.dddddddddd..'], 359, 250, rb);
    return { breathe: [365, 251, rb.h] };
  };
  // ant colony: tunnels, chambers with eggs, ants on the move (4 fps)
  const ANT_PATHS = [
    [[318, 241], [322, 245], [320, 249], [327, 252], [335, 252]],
    [[335, 252], [343, 249], [352, 249], [360, 251], [367, 251]],
    [[320, 249], [314, 252], [308, 256]],
    [[352, 249], [354, 255], [366, 257], [378, 256]],
  ];
  SECRET['ant-colony'] = (K) => {
    for (const p of ANT_PATHS) tunnel(K, p, P.soil[0], 2);
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
    for (const [x, y] of [[378, 256], [380, 257], [382, 256]]) K.set(x, y, P.gold[2]);
    return { ants: true };
  };
  // a squirrel's acorn cache
  SECRET['squirrel-stash'] = (K) => {
    tunnel(K, [[336, 241], [342, 245], [350, 249]], P.soil[1], 3);
    pocket(K, 364, 253, 11, 4.4, P.soil[1], P.soil[0], 721);
    for (let x = 354; x <= 375; x++) if (HD.hash(x, 7, 722) < 0.8) K.set(x, 256 + (HD.hash(x, 9, 722) < 0.3 ? 1 : 0), HD.hash(x, 5, 722) < 0.5 ? P.autumn[2] : P.autumn[1]);
    const ac = { c: P.wood[3], C: P.wood[5], H: P.wood[6], n: P.autumn[3], N: P.autumn[5], d: P.autumn[2] };
    const A = ['.c.', 'CHC', 'nNn', '.d.'];
    const B = ['.c.', 'CCH', 'nnN', '.n.'];
    const heap = [[356, 252], [359, 252], [362, 252], [365, 252], [368, 252], [371, 252], [358, 249], [361, 249], [364, 249], [367, 249], [362, 246]];
    heap.forEach(([x, y], i) => stamp(K, i % 3 ? A : B, x, y + 1, ac));
    // one acorn rolled aside
    stamp(K, ['.cC', 'nNn', '.n.'], 375, 254, ac);
    return {};
  };
  // a clay pot of gold coins, tipped over
  SECRET['clay-pot'] = (K) => {
    pocket(K, 366, 253, 14, 5, P.soil[1], P.soil[0], 731);
    const pc = { P: P.pumpkin[3], h: P.pumpkin[4], H: P.pumpkin[5], d: P.pumpkin[2], D: P.pumpkin[1], R: P.pumpkin[4], m: P.soil[0], c: P.gold[3], g: P.gold[4], G: P.gold[5] };
    stamp(K, ['...dPPPPd....', '.dPhhHPPPPdRR', 'dPhHPPPPPPPRm', 'PPhPPPPPPPPmg', 'dPPPPPPPPPPRm', '.DdPPPPPPdDRR', '...DDDDDD....'], 352, 249, pc);
    // coins spilling out
    stamp(K, ['...G.....', '..cgg.G..', '.ggcGgcg.', 'cgcggcggc'], 365, 254, pc);
    return { glint: [[369, 256], [366, 255], [372, 257]] };
  };
  // hedgehog asleep in a leaf nest
  SECRET['hedgehog'] = (K) => {
    pocket(K, 366, 253, 12, 4.8, (x, y) => (K.vn(x / 2, y / 1.5, 741) > 0.55 ? P.autumn[2] : HD.hash(x, y, 742) < 0.5 ? P.autumn[1] : P.wood[3]), P.soil[0], 743);
    const hh = { s: mix(P.stone[5], P.wood[6], 0.4), S: P.wood[4], T: P.wood[3], F: mix(P.bone[1], P.wood[5], 0.4), k: P.soil[0], n: P.night[0] };
    stamp(K, ['...s.s.s....', '..sSsSsSs...', '.sSTSTSTSs..', 'sSTSTSTSTSs.', 'FFkSTSTSTSs.', 'nFFFTTTTTT..'], 359, 250, hh);
    // a few leaves tucked over it
    K.set(370, 250, P.autumn[3]);
    K.set(371, 250, P.autumn[2]);
    K.set(372, 251, P.autumn[3]);
    return { breathe: [364, 249, hh.s] };
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
      K.paintMud(mudSpotsFor(ed, { k: 0.75, tree: 0.3 }), true);
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
      grass(K, G, { dens: 0.95, hk: 1.1 });
      pathStones(K, G, { only: (s) => s.i === 3, mud: false });
      rangoli(K);
      backEdge(K, G[1], { stalks: 0.1 });
      const sec = under(K, ed, { worm: true });
      turfLip(K, G, { len: 1 });
      return Object.assign(sec, { worm: true });
    },
    snow(K, ed) {
      deepSnow(K);
      puddles(K, ed.tagSet.has('frozen-puddles') ? 'ice' : 'water', { far: S[3], near: S[6], end: S[5] });
      snowBackEdge(K);
      const sec = under(K, ed, { frozen: 5 });
      snowLip(K, { depth: 3, var: 2.2, icicles: true });
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
      if (ed.id === 'lunar') footprints(K, SNOWMAN_TRAIL, { dark: S[3], mid: S[4], step: 4.2, onlyOn: snowy });
      else
        footprints(
          K,
          [
            [212, 216],
            [180, 222],
            [150, 228],
            [132, 231],
          ],
          { dark: S[3], mid: S[4], step: 4, onlyOn: snowy },
        );
      if (ed.id === 'lunar') redPaper(K);
      if (ed.id === 'newyear') confetti(K);
      backEdge(K, G[1], { top: (x) => (K.vn(x / 9, 0, 67) > 0.45 ? S[4] : null) });
      const sec = under(K, ed, { frozen: 3 });
      turfLip(K, G, { len: 0.7 });
      const cover = (x) => snowy(x, K.FRONT - 1) || snowy(x, K.FRONT - 2);
      snowLip(K, { depth: 1, var: 1.2, cover });
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
      const [bx, by, c] = sec.breathe;
      fns.push((g, t) => {
        if (T.phase(t, 4.2) < 0.42) g.em.px(bx, by - 1, c);
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
        const wig = Math.floor(ts * 4) & 1;
        for (const a of ants) {
          const ph = T.phase(ts, a.per, a.off);
          const u = ph < 0.5 ? ph * 2 : 2 - ph * 2; // there and back
          const n = a.p.length;
          const k = Math.min(n - 1, Math.floor(u * (n - 1)));
          const dir = ph < 0.5 ? 1 : -1;
          const [x, y] = a.p[k];
          const [hx, hy] = a.p[clamp(k + dir, 0, n - 1)];
          g.em.px(x, y + 1, body);
          g.em.px(hx, hy + 1 - wig, head);
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
