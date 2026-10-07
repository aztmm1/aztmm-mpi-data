/*
 * props — seasonal editions (Rainy Hollow series). Owned by the props module.
 *
 * props.js keeps the Halloween yard byte-for-byte and calls these hooks for
 * every other edition (HD._propsSeasons.*). Everything static is baked once
 * per edition with HD.perEdition and blitted; HD.edition is read at draw time.
 *
 *   tree         z12   bark re-shaded per moon, snow caps, foliage (blossom, autumn,
 *                      summer) shaded as one mass: limb clumps are static, the clumps at
 *                      the twig ends are baked in 3 sway states per twig group and ride
 *                      on their twig (same K.swayState); plum blossoms
 *   treeDress    z13.5 red lanterns on limb hooks, wound fairy lights
 *   garden       z14   picket fence, birdhouse on a sturdy post (+ robin, fence diyas)
 *   gardenFront  z16   hammock, sled, scarecrow, hay bales, front shrubs, snowman,
 *                      bench, frog on its stone (painted back to front)
 *   string       z30   paper / harvest lantern string from the house hook to a branch
 *   yardBack     z32   flower beds, eggs + basket
 *   yardMid      z36   harvest pumpkins and gourds, path diyas
 *   bonfire*     z38/46 the bigger log pile for the midsummer bonfire
 */
