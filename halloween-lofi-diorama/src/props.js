/*
 * props — the yard of Rainy Hollow.
 *   z12  gnarled moon tree (trunk, limbs, roots) + 1px twig tips that sway
 *   z13  two crows with idle animation
 *   z14  wrought-iron fence with a stone pillar, a gate and a bent section
 *   z16  tombstones (round, cross, tall, leaning)
 *   z32  pumpkin patch (unlit pumpkins, vines, leaves)
 *   z38  campfire back stones + crossed logs
 *   z46  campfire front stones
 *   z47  carved jack-o'-lanterns (emissive faces) + their flickering lights
 * Everything static is baked once in init(); a frame only blits sprites.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const L = HD.layout;
  const T = HD.time;
  const MOON = L.moon;

  // ------------------------------------------------------------------
  // Init-time raster buffer in screen coordinates (colour strings)
  // ------------------------------------------------------------------
  function Buf(x0, y0, w, h) {
    this.x0 = x0;
    this.y0 = y0;
    this.w = w;
    this.h = h;
    this.c = new Array(w * h).fill(null);
  }
  Buf.prototype.i = function (x, y) {
    x = Math.round(x) - this.x0;
    y = Math.round(y) - this.y0;
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? -1 : y * this.w + x;
  };
  Buf.prototype.set = function (x, y, c) {
    const k = this.i(x, y);
    if (k >= 0) this.c[k] = c;
  };
  Buf.prototype.get = function (x, y) {
    const k = this.i(x, y);
    return k < 0 ? null : this.c[k];
  };
  Buf.prototype.del = function (x, y) {
    const k = this.i(x, y);
    if (k >= 0) this.c[k] = null;
  };
  Buf.prototype.line = function (x0, y0, x1, y1, c) {
    for (const p of bres(x0, y0, x1, y1)) this.set(p[0], p[1], c);
  };
  /** bake to a trimmed canvas; returns {cv, x, y} (screen position) */
  Buf.prototype.bake = function () {
    let mx0 = this.w;
    let my0 = this.h;
    let mx1 = -1;
    let my1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.c[y * this.w + x]) {
          if (x < mx0) mx0 = x;
          if (y < my0) my0 = y;
          if (x > mx1) mx1 = x;
          if (y > my1) my1 = y;
        }
    if (mx1 < 0) return { cv: HD.bake(1, 1, () => {}), x: 0, y: 0 };
    const w = mx1 - mx0 + 1;
    const h = my1 - my0 + 1;
    const src = this.c;
    const W0 = this.w;
    const cv = HD.bake(w, h, (g, c) => {
      const ctx = c.getContext('2d');
      const im = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const col = src[(y + my0) * W0 + x + mx0];
          if (!col) continue;
          const v = HD.color.hex(col);
          const o = (y * w + x) * 4;
          im.data[o] = v[0];
          im.data[o + 1] = v[1];
          im.data[o + 2] = v[2];
          im.data[o + 3] = 255;
        }
      ctx.putImageData(im, 0, 0);
    });
    return { cv, x: this.x0 + mx0, y: this.y0 + my0 };
  };

  function bres(x0, y0, x1, y1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const out = [];
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let g = 0; g < 2000; g++) {
      out.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return out;
  }

  /** ASCII rows -> list of [x, y, char] (skips '.' and ' ') */
  function cells(rows) {
    const out = [];
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] !== '.' && row[x] !== ' ') out.push([x, y, row[x]]);
    });
    return out;
  }

  // ------------------------------------------------------------------
  // Curves: Catmull-Rom densify, arc length, tangents, clean 1px paths
  // ------------------------------------------------------------------
  const cr = (a, b, c, d, u) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  function spline(pts, step) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(n - 1, i + 2)];
      const k = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let j = 0; j < k; j++) {
        const u = j / k;
        out.push([cr(p0[0], p1[0], p2[0], p3[0], u), cr(p0[1], p1[1], p2[1], p3[1], u)]);
      }
    }
    out.push([pts[n - 1][0], pts[n - 1][1]]);
    return out;
  }
  function annotate(sm) {
    const out = [];
    let s = 0;
    for (let i = 0; i < sm.length; i++) {
      if (i) s += Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]);
      const a = sm[Math.max(0, i - 3)];
      const b = sm[Math.min(sm.length - 1, i + 3)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      out.push({ x: sm[i][0], y: sm[i][1], s, tx, ty });
    }
    return out;
  }
  /** rounded pixels along a dense path, deduped, with L-corners removed */
  function cleanPath(pts) {
    const raw = [];
    for (const p of pts) {
      const x = Math.round(p[0]);
      const y = Math.round(p[1]);
      const l = raw[raw.length - 1];
      if (l && l[0] === x && l[1] === y) continue;
      raw.push([x, y]);
    }
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const a = out[out.length - 1];
      const b = raw[i + 1];
      const c = raw[i];
      if (a && b && Math.abs(a[0] - b[0]) === 1 && Math.abs(a[1] - b[1]) === 1 && (c[0] === a[0] || c[1] === a[1])) continue;
      out.push(c);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // THE TREE
  // ------------------------------------------------------------------
  const TX0 = 300;
  const TY0 = 0;
  const TW = 180;
  const TH = 226;
  const TREE = {}; // filled by buildTree
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function buildTree() {
    const N = TW * TH;
    const F = {
      occ: new Uint8Array(N),
      cd: new Float32Array(N).fill(99),
      v: new Float32Array(N),
      w: new Float32Array(N),
      nx: new Float32Array(N),
      ny: new Float32Array(N),
      s: new Float32Array(N),
      id: new Int16Array(N),
    };
    const idx = (x, y) => {
      x -= TX0;
      y -= TY0;
      return x < 0 || y < 0 || x >= TW || y >= TH ? -1 : y * TW + x;
    };
    const rnd = HD.rng(TREE_SEED);
    const R = (a, b) => a + (b - a) * rnd();
    const tips = [];
    let nextId = 1;

    const groundCut = (x) => L.tree.base + 3 + (HD.hash(x, 5, 9) < 0.45 ? 1 : 0);
    function mark(px, py, d, v, w, nx, ny, s, id) {
      const q = idx(px, py);
      if (q < 0) return;
      if (py > groundCut(px) && w > 3) return;
      F.occ[q] = 1;
      if (d < F.cd[q] - 0.05 || w > F.w[q] + 2) {
        F.cd[q] = d;
        F.v[q] = v;
        F.w[q] = w;
        F.nx[q] = nx;
        F.ny[q] = ny;
        F.s[q] = s;
        F.id[q] = id;
      }
    }

    function stamp(curve, w0, w1, taper, id) {
      const len = curve[curve.length - 1].s || 1;
      const thin = [];
      for (const p of curve) {
        const k = p.s / len;
        const w = w0 + (w1 - w0) * Math.pow(k, taper);
        const nx = -p.ty;
        const ny = p.tx;
        if (w >= 2.4) {
          const r = w / 2;
          const ir = Math.ceil(r) + 1;
          const ix = Math.round(p.x);
          const iy = Math.round(p.y);
          for (let dy = -ir; dy <= ir; dy++)
            for (let dx = -ir; dx <= ir; dx++) {
              const ox = ix + dx - p.x;
              const oy = iy + dy - p.y;
              const d2 = ox * ox + oy * oy;
              if (d2 > r * r) continue;
              mark(ix + dx, iy + dy, Math.sqrt(d2) / r, (ox * nx + oy * ny) / r, w, nx, ny, p.s, id);
            }
        } else if (w >= 1.45) {
          // two-pixel stroke: one pixel either side of the centre line
          const ax = Math.round(p.x - nx * 0.5);
          const ay = Math.round(p.y - ny * 0.5);
          const bx = Math.round(p.x + nx * 0.5);
          const by = Math.round(p.y + ny * 0.5);
          mark(ax, ay, 0.5, -0.7, w, nx, ny, p.s, id);
          if (bx !== ax || by !== ay) mark(bx, by, 0.5, 0.7, w, nx, ny, p.s, id);
        } else thin.push([p.x, p.y]);
      }
      if (thin.length) for (const q of cleanPath(thin)) mark(q[0], q[1], 0, 0, 1, 0, 0, 0, id);
    }

    function gnarl(pts, amp, freq) {
      let c = annotate(spline(pts, 0.3));
      if (amp > 0) {
        const ph = R(0, 6.28);
        const ph2 = R(0, 6.28);
        const sm = c.map((p) => {
          const o = amp * (0.7 * Math.sin(p.s * freq + ph) + 0.3 * Math.sin(p.s * freq * 2.7 + ph2)) * Math.min(1, p.s / 5);
          return [p.x - p.ty * o, p.y + p.tx * o];
        });
        c = annotate(sm);
      }
      return c;
    }

    function limb(pts, w0, w1, o) {
      o = o || {};
      const id = nextId++;
      const curve = gnarl(pts, o.gnarl === undefined ? Math.min(1.0, 0.15 + w0 * 0.09) : o.gnarl, o.freq || 0.17);
      const taper = o.taper || 1;
      stamp(curve, w0, w1, taper, id);
      return { curve, w0, w1, taper, id, len: curve[curve.length - 1].s };
    }
    const widthAt = (b, s) => b.w0 + (b.w1 - b.w0) * Math.pow(Math.min(1, s / b.len), b.taper);
    function pointAt(b, s) {
      const c = b.curve;
      let lo = 0;
      let hi = c.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (c[m].s < s) lo = m;
        else hi = m;
      }
      return c[hi];
    }
    const inMoon = (x, y, pad) => Math.hypot(x - MOON.x, y - MOON.y) < MOON.r + pad;
    const outOfBounds = (p, o) => p[0] < 322 || p[0] > 494 || p[1] < -10 || p[1] > (o.maxY || 176);

    function tip(pts, curlDir) {
      // swaying 1px twig; finish with a small hook
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const c = Math.cos(curlDir * 0.9);
      const s = Math.sin(curlDir * 0.9);
      pts.push([b[0] + ((dx * c - dy * s) / l) * 2.2, b[1] + ((dx * s + dy * c) / l) * 2.2]);
      tips.push({ pts, g: tips.length % 7 });
    }

    function fingers(b, n, o) {
      const e = b.curve[b.curve.length - 1];
      for (let k = 0; k < n; k++) {
        const a = (k - (n - 1) / 2) * R(0.45, 0.7) + R(-0.15, 0.15);
        const dx = e.tx * Math.cos(a) - e.ty * Math.sin(a);
        const dy = e.tx * Math.sin(a) + e.ty * Math.cos(a);
        const ln = R(4, 8);
        const pts = [[e.x, e.y], [e.x + dx * ln * 0.55, e.y + dy * ln * 0.55], [e.x + dx * ln, e.y + dy * ln]];
        if (pts.some((p) => outOfBounds(p, o) || (!o.moonOk && inMoon(p[0], p[1], 1)))) continue;
        tip(pts, a >= 0 ? 1 : -1);
      }
    }

    /** recursive gnarled grower: elbows along a segment, forks at its end */
    function grow(x, y, ang, len, w, depth, o) {
      let pts = null;
      for (let attempt = 0; attempt < 6 && !pts; attempt++) {
        const a0 = ang + (attempt ? R(-0.5, 0.5) : 0);
        const n = Math.max(2, Math.round(len / 7));
        const cand = [[x, y]];
        let a = a0;
        let px = x;
        let py = y;
        for (let k = 0; k < n; k++) {
          a += R(-1, 1) * (o.kink || 0.3);
          a += wrapA(-Math.PI / 2 - a) * (o.rise === undefined ? 0.06 : o.rise);
          const sl = (len / n) * R(0.85, 1.15);
          px += Math.cos(a) * sl;
          py += Math.sin(a) * sl;
          cand.push([px, py]);
        }
        const bad = cand.some((p, k) => k > 0 && (outOfBounds(p, o) || (!o.moonOk && inMoon(p[0], p[1], 2 + w * 0.5))));
        if (!bad) pts = cand;
      }
      if (!pts) return;
      if (w < 1.45) {
        tip(pts, rnd() < 0.5 ? -1 : 1);
        return;
      }
      const w1 = Math.max(1.2, w * (o.taperK || 0.62));
      const b = limb(pts, w, w1, { gnarl: Math.min(0.7, w * 0.08), freq: 0.22 });
      if (depth >= (o.maxDepth || 4) || w1 < 1.5) {
        fingers(b, rnd() < 0.5 ? 2 : 3, o);
        return;
      }
      const e = b.curve[b.curve.length - 1];
      const ea = Math.atan2(e.ty, e.tx);
      const two = w1 > 2.6 || rnd() < 0.75;
      if (two) {
        const sp = R(0.32, 0.55);
        const lean = R(-0.12, 0.12);
        const big = rnd() < 0.5 ? -1 : 1;
        grow(e.x, e.y, ea - sp + lean, len * R(0.62, 0.8), w1 * (big < 0 ? 0.86 : 0.7), depth + 1, o);
        grow(e.x, e.y, ea + sp + lean, len * R(0.62, 0.8), w1 * (big > 0 ? 0.86 : 0.7), depth + 1, o);
      } else grow(e.x, e.y, ea + R(-0.2, 0.2), len * R(0.65, 0.8), w1 * 0.9, depth + 1, o);
      // side shoots
      const ns = len > 26 ? 2 : len > 14 ? 1 : 0;
      for (let k = 0; k < ns; k++) {
        const s = b.len * R(0.3, 0.8);
        const p = pointAt(b, s);
        const side = rnd() < 0.5 ? -1 : 1;
        grow(p.x, p.y, Math.atan2(p.ty, p.tx) + side * R(0.7, 1.15), len * R(0.32, 0.5), widthAt(b, s) * 0.42, depth + 2, o);
      }
    }

    // ---- trunk + root flare -------------------------------------------------
    const bx = L.tree.x;
    const by = L.tree.base;
    limb([[bx, by + 1], [bx - 1, by - 7], [bx - 2, by - 16]], 25, 16, { gnarl: 0, taper: 0.4 });
    limb(
      [[bx, by], [bx - 1, by - 14], [bx - 4, by - 30], [bx - 3, by - 46], [bx - 7, by - 62], [bx - 10, by - 74], [bx - 9, by - 84]],
      17,
      12.5,
      { gnarl: 0.9, freq: 0.08, taper: 0.8 },
    );
    // roots gripping the ground: thick knuckles that taper into the soil
    limb([[bx - 4, by - 12], [bx - 11, by - 7], [bx - 19, by - 3], [bx - 27, by], [bx - 35, by + 2], [bx - 39, by + 2]], 9, 1, { gnarl: 0.5, taper: 0.6 });
    limb([[bx + 4, by - 13], [bx + 12, by - 8], [bx + 20, by - 4], [bx + 29, by - 1], [bx + 36, by + 1], [bx + 40, by + 1]], 9, 1, { gnarl: 0.5, taper: 0.6 });
    limb([[bx - 4, by - 6], [bx - 8, by], [bx - 13, by + 4], [bx - 16, by + 5]], 7, 1.5, { gnarl: 0.2 });
    limb([[bx + 5, by - 6], [bx + 9, by], [bx + 14, by + 3], [bx + 16, by + 4]], 6, 1.5, { gnarl: 0.2 });
    limb([[bx - 7, by - 9], [bx - 15, by - 10], [bx - 24, by - 8], [bx - 28, by - 7]], 4.2, 1, { gnarl: 0.3 });
    limb([[bx + 1, by - 4], [bx + 1, by + 2], [bx + 2, by + 5]], 6, 3, { gnarl: 0 });

    // ---- main limbs (hand-placed), then grown --------------------------------
    const fx = bx - 9;
    const fy = by - 82;
    const OPT = { kink: 0.32, rise: 0.05, maxDepth: 4 };
    // A: up-left, with an elbow, framing the moon on the left
    const A = limb([[fx - 1, fy + 2], [fx - 7, fy - 9], [fx - 17, fy - 15], [fx - 22, fy - 24], [fx - 24, fy - 32], [fx - 31, fy - 40], [fx - 32, fy - 46]], 9.5, 5.8, { freq: 0.12, taper: 0.75 });
    grow(fx - 32, fy - 46, -1.9, 36, 5.8, 1, { ...OPT, maxDepth: 5 });
    grow(fx - 24, fy - 32, -2.75, 26, 3.2, 2, { ...OPT, rise: 0.04 });
    // B: up-right, framing the moon on the right
    const B2 = limb([[fx + 3, fy + 2], [fx + 11, fy - 9], [fx + 15, fy - 20], [fx + 23, fy - 29], [fx + 26, fy - 38], [fx + 33, fy - 47], [fx + 33, fy - 54]], 8.5, 5.2, { freq: 0.12, taper: 0.75 });
    grow(fx + 33, fy - 54, -1.3, 36, 5.2, 1, { ...OPT, maxDepth: 5 });
    grow(fx + 26, fy - 36, -0.35, 28, 3.0, 2, { ...OPT, rise: 0.03 });
    // C: long arm to the right over the graveyard
    const C = limb([[bx - 4, by - 60], [bx + 8, by - 66], [bx + 19, by - 68], [bx + 30, by - 75], [bx + 40, by - 84]], 7, 4.2, { freq: 0.15, taper: 0.8 });
    grow(bx + 40, by - 84, -0.35, 36, 4.0, 1, { ...OPT, rise: 0.02 });
    grow(bx + 19, by - 68, -1.0, 20, 2.6, 2, OPT);
    // D: lower arm to the left
    const D = limb([[bx - 6, by - 50], [bx - 15, by - 55], [bx - 25, by - 56], [bx - 35, by - 61]], 6, 3.8, { freq: 0.16, taper: 0.8 });
    grow(bx - 35, by - 61, -2.65, 26, 3.6, 1, { ...OPT, rise: 0.05 });
    // a broken stub on the trunk
    limb([[bx + 4, by - 40], [bx + 9, by - 44], [bx + 12, by - 45]], 4, 2.6, { gnarl: 0 });
    // branches crossing the moon disc: the iconic silhouette
    const MO = { ...OPT, moonOk: true, maxDepth: 3 };
    // a crooked branch rising across the moon with a Y-fork inside the disc
    const M1 = limb(
      [[fx - 24, fy - 32], [fx - 18, fy - 40], [fx - 15, fy - 48], [fx - 8, fy - 53], [fx - 4, fy - 60], [fx, fy - 65], [fx + 3, fy - 70], [fx + 7, fy - 72], [fx + 12, fy - 77], [fx + 15, fy - 83], [fx + 16, fy - 90], [fx + 20, fy - 97]],
      3.9,
      1.9,
      { gnarl: 0.35, freq: 0.3, taper: 0.9 },
    );
    grow(fx + 20, fy - 97, -1.45, 14, 1.8, 3, MO);
    const M1b = limb([[fx + 7, fy - 72], [fx + 4, fy - 78], [fx + 2, fy - 85], [fx - 2, fy - 90], [fx - 5, fy - 95]], 1.6, 1.2, { gnarl: 0.2, freq: 0.4 });
    grow(fx - 5, fy - 95, -2.0, 9, 1.2, 4, MO);
    tips.push({ pts: [[fx + 1, fy - 66], [fx + 4, fy - 63], [fx + 9, fy - 62], [fx + 12, fy - 60]], g: 3 });
    TREE.limbs = { A, B2, C, D, M1, M1b };

    // ---- shading -----------------------------------------------------------
    const has = (x, y) => {
      const q = idx(x, y);
      return q >= 0 && F.occ[q] === 1;
    };
    const Bt = new Buf(TX0, TY0, TW, TH);
    for (let q = 0; q < N; q++) {
      if (!F.occ[q]) continue;
      const x = TX0 + (q % TW);
      const y = TY0 + Math.floor(q / TW);
      Bt.set(x, y, treeColour(x, y, F.w[q], F.v[q], F.nx[q], F.ny[q], F.s[q], F.id[q], has));
    }
    // hollow in the trunk: dark core, lit lower lip
    const hx = bx - 2;
    const hy = by - 34;
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const e = (dx * dx) / 6.5 + (dy * dy) / 20;
        if (e > 1) continue;
        Bt.set(hx + dx, hy + dy, e < 0.5 ? P.night[0] : P.violet[0]);
      }
    for (const [dx, dy] of [[2, 3], [2, 4], [1, 5], [3, 2], [3, 1], [3, 0], [0, 5]]) Bt.set(hx + dx, hy + dy, P.wood[4]);
    for (const [dx, dy] of [[-3, 1], [-3, 0], [-3, -1], [-2, 3]]) Bt.set(hx + dx, hy + dy, P.violet[0]);
    for (const [dx, dy] of [[-1, -5], [0, -6], [1, -5]]) Bt.set(hx + dx, hy + dy, P.violet[1]);
    TREE.has = has;
    TREE.body = Bt.bake();

    // ---- swaying tips: bake 3 states per group ------------------------------
    TREE.groups = [];
    for (let gi = 0; gi < 7; gi++) {
      const st = [];
      for (let sw = -1; sw <= 1; sw++) {
        const Bg = new Buf(TX0 - 4, TY0 - 4, TW + 8, TH + 8);
        for (const tp of tips) {
          if (tp.g !== gi) continue;
          const c = annotate(spline(tp.pts, 0.25));
          const len = c[c.length - 1].s || 1;
          const pts = c.map((p) => [p.x + sw * Math.pow(p.s / len, 1.5) * 1.2, p.y]);
          const px = cleanPath(pts);
          for (let k = 1; k < px.length; k++) {
            const [x, y] = px[k];
            if (has(x, y)) continue;
            Bg.set(x, y, twigColour(x, y));
          }
        }
        st.push(Bg.bake());
      }
      TREE.groups.push(st);
    }
    TREE.tipCount = tips.length;
  }
  const TREE_SEED = HD.num('treeSeed', 5);

  function moonDist(x, y) {
    return Math.hypot(x - MOON.x, y - MOON.y);
  }
  function twigColour(x, y) {
    const dm = moonDist(x, y);
    if (dm < MOON.r + 1) return P.violet[0];
    if (dm < MOON.r + 12) return P.violet[1];
    return P.violet[3];
  }
  function rimColour(x, y, dm) {
    const th = HD.bayer(x, y);
    if (dm < MOON.r + 18) return P.moon[0];
    if (dm < MOON.r + 26) return th < 0.5 ? P.moon[0] : P.night[9];
    if (dm < 70) return P.night[9];
    if (dm < 82) return th < 0.5 ? P.night[9] : P.night[8];
    if (dm < 125) return P.night[8];
    if (dm < 137) return th < 0.5 ? P.night[8] : P.night[7];
    if (dm < 146) return P.night[7];
    if (dm < 154) return th < 0.5 ? P.night[7] : P.night[6];
    return P.night[6];
  }
  const BODY = [P.violet[1], P.wood[2], P.wood[3], P.violet[3], P.violet[4]];
  function treeColour(x, y, w, v, nx, ny, s, id, has) {
    const dm = moonDist(x, y);
    if (dm < MOON.r + 1) return P.violet[0];
    if (w < 1.45) return twigColour(x, y);
    // light direction: towards the moon, biased to the upper right
    let lx = ((MOON.x - x) / dm) * 0.55 + 0.6 * 0.45;
    let ly = ((MOON.y - y) / dm) * 0.55 - 0.8 * 0.45;
    const ll = Math.hypot(lx, ly);
    lx /= ll;
    ly /= ll;
    const open = (xx, yy) => !has(xx, yy);
    const rim = (lx > 0.3 && open(x + 1, y)) || (lx < -0.3 && open(x - 1, y)) || (ly < -0.3 && open(x, y - 1)) || (ly > 0.3 && open(x, y + 1));
    if (rim) {
      if (dm < MOON.r + 4) return P.violet[1];
      return rimColour(x, y, dm);
    }
    const inner = w >= 5 && ((lx > 0.3 && open(x + 2, y)) || (ly < -0.3 && open(x, y - 2)));
    if (inner && dm > MOON.r + 6) return P.violet[4];
    const lit = v * (nx * lx + ny * ly);
    let tone = lit > 0.5 ? 3 : lit > 0.0 ? 2 : lit > -0.5 ? 1 : 0;
    // bark: long 1px cracks that follow the wood, with a lit ridge beside them
    if (w >= 5) {
      const r = w / 2;
      const nk = w >= 12 ? 4 : w >= 8 ? 3 : 2;
      for (let k = 0; k < nk; k++) {
        const vk = -0.72 + (1.44 * (k + 0.5)) / nk + 0.16 * Math.sin(s * 0.11 + id * 1.3 + k * 2.1);
        const on = Math.sin(s * (0.16 + k * 0.03) + k * 4.1 + id) > -0.45;
        if (!on) continue;
        const d = (v - vk) * r;
        if (Math.abs(d) < 0.5) tone = 0;
        else if (d > 0.5 && d < 1.5 && lit > -0.4 && tone < 3) tone += 1;
      }
    }
    if (dm < MOON.r + 8) tone = Math.min(tone, 1);
    return BODY[tone];
  }

  // ------------------------------------------------------------------
  // CROWS
  // ------------------------------------------------------------------
  // k body, d wing sheen, r rim (moon side), b beak, e eye glint, l legs
  const CROW_FRAMES = {
    idle: [
      '.........rr..',
      '........rkkr.',
      '........kekbb',
      '.......rkkkb.',
      '......rkkkk..',
      '...rrrkkkkk..',
      '.rrkkkkdkkk..',
      'rkkkkkddkkd..',
      'kkk..kkkkk...',
      '......l.l....',
    ],
    look: [
      '.........rr..',
      '........rkkr.',
      '......bbekk..',
      '.......bkkk..',
      '......rkkkk..',
      '...rrrkkkkk..',
      '.rrkkkkdkkk..',
      'rkkkkkddkkd..',
      'kkk..kkkkk...',
      '......l.l....',
    ],
    preen: [
      '.............',
      '.............',
      '.............',
      '.......rrrr..',
      '....rrrkkkkr.',
      '..rrkkkkkkek.',
      '.rkkkkkdkkkb.',
      'rkkkkkddkkbb.',
      'kkk..kkkkk...',
      '......l.l....',
    ],
    ruffle: [
      '.........rr..',
      '........rkkr.',
      '........kekbb',
      '..r.r..rkkkb.',
      '.rkrkrrkkkk..',
      '.rkkkkkkkkkd.',
      'rkkkkkkdkkkd.',
      'rkkkkkddkkkd.',
      'kkk..kkkkkk..',
      '......l.l....',
    ],
  };

  function bakeCrows() {
    const map = (near) => ({
      k: P.night[0],
      d: P.violet[1],
      r: near ? P.night[8] : P.night[6],
      b: P.stone[1],
      e: P.stone[5],
      l: P.stone[1],
    });
    const out = {};
    for (const near of [0, 1]) {
      const m = map(near);
      for (const k in CROW_FRAMES) out[k + near] = HD.sprite(CROW_FRAMES[k], m);
    }
    return out;
  }

  /** a flat bit of branch top near (tx, ty) with clear sky above it */
  function findPerch(tx, ty, rad) {
    const has = TREE.has;
    let best = null;
    for (let x = tx - rad; x <= tx + rad; x++)
      for (let y = ty - rad; y <= ty + rad; y++) {
        if (!has(x, y) || has(x, y - 1)) continue;
        let ok = true;
        for (let dx = -3; dx <= 3 && ok; dx++) {
          let found = false;
          for (let dy = -1; dy <= 1; dy++) if (has(x + dx, y + dy) && !has(x + dx, y + dy - 1)) found = true;
          if (!found) ok = false;
        }
        for (let dx = -6; dx <= 6 && ok; dx++)
          for (let dy = 2; dy <= 11; dy++)
            if (has(x + dx, y - dy)) {
              ok = false;
              break;
            }
        if (!ok) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (!best || d < best.d) best = { x, y, d };
      }
    return best;
  }

  // ------------------------------------------------------------------
  // FENCE
  // ------------------------------------------------------------------
  function bakeFence() {
    const f = L.fence;
    const B = new Buf(f.x0 - 1, f.top - 10, f.x1 - f.x0 + 2, f.base - f.top + 16);
    const IR0 = P.stone[0];
    const IR1 = P.stone[1];
    const IR2 = P.stone[2];
    const IR3 = P.stone[3];
    const RIM = P.stone[5];
    const RIM2 = P.night[8];
    const tree = TREE.has;
    const put = (x, y, c) => {
      if (!tree(x, y)) B.set(x, y, c);
    };
    const gnd = (x) => f.base + Math.round(0.7 * Math.sin(x * 0.061) + 0.6 * Math.sin(x * 0.17 + 1.3));
    const r1 = f.top + 5; // top rail
    const r2 = f.base - 5; // bottom rail

    // stone pillar at the left end: coursed blocks, a slab cap and a little pyramid
    const px0 = f.x0;
    const px1 = f.x0 + 6;
    const ptop = f.top - 4;
    for (let y = ptop; y <= gnd(px0) + 1; y++)
      for (let x = px0; x <= px1; x++) {
        const course = Math.floor((y - ptop) / 5);
        const row = (y - ptop) % 5;
        const joint = px0 + (course % 2 ? 2 : 4);
        let c = row === 0 ? P.stone[4] : P.stone[3];
        if (x === px0) c = P.stone[2];
        else if (x === px1) c = row === 4 ? P.stone[4] : P.stone[5];
        if (row === 4 && x < px1) c = P.stone[1];
        else if (x === joint && x !== px0) c = P.stone[1];
        put(x, y, c);
      }
    for (let x = px0 - 1; x <= px1 + 1; x++) {
      put(x, ptop - 1, x === px0 - 1 ? P.stone[1] : x >= px1 ? P.stone[4] : P.stone[2]);
      put(x, ptop - 2, x >= px1 ? P.stone[7] : x <= px0 ? P.stone[4] : P.stone[5]);
    }
    for (let x = px0 + 1; x <= px1 - 1; x++) put(x, ptop - 3, x >= px1 - 2 ? P.stone[5] : P.stone[3]);
    for (let x = px0 + 2; x <= px1 - 2; x++) put(x, ptop - 4, x === px1 - 2 ? P.stone[6] : P.stone[4]);
    put(px0 + 3, ptop - 5, P.stone[6]);
    // moss on the cap and down the shadow side
    for (const [dx, dy, m] of [[-1, -2, 4], [0, -2, 3], [0, -1, 3], [1, -2, 4], [0, 0, 3], [0, 1, 2], [0, 6, 3], [1, 6, 2]]) put(px0 + dx, ptop + dy, P.moss[m]);

    // gate: two leaves under an arched rail, iron gate post with a ball finial
    const gx0 = px1 + 1;
    const gpost = gx0 + 16;
    const gmid = (gx0 + gpost) / 2;
    const archY = (x) => f.top - Math.round(3 * (1 - Math.pow((x - gmid) / 9, 2)));
    for (let x = gx0; x < gpost; x++) {
      put(x, archY(x), IR1);
      put(x, archY(x) - 1, x > gmid ? RIM : IR3);
      put(x, r1 + 2, IR2);
      put(x, r2, IR2);
      put(x, r2 + 1, IR1);
    }
    for (let x = gx0 + 2, k = 0; x < gpost - 1; x += 3, k++) {
      const yt = archY(x) - 1;
      for (let y = yt; y <= gnd(x); y++) put(x, y, y < r1 + 2 ? IR2 : IR1);
      if (k % 2 === 0) {
        put(x, yt - 1, IR2);
        put(x, yt - 2, x > gmid ? RIM2 : RIM);
      }
    }
    // the gate stands a little ajar: a dark gap between the leaves
    for (let y = archY(gmid) + 1; y <= gnd(gmid); y++) put(Math.round(gmid), y, P.night[1]);
    const postTop = f.top - 6;
    for (let y = postTop; y <= gnd(gpost) + 1; y++) {
      put(gpost, y, IR1);
      put(gpost + 1, y, y < r1 ? RIM : IR2);
    }
    put(gpost, postTop - 1, IR2);
    put(gpost + 1, postTop - 1, RIM);
    put(gpost - 1, postTop - 2, IR1);
    put(gpost, postTop - 2, IR3);
    put(gpost + 1, postTop - 2, RIM2);
    put(gpost + 2, postTop - 2, RIM);
    put(gpost, postTop - 3, RIM);
    put(gpost + 1, postTop - 3, RIM2);

    // regular bars; one bay sags where something leaned on it long ago
    const bars = [];
    for (let x = gpost + 4; x < f.x1 + 2; x += 4) bars.push(x);
    const bend = { a: 443, b: 467 };
    const sag = (x) => {
      if (x <= bend.a || x >= bend.b) return 0;
      const k = (x - bend.a) / (bend.b - bend.a);
      return Math.round(Math.sin(k * Math.PI) * 2.4);
    };
    const lean = (x) => {
      if (x <= bend.a || x >= bend.b) return 0;
      const k = (x - bend.a) / (bend.b - bend.a);
      return Math.round(Math.sin(k * Math.PI) * 2.2 * (k < 0.5 ? -0.5 : 1));
    };
    for (let x = gpost + 2; x <= f.x1; x++) {
      const yy = r1 + sag(x);
      put(x, yy - 1, x % 9 === 4 ? IR2 : IR3);
      put(x, yy, IR1);
      put(x, r2, IR2);
      put(x, r2 + 1, IR1);
    }
    bars.forEach((x, i) => {
      if (x === bars[bars.length - 7]) return; // a missing bar
      const yb = gnd(x);
      const lt = lean(x);
      const broken = x === bars[bars.length - 5];
      const yt = broken ? r1 + 4 : f.top + 1 + sag(x);
      for (let y = r2; y <= yb; y++) put(x, y, IR1);
      for (const [px, py] of bres(x, r2, x + lt, yt)) put(px, py, py < r1 + sag(x) ? IR2 : IR1);
      const tx = x + lt;
      if (broken) {
        put(tx + 1, yt, RIM);
        return;
      }
      put(tx, yt - 1, IR2);
      put(tx - 1, yt - 2, IR1);
      put(tx, yt - 2, IR2);
      put(tx + 1, yt - 2, RIM);
      put(tx, yt - 3, i % 3 === 1 ? RIM2 : RIM);
      // little diamonds between the bars under the top rail
      if (i % 2 === 0 && !lt && !lean(x + 4) && !sag(x + 2) && x + 4 < f.x1) {
        const dx = x + 2;
        const dy = r1 + 4;
        put(dx, dy - 1, IR2);
        put(dx - 1, dy, IR2);
        put(dx + 1, dy, IR2);
        put(dx, dy + 1, IR1);
      }
    });
    // tufts at the foot of the fence
    for (let x = f.x0 + 9; x < f.x1; x += 5 + ((x * 7) % 4)) grassTuft(B, x, gnd(x) + 1, x * 13, tree);
    return B.bake();
  }

  function grassTuft(B, x, y, seed, skip) {
    const r = HD.rng(seed | 0);
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const bx = x + k - (n >> 1) + (r() < 0.3 ? 1 : 0);
      const h = 1 + Math.floor(r() * 3);
      const lean = r() < 0.4 ? 1 : 0;
      for (let j = 0; j < h; j++) {
        const xx = bx + (j === h - 1 ? lean : 0);
        const yy = y - j;
        if (skip && skip(xx, yy)) continue;
        B.set(xx, yy, j === h - 1 ? (r() < 0.5 ? P.moss[5] : P.moss[4]) : P.moss[3]);
      }
    }
  }

  // ------------------------------------------------------------------
  // TOMBSTONES
  // ------------------------------------------------------------------
  const FONT = {
    R: ['XX.', 'X.X', 'XX.', 'X.X', 'X.X'],
    I: ['X', 'X', 'X', 'X', 'X'],
    P: ['XX.', 'X.X', 'XX.', 'X..', 'X..'],
  };
  const SKULL = ['.XXX.', 'XXXXX', 'X.X.X', 'XXXXX', '.X.X.'];

  function tombShape(kind) {
    // returns inside(u, v) in local coords: u right of centre, v up from base
    if (kind === 'round')
      return (u, v) => (Math.abs(u) <= 7.5 && v >= 0 && v < 2.5) || (Math.abs(u) <= 6.2 && v >= 0 && (v <= 11 || (u * u) / 40 + ((v - 11) * (v - 11)) / 44 <= 1));
    if (kind === 'cross')
      return (u, v) => (Math.abs(u) <= 5.5 && v >= 0 && v < 3) || (Math.abs(u) <= 1.6 && v >= 0 && v <= 21) || (Math.abs(u) <= 6.2 && v >= 13.5 && v <= 16.6);
    if (kind === 'tall')
      return (u, v) =>
        (Math.abs(u) <= 6.5 && v >= 0 && v < 3) ||
        (Math.abs(u) <= 5.5 && v >= 3 && v < 4.5) ||
        (Math.abs(u) <= 4.5 && v >= 4.5 && v <= 25 + (4.6 - Math.abs(u)) * 1.25);
    // leaning slab with shoulders
    return (u, v) => Math.abs(u) <= 5.6 && v >= -3 && (v <= 11 || (Math.abs(u) <= 4.2 && v <= 13.2) || (Math.abs(u) <= 2.4 && v <= 14.4));
  }

  function bakeTombstone(st, idx) {
    const kind = st.kind;
    const inside = tombShape(kind);
    const ang = kind === 'leaning' ? 0.22 : 0;
    const B = new Buf(st.x - 16, st.base - 40, 34, 46);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const sink = kind === 'leaning' ? 2 : 0;
    // screen offset -> local (u, v)
    const loc = (x, y) => {
      const dx = x - st.x;
      const dy = st.base + sink - y;
      return [dx * ca - dy * sa, dx * sa + dy * ca];
    };
    const ins = (x, y) => {
      if (y > st.base) return false;
      const [u, v] = loc(x, y);
      return inside(u, v);
    };
    const chips = { round: [[4, 17], [5, 16], [-6, 5]], cross: [[6, 15], [-6, 16], [1, 21]], tall: [[-4, 21], [4, 4]], leaning: [[5, 11], [4, 12], [5, 10], [-5, 1]] }[kind];
    const chipped = (u, v) => chips.some(([cu, cv]) => Math.abs(u - cu) < 0.9 && Math.abs(v - cv) < 0.9);
    const solid = (x, y) => {
      if (!ins(x, y)) return false;
      const [u, v] = loc(x, y);
      return !chipped(u, v);
    };
    // pass 1: thickness (back face) visible on the left/top
    for (let y = B.y0; y < B.y0 + B.h; y++)
      for (let x = B.x0; x < B.x0 + B.w; x++) {
        if (solid(x, y)) continue;
        if (solid(x + 1, y + 1) || solid(x + 1, y)) {
          const top = solid(x + 1, y + 1) && !solid(x, y + 1) && !solid(x + 1, y);
          B.set(x, y, top ? P.stone[5] : P.stone[2]);
        }
      }
    // pass 2: front face
    for (let y = B.y0; y < B.y0 + B.h; y++)
      for (let x = B.x0; x < B.x0 + B.w; x++) {
        if (!solid(x, y)) continue;
        const [u, v] = loc(x, y);
        let c = P.stone[4];
        const eR = !solid(x + 1, y);
        const eT = !solid(x, y - 1);
        const eL = !solid(x - 1, y);
        if (eT && eR) c = P.stone[7];
        else if (eT) c = u > -2 ? P.stone[6] : P.stone[5];
        else if (eR) c = P.stone[6];
        else if (eL) c = P.stone[3];
        else if (!solid(x + 2, y) || !solid(x, y - 2) || (!solid(x, y - 3) && HD.bayer(x, y) < 0.5)) c = P.stone[5];
        // rain streaks / weathering under the top
        const streak = HD.hash(Math.round(u * 1.0 + 40), idx, 3) < 0.28;
        if (c === P.stone[4] && streak && v > 4) c = P.stone[3];
        // bottom shade
        if (c === P.stone[4] && v < 2.5) c = P.stone[3];
        B.set(x, y, c);
      }
    // engravings
    const engrave = (rows, u0, v0, col) => {
      for (const [cx, cy] of cells(rows)) {
        // map local (u, v) to screen and set
        const u = u0 + cx;
        const v = v0 - cy;
        const sx = st.x + u * ca + v * sa;
        const sy = st.base + sink - (-u * sa + v * ca);
        if (solid(Math.round(sx), Math.round(sy))) B.set(sx, sy, col);
      }
    };
    if (kind === 'round') {
      const rows = [];
      for (let r = 0; r < 5; r++) rows.push(FONT.R[r] + '.' + FONT.I[r] + '.' + FONT.P[r]);
      engrave(rows, -4, 13, P.stone[2]);
      engrave(['XX.XXX', '......', 'XXX.XX'], -3, 6, P.stone[3]);
    } else if (kind === 'tall') {
      engrave(SKULL, -2, 22, P.stone[2]);
      engrave(['XXXXX', '.....', 'XXX.X', '.....', 'X.XXX'], -2, 14, P.stone[3]);
    } else if (kind === 'leaning') {
      engrave(['.X.', 'XXX', '.X.', '.X.'], -1, 11, P.stone[2]);
      engrave(['XXX.X', '.....', 'X.XXX'], -2, 5, P.stone[3]);
    } else if (kind === 'cross') {
      engrave(['X', '.', 'X'], 0, 19, P.stone[3]);
    }
    // cracks
    const cracks = {
      round: [[3, 16], [2, 15], [2, 14], [3, 13]],
      cross: [[-1, 12], [0, 11], [0, 10], [-1, 9]],
      tall: [[2, 26], [2, 25], [1, 24], [2, 23]],
      leaning: [[1, 13], [1, 12], [2, 11], [2, 10], [3, 9], [-2, 8], [-1, 8]],
    }[kind];
    engrave(cracks.map(() => 'X'), 0, 0, P.stone[2]);
    for (const [u, v] of cracks) {
      const sx = st.x + u * ca + v * sa;
      const sy = st.base + sink - (-u * sa + v * ca);
      if (solid(Math.round(sx), Math.round(sy))) B.set(sx, sy, P.stone[2]);
    }
    // moss clusters (top-left & base)
    const moss = {
      round: [[-6, 10, 4], [-5, 11, 3], [-6, 9, 3], [-4, 15, 4], [-3, 16, 3], [-7, 1, 4], [-6, 2, 3], [5, 1, 3]],
      cross: [[-5, 15, 4], [-4, 16, 3], [-1, 20, 3], [-5, 1, 4], [-4, 2, 3], [4, 1, 3]],
      tall: [[-4, 24, 4], [-3, 26, 3], [-4, 10, 3], [-6, 1, 4], [-5, 2, 3], [5, 2, 3], [6, 1, 4]],
      leaning: [[-5, 9, 4], [-5, 10, 3], [-3, 13, 4], [-5, 0, 4], [-4, 0, 3], [-4, 1, 3]],
    }[kind];
    for (const [u, v, m] of moss) {
      const sx = st.x + u * ca + v * sa;
      const sy = st.base + sink - (-u * sa + v * ca);
      if (solid(Math.round(sx), Math.round(sy))) B.set(sx, sy, P.moss[m]);
    }
    // contact shadow on the ground (moon is behind-right -> shadow falls front-left)
    for (let x = st.x - 10; x <= st.x + 7; x++) {
      const y = st.base + 1;
      if (!B.get(x, y)) {
        const k = (x - (st.x - 10)) / 17;
        if (HD.bayer(x, y) < 0.35 + k * 0.6) B.set(x, y, P.moss[1]);
      }
    }
    // grass tufts
    grassTuft(B, st.x - 6, st.base + 1, idx * 31 + 1);
    grassTuft(B, st.x + 1, st.base + 1, idx * 31 + 2);
    grassTuft(B, st.x + 6, st.base + 1, idx * 31 + 3);
    return B.bake();
  }

  // ------------------------------------------------------------------
  // PUMPKINS (shared by the patch and the jack-o'-lanterns)
  // ------------------------------------------------------------------
  /**
   * Paint a pumpkin body into B, lit from (lx, ly, lz) (screen space vector
   * from the pumpkin towards its key light; ly < 0 = above). Painted dark:
   * the engine's relight turns it orange near the fire. Returns the pixel set.
   */
  function pumpkinBody(B, cx, cy, rx, ry, o) {
    const lobes = o.lobes || 5;
    const RAMP = o.ramp || P.pumpkin;
    let lx = o.lx;
    let ly = o.ly;
    let lz = o.lz === undefined ? 0.55 : o.lz;
    const ll = Math.hypot(lx, ly, lz);
    lx /= ll;
    ly /= ll;
    lz /= ll;
    const dip = o.dip === undefined ? 1.2 : o.dip;
    const RX = rx + 0.4;
    const RY = ry + 0.4;
    const inside = (x, y) => {
      const nx = (x - cx) / RX;
      const ny = (y - cy) / RY;
      // slightly flattened bottom
      const k = ny > 0 ? nx * nx + Math.pow(ny, 2.6) : nx * nx + ny * ny;
      if (k > 1) return false;
      if (ny < 0) {
        const topY = -Math.sqrt(Math.max(0, 1 - nx * nx));
        const d = dip * Math.exp(-((nx / 0.3) * (nx / 0.3)));
        if (ny < topY + d / RY) return false;
      }
      return true;
    };
    const vals = new Map();
    const key = (x, y) => x + ',' + y;
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (!inside(x, y)) continue;
        const nx = (x - cx) / RX;
        const ny = (y - cy) / RY;
        const cl = Math.sqrt(Math.max(1e-3, 1 - ny * ny));
        const lon = Math.asin(Math.max(-1, Math.min(1, nx / cl)));
        const q = (lon / Math.PI + 0.5) * lobes;
        const fr = q - Math.floor(q);
        const bulge = Math.sin(Math.PI * fr);
        const tilt = (fr - 0.5) * 0.7;
        let Nx = nx + tilt * cl;
        let Ny = ny;
        let Nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) + 0.2;
        const nl = Math.hypot(Nx, Ny, Nz);
        Nx /= nl;
        Ny /= nl;
        Nz /= nl;
        const dif = Math.max(0, Nx * lx + Ny * ly + Nz * lz);
        let val = 0.08 + 0.86 * dif * (0.62 + 0.38 * bulge);
        if (ny > 0.5) val -= (ny - 0.5) * 0.45;
        vals.set(key(x, y), { val, fr, ny, nx });
      }
    const TH = o.th || [0.24, 0.42, 0.6, 0.8];
    const tone = (val) => {
      let t = 0;
      while (t < TH.length && val > TH[t]) t++;
      return t;
    };
    for (const [k, p] of vals) {
      const [x, y] = k.split(',').map(Number);
      let t = tone(p.val);
      const eB = !vals.has(key(x, y + 1));
      const eS = !vals.has(key(x + 1, y)) || !vals.has(key(x - 1, y)) || !vals.has(key(x, y - 1));
      if ((eS && p.val < 0.42) || eB) t = Math.max(0, Math.min(t - 1, 1));
      B.set(x, y, RAMP[t]);
    }
    // rib grooves: 1px curved meridians, one tone darker
    for (let k = 1; k < lobes; k++) {
      const lon = (k / lobes - 0.5) * Math.PI;
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        const ny = (y - cy) / RY;
        if (ny < -0.8 || ny > 0.82) continue;
        const x = Math.round(cx + RX * Math.sin(lon) * Math.sqrt(Math.max(0, 1 - ny * ny)));
        const p = vals.get(key(x, y));
        if (!p) continue;
        if (!vals.has(key(x - 1, y)) || !vals.has(key(x + 1, y))) continue;
        B.set(x, y, RAMP[Math.max(0, tone(p.val) - 1)]);
      }
    }
    // one bright lobe highlight cluster on the lit side
    if (o.spec !== false) {
      let best = null;
      for (const [k, p] of vals) if (!best || p.val > best[1].val) best = [k, p];
      if (best && best[1].val > 0.74) {
        const [x, y] = best[0].split(',').map(Number);
        B.set(x, y, RAMP[Math.min(RAMP.length - 1, 5)]);
        if (vals.has(key(x, y + 1))) B.set(x, y + 1, RAMP[4]);
      }
    }
    return vals;
  }

  function stem(B, x, y, h, dir, curlIt) {
    // short curved stem: lit side vine[3], shade vine[1], cut top vine[4]
    for (let k = 0; k < h; k++) {
      const xx = x + Math.round((dir * (k * k)) / (h * 2.2));
      B.set(xx, y - k, P.vine[2]);
      B.set(xx - dir, y - k, k === h - 1 ? P.vine[2] : P.vine[3]);
    }
    const tx = x + Math.round((dir * ((h - 1) * (h - 1))) / (h * 2.2));
    B.set(tx + dir, y - h + 1, P.vine[1]);
    B.set(tx, y - h, P.vine[4]);
    B.set(tx - dir, y - h, P.vine[3]);
    if (curlIt) {
      B.set(tx + dir * 2, y - h + 1, P.vine[2]);
      B.set(tx + dir * 3, y - h, P.vine[2]);
      B.set(tx + dir * 3, y - h - 1, P.vine[1]);
    }
    // stem base sits in a dark dimple
    B.set(x - 1, y + 1, P.pumpkin[0]);
    B.set(x + 1, y + 1, P.pumpkin[0]);
  }

  function leaf(B, x, y, dir, big) {
    // a lobed pumpkin leaf: lit upper half, shaded lower half, dark veins
    const rows = big ? ['..aa.a.', '.aaaaab', 'aacaabb', '.abcbbb', '..bbb..'] : ['.aa.a', 'aacab', '.abbb', '..bb.'];
    for (const [cx, cy, ch] of cells(rows)) {
      const xx = dir > 0 ? x + cx : x - cx;
      B.set(xx, y + cy, ch === 'a' ? P.vine[3] : ch === 'b' ? P.vine[2] : P.vine[1]);
    }
    B.set(dir > 0 ? x + 3 : x - 3, y + 1, P.vine[4]);
  }

  /** soft contact shadow, offset away from the key light */
  function shadow(B, cx, y, rx, off) {
    const x0 = Math.round(cx - rx + off);
    const x1 = Math.round(cx + rx + off);
    for (let x = x0; x <= x1; x++) {
      const k = Math.abs(x - (cx + off)) / (rx + 0.5);
      if (k < 0.7 || HD.bayer(x, y) < 1.35 - k * 1.2) B.set(x, y, P.soil[1]);
      if (k < 0.5 && HD.bayer(x, y + 1) < 0.5) B.set(x, y + 1, P.soil[1]);
    }
  }

  function vineCurve(B, pts, col) {
    const c = annotate(spline(pts, 0.25));
    for (const p of cleanPath(c.map((q) => [q.x, q.y]))) if (!B.get(p[0], p[1])) B.set(p[0], p[1], col);
  }
  function curl(B, x, y, dir) {
    const rows = ['.xx.', 'x..x', 'x.x.', '.x..'];
    for (const [cx, cy] of cells(rows)) B.set(dir > 0 ? x + cx : x - cx, y + cy, P.vine[2]);
  }

  function bakePatch() {
    const pp = L.pumpkinPatch;
    const B = new Buf(0, pp.y0 - 12, pp.x1 + 14, pp.y1 - pp.y0 + 16);
    const fire = L.campfire;
    // soft dark soil mounds under the patch
    for (const [mx, my, mr] of [[13, 226, 8], [28, 233, 11], [43, 228, 7]])
      for (let y = my - 1; y <= my + 2; y++)
        for (let x = mx - mr; x <= mx + mr; x++) {
          const k = Math.abs(x - mx) / mr + Math.abs(y - my - 0.5) / 3;
          if (k < 1 && HD.bayer(x, y) < 1.2 - k) B.set(x, y, P.soil[3]);
        }
    // vines first (behind)
    vineCurve(B, [[6, 222], [10, 216], [17, 214], [24, 217], [31, 216], [37, 213], [44, 215]], P.vine[1]);
    vineCurve(B, [[27, 224], [33, 225], [38, 229], [45, 230], [51, 233]], P.vine[1]);
    curl(B, 46, 211, 1);
    curl(B, 3, 214, -1);
    leaf(B, 19, 210, -1, true);
    leaf(B, 31, 211, 1, false);
    leaf(B, 50, 226, 1, true);
    const GHOST = [P.stone[1], P.stone[3], P.bone[0], P.bone[1], P.bone[2], P.bone[3]];
    const pumpkins = [
      { x: 41, y: 221, rx: 4.6, ry: 3.8, lobes: 4, stemH: 2, dir: 1, ramp: GHOST },
      { x: 12, y: 220, rx: 5, ry: 6, lobes: 4, stemH: 3, dir: -1, curl: true },
      { x: 28, y: 230, rx: 9.6, ry: 5.6, lobes: 5, stemH: 3, dir: 1, curl: true },
      { x: 45, y: 234, rx: 5, ry: 2.8, lobes: 4, stemH: 2, dir: -1 },
      { x: 8, y: 234, rx: 3.6, ry: 2.8, lobes: 3, stemH: 1, dir: 1 },
    ];
    for (const p of pumpkins) {
      const dx = fire.x - p.x;
      const dy = fire.base - 14 - p.y;
      const dl = Math.hypot(dx, dy);
      shadow(B, p.x, Math.round(p.y + p.ry) + 1, p.rx * 0.95, -Math.sign(dx) * 1.5);
      pumpkinBody(B, p.x, p.y, p.rx, p.ry, { lobes: p.lobes, lx: dx / dl, ly: dy / dl - 0.3, lz: 0.55, ramp: p.ramp });
      stem(B, p.x, Math.round(p.y - p.ry) + 1, p.stemH, p.dir, p.curl);
    }
    // front vines and leaves over the pumpkins
    vineCurve(B, [[17, 237], [21, 234], [25, 236], [31, 236], [36, 234]], P.vine[2]);
    leaf(B, 37, 231, 1, false);
    curl(B, 15, 233, -1);
    leaf(B, 1, 226, 1, false);
    return B.bake();
  }

  // ------------------------------------------------------------------
  // JACK-O'-LANTERNS
  // ------------------------------------------------------------------
  const JACK_SIZE = {
    big: { rx: 9, ry: 6.6, lobes: 5, stemH: 3, light: 34, halo: 12 },
    medium: { rx: 7, ry: 5.4, lobes: 5, stemH: 3, light: 28, halo: 10 },
    small: { rx: 5, ry: 4, lobes: 4, stemH: 2, light: 22, halo: 8 },
  };
  // carved faces, 'X' = cut; dy = first row relative to the body centre
  const FACES = [
    {
      // classic: triangle eyes, nose, jagged grin
      dy: -4,
      rows: [
        '..X.......X..',
        '.XXX.....XXX.',
        'XXXXX...XXXXX',
        '......X......',
        '.....XXX.....',
        'X...........X',
        'XXX.XXXXX.XXX',
        '.XXXXX.XXXXX.',
        '...XX...XX...',
      ],
    },
    {
      // surprised
      dy: -2,
      rows: ['XX...XX', 'XX...XX', '.......', '..XXX..', '..XXX..'],
    },
    {
      // sleepy, with a little yawn
      dy: -3,
      rows: ['XXXX...XXXX', '.XX.....XX.', '...........', '....XXX....', '...XXXXX...', '....XXX....'],
    },
    {
      // toothy grin
      dy: -2,
      rows: ['.XX...XX.', '.XX...XX.', '.........', 'XXXXXXXXX', '.XX.X.XX.'],
    },
    {
      // winking
      dy: -2,
      rows: ['.X.......', 'XXX...XXX', '.........', 'X.......X', '.XXXXXXX.'],
    },
  ];
  // flicker levels: [top wall (dark lip), run ends, core]
  const JLV = [
    [P.fire[4], P.fire[7], P.fire[8]],
    [P.fire[5], P.fire[7], P.fire[9]],
    [P.fire[5], P.fire[8], P.fire[9]],
    [P.fire[6], P.fire[8], P.amber[7]],
  ];
  // jack bodies are painted a step darker than the patch so the carving carries the glow
  const JACK_RAMP = [P.wood[0], P.wood[1], P.pumpkin[0], P.pumpkin[1], P.pumpkin[2], P.pumpkin[3]];

  function bakeJacks() {
    const fire = L.campfire;
    return L.jackolanterns.map((j, i) => {
      const S = JACK_SIZE[j.size];
      const cx = j.x;
      const cy = Math.round(j.base - S.ry - 0.6);
      const B = new Buf(cx - 14, cy - 14, 28, 26);
      // key light for the body: the campfire for yard jacks, the porch lantern for porch jacks
      let lx;
      let ly;
      if (j.base <= L.ground.houseBase + 1) {
        lx = L.house.lantern.hookX - cx;
        ly = -14;
        const dl = Math.hypot(lx, ly);
        lx /= dl;
        ly /= dl;
      } else {
        const dx = fire.x - cx;
        const dy = fire.base - 14 - cy;
        const dl = Math.hypot(dx, dy);
        lx = dx / dl;
        ly = dy / dl - 0.25;
      }
      shadow(B, cx, Math.round(cy + S.ry) + 1, S.rx * 0.95, -Math.sign(lx) * 1.5);
      const vals = pumpkinBody(B, cx, cy, S.rx, S.ry, { lobes: S.lobes, lx, ly, lz: 0.5, ramp: JACK_RAMP });
      const sdir = i % 2 ? -1 : 1;
      stem(B, cx, Math.round(cy - S.ry) + 1, S.stemH, sdir, j.size !== 'small');
      // carved lid seam around the stem (zig-zag) on the bigger ones
      if (j.size !== 'small') {
        const lw = Math.round(S.rx * 0.45);
        for (let dx = -lw; dx <= lw; dx++) {
          const y = Math.round(cy - S.ry * 0.62) + (dx % 2 === 0 ? 0 : 1) - (Math.abs(dx) === lw ? 1 : 0);
          if (vals.has(cx + dx + ',' + y)) B.set(cx + dx, y, P.pumpkin[0]);
        }
      }
      const body = B.bake();
      // face (emissive) in 4 flicker levels
      const F = FACES[i % FACES.length];
      const fw = F.rows[0].length;
      const fx0 = cx - (fw >> 1);
      const fy0 = cy + F.dy;
      const cut = new Set(cells(F.rows).map(([x, y]) => x + fx0 + ',' + (y + fy0)));
      const isCut = (x, y) => cut.has(x + ',' + y);
      const faces = JLV.map((lv) => {
        const Bf = new Buf(cx - 14, cy - 14, 28, 26);
        for (const k of cut) {
          const [x, y] = k.split(',').map(Number);
          if (!vals.has(k)) continue;
          let c = lv[2];
          const top = !isCut(x, y - 1);
          const deep = isCut(x, y + 1);
          // horizontal run containing this pixel
          let a = x;
          let b = x;
          while (isCut(a - 1, y)) a--;
          while (isCut(b + 1, y)) b++;
          if (top && deep) c = lv[0];
          else if (b - a >= 3 && (x === a || x === b)) c = lv[1];
          Bf.set(x, y, c);
        }
        return Bf.bake();
      });
      return { body, faces, cx, cy, S, base: j.base, seed: 40 + i * 7, faceY: cy + F.dy + (F.rows.length >> 1) };
    });
  }

  function jackLevel(t, seed) {
    const f = T.flicker(T.step(t, 12), seed, 1.15);
    return Math.max(0, Math.min(3, Math.round((f - 0.5) * 7 + 1.6)));
  }

  // ------------------------------------------------------------------
  // CAMPFIRE ring + logs (mid-tones: the fire's light relights them)
  // ------------------------------------------------------------------
  function stoneBlob(B, cx, cy, rx, ry, lx, ly, seed, front) {
    const r = HD.rng(seed);
    const sq = 2.0 + r() * 1.3;
    const skew = (r() - 0.5) * 0.5; // slanted top
    const bulge = r() * 0.4; // fuller on one side
    const vals = new Map();
    const key = (x, y) => x + ',' + y;
    for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++)
      for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
        const nx = (x - cx) / (rx + 0.3);
        let ny = (y - cy) / (ry + 0.3) + skew * nx;
        if (ny < 0) ny *= 1 + bulge * nx;
        if (ny > 0.75) ny = 0.75 + (ny - 0.75) * 1.6; // flat-ish bottom sitting in the dirt
        if (Math.pow(Math.abs(nx), sq) + Math.pow(Math.abs(ny), sq) > 1) continue;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) + 0.25;
        const d = (nx * lx + ny * ly + nz * 0.45) / Math.hypot(nx, ny, nz) / Math.hypot(lx, ly, 0.45);
        vals.set(key(x, y), d);
      }
    for (const [k, d] of vals) {
      const [x, y] = k.split(',').map(Number);
      const top = !vals.has(key(x, y - 1));
      const bot = !vals.has(key(x, y + 1));
      const side = !vals.has(key(x - 1, y)) || !vals.has(key(x + 1, y));
      let c = d > 0.72 ? P.stone[4] : d > 0.45 ? P.stone[3] : d > 0.15 ? P.stone[2] : P.stone[1];
      if (top && d > 0.25) c = front ? P.stone[4] : P.stone[3];
      if (bot || (side && d < 0.3)) c = P.stone[0];
      B.set(x, y, c);
    }
    // a pit / crack
    const ks = [...vals.keys()].filter((k) => {
      const [x, y] = k.split(',').map(Number);
      return vals.has(key(x - 1, y)) && vals.has(key(x + 1, y)) && vals.has(key(x, y - 1)) && vals.has(key(x, y + 1));
    });
    if (ks.length) {
      const [px, py] = ks[Math.floor(r() * ks.length)].split(',').map(Number);
      B.set(px, py, P.stone[1]);
    }
  }

  function logShape(B, x0, y0, x1, y1, w, o) {
    // a log as a thick line; o.end 'a'|'b' shows end grain; o.char 'a'|'b' charred end
    const len = Math.hypot(x1 - x0, y1 - y0);
    const tx = (x1 - x0) / len;
    const ty = (y1 - y0) / len;
    let nx = -ty;
    let ny = tx;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const r = w / 2;
    const minx = Math.floor(Math.min(x0, x1) - r - 2);
    const maxx = Math.ceil(Math.max(x0, x1) + r + 2);
    const miny = Math.floor(Math.min(y0, y1) - r - 2);
    const maxy = Math.ceil(Math.max(y0, y1) + r + 2);
    for (let y = miny; y <= maxy; y++)
      for (let x = minx; x <= maxx; x++) {
        const px = x - x0;
        const py = y - y0;
        const s = px * tx + py * ty;
        const v = px * nx + py * ny;
        if (s < 0 || s > len || Math.abs(v) > r) continue;
        const vv = v / r; // +1 = upper edge
        let c = vv > 0.5 ? P.wood[5] : vv > -0.1 ? P.wood[4] : vv > -0.6 ? P.wood[3] : P.wood[2];
        // bark plates: short dark grooves along the length
        const gr = Math.sin(s * 0.7 + Math.round(vv * 2) * 2.3 + (o.seed || 0)) > 0.55 && Math.abs(vv) < 0.75;
        if (gr) c = vv > 0 ? P.wood[3] : P.wood[2];
        if (vv < -0.75) c = P.wood[1];
        // charring towards the fire end
        const ch = o.char === 'a' ? 1 - s / len : o.char === 'b' ? s / len : 0;
        if (ch > 0.6) c = ch > 0.78 ? P.wood[0] : vv > 0.3 ? P.wood[2] : P.wood[1];
        B.set(x, y, c);
      }
    if (o.end) {
      // end grain: bark ring, pale sapwood, one dark growth ring, pale heart, dark pith
      const ex = o.end === 'a' ? x0 : x1;
      const ey = o.end === 'a' ? y0 : y1;
      const er = r + 0.4;
      const ew = er * 0.72;
      for (let y = Math.floor(ey - er - 1); y <= Math.ceil(ey + er + 1); y++)
        for (let x = Math.floor(ex - ew - 1); x <= Math.ceil(ex + ew + 1); x++) {
          const dx = (x - ex) / ew;
          const dy = (y - ey) / er;
          const d = Math.hypot(dx, dy);
          if (d > 1) continue;
          let c = d > 0.8 ? P.wood[2] : d > 0.58 ? P.wood[7] : d > 0.36 ? P.wood[4] : d > 0.15 ? P.wood[6] : P.wood[3];
          if (d > 0.8 && dy < -0.2 && dx > -0.3) c = P.wood[4];
          B.set(x, y, c);
        }
    }
  }

  function bakeCampfire() {
    const c = L.campfire;
    const cx = c.x;
    const cy = c.base - 1;
    const back = new Buf(cx - 30, cy - 30, 60, 40);
    const front = new Buf(cx - 30, cy - 12, 60, 24);
    const rxR = 17;
    const ryR = 5.2;
    const N = 12;
    const stones = [];
    const r = HD.rng(915);
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 + 0.15 + (r() - 0.5) * 0.22;
      stones.push({
        x: cx + Math.cos(a) * rxR,
        y: cy + Math.sin(a) * ryR,
        rx: 3.0 + r() * 1.4,
        ry: 2.0 + r() * 0.9,
        a,
        seed: 200 + k * 3,
      });
    }
    stones.sort((p, q) => p.y - q.y);
    for (const s of stones) {
      if (Math.sin(s.a) > 0.15) continue;
      // far stones: their front faces look into the fire
      stoneBlob(back, s.x, s.y, s.rx, s.ry, (cx - s.x) * 0.04, 0.5, s.seed, false);
    }
    // crossed logs in a low teepee; outer ends show end grain, inner ends charred
    logShape(back, cx - 4, cy - 3, cx + 2, cy - 19, 3.4, { char: 'b', seed: 3 });
    logShape(back, cx + 16, cy - 1, cx - 5, cy - 14, 4.6, { end: 'a', char: 'b', seed: 2 });
    logShape(back, cx - 15, cy - 2, cx + 6, cy - 14, 5.0, { end: 'a', char: 'b', seed: 1 });
    for (const s of stones) {
      if (Math.sin(s.a) <= 0.15) continue;
      stoneBlob(front, s.x, s.y, s.rx, s.ry, (cx - s.x) * 0.05, -0.9, s.seed, true);
    }
    return { back: back.bake(), front: front.bake() };
  }

  // ------------------------------------------------------------------
  // module
  // ------------------------------------------------------------------
  let ART = null;
  const blit = (g, s) => g.sprite(s.cv, s.x, s.y);

  function swayState(t, gi) {
    const n = T.noise(t, 6.5, 300 + gi * 17);
    const v = (n - 0.5) * 3.2 + 0.25;
    return v > 0.55 ? 2 : v < -0.75 ? 0 : 1;
  }

  // crow perches (screen pos of feet) and facing
  const CROWS = [
    { tx: 382, ty: 156, flip: true, seed: 11, near: 0 },
    { tx: 449, ty: 50, flip: true, seed: 23, near: 1 },
  ];

  function crowPose(t, seed) {
    const ts = T.step(t, 10);
    let frame = 'idle';
    // head turns: slow noise, looks back over its shoulder now and then
    if (T.noise(ts, 17, seed) > 0.64) frame = 'look';
    // preening: two quick dips of the head, every ~33 s
    const pc = T.cycle(ts, 0, 33, seed + 1);
    const pt = pc.age * pc.P;
    if (pt > 12 && pt < 13.6) frame = (pt - 12) % 0.8 < 0.5 ? 'preen' : 'idle';
    // wing ruffle: rare, every ~41 s
    const rc = T.cycle(ts, 1, 41, seed + 2);
    const rt = rc.age * rc.P;
    if (rt > 20 && rt < 20.6) frame = 'ruffle';
    // shuffle: sidesteps one pixel and back, every ~47 s
    const sc = T.cycle(ts, 2, 47, seed + 3);
    const st = sc.age * sc.P;
    const dx = st > 8 && st < 30 ? 1 : 0;
    const dy = Math.abs(st - 8) < 0.1 || Math.abs(st - 30) < 0.1 ? -1 : 0;
    return { frame, dx, dy };
  }

  HD._propsDebug = { crowPose, CROWS, swayState, TREE };
  HD.module('props', {
    init() {
      buildTree();
      ART = {
        tree: TREE.body,
        groups: TREE.groups,
        crows: bakeCrows(),
        fence: bakeFence(),
        tombs: L.tombstones.map((s, i) => bakeTombstone(s, i)),
        patch: bakePatch(),
        jacks: bakeJacks(),
        fire: bakeCampfire(),
      };
      // perches: flat branch tops near the wanted spots
      for (const c of CROWS) {
        const p = findPerch(c.tx, c.ty, 8) || { x: c.tx, y: c.ty };
        c.x = p.x;
        c.y = p.y;
      }
    },
    lights(t, Lt) {
      if (!ART) return;
      for (const j of ART.jacks) {
        const lv = jackLevel(t, j.seed);
        Lt.add({
          x: j.cx,
          y: j.base + 2,
          r: j.S.light,
          ry: Math.round(j.S.light * 0.42),
          color: HD.LIGHT.pumpkin,
          i: 0.5 + lv * 0.1,
          bands: 4,
          halo: { x: j.cx, y: j.faceY, r: j.S.halo, a: 0.1 + lv * 0.02 },
        });
      }
    },
    passes: [
      {
        layer: 'scene',
        z: 12,
        id: 'tree',
        draw(g, t) {
          blit(g, ART.tree);
          for (let gi = 0; gi < ART.groups.length; gi++) blit(g, ART.groups[gi][swayState(t, gi)]);
        },
      },
      {
        layer: 'scene',
        z: 13,
        id: 'crows',
        draw(g, t) {
          for (const c of CROWS) {
            const p = crowPose(t, c.seed);
            const spr = ART.crows[p.frame + c.near];
            const x = c.x - (c.flip ? spr.width - 1 - 7 : 7) + (c.flip ? -p.dx : p.dx);
            g.sprite(spr, x, c.y - spr.height + 1 + p.dy, c.flip);
          }
        },
      },
      {
        layer: 'scene',
        z: 14,
        id: 'fence',
        draw(g) {
          blit(g, ART.fence);
        },
      },
      {
        layer: 'scene',
        z: 16,
        id: 'tombstones',
        draw(g) {
          for (const s of ART.tombs) blit(g, s);
        },
      },
      {
        layer: 'scene',
        z: 32,
        id: 'patch',
        draw(g) {
          blit(g, ART.patch);
        },
      },
      {
        layer: 'scene',
        z: 38,
        id: 'campfire-back',
        draw(g) {
          blit(g, ART.fire.back);
        },
      },
      {
        layer: 'scene',
        z: 46,
        id: 'campfire-front',
        draw(g) {
          blit(g, ART.fire.front);
        },
      },
      {
        layer: 'scene',
        z: 47,
        id: 'jacks',
        draw(g, t) {
          for (const j of ART.jacks) {
            blit(g, j.body);
            const f = j.faces[jackLevel(t, j.seed)];
            g.em.sprite(f.cv, f.x, f.y);
          }
        },
      },
    ],
  });
})();
