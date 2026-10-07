/*
 * house-seasons.js - seasonal dressing of the Rainy Hollow cottage.
 *
 * house.js bakes the cottage and its interiors once per edition (HD.perEdition)
 * and calls into this file (HD.houseKit.seasons) for every edition except
 * Halloween, which keeps its original code path pixel for pixel:
 *
 *   omit(ed)               interior pieces of the Halloween dressing to leave out
 *   decorateHouse(R, ed)   roof/turret/porch/sill snow, icicles, the lantern-string hook
 *   decorateInterior(I,ed) static decorations drawn over the glass (window
 *                          boxes, garlands, wreaths, banners, menorah, tree...)
 *   winCfg / winBoost / glass   per-edition window glow (party, menorah window)
 *   drawInside / drawFront      animated bits (flames, bulbs, lanterns, diyas)
 *   lights(t, L)                every decoration light (aggregated)
 *
 * The black cat is drawn by house.js and is identical in every edition;
 * nothing here paints over its window.
 */
(function () {
  'use strict';
  const HD = window.HD;
  const K = HD.houseKit;
  if (!K) return;
  const P = HD.PAL;
  const T = HD.time;
  const FE = HD.festive;
  const LH = HD.layout.house;
  const LIGHT = HD.LIGHT;
  const clamp = HD.clamp;
  const RND = Math.round;

  const S = P.stone;
  const W = P.wood;
  const A = P.amber;
  const F = P.fire;
  const SN = P.snow;
  const IC = P.ice;
  const LF = P.leaf;
  const RD = P.red;
  const GD = P.gold;
  const MG = P.marigold;
  const BL = P.blossom;
  const AU = P.autumn;
  const BN = P.bone;
  const V = P.violet;
  const TG = K.TG;
  const HOLE = K.HOLE;

  const has = (ed, t) => ed.tagSet.has(t);
  const WIN = {};
  K.WINS.forEach((w, i) => {
    WIN[w.w.id] = w;
    w.index = i;
  });
  const RF = LH.roof;
  const TU = LH.turret;
  const CHM = LH.chimney;
  const PO = LH.porch;
  const STP = LH.steps;
  const DX0 = K.DX0;
  const DX1 = K.DX1;
  const DY0 = K.DY0;

  /** smooth 1D bump noise in [0,1] (build time only) */
  function bump(x, seed, period) {
    const u = x / period;
    const i = Math.floor(u);
    const f = u - i;
    const a = HD.hash(i, seed, 5);
    const b = HD.hash(i + 1, seed, 5);
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  }

  // ===================================================================
  // SNOW (baked into the house raster)
  // ===================================================================
  const ICICLES = []; // filled per bake, consumed immediately
  function icicleRun(R, xa, xb, yAt, seed, maxLen, density) {
    let last = -9;
    for (let x = xa; x <= xb; x++) {
      const y = yAt(x);
      if (y === null) continue;
      const h = HD.hash(x, seed, 11);
      if (h > density || x - last < 2) continue;
      last = x;
      const len = 1 + Math.floor(Math.pow(HD.hash(x, seed, 12), 2.2) * maxLen);
      for (let k = 0; k < len; k++) {
        const yy = y + k;
        const cur = R.get(x, yy);
        if (cur === HOLE) break;
        const c = k === len - 1 ? IC[5] : k === 0 ? IC[4] : k === len - 2 ? IC[4] : IC[3];
        R.set(x, yy, c, TG.gutter);
      }
      if (len >= 4) R.set(x + 1, y, IC[2], TG.gutter);
    }
  }

  function snowRoof(R, heavy) {
    const rows = K.courses(21, RF.x0 - 4, RF.x1 + 4, 6, 10);
    const x0 = RF.x0 - 2;
    const x1 = RF.x1 + 2;
    const lipBottom = new Map();
    // --- slope -----------------------------------------------------
    for (let y = RF.peakY - 5; y <= RF.eave + 2; y++)
      for (let x = x0; x <= x1; x++) {
        const tg = R.tg(x, y);
        if (tg !== TG.roof && tg !== TG.moss) continue;
        const right = x >= RF.peakX;
        if (heavy) {
          // creases between soft drifts, curving gently across the slope
          const ph = Math.round(2.2 * Math.sin(x * 0.11 + (right ? 1.3 : 0)) + 1.4 * Math.sin(x * 0.29));
          const crease = (((y + ph) % 9) + 9) % 9 === 0;
          let c = right ? SN[6] : SN[5];
          if (crease) c = right ? SN[5] : SN[4];
          const up = R.tg(x, y - 1);
          if (up !== TG.roof && up !== TG.moss) c = SN[7];
          if (R.get(x - 1, y) === null) c = SN[4];
          if (R.get(x + 1, y) === null) c = SN[8];
          R.set(x, y, c, TG.roof);
        } else {
          // a dusting: snow resting on the lip of every other slate
          const dip = K.roofDip(x);
          const gy = RF.eave - 1 + (dip > 1.6 ? 1 : 0);
          if (y >= gy) continue;
          const rc = RF.eave - 2 + Math.round(dip) - y;
          const rr = Math.floor(rc / 4);
          const v = ((rc % 4) + 4) % 4;
          const js = rows(rr);
          const k = K.seg(js, x);
          const nxt = k + 1 < js.length ? js[k + 1] : x + 99;
          if (x === js[k]) continue;
          const dens = 0.42 + 0.25 * (1 - (RF.eave - y) / (RF.eave - RF.peakY));
          if (HD.hash(rr, k, 77) > dens) continue;
          if (v === 0) R.set(x, y, right ? SN[6] : SN[5], TG.roof);
          else if (v === 1 && x > js[k] + 1 && x < nxt - 2) R.set(x, y, right ? SN[5] : SN[4], TG.roof);
        }
      }
    // --- ridge crest + eave lip ------------------------------------
    for (let x = x0; x <= x1; x++) {
      // top edge: the ridge line gets a bright crest
      let ytop = null;
      for (let y = RF.peakY - 5; y <= RF.eave; y++) {
        const tg = R.tg(x, y);
        if (tg === TG.roof || tg === TG.moss) {
          ytop = y;
          break;
        }
      }
      if (ytop !== null && heavy && R.get(x, ytop - 1) === null) R.set(x, ytop - 1, x >= RF.peakX ? SN[7] : SN[6], TG.roof);
      else if (ytop !== null && !heavy) R.set(x, ytop, x >= RF.peakX ? SN[6] : SN[5], TG.roof);
      // the gutter row
      let yb = null;
      for (let y = RF.eave + 2; y >= RF.eave - 3; y--) {
        if (R.tg(x, y) === TG.gutter) {
          yb = y;
          break;
        }
      }
      if (yb === null) continue;
      if (heavy) {
        for (let y = yb - 2; y <= yb; y++) if (R.tg(x, y) === TG.gutter || R.tg(x, y) === TG.roof) R.set(x, y, SN[6], TG.roof);
        const lip = bump(x, 3, 6) > 0.45 ? 2 : 1;
        for (let d = 1; d <= lip; d++) R.set(x, yb + d, d === lip ? SN[3] : SN[5], TG.roof);
        lipBottom.set(x, yb + lip + 1);
      } else {
        if (bump(x, 4, 5) > 0.3) R.set(x, yb - 1, SN[6], TG.roof);
        lipBottom.set(x, yb + 1);
      }
    }
    if (heavy) icicleRun(R, RF.x0 + 1, RF.x1 - 2, (x) => (lipBottom.has(x) ? lipBottom.get(x) : null), 41, 6, 0.42);
  }

  const CONE_TILE = ['BBBBBB', 'BBBBBB', 'OBHHBO', 'BOOOOB'];
  function snowCone(R, heavy) {
    const lip = new Map();
    for (let y = TU.peakY; y <= TU.top + 1; y++) {
      const hw = K.coneHW(Math.min(y, TU.top));
      const cx = K.coneCX(y);
      const xl = Math.round(cx - hw);
      const xr = Math.round(cx + hw);
      for (let x = xl; x <= xr; x++) {
        if (R.tg(x, y) !== TG.cone) continue;
        const u = clamp((x - cx) / Math.max(hw, 0.5), -1, 1);
        const ybot = TU.top + (Math.abs(u) > 0.8 ? 1 : 0);
        const q = (u + 0.35) / 0.55 + (K.chk(x, y) ? 0.15 : -0.15);
        const sh = q < 0 ? -1 : q < 1 ? 0 : 1;
        let ch;
        if (y === ybot) ch = 'L';
        else if (y >= ybot - 2) ch = 'T';
        else {
          const ry = ybot - 3 - y;
          const rr = Math.floor(ry / 4);
          const v = 3 - (ry % 4);
          const s = Math.asin(u) * hw;
          const pos = s / 6 + rr * 0.5 + 0.25;
          const col = Math.floor((pos - Math.floor(pos)) * 6);
          ch = CONE_TILE[v][col];
          if (!heavy && v === 2 && (col === 1 || col === 4)) ch = 'h';
        }
        const edgeR = R.get(x + 1, y) === null;
        if (heavy) {
          let c;
          if (ch === 'L') c = SN[3];
          else if (ch === 'T') c = SN[6 + (sh > 0 ? 1 : 0)];
          else if (ch === 'O') c = SN[4 + Math.max(0, sh)];
          else if (ch === 'H') c = SN[7];
          else c = SN[5 + Math.max(0, sh)];
          if (edgeR) c = SN[8];
          if (R.get(x - 1, y) === null && ch !== 'L') c = SN[4];
          R.set(x, y, c, TG.cone);
          if (ch === 'L') lip.set(x, y);
        } else {
          if (ch === 'H') R.set(x, y, sh > 0 ? SN[7] : SN[6], TG.cone);
          else if (ch === 'h' && sh >= 0) R.set(x, y, SN[5], TG.cone);
          else if (ch === 'T' && y === ybot - 1 && bump(x, 8, 4) > 0.35) R.set(x, y, SN[6], TG.cone);
        }
      }
    }
    // snow cap on the finial knob
    const tx = Math.round(K.coneCX(TU.peakY));
    R.set(tx, TU.peakY - 2, SN[7], TG.fin);
    if (heavy) {
      R.hl(tx - 1, tx + 1, TU.peakY - 1, SN[6], TG.fin);
      // droopy brim and icicles over the turret wall
      for (const [x, y] of lip) if (bump(x, 9, 4) > 0.5) R.set(x, y + 1, SN[3], TG.cone);
      icicleRun(R, TU.x0 + 1, TU.x1 - 2, (x) => (lip.has(x) ? lip.get(x) + (bump(x, 9, 4) > 0.5 ? 2 : 1) : null), 43, 5, 0.45);
    }
  }

  function snowChimney(R, heavy) {
    const xa = CHM.x0;
    const xb = CHM.x1 + 1;
    const top = CHM.top;
    if (heavy) {
      R.hl(xa, xb, top - 1, SN[6], TG.chim);
      R.hl(xa + 1, xb - 1, top - 2, SN[6], TG.chim);
      R.hl(xa + 3, xb - 2, top - 3, SN[7], TG.chim);
      R.set(xa, top - 1, SN[4], TG.chim);
      R.set(xb, top - 1, SN[7], TG.chim);
      R.set(xa + 1, top - 2, SN[7], TG.chim);
      R.set(xa + 3, top, SN[5], TG.chim);
      R.set(xa + 4, top, SN[4], TG.chim);
    } else {
      R.hl(xa + 1, xb - 2, top - 1, SN[6], TG.chim);
      R.set(xb - 1, top - 1, SN[5], TG.chim);
    }
  }

  function snowPorch(R, heavy) {
    const x0 = PO.x0;
    const x1 = PO.x1 - 1;
    const y0 = PO.roofY;
    if (heavy) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const e = Math.min(x - x0, x1 - x);
        const h = e < 1 ? 1 : e < 4 ? 2 : 2 + (bump(x, 21, 6) > 0.5 ? 1 : 0);
        for (let k = 0; k < h; k++) R.set(x, y0 - 1 - k, k === h - 1 ? SN[7] : SN[6], TG.porch);
        R.set(x, y0, SN[5], TG.porch);
        if (bump(x, 22, 5) > 0.55) R.set(x, y0 + 1, SN[4], TG.porch);
      }
      R.set(x0 - 1, y0 - 1, SN[4], TG.porch);
      icicleRun(R, x0 + 2, x1 - 2, (x) => (x > x0 + 10 && x < x1 - 9 ? y0 + 9 : y0 + 8), 47, 4, 0.36);
    } else {
      for (let x = x0 + 1; x <= x1 - 1; x++) if (bump(x, 23, 4) > 0.25) R.set(x, y0, SN[6], TG.porch);
      for (let x = x0 + 4; x <= x1 - 4; x++) if (bump(x, 24, 5) > 0.55) R.set(x, y0 - 1, SN[6], TG.porch);
    }
  }

  function snowSills(R, heavy) {
    for (const win of K.WINS) {
      const w = win.w;
      if (w.round) continue;
      const bx0 = w.x - 3;
      const bx1 = w.x + w.w + 2;
      const sy = w.y + w.h + 2;
      if (heavy) {
        for (let x = bx0; x <= bx1; x++) {
          const mid = x > bx0 + 1 && x < bx1 - 1;
          R.set(x, sy - 1, mid ? SN[6] : SN[5], TG.frame);
          if (mid && bump(x, w.x, 4) > 0.4) {
            if (R.get(x, sy - 2) !== HOLE) R.set(x, sy - 2, SN[7], TG.frame);
          }
        }
        R.set(bx1, sy - 1, SN[7], TG.frame);
        // snow on the lintel / keystone
        if (!win.c.arch) {
          for (let x = bx0; x <= bx1; x++) R.set(x, w.y - 5, x === bx0 ? SN[5] : SN[6], TG.frame);
          for (let x = bx0 + 2; x <= bx1 - 3; x++) if (bump(x, w.y, 5) > 0.6) R.set(x, w.y - 6, SN[7], TG.frame);
        } else {
          const kx = Math.round(w.x + w.w / 2 - 0.5);
          R.hl(kx - 1, kx + 1, w.y - 5, SN[6], TG.frame);
          R.set(kx, w.y - 6, SN[7], TG.frame);
        }
      } else {
        for (let x = bx0 + 1; x <= bx1 - 1; x++) if (bump(x, w.x + 3, 4) > 0.3) R.set(x, sy - 1, SN[5], TG.frame);
      }
    }
  }

  function snowFooting(R, heavy) {
    const spans = [
      [LH.body.x0 - 2, PO.postL - 3],
      [PO.postR + 2, TU.x1 - 1],
    ];
    for (const [xa, xb] of spans)
      for (let x = xa; x <= xb; x++) {
        const b = bump(x, 31, heavy ? 7 : 5);
        const h = heavy ? 1 + Math.round(b * 3) : b > 0.62 ? 1 : 0;
        for (let k = 0; k < h; k++) {
          const y = 205 - k;
          if (R.get(x, y) === null || R.get(x, y) === HOLE) continue;
          R.set(x, y, k === h - 1 ? SN[6] : SN[5], TG.found);
        }
      }
    if (heavy) {
      // swept steps: snow only at the ends
      for (const [xa, xb] of [
        [STP.x0 + 2, STP.x0 + 4],
        [STP.x1 - 5, STP.x1 - 3],
      ]) {
        R.hl(xa, xb, 206, SN[6], TG.steps);
        R.hl(xa - 1, xb + 1, 205, SN[7], TG.steps);
      }
      for (const [xa, xb] of [
        [STP.x0, STP.x0 + 2],
        [STP.x1 - 3, STP.x1 - 1],
      ]) {
        R.hl(xa, xb, 209, SN[6], TG.steps);
        R.hl(xa, xb, 208, SN[7], TG.steps);
      }
    }
  }

  function snowAll(R, heavy) {
    snowRoof(R, heavy);
    snowCone(R, heavy);
    snowChimney(R, heavy);
    snowPorch(R, heavy);
    snowSills(R, heavy);
    snowFooting(R, heavy);
    // ridge finial cap
    R.set(RF.peakX, RF.peakY - 5, SN[7], TG.roof);
  }

  /** small iron bracket on the turret where the lantern string starts */
  const HOOK = HD.layout.seasonal.lanternString.from;
  function paintHook(R) {
    const [hx, hy] = HOOK;
    R.vl(hx - 2, hy - 2, hy + 1, S[1], TG.iron);
    R.set(hx - 2, hy - 1, S[3], TG.iron);
    R.set(hx - 1, hy - 1, S[3], TG.iron);
    R.set(hx, hy - 1, S[4], TG.iron);
    R.set(hx + 1, hy, S[3], TG.iron);
    R.set(hx, hy + 1, S[2], TG.iron);
    R.set(hx, hy, S[1], TG.iron);
  }

  // ===================================================================
  // STATIC DECORATIONS (baked into the per-edition overlay = interior raster)
  // ===================================================================
  const stamp = (I, rows, x, y, map) => I.rows(rows, Math.round(x), Math.round(y), map, 0);

  // --- door wreaths (9 x 10, centred on the door) ---------------------
  const WREATH = ['..lmmml..', '.lmdmmmd.', 'lmd...mdd', 'lm.....dd', 'mm.....dd', 'md.....dd', '.md...dd.', '..mdddd..'];
  function wreath(I, kind) {
    const x = DX0 + 3;
    const y = DY0 + 8;
    let map;
    if (kind === 'evergreen') map = { l: LF[5], m: LF[3], d: LF[1] };
    else if (kind === 'flower') map = { l: LF[6], m: LF[4], d: LF[2] };
    else map = { l: AU[6], m: AU[4], d: AU[2] };
    stamp(I, WREATH, x, y, map);
    const put = (lx, ly, c) => I.set(x + lx, y + ly, c, 0);
    if (kind === 'evergreen') {
      // holly berries and a red bow with ribbon tails
      for (const [lx, ly] of [
        [1, 2],
        [7, 3],
        [2, 6],
        [6, 1],
      ])
        put(lx, ly, RD[5]);
      stamp(I, ['.RrR.', 'RRrRR', '.R.R.', 'R...R'], x + 2, y + 6, { R: RD[4], r: RD[2] });
    } else if (kind === 'flower') {
      const fl = [
        [2, 0, BL[6]],
        [6, 1, GD[5]],
        [0, 3, BN[4]],
        [8, 4, BL[6]],
        [1, 6, GD[5]],
        [7, 6, BN[4]],
        [4, 7, BL[5]],
        [4, 0, BN[4]],
      ];
      for (const [lx, ly, c] of fl) put(lx, ly, c);
      stamp(I, ['.b.b.', '..b..', '.b.b.'], x + 2, y + 7, { b: P.spirit[3] });
    } else {
      // harvest leaves, two acorns and a twine bow
      for (const [lx, ly, c] of [
        [1, 1, GD[4]],
        [7, 2, RD[4]],
        [0, 4, GD[4]],
        [8, 5, AU[7]],
        [2, 7, RD[4]],
        [5, 0, AU[7]],
      ])
        put(lx, ly, c);
      put(6, 7, W[5]);
      put(6, 8, W[3]);
      put(3, 1, W[5]);
      stamp(I, ['.t.t.', '..t..', '.t.t.'], x + 2, y + 7, { t: GD[3] });
    }
  }

  // --- garlands that sag between anchors ----------------------------
  function swagY(x, xs, y, sag) {
    for (let i = 0; i + 1 < xs.length; i++) {
      if (x >= xs[i] && x <= xs[i + 1]) {
        const u = (x - xs[i]) / Math.max(1, xs[i + 1] - xs[i]);
        return y + Math.round(sag * Math.sin(Math.PI * u));
      }
    }
    return y;
  }
  /** marigold toran: beaded swags with pendant strands ending in a mango leaf */
  function toran(I, x0, x1, y, n, sag) {
    const xs = [];
    for (let i = 0; i <= n; i++) xs.push(Math.round(x0 + ((x1 - x0) * i) / n));
    for (let x = x0; x <= x1; x++) {
      const yy = swagY(x, xs, y, sag);
      const k = (x + y) % 3;
      I.set(x, yy, k === 0 ? MG[5] : MG[4], 0);
      I.set(x, yy + 1, k === 1 ? MG[2] : MG[3], 0);
    }
    for (let i = 0; i <= n; i++) {
      const x = xs[i];
      const len = i === 0 || i === n ? 3 : 4;
      for (let k = 0; k < len; k++) I.set(x, y + 1 + k, k % 2 ? MG[3] : MG[5], 0);
      I.set(x, y + 1 + len, LF[5], 0);
      I.set(x, y + 2 + len, LF[3], 0);
    }
  }
  /** summer garland: leafy swag with white and pink flowers */
  function flowerGarland(I, x0, x1, y, n, sag) {
    const xs = [];
    for (let i = 0; i <= n; i++) xs.push(Math.round(x0 + ((x1 - x0) * i) / n));
    for (let x = x0; x <= x1; x++) {
      const yy = swagY(x, xs, y, sag);
      I.set(x, yy, (x & 1) === 0 ? LF[5] : LF[4], 0);
      I.set(x, yy + 1, (x & 1) === 0 ? LF[2] : LF[3], 0);
      if (x % 3 === 0) I.set(x, yy - 1, LF[4], 0);
      if (x % 5 === 1) I.set(x, yy, x % 10 === 1 ? BN[4] : BL[6], 0);
    }
    for (const x of xs) {
      I.set(x, y + 2, LF[3], 0);
      I.set(x, y + 3, LF[4], 0);
      I.set(x, y, GD[5], 0);
    }
  }

  // --- window boxes (planter under the ground-floor sills) -----------
  function windowBox(I, win, flowers, seed) {
    const w = win.w;
    const bx0 = w.x - 2;
    const bx1 = w.x + w.w + 1;
    const top = w.y + w.h + 3; // just under the sill board
    for (let x = bx0; x <= bx1; x++) {
      I.set(x, top, W[5], 0);
      for (let y = top + 1; y <= top + 3; y++) I.set(x, y, (y - top) % 2 ? W[4] : W[3], 0);
      I.set(x, top + 4, W[2], 0);
    }
    for (let y = top; y <= top + 4; y++) {
      I.set(bx0, y, W[3], 0);
      I.set(bx1, y, W[2], 0);
    }
    // foliage mound rising in front of the lower panes, trailing ivy over the box front
    for (let x = bx0 + 1; x <= bx1 - 1; x++) {
      const h = 2 + Math.round(bump(x, seed, 3) * 3);
      for (let k = 1; k <= h; k++) {
        const y = top - k;
        const c = k === h ? LF[5] : (x + k) % 3 === 0 ? LF[2] : LF[3];
        I.set(x, y, c, 0);
      }
      if (HD.hash(x, seed, 3) < 0.22) {
        const dl = 1 + Math.floor(HD.hash(x, seed, 4) * 3);
        for (let k = 1; k <= dl; k++) I.set(x, top + k, k === dl ? LF[4] : LF[3], 0);
      }
    }
    // flower heads
    let i = 0;
    for (let x = bx0 + 2; x <= bx1 - 2; x += 3 + (HD.hash(x, seed, 7) < 0.4 ? 1 : 0)) {
      const h = 2 + Math.round(bump(x, seed, 3) * 3);
      const fy = top - h - 1 - (HD.hash(x, seed, 8) < 0.5 ? 1 : 0);
      const kind = flowers[i++ % flowers.length];
      if (kind.tall) {
        I.set(x, fy + 1, LF[4], 0);
        I.set(x, fy + 2, LF[4], 0);
      }
      const c = kind.c;
      if (kind.shape === 'tulip') {
        I.set(x - 1, fy - 1, c[1], 0);
        I.set(x + 1, fy - 1, c[1], 0);
        I.set(x - 1, fy, c[0], 0);
        I.set(x, fy, c[1], 0);
        I.set(x + 1, fy, c[0], 0);
        I.set(x, fy - 1, c[2], 0);
      } else if (kind.shape === 'star') {
        I.set(x, fy - 1, c[1], 0);
        I.set(x - 1, fy, c[1], 0);
        I.set(x + 1, fy, c[0], 0);
        I.set(x, fy + 1, c[0], 0);
        I.set(x, fy, c[2], 0);
      } else {
        I.set(x, fy, c[1], 0);
        I.set(x + 1, fy, c[0], 0);
        I.set(x, fy - 1, c[2], 0);
        I.set(x + 1, fy - 1, c[1], 0);
      }
    }
  }

  // --- interiors (silhouettes on the glass, in local window coords) ---
  function putW(I, win, lx, ly, c) {
    if (K.winInside(win, win.gx + lx, win.gy + ly, 0)) I.set(win.gx + lx, win.gy + ly, c, 0);
  }
  function rowsW(I, win, list, lx, ly, map) {
    for (let y = 0; y < list.length; y++)
      for (let x = 0; x < list[y].length; x++) {
        const ch = list[y][x];
        if (ch !== '.' && ch !== ' ' && map[ch]) putW(I, win, lx + x, ly + y, map[ch]);
      }
  }

  const ROSETTE = ['.r.r.', 'rrrrr', '.r.r.', 'rrrrr', '.r.r.'];
  const ROSETTE2 = ['..r..', '.rrr.', 'rr.rr', '.rrr.', '..r..'];

  // menorah, local coords in ground-left (18 x 22), centred on lx 8
  const MEN_X = [0, 2, 4, 6, 8, 10, 12, 14, 16];
  function menorah(I, win) {
    const g1 = GD[1];
    const g2 = GD[2];
    for (let lx = 6; lx <= 10; lx++) putW(I, win, lx, 21, lx === 6 ? g1 : g2);
    for (let lx = 7; lx <= 9; lx++) putW(I, win, lx, 20, g1);
    for (let ly = 14; ly <= 19; ly++) putW(I, win, 8, ly, ly === 14 ? g2 : g1);
    for (let lx = 0; lx <= 16; lx++) putW(I, win, lx, 17, g1);
    for (const lx of MEN_X) {
      if (lx === 8) continue;
      putW(I, win, lx, 16, g2);
      putW(I, win, lx, 15, BN[3]);
      putW(I, win, lx, 14, BN[4]);
    }
    putW(I, win, 8, 13, BN[3]);
    putW(I, win, 8, 12, BN[4]);
  }

  // decorated tree, local coords in ground-right (16 x 22)
  const TREE = ['...gg...', '..gGgg..', '.gGgggg.', '..gggg..', '.gGgggg.', 'gGgggggg', '.gggggg.', 'gGgggggg', 'gggggggg', '...tt...', '..pppp..'];
  const TREE_X = 4;
  const TREE_Y = 11;
  const TREE_BULBS = [
    [4, 1, 'red'],
    [2, 3, 'gold'],
    [5, 4, 'blue'],
    [1, 6, 'green'],
    [6, 6, 'red'],
    [3, 7, 'gold'],
    [0, 8, 'blue'],
    [5, 8, 'gold'],
    [7, 9, 'green'],
    [2, 9, 'red'],
  ];
  function xmasTree(I, win) {
    rowsW(I, win, TREE, TREE_X, TREE_Y, { g: LF[1], G: LF[3], t: W[1], p: RD[2] });
  }

  function decorateInterior(I, ed) {
    const gl = WIN['ground-left'];
    const gr = WIN['ground-right'];
    const ul = WIN['upper-left'];
    const tl = WIN['turret-lower'];
    const tu = WIN['turret-upper'];
    // ---------------- windows ----------------
    if (has(ed, 'tangerines')) {
      // bowl of tangerines with a couple of leaves on the inner sill
      rowsW(I, gr, ['....l.....', '...oOo....', '..oOooOo..', '.oOoOooOo.', 'bbbbbbbbbb', '.bbbbbbbb.', '..bbbbbb..'], 3, gr.gh - 7, {
        o: P.pumpkin[4],
        O: P.pumpkin[5],
        l: LF[5],
        b: A[0],
      });
    }
    if (has(ed, 'paper-cuts')) {
      const rc = { r: RD[4] };
      rowsW(I, ul, ROSETTE, 0, 2, rc);
      rowsW(I, ul, ROSETTE2, 8, 2, rc);
      rowsW(I, gl, ROSETTE2, 2, 4, rc);
      rowsW(I, gl, ROSETTE, 11, 4, rc);
      rowsW(I, tl, ROSETTE2, 3, 2, rc);
    }
    if (has(ed, 'seedlings')) {
      for (const [lx, h] of [
        [1, 3],
        [6, 4],
        [11, 2],
      ]) {
        rowsW(I, gr, ['ppp', 'ppp', '.p.'], lx, gr.gh - 3, { p: A[0] });
        for (let k = 1; k <= h; k++) putW(I, gr, lx + 1, gr.gh - 3 - k, LF[4]);
        putW(I, gr, lx, gr.gh - 3 - h, LF[6]);
        putW(I, gr, lx + 2, gr.gh - 2 - h, LF[5]);
      }
      // a watering can on the turret sill
      rowsW(I, tl, ['..h..', 'cccc.', 'ccccs', 'cccc.'], 0, tl.gh - 4, { c: A[0], h: A[1], s: A[0] });
    }
    if (has(ed, 'pie-sill')) {
      // an uncarved pumpkin on the inner sill instead of a jack-o'-lantern
      rowsW(I, gr, ['...s...', '.ppppp.', 'ppppppp', 'ppppppp', '.ppppp.'], 4, gr.gh - 5, { s: LF[3], p: A[0] });
      // the pie cooling on the outside sill (lattice crust in a tin)
      const w = gl.w;
      const px = w.x + 6;
      const py = w.y + w.h + 1;
      stamp(I, ['.cLcLc.', 'LcLcLcL', 'ddddddd', '.eeeee.'], px, py - 3, { c: AU[6], L: GD[4], d: S[5], e: S[3] });
    }
    if (has(ed, 'party-windows')) {
      // balloons and streamers as silhouettes
      const bal = ['.bb.', 'bbbb', 'bbbb', '.bb.', '..s.', '.s..', '..s.'];
      rowsW(I, gr, bal, 3, 9, { b: A[0], s: A[1] });
      rowsW(I, gr, bal, 8, 12, { b: A[1], s: A[1] });
      rowsW(I, gr, ['.bb.', 'bbbb', 'bbbb', '.bb.', '.s..', '..s.'], 5, 15, { b: A[0], s: A[1] });
      for (let lx = 0; lx < ul.gw; lx++) {
        putW(I, ul, lx, 2 + ((lx >> 1) & 1), A[1]);
        if (lx % 4 === 1) putW(I, ul, lx, 4 + ((lx >> 2) & 1), A[1]);
      }
      for (let lx = 0; lx < gl.gw; lx++) putW(I, gl, lx, 4 + ((lx >> 1) % 3 === 0 ? 1 : 0), A[0]);
      for (const lx of [3, 13]) rowsW(I, gl, ['s', 's', '.', 's'], lx, 5, { s: A[0] });
      rowsW(I, tl, ['.bb.', 'bbbb', 'bbbb', '.bb.', '..s.', '.s..'], 4, 2, { b: A[0], s: A[1] });
      for (let lx = 0; lx < tu.gw; lx += 3) putW(I, tu, lx, 9 + (lx % 2), A[1]);
    }
    if (has(ed, 'menorah')) menorah(I, gl);
    if (has(ed, 'xmas-tree')) xmasTree(I, gr);
    if (ed.id === 'summer') {
      // a jug of meadow flowers where the jack-o'-lantern sat
      rowsW(I, gr, ['.f.f.f.', 'flflflf', '.l.l.l.', '..lll..', '..jjj..', '.jjjjj.', '.jjjjj.', '..jjj..'], 4, gr.gh - 8, { f: A[1], l: A[0], j: A[0] });
    }
    if (ed.id === 'lights') {
      // a brass pot of marigolds and a small lamp on the inner sill
      rowsW(I, gr, ['.m.m.m.', 'mmmmmmm', '.mmmmm.', '..ppp..', '.ppppp.', '..ppp..'], 4, gr.gh - 6, { m: MG[2], p: GD[1] });
    }
    // ---------------- outside: window boxes, garlands, wreaths ----------------
    if (has(ed, 'window-boxes')) {
      const spring = ed.id === 'spring';
      const fl = spring
        ? [
            { shape: 'tulip', c: [RD[3], RD[4], RD[5]], tall: true },
            { shape: 'star', c: [GD[3], GD[5], MG[4]] },
            { shape: 'tulip', c: [BL[4], BL[5], BL[6]], tall: true },
            { shape: 'star', c: [GD[4], GD[5], GD[6]] },
            { shape: 'round', c: [BN[2], BN[3], BN[4]] },
          ]
        : [
            { shape: 'round', c: [RD[3], RD[4], RD[5]] },
            { shape: 'star', c: [BN[2], BN[4], GD[5]] },
            { shape: 'round', c: [BL[4], BL[5], BL[6]] },
            { shape: 'tulip', c: [V[4], V[5], V[6]], tall: true },
            { shape: 'round', c: [RD[3], RD[5], RD[6]] },
          ];
      windowBox(I, gl, fl, spring ? 3 : 13);
      windowBox(I, gr, fl, spring ? 5 : 15);
    }
    if (has(ed, 'wreath')) wreath(I, 'evergreen');
    if (has(ed, 'flower-wreath')) wreath(I, 'flower');
    if (has(ed, 'leaf-wreath')) wreath(I, 'leaf');
    if (has(ed, 'flower-garland')) flowerGarland(I, PO.x0 + 3, PO.x1 - 4, PO.roofY + 8, 2, 3);
    if (has(ed, 'marigolds')) {
      toran(I, DX0 - 4, DX1 + 4, PO.roofY + 8, 3, 2);
      for (const id of ['ground-left', 'ground-right', 'upper-left', 'upper-right']) {
        const w = WIN[id].w;
        const n = w.w > 16 ? 3 : 2;
        toran(I, w.x - 3, w.x + w.w + 2, w.y - 3, n, id === 'upper-right' ? 1 : 2);
      }
    }
    if (has(ed, 'red-banners')) {
      // plain red vertical banners on both porch posts, gold flecks
      for (const bx of [PO.postL, PO.postR - 2]) {
        I.hl(bx - 1, bx + 3, 178, W[1], 0);
        for (let y = 179; y <= 200; y++)
          for (let k = 0; k < 3; k++) {
            let c = k === 0 ? RD[2] : k === 1 ? RD[4] : RD[3];
            if (HD.hash(bx + k, y, 51) < 0.07 && k > 0) c = GD[4];
            I.set(bx + k, y, c, 0);
          }
        I.hl(bx, bx + 2, 201, RD[2], 0);
        I.set(bx + 1, 202, RD[3], 0);
      }
    }
    if (has(ed, 'firecrackers')) {
      const FC = ['..k..', '..k..', '.rkr.', 'RrkrR', '.rkr.', 'RrkrR', '.rkr.', 'RrkrR', '.rkr.', 'RrkrR', '.rkr.', 'RrkrR', '.rkr.', '..k..', '.ggg.', '.rrr.', '.r.r.', 'r...r'];
      stamp(I, FC, PO.x1 - 1, PO.roofY + 7, { k: GD[2], r: RD[4], R: RD[3], g: GD[4] });
    }
    if (has(ed, 'corn-bundles')) {
      const CORN = [
        'l..b..l',
        '.l.b.l.',
        '..lbl..',
        '.lbbbl.',
        '..bbb..',
        '..bcb..',
        '..bbb..',
        '..bcb..',
        '..rrr..',
        '..bbb..',
        '..bcb..',
        '.bbcbb.',
        '.bbbbb.',
        'bbcbcbb',
        'bb.b.bb',
        'oc.b.co',
        'oo.b.oo',
        'o..b..o',
        'b..b..b',
        'b..b..b',
        'b.....b',
      ];
      const map = { l: AU[5], b: GD[2], c: GD[1], r: RD[3], o: MG[2] };
      stamp(I, CORN, PO.postL - 7, 206 - CORN.length, map);
      stamp(I, CORN, PO.postR + 1, 206 - CORN.length, map);
    }
    if (has(ed, 'bunting')) {
      const cols = [GD[4], RD[4], P.night[9], BN[4], V[5]];
      const xs = [PO.x0 + 4, Math.round((PO.x0 + PO.x1) / 2), PO.x1 - 5];
      let k = 0;
      for (let x = xs[0]; x <= xs[2]; x++) {
        const y = swagY(x, xs, PO.roofY + 8, 3);
        I.set(x, y, S[1], 0);
        const off = x - xs[0];
        if (off % 5 === 1 && x + 3 <= xs[2]) {
          const c = cols[k++ % cols.length];
          for (let dx = 0; dx < 3; dx++) {
            const yy = swagY(x + dx, xs, PO.roofY + 8, 3);
            I.set(x + dx, yy + 1, dx === 0 ? K.dk(c) : c, 0);
            if (dx === 1) {
              I.set(x + dx, yy + 2, c, 0);
              I.set(x + dx, yy + 3, K.dk(c), 0);
            } else I.set(x + dx, yy + 2, dx === 0 ? K.dk(c) : c, 0);
          }
        }
      }
    }
  }

  // ===================================================================
  // per-edition window glow
  // ===================================================================
  const shiftRamp = (ramp, k) =>
    ramp.map((c) => {
      for (let i = 0; i < Math.abs(k); i++) c = k > 0 ? K.lt(c) : K.dk(c);
      return c;
    });
  const winSetup = HD.perEdition((ed) => {
    const cfg = K.WINS.map((w) => w.c);
    const boost = K.WINS.map(() => 1);
    if (has(ed, 'party-windows')) {
      K.WINS.forEach((w, i) => {
        if (w.w.cat) {
          boost[i] = 1.12;
          return;
        }
        cfg[i] = Object.assign({}, w.c, { ramp: shiftRamp(w.c.ramp, 1), speed: w.c.speed * 1.8, amp: Math.min(1, w.c.amp * 1.5) });
        boost[i] = 1.2;
      });
    }
    if (has(ed, 'menorah')) {
      const i = WIN['ground-left'].index;
      cfg[i] = Object.assign({}, cfg[i], { ramp: [A[1], A[2], A[3], A[4], A[5], A[5]], src: [0.5, 0.9], R: 22 });
      boost[i] = 0.8;
    }
    if (ed.id === 'winter') {
      const i = WIN['ground-right'].index;
      cfg[i] = Object.assign({}, cfg[i], { ramp: [A[2], A[3], A[4], A[5], A[6]], R: 18 });
    }
    // bake overridden glass
    const glass = K.WINS.map((win, i) => {
      if (cfg[i] === win.c) return null;
      const w2 = Object.assign({}, win, { c: cfg[i] });
      const out = [];
      for (let l = 0; l < K.NL; l++)
        out.push(
          HD.bake(win.gw, win.gh, (g) => {
            for (let ly = 0; ly < win.gh; ly++)
              for (let lx = 0; lx < win.gw; lx++) if (K.winInside(win, win.gx + lx, win.gy + ly, 0)) g.px(lx, ly, K.glassColor(w2, lx, ly, l));
          }),
        );
      return out;
    });
    return { cfg, boost, glass };
  });

  // ===================================================================
  // animated decorations
  // ===================================================================
  const EAVE = [
    [163, 130],
    [180, 131],
    [197, 130],
    [214, 131],
    [231, 130],
    [248, 131],
    [265, 130],
    [271, 130],
  ];
  const PORCH = [
    [PO.x0 + 1, PO.roofY + 7],
    [Math.round((PO.x0 + PO.x1) / 2), PO.roofY + 8],
    [PO.x1 - 2, PO.roofY + 7],
  ];
  const TURRET = [
    [TU.x0 + 1, TU.top + 3],
    [TU.x0 + 15, TU.top + 4],
    [TU.x1 - 1, TU.top + 3],
  ];
  const STR_COLOR = { colors: ['red', 'gold', 'green', 'blue'], spacing: 4, sag: 2, twinkle: 0.8 };
  const STR_GOLD = { colors: ['gold'], spacing: 4, sag: 2, twinkle: 0.45 };
  const strings = (ed) => {
    if (has(ed, 'string-lights-color')) return { o: STR_COLOR, paths: [EAVE, PORCH, TURRET] };
    if (has(ed, 'string-lights-gold')) return { o: STR_GOLD, paths: [EAVE, PORCH] };
    return null;
  };

  // lanterns per edition: [x, y, kind, size, len]
  const LANTERNS = {
    lunar: [
      [PO.x0 + 8, PO.roofY + 8, 'red', 'big', 2],
      [PO.x1 - 9, PO.roofY + 8, 'red', 'big', 2],
    ],
    harvest: [
      [DX0, PO.roofY + 8, 'harvest', 'big', 2],
      [DX1 + 1, PO.roofY + 8, 'harvest', 'big', 2],
      [PO.x1 - 4, PO.roofY + 7, 'harvest', 'small', 2],
    ],
  };

  // diyas: [x, y(bottom)] on every sill and on the steps, grouped for lights
  const DIYA_GROUPS = (() => {
    const g = [];
    const sill = (id, xs) => {
      const w = WIN[id].w;
      const y = w.y + w.h + 1;
      g.push(xs.map((x) => [w.x + x, y]));
    };
    sill('ground-left', [2, 12]);
    sill('ground-right', [1, 10]);
    sill('upper-left', [1, 8]);
    sill('upper-right', [-2, 16]);
    sill('turret-lower', [3]);
    sill('turret-upper', [3]);
    g.push([
      [STP.x0 + 3, 205],
      [STP.x0 + 1, 208],
    ]);
    g.push([
      [STP.x1 - 6, 205],
      [STP.x1 - 4, 208],
    ]);
    return g;
  })();

  function drawInside(g, t) {
    const ed = HD.edition;
    if (has(ed, 'menorah')) {
      const w = WIN['ground-left'];
      for (let i = 0; i < MEN_X.length; i++) {
        const lx = MEN_X[i];
        FE.flame(g, w.gx + lx, w.gy + (lx === 8 ? 12 : 14), t, 300 + i, 1);
      }
    }
    if (has(ed, 'xmas-tree')) {
      const w = WIN['ground-right'];
      const e = g.em;
      for (let i = 0; i < TREE_BULBS.length; i++) {
        const [bx, by, col] = TREE_BULBS[i];
        const n = T.noise(t, 2.6, 400 + i);
        const ramp = P.bulb[col];
        e.px(w.gx + TREE_X + bx, w.gy + TREE_Y + by, ramp[n < 0.3 ? 0 : n < 0.62 ? 1 : 2]);
      }
      // star on top
      const sx = w.gx + TREE_X + 3;
      const sy = w.gy + TREE_Y - 2;
      const s = T.noise(t, 3.1, 431);
      e.px(sx, sy, GD[6]);
      e.px(sx + 1, sy, GD[5]);
      e.px(sx, sy + 1, GD[5]);
      e.px(sx + 1, sy + 1, GD[4]);
      if (s > 0.55) {
        e.px(sx, sy - 1, GD[5]);
        e.px(sx - 1, sy, GD[4]);
        e.px(sx + 2, sy + 1, GD[4]);
      }
    }
  }

  // summer: curtains billow out of the open windows
  const CURTAINS = [
    ['ground-right', -1, 7.3, 501],
    ['ground-right', 1, 6.1, 502],
    ['upper-left', 1, 6.7, 503],
  ];
  function drawCurtains(g, t) {
    for (const [id, side, per, seed] of CURTAINS) {
      const win = WIN[id];
      const drift = 0.6 + 2.6 * T.fbm(t, per, seed, 2);
      const top = win.gy + 1;
      const n = win.gh - 2;
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        const o = Math.round(drift * Math.pow(u, 1.5) + 0.6 * u * T.wave(t, per * 0.37, seed * 0.13 + u * 0.4));
        const xEdge = side < 0 ? win.gx - o : win.gx + win.gw - 1 + o;
        const xIn = side < 0 ? xEdge + 2 : xEdge - 2;
        const y = top + k;
        g.px(xEdge, y, BN[3]);
        g.px((xEdge + xIn) >> 1, y, BN[2]);
        g.px(xIn, y, BN[1]);
      }
    }
  }

  function drawFront(g, t) {
    const ed = HD.edition;
    const st = strings(ed);
    if (st) for (let i = 0; i < st.paths.length; i++) FE.bulbs(g, st.paths[i], t, Object.assign({ seed: 7 + i }, st.o));
    const ls = LANTERNS[ed.id];
    if (ls) for (let i = 0; i < ls.length; i++) FE.lantern(g, ls[i][0], ls[i][1], t, 60 + i, ls[i][2], { size: ls[i][3], len: ls[i][4], amp: 0.1 });
    if (has(ed, 'diyas-house')) {
      let s = 0;
      for (const grp of DIYA_GROUPS) for (const [x, y] of grp) FE.diya(g, x, y, t, 80 + s++);
    }
    if (has(ed, 'open-windows')) drawCurtains(g, t);
    if (has(ed, 'pie-sill')) {
      // a thin curl of steam from the pie
      const w = WIN['ground-left'].w;
      const px = w.x + 9;
      const py = w.y + w.h - 3;
      for (let i = 0; i < 3; i++) {
        const c = T.cycle(t, i, 3.4, 610);
        const a = c.age;
        if (a > 0.85) continue;
        const x = px + (i - 1) * 2 + Math.round(1.2 * Math.sin(a * 6 + i));
        const y = py - Math.round(a * 9);
        g.px(x, y, a < 0.5 ? BN[2] : BN[1]);
      }
    }
  }

  function lights(t, L) {
    const ed = HD.edition;
    const st = strings(ed);
    if (st)
      for (let i = 0; i < st.paths.length; i++)
        FE.bulbLights(L, st.paths[i], t, { colors: st.o.colors, sag: st.o.sag, every: 20, r: 16, i: has(ed, 'string-lights-color') ? 0.15 : 0.17 });
    const ls = LANTERNS[ed.id];
    if (ls) for (let i = 0; i < ls.length; i++) FE.lanternLight(L, ls[i][0], ls[i][1], t, 60 + i, ls[i][2], { size: ls[i][3], len: ls[i][4], amp: 0.1 });
    if (has(ed, 'diyas-house')) {
      let s = 0;
      for (const grp of DIYA_GROUPS) {
        let sx = 0;
        let sy = 0;
        for (const [x, y] of grp) {
          sx += x + 3;
          sy += y - 3;
        }
        const f = T.flicker(T.step(t, 10), 80 + s, 1.4);
        s += grp.length;
        L.add({ x: RND(sx / grp.length), y: RND(sy / grp.length), r: grp.length > 1 ? 22 : 16, color: LIGHT.diya, i: (0.26 + 0.06 * grp.length) * (0.8 + 0.4 * f), bands: 4, halo: { r: 7, a: 0.1 } });
      }
    }
    if (has(ed, 'menorah')) {
      const w = WIN['ground-left'];
      const f = T.flicker(T.step(t, 10), 300, 1.2);
      L.add({ x: w.gx + 8, y: w.gy + 12, r: 26, color: LIGHT.candle, i: 0.22 * (0.85 + 0.3 * f), halo: { r: 9, a: 0.1 } });
    }
    if (has(ed, 'xmas-tree')) {
      const w = WIN['ground-right'];
      const n = T.noise(t, 2.6, 400);
      L.add({ x: w.gx + 8, y: w.gy + 16, r: 22, color: n > 0.5 ? LIGHT.bulb.red : LIGHT.bulb.gold, i: 0.12, bands: 4 });
    }
  }

  // ===================================================================
  // hooks used by house.js
  // ===================================================================
  const omitCache = HD.perEdition((ed) => {
    const o = new Set(['pumpkin']);
    if (has(ed, 'menorah')) o.add('chair');
    if (has(ed, 'paper-cuts') || has(ed, 'party-windows')) o.add('herbs');
    if (has(ed, 'open-windows')) o.add('gr-curtains');
    return o;
  });

  K.seasons = {
    omit: (ed) => (ed === HD.edition ? omitCache() : omitCache.call(null)),
    decorateHouse(R, ed) {
      if (has(ed, 'roof-snow')) snowAll(R, true);
      else if (has(ed, 'roof-snow-light')) snowAll(R, false);
      if (has(ed, 'paper-lantern-string')) paintHook(R);
    },
    decorateInterior,
    winCfg: (win) => winSetup().cfg[win.index],
    winBoost: (win) => winSetup().boost[win.index],
    glass(i, lv) {
      const gl = winSetup().glass[i];
      return gl ? gl[lv] : K.glass[i][lv];
    },
    ironLantern: () => !has(HD.edition, 'red-lanterns'),
    drawInside,
    drawFront,
    lights,
  };
})();