(function () {
  'use strict';
  const HD = window.HD;
  const P = HD.PAL;
  const L = HD.layout;
  const T = HD.time;
  const FX = HD.festive;
  const MOON = L.moon;
  const SL = L.seasonal;
  const mix = HD.color.mix;
  const R = Math.round;
  let K = null;
  const S = (HD._propsSeasons = {});
  const blit = (g, s) => g.sprite(s.cv, s.x, s.y);
  const isSnow = (ed) => ed.ground === 'snow' || ed.ground === 'thin-snow';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function moonOf(ed) {
    if (ed.moon === 'none') return null;
    return { x: MOON.x, y: MOON.y, r: ed.moon === 'harvest' ? 22 : MOON.r, kind: ed.moon };
  }
  const inDisc = (m, x, y, pad) => m && Math.hypot(x - m.x, y - m.y) < m.r + (pad || 0);

  // ------------------------------------------------------------------
  // TREE: bark shading per moon
  // ------------------------------------------------------------------
  const BODY = [P.violet[1], P.wood[2], P.wood[3], P.violet[3], P.violet[4]];
  const HARVEST_RIM = [mix(P.gold[3], P.moon[0], 0.45), mix(P.gold[2], P.night[8], 0.5)];

  function rimFor(m, x, y, dm) {
    const th = HD.bayer(x, y);
    if (!m) return y < 120 ? (th < 0.5 ? P.night[7] : P.night[6]) : P.night[6];
    if (m.kind === 'harvest') {
      if (dm < m.r + 14) return HARVEST_RIM[0];
      if (dm < m.r + 24) return th < 0.5 ? HARVEST_RIM[0] : HARVEST_RIM[1];
      if (dm < 74) return HARVEST_RIM[1];
      return K.rimColour(x, y, dm);
    }
    if (m.kind === 'crescent') return K.rimColour(x, y, dm + 16);
    return K.rimColour(x, y, dm);
  }

  function barkColour(m, x, y, q) {
    const F = K.TREE.F;
    const has = K.TREE.has;
    const w = F.w[q];
    const v = F.v[q];
    const nx = F.nx[q];
    const ny = F.ny[q];
    const s = F.s[q];
    const id = F.id[q];
    const dm = m ? Math.hypot(x - m.x, y - m.y) : 999;
    if (m && dm < m.r + 1) return P.violet[0];
    if (w < 1.45) return twigCol(m, x, y);
    const mdx = MOON.x - x;
    const mdy = MOON.y - y;
    const md = Math.hypot(mdx, mdy) || 1;
    let lx = (mdx / md) * 0.55 + 0.6 * 0.45;
    let ly = (mdy / md) * 0.55 - 0.8 * 0.45;
    const ll = Math.hypot(lx, ly);
    lx /= ll;
    ly /= ll;
    const open = (xx, yy) => !has(xx, yy);
    const rim = (lx > 0.3 && open(x + 1, y)) || (lx < -0.3 && open(x - 1, y)) || (ly < -0.3 && open(x, y - 1)) || (ly > 0.3 && open(x, y + 1));
    if (rim) {
      if (m && dm < m.r + 4) return P.violet[1];
      return rimFor(m, x, y, dm);
    }
    const inner = w >= 5 && ((lx > 0.3 && open(x + 2, y)) || (ly < -0.3 && open(x, y - 2)));
    if (inner && (!m || dm > m.r + 6)) return P.violet[4];
    const lit = v * (nx * lx + ny * ly);
    let tone = lit > 0.5 ? 3 : lit > 0.0 ? 2 : lit > -0.5 ? 1 : 0;
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
    if (m && dm < m.r + 8) tone = Math.min(tone, 1);
    return BODY[tone];
  }
  function twigCol(m, x, y) {
    if (!m) return P.violet[3];
    const dm = Math.hypot(x - m.x, y - m.y);
    if (dm < m.r + 1) return P.violet[0];
    if (dm < m.r + 12) return P.violet[1];
    return P.violet[3];
  }

  function shadeBark(B, m) {
    const TR = K.TREE;
    const F = TR.F;
    for (let q = 0; q < K.TW * K.TH; q++) {
      if (!F.occ[q]) continue;
      const x = K.TX0 + (q % K.TW);
      const y = K.TY0 + Math.floor(q / K.TW);
      B.set(x, y, barkColour(m, x, y, q));
    }
    // the hollow in the trunk (as in the Halloween tree)
    const hx = L.tree.x - 2;
    const hy = L.tree.base - 34;
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const e = (dx * dx) / 6.5 + (dy * dy) / 20;
        if (e > 1) continue;
        B.set(hx + dx, hy + dy, e < 0.5 ? P.night[0] : P.violet[0]);
      }
    for (const [dx, dy] of [[2, 3], [2, 4], [1, 5], [3, 2], [3, 1], [3, 0], [0, 5]]) B.set(hx + dx, hy + dy, P.wood[4]);
    for (const [dx, dy] of [[-3, 1], [-3, 0], [-3, -1], [-2, 3]]) B.set(hx + dx, hy + dy, P.violet[0]);
    for (const [dx, dy] of [[-1, -5], [0, -6], [1, -5]]) B.set(hx + dx, hy + dy, P.violet[1]);
  }

  // snow resting on the tops of the branches: deeper on flat limbs, eroded at the ends
  function snowCaps(B, m, heavy) {
    const TR = K.TREE;
    const F = TR.F;
    const has = TR.has;
    const dep = new Map();
    const key = (x, y) => x * 1000 + y;
    for (let q = 0; q < K.TW * K.TH; q++) {
      if (!F.occ[q]) continue;
      const x = K.TX0 + (q % K.TW);
      const y = K.TY0 + Math.floor(q / K.TW);
      if (has(x, y - 1) || y > L.tree.base - 5) continue;
      const w = F.w[q];
      if (w < 1.45) continue;
      const h = Math.abs(F.ny[q]);
      if (h < (heavy ? 0.45 : 0.6)) continue;
      // light dusting comes in patches along a branch (not per pixel)
      if (!heavy && HD.hash(F.id[q], Math.floor(F.s[q] / 7), 31) < 0.35) continue;
      let d = 1;
      if (heavy && h > 0.72 && w >= 3) d = 2;
      if (heavy && h > 0.86 && w >= 6.5) d = 3;
      dep.set(key(x, y), d);
    }
    const nb = (x, y) => Math.max(dep.get(key(x, y)) || 0, dep.get(key(x, y - 1)) || 0, dep.get(key(x, y + 1)) || 0);
    for (const [k, d0] of dep) {
      const x = Math.floor(k / 1000);
      const y = k % 1000;
      const d = Math.min(d0, nb(x - 1, y) + 1, nb(x + 1, y) + 1);
      const lit = x > L.tree.x - 30;
      for (let j = 1; j <= d; j++) {
        const yy = y - j;
        if (has(x, yy)) break;
        let c = j === d ? (lit ? P.snow[8] : P.snow[7]) : j === 1 && d > 1 ? P.snow[5] : P.snow[6];
        if (d === 1) c = lit ? P.snow[7] : P.snow[6];
        if (inDisc(m, x, yy, 0.5)) c = P.snow[2];
        B.set(x, yy, c);
      }
      // the bark right under a cap catches the snow's bounce
    }
  }

  // ------------------------------------------------------------------
  // TREE: foliage clumps (each clump = overlapping sub-spheres lit from the
  // upper right; upper spheres overlap lower ones, so every sphere leaves a
  // dark crescent on the one below -> the classic clumpy leaf mass)
  // ------------------------------------------------------------------
  const LX = 0.6;
  const LY = -0.8;
  const LN = Math.hypot(0.55, -0.62, 0.56);
  const L3 = [0.55 / LN, -0.62 / LN, 0.56 / LN];
  /** a clump = a few overlapping spheres; the upper ones sit in front */
  function makeClump(rnd, x, y, r, subR, z) {
    const subs = [];
    const n = Math.max(2, Math.round(((r * r) / (subR * subR)) * 1.1));
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * Math.max(0, r - subR * 0.8);
      subs.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.8, r: subR * (0.85 + rnd() * 0.35) });
    }
    subs.push({ x: x + 0.25 * r * LX, y: y + 0.25 * r * LY, r: subR * 1.2 });
    for (const sb of subs) sb.z = (z || 0) - (sb.y - y) * 0.35;
    return { x, y, r, subs };
  }
  /**
   * Shade a union of clumps as ONE leaf mass, painter style:
   *  - macro form: the whole silhouette is blurred into a soft volume whose
   *    gradient gives a big rounded normal (so the crown reads as masses, not bubbles)
   *  - micro form: each sub-sphere adds a weaker bump on top
   *  - creases: a sphere sitting under a higher neighbour (towards the light)
   *    falls into its shadow -> crisp dark crescents that define the clumps
   *  - leaf texture: a brick of fish-scale tiles nudges both the tone and the
   *    silhouette, so band edges and outlines become scalloped leaf clusters
   *    (clustered, never per-pixel speckle)
   *  - cold rim light on edges that face the moon
   *  o.bias brightens, o.sil colour inside the moon, o.rim rim colour, o.scale leaf tile size
   */
  function leafBump(x, y, sc) {
    const tw = 6 * sc;
    const th = 4 * sc;
    const ty = Math.floor(y / th);
    const xs = x + (ty & 1) * (tw >> 1) + (HD.hash(ty, 3, 41) < 0.5 ? 1 : 0);
    const tx = Math.floor(xs / tw);
    const u = (xs - tx * tw + 0.5) / tw - 0.5;
    const v = (y - ty * th + 0.5) / th;
    return 1 - 3.2 * u * u - 0.9 * v + (HD.hash(tx, ty, 23) - 0.5) * 0.5;
  }
  function canopy(B, clumps, m, o) {
    o = o || {};
    const sc = o.scale || 1;
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    const subs = [];
    clumps.forEach((c, ci) => {
      for (const sb of c.subs) {
        subs.push({ x: sb.x + (o.dx || 0), y: sb.y, r: sb.r, z: sb.z, ci });
        x0 = Math.min(x0, Math.floor(sb.x - sb.r - 3));
        y0 = Math.min(y0, Math.floor(sb.y - sb.r - 3));
        x1 = Math.max(x1, Math.ceil(sb.x + sb.r + 3));
        y1 = Math.max(y1, Math.ceil(sb.y + sb.r + 3));
      }
    });
    if (!subs.length) return;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const H = new Float32Array(w * h).fill(-1e9);
    const win = new Int32Array(w * h).fill(-1);
    const LB = new Float32Array(w * h);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) LB[(y - y0) * w + (x - x0)] = leafBump(x, y, sc);
    subs.forEach((sb, si) => {
      const R2 = sb.r + 1.2;
      for (let y = Math.floor(sb.y - R2); y <= Math.ceil(sb.y + R2); y++)
        for (let x = Math.floor(sb.x - R2); x <= Math.ceil(sb.x + R2); x++) {
          const q = (y - y0) * w + (x - x0);
          const re = sb.r + (LB[q] - 0.35) * 1.3;
          const d2 = (x - sb.x) * (x - sb.x) + (y - sb.y) * (y - sb.y);
          if (d2 > re * re + re * 0.4) continue;
          const hh = sb.z + Math.sqrt(Math.max(0, sb.r * sb.r - d2));
          if (hh > H[q]) {
            H[q] = hh;
            win[q] = si;
          }
        }
    });
    // drop lone pixels / 1px spurs so the outline stays clean
    const inRaw = (x, y) => x >= x0 && y >= y0 && x <= x1 && y <= y1 && win[(y - y0) * w + (x - x0)] >= 0;
    const kill = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!inRaw(x, y)) continue;
        const n = inRaw(x + 1, y) + inRaw(x - 1, y) + inRaw(x, y + 1) + inRaw(x, y - 1);
        if (n <= 1) kill.push((y - y0) * w + (x - x0));
      }
    for (const q of kill) win[q] = -1;
    const inM = inRaw;
    // macro volume: blurred coverage (two box passes, radius rb)
    const rb = o.blur || 5;
    let A = new Float32Array(w * h);
    for (let q = 0; q < w * h; q++) A[q] = win[q] >= 0 ? 1 : 0;
    const box = (src, horiz) => {
      const dst = new Float32Array(w * h);
      const n = horiz ? w : h;
      const m2 = horiz ? h : w;
      for (let j = 0; j < m2; j++) {
        let acc = 0;
        const at = (i) => (horiz ? src[j * w + i] : src[i * w + j]);
        for (let i = -rb; i <= rb; i++) if (i >= 0 && i < n) acc += at(i);
        for (let i = 0; i < n; i++) {
          if (horiz) dst[j * w + i] = acc / (2 * rb + 1);
          else dst[i * w + j] = acc / (2 * rb + 1);
          const a = i - rb;
          const b = i + rb + 1;
          if (a >= 0) acc -= at(a);
          if (b < n) acc += at(b);
        }
      }
      return dst;
    };
    A = box(box(box(box(A, true), false), true), false);
    const Aat = (x, y) => (x < x0 || y < y0 || x > x1 || y > y1 ? 0 : A[(y - y0) * w + (x - x0)]);
    const bias = o.bias || 0;
    const LxN = L3[0];
    const LyN = L3[1];
    const LzN = L3[2];
    const rimC = o.rim || null;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const q = (y - y0) * w + (x - x0);
        const si = win[q];
        if (si < 0) continue;
        const sb = subs[si];
        const c = clumps[sb.ci];
        const ramp = c.ramp;
        const top = ramp.length - 1;
        // macro normal from the blurred silhouette
        const gx = (Aat(x + 1, y) - Aat(x - 1, y)) * 0.5;
        const gy = (Aat(x, y + 1) - Aat(x, y - 1)) * 0.5;
        let Mx = -gx * 7;
        let My = -gy * 7;
        let Mz = 0.35 + Aat(x, y) * 0.65;
        let ml = Math.hypot(Mx, My, Mz) || 1;
        Mx /= ml;
        My /= ml;
        Mz /= ml;
        // micro normal from the sub-sphere
        let nx = (x - sb.x) / sb.r;
        let ny = (y - sb.y) / sb.r;
        const n2 = nx * nx + ny * ny;
        if (n2 > 1) {
          const k = 1 / Math.sqrt(n2);
          nx *= k;
          ny *= k;
        }
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const difM = Math.max(0, Mx * LxN + My * LyN + Mz * LzN);
        const difm = Math.max(0, nx * LxN + ny * LyN + nz * LzN);
        let v = 0.06 + 0.62 * difM + 0.34 * difm + bias + (LB[q] - 0.3) * 0.16;
        // the crown is darker low down and inside
        const low = clamp((y - c.y) / Math.max(3, c.r), -1, 1);
        v -= 0.1 * Math.max(0, low);
        // crease: a higher sphere towards the light casts a crescent
        let crease = false;
        for (const [ox, oy] of [[1, -1], [2, -2], [1, -2]]) {
          const xx = x + ox;
          const yy = y + oy;
          if (!inM(xx, yy)) continue;
          const q2 = (yy - y0) * w + (xx - x0);
          if (win[q2] !== si && H[q2] > H[q] + 1.6) {
            v -= 0.22;
            crease = true;
            break;
          }
        }
        let i = clamp(Math.floor(v * top + 0.5), 0, top);
        if (!inM(x, y + 1) && i > 1) i = Math.max(1, i - 2); // shaded underside lip
        let col = ramp[i];
        if (crease && o.crease && i <= 2) col = o.crease;
        // cold rim on the moon-facing outline
        if (m && rimC) {
          const dx = m.x - x;
          const dy = m.y - y;
          const dm = Math.hypot(dx, dy);
          if (dm < m.r + 18 && dm > m.r + 0.5 && i >= 2) {
            const sx = Math.round(dx / dm);
            const sy = Math.round(dy / dm);
            // only where the outline looks straight at the moon, in short broken runs
            if (!inM(x + sx, y + sy) && !inM(x + 2 * sx, y + 2 * sy) && (sx || sy) && HD.hash(x >> 2, y >> 2, 57) < 0.7) col = rimC;
          }
        }
        if (m && Math.hypot(x - m.x, y - m.y) < m.r + 0.5) col = o.sil || ramp[0];
        B.set(x, y, col);
        // which clump owns this pixel (lets the caller split the mass into sway layers)
        if (o.who) {
          const k = B.i(x, y);
          if (k >= 0) o.who[k] = sb.ci;
        }
      }
  }
  /** older per-clump painter, still used for small bushes */
  function paintClump(B, c, ramp, dx, m, o) {
    c.ramp = ramp;
    canopy(B, [c], m, { ...(o || {}), dx });
  }
  /** field anchors: one branch pixel per grid cell with width in [w0, w1] */
  function anchors(step, w0, w1, seed) {
    const TR = K.TREE;
    const F = TR.F;
    const cellsMap = new Map();
    for (let q = 0; q < K.TW * K.TH; q++) {
      if (!F.occ[q]) continue;
      const w = F.w[q];
      if (w < w0 || w > w1) continue;
      const x = K.TX0 + (q % K.TW);
      const y = K.TY0 + Math.floor(q / K.TW);
      if (y > L.tree.base - 60) continue;
      const ox = R(HD.hash(seed, 1) * step);
      const oy = R(HD.hash(seed, 2) * step);
      const cx = Math.floor((x + ox) / step);
      const cy = Math.floor((y + oy) / step);
      const k = cx * 1000 + cy;
      const mx = (cx + 0.5) * step - ox;
      const my = (cy + 0.5) * step - oy;
      const d = Math.hypot(x - mx, y - my);
      const cur = cellsMap.get(k);
      if (!cur || d < cur.d) cellsMap.set(k, { x, y, d });
    }
    return [...cellsMap.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  }
  const tipEnd = (tp) => {
    const n = tp.pts.length;
    const e = tp.pts[n - 1];
    const b = tp.pts[Math.max(0, n - 3)];
    return { x: e[0] * 0.75 + b[0] * 0.25, y: e[1] * 0.75 + b[1] * 0.25, ex: e[0], ey: e[1] };
  };

  // foliage styles
  function ramps() {
    return {
      summer: [[P.leaf[0], P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4], P.leaf[5], mix(P.leaf[6], P.moon[0], 0.25)]],
      summerDeep: [[P.leaf[0], P.leaf[0], P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4], P.leaf[5]]],
      // night cherry: held a step or two below the cottage's warm light; blossom[5]
      // only on the most lit petals, blossom[6] is kept for the moon rim
      blossom: [
        [P.violet[1], P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3], mix(P.blossom[3], P.blossom[4], 0.5), P.blossom[4]],
        [P.violet[1], P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3], P.blossom[4], mix(P.blossom[4], P.blossom[5], 0.5)],
      ],
      autumn: [
        // orange
        [P.autumn[0], P.autumn[1], P.autumn[2], P.autumn[3], P.autumn[4], P.autumn[5]],
        // crimson
        [P.plum[0], P.plum[0], P.plum[1], mix(P.plum[2], P.autumn[2], 0.5), P.plum[2], mix(P.plum[3], P.autumn[4], 0.5)],
        // gold
        [P.autumn[0], P.autumn[1], P.autumn[3], P.autumn[4], mix(P.autumn[5], P.gold[3], 0.5), mix(P.autumn[6], P.gold[4], 0.4)],
      ],
    };
  }

  function buildTreeArt(ed) {
    const TR = K.TREE;
    const m = moonOf(ed);
    const style = ed.tree;
    const RP = ramps();
    const rnd = HD.rng(1000 + ed.id.length * 31 + style.length);
    const bark = new K.Buf(K.TX0 - 6, K.TY0, K.TW + 12, K.TH + 2);
    shadeBark(bark, m);
    if (style === 'snowy') snowCaps(bark, m, true);
    if (style === 'plum') snowCaps(bark, m, false);
    let cfg = null;
    if (style === 'summer') cfg = { tipP: 1, tipR: [7, 9.5], sub: 4.4, step: 8, iw: [1.45, 6], iR: [7.5, 10.5], pad: 3 };
    if (style === 'blossom') cfg = { tipP: 1, tipR: [5.5, 8], sub: 3.8, step: 8, iw: [1.45, 4.8], iR: [6, 9], pad: 1 };
    // autumn: every limb anchor keeps its clump and most twigs end in one, big enough that
    // neighbours merge into a few masses per limb; only the outer tips stay bare
    if (style === 'autumn') cfg = { tipP: 0.9, tipR: [5.5, 7.5], sub: 3.6, step: 9, iw: [1.45, 4.6], iR: [6.5, 9], pad: 1 };
    const pickRamp = (x, y) => {
      if (style === 'summer') return HD.hash(Math.floor(x / 18), Math.floor(y / 16), 5) < 0.3 ? RP.summerDeep[0] : RP.summer[0];
      if (style === 'blossom') return RP.blossom[HD.hash(Math.floor(x / 14), Math.floor(y / 12), 6) < 0.6 ? 0 : 1];
      // autumn: colour patches across the crown, so neighbours agree (no confetti)
      const h = HD.hash(Math.floor((x + 7) / 26), Math.floor((y + 3) / 22), 77);
      const k = HD.hash(Math.floor(x / 10), Math.floor(y / 10), 78) < 0.2 ? 1 : 0;
      return RP.autumn[((h < 0.45 ? 0 : h < 0.72 ? 1 : 2) + k) % 3];
    };
    const bias = ed.id === 'harvest' ? 0.04 : ed.id === 'lights' ? -0.08 : style === 'blossom' ? -0.05 : 0;
    let foliage = null;
    let leafGroups = null; // [group][sway state] tip clumps that ride on their twig
    let twigs = null; // [group][sway state] twigs re-drawn to lead into their clumps
    if (cfg) {
      const inner = []; // clumps on the limbs: static
      const tipC = []; // clumps at the twig ends: sway with the twig's group
      for (const a of anchors(cfg.step, cfg.iw[0], cfg.iw[1], ed.id.length * 13 + 3)) {
        const r = cfg.iR[0] + rnd() * (cfg.iR[1] - cfg.iR[0]);
        if (m && Math.hypot(a.x - m.x, a.y - m.y) < m.r + r * 0.6 + cfg.pad) continue;
        const c = makeClump(rnd, a.x + (rnd() - 0.5) * 2, a.y - 1 - rnd() * 2, r, cfg.sub, rnd() * 2);
        c.ramp = pickRamp(a.x, a.y);
        inner.push(c);
      }
      const leafy = new Set(); // twigs that carry a clump
      TR.tips.forEach((tp, ti) => {
        const e = tipEnd(tp);
        if (rnd() > cfg.tipP) return;
        const r = cfg.tipR[0] + rnd() * (cfg.tipR[1] - cfg.tipR[0]);
        if (m && Math.hypot(e.x - m.x, e.y - m.y) < m.r + r * 0.5 + cfg.pad) return;
        const c = makeClump(rnd, e.x, e.y, r, cfg.sub, 2 + rnd() * 2);
        c.ramp = pickRamp(e.x, e.y);
        c.g = tp.g;
        tipC.push(c);
        leafy.add(ti);
      });
      const all = inner.concat(tipC);
      const mk = () => new K.Buf(K.TX0 - 14, K.TY0 - 10, K.TW + 28, K.TH + 12);
      const rim = !m ? null : style === 'summer' ? mix(P.leaf[7], P.moon[2], 0.45) : style === 'blossom' ? mix(P.blossom[6], P.moon[3], 0.3) : mix(P.autumn[7], P.gold[5], 0.45);
      const opts = { bias, rim, sil: style === 'blossom' ? P.violet[1] : undefined, crease: style === 'blossom' ? P.violet[2] : undefined };
      // the whole crown is shaded as one mass (creases between clumps stay coherent) ...
      const Fall = mk();
      const who = new Int32Array(Fall.w * Fall.h).fill(-1);
      canopy(Fall, all, m, { ...opts, who });
      // ... and the limbs' clumps alone, to fill what a swaying tip clump uncovers
      const Fin = mk();
      canopy(Fin, inner, m, opts);
      const St = mk();
      const layers = [];
      for (let gi = 0; gi < 7; gi++) layers.push([mk(), mk(), mk()]);
      for (let k = 0; k < Fall.c.length; k++) {
        const x = Fall.x0 + (k % Fall.w);
        const y = Fall.y0 + Math.floor(k / Fall.w);
        const col = Fall.c[k];
        const ci = who[k];
        if (col && ci >= 0 && ci >= inner.length) {
          const st = layers[all[ci].g];
          for (let sw = -1; sw <= 1; sw++) st[sw + 1].set(x + sw, y, col);
          if (Fin.c[k]) St.c[k] = Fin.c[k];
        } else if (col) St.c[k] = col;
        else if (Fin.c[k]) St.c[k] = Fin.c[k];
      }
      foliage = St.bake();
      leafGroups = layers.map((st) => st.map((b) => b.bake()));
      // twigs: the ones that carry a clump are 2px (lit top, dark underside) so the
      // clump visibly hangs on wood; bare tips stay 1px as on the Halloween tree
      const has = TR.has;
      twigs = [];
      for (let gi = 0; gi < 7; gi++) {
        const st = [];
        for (let sw = -1; sw <= 1; sw++) {
          const Bg = new K.Buf(K.TX0 - 4, K.TY0 - 4, K.TW + 8, K.TH + 8);
          TR.tips.forEach((tp, ti) => {
            if (tp.g !== gi) return;
            const c = K.annotate(K.spline(tp.pts, 0.25));
            const len = c[c.length - 1].s || 1;
            const px = K.cleanPath(c.map((p) => [p.x + sw * Math.pow(p.s / len, 1.5) * 1.2, p.y]));
            const thick = leafy.has(ti);
            for (let k = 1; k < px.length; k++) {
              const [x, y] = px[k];
              if (has(x, y)) continue;
              if (!thick) {
                Bg.set(x, y, twigCol(m, x, y));
                continue;
              }
              const dm = m ? Math.hypot(x - m.x, y - m.y) : 999;
              const inMoon = !!m && dm < m.r + 1;
              const nearMoon = !!m && dm < m.r + 12;
              Bg.set(x, y, inMoon ? P.violet[0] : nearMoon ? P.violet[2] : P.violet[5]);
              if (!has(x, y + 1) && !Bg.get(x, y + 1)) Bg.set(x, y + 1, inMoon ? P.violet[0] : P.violet[1]);
            }
          });
          st.push(Bg.bake());
        }
        twigs.push(st);
      }
    }
    // plum: five-petal blossoms and buds gathered in sprays on the branch tops,
    // with bare stretches between them (deliberate clusters, never confetti)
    // red plum: crimson petals (plum pushed towards festive red), plum[5] only on the one
    // petal that catches the light, a dark gold eye
    const PC = {
      top: P.plum[5],
      lit: mix(P.plum[4], P.red[4], 0.45),
      mid: mix(P.plum[3], P.red[4], 0.35),
      sh: P.plum[2],
      dk: P.plum[1],
      eye: mix(P.gold[4], P.plum[4], 0.3),
    };
    const flower = (B, x, y, kind) => {
      if (inDisc(m, x, y, 2)) return;
      if (kind === 0) {
        // open blossom, lit from the upper right
        B.set(x, y - 1, PC.top);
        B.set(x + 1, y, PC.lit);
        B.set(x - 1, y, PC.mid);
        B.set(x, y + 1, PC.sh);
        B.set(x - 1, y + 1, PC.dk);
        B.set(x + 1, y - 1, PC.mid);
        B.set(x, y, PC.eye);
      } else if (kind === 1) {
        // half-open, seen from the side
        B.set(x, y, PC.mid);
        B.set(x + 1, y, PC.lit);
        B.set(x, y - 1, PC.lit);
        B.set(x, y + 1, PC.dk);
      } else {
        // bud
        B.set(x, y, PC.sh);
        B.set(x, y - 1, PC.mid);
      }
    };
    if (style === 'plum') {
      const TRh = TR.has;
      const Fd = TR.F;
      for (const a of anchors(13, 1.45, 5.5, 41)) {
        if (rnd() < 0.22) continue;
        // walk to the top surface of the branch at this anchor
        let x = a.x;
        let y = a.y;
        while (TRh(x, y - 1)) y--;
        const q = TR.idx(a.x, a.y);
        const tx = q >= 0 ? Fd.ny[q] : 1; // branch tangent ~ (ny, -nx)
        const ty = q >= 0 ? -Fd.nx[q] : 0;
        const n = 3 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const sgn = k % 2 ? -1 : 1;
          const off = Math.ceil(k / 2) * 3 * sgn + (rnd() - 0.5);
          let fx = R(x + tx * off);
          let fy = R(y + ty * off);
          // sit on the branch top: climb out of the wood, then perch
          let guard = 6;
          while (TRh(fx, fy) && guard--) fy--;
          guard = 4;
          while (!TRh(fx, fy + 1) && !TRh(fx, fy + 2) && guard--) fy++;
          const kind = k === 0 ? 0 : k < 3 ? (rnd() < 0.6 ? 0 : 1) : 2;
          flower(bark, fx, fy - (kind === 0 ? 1 : 0), kind);
        }
      }
    }
    const barkArt = bark.bake();
    // sway layers for blossoms / snow on the twigs
    let groups = null;
    if (style === 'plum' || style === 'snowy') {
      groups = [];
      for (let gi = 0; gi < 7; gi++) {
        const st = [];
        for (let sw = -1; sw <= 1; sw++) {
          const Bg = new K.Buf(K.TX0 - 12, K.TY0 - 10, K.TW + 24, K.TH + 12);
          TR.tips.forEach((tp, ti) => {
            if (tp.g !== gi) return;
            const pts = tp.pts;
            const n = pts.length;
            if (style === 'plum') {
              // one blossom (or a bud) at the end of most twigs, a bud at some forks
              const h = HD.hash(ti, 5, 9);
              if (h < 0.75) {
                const e = pts[n - 1];
                flower(Bg, R(e[0] + sw * 1.2), R(e[1]), h < 0.45 ? 0 : h < 0.62 ? 1 : 2);
              }
              if (HD.hash(ti, 6, 9) < 0.3 && n > 2) {
                const p = pts[1];
                const u = 1 / (n - 1);
                flower(Bg, R(p[0] + sw * Math.pow(u, 1.5) * 1.2), R(p[1]) - 1, 2);
              }
            } else if (HD.hash(ti, 3, 11) >= 0.4) {
              // a pinch of snow caught where each twig forks off
              const p = pts[1];
              const x = R(p[0]);
              const y = R(p[1]) - 1;
              if (TR.has(x, y) || inDisc(m, x, y, 1)) return;
              Bg.set(x, y, P.snow[7]);
              if (!TR.has(x + 1, y)) Bg.set(x + 1, y, P.snow[6]);
            }
          });
          st.push(Bg.bake());
        }
        groups.push(st);
      }
    }
    return { bark: barkArt, foliage, groups, leafGroups, twigs };
  }

  // ------------------------------------------------------------------
  // hook points under branches (clear space below) for lanterns
  // ------------------------------------------------------------------
  function findHook(tx, ty, rad, clear, minW) {
    const TR = K.TREE;
    const F = TR.F;
    const has = TR.has;
    let best = null;
    for (let y = ty - rad; y <= ty + rad; y++)
      for (let x = tx - rad; x <= tx + rad; x++) {
        if (!has(x, y) || has(x, y + 1)) continue;
        const q = TR.idx(x, y);
        if (q < 0 || F.w[q] < (minW || 1.45)) continue;
        let ok = true;
        for (let dy = 1; dy <= clear && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (has(x + dx, y + dy)) ok = false;
        if (!ok) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (!best || d < best.d) best = { x, y: y + 1, d };
      }
    return best;
  }

  // ------------------------------------------------------------------
  // tree dressing: red lanterns, fairy lights, hammock
  // ------------------------------------------------------------------
  // hand-picked hooks: (x, y) is a pixel on the UNDERSIDE of a solid limb (wood above,
  // open air below, limb >= 2.5px thick) with room under it for the lantern
  const RED_LANTERNS = [
    { x: 379, y: 122, size: 'big', len: 4 }, // under the big left limb
    { x: 431, y: 145, size: 'big', len: 3 }, // under the long right arm
    { x: 461, y: 122, size: 'big', len: 3 }, // far right
    { x: 358, y: 93, size: 'small', len: 4 },
    { x: 367, y: 154, size: 'small', len: 3 },
    { x: 402, y: 62, size: 'small', len: 4 },
    { x: 417, y: 110, size: 'small', len: 5 },
    { x: 429, y: 96, size: 'small', len: 3 },
  ];
  const CORD = mix(P.red[2], P.wood[4], 0.3); // silk cord: dark red, still reads on the night sky
  /** snap a wanted hook to a real limb underside nearby (never a floating point) */
  function limbHook(hx, hy, size, len) {
    const TR = K.TREE;
    const has = TR.has;
    const big = size === 'big';
    // the cord needs a narrow shaft, the lantern body (+ tassel) a wider box under it
    const room = (x, y) => {
      for (let dy = 1; dy <= len; dy++) for (let dx = -1; dx <= 1; dx++) if (has(x + dx, y + dy)) return false;
      for (let dy = len + 1; dy <= len + (big ? 14 : 8); dy++) for (let dx = big ? -4 : -3; dx <= (big ? 4 : 3); dx++) if (has(x + dx, y + dy)) return false;
      return true;
    };
    const ok = (x, y) => {
      if (!has(x, y) || !has(x, y - 1) || has(x, y + 1)) return false;
      const q = TR.idx(x, y);
      return q >= 0 && TR.F.w[q] >= 2.5 && room(x, y);
    };
    let best = null;
    for (let y = hy - 6; y <= hy + 6; y++)
      for (let x = hx - 6; x <= hx + 6; x++) {
        if (!ok(x, y)) continue;
        const d = Math.hypot(x - hx, y - hy);
        if (!best || d < best.d) best = { x, y: y + 1, d };
      }
    return best;
  }
  let redHooks = null;
  let fairy = null; // [{x,y,k,col}] + light centroids

  function buildFairy() {
    const TR = K.TREE;
    const lim = TR.limbs;
    const pts = [];
    const groups = [];
    const add = (b, s0, s1, pitch, seed) => {
      const c = b.curve;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let i = 0; i < c.length; i++) {
        const p = c[i];
        if (p.s < s0 || p.s > s1) continue;
        const k = Math.floor(p.s / (pitch / 3));
        if (i > 0 && Math.floor(c[i - 1].s / (pitch / 3)) === k) continue;
        const ph = (p.s / pitch) * Math.PI * 2 + seed;
        if (Math.cos(ph) < -0.2) continue; // behind the branch
        const w = b.w0 + (b.w1 - b.w0) * Math.pow(Math.min(1, p.s / b.len), b.taper);
        const off = (w / 2 - 0.3) * Math.sin(ph);
        const x = R(p.x - p.ty * off);
        const y = R(p.y + p.tx * off);
        if (pts.some((q) => Math.abs(q.x - x) + Math.abs(q.y - y) < 3)) continue;
        pts.push({ x, y, k: pts.length, big: w > 9 && HD.hash(x, y, 4) < 0.5 });
        sx += x;
        sy += y;
        n++;
      }
      if (n) groups.push({ x: R(sx / n), y: R(sy / n), n });
    };
    add(lim.TRUNK, 26, 999, 13, 0.4);
    add(lim.A, 0, 999, 9, 1.1);
    add(lim.B2, 0, 999, 9, 2.3);
    add(lim.C, 0, 999, 8, 0.7);
    add(lim.D, 0, 999, 8, 2.9);
    add(lim.M1, 0, 999, 7, 1.7);
    return { pts, groups };
  }
  const FAIRY_COLS = ['gold', 'gold', 'white', 'gold', 'gold'];

  // hammock (summer): a canvas hammock with spreader bars, slung from the trunk to the
  // sturdy birdhouse post, in front of the picket fence
  const HAM = { ax: 411, ay: 188, bx: 464, by: 194, xa: 420, xb: 456, ya: 193, yb: 197, bar: 3, sag: 6 };
  const CANVAS = [mix(P.night[2], P.bone[0], 0.45), mix(P.bone[0], P.night[5], 0.3), mix(P.bone[1], P.wood[6], 0.3), mix(P.bone[2], P.wood[7], 0.2), mix(P.bone[3], P.gold[6], 0.1)];
  const BLANKET = [mix(P.red[1], P.violet[3], 0.4), mix(P.red[2], P.violet[4], 0.35), mix(P.red[3], P.violet[5], 0.3)];
  function hammockBed(sw) {
    const B = new K.Buf(HAM.xa - 4, HAM.ya - 4, HAM.xb - HAM.xa + 10, 22);
    const n = HAM.xb - HAM.xa;
    const top = (u) => HAM.ya + (HAM.yb - HAM.ya) * u;
    const prof = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const S = Math.sin(Math.PI * u);
      const yFar = R(top(u) + HAM.sag * 0.7 * S);
      const yNear = R(top(u) + HAM.bar + HAM.sag * 0.95 * S);
      const yBot = Math.max(yNear, R(top(u) + HAM.bar + HAM.sag * 1.05 * S + 2.4 * Math.pow(S, 0.7)));
      prof.push({ yFar, yNear, yBot });
      const x = HAM.xa + i + sw;
      // far rim, then the inside seen from above (darker as it dips away)
      B.set(x, yFar, CANVAS[3]);
      for (let y = yFar + 1; y < yNear; y++) B.set(x, y, y - yFar <= 1 ? CANVAS[2] : CANVAS[1]);
      // near rim catches the moon, the near side's belly rounds off into shadow
      B.set(x, yNear, CANVAS[4]);
      for (let y = yNear + 1; y <= yBot; y++) B.set(x, y, y === yBot ? CANVAS[0] : y - yNear <= 1 ? CANVAS[3] : CANVAS[2]);
    }
    // spreader bars at both ends (seen end-on, slightly from above)
    for (const [x, y] of [[HAM.xa - 1, HAM.ya], [HAM.xb + 1, HAM.yb]]) {
      B.set(x + sw, y - 1, P.wood[6]);
      for (let k = 0; k <= HAM.bar; k++) B.set(x + sw, y + k, k === 0 ? P.wood[6] : P.wood[4]);
      B.set(x + sw, y + HAM.bar + 1, P.wood[2]);
    }
    // a pillow at the trunk end
    for (let i = 1; i <= 6; i++) {
      const pr = prof[i];
      const x = HAM.xa + i + sw;
      B.set(x, pr.yFar - 1, i === 1 || i === 6 ? CANVAS[3] : P.bone[3]);
      B.set(x, pr.yFar, i > 4 ? P.bone[2] : P.bone[3]);
      B.set(x, pr.yFar + 1, P.bone[2]);
    }
    // a blanket thrown over the near rim, one corner hanging down
    const b0 = Math.round(n * 0.46);
    const b1 = Math.round(n * 0.78);
    for (let i = b0; i <= b1; i++) {
      const pr = prof[i];
      const x = HAM.xa + i + sw;
      const hang = 1 + Math.round(2.5 * Math.sin((Math.PI * (i - b0)) / (b1 - b0)) + (i > b1 - 4 ? (i - (b1 - 4)) * 0.8 : 0));
      B.set(x, pr.yNear - 1, BLANKET[1]);
      B.set(x, pr.yNear, BLANKET[2]);
      for (let k = 1; k <= hang; k++) B.set(x, pr.yNear + k, k === hang ? BLANKET[0] : BLANKET[1]);
      if ((i - b0) % 4 === 1) B.set(x, pr.yNear + 1, BLANKET[0]); // folds
    }
    return B.bake();
  }
  function hammockArt() {
    return { beds: [-1, 0, 1].map((sw) => hammockBed(sw)) };
  }
  function drawHammock(g, t, art) {
    const sw = R(T.wave(t, 7.5, 0.2) * 1.2);
    blit(g, art.beds[sw + 1]);
    // ropes fan from the ties to the ends of the spreader bars
    g.line(HAM.ax, HAM.ay, HAM.xa - 1 + sw, HAM.ya - 1, P.bone[1]);
    g.line(HAM.ax, HAM.ay, HAM.xa - 1 + sw, HAM.ya + HAM.bar, P.bone[0]);
    g.line(HAM.bx, HAM.by, HAM.xb + 1 + sw, HAM.yb - 1, P.bone[1]);
    g.line(HAM.bx, HAM.by, HAM.xb + 1 + sw, HAM.yb + HAM.bar, P.bone[0]);
    // rope wraps on the trunk and the post
    g.px(HAM.ax - 1, HAM.ay, P.bone[1]);
    g.px(HAM.ax - 1, HAM.ay + 1, P.bone[0]);
    g.hline(HAM.bx + 1, HAM.bx + 3, HAM.by, P.bone[1]);
    g.hline(HAM.bx + 1, HAM.bx + 3, HAM.by + 1, P.bone[0]);
  }

  // ------------------------------------------------------------------
  // GARDEN CORNER (replaces the graveyard): picket fence, shrubs, birdhouse, bench
  // ------------------------------------------------------------------
  const FENCE = { x0: 312, x1: 480, base: 210, top: 198 };
  const FENCE_POSTS = [313, 331, 349, 367, 385, 421, 439, 457, 475];
  const BENCH = { x: 366, base: 226, w: 24 };
  const BIRD = { x: 466, base: 217 };
  // garden shrubs stand IN FRONT of the picket fence, clear of the frame edge; which
  // ones depends on what else the edition puts in the corner
  const SHRUB_L = { x: 321, y: 214, r: 11.5, seed: 41 }; // left, by the fence corner
  const SHRUB_M = { x: 443, y: 216, r: 10, seed: 42 }; // right of the trunk
  const SHRUB_R = { x: 465, y: 219, r: 8.5, seed: 43 }; // at the foot of the birdhouse post
  function shrubsFor(ed) {
    if (ed.tagSet.has('sled')) return [SHRUB_M, SHRUB_R]; // the sled + snowman fill the left
    if (ed.tagSet.has('scarecrow')) return [SHRUB_R]; // hay on the left, scarecrow mid-right
    if (ed.tagSet.has('hammock')) return [SHRUB_L, SHRUB_R]; // nothing under the hammock
    if (ed.tagSet.has('brick-castle')) return [SHRUB_M, SHRUB_R]; // the toy castle stands on the left
    return [SHRUB_L, SHRUB_M, SHRUB_R];
  }

  // shrub ramps: the lit top sits a clear step above the grass of that edition
  function shrubRamp(ed) {
    if (ed.season === 'winter') return [P.night[1], P.leaf[0], P.leaf[1], P.leaf[2], mix(P.leaf[3], P.moss[4], 0.5), P.moss[5], mix(P.moss[6], P.moon[0], 0.2)];
    if (ed.season === 'autumn')
      return ed.id === 'harvest'
        ? [P.violet[0], P.plum[0], P.plum[1], P.autumn[2], P.autumn[3], P.autumn[4], P.autumn[5]]
        : [P.violet[0], P.plum[0], P.plum[1], P.autumn[2], P.autumn[3], P.autumn[4], mix(P.autumn[5], P.gold[3], 0.3)];
    if (ed.season === 'spring') return [P.night[1], P.leaf[0], P.leaf[2], P.leaf[3], P.leaf[5], P.leaf[6], P.leaf[7]];
    // summer: lush, a lighter fresh green than the meadow
    return [P.night[1], P.leaf[1], P.leaf[3], P.leaf[4], P.leaf[5], P.leaf[6], P.leaf[7], mix(P.leaf[7], P.moon[1], 0.3)];
  }

  function paintShrub(B, ed, sh) {
    const seed = sh.seed;
    const rnd = HD.rng(seed);
    const base = R(sh.y + sh.r * 0.72);
    // dark contact shadow: dense under the shrub, dithered out towards its ends
    for (let x = R(sh.x - sh.r - 1); x <= R(sh.x + sh.r + 1); x++) {
      const k = Math.abs(x - sh.x) / (sh.r + 1);
      if (k < 0.7 || (k < 1 && (x & 1))) B.set(x, base + 1, P.night[1]);
    }
    const c = makeClump(rnd, sh.x, sh.y, sh.r, ed.season === 'summer' ? 3.4 : 3);
    const ramp = shrubRamp(ed);
    const Bc = new K.Buf(B.x0, B.y0, B.w, B.h);
    paintClump(Bc, c, ramp, 0, null, { bias: 0.02, blur: 4 });
    // flatten the bottom onto the ground
    for (let k = 0; k < Bc.c.length; k++) {
      if (!Bc.c[k]) continue;
      const y = Bc.y0 + Math.floor(k / Bc.w);
      if (y <= base) B.c[k] = Bc.c[k];
    }
    // separate the mass from the grass: dark outline round the shaded lower half,
    // a cold rim on the moon-side shoulder, a darker skirt at the ground line
    const inS = (x, y) => y <= base && !!Bc.get(x, y);
    const edits = [];
    for (let y = R(sh.y - sh.r - 3); y <= base; y++)
      for (let x = R(sh.x - sh.r - 3); x <= R(sh.x + sh.r + 3); x++) {
        if (!inS(x, y)) continue;
        const edge = !inS(x - 1, y) || !inS(x + 1, y) || !inS(x, y - 1);
        if (!edge) continue;
        if (y > sh.y - sh.r * 0.15 || x < sh.x - sh.r * 0.55) edits.push([x, y, ramp[0]]);
        else if (x > sh.x - 1 && !inS(x, y - 1)) edits.push([x, y, ramp[ramp.length - 1]]);
      }
    for (const [x, y, c] of edits) B.set(x, y, c);
    for (let x = R(sh.x - sh.r - 1); x <= R(sh.x + sh.r + 1); x++) if (B.get(x, base) && B.get(x, base) !== ramp[0]) B.set(x, base, ramp[1]);
    const top = (x) => {
      for (let y = R(sh.y - sh.r - 3); y <= base; y++) {
        if (B.get(x, y)) return y;
      }
      return null;
    };
    if (isSnow(ed)) {
      // a snow cap that follows the crown, deeper in the middle, lit on the moon side
      const heavy = ed.ground === 'snow';
      for (let x = R(sh.x - sh.r - 1); x <= R(sh.x + sh.r + 1); x++) {
        const y = top(x);
        if (y === null) continue;
        const k = Math.abs(x - sh.x) / sh.r;
        if (k > 0.95) continue;
        const d = heavy ? (k < 0.45 ? 3 : k < 0.75 ? 2 : 1) : k < 0.55 ? 2 : 1;
        for (let j = 0; j < d; j++) B.set(x, y + j - (heavy ? 1 : 0), j === 0 ? (x > sh.x - 2 ? P.snow[8] : P.snow[7]) : j === 1 ? P.snow[6] : P.snow[5]);
        // a few drips of snow lower on the shrub
        if (HD.hash(x, seed, 7) < 0.18) B.set(x, y + d + 2, P.snow[6]);
      }
    } else if (ed.season === 'spring' || ed.season === 'summer') {
      // flower trusses (spring: pink and white blossom; summer: pale hydrangea heads),
      // each a small 2x2..3x2 cluster with a lit pixel, on the upper and lit half
      const cols = ed.season === 'spring'
        ? [[P.blossom[3], P.blossom[5], P.blossom[6]], [P.bone[0], P.bone[2], P.bone[3]], [P.blossom[3], P.blossom[4], P.blossom[6]]]
        : [[P.ice[2], P.ice[3], P.ice[4]], [P.violet[4], P.violet[5], P.violet[6]], [P.ice[1], P.ice[2], P.ice[3]]];
      const cc = cols[seed % cols.length];
      const n = Math.round(sh.r * (ed.season === 'spring' ? 1.1 : 0.7));
      for (let k = 0; k < n; k++) {
        const a = -2.9 + (k / Math.max(1, n - 1)) * 2.8 + (rnd() - 0.5) * 0.3;
        const d = sh.r * (0.3 + rnd() * 0.5);
        const fx = R(sh.x + Math.cos(a) * d);
        const fy = R(sh.y + Math.sin(a) * d * 0.75);
        if (fy > base - 2 || !B.get(fx, fy)) continue;
        B.set(fx, fy, cc[1]);
        B.set(fx + 1, fy, cc[1]);
        B.set(fx, fy + 1, cc[0]);
        B.set(fx + 1, fy + 1, cc[0]);
        B.set(fx + 1, fy - 1, cc[2]);
        if (rnd() < 0.5) B.set(fx - 1, fy, cc[0]);
      }
      if (ed.season === 'summer') {
        // dark berries tucked in the shade side
        for (let k = 0; k < 5; k++) {
          const bx = R(sh.x - sh.r * 0.6 + rnd() * sh.r * 0.8);
          const by = R(sh.y + rnd() * sh.r * 0.4);
          if (by < base - 1 && B.get(bx, by)) {
            B.set(bx, by, mix(P.violet[4], P.red[2], 0.4));
            B.set(bx + 1, by - 1, P.violet[5]);
          }
        }
      }
    } else if (ed.season === 'autumn') {
      // a few fallen leaves at the foot
      for (let k = 0; k < 5; k++) {
        const lx = R(sh.x - sh.r + rnd() * sh.r * 2.2);
        B.set(lx, base + 1, rnd() < 0.5 ? P.autumn[4] : P.plum[2]);
      }
    }
  }

  function bakeFenceGarden(ed) {
    const f = FENCE;
    const B = new K.Buf(f.x0 - 2, f.top - 14, f.x1 - f.x0 + 4, f.base - f.top + 24);
    const tree = K.TREE.has;
    const put = (x, y, c) => {
      if (!tree(x, y)) B.set(x, y, c);
    };
    const gnd = (x) => f.base + Math.round(0.7 * Math.sin(x * 0.061) + 0.6 * Math.sin(x * 0.17 + 1.3));
    const r1 = f.top + 3;
    const r2 = f.base - 4;
    // rails (behind pickets)
    for (let x = f.x0; x <= f.x1; x++) {
      put(x, r1, P.wood[5]);
      put(x, r1 + 1, P.wood[3]);
      put(x, r2, P.wood[4]);
      put(x, r2 + 1, P.wood[2]);
    }
    // pickets with pointed tops
    for (let x = f.x0 + 3; x <= f.x1; x += 4) {
      if (FENCE_POSTS.some((p) => Math.abs(p - x) < 3)) continue;
      const yt = f.top + 1 + ((x >> 2) % 3 === 0 ? 1 : 0);
      for (let y = yt; y <= gnd(x); y++) {
        put(x, y, P.wood[4]);
        put(x + 1, y, y === yt ? P.wood[3] : P.wood[6]);
      }
      put(x, yt - 1, P.wood[5]);
      put(x + 1, yt - 1, P.wood[7]);
    }
    // sturdy flat-topped posts (diyas sit on these in the Festival of Lights)
    for (const px of FENCE_POSTS) {
      for (let y = f.top - 2; y <= gnd(px) + 1; y++) {
        put(px - 1, y, P.wood[3]);
        put(px, y, P.wood[5]);
        put(px + 1, y, P.wood[6]);
      }
      for (let x = px - 2; x <= px + 2; x++) put(x, f.top - 3, x >= px + 1 ? P.wood[7] : P.wood[5]);
      put(px - 2, f.top - 2, P.wood[2]);
      put(px + 2, f.top - 2, P.wood[4]);
    }
    if (isSnow(ed)) {
      const heavy = ed.ground === 'snow';
      for (let x = f.x0; x <= f.x1; x++) {
        if (!tree(x, r1 - 1)) put(x, r1 - 1, P.snow[6]);
        if (heavy && !tree(x, r2 - 1) && HD.hash(x >> 2, 3) < 0.8) put(x, r2 - 1, P.snow[5]);
      }
      for (const px of FENCE_POSTS) {
        for (let x = px - 2; x <= px + 2; x++) put(x, f.top - 4, P.snow[x > px ? 8 : 7]);
        if (heavy) for (let x = px - 1; x <= px + 1; x++) put(x, f.top - 5, P.snow[7]);
      }
      for (let x = f.x0 + 3; x <= f.x1; x += 4) {
        if (FENCE_POSTS.some((p) => Math.abs(p - x) < 3)) continue;
        const yt = f.top + 1 + ((x >> 2) % 3 === 0 ? 1 : 0);
        put(x, yt - 2, P.snow[7]);
        put(x + 1, yt - 2, P.snow[8]);
      }
    }
    // tufts at the foot
    if (!isSnow(ed)) for (let x = f.x0 + 4; x < f.x1; x += 5 + ((x * 7) % 4)) K.grassTuft(B, x, gnd(x) + 1, x * 13, tree);
    return B.bake();
  }

  function bakeBirdhouse(ed) {
    const b = BIRD;
    const B = new K.Buf(b.x - 8, b.base - 36, 17, 40);
    const top = b.base - 22;
    // a sturdy 3px post (it also takes the hammock rope in summer)
    for (let y = top; y <= b.base; y++) {
      B.set(b.x - 1, y, P.wood[2]);
      B.set(b.x, y, P.wood[4]);
      B.set(b.x + 1, y, y < top + 3 ? P.wood[6] : P.wood[5]);
    }
    for (let x = b.x - 2; x <= b.x + 3; x++) if (HD.bayer(x, b.base + 1) < 0.7) B.set(x, b.base + 1, P.soil[1]);
    // the little house: body, round door, perch, pitched roof
    const by0 = top - 8;
    for (let y = by0; y < top; y++)
      for (let x = b.x - 3; x <= b.x + 4; x++) B.set(x, y, x === b.x - 3 ? P.wood[4] : x === b.x + 4 ? P.wood[7] : P.wood[6]);
    for (let x = b.x - 3; x <= b.x + 4; x++) B.set(x, top, P.wood[3]);
    B.set(b.x, by0 + 3, P.night[0]);
    B.set(b.x + 1, by0 + 3, P.night[0]);
    B.set(b.x, by0 + 4, P.night[0]);
    B.set(b.x + 1, by0 + 4, P.night[1]);
    B.set(b.x, by0 + 6, P.wood[2]);
    B.set(b.x + 1, by0 + 6, P.wood[4]);
    // a side perch twig on the right face, where the bird sits
    for (let x = b.x + 5; x <= b.x + 9; x++) B.set(x, by0 + 6, x === b.x + 9 ? P.wood[4] : P.wood[5]);
    B.set(b.x + 5, by0 + 7, P.wood[2]);
    const roofC = ed.season === 'winter' ? [P.red[1], P.red[2], P.red[3]] : [P.stone[2], P.stone[4], P.stone[5]];
    for (let k = 0; k <= 5; k++) {
      B.set(b.x - 4 + k, by0 - k + 1, roofC[1]);
      B.set(b.x - 4 + k, by0 - k + 2, roofC[0]);
      B.set(b.x + 5 - k, by0 - k + 1, roofC[2]);
      B.set(b.x + 5 - k, by0 - k + 2, roofC[1]);
    }
    for (let k = 1; k <= 4; k++) for (let x = b.x - 4 + k + 1; x <= b.x + 5 - k - 1; x++) B.set(x, by0 - k + 2, P.wood[6]);
    if (isSnow(ed)) {
      for (let k = 0; k <= 5; k++) {
        B.set(b.x - 4 + k, by0 - k, P.snow[7]);
        B.set(b.x + 5 - k, by0 - k, P.snow[8]);
      }
      B.set(b.x, by0 - 5, P.snow[8]);
      B.set(b.x + 1, by0 - 5, P.snow[8]);
    }
    return B.bake();
  }

  function bakeBench(ed) {
    const b = BENCH;
    const B = new K.Buf(b.x - 2, b.base - 18, b.w + 5, 22);
    const x0 = b.x;
    const x1 = b.x + b.w - 1;
    const seatY = b.base - 6;
    // legs
    for (const lx of [x0 + 1, x1 - 1]) for (let y = seatY + 2; y <= b.base; y++) {
      B.set(lx, y, P.wood[2]);
      B.set(lx + (lx === x0 + 1 ? 1 : -1), y, P.wood[1]);
    }
    // back posts and two back slats
    for (const lx of [x0 + 1, x1 - 1]) for (let y = seatY - 10; y < seatY; y++) B.set(lx, y, P.wood[3]);
    for (const sy of [seatY - 9, seatY - 5])
      for (let x = x0; x <= x1; x++) {
        B.set(x, sy, x === x1 ? P.wood[6] : P.wood[5]);
        B.set(x, sy + 1, P.wood[3]);
      }
    // seat: lit top, plank face, dark underside
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      B.set(x, seatY, x > x1 - 3 ? P.wood[7] : P.wood[6]);
      B.set(x, seatY + 1, P.wood[4]);
      B.set(x, seatY + 2, P.wood[2]);
    }
    for (let x = x0 + 5; x < x1; x += 7) B.set(x, seatY + 1, P.wood[3]);
    // ground shadow under the bench
    for (let x = x0 - 1; x <= x1 + 2; x++) if (HD.bayer(x, b.base + 1) < 0.6) B.set(x, b.base + 1, P.soil[2]);
    if (isSnow(ed)) {
      const heavy = ed.ground === 'snow';
      for (let x = x0; x <= x1; x++) {
        B.set(x, seatY - 1, x > x0 + 2 ? P.snow[7] : P.snow[6]);
        if (heavy && x > x0 + 1 && x < x1 - 1) B.set(x, seatY - 2, P.snow[8]);
        B.set(x, seatY - 10, P.snow[7]);
        if (heavy) B.set(x, seatY - 6, P.snow[6]);
      }
    } else if (ed.season === 'autumn') {
      for (const [dx, c] of [[4, P.autumn[4]], [5, P.autumn[3]], [13, P.plum[2]], [19, P.autumn[5]], [20, P.autumn[3]]]) B.set(x0 + dx, seatY - 1, c);
    } else if (ed.id === 'summer') {
      // a folded blanket on the seat
      for (let x = x0 + 3; x <= x0 + 10; x++) {
        B.set(x, seatY - 1, (x >> 1) % 2 ? P.ice[3] : P.bone[2]);
        B.set(x, seatY - 2, x === x0 + 3 || x === x0 + 10 ? P.ice[2] : (x >> 1) % 2 ? P.ice[4] : P.bone[3]);
      }
    }
    return B.bake();
  }

  // ------------------------------------------------------------------
  // YARD SETS
  // ------------------------------------------------------------------
  // snowman (winter, newyear)
  function bakeSnowman(ed) {
    const s = SL.snowman;
    const B = new K.Buf(s.x - 18, s.base - 40, 40, 44);
    const balls = [
      { y: s.base - 6, r: 7.4 },
      { y: s.base - 16, r: 5.4 },
      { y: s.base - 24, r: 4.2 },
    ];
    const lx = -0.55;
    const ly = -0.75;
    for (const b of balls) {
      const ir = Math.ceil(b.r) + 1;
      for (let dy = -ir; dy <= ir; dy++)
        for (let dx = -ir; dx <= ir; dx++) {
          const d = Math.hypot(dx / (b.r + 0.4), dy / (b.r + 0.2));
          if (d > 1) continue;
          const nz = Math.sqrt(Math.max(0, 1 - d * d));
          const v = (dx / b.r) * lx + (dy / b.r) * ly + nz * 0.55;
          let c = v > 0.85 ? P.snow[8] : v > 0.55 ? P.snow[7] : v > 0.2 ? P.snow[6] : v > -0.2 ? P.snow[5] : P.snow[4];
          if (d > 0.86 && dy > 0) c = P.snow[3];
          B.set(s.x + dx, b.y + dy, c);
        }
    }
    // flat base sunk in the snow
    for (let dx = -7; dx <= 7; dx++) B.set(s.x + dx, s.base + 1, P.snow[4]);
    // coal eyes and smile, carrot nose, buttons
    const hy = balls[2].y;
    B.set(s.x - 2, hy - 1, P.night[0]);
    B.set(s.x + 1, hy - 1, P.night[0]);
    for (const [dx, dy] of [[-2, 2], [-1, 3], [1, 3], [2, 2]]) B.set(s.x + dx, hy + dy, P.night[1]);
    B.set(s.x, hy + 1, P.pumpkin[5]);
    B.set(s.x + 1, hy + 1, P.pumpkin[4]);
    B.set(s.x + 2, hy + 1, P.pumpkin[3]);
    B.set(s.x, hy, P.pumpkin[4]);
    for (const dy of [-2, 1]) B.set(s.x, balls[1].y + dy, P.night[0]);
    B.set(s.x, balls[0].y - 3, P.night[0]);
    // stick arms: dark twigs raised up above the fence top (y < 198) so they read
    // against the sky / far snow, each ending in a little fork
    const ay = balls[1].y;
    const armL = [[-5, -1], [-6, -2], [-7, -3], [-7, -4], [-8, -5], [-9, -6], [-9, -7], [-10, -8], [-10, -9], [-11, -10], [-11, -11], [-12, -12], [-12, -13], [-13, -14]];
    const forkL = [[-14, -15], [-15, -16], [-13, -15], [-13, -16], [-8, -8], [-7, -9]];
    const armR = [[5, -1], [6, -2], [7, -3], [8, -4], [8, -5], [9, -6], [10, -7], [10, -8], [11, -9], [11, -10], [12, -11], [12, -12], [13, -13]];
    const forkR = [[14, -14], [15, -15], [13, -14], [13, -15], [9, -8], [8, -9]];
    for (const [dx, dy] of armL.concat(armR)) B.set(s.x + dx, ay + dy, P.wood[1]);
    for (const [dx, dy] of forkL.concat(forkR)) B.set(s.x + dx, ay + dy, P.wood[1]);
    // a lit upper edge along the outer arm segments (moon side)
    for (const [dx, dy] of [[12, -10], [13, -12]]) B.set(s.x + dx, ay + dy, P.wood[4]);
    // hat: a little black top hat (winter) or a striped party cone (new year)
    const ty = hy - 4;
    if (ed.id === 'newyear') {
      const C = [P.gold[3], P.blossom[4]];
      for (let k = 0; k < 6; k++) for (let dx = -Math.floor((6 - k) / 2); dx <= Math.floor((6 - k) / 2); dx++) B.set(s.x + dx + 1, ty - k, C[(k >> 1) % 2]);
      B.set(s.x + 1, ty - 6, P.gold[5]);
      B.set(s.x + 2, ty - 7, P.gold[6]);
    } else {
      for (let dx = -4; dx <= 4; dx++) B.set(s.x + dx, ty, dx > 2 ? P.stone[3] : P.night[2]);
      for (let k = 1; k <= 4; k++) for (let dx = -2; dx <= 2; dx++) B.set(s.x + dx, ty - k, dx === 2 ? P.stone[2] : P.night[1]);
      for (let dx = -2; dx <= 2; dx++) B.set(s.x + dx, ty - 1, P.red[3]);
      for (let dx = -2; dx <= 2; dx++) B.set(s.x + dx, ty - 5, P.snow[6]);
    }
    return B.bake();
  }
  // scarf: knot + two tail frames (flutters a little)
  function drawScarf(g, t) {
    const s = SL.snowman;
    const y = s.base - 20;
    const C = [P.red[2], P.red[3], P.red[4]];
    for (let dx = -4; dx <= 4; dx++) {
      g.px(s.x + dx, y, (dx + 6) % 3 === 0 ? P.gold[3] : C[dx > 1 ? 2 : 1]);
      g.px(s.x + dx, y + 1, C[0]);
    }
    const fl = T.noise(T.step(t, 6), 3.2, 61) > 0.55 ? 1 : 0;
    const tail = fl ? [[3, 2], [4, 3], [4, 4], [5, 5], [5, 6]] : [[3, 2], [3, 3], [4, 4], [4, 5], [4, 6]];
    tail.forEach(([dx, dy], i) => g.px(s.x + dx, y + dy, i % 2 ? C[1] : C[2]));
    g.px(s.x + tail[4][0] + 1, y + 6, P.gold[3]);
  }

  // sled (winter)
  function bakeSled() {
    const s = SL.sled;
    const W = 20;
    const B = new K.Buf(s.x - 12, s.base - 12, 32, 16);
    const x0 = s.x - 10;
    const by = s.base;
    // runners with a curled front (right)
    for (let x = x0; x <= x0 + W - 3; x++) {
      B.set(x, by - 1, P.red[3]);
      B.set(x, by, P.red[1]);
    }
    for (const [dx, dy, c] of [[W - 2, -2, P.red[4]], [W - 1, -3, P.red[4]], [W - 1, -4, P.red[3]], [W - 2, -5, P.red[2]], [W - 3, -4, P.red[2]], [W - 2, -1, P.red[2]]]) B.set(x0 + dx, by + dy, c);
    // struts between runner and deck
    for (const dx of [2, 7, 12, 16]) B.set(x0 + dx, by - 2, P.wood[2]);
    // slatted deck seen a little from above: lit slat tops with dark gaps, dark front edge
    for (let x = x0; x <= x0 + W - 4; x++) {
      const gap = (x - x0) % 4 === 3;
      B.set(x, by - 5, gap ? P.wood[3] : x > x0 + W - 8 ? P.wood[7] : P.wood[6]);
      B.set(x, by - 4, gap ? P.wood[2] : P.wood[5]);
      B.set(x, by - 3, P.wood[2]);
    }
    // a little snow on the back of the deck only
    for (let x = x0 + 1; x <= x0 + 6; x++) B.set(x, by - 6, x < x0 + 3 ? P.snow[6] : P.snow[7]);
    for (let x = x0 + 2; x <= x0 + 4; x++) B.set(x, by - 7, P.snow[8]);
    // pull rope: a short loop from the curl, lying on the snow before the snowman
    for (const [dx, dy] of [[W - 2, -6], [W - 1, -7], [W, -7], [W + 1, -6], [W + 1, -5], [W + 2, -4], [W + 2, -3], [W + 2, -2], [W + 1, -1], [W + 2, 0]]) B.set(x0 + dx, by + dy, P.bone[1]);
    for (let x = x0 - 1; x <= x0 + W; x++) if (HD.bayer(x, by + 1) < 0.5) B.set(x, by + 1, P.snow[3]);
    return B.bake();
  }

  // hay bales (harvest)
  // straw at night: gold pulled down with the purple-brown wood ramp (warm, not olive)
  const HAY_D = mix(P.gold[0], P.violet[1], 0.4);
  const HAY = [mix(P.gold[1], P.wood[2], 0.4), mix(P.gold[2], P.wood[3], 0.45), mix(P.gold[2], P.wood[5], 0.3), mix(P.gold[3], P.wood[6], 0.4), mix(P.gold[4], P.wood[7], 0.45)];
  function hayBale(B, x, base, w, h, seed) {
    const x0 = x - (w >> 1);
    const x1 = x0 + w - 1;
    const top = base - h;
    const td = 3; // visible top face depth
    for (let y = top; y <= base; y++)
      for (let xx = x0; xx <= x1; xx++) {
        // rounded corners
        if ((y === top || y === base) && (xx === x0 || xx === x1)) continue;
        let c;
        if (y < top + td) {
          // top face seen from above: lit back edge, then a second lighter-mid tone,
          // straw lying along the bale in short dashes
          c = y === top ? HAY[4] : HAY[3];
          if (y > top && HD.hash(xx >> 1, y, seed) < 0.3) c = y === top + 1 ? HAY[4] : HAY[2];
          if (xx === x0) c = HAY[2];
        } else {
          // front face: horizontal straw striation, darker under the top lip
          const row = y - (top + td);
          c = HAY[2];
          if (row % 2 === 1 && HD.hash(xx >> 2, y, seed + 3) < 0.65) c = HAY[1];
          else if (HD.hash(xx, y, seed + 5) < 0.1) c = HAY[3];
          if (row === 0) c = HAY[1];
          if (xx === x0) c = HAY[1];
          if (xx === x1) c = row === 0 ? HAY[2] : HAY[3];
          if (y === base) c = HAY_D;
        }
        // two twine bands
        if (xx === x0 + Math.round(w * 0.28) || xx === x0 + Math.round(w * 0.72)) c = y < top + td ? P.wood[4] : P.wood[2];
        B.set(xx, y, c);
      }
    // stray straws poking out of the top and the lit end
    for (const [sx, sy, c] of [[x0 + 3, top - 1, HAY[4]], [x0 + 2, top - 2, HAY[3]], [x1 - 4, top - 1, HAY[4]], [x1 - 3, top - 2, HAY[4]], [x1 - 2, top - 3, HAY[3]], [x1 + 1, top + td + 2, HAY[3]], [x1 + 2, top + td + 1, HAY[4]]]) B.set(sx, sy, c);
    for (let xx = x0 - 1; xx <= x1 + 1; xx++) B.set(xx, base + 1, xx > x0 && xx < x1 ? P.night[1] : P.soil[1]);
  }
  function bakeHay() {
    const B = new K.Buf(300, 190, 80, 40);
    const [a, b] = SL.hayBales;
    hayBale(B, a.x, a.base, 18, 9, 1);
    hayBale(B, b.x, b.base, 20, 10, 2);
    // a third small bale stacked on the back one
    hayBale(B, a.x + 2, a.base - 10, 13, 7, 3);
    return B.bake();
  }

  // scarecrow (harvest): friendly burlap sack face (button eyes, stitched smile) under a
  // straw hat, patched plaid shirt, straw hands; outlined so it separates from the fence
  const SCARE_ROWS = [
    '..........hhh.........',
    '.........hHHHh........',
    '.........hHHHH........',
    '........rrrrRRr.......',
    '.....hhhHHHHHHHHhh....',
    '......hhhhhhhhhhh.....',
    '.........ss.sss.......',
    '........obBBBBHo......',
    '........obBBBBHo......',
    '........obEcBEco......',
    '........obBBBBBo......',
    '........obkBBBko......',
    '.........obkkkbo......',
    '..........oyYo........',
    '.yy..pppPPPPPPPP..YY..',
    'yYyppppPPPPPPPPPPPPyYy',
    '.y.ppp.pppPPPPP.PPPPY.',
    '.......pppPqqqP.......',
    '.......pppPqQqP.......',
    '.......ppppPPPP.......',
    '.......dddDDDDD.......',
    '.......yY.yYy.Y.......',
    '..........wW..........',
    '..........wW..........',
    '..........wW..........',
    '..........wW..........',
    '..........wW..........',
    '..........wW..........',
    '..........wW..........',
    '..........wW..........',
    '.........wwWW.........',
  ];
  function bakeScarecrow() {
    const s = SL.scarecrow;
    const map = {
      h: HAY[2],
      H: HAY[4],
      y: HAY[3],
      Y: HAY[4],
      r: P.red[2],
      R: P.red[4],
      s: HAY[1],
      // burlap sack: warm tan, darker on the shadow side, lit edge towards the moon
      b: mix(P.gold[1], P.wood[5], 0.5),
      B: mix(P.gold[2], P.wood[6], 0.5),
      H2: mix(P.gold[3], P.wood[7], 0.45),
      o: P.wood[1], // outline round the head
      E: P.wood[1], // button eyes ...
      c: mix(P.bone[3], P.gold[5], 0.2), // ... with a catch-light
      k: P.wood[3], // stitched smile
      p: P.red[1],
      P: P.red[3],
      q: P.ice[1],
      Q: P.ice[3],
      d: P.night[3],
      D: P.night[5],
      w: P.wood[3],
      W: P.wood[5],
    };
    const x0 = s.x - 11;
    const y0 = s.base - SCARE_ROWS.length + 1;
    const B = new K.Buf(x0 - 1, y0, 24, SCARE_ROWS.length);
    const at = (x, y) => (y >= 0 && y < SCARE_ROWS.length && x >= 0 && x < SCARE_ROWS[y].length ? SCARE_ROWS[y][x] : '.');
    SCARE_ROWS.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        let c = ch === 'H' && y >= 7 ? map.H2 : map[ch];
        // plaid: darker 1px checks across the shirt
        if ((ch === 'p' || ch === 'P') && y >= 14 && y <= 19 && (x % 3 === 1 || y % 3 === 0)) c = ch === 'p' ? P.red[0] : P.red[2];
        B.set(x0 + x, y0 + y, c);
      }
    });
    // dark silhouette edge on the shadow (left) side of cloth, sack and pole
    SCARE_ROWS.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if ('bBpPdDwW'.indexOf(ch) < 0 || at(x - 1, y) !== '.') continue;
        B.set(x0 + x - 1, y0 + y, P.night[1]);
      }
    });
    // contact shadow at the foot of the pole
    for (let x = s.x - 3; x <= s.x + 4; x++) if (HD.bayer(x, s.base + 1) < 0.7) B.set(x, s.base + 1, P.soil[1]);
    return B.bake();
  }

  // flower beds (spring tulips & daffodils, summer daisies, cosmos, lavender, rudbeckia).
  // Flowers grow in clumps of 2-3 stems of one kind so the heads form clusters; the bed
  // box is two low planks. Summer planks are dark: the bonfire relights mid-tones to red.
  function bakeBeds(ed) {
    const B = new K.Buf(0, 196, 60, 44);
    const summer = ed.id === 'summer';
    const beds = [
      { x0: 5, x1: 31, base: 222 },
      { x0: 20, x1: 52, base: 234 },
    ];
    const PL = summer ? { top: P.wood[3], face: P.wood[2], dark: P.wood[1], post: P.wood[2], postLit: P.wood[3] } : { top: P.wood[6], face: P.wood[4], dark: P.wood[2], post: P.wood[3], postLit: P.wood[7] };
    const rnd = HD.rng(summer ? 72 : 71);
    const head = (x, y, kind) => {
      if (summer) {
        if (kind === 0) {
          // daisy: white plus with a gold eye
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) B.set(x + dx, y + dy, P.bone[2]);
          B.set(x + 1, y - 1, P.bone[1]);
          B.set(x + 1, y, P.bone[3]);
          B.set(x, y, P.gold[3]);
        } else if (kind === 1) {
          // cosmos: pink ring
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]]) B.set(x + dx, y + dy, P.blossom[3]);
          B.set(x + 1, y - 1, P.blossom[5]);
          B.set(x, y, P.gold[2]);
        } else if (kind === 2) {
          // lavender: a spike
          for (let j = 0; j < 4; j++) B.set(x, y - j + 1, j % 2 ? P.violet[5] : P.violet[4]);
          B.set(x + 1, y - 1, P.violet[4]);
          B.set(x - 1, y, P.violet[3]);
        } else {
          // rudbeckia: gold petals round a dark cone
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, -1]]) B.set(x + dx, y + dy, mix(P.gold[3], P.wood[5], 0.25));
          B.set(x, y, P.wood[1]);
        }
        return;
      }
      if (kind === 2) {
        // daffodil: pale star with a deep trumpet
        const c = mix(P.gold[4], P.night[9], 0.25);
        B.set(x - 1, y, c);
        B.set(x + 1, y, c);
        B.set(x, y - 1, c);
        B.set(x + 1, y - 1, mix(P.gold[5], P.night[9], 0.2));
        B.set(x, y + 1, mix(P.gold[3], P.night[8], 0.3));
        B.set(x, y, P.marigold[3]);
      } else {
        // tulip cup
        const tc = kind === 0 ? [P.red[3], P.red[5]] : kind === 1 ? [P.blossom[4], P.blossom[6]] : [P.gold[3], P.gold[5]];
        B.set(x, y, tc[0]);
        B.set(x + 1, y, tc[0]);
        B.set(x, y - 1, tc[1]);
        B.set(x + 1, y - 1, tc[0]);
        B.set(x - 1, y - 1, tc[0]);
        B.set(x + 1, y - 2, tc[1]);
        B.set(x - 1, y - 2, tc[0]);
      }
    };
    for (const b of beds) {
      const y0 = b.base - 3; // soil line
      // clumps of one kind, stems ~1.7px apart
      let x = b.x0 + 2;
      while (x <= b.x1 - 2) {
        const kind = Math.floor(rnd() * (summer ? 4 : 3));
        const n = 2 + Math.floor(rnd() * 2);
        const hBase = summer ? 5 + Math.floor(rnd() * 4) : 4 + Math.floor(rnd() * 2);
        for (let k = 0; k < n && x <= b.x1 - 2; k++, x += 2) {
          const tall = hBase + (k % 2 ? -1 : 1) + (rnd() < 0.3 ? 1 : 0);
          for (let j = 1; j <= tall; j++) B.set(x, y0 - j, j < 3 ? P.leaf[3] : P.leaf[4]);
          if (rnd() < 0.6) {
            B.set(x - 1, y0 - 1, P.leaf[5]);
            B.set(x + 1, y0 - 2, P.leaf[4]);
          }
          head(x, y0 - tall, kind);
        }
        x += rnd() < 0.5 ? 0 : 1;
      }
      // the bed box: soil line, two low planks, corner posts
      for (let xx = b.x0; xx <= b.x1; xx++) {
        B.set(xx, b.base - 3, P.soil[4]);
        B.set(xx, b.base - 2, PL.top);
        B.set(xx, b.base - 1, xx % 7 === 3 ? PL.dark : PL.face);
        B.set(xx, b.base, PL.dark);
        B.set(xx, b.base + 1, P.night[1]);
      }
      for (const xx of [b.x0, b.x1]) {
        B.set(xx, b.base - 4, PL.postLit);
        for (let y = b.base - 3; y <= b.base; y++) B.set(xx, y, xx === b.x1 ? PL.postLit : PL.post);
      }
    }
    return B.bake();
  }

  // painted eggs in the grass + a wicker basket (spring)
  const EGGS = [
    [66, 231, 0],
    [118, 223, 1],
    [150, 230, 2],
    [181, 236, 3],
    [262, 221, 4],
    [292, 233, 1],
    [344, 224, 0],
    [446, 229, 2],
    [124, 233, 3],
  ];
  const EGG_COLS = [
    [P.blossom[4], P.blossom[6], P.blossom[7]],
    [P.ice[3], P.ice[4], P.ice[5]],
    [mix(P.gold[3], P.night[8], 0.35), mix(P.gold[4], P.night[9], 0.3), P.gold[5]],
    [mix(P.leaf[6], P.ice[4], 0.4), mix(P.leaf[7], P.ice[5], 0.5), P.ice[5]],
    [P.violet[5], P.violet[6], mix(P.violet[6], P.bone[4], 0.5)],
  ];
  function egg(B, x, y, ci, stripe) {
    const c = EGG_COLS[ci % EGG_COLS.length];
    const rows = ['.ab.', 'abbb', 'sSSs', 'abba', '.aa.'];
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < 4; dx++) {
        const ch = row[dx];
        if (ch === '.') continue;
        let col = ch === 'b' ? c[1] : ch === 'a' ? c[0] : stripe ? (ch === 'S' ? c[2] : c[1]) : c[1];
        if (ch === 's' || ch === 'S') col = stripe ? (ch === 'S' ? EGG_COLS[(ci + 2) % 5][1] : EGG_COLS[(ci + 2) % 5][0]) : c[1];
        B.set(x - 1 + dx, y - 4 + dy, col);
      }
    });
    B.set(x, y - 3, c[2]);
  }
  function bakeEggs() {
    const B = new K.Buf(0, 196, 480, 44);
    EGGS.forEach(([x, y, ci], i) => {
      egg(B, x, y, ci, i % 2 === 0);
      // grass blades hiding the egg a little
      B.set(x - 2, y, P.leaf[4]);
      B.set(x - 2, y - 1, P.leaf[5]);
      B.set(x + 2, y, P.leaf[3]);
      if (i % 2) B.set(x + 1, y, P.leaf[5]);
      B.set(x - 1, y + 1, P.soil[2]);
      B.set(x, y + 1, P.soil[2]);
      B.set(x + 1, y + 1, P.soil[2]);
    });
    // basket where the campfire would be
    const bx = L.campfire.x;
    const by = L.campfire.base;
    const W2 = 8;
    // handle
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI * (k / 16);
      const x = R(bx - Math.cos(a) * (W2 - 1));
      const y = R(by - 7 - Math.sin(a) * 9);
      B.set(x, y, k > 8 ? P.wood[6] : P.wood[5]);
      B.set(x, y + 1, P.wood[3]);
    }
    // eggs peeking over the rim, on straw
    for (let x = bx - W2 + 1; x <= bx + W2 - 1; x++) B.set(x, by - 7, (x * 5) % 3 ? HAY[3] : HAY[2]);
    egg(B, bx - 4, by - 6, 0, true);
    egg(B, bx + 1, by - 7, 1, false);
    egg(B, bx + 5, by - 6, 2, true);
    // woven body
    for (let y = by - 6; y <= by; y++) {
      const hw = W2 - (y > by - 2 ? by - y === 0 ? 2 : 1 : 0);
      for (let x = bx - hw; x <= bx + hw; x++) {
        const weave = (x + (y % 2) * 2) % 4 < 2;
        let c = weave ? P.wood[5] : P.wood[4];
        if (y === by - 6) c = P.wood[6];
        if (x === bx - hw) c = P.wood[3];
        if (x === bx + hw) c = P.wood[6];
        if (y === by) c = P.wood[2];
        B.set(x, y, c);
      }
    }
    for (let x = bx - W2; x <= bx + W2 + 1; x++) if (HD.bayer(x, by + 1) < 0.7) B.set(x, by + 1, P.soil[2]);
    return B.bake();
  }

  // frog (spring): sits on a moonlit stone at the right rim of the small puddle, outlined
  // so it separates from the grass; blinks, and croaks about every half minute
  const FROG = { x: 338, base: 228 };
  const FROG_ROWS = {
    idle: ['.oo...oo.', 'oWPo.oPWo', 'oHHHHHHHo', 'omGGGGGmo', 'ogmmmmmgo', '.oTTTTTo.', 'ofgo.ogfo'],
    blink: ['.oo...oo.', 'oHHo.oHHo', 'oHHHHHHHo', 'omGGGGGmo', 'ogmmmmmgo', '.oTTTTTo.', 'ofgo.ogfo'],
    croak: ['.oo...oo.', 'oWPo.oPWo', 'oHHHHHHHo', 'omGGGGGmo', 'ogmmmmmgo', 'oTTTTTTTo', 'ofTTTTTfo'],
  };
  let FROG_SPR = null;
  let FROG_STONE = null;
  function frogFrame(t) {
    const ts = T.step(t, 8);
    const c = T.cycle(ts, 0, 31, 404);
    const ct = c.age * c.P;
    if ((ct > 3 && ct < 3.5) || (ct > 3.75 && ct < 4.25)) return 'croak';
    if (T.noise(ts, 3.1, 405) > 0.86) return 'blink';
    return 'idle';
  }
  function bakeFrogStone() {
    const B = new K.Buf(FROG.x - 8, FROG.base - 3, 17, 8);
    const cx = FROG.x;
    const cy = FROG.base + 2;
    for (let y = cy - 2; y <= cy + 2; y++)
      for (let x = cx - 6; x <= cx + 6; x++) {
        const nx = (x - cx) / 5.6;
        const ny = (y - cy) / 1.9;
        if (nx * nx + ny * ny > 1) continue;
        const top = !(((x - cx) / 5.6) ** 2 + ((y - 1 - cy) / 1.9) ** 2 <= 1);
        let c = y > cy ? P.stone[2] : P.stone[4];
        if (top) c = x > cx ? P.stone[6] : P.stone[5];
        if (y === cy + 2 || (y > cy && Math.abs(nx) > 0.8)) c = P.stone[1];
        B.set(x, y, c);
      }
    // the frog's contact shadow on the stone
    for (let x = cx - 3; x <= cx + 3; x++) B.set(x, FROG.base + 1, x > cx + 1 ? P.stone[3] : P.stone[2]);
    // wet dark rim where the stone meets the puddle
    for (let x = cx - 7; x <= cx + 6; x++) if (HD.bayer(x, cy + 3) < 0.6) B.set(x, cy + 3, P.soil[1]);
    return B.bake();
  }

  // robin on the birdhouse (spring): sits on the side perch, looks about, and every
  // ~24 s hops up and into the hole, later peeks out and hops back
  const ROBIN = {
    perch: ['.ohho...', 'bhehho..', '.orrhwwo', '..orwwwt', '...l.l..'],
    fly: ['...ww...', '.ohwwo..', 'bhehho..', '.orrhwwt', '..oooo..'],
  };
  let ROBIN_SPR = null;
  function drawRobin(g, t) {
    const ts = T.step(t, 8);
    const c = T.cycle(ts, 0, 24, 811);
    const u = c.age; // 0..1 over ~24 s
    const bx = BIRD.x + 4; // just right of the box (box face x 463..470)
    const by = BIRD.base - 22 - 8 + 1; // box top (by0) + 1
    const hole = [BIRD.x, BIRD.base - 22 - 8 + 3];
    if (u < 0.6 || u >= 0.94) {
      // on the side perch, facing the box; turns to look out now and then
      const look = T.noise(ts, 4.5, 812) > 0.62;
      const hopB = u >= 0.94 && u < 0.955; // landing bob
      g.sprite(ROBIN_SPR.perch, bx, by + (hopB ? -1 : 0), look);
    } else if (u < 0.615) {
      g.sprite(ROBIN_SPR.fly, bx - 2, by - 3, false); // hop up towards the hole
    } else if (u < 0.635) {
      // going in: only the tail is left sticking out of the hole
      g.px(hole[0], hole[1] + 1, P.wood[4]);
      g.px(hole[0] + 1, hole[1] + 1, P.night[1]);
      g.px(hole[0], hole[1] + 2, P.wood[3]);
    } else if (u < 0.9) {
      // inside
    } else if (u < 0.925) {
      // peeking out
      g.px(hole[0], hole[1], P.night[1]);
      g.px(hole[0] + 1, hole[1], mix(P.stone[5], P.wood[6], 0.5));
      g.px(hole[0], hole[1] + 1, mix(P.pumpkin[4], P.red[3], 0.4));
      g.px(hole[0] + 1, hole[1] + 1, mix(P.stone[5], P.wood[6], 0.5));
      g.px(hole[0] - 1, hole[1] + 1, P.gold[2]);
    } else {
      g.sprite(ROBIN_SPR.fly, bx - 2, by - 3, false); // hop back out
    }
  }

  // harvest pumpkins and gourds around the fire and on the steps
  function bakeHarvestPumpkins() {
    const B = new K.Buf(40, 190, 210, 50);
    const fire = L.campfire;
    const GOURD = [P.vine[0], P.vine[1], P.vine[2], P.vine[3], P.vine[4], mix(P.vine[4], P.gold[3], 0.4)];
    const YEL = [P.gold[0], P.gold[1], P.gold[2], mix(P.gold[2], P.gold[3], 0.5), P.gold[3], P.gold[4]];
    const GHOST = [P.stone[1], P.stone[3], P.bone[0], P.bone[1], P.bone[2], P.bone[3]];
    const list = [
      { x: 129, y: 221, rx: 8, ry: 5.6, lobes: 5, stemH: 3, dir: 1, curl: true },
      { x: 140, y: 225, rx: 3.6, ry: 3, lobes: 3, stemH: 2, dir: -1, ramp: YEL },
      { x: 147, y: 229, rx: 4.6, ry: 3.2, lobes: 4, stemH: 2, dir: 1, ramp: GOURD },
      { x: 62, y: 228, rx: 6, ry: 4.6, lobes: 5, stemH: 3, dir: -1 },
      { x: 71, y: 231, rx: 3.6, ry: 2.8, lobes: 4, stemH: 1, dir: 1, ramp: GHOST },
      { x: 207, y: 203, rx: 3.6, ry: 3, lobes: 4, stemH: 2, dir: 1 },
      { x: 234, y: 203, rx: 3.4, ry: 2.8, lobes: 3, stemH: 2, dir: -1, ramp: YEL },
      { x: 229, y: 204, rx: 2.6, ry: 2.2, lobes: 3, stemH: 1, dir: 1, ramp: GOURD },
    ];
    for (const p of list) {
      const porch = p.y < 206;
      let dx = fire.x - p.x;
      let dy = fire.base - 14 - p.y;
      if (porch) {
        dx = L.house.lantern.hookX - p.x;
        dy = -14;
      }
      const dl = Math.hypot(dx, dy);
      K.shadow(B, p.x, R(p.y + p.ry), p.rx, -Math.sign(dx) * 1.5);
      K.pumpkinBody(B, p.x, p.y, p.rx, p.ry, { lobes: p.lobes, lx: dx / dl, ly: dy / dl - 0.3, lz: 0.55, ramp: p.ramp });
      K.stem(B, p.x, R(p.y - p.ry) + 1, p.stemH, p.dir, p.curl);
    }
    K.leaf(B, 117, 223, -1, true);
    K.leaf(B, 52, 229, -1, false);
    return B.bake();
  }

  // diyas along the path and the fence posts (Festival of Lights). The path lamps are
  // generated from the shared path: even arc lengths, 8px either side along the normal,
  // nudged off the rangoli onto its rim, never on the diorama lip.
  function buildPathDiyas() {
    const pts = L.path;
    const segs = [];
    let tot = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      segs.push({ x0, y0, tx: (x1 - x0) / len, ty: (y1 - y0) / len, s0: tot, len });
      tot += len;
    }
    const at = (sv) => {
      const g = segs.find((q) => sv <= q.s0 + q.len) || segs[segs.length - 1];
      const u = sv - g.s0;
      return { x: g.x0 + g.tx * u, y: g.y0 + g.ty * u, nx: -g.ty, ny: g.tx };
    };
    const rg = SL.rangoli;
    const offRangoli = (x, y) => {
      const ex = (x - rg.x) / (rg.rx + 3);
      const ey = (y - rg.y) / (rg.ry + 2);
      const d = Math.hypot(ex, ey);
      if (d >= 1) return [x, y];
      const k = 1 / Math.max(1e-3, d);
      return [rg.x + ex * k * (rg.rx + 3), rg.y + ey * k * (rg.ry + 2)];
    };
    const sides = [[], []];
    for (const sv of [9, 17, 25]) {
      const p = at(sv);
      [-1, 1].forEach((sg, si) => {
        let [x, y] = offRangoli(p.x + p.nx * 8 * sg, p.y + p.ny * 8 * sg);
        y = Math.min(y, L.ground.front - 3);
        sides[si].push([R(x), R(y)]);
      });
    }
    return sides;
  }
  const PATH_SIDES = buildPathDiyas();
  const PATH_DIYAS = PATH_SIDES[0].concat(PATH_SIDES[1]);
  const FENCE_DIYAS = FENCE_POSTS.map((x) => [x - 3, FENCE.top - 4]);

  // bonfire: tall teepee of logs in a wide stone ring
  function bakeBonfire() {
    const c = L.campfire;
    const cx = c.x;
    const cy = c.base - 1;
    const back = new K.Buf(cx - 40, cy - 46, 80, 56);
    const front = new K.Buf(cx - 40, cy - 14, 80, 28);
    const rxR = 23;
    const ryR = 6.6;
    const N = 15;
    const stones = [];
    const r = HD.rng(916);
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2 + 0.1 + (r() - 0.5) * 0.2;
      stones.push({ x: cx + Math.cos(a) * rxR, y: cy + Math.sin(a) * ryR, rx: 3.4 + r() * 1.5, ry: 2.2 + r() * 1.0, a, seed: 300 + k * 3 });
    }
    stones.sort((p, q) => p.y - q.y);
    for (const s of stones) if (Math.sin(s.a) <= 0.15) K.stoneBlob(back, s.x, s.y, s.rx, s.ry, (cx - s.x) * 0.04, 0.5, s.seed, false);
    // teepee: logs leaning in to an apex, outer feet show end grain
    const apex = [cx + 1, cy - 34];
    const feet = [
      [cx - 17, cy - 1, 4.6],
      [cx - 9, cy - 3, 4.2],
      [cx + 5, cy - 3, 4.4],
      [cx + 16, cy - 1, 4.8],
      [cx - 2, cy - 4, 3.8],
    ];
    feet.forEach(([x, y, w], i) => K.logShape(back, x, y, apex[0] + (i % 2 ? 2 : -2), apex[1] + (i % 3), w, { end: 'a', char: 'b', seed: i + 4 }));
    // crossed base logs in front
    K.logShape(front, cx - 20, cy + 2, cx + 3, cy - 4, 5.2, { end: 'a', char: 'b', seed: 11 });
    K.logShape(front, cx + 21, cy + 2, cx - 1, cy - 4, 5.0, { end: 'a', char: 'b', seed: 12 });
    for (const s of stones) if (Math.sin(s.a) > 0.15) K.stoneBlob(front, s.x, s.y + 1, s.rx, s.ry, (cx - s.x) * 0.05, -0.9, s.seed, true);
    // a tidy woodpile off to the side, out of the brightest firelight: two rows of three
    // split logs, end grain to the camera (bark ring, pale sapwood, ring, dark heart)
    const wx = cx + 45;
    const wb = cy + 4;
    const pile = new K.Buf(wx - 4, wb - 16, 24, 20);
    // the logs' bark tops receding behind the upper row
    for (let x = wx - 1; x <= wx + 14; x++) {
      pile.set(x + 1, wb - 13, P.wood[4]);
      pile.set(x, wb - 12, x % 5 === 2 ? P.wood[2] : P.wood[3]);
    }
    const disc = (ex, ey) => {
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const d = Math.hypot(dx, dy * 1.05);
          if (d > 2.45) continue;
          let c = d > 1.75 ? P.wood[2] : d > 1.15 ? P.wood[7] : d > 0.5 ? P.wood[5] : P.wood[3];
          if (d > 1.75 && dy < 0 && dx >= 0) c = P.wood[4]; // bark rim catching light
          pile.set(ex + dx, ey + dy, c);
        }
    };
    for (let k = 0; k < 3; k++) disc(wx + 2 + k * 5, wb - 2); // bottom row
    for (let x = wx - 1; x <= wx + 14; x++) pile.set(x, wb - 5, P.night[1]); // dark gap
    for (let k = 0; k < 3; k++) disc(wx + 2 + k * 5, wb - 8); // top row
    for (let x = wx - 1; x <= wx + 15; x++) pile.set(x, wb + 1, P.night[1]);
    return { back: back.bake(), front: front.bake(), pile: pile.bake() };
  }

  // paper / harvest lantern string from the house hook to a branch
  let STRING = null;
  function buildString() {
    const from = SL.lanternString.from;
    const h = findHook(374, 156, 8, 10, 2) || { x: 372, y: 155 };
    const to = [h.x, h.y - 1];
    const sag = 9;
    const pts = [];
    const n = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) * 2);
    let last = null;
    const yAt = (u) => from[1] + (to[1] - from[1]) * u + 4 * sag * u * (1 - u) * 0.5;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const x = R(from[0] + (to[0] - from[0]) * u);
      const y = R(yAt(u));
      if (last && last[0] === x && last[1] === y) continue;
      pts.push((last = [x, y]));
    }
    const lan = [0.16, 0.36, 0.56, 0.78].map((u, i) => ({ x: R(from[0] + (to[0] - from[0]) * u), y: R(yAt(u)) + 1, size: i % 2 ? 'small' : 'big', seed: 700 + i * 13 }));
    return { pts, lan };
  }

  // ==================================================================
  // SUMMER STORY (SUMMER.md): the chapters' yard sets at layout.summer
  // anchors. layout.summer.stage stays clear for the family cats: the
  // bench / table are part of the stage and the cats gather round them.
  // ==================================================================
  const SU = L.summer;
  // the 4-12 fps sprite cadences are phased half a frame off the loop seam,
  // so LOOP -> 0 falls inside a held frame (still a pure, loop-safe f(t))
  const Q = 0.05;
  const breeze01 = (t) => clamp((HD.summer.breeze(t) + 1) / 2, 0, 1);

  // ---- flag pole with the US flag (match, nyc, home) ------------------
  // a white pole with a gold ball, a halyard and a small ground spotlight
  // (flags flown at night are lit); the flag waves with HD.summer.breeze
  const FP = { x: SU.flagpole.x, base: SU.flagpole.base, top: SU.flagpole.base - 50 };
  const FLAG = { x: FP.x + 2, y: FP.top + 2, w: 23, h: 13 };
  const FLAG_LIGHT = [1.0, 0.86, 0.66];
  function bakeFlagTex() {
    // three shades (fold in shadow, flat, fold catching the spotlight)
    const red = [P.red[2], P.red[3], mix(P.red[4], P.red[5], 0.35)];
    const wht = [mix(P.bone[0], P.night[6], 0.3), P.bone[1], P.bone[2]];
    const blu = [P.night[3], P.night[4], P.night[5]];
    const star = [P.bone[0], P.bone[1], P.bone[2]];
    return [0, 1, 2].map((s) =>
      HD.bake(FLAG.w, FLAG.h, (g) => {
        for (let y = 0; y < FLAG.h; y++)
          for (let x = 0; x < FLAG.w; x++) {
            let c = y % 2 === 0 ? red[s] : wht[s];
            // canton: 7 stripes deep, 2/5 of the fly; stars as a fine lattice
            if (x < 10 && y < 7) c = y >= 1 && y <= 5 && x >= 1 && x <= 8 && (x + y) % 2 === 0 ? star[s] : blu[s];
            g.px(x, y, c);
          }
      })
    );
  }
  function bakeFlagPole() {
    const B = new K.Buf(FP.x - 6, FP.top - 4, 16, FP.base - FP.top + 7);
    for (let y = FP.top; y <= FP.base - 1; y++) {
      B.set(FP.x, y, P.stone[5]);
      B.set(FP.x + 1, y, y < FP.top + 20 ? P.bone[1] : P.stone[6]);
    }
    // gold ball finial and truck
    B.set(FP.x, FP.top - 1, P.stone[4]);
    B.set(FP.x + 1, FP.top - 1, P.stone[6]);
    for (const [dx, dy, c] of [[0, -2, P.gold[3]], [1, -2, P.gold[5]], [0, -3, P.gold[4]], [1, -3, P.gold[6]], [-1, -2, P.gold[2]], [2, -2, P.gold[3]]]) B.set(FP.x + dx, FP.top + dy, c);
    // halyard: down the fly side to a cleat
    for (let y = FLAG.y + FLAG.h; y <= FP.base - 14; y++) B.set(FP.x + 2, y, P.bone[0]);
    B.set(FP.x + 2, FP.base - 13, P.stone[6]);
    B.set(FP.x + 2, FP.base - 15, P.stone[6]);
    // concrete footing with a lit top, a little spotlight aimed up at the flag
    for (let x = FP.x - 3; x <= FP.x + 4; x++) {
      B.set(x, FP.base - 1, x >= FP.x + 2 ? P.stone[6] : P.stone[5]);
      B.set(x, FP.base, x >= FP.x + 2 ? P.stone[4] : P.stone[3]);
      if (HD.bayer(x, FP.base + 1) < 0.7) B.set(x, FP.base + 1, P.night[1]);
    }
    B.set(FP.x + 6, FP.base, P.night[1]);
    B.set(FP.x + 7, FP.base, P.stone[3]);
    B.set(FP.x + 6, FP.base - 1, P.stone[3]);
    B.set(FP.x + 7, FP.base - 1, P.night[2]);
    for (const [dx, c] of [[-4, P.leaf[4]], [-5, P.leaf[3]], [5, P.leaf[5]], [9, P.leaf[4]]]) B.set(FP.x + dx, FP.base, c);
    return B.bake();
  }
  let FLAG_TEX = null;
  function drawFlagPole(g, t) {
    blit(g, lazy('flagPole', bakeFlagPole));
    if (!FLAG_TEX) FLAG_TEX = bakeFlagTex();
    g.em.px(FP.x + 6, FP.base - 2, P.amber[7]); // spotlight lens
    // continuous time: the cloth's rounding steps already give it a pixel cadence
    const b = breeze01(t);
    const amp = 0.6 + 1.3 * b;
    const ph = T.phase(t, 1.3);
    for (let x = 0; x < FLAG.w; x++) {
      const u = x / (FLAG.w - 1);
      const a = Math.PI * 2 * (u * 1.4 - ph);
      const k = Math.pow(u, 0.75);
      const dy = amp * k * Math.sin(a) + (1 - b) * 1.8 * u * u;
      const slope = Math.cos(a) * k * amp;
      const s = slope > 0.55 ? 0 : slope < -0.55 ? 2 : 1;
      // the fly end frays a little shorter when the folds pull it in
      const h = x === FLAG.w - 1 && Math.abs(slope) > 0.9 ? FLAG.h - 1 : FLAG.h;
      g.blit(FLAG_TEX[s], x, 0, 1, h, FLAG.x + x, FLAG.y + R(dy));
    }
  }
  function flagPoleLights(t, Lt) {
    Lt.add({ x: FLAG.x + 9, y: FLAG.y + 7, r: 19, ry: 15, color: FLAG_LIGHT, i: 0.42, bands: 4 });
    Lt.add({ x: FP.x + 4, y: FP.base - 3, r: 9, ry: 5, color: FLAG_LIGHT, i: 0.3, bands: 3 });
  }

  // ---- the football (match) -------------------------------------------
  // a classic black-and-white ball: the pentagons come from a real
  // icosahedron projected onto a 7px disc, lit from the porch side
  function bakeFootball() {
    const f = SU.football;
    const B = new K.Buf(f.x - 6, f.base - 9, 13, 11);
    const cx = f.x;
    const cy = f.base - 4;
    const r = 3.4;
    const ph = (1 + Math.sqrt(5)) / 2;
    const V = [];
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) V.push([0, s1, s2 * ph], [s1, s2 * ph, 0], [s2 * ph, 0, s1]);
    // turn one pentagon to face us (a little up and right of centre), so a
    // ring of half-pentagons sits on the rim: the classic ball read
    const rot = (v) => {
      let [x, y, z] = v;
      const th = Math.atan2(1, ph) + 0.22;
      const y1 = y * Math.cos(th) - z * Math.sin(th);
      const z1 = y * Math.sin(th) + z * Math.cos(th);
      const b = -0.2;
      const x2 = x * Math.cos(b) + z1 * Math.sin(b);
      const z2 = -x * Math.sin(b) + z1 * Math.cos(b);
      const n = Math.hypot(x2, y1, z2);
      return [x2 / n, y1 / n, z2 / n];
    };
    const VR = V.map(rot);
    const W = [P.bone[0], P.bone[1], P.bone[2], P.bone[3], P.bone[4]];
    // contact shadow
    for (let x = cx - 3; x <= cx + 4; x++) B.set(x, f.base, Math.abs(x - cx - 0.5) < 2.5 ? P.night[1] : P.leaf[1]);
    for (let y = cy - 4; y <= cy + 4; y++)
      for (let x = cx - 4; x <= cx + 4; x++) {
        const dx = (x - cx) / r;
        const dy = (y - cy) / r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const lit = dx * -0.45 + dy * -0.6 + nz * 0.66; // the porch light is up and to the right... the house is left of the ball
        let i = lit > 0.78 ? 4 : lit > 0.5 ? 3 : lit > 0.2 ? 2 : lit > -0.1 ? 1 : 0;
        const n = [dx, dy, nz];
        let patch = false;
        for (const v of VR) if (v[2] > -0.2 && n[0] * v[0] + n[1] * v[1] + n[2] * v[2] > 0.94) patch = true;
        let c = W[i];
        if (patch) c = i >= 3 ? P.night[3] : P.night[1];
        if (d2 > 0.72 && dy > 0.2) c = patch ? P.night[0] : W[Math.max(0, i - 1)];
        B.set(x, y, c);
      }
    return B.bake();
  }

  // ---- NYC: the anniversary bench --------------------------------------
  // a park bench (green slats on a black cast-iron frame), a square
  // pepperoni pizza in its open box and two lemonades on the grass in front,
  // a heart-shaped paper lantern on a shepherd's hook lighting the couple
  const NB = SU.bench;
  const NB_X0 = NB.x - (NB.w >> 1);
  const NB_X1 = NB_X0 + NB.w - 1;
  const NB_SEAT = NB.base - 6;
  const HOOK = { x: NB_X1 + 9, base: NB.base + 2, top: NB.base - 34, hx: NB_X1 + 3 };
  function bakeNYCBench() {
    const B = new K.Buf(NB_X0 - 6, NB.base - 40, NB.w + 24, 50);
    const G = [mix(P.leaf[2], P.moss[3], 0.5), mix(P.leaf[5], P.moss[5], 0.4), mix(P.leaf[7], P.moss[6], 0.35), mix(P.leaf[7], P.bone[2], 0.3)];
    const IR = [P.night[0], P.night[1], P.stone[2], P.stone[4]];
    const x0 = NB_X0;
    const x1 = NB_X1;
    const s = NB_SEAT;
    // cast-iron back uprights and arm scrolls
    for (const lx of [x0 + 1, x1 - 1]) for (let y = s - 12; y <= s; y++) B.set(lx, y, IR[1]);
    // three back slats (lit top edge, face)
    for (const sy of [s - 12, s - 9, s - 6])
      for (let x = x0; x <= x1; x++) {
        B.set(x, sy, x > x1 - 4 ? G[3] : G[2]);
        B.set(x, sy + 1, G[1]);
      }
    // arms: a curl of iron at each end
    for (const [ax, dir] of [[x0, -1], [x1, 1]]) {
      B.set(ax, s - 4, IR[1]);
      B.set(ax, s - 5, IR[1]);
      B.set(ax + dir, s - 5, IR[2]);
      B.set(ax + dir * 2, s - 4, IR[1]);
      B.set(ax + dir * 2, s - 3, IR[1]);
      B.set(ax + dir, s - 2, IR[1]);
      B.set(ax + dir * 2, s - 1, IR[1]);
      B.set(ax + dir, s - 4, IR[3]);
    }
    // seat: slat tops seen from above, plank face, dark underside
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      B.set(x, s - 1, x > x1 - 4 ? G[3] : G[2]);
      B.set(x, s, (x - x0) % 8 === 7 ? G[1] : G[2]);
      B.set(x, s + 1, G[1]);
      B.set(x, s + 2, G[0]);
    }
    // iron legs with little splayed feet
    for (const lx of [x0 + 1, x1 - 1]) {
      for (let y = s + 3; y <= NB.base; y++) B.set(lx, y, IR[1]);
      B.set(lx - 1, NB.base, IR[1]);
      B.set(lx + 1, NB.base, IR[1]);
      B.set(lx + 1, s + 3, IR[2]);
    }
    // a third leg pair at the back (darker, set in)
    for (const lx of [x0 + 3, x1 - 3]) for (let y = s + 3; y <= NB.base - 2; y++) B.set(lx, y, IR[0]);
    // ground shadow under the bench
    for (let x = x0 - 1; x <= x1 + 2; x++) if (HD.bayer(x, NB.base + 1) < 0.65) B.set(x, NB.base + 1, P.night[1]);

    // the pizza box, open on the grass in front: the plain lid stands open
    // behind the tray (inside face in shade), the square pie fills the tray
    const bx0 = NB.x - 7;
    const bx1 = NB.x + 6;
    const ly = NB.base + 1;
    const CB = [mix(P.wood[2], P.gold[0], 0.3), mix(P.wood[4], P.gold[1], 0.35), mix(P.wood[6], P.gold[2], 0.35), mix(P.bone[2], P.gold[3], 0.3)];
    for (let x = bx0 + 1; x <= bx1 - 1; x++) B.set(x, ly, CB[2]);
    for (let x = bx0; x <= bx1; x++) {
      B.set(x, ly + 1, x === bx1 ? CB[2] : CB[1]);
      B.set(x, ly + 2, x === bx1 ? CB[2] : CB[1]);
    }
    B.set(bx0 + 3, ly + 1, CB[0]); // a little grease spot
    const PZ = { crust: mix(P.pumpkin[4], P.gold[3], 0.5), crustL: mix(P.gold[4], P.bone[3], 0.35), cheese: mix(P.gold[4], P.pumpkin[5], 0.35), melt: mix(P.gold[5], P.bone[3], 0.3), pep: P.red[4], pepD: P.red[2] };
    const ty = ly + 3;
    for (let x = bx0; x <= bx1; x++) B.set(x, ty, CB[0]); // hinge crease
    for (let y = ty + 1; y <= ty + 4; y++)
      for (let x = bx0; x <= bx1; x++) {
        let c = PZ.cheese;
        if (x === bx0) c = CB[1];
        else if (x === bx1) c = CB[3];
        else if (y === ty + 1 || x === bx0 + 1) c = PZ.crust;
        else if (y === ty + 4 || x === bx1 - 1) c = PZ.crustL;
        else if ((x * 3 + y * 5) % 7 === 0) c = PZ.melt;
        B.set(x, y, c);
      }
    // pepperoni: one per square slice (2 rows of 4)
    for (let k = 0; k < 4; k++) {
      B.set(bx0 + 3 + k * 3, ty + 2, PZ.pep);
      B.set(bx0 + 2 + k * 3, ty + 3, k % 2 ? PZ.pepD : PZ.pep);
    }
    for (let x = bx0; x <= bx1; x++) {
      B.set(x, ty + 5, x === bx1 ? CB[2] : CB[1]);
      if (HD.bayer(x, ty + 6) < 0.6) B.set(x, ty + 6, P.night[1]);
    }
    // two lemonades: tall glasses with a lemon slice and a striped straw
    const glass = (gx, gy, flip) => {
      const LM = [mix(P.gold[2], P.bone[1], 0.35), mix(P.gold[4], P.bone[3], 0.4), mix(P.gold[5], P.bone[4], 0.5)];
      for (let y = gy - 4; y <= gy; y++) {
        B.set(gx, y, y === gy - 4 ? LM[2] : LM[1]);
        B.set(gx + 1, y, y === gy - 4 ? LM[2] : y === gy ? LM[0] : LM[1]);
      }
      B.set(gx + (flip ? -1 : 2), gy - 4, P.gold[4]); // lemon slice on the rim
      B.set(gx + (flip ? -1 : 2), gy - 3, P.gold[3]);
      B.set(gx + (flip ? 0 : 1), gy - 5, P.bone[3]); // straw
      B.set(gx + (flip ? 0 : 1), gy - 6, P.red[4]);
      B.set(gx + (flip ? -1 : 2), gy - 7, P.bone[3]);
      B.set(gx, gy + 1, P.night[1]);
      B.set(gx + 1, gy + 1, P.night[1]);
    };
    glass(bx0 - 4, NB.base + 8, true);
    glass(bx1 + 3, NB.base + 8, false);

    // shepherd's hook for the heart lantern
    for (let y = HOOK.top; y <= HOOK.base; y++) {
      B.set(HOOK.x, y, IR[1]);
      if (y < HOOK.base - 2 && y % 4 === 0) B.set(HOOK.x + 1, y, IR[2]);
    }
    for (const [dx, dy] of [[0, -1], [-1, -2], [-2, -2], [-3, -2], [-4, -2], [-5, -1], [-6, -1], [-6, 0]]) B.set(HOOK.x + dx, HOOK.top + dy, IR[1]);
    B.set(HOOK.x - 1, HOOK.top - 3, IR[3]);
    B.set(HOOK.x - 3, HOOK.top - 3, IR[2]);
    B.set(HOOK.x - 1, HOOK.base + 1, P.night[1]);
    B.set(HOOK.x + 1, HOOK.base + 1, P.night[1]);
    return B.bake();
  }
  const HEART_ROWS = ['.aa.aa.', 'abbabba', 'abccbba', 'abbbbba', '.abbba.', '..aba..', '...a...'];
  const HEART_LEN = 3;
  const heartHook = () => [HOOK.x - 6, HOOK.top + 1];
  function drawHeartLantern(g, t) {
    const [hx, hy] = heartHook();
    const [bx, by] = FX.lanternPos(hx, hy, t, 31, { len: HEART_LEN, amp: 0.05 + 0.08 * breeze01(t) });
    g.line(hx, hy, bx, by, P.night[2]);
    const f = T.flicker(T.step(t, 8), 77, 0.8);
    const hi = f > 0.55;
    const col = { a: mix(P.red[3], P.blossom[3], 0.4), b: hi ? '#ff7f96' : '#f0647e', c: hi ? '#ffd2da' : '#ffb2c0' };
    g.px(bx, by + 1, P.night[2]); // little cap
    HEART_ROWS.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        const ch = row[dx];
        if (ch === '.') continue;
        g.em.px(bx - 3 + dx, by + 2 + dy, col[ch]);
      }
    });
    g.px(bx, by + 2 + HEART_ROWS.length, P.red[2]); // tassel
  }
  function heartLight(t, Lt) {
    const [hx, hy] = heartHook();
    const [bx, by] = FX.lanternPos(hx, hy, t, 31, { len: HEART_LEN, amp: 0.05 + 0.08 * breeze01(t) });
    const f = T.flicker(T.step(t, 8), 77, 0.8);
    Lt.add({ x: bx - 4, y: by + 10, r: 36, ry: 26, color: [1.0, 0.56, 0.5], i: 0.55 * (0.9 + 0.2 * f), bands: 5, halo: { x: bx, y: by + 5, r: 9, a: 0.16 } });
  }

  // ---- LA: plaza string lights + a glass-tube patio heater -------------
  // two festoons of warm bulbs with paper lanterns, from hooks on the house
  // wall and the porch to a timber post at the left of the yard
  const PL_POST = { x: 52, base: 229, top: 166 };
  const PL_STRANDS = [
    { pts: [[PL_POST.x + 1, PL_POST.top + 1], [165, 147]], sag: 9, lan: [0.3, 0.62], seed: 1 },
    { pts: [[PL_POST.x + 1, PL_POST.top + 5], [201, 168]], sag: 13, lan: [0.18, 0.46, 0.76], seed: 2 },
  ];
  const PL_COLS = ['gold', 'gold', 'white', 'gold'];
  const strandAt = (s, u) => {
    const [x0, y0] = s.pts[0];
    const [x1, y1] = s.pts[1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const sg = s.sag * Math.min(1, len / 40);
    return [R(x0 + (x1 - x0) * u), R(y0 + (y1 - y0) * u + 4 * sg * u * (1 - u))];
  };
  function bakePlazaPost() {
    const p = PL_POST;
    const B = new K.Buf(p.x - 6, p.top - 4, 14, p.base - p.top + 7);
    for (let y = p.top; y <= p.base; y++) {
      B.set(p.x, y, P.wood[3]);
      B.set(p.x + 1, y, y % 9 === 4 ? P.wood[4] : P.wood[6]);
    }
    B.set(p.x, p.top - 1, P.wood[5]);
    B.set(p.x + 1, p.top - 1, P.wood[7]);
    // a little cap and two eye-hooks
    for (const [dx, dy, c] of [[-1, -2, P.stone[3]], [0, -2, P.stone[4]], [1, -2, P.stone[5]], [2, -2, P.stone[4]], [2, 1, P.stone[4]], [2, 5, P.stone[4]]]) B.set(p.x + dx, p.top + dy, c);
    // a guy wire to a peg (the strands pull it towards the house)
    for (let k = 0; k <= 14; k++) B.set(R(p.x - 1 - k * 0.55), R(p.top + 3 + k * 4.2), P.night[2]);
    B.set(p.x - 9, p.base + 1, P.wood[4]);
    for (let x = p.x - 2; x <= p.x + 3; x++) if (HD.bayer(x, p.base + 1) < 0.7) B.set(x, p.base + 1, P.night[1]);
    // the hooks on the house wall / porch
    for (const s of PL_STRANDS) {
      const [hx, hy] = s.pts[1];
      B.set(hx, hy, P.stone[4]);
      B.set(hx + 1, hy, P.stone[3]);
    }
    return B.bake();
  }
  function drawPlazaLights(g, t) {
    blit(g, lazy('plazaPost', bakePlazaPost));
    for (const s of PL_STRANDS) {
      FX.bulbs(g, s.pts, t, { colors: PL_COLS, spacing: 6, sag: s.sag, wire: P.night[1], twinkle: 0.25, seed: 40 + s.seed });
      s.lan.forEach((u, i) => {
        const [x, y] = strandAt(s, u);
        FX.lantern(g, x, y + 1, t, 60 + s.seed * 7 + i, 'paper', { len: 2, size: i % 2 ? 'small' : 'big', amp: 0.06 + 0.06 * breeze01(t) });
      });
    }
  }
  function plazaLights(t, Lt) {
    for (const s of PL_STRANDS) {
      FX.bulbLights(Lt, s.pts, t, { colors: ['gold'], sag: s.sag, every: 34, r: 26, i: 0.13 });
      s.lan.forEach((u, i) => {
        const [x, y] = strandAt(s, u);
        FX.lanternLight(Lt, x, y + 1, t, 60 + s.seed * 7 + i, 'paper', { len: 2, size: i % 2 ? 'small' : 'big', amp: 0.06 + 0.06 * breeze01(t), i: i % 2 ? 0.16 : 0.26, r: i % 2 ? 16 : 24 });
      });
    }
  }
  const HT = SU.heater;
  function bakeHeater() {
    const x = HT.x;
    const b = HT.base;
    const B = new K.Buf(x - 7, b - 34, 15, 37);
    const ST = [P.night[1], P.stone[2], P.stone[4], P.stone[5], P.stone[6], P.stone[7]];
    // base housing: a tapered box, lit on the right
    for (let y = b - 8; y <= b; y++) {
      const hw = y > b - 3 ? 4 : 3;
      for (let dx = -hw; dx <= hw; dx++) B.set(x + dx, y, dx === -hw ? ST[1] : dx >= hw - 1 ? ST[4] : y === b - 8 ? ST[4] : ST[2]);
    }
    for (let dx = -4; dx <= 4; dx++) B.set(x + dx, b - 3, ST[1]); // seam
    B.set(x + 1, b - 6, ST[0]); // control knob
    B.set(x + 2, b - 6, ST[3]);
    // glass tube frame (four corner rods seen as two) round the flame column
    for (let y = b - 26; y <= b - 9; y++) {
      B.set(x - 2, y, ST[1]);
      B.set(x + 2, y, ST[3]);
    }
    // pyramid cap
    for (let k = 0; k < 4; k++) for (let dx = -k - 1; dx <= k + 1; dx++) B.set(x + dx, b - 30 + k, dx > k - 1 ? ST[5] : k === 3 ? ST[2] : ST[3]);
    B.set(x, b - 31, ST[4]);
    for (let dx = -3; dx <= 3; dx++) B.set(x + dx, b - 26, ST[1]); // cap underside
    // shadow
    for (let dx = -5; dx <= 6; dx++) if (HD.bayer(x + dx, b + 1) < 0.7) B.set(x + dx, b + 1, P.night[1]);
    return B.bake();
  }
  function drawHeater(g, t) {
    blit(g, lazy('heater', bakeHeater));
    const x = HT.x;
    const b = HT.base;
    const ts = T.step(t, 10);
    // the flame dances up the glass tube in a slow helix
    const ph = T.phase(ts, 1.1);
    for (let y = b - 25; y <= b - 10; y++) {
      const v = (b - 10 - y) / 15; // 0 bottom .. 1 top
      const wob = Math.sin((v * 2.2 - ph) * Math.PI * 2);
      const n = T.noise(ts, 0.5, 900 + y);
      const xx = x + (wob > 0.55 ? 1 : wob < -0.55 ? -1 : 0);
      const lvl = Math.max(3, Math.min(9, R(8 - v * 3 + (n - 0.5) * 3)));
      g.em.px(xx, y, P.fire[lvl]);
      if (Math.abs(wob) < 0.55 && n > 0.45) g.em.px(xx + (wob > 0 ? 1 : -1), y, P.fire[Math.max(3, lvl - 3)]);
      g.em.px(x + (xx === x ? (wob > 0 ? -1 : 1) : 0), y, xx === x ? P.fire[2] : P.fire[3]); // glass glow
    }
    g.em.hline(x - 1, x + 1, b - 9, P.fire[4]);
  }
  function heaterLight(t, Lt) {
    const f = T.flicker(T.step(t, 10), 333, 0.7);
    Lt.add({ x: HT.x, y: HT.base - 16, r: 44, ry: 34, color: HD.LIGHT.fire, i: 0.42 * (0.88 + 0.22 * f), bands: 5, halo: { r: 12, a: 0.14 } });
  }

  // ---- San Diego: giraffes, a toy-brick castle, a brick cat, a boat ------
  const GC = {
    coat: mix(P.gold[3], P.bone[2], 0.35),
    coatD: mix(P.gold[2], P.wood[5], 0.45),
    patch: mix(P.pumpkin[3], P.wood[5], 0.4),
    patchD: mix(P.pumpkin[2], P.wood[3], 0.5),
    mane: P.wood[2],
    muzzle: mix(P.wood[5], P.bone[1], 0.35),
    eye: P.night[0],
    tip: P.wood[1],
    rim: mix(P.gold[4], P.bone[3], 0.5),
  };
  // head facing right; the neck joins at the back of the jaw (bottom left)
  const GIR_HEAD = {
    idle: ['...t.t.....', '...o.o.....', 'ee.ooooo...', '.eooooEoo..', '..oooooooor', '..ooopooomm', '..oooommmm.', '..oo.......'],
    chew: ['...t.t.....', '...o.o.....', 'ee.ooooo...', '.eooooEoo..', '..oooooooor', '..ooopooomm', '..ooommmm..', '..oo..mm...'],
    blink: ['...t.t.....', '...o.o.....', 'ee.ooooo...', '.eooooDoo..', '..oooooooor', '..ooopooomm', '..oooommmm.', '..oo.......'],
    ear: ['...t.t.....', 'e..o.o.....', '.e.ooooo...', '.eooooEoo..', '..oooooooor', '..ooopooomm', '..oooommmm.', '..oo.......'],
  };
  // both peek over the fence towards the party in the yard (facing left)
  const GIRAFFES = [
    { x: SU.giraffes.x - 11, top: 163, dir: -1, bodyTop: 189, len: 22, seed: 1 },
    { x: SU.giraffes.x + 7, top: 173, dir: -1, bodyTop: 193, len: 18, seed: 2 },
  ];
  /** reticulated coat: irregular patches separated by pale lines (a jittered cell pattern) */
  function giraffeCoat(x, y, seed) {
    const S3 = 3.2;
    const cx = Math.floor(x / S3);
    const cy = Math.floor(y / S3);
    let d1 = 1e9;
    let d2 = 1e9;
    let id = 0;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i;
        const gy = cy + j;
        const px = (gx + 0.2 + 0.6 * HD.hash(gx, gy, seed, 1)) * S3;
        const py = (gy + 0.2 + 0.6 * HD.hash(gx, gy, seed, 2)) * S3;
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = HD.hash(gx, gy, seed, 3);
        } else if (d < d2) d2 = d;
      }
    return d2 - d1 < 0.75 ? -1 : id;
  }
  function bakeGiraffeBody(gf) {
    const B = new K.Buf(gf.x - 6, gf.top - 2, 30, 214 - gf.top);
    const back = -gf.dir; // the body trails behind the neck
    // body behind the fence: the back and shoulders show above the pickets
    const bx = gf.x + back * (gf.len / 2 - 1);
    const by = gf.bodyTop + 7;
    for (let y = gf.bodyTop; y <= 212; y++)
      for (let x = R(bx - gf.len / 2 - 1); x <= R(bx + gf.len / 2 + 1); x++) {
        // a sloping back: higher at the shoulders (neck end)
        const u = (x - bx) / (gf.len / 2);
        const topY = gf.bodyTop + (u * back > 0 ? u * back * 3 : 0);
        const e = u * u + ((y - by) / 8) ** 2;
        if (e > 1 || y < topY) continue;
        const cell = giraffeCoat(x, y, gf.seed);
        let c = cell < 0 ? GC.coat : cell < 0.5 ? GC.patch : GC.patchD;
        if (y <= topY + 0.5) c = cell < 0 ? GC.rim : GC.coat;
        if (y > by + 2 && cell < 0) c = GC.coatD;
        B.set(x, y, c);
      }
    // neck: 4px at the shoulders, 3px under the head, leaning forward
    const n0 = gf.bodyTop + 3;
    const len = n0 - (gf.top + 5);
    for (let k = 0; k <= len; k++) {
      const y = n0 - k;
      const u = k / len;
      const cx = gf.x + R(gf.dir * 2.5 * u * u);
      const w = u < 0.55 ? 4 : 3;
      for (let j = 0; j < w; j++) {
        const x = cx - gf.dir * j; // j = 0 is the throat (front), w-1 the back
        const cell = giraffeCoat(x, y, gf.seed + 5);
        let c = cell < 0 ? GC.coat : cell < 0.5 ? GC.patch : GC.patchD;
        if (j === 0 && cell < 0) c = GC.coatD;
        if (j === w - 1 && cell < 0) c = GC.rim; // moonlit nape
        B.set(x, y, c);
      }
      // mane along the back of the neck
      if (k > 1) B.set(cx - gf.dir * w, y, k % 2 ? GC.mane : mix(GC.mane, GC.coatD, 0.5));
    }
    return B.bake();
  }
  let GIR_SPR = null;
  function giraffeHeads() {
    if (GIR_SPR) return GIR_SPR;
    const map = { t: GC.tip, o: GC.coat, e: GC.coatD, E: GC.eye, D: GC.coatD, m: GC.muzzle, p: GC.patch, r: GC.rim };
    GIR_SPR = {};
    for (const k in GIR_HEAD) GIR_SPR[k] = HD.sprite(GIR_HEAD[k], map);
    return GIR_SPR;
  }
  function drawGiraffes(g, t) {
    const heads = giraffeHeads();
    GIRAFFES.forEach((gf, i) => {
      blit(g, lazy('giraffe' + i, () => bakeGiraffeBody(gf)));
      const ts = T.step(t, 6);
      const bob = T.wave(t, 9 + i * 2, 0.3 * i) > 0.6 ? -1 : 0;
      let fr = 'idle';
      const cc = T.cycle(ts, i, 13 + i * 4, 610 + i);
      const ca = cc.age * cc.P;
      if (ca < 3.2) fr = Math.floor(ts * 3) % 2 ? 'chew' : 'idle';
      if (T.noise(ts, 2.7, 620 + i) > 0.86) fr = 'blink';
      const ec = T.cycle(ts, 4 + i, 17, 630 + i);
      if (ec.age * ec.P < 0.35) fr = 'ear';
      const spr = heads[fr];
      // the head's throat corner sits on the neck top
      const nx = gf.x + R(gf.dir * 2.5);
      const hx = gf.dir > 0 ? nx - 2 : nx - spr.width + 3;
      g.sprite(spr, hx, gf.top - 2 + bob, gf.dir < 0);
    });
  }

  // toy-brick castle: blue towers, red curtain wall, yellow battlements, a
  // stepped red roof and a green baseplate, every top surface studded
  const BRICK = {
    r: [P.red[1], P.red[3], P.red[4], P.red[5]],
    b: [P.night[3], mix(P.night[6], P.bulb.blue[1], 0.4), mix(P.night[7], P.bulb.blue[1], 0.55), mix(P.night[9], P.bulb.blue[2], 0.45)],
    y: [P.gold[1], P.gold[3], P.gold[4], P.gold[5]],
    g: [P.leaf[2], P.leaf[5], P.leaf[6], P.leaf[7]],
    w: [P.bone[0], P.bone[1], P.bone[2], P.bone[3]],
  };
  function brickFill(B, x0, y0, x1, y1, col, opt) {
    const C = BRICK[col];
    const o = opt || {};
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const ry = (y - y0) % 3;
        const row = Math.floor((y - y0) / 3);
        const seamV = (x - x0 + (row % 2) * 2) % 4 === 3 && ry !== 2;
        let c = C[1];
        if (ry === 2) c = C[0];
        else if (ry === 0) c = C[2];
        if (seamV) c = C[0];
        if (x === x0 && !o.noLeft) c = C[0];
        if (x === x1 && ry !== 2) c = C[3 - (o.dimRight ? 1 : 0)];
        B.set(x, y, c);
      }
  }
  function studs(B, x0, x1, y, col) {
    const C = BRICK[col];
    for (let x = x0 + 1; x <= x1 - 1; x += 2) {
      if (B.get(x, y)) continue;
      B.set(x, y, x >= x1 - 2 ? C[3] : C[2]);
    }
  }
  function bakeCastle() {
    const c = SU.castle;
    const ox = c.x - 14;
    const by = c.base;
    const B = new K.Buf(ox - 4, by - 36, 38, 40);
    const Y = (k) => by - k; // height above the baseplate
    // baseplate
    brickFill(B, ox - 2, Y(1), ox + 29, Y(0), 'g', {});
    // left tower (blue) with yellow battlements and a flag
    brickFill(B, ox, Y(22), ox + 7, Y(2), 'b');
    for (const k of [0, 3, 6]) brickFill(B, ox + k, Y(25), ox + k + 1, Y(23), 'y');
    for (const k of [0, 3, 6]) studs(B, ox + k - 1, ox + k + 2, Y(26), 'y');
    // right tower (blue) with a stepped red roof
    brickFill(B, ox + 20, Y(18), ox + 27, Y(2), 'b');
    for (let k = 0; k < 4; k++) brickFill(B, ox + 20 + k, Y(20 + k * 2 + 1), ox + 27 - k, Y(19 + k * 2), 'r', {});
    studs(B, ox + 22, ox + 25, Y(28), 'r');
    // curtain wall (red), battlements alternate red / yellow
    brickFill(B, ox + 8, Y(13), ox + 19, Y(2), 'r');
    [8, 11, 14, 17].forEach((k, i) => {
      brickFill(B, ox + k, Y(16), ox + k + 1, Y(14), i % 2 ? 'y' : 'r');
      studs(B, ox + k - 1, ox + k + 2, Y(17), i % 2 ? 'y' : 'r');
    });
    // gate: an arched dark opening with a lowered yellow drawbridge
    for (let y = Y(10); y <= Y(2); y++)
      for (let x = ox + 11; x <= ox + 16; x++) {
        if (y === Y(10) && (x === ox + 11 || x === ox + 16)) continue;
        B.set(x, y, y === Y(10) || x === ox + 11 ? P.night[0] : P.night[1]);
      }
    for (let x = ox + 11; x <= ox + 16; x++) B.set(x, Y(1), x % 2 ? BRICK.y[2] : BRICK.y[1]);
    for (let x = ox + 10; x <= ox + 17; x++) B.set(x, Y(0), BRICK.y[0]);
    // arrow-slit windows
    for (const [wx, wy] of [[ox + 3, 16], [ox + 4, 16], [ox + 23, 12], [ox + 24, 12]]) {
      B.set(wx, Y(wy), P.night[0]);
      B.set(wx, Y(wy - 1), P.night[1]);
    }
    // round white window over the gate
    B.set(ox + 13, Y(12), BRICK.w[2]);
    B.set(ox + 14, Y(12), BRICK.w[3]);
    // studs along the baseplate edges and the top of the tower faces
    studs(B, ox - 2, ox + 29, Y(2), 'g');
    // contact shadow
    for (let x = ox - 3; x <= ox + 31; x++) if (HD.bayer(x, by + 1) < 0.75) B.set(x, by + 1, P.night[1]);
    return B.bake();
  }
  function drawCastleFlag(g, t) {
    const c = SU.castle;
    const ox = c.x - 14;
    const fx = ox + 3;
    const fy = c.base - 33;
    for (let y = fy; y <= fy + 6; y++) g.px(fx, y, P.bone[1]);
    const w = T.step(t, 4);
    const fl = T.noise(w, 2.4, 77) + 0.3 * breeze01(t) > 0.7 ? 1 : 0;
    const rows = fl ? [[1, 4], [1, 5], [1, 3]] : [[1, 4], [1, 4], [1, 2]];
    rows.forEach(([a, b], k) => g.hline(fx + a, fx + b, fy + k, k === 1 ? BRICK.y[2] : BRICK.y[1]));
  }

  // brick cat sculpture: a sitting cat built from bricks, studs on its head
  const BRICKCAT = [
    '.yy.....yy.....',
    '.YY.....YY.....',
    '.yyy...yyy.....',
    '.yyyyyyyyy.....',
    '.yBByyyBBy.....',
    '.yyyykyyyy.....',
    '.yyyyyyyyy.....',
    '..rrrrrrr......',
    '.yyyyyyyyy.....',
    'yyyyyyyyyyy....',
    'yyyyyyyyyyy..yy',
    'yyyyyyyyyyy..yy',
    'yyyyyyyyyyy..yy',
    'yyyyyyyyyyyyyyy',
    'bbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbb',
    'bbbbbbbbbbbbbbb',
  ];
  function bakeBrickCat() {
    const c = SU.brickCat;
    const H = BRICKCAT.length;
    const W = BRICKCAT[0].length;
    const ox = c.x - 11;
    const oy = c.base - H + 1;
    const B = new K.Buf(ox - 2, oy - 2, W + 4, H + 4);
    const at = (x, y) => (y >= 0 && y < H && x >= 0 && x < W ? BRICKCAT[y][x] : '.');
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ch = BRICKCAT[y][x];
        if (ch === '.') continue;
        let c2;
        if (ch === 'B') c2 = BRICK.b[3];
        else if (ch === 'k') c2 = P.night[1];
        else if (ch === 'r') c2 = (x % 4 === 3) ? BRICK.r[1] : BRICK.r[2];
        else {
          const C = ch === 'b' ? BRICK.b : BRICK.y;
          // bricks: 2px courses, staggered vertical seams, lit edges facing the moon (right)
          const row = Math.floor(y / 2);
          const ry = y % 2;
          c2 = ry === 1 ? C[1] : C[2];
          if ((x + (row % 2) * 2) % 4 === 3 && ry === 1) c2 = C[0];
          if (ch === 'Y') c2 = C[3];
          if (at(x - 1, y) === '.') c2 = C[0];
          if (at(x + 1, y) === '.' || at(x, y - 1) === '.') c2 = ry === 1 && at(x + 1, y) !== '.' ? C[1] : C[3];
          if (ch === 'b' && at(x, y - 1) !== 'b' && at(x, y - 1) !== '.') c2 = C[1];
        }
        B.set(ox + x, oy + y, c2);
      }
    // studs on every upward-facing surface
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const ch = BRICKCAT[y][x];
        if (ch === '.' || at(x, y - 1) !== '.') continue;
        if (x % 2 === 0) B.set(ox + x, oy + y - 1, ch === 'b' ? BRICK.b[2] : BRICK.y[3]);
      }
    // whiskers
    B.set(ox - 1, oy + 5, P.bone[1]);
    B.set(ox + 11, oy + 5, P.bone[1]);
    for (let x = ox - 1; x <= ox + W; x++) if (HD.bayer(x, c.base + 1) < 0.75) B.set(x, c.base + 1, P.night[1]);
    return B.bake();
  }

  // the little sailboat on the big puddle ("the bay"): drawn in fx right
  // after the engine's puddle reflections so the water doesn't wash it out
  const BOAT = { x: SU.boat.x, y: SU.boat.y };
  function drawBoat(g, t) {
    const ts = T.step(t, 8);
    const x = R(BOAT.x + 7 * T.wave(t, 80, 0.15));
    const bob = T.wave(ts, 3.4, 0.2) > 0.35 ? -1 : 0;
    const rock = T.wave(ts, 4.6, 0.6);
    const tilt = rock > 0.5 ? 1 : rock < -0.5 ? -1 : 0;
    const wl = BOAT.y; // waterline
    const hull = [mix(P.bone[1], P.night[7], 0.25), mix(P.bone[2], P.night[8], 0.2), mix(P.red[3], P.violet[4], 0.3), P.night[4]];
    // reflection: hull + sail flipped, broken by ripples
    for (let k = 0; k < 7; k++) {
      const yy = wl + 1 + (k >> 1);
      if (yy > wl + 3) break;
      const w = 4 - (k >> 1);
      for (let dx = -w; dx <= w; dx++) if (HD.bayer(x + dx, yy + (ts * 8 % 2 | 0)) < 0.55) g.px(x + dx, yy, mix(P.night[5], P.bone[0], 0.35));
    }
    // hull: 11px, a red boot stripe, a lit deck edge
    for (let dx = -5; dx <= 5; dx++) {
      g.px(x + dx, wl - 1 + bob, dx > 2 ? hull[1] : hull[0]);
      if (Math.abs(dx) <= 4) g.px(x + dx, wl + bob, hull[2]);
    }
    g.px(x + 6, wl - 2 + bob, hull[1]); // bow
    g.px(x - 6, wl - 1 + bob, hull[0]); // stern
    g.hline(x - 4, x + 4, wl + 1 + bob, hull[3]);
    // mast and sails (main aft of the mast, a little jib forward)
    const mx = x;
    const top = wl - 13 + bob;
    for (let y = top; y <= wl - 2 + bob; y++) g.px(mx + (y < top + 5 ? tilt : 0), y, P.wood[4]);
    for (let k = 0; k <= 9; k++) {
      const y = top + 1 + k;
      const w = Math.round(k * 0.55);
      for (let dx = 1; dx <= w; dx++) g.px(mx - dx + (k < 4 ? tilt : 0), y, dx === w ? mix(P.bone[2], P.night[8], 0.3) : dx === 1 ? P.bone[3] : P.bone[4]);
    }
    for (let k = 0; k <= 6; k++) {
      const y = top + 4 + k;
      const w = Math.round(k * 0.6);
      for (let dx = 1; dx <= w; dx++) g.px(mx + dx, y, dx === w ? P.bone[2] : P.bone[3]);
    }
    g.px(mx + tilt, top - 1, P.red[4]); // pennant
    g.px(mx + tilt + 1, top - 1, P.red[3]);
  }

  // ---- DC: the birthday table, cake and candles; balloons on the fence ---
  const TB = SU.table;
  const TB_X0 = TB.x - (TB.w >> 1);
  const TB_X1 = TB_X0 + TB.w - 1;
  const TB_TOP = TB.base - 10;
  // three candles, 3px apart so each little flame reads on its own
  const CANDLES = [-3, 0, 3].map((dx, i) => ({ x: TB.x + dx, y: TB_TOP - 9 - (i === 1 ? 1 : 0), col: i }));
  function bakeTable() {
    const B = new K.Buf(TB_X0 - 4, TB_TOP - 16, TB.w + 8, 30);
    const CL = [mix(P.bone[0], P.night[5], 0.3), P.bone[0], P.bone[1], P.bone[2], P.bone[3]];
    const PINK = [P.blossom[2], P.blossom[3], P.blossom[4], P.blossom[5]];
    // table top seen from above (3 rows), cloth falls in front with folds
    for (let x = TB_X0; x <= TB_X1; x++) {
      B.set(x, TB_TOP, x > TB_X1 - 6 ? CL[4] : CL[3]);
      B.set(x, TB_TOP + 1, CL[3]);
      B.set(x, TB_TOP + 2, CL[2]);
      for (let y = TB_TOP + 3; y <= TB_TOP + 7; y++) {
        let c = CL[2];
        if ((x - TB_X0) % 6 === 0) c = CL[1]; // fold
        if ((x - TB_X0) % 6 === 1 && y > TB_TOP + 4) c = CL[1];
        if (x === TB_X0) c = CL[0];
        if (x === TB_X1) c = CL[3];
        B.set(x, y, c);
      }
      // scalloped pink hem
      const sc = (x - TB_X0) % 4;
      B.set(x, TB_TOP + 7, PINK[1 + (sc === 1 || sc === 2 ? 1 : 0)]);
      if (sc === 1 || sc === 2) B.set(x, TB_TOP + 8, PINK[0]);
    }
    // pink check on the cloth top
    for (let x = TB_X0 + 1; x < TB_X1; x += 4) B.set(x, TB_TOP + 1, PINK[2]);
    // legs below the hem
    for (const lx of [TB_X0 + 2, TB_X1 - 2]) {
      B.set(lx, TB_TOP + 9, P.wood[2]);
      B.set(lx, TB.base, P.wood[2]);
    }
    for (let x = TB_X0 - 1; x <= TB_X1 + 2; x++) if (HD.bayer(x, TB.base + 1) < 0.75) B.set(x, TB.base + 1, P.night[1]);
    for (let x = TB_X0; x <= TB_X1; x++) if (HD.bayer(x, TB.base) < 0.5) B.set(x, TB.base, P.night[1]);

    // the cake: plate, two pink layers with cream between, white frosting with drips
    const cx = TB.x;
    const cy = TB_TOP; // stands on the top's middle row
    for (let dx = -7; dx <= 7; dx++) B.set(cx + dx, cy + 1, dx > 3 ? P.bone[4] : P.bone[3]); // plate
    for (let dx = -6; dx <= 6; dx++) B.set(cx + dx, cy + 2, P.bone[1]);
    for (let y = cy - 6; y <= cy; y++)
      for (let dx = -5; dx <= 5; dx++) {
        let c = y === cy - 3 ? P.bone[3] : PINK[2];
        if (dx === -5) c = y === cy - 3 ? P.bone[2] : PINK[1];
        if (dx >= 4) c = y === cy - 3 ? P.bone[4] : PINK[3];
        if (y === cy) c = dx >= 3 ? PINK[2] : PINK[1];
        B.set(cx + dx, y, c);
      }
    // frosting top (ellipse seen from above) with drips over the edge
    for (let dx = -5; dx <= 5; dx++) {
      B.set(cx + dx, cy - 7, Math.abs(dx) === 5 ? P.bone[3] : dx > 1 ? P.bone[4] : P.bone[3]);
      B.set(cx + dx, cy - 6, P.bone[3]);
    }
    for (let dx = -4; dx <= 4; dx++) B.set(cx + dx, cy - 8, dx > 0 ? P.bone[4] : P.bone[3]);
    for (const [dx, d] of [[-4, 1], [-2, 2], [1, 1], [3, 2], [5, 1]]) for (let k = 1; k <= d; k++) B.set(cx + dx, cy - 6 + k, P.bone[3]);
    // little red berries on the frosting rim
    for (const dx of [-5, -1, 3]) B.set(cx + dx, cy - 7, P.red[4]);
    // candles (colours alternate; the wick sits on top)
    const CC = [[P.ice[3], P.ice[4]], [P.gold[3], P.gold[4]], [P.ice[3], P.ice[4]]];
    for (const c of CANDLES) {
      B.set(c.x, c.y + 1, CC[c.col][1]);
      B.set(c.x, c.y + 2, CC[c.col][0]);
      if (c.y + 3 < cy - 7) B.set(c.x, c.y + 3, CC[c.col][0]);
      B.set(c.x, c.y, P.night[1]);
    }
    // plates stacked on the left, a jug of lemonade and two cups on the right
    for (let k = 0; k < 3; k++) for (let x = TB_X0 + 3; x <= TB_X0 + 8; x++) B.set(x, TB_TOP + 1 - k, k === 2 ? (x > TB_X0 + 6 ? P.bone[4] : P.bone[3]) : P.bone[1 + k]);
    B.set(TB_X0 + 10, TB_TOP + 1, P.stone[6]); // forks
    B.set(TB_X0 + 11, TB_TOP + 1, P.stone[5]);
    const jx = TB_X1 - 5;
    const LM = [mix(P.gold[2], P.bone[1], 0.35), mix(P.gold[4], P.bone[3], 0.4), mix(P.gold[5], P.bone[4], 0.5)];
    for (let y = TB_TOP - 5; y <= TB_TOP + 1; y++)
      for (let dx = 0; dx <= 2; dx++) B.set(jx + dx, y, y === TB_TOP - 5 ? P.bone[2] : y === TB_TOP - 4 ? LM[2] : dx === 2 ? LM[2] : dx === 0 ? LM[0] : LM[1]);
    B.set(jx + 3, TB_TOP - 3, P.bone[1]); // handle
    B.set(jx + 3, TB_TOP - 1, P.bone[1]);
    B.set(jx + 4, TB_TOP - 2, P.bone[1]);
    B.set(jx - 1, TB_TOP - 5, P.bone[2]); // spout
    for (const [ux, uc] of [[TB_X1 - 9, P.red[3]], [TB_X1 - 1, P.ice[3]]]) {
      B.set(ux, TB_TOP, uc);
      B.set(ux, TB_TOP - 1, uc);
      B.set(ux + 1, TB_TOP, uc);
      B.set(ux + 1, TB_TOP - 1, P.bone[3]);
    }
    return B.bake();
  }
  /** per-candle state: lit, leaning (blown), or out with a smoke wisp */
  function candleState(t, i) {
    const s = HD.summer.sec(t);
    const out = HD.summer.candlesOut(t);
    const blow = HD.summer.blowing(t);
    if (out >= 0) return { lit: false, smoke: out * 12 };
    // relit one by one, left to right, just after the cheer
    if (s >= 112 && s < 112 + 0.45 * (i + 1)) return { lit: false, smoke: 99 };
    return { lit: true, blow };
  }
  function drawCandles(g, t) {
    CANDLES.forEach((c, i) => {
      const st = candleState(t, i);
      if (!st.lit) {
        // a thin grey wisp curls up from each wick for ~3 s
        if (st.smoke < 3.2) {
          const k = st.smoke / 3.2;
          for (let j = 0; j < 3; j++) {
            const h = (k * 7 + j * 2.2) % 7;
            const sx = c.x + R(Math.sin(h * 0.9 + i) * 0.8 - h * 0.25);
            if (HD.bayer(sx, c.y - 1 - R(h)) < 1 - k * 0.8) g.px(sx, c.y - 1 - R(h), j ? P.stone[5] : P.stone[6]);
          }
        }
        g.px(c.x, c.y, P.night[0]);
        return;
      }
      if (st.blow >= 0) {
        // dad blows from the right: the flames lean away and gutter
        const e = g.em;
        const lean = st.blow > 0.25 ? -1 : 0;
        e.px(c.x, c.y - 1, P.fire[8]);
        if (st.blow < 0.75 || (i + R(st.blow * 10)) % 2) e.px(c.x + lean, c.y - 2, P.fire[7]);
        if (st.blow < 0.4) e.px(c.x + lean - (st.blow > 0.2 ? 1 : 0), c.y - 3, P.fire[5]);
        return;
      }
      FX.flame(g, c.x, c.y, t, 50 + i, 1);
    });
  }
  function candleLights(t, Lt) {
    let n = 0;
    let fl = 0;
    CANDLES.forEach((c, i) => {
      const st = candleState(t, i);
      if (!st.lit) return;
      n += st.blow >= 0 ? 0.6 : 1;
      fl += T.flicker(T.step(t, 10), 50 + i, 1.4);
    });
    if (n <= 0) return;
    const f = fl / Math.max(1, n);
    Lt.add({ x: TB.x, y: TB_TOP - 10, r: 34, ry: 26, color: HD.LIGHT.candle, i: (0.1 + 0.07 * n) * (0.82 + 0.3 * f), bands: 5, halo: { r: 7, a: 0.08 + 0.02 * n } });
  }

  // balloons tied to the fence: bunches on two posts, bobbing in the breeze
  const BAL_COLS = {
    red: [P.red[2], P.red[4], P.red[6]],
    gold: [P.gold[2], P.gold[4], P.gold[6]],
    blue: [mix(P.night[5], P.bulb.blue[1], 0.35), mix(P.night[7], P.bulb.blue[1], 0.55), mix(P.ice[4], P.bulb.blue[2], 0.4)],
    pink: [P.blossom[3], P.blossom[5], P.blossom[7]],
    green: [P.leaf[4], mix(P.leaf[7], P.firefly[1], 0.35), mix(P.leaf[7], P.firefly[3], 0.4)],
  };
  const BAL_BUNCHES = [
    { x: 331, y: 202, list: [[-7, -24, 'red'], [1, -30, 'gold'], [8, -22, 'blue']] },
    { x: 421, y: 202, list: [[-6, -22, 'pink'], [2, -28, 'green'], [9, -20, 'red']] },
  ];
  // and a pair tied to the birthday table's corner, over the cake
  const TABLE_BALLOONS = { x: SU.table.x + (SU.table.w >> 1) - 2, y: SU.table.base - 9, list: [[-2, -27, 'gold'], [4, -23, 'pink']] };
  const BAL_ROWS = ['.aabb.', 'aabbbc', 'aabbbb', 'aabbbb', '.aabb.', '..ab..', '...a..'];
  function drawBalloons(g, t, list) {
    const ts = T.step(t, 8);
    const br = HD.summer.breeze(ts);
    list.forEach((bn, bi0) => {
      const bi = bn === TABLE_BALLOONS ? 2 : bi0;
      // the knot on the rail
      g.px(bn.x, bn.y, P.bone[2]);
      g.px(bn.x + 1, bn.y, P.bone[1]);
      bn.list.forEach(([dx, dy, cn], i) => {
        const sway = br * 1.6 * (-dy / 28) + 0.8 * T.wave(ts, 5.3 + i * 0.9, bi * 0.31 + i * 0.17);
        const bob = T.wave(ts, 4.1 + i * 0.7, i * 0.23 + bi * 0.4) > 0.55 ? -1 : 0;
        const bx = R(bn.x + dx + sway);
        const by = bn.y + dy + bob;
        // string: from the knot to the balloon's tie, with a soft kink
        const mx = R((bn.x + bx) / 2 + sway * 0.4);
        const my = R((bn.y + by + 5) / 2);
        g.line(bn.x, bn.y - 1, mx, my, P.bone[0]);
        g.line(mx, my, bx, by + 5, P.bone[0]);
        const C = BAL_COLS[cn];
        BAL_ROWS.forEach((row, ry) => {
          for (let rx = 0; rx < row.length; rx++) {
            const ch = row[rx];
            if (ch === '.') continue;
            g.px(bx - 3 + rx, by - 2 + ry, ch === 'a' ? C[0] : ch === 'b' ? C[1] : C[2]);
          }
        });
      });
    });
  }

  // which garden pieces a chapter keeps (the giraffes stand where the
  // birdhouse is; the castle takes the left shrub's spot)
  const gardenKeeps = (ed, what) => {
    if (what === 'bird') return !ed.tagSet.has('giraffes');
    return true;
  };

  // ---- dispatch ----------------------------------------------------------
  function summerBack(g, t) {
    // z32: flag pole, brick cat
    if (HD.tag('us-flag-pole')) drawFlagPole(g, t);
    if (HD.tag('brick-cat')) blit(g, lazy('brickCat', bakeBrickCat));
  }
  function summerMid(g, t) {
    // z36: the stage sets (the family cats are drawn over these at z47)
    if (HD.tag('football')) blit(g, lazy('football', bakeFootball));
    if (HD.tag('anniversary-bench')) {
      blit(g, lazy('nycBench', bakeNYCBench));
      drawHeartLantern(g, t);
    }
    if (HD.tag('patio-heater')) drawHeater(g, t);
    if (HD.tag('birthday-table')) {
      if (HD.tag('balloons')) drawBalloons(g, t, [TABLE_BALLOONS]);
      blit(g, lazy('table', bakeTable));
      drawCandles(g, t);
    }
  }
  function summerLights(t, Lt) {
    if (HD.tag('us-flag-pole')) flagPoleLights(t, Lt);
    if (HD.tag('anniversary-bench')) heartLight(t, Lt);
    if (HD.tag('plaza-lights')) plazaLights(t, Lt);
    if (HD.tag('patio-heater')) heaterLight(t, Lt);
    if (HD.tag('birthday-table')) candleLights(t, Lt);
  }
  S.fxBoat = function (g, t) {
    if (HD.tag('boat')) drawBoat(g, t + Q);
  };

  // ------------------------------------------------------------------
  // per-edition caches
  // ------------------------------------------------------------------
  let treeArt;
  let gardenArt;
  let yardArt;
  S.init = function (kit) {
    K = kit;
    treeArt = HD.perEdition((ed) => buildTreeArt(ed));
    gardenArt = HD.perEdition((ed) => {
      const front = new K.Buf(300, 180, 180, 54);
      shrubsFor(ed).forEach((sh) => paintShrub(front, ed, sh));
      return {
        fence: bakeFenceGarden(ed),
        bird: bakeBirdhouse(ed),
        bench: bakeBench(ed),
        front: front.bake(),
        snowman: ed.tagSet.has('snowman') ? bakeSnowman(ed) : null,
        ham: ed.tagSet.has('hammock') ? hammockArt() : null,
      };
    });
    yardArt = {
      sled: null,
      hay: null,
      scare: null,
      beds: HD.perEdition((ed) => bakeBeds(ed)),
      eggs: null,
      harvest: null,
      bonfire: null,
      frogStone: null,
    };
    FROG_SPR = {};
    const fm = {
      o: P.night[1],
      W: P.bone[4],
      P: P.night[0],
      H: mix(P.leaf[7], P.gold[5], 0.45), // moonlit lime back
      G: mix(P.leaf[7], P.gold[4], 0.15),
      g: P.leaf[5],
      m: P.leaf[2], // the wide smile
      T: mix(P.bone[3], P.gold[5], 0.25), // pale throat
      f: P.leaf[4],
    };
    for (const k in FROG_ROWS) FROG_SPR[k] = HD.sprite(FROG_ROWS[k], fm);
    ROBIN_SPR = {};
    const rm = {
      o: P.night[1],
      b: P.gold[2],
      h: mix(P.stone[6], P.wood[7], 0.5),
      e: P.night[0],
      r: mix(P.pumpkin[5], P.red[4], 0.3),
      w: P.wood[6],
      t: P.wood[4],
      l: P.wood[2],
    };
    for (const k in ROBIN) ROBIN_SPR[k] = HD.sprite(ROBIN[k], rm);
    redHooks = [];
    for (const r of RED_LANTERNS) {
      const h = limbHook(r.x, r.y, r.size, r.len);
      // a lantern never hangs from thin air: if the tree changed (?treeSeed) and no limb is
      // near, leave that lantern out and say so
      if (!h) console.warn('props: no limb for the red lantern at ' + r.x + ',' + r.y);
      else redHooks.push({ ...r, x: h.x, y: h.y });
    }
    fairy = buildFairy();
    STRING = buildString();
  };
  const lazy = (k, fn) => yardArt[k] || (yardArt[k] = fn());

  // ------------------------------------------------------------------
  // passes
  // ------------------------------------------------------------------
  S.tree = function (g, t) {
    const A = treeArt();
    blit(g, A.bark);
    const G = A.twigs || K.TREE.groups;
    const sw = [];
    for (let gi = 0; gi < G.length; gi++) sw.push(K.swayState(t, gi));
    for (let gi = 0; gi < G.length; gi++) blit(g, G[gi][sw[gi]]);
    if (A.foliage) blit(g, A.foliage);
    // tip clumps ride on their twig: same sway state as the twig group
    if (A.leafGroups) for (let gi = 0; gi < A.leafGroups.length; gi++) blit(g, A.leafGroups[gi][sw[gi]]);
    if (A.groups) for (let gi = 0; gi < 7; gi++) blit(g, A.groups[gi][sw[gi]]);
  };

  S.treeDress = function (g, t) {
    const ed = HD.edition;
    if (HD.tag('tree-red-lanterns')) {
      redHooks.forEach((h, i) => {
        // swing about the limb hook; the lantern body hangs from the swung cord end
        const seed = 900 + i * 7;
        const [bx, by] = FX.lanternPos(h.x, h.y, t, seed, { len: h.len, amp: 0.1 });
        FX.lantern(g, bx, by, t, seed, 'red', { len: 0, size: h.size });
        g.line(h.x, h.y, bx, by, CORD);
      });
    }
    if (HD.tag('tree-fairy-lights')) {
      const ts = T.step(t, 6);
      for (const p of fairy.pts) {
        const ramp = P.bulb[FAIRY_COLS[p.k % FAIRY_COLS.length]];
        const n = T.noise(ts, 2.8, 1300 + p.k);
        const lv = n > 0.62 ? 2 : n < 0.14 ? 0 : 1;
        // warm bulb with a soft plus-shaped bloom when it twinkles up
        g.em.px(p.x, p.y, lv === 0 ? ramp[1] : ramp[2]);
        if (lv === 2) {
          g.em.px(p.x - 1, p.y, ramp[0]);
          g.em.px(p.x + 1, p.y, ramp[0]);
          g.em.px(p.x, p.y - 1, ramp[0]);
          g.em.px(p.x, p.y + 1, p.big ? ramp[1] : ramp[0]);
        }
      }
    }
    if (HD.tag('giraffes')) drawGiraffes(g, t + Q); // behind the fence, in front of the tree
    void ed;
  };

  S.garden = function (g, t) {
    const A = gardenArt();
    blit(g, A.fence);
    if (gardenKeeps(HD.edition, 'bird')) blit(g, A.bird);
    if (HD.tag('balloons')) drawBalloons(g, t + Q, BAL_BUNCHES);
    if (HD.tag('diyas-yard')) FENCE_DIYAS.forEach(([x, y], i) => FX.diya(g, x + 3, y, t, 500 + i));
    if (HD.tag('birdhouse')) drawRobin(g, t);
  };

  // front of the garden, painted back to front (by ground contact)
  S.gardenFront = function (g, t) {
    const A = gardenArt();
    if (HD.tag('hammock') && A.ham) drawHammock(g, t, A.ham); // hangs ~y206, tied to trunk + post
    if (HD.tag('sled')) blit(g, lazy('sled', bakeSled)); // base 214
    if (HD.tag('scarecrow')) blit(g, lazy('scare', bakeScarecrow)); // base 220
    if (HD.tag('hay-bales')) blit(g, lazy('hay', bakeHay)); // base 221..225
    if (HD.tag('brick-castle')) {
      blit(g, lazy('castle', bakeCastle)); // base 223
      drawCastleFlag(g, t + Q);
    }
    blit(g, A.front); // shrubs, bases 222..226
    if (A.snowman) {
      blit(g, A.snowman);
      drawScarf(g, t);
    }
    blit(g, A.bench); // base 226
    if (HD.tag('frog')) {
      blit(g, lazy('frogStone', bakeFrogStone));
      const spr = FROG_SPR[frogFrame(t)];
      g.sprite(spr, FROG.x - 4, FROG.base - spr.height + 1);
    }
  };

  S.string = function (g, t) {
    if (HD.tag('plaza-lights')) drawPlazaLights(g, t + Q);
    if (!HD.tag('paper-lantern-string')) return;
    const kind = HD.edition.id === 'harvest' ? 'harvest' : 'paper';
    for (const [x, y] of STRING.pts) g.px(x, y, P.night[1]);
    STRING.lan.forEach((l) => FX.lantern(g, l.x, l.y, t, l.seed, kind, { len: 2, size: l.size, amp: 0.08 }));
  };

  S.yardBack = function (g, t) {
    if (HD.tag('flower-beds')) blit(g, yardArt.beds());
    if (HD.tag('eggs')) blit(g, lazy('eggs', bakeEggs));
    if (HD.edition.story) summerBack(g, t + Q);
  };

  S.yardMid = function (g, t) {
    if (HD.tag('harvest-pumpkins')) blit(g, lazy('harvest', bakeHarvestPumpkins));
    if (HD.tag('diyas-yard')) PATH_DIYAS.forEach(([x, y], i) => FX.diya(g, x, y, t, 520 + i));
    if (HD.edition.story) summerMid(g, t + Q);
  };

  S.yardFront = function () {};

  S.bonfireBack = function (g) {
    blit(g, lazy('bonfire', bakeBonfire).back);
  };
  S.bonfireFront = function (g) {
    const A = lazy('bonfire', bakeBonfire);
    blit(g, A.front);
    blit(g, A.pile);
  };

  // ------------------------------------------------------------------
  // lights (aggregated)
  // ------------------------------------------------------------------
  S.lights = function (t, Lt) {
    if (HD.edition.story) summerLights(t + Q, Lt);
    if (HD.tag('tree-red-lanterns') && redHooks) {
      redHooks.forEach((h, i) => {
        const seed = 900 + i * 7;
        const [bx, by] = FX.lanternPos(h.x, h.y, t, seed, { len: h.len, amp: 0.1 });
        FX.lanternLight(Lt, bx, by, t, seed, 'red', { len: 0, size: h.size, i: h.size === 'big' ? 0.34 : 0.2 });
      });
    }
    if (HD.tag('tree-fairy-lights') && fairy) {
      for (const gr of fairy.groups) Lt.add({ x: gr.x, y: gr.y, r: 22 + gr.n * 0.4, color: HD.LIGHT.bulb.gold, i: 0.14 + gr.n * 0.004, bands: 4, halo: { r: 12, a: 0.05 } });
    }
    if (HD.tag('paper-lantern-string') && STRING) {
      const kind = HD.edition.id === 'harvest' ? 'harvest' : 'paper';
      STRING.lan.forEach((l) => FX.lanternLight(Lt, l.x, l.y, t, l.seed, kind, { len: 2, size: l.size, amp: 0.08 }));
    }
    if (HD.tag('diyas-yard')) {
      // aggregated along each side of the path: one light per pair of neighbours
      PATH_SIDES.forEach((side, si) => {
        for (let i = 0; i < side.length; i += 2) {
          const a = side[i];
          const b = side[Math.min(side.length - 1, i + 1)];
          FX.diyaLight(Lt, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, t, 520 + si * 7 + i, 24, b === a ? 0.26 : 0.34);
        }
      });
      for (let i = 0; i < FENCE_DIYAS.length; i += 3) {
        const a = FENCE_DIYAS[i];
        const b = FENCE_DIYAS[Math.min(FENCE_DIYAS.length - 1, i + 2)];
        FX.diyaLight(Lt, (a[0] + b[0]) / 2 + 3, a[1], t, 500 + i, 30, 0.3);
      }
    }
  };
})();
