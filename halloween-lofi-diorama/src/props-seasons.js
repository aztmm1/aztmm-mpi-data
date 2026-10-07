/*
 * props — seasonal editions (Rainy Hollow series). Owned by the props module.
 *
 * props.js keeps the Halloween yard byte-for-byte and calls these hooks for
 * every other edition (HD._propsSeasons.*). Everything static is baked once
 * per edition with HD.perEdition and blitted; HD.edition is read at draw time.
 *
 *   tree         z12   bark re-shaded per moon, snow caps, foliage clumps (blossom,
 *                      autumn, summer), plum blossoms; tip clumps sway with the twigs
 *   treeDress    z13.5 red lanterns, wound fairy lights, hammock
 *   garden       z14   picket fence, back shrubs, birdhouse post (+ fence diyas)
 *   gardenFront  z16   bench, front shrubs, snowman, sled, hay bales, scarecrow, frog
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
   * Shade a union of clumps as one leaf mass: a height field (max over the
   * spheres) gives each pixel the normal of its front-most sphere, so creases
   * between clumps fall into shade on their own. Clean bands, a serrated edge.
   *  o.bias brightens, o.sil colour inside the moon, o.jit tone jitter (2x2 blocks)
   */
  function canopy(B, clumps, m, o) {
    o = o || {};
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1e9;
    let y1 = -1e9;
    const subs = [];
    clumps.forEach((c, ci) => {
      for (const sb of c.subs) {
        subs.push({ x: sb.x + (o.dx || 0), y: sb.y, r: sb.r, z: sb.z, ci });
        x0 = Math.min(x0, Math.floor(sb.x - sb.r - 2));
        y0 = Math.min(y0, Math.floor(sb.y - sb.r - 2));
        x1 = Math.max(x1, Math.ceil(sb.x + sb.r + 2));
        y1 = Math.max(y1, Math.ceil(sb.y + sb.r + 2));
      }
    });
    if (!subs.length) return;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const H = new Float32Array(w * h).fill(-1e9);
    const win = new Int32Array(w * h).fill(-1);
    subs.forEach((sb, si) => {
      const rr = sb.r * sb.r + sb.r * 0.5;
      for (let y = Math.floor(sb.y - sb.r - 1); y <= Math.ceil(sb.y + sb.r + 1); y++)
        for (let x = Math.floor(sb.x - sb.r - 1); x <= Math.ceil(sb.x + sb.r + 1); x++) {
          const d2 = (x - sb.x) * (x - sb.x) + (y - sb.y) * (y - sb.y);
          if (d2 > rr) continue;
          const hh = sb.z + Math.sqrt(Math.max(0, sb.r * sb.r - d2));
          const q = (y - y0) * w + (x - x0);
          if (hh > H[q]) {
            H[q] = hh;
            win[q] = si;
          }
        }
    });
    const inM = (x, y) => x >= x0 && y >= y0 && x <= x1 && y <= y1 && win[(y - y0) * w + (x - x0)] >= 0;
    const bias = o.bias || 0;
    const jit = o.jit === undefined ? 0.07 : o.jit;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const q = (y - y0) * w + (x - x0);
        const si = win[q];
        if (si < 0) continue;
        const sb = subs[si];
        const c = clumps[sb.ci];
        const ramp = c.ramp;
        const top = ramp.length - 1;
        // serrated leafy rim: nibble some edge pixels (never opening holes)
        const nE = inM(x + 1, y) + inM(x - 1, y) + inM(x, y + 1) + inM(x, y - 1);
        if (nE < 4 && nE >= 2 && HD.hash(x, y, 17) < 0.26) continue;
        if (nE <= 1) continue;
        let nx = (x - sb.x) / sb.r;
        let ny = (y - sb.y) / sb.r;
        const n2 = nx * nx + ny * ny;
        if (n2 > 1) {
          const k = 1 / Math.sqrt(n2);
          nx *= k;
          ny *= k;
        }
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const dif = Math.max(0, nx * L3[0] + ny * L3[1] + nz * L3[2]);
        const low = clamp((sb.y - c.y) / Math.max(2, c.r), -1, 1);
        let v = 0.1 + 0.85 * dif - 0.16 * low + bias + (HD.hash(x >> 1, y >> 1, 23) - 0.5) * jit;
        let i = clamp(Math.floor(v * top + 0.5), 0, top);
        if (!inM(x, y + 1) && i > 1) i = 1; // underside in shade
        if (i === top && !(inM(x + 1, y - 1) && inM(x, y - 1)) === false && dif < 0.9) i = top - 1;
        let col = ramp[i];
        if (m && Math.hypot(x - m.x, y - m.y) < m.r + 0.5) col = o.sil || ramp[0];
        B.set(x, y, col);
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
      blossom: [
        [P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3], P.blossom[4], P.blossom[5], P.blossom[6]],
        [P.blossom[0], P.blossom[1], P.blossom[2], P.blossom[3], P.blossom[4], mix(P.blossom[5], P.blossom[6], 0.5), P.blossom[7]],
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
    if (style === 'summer') cfg = { tipP: 1, tipR: [6.5, 9], sub: 4.2, step: 8, iw: [1.45, 6], iR: [7, 10], pad: 3 };
    if (style === 'blossom') cfg = { tipP: 0.95, tipR: [5, 7.5], sub: 3.4, step: 9, iw: [1.45, 4.8], iR: [5.5, 8.5], pad: 1 };
    if (style === 'autumn') cfg = { tipP: 0.6, tipR: [4.5, 6.5], sub: 3.2, step: 11, iw: [1.45, 4.4], iR: [5, 7.5], pad: 0 };
    const pickRamp = (x, y) => {
      if (style === 'summer') return HD.hash(Math.floor(x / 18), Math.floor(y / 16), 5) < 0.3 ? RP.summerDeep[0] : RP.summer[0];
      if (style === 'blossom') return RP.blossom[HD.hash(Math.floor(x / 14), Math.floor(y / 12), 6) < 0.6 ? 0 : 1];
      // autumn: colour patches across the crown, so neighbours agree (no confetti)
      const h = HD.hash(Math.floor((x + 7) / 26), Math.floor((y + 3) / 22), 77);
      const k = HD.hash(Math.floor(x / 10), Math.floor(y / 10), 78) < 0.2 ? 1 : 0;
      return RP.autumn[((h < 0.45 ? 0 : h < 0.72 ? 1 : 2) + k) % 3];
    };
    const bias = ed.id === 'harvest' ? 0.04 : ed.id === 'lights' ? -0.08 : 0;
    let foliage = null;
    if (cfg) {
      const clumps = [];
      for (const a of anchors(cfg.step, cfg.iw[0], cfg.iw[1], ed.id.length * 13 + 3)) {
        const r = cfg.iR[0] + rnd() * (cfg.iR[1] - cfg.iR[0]);
        if (m && Math.hypot(a.x - m.x, a.y - m.y) < m.r + r * 0.6 + cfg.pad) continue;
        if (style === 'autumn' && rnd() < 0.3) continue;
        const c = makeClump(rnd, a.x + (rnd() - 0.5) * 2, a.y - 1 - rnd() * 2, r, cfg.sub, rnd() * 2);
        c.ramp = pickRamp(a.x, a.y);
        clumps.push(c);
      }
      for (const tp of TR.tips) {
        const e = tipEnd(tp);
        if (rnd() > cfg.tipP) continue;
        const r = cfg.tipR[0] + rnd() * (cfg.tipR[1] - cfg.tipR[0]);
        if (m && Math.hypot(e.x - m.x, e.y - m.y) < m.r + r * 0.5 + cfg.pad) continue;
        const c = makeClump(rnd, e.x, e.y, r, cfg.sub, 2 + rnd() * 2);
        c.ramp = pickRamp(e.x, e.y);
        clumps.push(c);
      }
      const F = new K.Buf(K.TX0 - 14, K.TY0 - 10, K.TW + 28, K.TH + 12);
      canopy(F, clumps, m, { bias });
      foliage = F.bake();
    }
    // plum: blossoms sit right on the dark branches, in little sprays
    const plumBloom = (B, x, y, k, dx) => {
      const big = k % 3 !== 0;
      if (inDisc(m, x, y, 1)) return;
      if (big) {
        B.set(x + dx, y - 1, P.plum[3]);
        B.set(x + dx - 1, y, P.plum[3]);
        B.set(x + dx + 1, y, P.plum[4]);
        B.set(x + dx, y + 1, P.plum[2]);
        B.set(x + dx, y, k % 2 ? P.plum[5] : mix(P.plum[5], P.gold[5], 0.4));
      } else {
        B.set(x + dx, y, P.plum[3]);
        B.set(x + dx + 1, y - 1, P.plum[4]);
      }
    };
    if (style === 'plum') {
      for (const a of anchors(7, 1.45, 4.6, 41)) {
        if (rnd() < 0.3) continue;
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) plumBloom(bark, a.x + k * 2 - n + 1, a.y - 1 - (k % 2), k + a.x, 0);
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
              for (let k = 1; k < n; k++) {
                if (HD.hash(ti, k, 9) < 0.35) continue;
                const u = k / (n - 1);
                plumBloom(Bg, R(pts[k][0]), R(pts[k][1]), ti + k, R(sw * Math.pow(u, 1.5) * 1.2));
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
    return { bark: barkArt, foliage, groups };
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
  const RED_LANTERNS = [
    { tx: 358, ty: 150, size: 'big', len: 6 },
    { tx: 432, ty: 136, size: 'big', len: 4 },
    { tx: 386, ty: 110, size: 'small', len: 5 },
    { tx: 343, ty: 118, size: 'small', len: 3 },
    { tx: 452, ty: 112, size: 'small', len: 6 },
    { tx: 420, ty: 92, size: 'small', len: 3 },
    { tx: 466, ty: 92, size: 'big', len: 3 },
    { tx: 333, ty: 140, size: 'small', len: 4 },
  ];
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
  const FAIRY_COLS = ['gold', 'white', 'gold', 'gold'];

  // hammock between the trunk and a post (summer)
  const HAM = { x0: 414, y0: 191, x1: 455, y1: 196, post: 457 };
  function hammockArt() {
    const B = new K.Buf(HAM.x0 - 2, HAM.y0 - 12, HAM.post - HAM.x0 + 8, 40);
    // the post
    for (let y = HAM.y1 - 6; y <= 216; y++) {
      B.set(HAM.post, y, P.wood[3]);
      B.set(HAM.post + 1, y, y < HAM.y1 - 4 ? P.wood[5] : P.wood[4]);
    }
    B.set(HAM.post, HAM.y1 - 7, P.wood[4]);
    B.set(HAM.post + 1, HAM.y1 - 7, P.wood[6]);
    // rope bands around the trunk
    B.set(HAM.x0 - 1, HAM.y0, P.bone[0]);
    B.set(HAM.x0, HAM.y0 + 1, P.bone[1]);
    return B.bake();
  }
  function drawHammock(g, t) {
    const sway = R(T.wave(t, 7.5, 0.2) * 1.2);
    const n = HAM.x1 - HAM.x0;
    const midSag = 11;
    const ys = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      ys.push(HAM.y0 + (HAM.y1 - HAM.y0) * u + midSag * Math.pow(Math.sin(Math.PI * u), 1.3));
    }
    // ropes fanning to the ends
    const bedA = 9;
    const bedB = n - 7;
    const sx = (i) => HAM.x0 + i + (i > bedA && i < bedB ? sway * Math.sin((Math.PI * (i - bedA)) / (bedB - bedA)) : 0);
    g.line(HAM.x0, HAM.y0, sx(bedA), ys[bedA] - 1, P.bone[1]);
    g.line(HAM.x0, HAM.y0, sx(bedA), ys[bedA] + 2, P.bone[0]);
    g.line(HAM.x1, HAM.y1, sx(bedB), ys[bedB] - 1, P.bone[1]);
    g.line(HAM.x1, HAM.y1, sx(bedB), ys[bedB] + 2, P.bone[0]);
    // the fabric bed: striped canvas, lit top edge, shaded belly
    const STR = [P.red[2], P.bone[1], P.night[6], P.bone[1]];
    for (let i = bedA; i <= bedB; i++) {
      const x = R(sx(i));
      const y = R(ys[i]);
      const st = STR[Math.floor((i - bedA) / 3) % STR.length];
      g.px(x, y - 1, P.bone[2]);
      g.px(x, y, st);
      g.px(x, y + 1, st);
      g.px(x, y + 2, mix(st, P.night[1], 0.45));
    }
  }

  // ------------------------------------------------------------------
  // GARDEN CORNER (replaces the graveyard): picket fence, shrubs, birdhouse, bench
  // ------------------------------------------------------------------
  const FENCE = { x0: 312, x1: 480, base: 210, top: 198 };
  const FENCE_POSTS = [313, 331, 349, 367, 385, 421, 439, 457, 475];
  const BENCH = { x: 366, base: 226, w: 24 };
  const BIRD = { x: 466, base: 217 };
  const SHRUBS_BACK = [
    { x: 321, y: 206, r: 8.5 },
    { x: 436, y: 207, r: 7.5 },
    { x: 340, y: 208, r: 5.5 },
  ];
  const SHRUBS_FRONT = [{ x: 474, y: 222, r: 7.5 }, { x: 427, y: 221, r: 5 }];

  function shrubRamp(ed) {
    if (ed.season === 'winter') return [P.leaf[0], P.leaf[0], P.leaf[1], P.leaf[2], mix(P.leaf[3], P.moss[4], 0.5), P.moss[5]];
    if (ed.season === 'autumn') return ed.id === 'harvest' ? [P.plum[0], P.plum[1], P.autumn[2], P.autumn[3], P.autumn[4], P.autumn[5]] : [P.plum[0], P.plum[0], P.plum[1], P.autumn[2], P.autumn[3], P.autumn[4]];
    if (ed.season === 'spring') return [P.leaf[0], P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4], P.leaf[6]];
    return [P.leaf[0], P.leaf[1], P.leaf[2], P.leaf[3], P.leaf[4], P.leaf[5], P.leaf[6]];
  }

  function paintShrub(B, ed, sh, seed) {
    const rnd = HD.rng(seed);
    const c = makeClump(rnd, sh.x, sh.y, sh.r, ed.season === 'summer' ? 3 : 2.6);
    // flatten the bottom onto the ground
    const ramp = shrubRamp(ed);
    paintClump(B, c, ramp, 0, null, { bias: -0.04 });
    const base = R(sh.y + sh.r * 0.75);
    for (let y = base + 1; y < base + 6; y++) for (let x = R(sh.x - sh.r - 2); x <= R(sh.x + sh.r + 2); x++) B.del(x, y);
    // contact shadow
    for (let x = R(sh.x - sh.r); x <= R(sh.x + sh.r); x++) if (!B.get(x, base + 1) && HD.bayer(x, base + 1) < 0.7) B.set(x, base + 1, P.soil[2]);
    const top = (x) => {
      for (let y = R(sh.y - sh.r - 3); y <= base; y++) if (B.get(x, y)) return y;
      return null;
    };
    if (isSnow(ed)) {
      const heavy = ed.ground === 'snow';
      for (let x = R(sh.x - sh.r - 1); x <= R(sh.x + sh.r + 1); x++) {
        const y = top(x);
        if (y === null) continue;
        const k = Math.abs(x - sh.x) / sh.r;
        if (k > 0.92) continue;
        const d = heavy ? (k < 0.5 ? 3 : k < 0.8 ? 2 : 1) : k < 0.6 ? 2 : 1;
        for (let j = 0; j < d; j++) B.set(x, y + j - (heavy ? 1 : 0), j === 0 ? (x > sh.x - 2 ? P.snow[8] : P.snow[7]) : P.snow[5 + (j === 1 ? 1 : 0)]);
      }
    } else if (ed.season === 'spring' || ed.season === 'summer') {
      // flowers in deliberate little trusses on the lit upper half
      const cols = ed.season === 'spring' ? [[P.blossom[5], P.blossom[7]], [P.bone[2], P.bone[4]], [P.blossom[4], P.blossom[6]]] : [[P.violet[5], P.violet[6]], [P.ice[3], P.ice[5]], [P.blossom[4], P.blossom[6]]];
      const cc = cols[seed % cols.length];
      const n = Math.round(sh.r * 0.8);
      for (let k = 0; k < n; k++) {
        const a = -2.6 + (k / Math.max(1, n - 1)) * 2.2 + (rnd() - 0.5) * 0.4;
        const d = sh.r * (0.35 + rnd() * 0.45);
        const fx = R(sh.x + Math.cos(a) * d);
        const fy = R(sh.y + Math.sin(a) * d * 0.8);
        B.set(fx, fy, cc[1]);
        B.set(fx - 1, fy, cc[0]);
        B.set(fx, fy + 1, cc[0]);
        if (rnd() < 0.5) B.set(fx + 1, fy + 1, cc[0]);
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
    for (let y = top; y <= b.base; y++) {
      B.set(b.x, y, P.wood[3]);
      B.set(b.x + 1, y, P.wood[5]);
    }
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
    // stick arms
    const arm = [[-5, -1], [-7, -3], [-9, -4], [-10, -6], [-11, -4]];
    for (const [dx, dy] of arm) B.set(s.x + dx, balls[1].y + dy, P.wood[4]);
    B.set(s.x - 9, balls[1].y - 6, P.wood[3]);
    for (const [dx, dy] of [[5, -1], [7, -2], [9, -4], [10, -5], [11, -5], [10, -7]]) B.set(s.x + dx, balls[1].y + dy, P.wood[4]);
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
    // struts
    for (const dx of [2, 7, 12, 16]) B.set(x0 + dx, by - 2, P.wood[2]);
    // deck slats (3/4 top)
    for (let x = x0 + 1; x <= x0 + W - 4; x++) {
      B.set(x, by - 3, P.wood[3]);
      B.set(x, by - 4, (x - x0) % 4 === 0 ? P.wood[4] : P.wood[6]);
      B.set(x, by - 5, (x - x0) % 4 === 0 ? P.wood[5] : P.wood[7]);
    }
    // snow on the deck
    for (let x = x0 + 3; x <= x0 + 11; x++) B.set(x, by - 6, x < x0 + 5 ? P.snow[6] : P.snow[7]);
    for (let x = x0 + 5; x <= x0 + 9; x++) B.set(x, by - 7, P.snow[8]);
    // pull rope looping onto the snow
    for (const [dx, dy] of [[W - 2, -6], [W - 1, -7], [W, -7], [W + 1, -6], [W + 2, -5], [W + 2, -4], [W + 3, -3], [W + 4, -2], [W + 5, -1], [W + 6, -1]]) B.set(x0 + dx, by + dy, P.bone[1]);
    for (let x = x0 - 1; x <= x0 + W; x++) if (HD.bayer(x, by + 1) < 0.5) B.set(x, by + 1, P.snow[3]);
    return B.bake();
  }

  // hay bales (harvest)
  const HAY = [mix(P.gold[0], P.stone[1], 0.4), mix(P.gold[1], P.stone[2], 0.45), mix(P.gold[1], P.stone[4], 0.4), mix(P.gold[2], P.stone[4], 0.45), mix(P.gold[3], P.stone[5], 0.5)];
  function hayBale(B, x, base, w, h, seed) {
    const x0 = x - (w >> 1);
    const top = base - h;
    const td = 3; // visible top face depth
    for (let y = top; y <= base; y++)
      for (let xx = x0; xx < x0 + w; xx++) {
        const corner = (y === top || y === base) && (xx === x0 || xx === x0 + w - 1);
        if (corner) continue;
        let c;
        if (y < top + td) {
          c = y === top ? HAY[4] : HAY[3];
          if ((xx * 3 + y) % 7 === 0) c = HAY[2];
        } else {
          c = HAY[2];
          // vertical straw streaks in tidy columns
          const col = HD.hash(xx, seed, 3);
          if (col < 0.35 && (y + Math.floor(col * 20)) % 5 < 3) c = HAY[1];
          else if (col > 0.82 && (y + xx) % 4 < 2) c = HAY[3];
          if (xx === x0 || y === base) c = HAY[1];
          if (y === top + td) c = HAY[1];
          if (xx === x0 + w - 1) c = HAY[3];
        }
        // two twine bands
        if (xx === x0 + Math.round(w * 0.28) || xx === x0 + Math.round(w * 0.72)) c = y < top + td ? P.wood[3] : P.wood[2];
        B.set(xx, y, c);
      }
    // stray straws on top
    for (const [dx, dy] of [[3, -1], [4, -2], [w - 5, -1], [w - 4, -1], [8, -1]]) B.set(x0 + dx, top + dy, HAY[3]);
    for (let xx = x0 - 1; xx <= x0 + w; xx++) if (HD.bayer(xx, base + 1) < 0.65) B.set(xx, base + 1, P.soil[2]);
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

  // scarecrow (harvest): friendly burlap face, straw hat, patched plaid shirt
  const SCARE_ROWS = [
    '..........hh..........',
    '.........hHHh.........',
    '........hHHHHh........',
    '........rrrrrr........',
    '.....hhhhhhhhhhhh.....',
    '........bbbbbb........',
    '.......bBBBBBBb.......',
    '.......beBBBeBb.......',
    '.......bBBBBBBb.......',
    '.......bBsBBsBb.......',
    '........bbssbb........',
    '..........yy..........',
    'y..pppPpppppppPppp..y.',
    'yypPpPpPpPppPpPpPpPpyy',
    '.y.pppppppppppppppp.y.',
    '.........pPpPq........',
    '.........pPqqq........',
    '.........pPqqq........',
    '.........pPpPp........',
    '.........dddddd.......',
    '.........dd..dd.......',
    '.........y.ww.y.......',
    '...........ww.........',
    '...........ww.........',
    '...........ww.........',
    '...........ww.........',
    '...........ww.........',
    '...........ww.........',
    '...........ww.........',
    '...........ww.........',
    '...........ww.........',
  ];
  function bakeScarecrow() {
    const s = SL.scarecrow;
    const map = {
      h: P.gold[1],
      H: P.gold[2],
      r: P.red[2],
      b: P.wood[5],
      B: P.wood[6],
      e: P.night[0],
      s: P.wood[2],
      y: P.gold[2],
      p: P.red[2],
      P: P.plum[1],
      q: P.ice[2],
      d: P.night[4],
      w: P.wood[3],
    };
    const spr = HD.sprite(SCARE_ROWS, map);
    // the pole's right edge catches the moon
    return { cv: spr, x: s.x - 11, y: s.base - SCARE_ROWS.length + 1 };
  }

  // flower beds (spring tulips & daffodils, summer cosmos & daisies)
  function bakeBeds(ed) {
    const B = new K.Buf(0, 196, 60, 44);
    const beds = [
      { x0: 5, x1: 31, base: 222 },
      { x0: 20, x1: 52, base: 234 },
    ];
    const rnd = HD.rng(ed.id === 'spring' ? 71 : 72);
    for (const b of beds) {
      // flowers first (behind the front plank)
      const n = Math.round((b.x1 - b.x0) / 2.3);
      for (let k = 0; k < n; k++) {
        const x = b.x0 + 2 + Math.round((k / n) * (b.x1 - b.x0 - 3)) + (rnd() < 0.3 ? 1 : 0);
        const tall = ed.id === 'summer' ? 6 + Math.floor(rnd() * 5) : 4 + Math.floor(rnd() * 3);
        const y0 = b.base - 4;
        for (let j = 1; j <= tall; j++) B.set(x, y0 - j, j < 3 ? P.leaf[3] : P.leaf[4]);
        if (rnd() < 0.5) {
          B.set(x - 1, y0 - 2, P.leaf[5]);
          B.set(x + 1, y0 - 3, P.leaf[4]);
        }
        const fy = y0 - tall;
        const kind = Math.floor(rnd() * 3);
        if (ed.id === 'spring') {
          if (kind === 2) {
            // daffodil: pale star with a deep trumpet
            const c = mix(P.gold[4], P.night[9], 0.25);
            B.set(x - 1, fy, c);
            B.set(x + 1, fy, c);
            B.set(x, fy - 1, c);
            B.set(x, fy + 1, mix(P.gold[3], P.night[8], 0.3));
            B.set(x, fy, P.marigold[3]);
          } else {
            // tulip cup
            const tc = kind === 0 ? [P.red[3], P.red[5]] : [P.blossom[4], P.blossom[6]];
            B.set(x, fy, tc[0]);
            B.set(x + 1, fy, tc[0]);
            B.set(x, fy - 1, tc[1]);
            B.set(x + 1, fy - 1, tc[0]);
            B.set(x - 1, fy - 1, tc[0]);
            B.set(x + 1, fy - 2, tc[1]);
            B.set(x - 1, fy - 2, tc[0]);
          }
        } else {
          if (kind === 0) {
            // daisy
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) B.set(x + dx, fy + dy, P.bone[3]);
            B.set(x, fy, P.gold[4]);
          } else if (kind === 1) {
            // lavender spike
            for (let j = 0; j < 4; j++) B.set(x, fy - j, j % 2 ? P.violet[6] : P.violet[5]);
            B.set(x + 1, fy - 1, P.violet[5]);
          } else {
            // cosmos
            const c = [P.blossom[4], P.blossom[6]];
            B.set(x - 1, fy, c[0]);
            B.set(x + 1, fy, c[0]);
            B.set(x, fy - 1, c[1]);
            B.set(x, fy + 1, c[0]);
            B.set(x, fy, P.gold[3]);
          }
        }
      }
      // raised bed box: soil top, two planks, corner posts
      for (let x = b.x0; x <= b.x1; x++) {
        B.set(x, b.base - 4, P.soil[4]);
        B.set(x, b.base - 3, x === b.x0 || x === b.x1 ? P.wood[3] : P.wood[6]);
        B.set(x, b.base - 2, P.wood[4]);
        B.set(x, b.base - 1, x % 6 === 0 ? P.wood[2] : P.wood[5]);
        B.set(x, b.base, P.wood[2]);
        if (HD.bayer(x, b.base + 1) < 0.6) B.set(x, b.base + 1, P.soil[2]);
      }
      for (const x of [b.x0, b.x1]) {
        B.set(x, b.base - 5, P.wood[5]);
        for (let y = b.base - 4; y <= b.base; y++) B.set(x, y, x === b.x1 ? P.wood[7] : P.wood[3]);
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

  // frog on the puddle edge (spring): blinks and croaks now and then
  const FROG = { x: 334, base: 229 };
  const FROG_ROWS = {
    idle: ['..e.e..', '.gGgGg.', 'gGGGGGg', 'gglllgg', '.g...g.'],
    blink: ['..g.g..', '.gGgGg.', 'gGGGGGg', 'gglllgg', '.g...g.'],
    croak: ['..e.e..', '.gGgGg.', 'gGGGGGg', 'gLLLLLg', '.LLLLL.'],
  };
  let FROG_SPR = null;
  function frogFrame(t) {
    const ts = T.step(t, 8);
    const c = T.cycle(ts, 0, 9.5, 404);
    const ct = c.age * c.P;
    if ((ct > 3 && ct < 3.5) || (ct > 3.75 && ct < 4.25)) return 'croak';
    if (T.noise(ts, 3.1, 405) > 0.86) return 'blink';
    return 'idle';
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

  // diyas along the path and the fence posts (Festival of Lights)
  const PATH_DIYAS = [
    [196, 216],
    [244, 216],
    [194, 224],
    [248, 224],
    [186, 232],
    [214, 233],
    [178, 238],
    [204, 239],
  ];
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
    // a little woodpile beside the bonfire
    for (let k = 0; k < 3; k++) K.logShape(front, cx + 30 + k * 3, cy + 6 - k * 0, cx + 42 + k * 3, cy + 4 - k * 0, 3.6, { end: 'a', seed: 20 + k });
    K.logShape(front, cx + 33, cy + 2, cx + 45, cy + 0, 3.6, { end: 'a', seed: 24 });
    return { back: back.bake(), front: front.bake() };
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
      const back = new K.Buf(300, 180, 180, 50);
      SHRUBS_BACK.forEach((sh, i) => paintShrub(back, ed, sh, 31 + i));
      const front = new K.Buf(300, 180, 180, 50);
      SHRUBS_FRONT.forEach((sh, i) => paintShrub(front, ed, sh, 41 + i));
      return {
        fence: bakeFenceGarden(ed),
        back: back.bake(),
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
    };
    FROG_SPR = {};
    const fm = { e: P.bone[2], g: mix(P.leaf[4], P.vine[3], 0.5), G: P.leaf[6], l: P.leaf[2], L: mix(P.leaf[7], P.bone[3], 0.45) };
    for (const k in FROG_ROWS) FROG_SPR[k] = HD.sprite(FROG_ROWS[k], fm);
    redHooks = RED_LANTERNS.map((r) => {
      const h = findHook(r.tx, r.ty, 10, r.size === 'big' ? 16 : 10) || { x: r.tx, y: r.ty };
      return { ...r, x: h.x, y: h.y };
    });
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
    const G = K.TREE.groups;
    for (let gi = 0; gi < G.length; gi++) blit(g, G[gi][K.swayState(t, gi)]);
    if (A.foliage) blit(g, A.foliage);
    if (A.groups) for (let gi = 0; gi < 7; gi++) blit(g, A.groups[gi][K.swayState(t, gi)]);
  };

  S.treeDress = function (g, t) {
    const ed = HD.edition;
    if (HD.tag('tree-red-lanterns')) {
      redHooks.forEach((h, i) => FX.lantern(g, h.x, h.y, t, 900 + i * 7, 'red', { len: h.len, size: h.size, amp: 0.1 }));
    }
    if (HD.tag('tree-fairy-lights')) {
      const ts = T.step(t, 6);
      for (const p of fairy.pts) {
        const ramp = P.bulb[FAIRY_COLS[p.k % FAIRY_COLS.length]];
        const n = T.noise(ts, 2.8, 1300 + p.k);
        const lv = n > 0.72 ? 2 : n < 0.18 ? 0 : 1;
        g.em.px(p.x, p.y, ramp[lv]);
        if (p.big && lv === 2) g.em.px(p.x, p.y + 1, ramp[1]);
      }
    }
    if (HD.tag('hammock')) {
      blit(g, gardenArt().ham);
      drawHammock(g, t);
    }
    void ed;
  };

  S.garden = function (g, t) {
    const A = gardenArt();
    blit(g, A.back);
    blit(g, A.fence);
    blit(g, A.bird);
    if (HD.tag('diyas-yard')) FENCE_DIYAS.forEach(([x, y], i) => FX.diya(g, x + 3, y, t, 500 + i));
    if (HD.tag('birdhouse')) {
      // a little bird on the birdhouse perch: looks around, ducks in now and then
      const ts = T.step(t, 8);
      const c = T.cycle(ts, 0, 23, 811);
      const ct = c.age * c.P;
      if (ct < 15) {
        const bx = BIRD.x + 3;
        const by = BIRD.base - 22 - 3;
        const look = T.noise(ts, 4.5, 812) > 0.55;
        const peck = ct > 6 && ct < 6.6 && (ct * 4) % 1 < 0.5;
        g.px(bx, by, P.night[5]);
        g.px(bx + 1, by, P.night[6]);
        g.px(bx + 2, by, P.night[6]);
        g.px(bx, by - 1, P.night[5]);
        g.px(bx + 1, by - 1, P.red[3]);
        g.px(bx + 1, by - 2 + (peck ? 1 : 0), P.night[6]);
        g.px(bx + (look ? 0 : 2), by - 2 + (peck ? 1 : 0), P.night[6]);
        g.px(bx + (look ? -1 : 3), by - 2 + (peck ? 1 : 0), P.gold[3]);
        g.px(bx - 1, by - 1, P.night[4]);
        g.px(bx - 2, by - 2, P.night[4]);
      }
    }
  };

  S.gardenFront = function (g, t) {
    const A = gardenArt();
    blit(g, A.bench);
    blit(g, A.front);
    if (HD.tag('sled')) blit(g, lazy('sled', bakeSled));
    if (HD.tag('hay-bales')) blit(g, lazy('hay', bakeHay));
    if (HD.tag('scarecrow')) blit(g, lazy('scare', bakeScarecrow));
    if (A.snowman) {
      blit(g, A.snowman);
      drawScarf(g, t);
    }
    if (HD.tag('frog')) {
      const spr = FROG_SPR[frogFrame(t)];
      g.sprite(spr, FROG.x - 3, FROG.base - spr.height + 1);
    }
  };

  S.string = function (g, t) {
    if (!HD.tag('paper-lantern-string')) return;
    const kind = HD.edition.id === 'harvest' ? 'harvest' : 'paper';
    for (const [x, y] of STRING.pts) g.px(x, y, P.night[1]);
    STRING.lan.forEach((l) => FX.lantern(g, l.x, l.y, t, l.seed, kind, { len: 2, size: l.size, amp: 0.08 }));
  };

  S.yardBack = function (g, t) {
    if (HD.tag('flower-beds')) blit(g, yardArt.beds());
    if (HD.tag('eggs')) blit(g, lazy('eggs', bakeEggs));
    void t;
  };

  S.yardMid = function (g, t) {
    if (HD.tag('harvest-pumpkins')) blit(g, lazy('harvest', bakeHarvestPumpkins));
    if (HD.tag('diyas-yard')) PATH_DIYAS.forEach(([x, y], i) => FX.diya(g, x, y, t, 520 + i));
  };

  S.yardFront = function () {};

  S.bonfireBack = function (g) {
    blit(g, lazy('bonfire', bakeBonfire).back);
  };
  S.bonfireFront = function (g) {
    blit(g, lazy('bonfire', bakeBonfire).front);
  };

  // ------------------------------------------------------------------
  // lights (aggregated)
  // ------------------------------------------------------------------
  S.lights = function (t, Lt) {
    if (HD.tag('tree-red-lanterns') && redHooks) {
      redHooks.forEach((h, i) => FX.lanternLight(Lt, h.x, h.y, t, 900 + i * 7, 'red', { len: h.len, size: h.size, amp: 0.1, i: h.size === 'big' ? 0.34 : 0.2 }));
    }
    if (HD.tag('tree-fairy-lights') && fairy) {
      for (const gr of fairy.groups) Lt.add({ x: gr.x, y: gr.y, r: 22 + gr.n * 0.4, color: HD.LIGHT.bulb.gold, i: 0.14 + gr.n * 0.004, bands: 4, halo: { r: 12, a: 0.05 } });
    }
    if (HD.tag('paper-lantern-string') && STRING) {
      const kind = HD.edition.id === 'harvest' ? 'harvest' : 'paper';
      STRING.lan.forEach((l) => FX.lanternLight(Lt, l.x, l.y, t, l.seed, kind, { len: 2, size: l.size, amp: 0.08 }));
    }
    if (HD.tag('diyas-yard')) {
      // one light per pair of diyas
      for (let i = 0; i < PATH_DIYAS.length; i += 2) {
        const a = PATH_DIYAS[i];
        const b = PATH_DIYAS[i + 1];
        FX.diyaLight(Lt, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, t, 520 + i, 26, 0.36);
      }
      for (let i = 0; i < FENCE_DIYAS.length; i += 3) {
        const a = FENCE_DIYAS[i];
        const b = FENCE_DIYAS[Math.min(FENCE_DIYAS.length - 1, i + 2)];
        FX.diyaLight(Lt, (a[0] + b[0]) / 2 + 3, a[1], t, 500 + i, 30, 0.3);
      }
    }
  };
})();
