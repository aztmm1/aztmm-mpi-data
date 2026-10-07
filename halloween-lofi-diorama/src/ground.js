/*
 * ground — the slab Rainy Hollow sits on.
 *   scene z5  baked top face (wet grass, mud, stepping stones, puddle beds,
 *             leaves, pebbles, the grassy front lip) — relit by the lightmap
 *             + baked cross-section (soil strata, pebbles, tree roots, the
 *             coffin, bones and a skull) — drawn emissive so firelight on the
 *             top face never leaks onto the cut face; it stays dark and cold
 *   scene z6  a tiny worm wiggling in the topsoil (4 fps, loop-safe)
 * Everything static is rasterised once in init() into two canvases; a frame
 * is two blits plus a handful of worm pixels.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const L = HD.layout;
  const T = HD.time;
  const GR = L.ground;
  const BACK = GR.back; // 200
  const FRONT = GR.front; // 238 (first row of the cut face)
  const BOT = GR.bottom; // 270
  const W = 480;
  const Y0 = BACK - 6; // raster top: tufts poke above the back edge
  const H = BOT - Y0;
  const CUT_LIT = FRONT + 2; // turf rows 238,239 are lit; the cut face below is not

  const clamp = HD.clamp;
  const bayer = HD.bayer;
  const mix = HD.color.mix;

  // ------------------------------------------------------------------
  // init-time raster (colour strings) + flags
  // ------------------------------------------------------------------
  let C = null; // colour per pixel
  let LIT = null; // 1 = relit (top face), 0 = emissive (cut face)
  let M = null; // mask bits
  let OV = null; // 1 = seasonal overlay pixel (re-drawn above puddle reflections)
  const PUD = 1;
  const RIM = 2;
  const STONE = 4;
  const MUD = 8;
  const COF = 16;
  const ROOT = 32;
  const BONE = 64;
  const FIRE = 128;

  const at = (x, y) => {
    x = Math.round(x);
    y = Math.round(y) - Y0;
    return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
  };
  const set = (x, y, c) => {
    const k = at(x, y);
    if (k < 0) return;
    C[k] = c;
    LIT[k] = Math.round(y) < CUT_LIT ? 1 : 0;
  };
  const get = (x, y) => {
    const k = at(x, y);
    return k < 0 ? null : C[k];
  };
  const mask = (x, y) => {
    const k = at(x, y);
    return k < 0 ? 0 : M[k];
  };
  const addMask = (x, y, b) => {
    const k = at(x, y);
    if (k >= 0) M[k] |= b;
  };

  // smooth value noise (init only). The four lattice hashes of the last cell
  // are cached per seed slot, since neighbouring pixels mostly share a cell;
  // the values are exactly the same as hashing every time.
  const VC = new Float64Array(64 * 7).fill(NaN);
  function vn(x, y, s) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const o = (s & 63) * 7;
    let a, b, c, d;
    if (VC[o] === xi && VC[o + 1] === yi && VC[o + 2] === s) {
      a = VC[o + 3];
      b = VC[o + 4];
      c = VC[o + 5];
      d = VC[o + 6];
    } else {
      a = HD.hash(xi, yi, s, 1);
      b = HD.hash(xi + 1, yi, s, 1);
      c = HD.hash(xi, yi + 1, s, 1);
      d = HD.hash(xi + 1, yi + 1, s, 1);
      VC[o] = xi;
      VC[o + 1] = yi;
      VC[o + 2] = s;
      VC[o + 3] = a;
      VC[o + 4] = b;
      VC[o + 5] = c;
      VC[o + 6] = d;
    }
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y, s) => vn(x, y, s) * 0.6 + vn(x * 2.03, y * 2.03, s + 17) * 0.28 + vn(x * 4.1, y * 4.1, s + 33) * 0.12;
  /** quantise v to an integer ramp index, with a narrow ordered-dither seam */
  function qd(v, x, y, lo, hi, w) {
    let i = Math.floor(v);
    const fr = v - i;
    if (fr > 0.5 + (bayer(x, y) - 0.5) * (w === undefined ? 0.5 : w)) i++;
    return clamp(i, lo, hi);
  }

  // ------------------------------------------------------------------
  // TOP FACE
  // ------------------------------------------------------------------
  const depth = (y) => clamp((y - BACK) / (FRONT - 1 - BACK), 0, 1);

  // mud / trampled areas: ellipses (x, y, rx, ry, strength)
  function mudSpots() {
    const s = [];
    const cf = L.campfire;
    s.push({ x: cf.x, y: cf.base, rx: 30, ry: 8.5, k: 1.15, fire: true });
    const st = L.house.steps;
    s.push({ x: (st.x0 + st.x1) / 2, y: st.y1 + 1, rx: 17, ry: 3.2, k: 1 });
    for (const p of L.puddles) s.push({ x: p.x, y: p.y + 0.5, rx: p.rx + 6, ry: p.ry + 2.6, k: 0.95 });
    s.push({ x: 268, y: 234, rx: 10, ry: 2.5, k: 0.8 });
    s.push({ x: 405, y: 220, rx: 30, ry: 4.5, k: 0.75 }); // bare soil under the tree
    s.push({ x: 60, y: 233, rx: 9, ry: 2.5, k: 0.7 });
    s.push({ x: 128, y: 229, rx: 8, ry: 2, k: 0.7 });
    return s;
  }

  function paintBase() {
    for (let y = BACK; y < FRONT; y++) {
      const d = depth(y);
      for (let x = 0; x < W; x++) {
        const n = fbm(x / 15, y / 4.2, 11);
        let v = 1.35 + d * 2.05 + (n - 0.5) * 2.1;
        if (y < BACK + 3) v -= (BACK + 3 - y) * 0.45;
        // damp, darker patches (flattened wet grass)
        const dp = vn(x / 21, y / 4.5, 23);
        if (dp > 0.7) v -= 1;
        set(x, y, P.moss[qd(v, x, y, 1, 4, 0.22)]);
      }
    }
    // despeckle: lone pixels take their neighbours' colour
    for (let y = BACK + 1; y < FRONT - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const c = get(x, y);
        const l = get(x - 1, y);
        const r = get(x + 1, y);
        if (c !== l && c !== r && l === r && c !== get(x, y - 1) && c !== get(x, y + 1)) set(x, y, l);
      }
  }

  function paintMud(spots, noGlints) {
    for (const m of spots || mudSpots()) {
      const x0 = Math.floor(m.x - m.rx - 3);
      const x1 = Math.ceil(m.x + m.rx + 3);
      const y0 = Math.max(BACK + 2, Math.floor(m.y - m.ry - 2));
      const y1 = Math.min(FRONT - 1, Math.ceil(m.y + m.ry + 2));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const dx = (x - m.x) / m.rx;
          const dy = (y - m.y) / m.ry;
          const e = Math.sqrt(dx * dx + dy * dy);
          const n = vn(x / 4, y / 1.6, 57);
          const v = (1 - e) * m.k + (n - 0.5) * 0.55;
          if (v < 0.08) continue;
          addMask(x, y, MUD);
          let c;
          const n2 = vn(x / 3, y / 1.3, 59);
          if (v < 0.2) c = n2 > 0.5 ? P.soil[4] : P.moss[1];
          else if (n2 > 0.72) c = P.soil[5];
          else if (n2 < 0.3) c = P.soil[3];
          else c = P.soil[4];
          if (m.fire) {
            addMask(x, y, FIRE);
            // trampled, scorched ground around the ring
            const dd = Math.sqrt(((x - m.x) / 17) ** 2 + ((y - m.y + 1) / 5) ** 2);
            if (dd < 0.85) c = n2 > 0.6 ? P.soil[3] : P.soil[2];
          }
          set(x, y, c);
        }
    }
    if (noGlints) return;
    // wet glints in the mud: short cold strokes
    const r = HD.rng(611);
    for (let k = 0; k < 140; k++) {
      const x = Math.floor(r() * W);
      const y = BACK + 3 + Math.floor(r() * (FRONT - BACK - 4));
      if (!(mask(x, y) & MUD) || mask(x, y) & (PUD | RIM)) continue;
      if (get(x, y) !== P.soil[4] && get(x, y) !== P.soil[5]) continue;
      const len = r() < 0.6 ? 2 : 1;
      for (let i = 0; i < len; i++) if (mask(x + i, y) & MUD && !(mask(x + i, y) & (PUD | RIM))) set(x + i, y, i ? P.stone[3] : P.stone[4]);
    }
  }

  /** the engine's puddle ellipse: same row widths as engine reflections() */
  function pudRows(p) {
    const rows = [];
    const ry = Math.round(p.ry);
    const rx = Math.round(p.rx);
    for (let dy = -ry; dy <= ry; dy++) {
      const t = (dy) / (ry + 0.5);
      const kk = 1 - t * t;
      if (kk <= 0) continue;
      rows.push({ y: Math.round(p.y) + dy, hw: Math.floor((rx + 0.4) * Math.sqrt(kk)), dy, ry });
    }
    return rows;
  }

  function paintPuddles() {
    for (const p of L.puddles) {
      const cx = Math.round(p.x);
      const rows = pudRows(p);
      for (const r of rows) for (let x = cx - r.hw; x <= cx + r.hw; x++) addMask(x, r.y, PUD);
      // muddy bank + 1px dark rim just outside the water
      for (const r of rows) {
        for (let x = cx - r.hw - 2; x <= cx + r.hw + 2; x++)
          for (let oy = -1; oy <= 1; oy++) {
            const y = r.y + oy;
            if (mask(x, y) & PUD) continue;
            const near = mask(x - 1, y) & PUD || mask(x + 1, y) & PUD || mask(x, y - 1) & PUD || mask(x, y + 1) & PUD;
            if (!near) continue;
            addMask(x, y, RIM);
            set(x, y, y > p.y ? P.soil[1] : P.soil[2]);
          }
      }
      for (const r of rows) {
        // banks: one lighter wet-mud pixel outside the rim at the ends of each row
        const yb = r.y;
        for (const sx of [-1, 1]) {
          const xb = cx + sx * (r.hw + 2);
          if (!(mask(xb, yb) & (PUD | RIM))) set(xb, yb, P.soil[4]);
        }
      }
      // bed: still dark water, a touch lighter toward the far bank, cold sheen
      for (const r of rows) {
        for (let x = cx - r.hw; x <= cx + r.hw; x++) {
          let c = P.night[2];
          if (r.dy < 0) c = P.night[3];
          if (r.dy > 0 && Math.abs(x - cx) > r.hw - 2) c = P.night[1];
          set(x, r.y, c);
        }
      }
      const top = rows[0];
      const sh = Math.round(top.hw * 0.45);
      const sx0 = cx - Math.round(top.hw * 0.35);
      for (let x = sx0; x < sx0 + sh; x++) set(x, top.y + 1, P.night[4]);
    }
  }

  /** one grass tuft: a little fan of blades rooted at (x, y) */
  function tuft(x, y, d, r, dark, ramp, hk) {
    const RAMP = ramp || P.moss;
    const n = 2 + Math.floor(r() * 2.2 + d * 1.6);
    const hmax = (1 + d * 3.4) * (hk || 1);
    const k0 = dark ? 1 : d < 0.3 ? 2 : 3;
    const half = (n - 1) / 2;
    for (let b = 0; b < n; b++) {
      if (r() < 0.12) continue;
      const off = b - half;
      const bx = Math.round(x + off);
      const centre = 1 - Math.abs(off) / (half + 1);
      const h = Math.max(1, Math.round(hmax * (0.45 + 0.55 * centre) * (0.75 + r() * 0.5)));
      const fan = h >= 3 ? Math.sign(Math.round(off)) : 0;
      const wind = h >= 2 && r() < 0.45 ? 1 : 0;
      for (let j = 0; j < h; j++) {
        const yy = y - j;
        let xx = bx;
        if (j === h - 1) xx += fan || wind;
        else if (j >= 3 && fan) xx += fan;
        const m = mask(xx, yy);
        if (m & (PUD | RIM | STONE)) continue;
        let ci = k0;
        if (j === h - 1 && h > 1) ci = d > 0.35 ? k0 + 2 : k0 + 1;
        else if (j >= h / 2) ci = k0 + 1;
        if (dark) ci = Math.min(ci, 2);
        if (!dark && j === h - 1 && d > 0.55 && r() < 0.22) ci = 6;
        set(xx, yy, RAMP[clamp(ci, 0, 6)]);
      }
      // a darker root pixel grounds the blade
      if (h >= 2 && !(mask(bx, y + 1) & (PUD | RIM | STONE)) && y + 1 < FRONT) set(bx, y + 1, RAMP[Math.max(1, k0 - 1)]);
    }
  }

  function paintGrass() {
    const r = HD.rng(4242);
    for (let y = BACK - 1; y < FRONT; y++) {
      const d = depth(y);
      const count = Math.round(W * (0.06 + 0.13 * d));
      for (let k = 0; k < count; k++) {
        const x = Math.floor(r() * W);
        const cl = vn(x / 8, y / 3, 77);
        if (r() > cl * 1.7 - 0.55) continue;
        const m = mask(x, y);
        if (m & (PUD | RIM | STONE)) continue;
        if (m & MUD && r() < 0.85) continue;
        if (m & FIRE) continue;
        tuft(x, y, d, r, y < BACK + 3);
      }
    }
  }

  // ---- stepping-stone path -----------------------------------------------
  function pathPoint(s) {
    const pts = L.path;
    let acc = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s <= acc + len || i === pts.length - 2) {
        const k = clamp((s - acc) / len, 0, 1);
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      }
      acc += len;
    }
    return pts[pts.length - 1];
  }
  function pathLen() {
    let s = 0;
    for (let i = 0; i + 1 < L.path.length; i++) s += Math.hypot(L.path[i + 1][0] - L.path[i][0], L.path[i + 1][1] - L.path[i][1]);
    return s;
  }

  function stone(cx, cy, rx, ry, seed) {
    const r = HD.rng(seed);
    const N = 7;
    const rad = [];
    for (let i = 0; i < N; i++) rad.push(0.78 + r() * 0.4);
    const inside = (x, y) => {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const a = Math.atan2(dy, dx);
      const f = ((a / (Math.PI * 2)) * N + N) % N;
      const i0 = Math.floor(f);
      const k = f - i0;
      const rr = rad[i0] * (1 - k) + rad[(i0 + 1) % N] * k;
      return dx * dx + dy * dy <= rr * rr;
    };
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    const pix = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside(x + 0.0, y + 0.0)) pix.push([x, y]);
    const S = new Set(pix.map((p) => p[0] + ',' + p[1]));
    const has = (x, y) => S.has(x + ',' + y);
    // dark outline at the sides, thickness + shadow below the stone
    for (const [x, y] of pix) {
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1]]) if (!has(x + ox, y + oy) && !(mask(x + ox, y + oy) & STONE)) set(x + ox, y + oy, P.soil[1]);
    }
    for (const [x, y] of pix) {
      if (!has(x, y + 1)) {
        set(x, y + 1, P.stone[2]);
        addMask(x, y + 1, STONE);
        set(x, y + 2, P.soil[1]);
        addMask(x, y + 2, STONE);
      }
    }
    for (const [x, y] of pix) {
      addMask(x, y, STONE);
      let c = P.stone[4];
      const n = vn(x / 2.5, y / 1.5, seed);
      if (n < 0.3) c = P.stone[3];
      if (!has(x, y - 1)) c = has(x - 1, y) && has(x + 1, y) ? P.stone[5] : P.stone[4];
      else if (!has(x, y + 1)) c = P.stone[3];
      else if (!has(x - 1, y) || !has(x + 1, y)) c = P.stone[3];
      set(x, y, c);
    }
    // one or two wet cold glints on the far edge
    const tops = pix.filter(([x, y]) => !has(x, y - 1) && has(x - 1, y) && has(x + 1, y));
    if (tops.length) {
      const g = tops[Math.floor(r() * tops.length)];
      set(g[0], g[1], P.stone[6]);
      if (has(g[0] + 1, g[1]) && !has(g[0] + 1, g[1] - 1)) set(g[0] + 1, g[1], P.night[9]);
    }
    return pix;
  }

  function paintPath() {
    const len = pathLen();
    const n = 4;
    const stones = [];
    for (let i = 0; i < n; i++) {
      const s = 2 + (i / (n - 1)) * (len - 4.5);
      const p = pathPoint(s);
      const d = depth(p[1]);
      const side = i % 2 ? 2.2 : -2.0;
      stones.push({ x: p[0] + side, y: p[1] + 0.3, rx: 5.4 + d * 2.2 + (i === 1 ? 0.8 : 0), ry: 1.5 + d * 0.8, seed: 900 + i * 13 });
    }
    // a little mud between the stones
    for (const s of stones)
      for (let y = Math.floor(s.y - s.ry - 1); y <= s.y + s.ry + 2; y++)
        for (let x = Math.floor(s.x - s.rx - 3); x <= s.x + s.rx + 3; x++) {
          const e = ((x - s.x) / (s.rx + 2.5)) ** 2 + ((y - s.y - 0.5) / (s.ry + 1.6)) ** 2;
          if (e < 1 && vn(x / 3, y / 1.5, 71) > 0.35 + e * 0.3) set(x, y, e > 0.7 ? P.soil[3] : P.soil[4]);
        }
    for (const s of stones) stone(s.x, s.y, s.rx, s.ry, s.seed);
    // grass creeping over the front edge of each stone
    const r = HD.rng(1717);
    for (const s of stones) {
      const yb = Math.round(s.y + s.ry + 1);
      for (let k = 0; k < 3; k++) {
        const x = Math.round(s.x - s.rx + r() * s.rx * 2);
        tuft(x, yb + 1, depth(yb), r, false);
      }
    }
  }

  // ---- leaves & pebbles ------------------------------------------------------
  const LEAF_SHAPES = [
    [[0, 0, 0], [1, 0, 0], [2, 0, 1]],
    [[0, -1, 0], [1, -1, 0], [1, 0, 0], [2, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [2, 0, 0], [1, -1, 0]],
    [[0, 0, 0], [1, 0, 0], [1, -1, 0], [2, -1, 1]],
  ];
  function leafColours() {
    return [
      [P.pumpkin[2], P.pumpkin[1]],
      [mix(P.pumpkin[2], P.wood[5], 0.5), P.wood[2]],
      [mix(P.pumpkin[3], P.stone[5], 0.5), mix(P.pumpkin[1], P.wood[3], 0.5)],
      [P.wood[5], P.wood[3]],
      [P.vine[4], P.vine[2]],
    ];
  }
  function leaf(x, y, r, cols) {
    const sh = LEAF_SHAPES[Math.floor(r() * LEAF_SHAPES.length)];
    const flip = r() < 0.5;
    const cc = cols[Math.floor(r() * cols.length)];
    for (const [dx, dy, k] of sh) {
      const xx = x + (flip ? -dx : dx);
      const yy = y + dy;
      if (mask(xx, yy) & (PUD | RIM)) return;
    }
    for (const [dx, dy, k] of sh) set(x + (flip ? -dx : dx), y + dy, cc[k]);
  }
  function paintLeaves() {
    const r = HD.rng(3131);
    const cols = leafColours();
    const clusters = [];
    for (let i = 0; i < 13; i++) clusters.push([352 + r() * 120, 215 + r() * 21, 2 + Math.floor(r() * 3)]);
    for (let i = 0; i < 16; i++) clusters.push([r() * W, BACK + 8 + r() * (FRONT - BACK - 10), 1 + Math.floor(r() * 2)]);
    for (let i = 0; i < 4; i++) {
      const p = pathPoint(r() * pathLen());
      clusters.push([p[0] + (r() - 0.5) * 16, p[1] + (r() - 0.5) * 3, 1 + Math.floor(r() * 2)]);
    }
    for (const [cx, cy, n] of clusters) {
      const d = depth(cy);
      for (let k = 0; k < n; k++) {
        const x = Math.round(cx + (r() - 0.5) * (5 + d * 4));
        const y = Math.round(cy + (r() - 0.5) * 2.5);
        if (y < BACK + 4 || y >= FRONT - 1) continue;
        if (mask(x, y) & FIRE) continue;
        leaf(x, y, r, cols);
      }
    }
    // pebbles
    for (let i = 0; i < 34; i++) {
      const cx = Math.round(r() * W);
      const cy = Math.round(BACK + 6 + r() * (FRONT - BACK - 8));
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const x = cx + Math.round((r() - 0.5) * 6);
        const y = cy + Math.round((r() - 0.5) * 2);
        if (mask(x, y) & (PUD | RIM | STONE) || mask(x + 1, y) & (PUD | RIM | STONE)) continue;
        const big = r() < 0.4;
        set(x, y, P.stone[5]);
        if (big) set(x + 1, y, P.stone[4]);
        set(x, y + 1, P.stone[2]);
        if (big) set(x + 1, y + 1, P.stone[1]);
      }
    }
  }

  // ---- back edge & front lip ---------------------------------------------------
  function paintBackEdge() {
    const r = HD.rng(808);
    for (let x = 0; x < W; x++) {
      // soft broken silhouette against the hills: a low dark grass line
      const n = vn(x / 7, 0, 66);
      const h = n > 0.66 ? 2 : n > 0.36 ? 1 : 0;
      for (let j = 1; j <= h; j++) set(x, BACK - j, P.moss[1]);
      if (r() < 0.07) {
        const hh = 1 + Math.floor(r() * 2);
        const lean = r() < 0.5 ? 1 : 0;
        for (let j = 1; j <= h + hh; j++) set(x + (j === h + hh ? lean : 0), BACK - j, P.moss[1]);
      }
    }
  }

  function paintLip() {
    const r = HD.rng(2380);
    // turf seen edge-on
    for (let x = 0; x < W; x++) {
      const n = vn(x / 4, 1, 39);
      set(x, FRONT, n > 0.55 ? P.moss[3] : P.moss[2]);
      set(x, FRONT + 1, n > 0.7 ? P.moss[2] : P.moss[1]);
    }
    // drooping blades over the cut, in clumps
    for (let x = 0; x < W; x++) {
      const cl = vn(x / 6, 7, 41);
      if (r() > cl * 1.1 - 0.15) continue;
      const len = 1 + Math.floor(r() * (2 + cl * 4));
      const dir = r() < 0.5 ? -1 : 1;
      let xx = x;
      for (let j = 0; j < len; j++) {
        const y = FRONT + 1 + j;
        if (j === len - 1 && len >= 3) xx += dir;
        const c = j === 0 ? P.moss[4] : j < len - 1 ? P.moss[3] : P.moss[2];
        const k = at(xx, y);
        if (k >= 0) {
          C[k] = c;
          LIT[k] = 1;
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // CROSS-SECTION
  // ------------------------------------------------------------------
  const b1 = (x) => Math.round(246 + 1.3 * Math.sin(x * 0.043 + 0.7) + 0.8 * Math.sin(x * 0.121 + 2.1) + (vn(x / 6, 0, 91) - 0.5) * 1.4);
  const b2 = (x) => Math.round(253.5 + 1.7 * Math.sin(x * 0.031 + 2.4) + 0.9 * Math.sin(x * 0.097 + 0.3) + (vn(x / 7, 0, 92) - 0.5) * 1.4);
  const b3 = (x) => Math.round(261 + 1.4 * Math.sin(x * 0.027 + 4.0) + 0.8 * Math.sin(x * 0.083 + 1.1) + (vn(x / 7, 0, 93) - 0.5) * 1.4);

  function paintStrata() {
    const clay = mix(P.violet[1], P.soil[4], 0.45);
    const clayHi = mix(P.violet[2], P.soil[5], 0.5);
    for (let x = 0; x < W; x++) {
      const y1 = b1(x);
      const y2 = b2(x);
      const y3 = b3(x);
      for (let y = FRONT + 2; y < BOT; y++) {
        let c;
        if (y < y1) {
          const n = vn(x / 8, y / 2, 101);
          c = n > 0.66 ? P.soil[5] : n < 0.26 ? P.soil[3] : P.soil[4];
          if (y < FRONT + 4 && n < 0.62) c = P.soil[2]; // shade under the overhanging turf
        } else if (y < y2) {
          const n = vn(x / 9, y / 2.2, 102);
          c = n > 0.68 ? P.soil[4] : n < 0.24 ? P.soil[2] : P.soil[3];
        } else if (y < y3) {
          const n = vn(x / 12, y / 1.4, 103);
          c = n > 0.62 ? clayHi : n < 0.22 ? P.soil[2] : clay;
        } else {
          const n = vn(x / 9, y / 2, 104);
          c = n > 0.66 ? P.soil[3] : P.soil[2];
        }
        set(x, y, c);
      }
      // hand-drawn boundary lines, broken here and there
      if (HD.hash(x, 1, 7) > 0.12) set(x, y1, P.soil[1]);
      if (HD.hash(x, 2, 7) > 0.1) set(x, y2, P.soil[1]);
      if (HD.hash(x, 3, 7) > 0.1) set(x, y3, P.soil[0]);
      // small teeth where bands interlock
      if (HD.hash(x, 4, 7) < 0.07) set(x, y1 + 1, P.soil[4]);
      if (HD.hash(x, 5, 7) < 0.07) set(x, y2 + 1, P.soil[3]);
      // a faint ledge just below each line
      if (vn(x / 5, 1, 94) > 0.6) set(x, y1 + 1, P.soil[4]);
      if (vn(x / 5, 2, 94) > 0.62) set(x, y2 + 1, clayHi);
    }
    // despeckle the cut face
    for (let y = FRONT + 3; y < BOT - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const c = get(x, y);
        const l = get(x - 1, y);
        if (c !== l && l === get(x + 1, y) && c !== get(x, y - 1) && c !== get(x, y + 1)) set(x, y, l);
      }
    // fine grass roots hanging from the turf
    const r = HD.rng(5150);
    for (let x = 0; x < W; x++) {
      if (r() > 0.22) continue;
      const len = 1 + Math.floor(r() * 4);
      let xx = x;
      for (let j = 0; j < len; j++) {
        if (j > 0 && r() < 0.3) xx += r() < 0.5 ? -1 : 1;
        set(xx, FRONT + 2 + j, j === 0 ? P.moss[1] : P.soil[4]);
      }
    }
  }

  function pebble(cx, cy, rx, ry) {
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const dx = (x - cx) / (rx + 0.35);
        const dy = (y - cy) / (ry + 0.35);
        const e = dx * dx + dy * dy;
        if (e > 1) continue;
        if (mask(x, y) & (COF | BONE | ROOT)) continue;
        let c = P.stone[3];
        if (dy < -0.3 && dx < 0.4) c = P.stone[4];
        if (dy < -0.55 && dx < -0.1 && dx > -0.8) c = P.stone[5];
        if (dy > 0.5) c = P.stone[2];
        set(x, y, c);
      }
    // contact shadow below
    for (let x = Math.round(cx - rx + 1); x <= cx + rx; x++) {
      const y = Math.round(cy + ry + 1);
      if (!(mask(x, y) & (COF | BONE | ROOT)) && get(x, y) !== P.stone[1] && get(x, y) !== P.stone[2]) set(x, y, P.soil[0]);
    }
  }

  function paintPebbles() {
    const r = HD.rng(7272);
    let made = 0;
    for (let tries = 0; tries < 200 && made < 13; tries++) {
      const x = 6 + r() * (W - 12);
      const y = 245 + r() * 15;
      if (x > 262 && x < 330) continue; // bones
      if (x > 344 && x < 392) continue; // coffin
      made++;
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const big = k === 0 && r() < 0.35;
        pebble(x + (r() - 0.5) * 7, y + (r() - 0.5) * 2.5, big ? 2.6 + r() : 1 + r() * 1.3, big ? 1.6 : 0.6 + r() * 0.7);
      }
    }
  }

  // ---- coffin ------------------------------------------------------------------
  function polyInside(pts, x, y) {
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins;
    }
    return ins;
  }
  function hexCoffin(x0, y0, x1, y1) {
    const h = y1 - y0;
    const sx = x0 + Math.round((x1 - x0) * 0.27);
    return [
      [x0, y0 + h * 0.2],
      [sx, y0],
      [x1, y0 + h * 0.3],
      [x1, y1 - h * 0.3],
      [sx, y1],
      [x0, y1 - h * 0.2],
    ];
  }
  function paintCoffin() {
    const cf = L.coffin;
    const box = hexCoffin(cf.x0, cf.y0, cf.x1 + 1, cf.y1 + 1);
    const inBox = (x, y) => polyInside(box, x + 0.5, y + 0.5);
    // disturbed grave fill above the coffin
    for (let y = FRONT + 3; y < cf.y0; y++)
      for (let x = cf.x0 + 3; x <= cf.x1 - 3; x++) {
        const edge = Math.min(x - cf.x0 - 3, cf.x1 - 3 - x);
        if (edge < 2 && HD.hash(x, y, 33) < 0.5) continue;
        const n = vn(x / 2.5, y / 1.8, 131);
        set(x, y, n > 0.66 ? P.soil[4] : n > 0.4 ? P.soil[3] : n > 0.18 ? P.soil[2] : P.violet[1]);
      }
    // pit: dark halo around the box
    for (let y = cf.y0 - 2; y <= cf.y1 + 2; y++)
      for (let x = cf.x0 - 2; x <= cf.x1 + 3; x++) {
        if (inBox(x, y)) continue;
        if (inBox(x - 1, y) || inBox(x + 1, y) || inBox(x, y - 1) || inBox(x, y + 1)) set(x, y, P.soil[0]);
      }
    // box (dark interior shows where the lid has slid)
    for (let y = cf.y0; y <= cf.y1; y++)
      for (let x = cf.x0; x <= cf.x1; x++) {
        if (!inBox(x, y)) continue;
        addMask(x, y, COF);
        const edge = !inBox(x - 1, y) || !inBox(x + 1, y) || !inBox(x, y - 1) || !inBox(x, y + 1);
        set(x, y, edge ? P.wood[1] : P.night[0]);
      }
    // lid, slid 3px toward the feet and 1px up
    const lid = box.map(([x, y]) => [x + 3, y - 1]);
    const inLid = (x, y) => polyInside(lid, x + 0.5, y + 0.5);
    const ly0 = cf.y0 - 1;
    const ly1 = cf.y1;
    const lh = ly1 - ly0;
    for (let y = ly0; y <= ly1; y++)
      for (let x = cf.x0 + 3; x <= cf.x1 + 4; x++) {
        if (!inLid(x, y)) continue;
        addMask(x, y, COF);
        const up = inLid(x, y - 1);
        const dn = inLid(x, y + 1);
        const lf = inLid(x - 1, y);
        const rt = inLid(x + 1, y);
        let c = P.wood[4];
        const rel = (y - ly0) / lh;
        // planks run lengthwise
        if (Math.abs(rel - 0.36) < 0.05 || Math.abs(rel - 0.68) < 0.05) c = P.wood[2];
        else if (Math.abs(rel - 0.44) < 0.05 || Math.abs(rel - 0.76) < 0.05) c = P.wood[5];
        else if (HD.hash(x, y, 51) < 0.07) c = P.wood[3];
        if (!up || !dn || !lf || !rt) c = P.wood[0];
        else if (!inLid(x, y - 2)) c = P.wood[6];
        else if (!inLid(x - 2, y)) c = P.wood[5];
        else if (!inLid(x, y + 2) || !inLid(x + 2, y)) c = P.wood[2];
        set(x, y, c);
      }
    // nails at the plank ends
    const nails = [
      [cf.x0 + 5, Math.round(ly0 + lh * 0.36) - 1],
      [cf.x0 + 5, Math.round(ly0 + lh * 0.68) + 1],
      [cf.x1 + 1, Math.round(ly0 + lh * 0.36) - 1],
      [cf.x1 + 1, Math.round(ly0 + lh * 0.68) + 1],
    ];
    for (const [x, y] of nails) if (inLid(x, y)) set(x, y, P.stone[5]);
    // a little cross on the lid
    const kx = cf.x0 + 15;
    const ky = Math.round(ly0 + lh / 2);
    for (let dx = -2; dx <= 2; dx++) set(kx + dx, ky - 1, P.wood[1]);
    for (let dy = -3; dy <= 3; dy++) set(kx, ky + dy, P.wood[1]);
    // bony fingers curling out of the gap at the head end
    const fx = cf.x0 + 1;
    const fy = Math.round((cf.y0 + cf.y1) / 2);
    set(fx + 1, fy - 2, P.bone[1]);
    set(fx, fy - 3, P.bone[1]);
    set(fx - 1, fy - 3, P.bone[0]);
    set(fx + 1, fy, P.bone[1]);
    set(fx, fy - 1, P.bone[0]);
    set(fx - 1, fy + 1, P.bone[0]);
    set(fx - 2, fy + 1, P.bone[1]);
  }

  // ---- roots -------------------------------------------------------------------
  function paintRoots() {
    const r = HD.rng(4051);
    const R = new Float32Array(W * H); // root width field
    const stamp = (x, y, w) => {
      const rad = w / 2;
      const ir = Math.ceil(rad);
      for (let dy = -ir; dy <= ir; dy++)
        for (let dx = -ir; dx <= ir; dx++) {
          if (dx * dx + dy * dy > rad * rad + 0.25) continue;
          const xx = Math.round(x + dx);
          const yy = Math.round(y + dy);
          if (yy < FRONT + 2 || mask(xx, yy) & COF) continue;
          const k = at(xx, yy);
          if (k >= 0) R[k] = Math.max(R[k], w);
        }
    };
    function grow(x, y, a, len, w0, depthLvl) {
      let ang = a;
      for (let s = 0; s < len; s += 0.7) {
        const k = s / len;
        const w = Math.max(1, w0 * Math.pow(1 - k, 0.7));
        stamp(x, y, w);
        ang += (r() - 0.5) * 0.32 + Math.sin(s * 0.22 + depthLvl) * 0.04;
        ang = clamp(ang, 0.12, Math.PI - 0.12);
        x += Math.cos(ang) * 0.7;
        y += Math.sin(ang) * 0.7 * 0.8;
        if (depthLvl < 2 && r() < 0.025 && w > 1.6) grow(x, y, ang + (r() < 0.5 ? -0.8 : 0.8), len * (0.25 + r() * 0.25), w * 0.55, depthLvl + 1);
      }
    }
    const tx = L.tree.x;
    const y0 = FRONT + 2;
    grow(tx - 10, y0, 2.2, 34, 3.4, 0); // toward the coffin
    grow(tx - 3, y0, 1.75, 26, 3.0, 0); // down
    grow(tx + 6, y0, 1.05, 34, 3.2, 0); // down-right
    grow(tx + 18, y0, 0.55, 26, 2.2, 0); // sideways right
    grow(tx - 22, y0, 2.6, 16, 1.6, 1);
    grow(tx + 32, y0, 0.9, 12, 1.4, 1);
    // a rootlet gripping the coffin's foot
    const cf = L.coffin;
    for (let y = cf.y0 - 2; y <= cf.y0 + 4; y++) {
      const x = cf.x1 + 2 - Math.round((y - cf.y0 + 2) * 0.35);
      const k = at(x, y);
      if (k >= 0) R[k] = Math.max(R[k], 1);
    }
    // a few roots poking from the lip elsewhere
    for (const x of [58, 141, 247, 300, 455]) grow(x, y0, 1.2 + r() * 0.8, 5 + r() * 6, 1.4, 2);
    const has = (x, y) => {
      const k = at(x, y);
      return k >= 0 && R[k] > 0;
    };
    for (let y = FRONT + 2; y < BOT; y++)
      for (let x = 0; x < W; x++) {
        if (!has(x, y)) continue;
        addMask(x, y, ROOT);
        let c = P.wood[4];
        if (!has(x, y - 1)) c = P.wood[5];
        else if (!has(x, y + 1) || !has(x + 1, y)) c = P.wood[2];
        if (R[at(x, y)] <= 1.2) c = has(x, y - 1) && !has(x, y + 1) ? P.wood[3] : P.wood[4];
        set(x, y, c);
      }
  }

  // ---- skull & bones ----------------------------------------------------------
  const SKULL = [
    '..hhhh..',
    '.hLLLLs.',
    'hLLLLLLs',
    'LDDLDDLs',
    'LDDLDDLs',
    'sLLDLLss',
    '.sLLLLs.',
    '..t.t...',
  ];
  const FEMUR = [
    'hh..........',
    'Ls.hh.......',
    '.sLLLhh.....',
    '......sLLhs.',
    '.........hLs',
    '..........ss',
  ];
  const RIB = ['..hhh.', '.h...s', 'h.....', 's.....'];
  const BIT = ['hLs'];
  function stampSprite(rows, x0, y0, map) {
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        set(x0 + x, y0 + y, map[ch]);
        addMask(x0 + x, y0 + y, BONE);
      }
  }
  function paintBones() {
    const map = { L: P.bone[1], h: P.bone[2], s: P.bone[0], D: P.soil[0], t: P.bone[0] };
    // little pocket of darker earth around the remains
    for (let y = 247; y <= 260; y++)
      for (let x = 268; x <= 322; x++) {
        const e = ((x - 296) / 28) ** 2 + ((y - 253.5) / 7) ** 2;
        if (e < 1 && vn(x / 3, y / 2, 141) > 0.35 + e * 0.5 && !(mask(x, y) & (ROOT | COF))) set(x, y, P.soil[1]);
      }
    stampSprite(SKULL, 298, 247, map);
    stampSprite(FEMUR, 279, 251, map);
    stampSprite(RIB, 309, 255, map);
    stampSprite(RIB.map((s) => s.split('').reverse().join('')), 314, 256, map);
    stampSprite(BIT, 271, 257, map);
    stampSprite(['hs', '.s'], 293, 258, map);
  }

  // ---- worm tunnel ---------------------------------------------------------
  const WORM = { x: 150, y: 243 };
  // (kit.WORM is filled in below)
  function paintWormTunnel() {
    let x = WORM.x - 1;
    let y = WORM.y;
    const r = HD.rng(77);
    for (let i = 0; i < 18; i++) {
      set(x, y, P.soil[1]);
      set(x, y + 1, P.soil[1]);
      x -= 1;
      if (r() < 0.3) y += r() < 0.5 ? -1 : 1;
      y = clamp(y, FRONT + 4, 247);
    }
  }

  // ---- fade into the dark --------------------------------------------------
  function paintFade() {
    const y0 = 259;
    for (let y = y0; y < BOT; y++) {
      const k = Math.pow((y - y0 + 0.5) / (BOT - y0), 0.85);
      for (let x = 0; x < W; x++) {
        if (bayer(x, y) < k) set(x, y, P.night[0]);
        else if (bayer(x, y) < k + 0.18 && !(mask(x, y) & (ROOT | COF | BONE))) set(x, y, P.soil[0]);
      }
    }
  }

  // ------------------------------------------------------------------
  function bakeCanvas(litWanted) {
    return HD.bake(W, H, (g, cv) => {
      const ctx = cv.getContext('2d');
      const im = ctx.createImageData(W, H);
      const d = im.data;
      for (let k = 0; k < W * H; k++) {
        const c = C[k];
        if (!c || LIT[k] !== litWanted) continue;
        const rgb = HD.color.hex(c);
        d[k * 4] = rgb[0];
        d[k * 4 + 1] = rgb[1];
        d[k * 4 + 2] = rgb[2];
        d[k * 4 + 3] = 255;
      }
      ctx.putImageData(im, 0, 0);
    });
  }

  function begin() {
    C = new Array(W * H).fill(null);
    LIT = new Uint8Array(W * H);
    M = new Uint8Array(W * H);
    OV = new Uint8Array(W * H);
  }
  /** bake the current raster; `over` = mask of pixels drawn above the puddle reflections */
  function finish() {
    let y0 = H;
    let y1 = -1;
    for (let k = 0; k < W * H; k++)
      if (OV[k]) {
        const y = (k / W) | 0;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    const out = { lit: bakeCanvas(1), cut: bakeCanvas(0), over: null };
    if (y1 >= 0) {
      // bounding box of the overlay pixels + their offsets inside it
      let x0 = W;
      let x1 = -1;
      for (let k = 0; k < W * H; k++)
        if (OV[k]) {
          const x = k % W;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      const bw = x1 - x0 + 1;
      const idx = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (OV[y * W + x]) idx.push(((y - y0) * bw + (x - x0)) * 4);
      out.over = { x: x0, y: y0 + Y0, w: bw, h: y1 - y0 + 1, idx: Int32Array.from(idx) };
    }
    C = LIT = M = OV = null;
    return out;
  }

  // the Halloween ('wet-autumn') slab: the original pipeline, untouched
  function buildHalloween() {
    begin();
    paintBase();
    paintMud();
    paintPuddles();
    paintGrass();
    paintPath();
    paintLeaves();
    paintBackEdge();
    paintStrata();
    paintPebbles();
    paintCoffin();
    paintRoots();
    paintBones();
    paintWormTunnel();
    paintLip();
    paintFade();
    const out = finish();
    out.worm = true;
    return out;
  }

  // toolkit for src/ground-seasons.js (the other seven editions)
  const kit = {
    W, H, Y0, BACK, FRONT, BOT, CUT_LIT, PUD, RIM, STONE, MUD, COF, ROOT, BONE, FIRE, WORM: null,
    begin, finish, at, set, get, mask, addMask, vn, fbm, qd, depth, mudSpots, pudRows, tuft, pathPoint, pathLen, stone, pebble, polyInside,
    paintMud, paintStrata, paintPebbles, paintRoots, paintWormTunnel, paintFade,
    /** set a pixel with an explicit lit flag (1 = relit top face, 0 = emissive cut face) */
    setLit(x, y, c, lit) {
      const k = at(x, y);
      if (k < 0) return;
      C[k] = c;
      LIT[k] = lit;
    },
    /** mark a pixel to be re-drawn above the puddle reflections */
    over(x, y) {
      const k = at(x, y);
      if (k >= 0) OV[k] = 1;
    },
    raw: () => ({ C, LIT, M, OV }),
  };

  // editions whose slabs come out identical share one bake (the Summer Story
  // chapters all use the same meadow): the ground reads only these fields
  const slabKey = (ed) =>
    [ed.ground, ed.fire, ed.tags.filter((t) => t.startsWith('secret-') || t === 'frozen-puddles').join(','), ed.ground === 'thin-snow' ? ed.id : ''].join('|');
  const slabs = new Map();
  const art = HD.perEdition((ed) => {
    const key = slabKey(ed);
    let v = slabs.get(key);
    if (!v) slabs.set(key, (v = ed.ground === 'wet-autumn' || !HD.groundSeasons ? buildHalloween() : HD.groundSeasons.build(ed, kit)));
    return v;
  });

  const WORM_BODY = P.wood[7];
  const WORM_HEAD = mix(P.wood[7], P.bone[2], 0.35);
  const WORM_BELLY = P.wood[5];

  kit.WORM = WORM;

  HD.module('ground', {
    init() {
      art();
      // bake every other edition's slab now, once, before any frame is shown,
      // so a live HD.setEdition() switch never stalls a frame while it rasterises
      const cur = HD.edition;
      for (const e of HD.EDITIONS || []) {
        if (e === cur) continue;
        HD.edition = e;
        try {
          art();
        } catch (err) {
          // left unbaked: drawing that edition retries the bake and reports the error
        } finally {
          HD.edition = cur;
        }
      }
    },
    passes: [
      {
        layer: 'scene',
        z: 5,
        draw(g) {
          const A = art();
          g.em.sprite(A.cut, 0, Y0);
          g.sprite(A.lit, 0, Y0);
        },
      },
      {
        layer: 'fx',
        z: 21,
        id: 'puddle-overlay',
        draw(g) {
          // seasonal bits that float on the puddles (lily pads, ice cracks,
          // leaves): copy their relit scene pixels back above the reflections
          const A = art();
          const O = A.over;
          if (!O) return;
          const src = HD.buffers.scene.getContext('2d').getImageData(O.x, O.y, O.w, O.h).data;
          const img = g.ctx.getImageData(O.x, O.y, O.w, O.h);
          const d = img.data;
          const idx = O.idx;
          for (let i = 0; i < idx.length; i++) {
            const q = idx[i];
            if (src[q + 3] === 0) continue;
            d[q] = src[q];
            d[q + 1] = src[q + 1];
            d[q + 2] = src[q + 2];
          }
          g.ctx.putImageData(img, O.x, O.y);
        },
      },
      {
        layer: 'scene',
        z: 6,
        draw(g, t) {
          const A = art();
          if (A.anim) A.anim(g, t);
          if (!A.worm) return;
          // worm: a slow inchworm wiggle at 4 fps
          const ts = T.step(t, 4);
          const ph = T.phase(ts, 3.2);
          const stretch = ph < 0.5 ? 1 : 0;
          const n = 5 + stretch;
          for (let i = 0; i < n; i++) {
            const lift = stretch ? 0 : i === 2 || i === 3 ? -1 : 0;
            const wig = Math.round(0.6 * Math.sin(T.TAU * (T.phase(ts, 1.1) + i * 0.18)));
            const x = WORM.x + i - (stretch ? 1 : 0);
            const y = WORM.y + lift + (i === n - 1 ? wig : 0);
            g.em.px(x, y, i === n - 1 ? WORM_HEAD : WORM_BODY);
            if (lift === 0) g.em.px(x, y + 1, WORM_BELLY);
          }
        },
      },
    ],
  });
})();
